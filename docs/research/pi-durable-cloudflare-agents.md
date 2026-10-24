# Deep Research: Pi.dev, Pi Durable, and Cloudflare Agents SDK (Agent Pi)

**Author:** Antigravity Engineering & Architecture  
**Date:** 2026-10-23  
**Status:** Complete / Authoritative  
**Target:** BalaBot Architectural Modernization & Docker Retirement  

---

## Executive Summary

This research document evaluates **Pi.dev** (`@earendil-works/pi-durable`), **Cloudflare Agents SDK**, and specifically **Cloudflare Agent Pi** (`PiHarness`) as a modern replacement for the legacy Hermes gateway and Docker container infrastructure in BalaBot.

Currently, BalaBot operates within a monolithic Docker container (`balabot-balabot-1`) running s6-overlay, a Python FastAPI proxy (`ui/server.py`), and a Python-based Hermes agent gateway multiplexed over HTTP port 8642. While functional, this legacy setup imposes severe penalties:
1. **Container Friction:** Requires a full Docker daemon, WSL2 virtualization on Windows, high disk consumption (~10–15 GB images), and multi-gigabyte RAM idle overhead.
2. **Fragile Process Supervision:** Hermes gateway reloading (`gateway run --replace`), process-table polling (`/proc` and s6-svstat), and container-bound sockets (`cua-driver`) result in race conditions and lost turns during crashes.
3. **Impedance Mismatch:** Hermes manages agent state via in-memory sessions with post-hoc disk logging. If the process is terminated mid-turn, the context and intermediate tool executions are corrupted or dropped.

The modern paradigm pioneered by **Pi.dev** and formalized on Cloudflare via **Agent Pi (`PiHarness`)** replaces heavy containerized agents with **durable, SQLite-backed actor loops**. By pairing Pi Durable with Cloudflare Durable Objects for edge deployment and an ultra-lightweight **native Rust client/server desktop app** for local deployment, BalaBot can eliminate Docker entirely while preserving its entire user interface, hierarchy, persona system, Jev decision layer, and OKF governance ledger.

---

## 1. Pi.dev and Pi Durable Architecture

### 1.1 Origin and Philosophy
Pi (`pi.dev`) is an open-source, minimalist AI coding agent and agent harness conceived by **Mario Zechner** and maintained by **Earendil Inc.** (`earendil-works/pi`). Pi represents a deliberate counter-movement to monolithic, heavily opinionated coding tools:
- **Radical Simplicity:** Avoids complex, inflexible state machines and multi-tiered sub-agent bloat in the core engine.
- **The Core Toolset:** Operates out-of-the-box with only four fundamental tools: `read`, `write`, `edit`, and `bash` (or `exec`).
- **Tiny System Prompt:** Keeps the base system prompt under 1,000 tokens, preserving maximum context window capacity and avoiding cognitive interference with frontier models.
- **Extreme Extensibility:** Extensible via TypeScript packages, prompt templates, and custom skills without recompiling or patching core binaries.

### 1.2 Package Architecture
The Pi ecosystem is factored into composable, zero-fluff packages:
* **`@earendil-works/pi-durable`**: The stateful, crash-proof agent harness.
* **`@earendil-works/pi-ai`**: A unified, provider-agnostic LLM interface supporting Anthropic, OpenAI, Google Gemini, DeepSeek, Groq, Mistral, Ollama, and Cloudflare Workers AI. Normalizes request formatting, tool calling schemas, and reasoning/thinking stream extraction across all providers.
* **`@earendil-works/pi-chord`**: Collaborative document state management, CRDT-like delta streams, and transcript diffing.

### 1.3 How Pi Durable Achieves Durability
Traditional agent harnesses (including Hermes, AutoGen, and LangChain) execute the model loop in volatile memory:
```
Message Received → Memory Buffer → Model Call → Tool Execution → Response Emitted → (Optional) Save to Disk
```
If the container crashes or the process is killed during tool execution or model streaming, the entire turn state is lost or left in an indeterminate state.

**Pi Durable inverts this pattern by committing state before execution:**
1. **Atomic Turn Journaling:** Every incoming user message, steer, follow-up, or scheduled task is immediately persisted to a transactional SQLite database.
2. **Pre-Execution Tool Logging:** Before invoking a tool (e.g. file write or command execution), the intent and input arguments are journaled. Upon tool completion, the output is atomically appended.
3. **Structured Concurrency (Task Graph):** Pi treats agent work as a directed acyclic graph (DAG) of tasks. Conversations can fork into sub-branches, run concurrent tasks, or suspend awaiting external input without blocking the main event loop.
4. **Resumption from Ground Truth:** Upon reboot after a crash, power failure, or eviction, Pi opens the SQLite database, inspects the last unfinalized journal entry, and replays or resumes execution with zero context loss.

```
                          ┌───────────────────────────┐
                          │    Incoming User Message  │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │  SQLite: Begin Turn Tx    │
                          │   (pi_sessions/messages)  │
                          └─────────────┬─────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │   Invoke Model (pi-ai)    │
                          │   Stream Thinking & Text  │
                          └─────────────┬─────────────┘
                                        │
                        ┌───────────────┴───────────────┐
                        │ Tool Call Requested?          │
                        └───┬───────────────────────┬───┘
                            │ Yes                   │ No
                            ▼                       │
               ┌─────────────────────────┐          │
               │ Journal Tool Intent Tx  │          │
               └────────────┬────────────┘          │
                            │                       │
                            ▼                       │
               ┌─────────────────────────┐          │
               │ Execute Tool Function   │          │
               └────────────┬────────────┘          │
                            │                       │
                            ▼                       │
               ┌─────────────────────────┐          │
               │ Journal Tool Output Tx  │          │
               └────────────┬────────────┘          │
                            │                       │
                            └───────────┬───────────┘
                                        │
                                        ▼
                          ┌───────────────────────────┐
                          │  Finalize Turn & Commit   │
                          └───────────────────────────┘
```

---

## 2. Cloudflare Agents SDK & Agent Pi (`PiHarness`)

### 2.1 The Cloudflare Agents Framework
Cloudflare's Agents SDK (`https://developers.cloudflare.com/agents/`, package `@cloudflare/agents` or `agents`) builds directly upon **Cloudflare Workers** and **Durable Objects (DO)**:
* **Actor Model Primitives:** Every agent instance is a unique Durable Object, globally addressable, running in a single-threaded isolate close to the user.
* **Co-located SQLite (`this.sql`):** Every Durable Object possesses zero-latency, embedded SQLite storage with full ACID compliance.
* **WebSocket Streaming:** Native WebSocket support facilitates real-time bidirectional messaging, state syncing, and live token streaming directly to browser clients.
* **Routing & Dispatch:** Built-in utilities `routeAgentRequest(req, env)` and `getAgentByName(env.AgentNamespace, id)` simplify HTTP and WebSocket routing without manual dispatch tables.

### 2.2 Cloudflare Agent Pi (`PiHarness`)
The Cloudflare Agents SDK provides first-class support for Pi Durable through `PiHarness` (located at `agents/harness/pi`). `PiHarness` acts as an SDK **Lifecycle capability**, bridging the headless Pi Durable engine with Cloudflare's serverless primitives:

```typescript
import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { PiHarness } from "agents/harness/pi";
import { createAI } from "agents/models/pi-ai";

export class BalaBotAgent extends DurableObject<Env> {
  ai = createAI({ binding: this.env.AI });

  readonly lifecycle = Lifecycle.install(this)
    .use(new PiHarness({
      ai: this.ai,
      // Extensions, tools, skills, and model configuration
    }));
}
```

#### Core Mechanisms of `PiHarness`:
1. **Isolated SQLite Tables:** Pi persists its state into the Durable Object's co-located SQLite engine under dedicated tables prefixed with `pi_` (e.g., `pi_sessions`, `pi_messages`, `pi_tasks`, `pi_inbox`). This guarantees zero table collision with user-defined schemas (such as BalaBot's decision ledger or session continuity spans).
2. **Lifecycle Alarm Bridging:** In a standard Node.js server, Pi relies on an in-memory timer and event loop to wake sleeping tasks and process inboxes. In Cloudflare Workers, an idle Durable Object is evicted from RAM after a brief period of inactivity. `PiHarness` intercepts Pi's internal `wake()` scheduler and converts scheduled wakeups into **Durable Object Alarms** (`this.ctx.storage.setAlarm(timestamp)`).
3. **Heartbeat and Cold Start Recovery:** When an alarm triggers, Cloudflare re-hydrates the Durable Object, re-instantiates `PiHarness`, reads the pending task queue from `pi_tasks`, and resumes execution seamlessly.
4. **Crash Immunity:** If an edge worker hits a CPU limit or experiences transient network disconnection from an upstream LLM API, the transaction state in SQLite remains intact. Upon retry or next request, Pi picks up from the exact token or tool boundary.

### 2.3 Cloudflare Computer (`@cloudflare/computer`)
To execute code, manipulate files, and automate workflows in the cloud without a monolithic Docker container, Cloudflare introduces **`@cloudflare/computer`**:
* **SQLite-Backed Virtual Workspace:** Provides a persistent, shared filesystem hosted directly in Durable Object storage:
  ```typescript
  import { Workspace } from "@cloudflare/computer";
  const workspace = new Workspace({ storage: this.ctx.storage });
  ```
* **Dual Execution Backends:**
  1. *Isolate Runtime:* Executes bash-like scripts and lightweight operations via `just-bash` inside standard V8 Workers at near-zero latency and minimal cost.
  2. *Container Runtime:* On-demand, ephemeral micro-containers mounted via FUSE for heavy builds, Python execution, or binary toolchains when strictly required—spinning down immediately after use.
* **Standard Tool Interface:** Out-of-the-box tools (`read`, `write`, `edit`, `ls`, `exec`) compatible with Pi and OpenAI tool-calling conventions.

---

## 3. Comparative Analysis: Hermes vs. Pi Durable

The table below contrasts the legacy Hermes implementation in BalaBot against the proposed Pi Durable architecture:

| Dimension | Legacy Hermes (Current) | Pi Durable + Agent Pi (Target) | Architectural Impact |
| :--- | :--- | :--- | :--- |
| **Runtime Environment** | Monolithic Docker container (`debian:bookworm-slim` + s6-overlay + Python 3.11 + Hermes CLI) | Serverless Cloudflare DO + Local Rust Desktop App | Completely eliminates Docker requirement (~15 GB down to ~30 MB binary). |
| **Agent Execution Loop** | Python process managing CLI/gateway sessions via subprocesses and pseudo-terminals | Native TypeScript/Rust event loop with atomic SQLite transaction journal | Zero-loss crash recovery; turns resume seamlessly after process kill or DO eviction. |
| **Storage Architecture** | Flat files in `/opt/data/profiles/` + fragmented SQLite DBs (`continuity.db`, `memory_store.db`) | Unified SQLite storage: co-located DO SQLite (remote) or native SQLite3 (local) | Eliminates disk volume mount issues; zero latency ACID transactions. |
| **System Prompt Footprint** | Large (often 3,500–6,000 tokens) with verbose CLI formatting instructions | Lean (<1,000 tokens) + modular skill extensions | Frees up prompt context; drastically reduces token costs and latency. |
| **Lifecycle & Concurrency** | Fragile PID tracking (`/proc`), `gateway run --replace` drops connections | Structured concurrency, DO Alarms, and native async tasks | No dropped WebSocket frames; graceful background job execution. |
| **Thinking Stream** | Extracted via custom regex / SSE parser in `ui/server.py` | Native support in `@earendil-works/pi-ai` via separate `reasoning_content` delta channel | First-class UI thinking disclosure rendering without string splitting hacks. |
| **Multi-Agent Spawning** | Ephemeral subprocesses logged to `spawn-ledger.json` | First-class hierarchical task trees and peer agent RPCs via `getAgentByName` | Clean isolation between persistent agents and temporary sub-agent jobs. |
| **Deployment Modes** | Host Docker or remote Linux VM with exposed HTTP ports | Dual-Mode: Pure Local PC (Rust + Pi) or Cloudflare Edge (`bot.balacode.xyz`) | Frictionless installation: download `.exe`/`.dmg`/`.deb` and run immediately. |

---

## 4. Feasibility Analysis for BalaBot Modernization

### 4.1 Retaining Core BalaBot Capabilities
The prompt mandates: *"The rest of the app remains the same."* The architectural audit confirms that every load-bearing capability of BalaBot maps directly to Pi Durable:

1. **Hierarchy (Principal > Governor > Persistent Agents > Sub-agents):**
   * *Principal Bot:* Implemented as the root Pi Durable agent responsible for ops, agent health, and routine growth reviews.
   * *Governor Bot:* Manages the shared OKF decision ledger (`docs/kb/`) and decision auditing.
   * *Persistent Agents:* Each registered bot in the fleet roster corresponds to a durable Pi agent instance with its own SQLite state.
   * *Sub-agents:* Created as child tasks within Pi's structured task graph; ephemeral, unrostered, reporting summary-only back to the parent.
2. **Jev (TypeSafe AI) Hard Dependency:**
   * Jev remains the System 1 calibrated probabilistic evaluator (`POST https://api.typesafe.ai/v1/systemone`).
   * Pi Durable extensions hook into:
     - Turn-time keyword scan → Jev Noul evaluation for user frustration.
     - Decision gate: evaluates whether conversation turns contain ratifiable decisions before writing to the Governor's OKF ledger.
     - Memory relevance re-ranking: pre-filtering holographic memory facts before prompt injection.
     - Skill selection: recommending top-k relevant skills for each turn.
3. **OpenUI Generative UI:**
   * Pi prompts are configured to emit ````openui-lang```` fenced blocks for human approval cards (`HireAgentCard`, `Card`, `FormField`, `ConfirmButtons`).
   * The React frontend (`ui/src/openui/library.tsx`) parses and renders these interactive cards identically.
4. **Thinking Stream Disclosures:**
   * `@earendil-works/pi-ai` emits `choices[].delta.reasoning_content` directly. The frontend receives these tokens and populates the existing collapsible disclosure widget conditioned on `balabot.showThinking.v1`.
5. **Computer Control & Interventions:**
   * *Local Mode:* Rust client hooks directly into OS native automation (Accessibility APIs, native screenshot capture, CDP to local Chromium), replacing the sluggish Xvfb container.
   * *Cloudflare Mode:* Uses `@cloudflare/computer` or routes computer actions down to the user's local Rust client via a secure WebSocket reverse RPC bridge.
   * *Intervention Flow:* When an agent requires human assistance (e.g. captcha/2FA), Pi Durable sets a paused task state and emits an `event: intervention` frame; the user completes the action in the desktop client and resumes execution with a single click.

---

## 5. Architectural Conclusions & Recommendations

1. **Deprecate Docker Unconditionally:** There is no technical requirement for Docker once Hermes is replaced by Pi Durable. Docker was merely a packaging mechanism for Python virtual environments, Hermes CLI binaries, and an X11 virtual display.
2. **Adopt a Native Rust Desktop Shell:** Build the client installer using Rust (Tauri v2). Rust provides:
   - Zero-runtime installation (<30 MB single binary).
   - High-performance local HTTP/WebSocket server for Mode 1 (Local PC as Server).
   - Secure reverse-RPC execution bridge for Mode 2 (Cloudflare Remote Server).
   - Seamless embedding of the existing React SPA via the native OS WebView.
3. **Implement Cloudflare Agent Pi (`PiHarness`) for Remote Mode:** Deploy BalaBot on Cloudflare Workers using the Agents SDK. Durable Objects host the persistent agent state in edge SQLite, eliminating server management while guaranteeing sub-50ms worldwide latency.
4. **Preserve Database Compatibility:** Keep session continuity concepts (topic spans, purpose records, decisions) intact by porting the schema into the co-located SQLite instance.

The subsequent Product Requirements Document (PRD) establishes the precise engineering specifications, API contracts, schema migrations, and implementation waves for this transformation.
