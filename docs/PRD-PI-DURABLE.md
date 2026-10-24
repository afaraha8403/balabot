# Product Requirements Document (PRD): BalaBot Modernization — Pi Durable Engine, Cloudflare Edge & Native Rust Architecture

**Document Version:** 1.0.0  
**Status:** Approved / Authoritative Spec  
**Target:** BalaBot Core Architecture  
**Author:** Antigravity Architecture & Core Engineering  
**Date:** 2026-10-23  
**License:** MIT  

---

## 1. Executive Summary & Vision

### 1.1 The Objective
Migrate **BalaBot** from its legacy, container-bound architecture (monolithic Docker container running Hermes gateway, s6-overlay, and Python subprocesses) to a modern, zero-container architecture powered by **Pi Durable** (`@earendil-works/pi-durable`) and **Cloudflare Agents SDK** (`PiHarness`).

The new platform ships as a single, lightweight **native Rust desktop application** compatible with Windows, macOS, and Linux (~120 MB binary package; ~150 MB active RAM footprint including embedded V8/Node execution runner). The system operates in a unified **Client/Server configuration** with two operational modes:
1. **Local Autonomous Mode (PC as Server & Client):** The Rust desktop app runs the Pi Durable engine locally using embedded runtimes and local SQLite storage. The user's machine is self-contained: no external servers, no cloud requirements, and **zero Docker dependencies**.
2. **Cloudflare Remote Mode (Cloudflare Edge Server):** The user connects the Rust desktop client to a serverless deployment hosted on **Cloudflare Workers and Durable Objects** utilizing **Agent Pi (`PiHarness`)**. Agent states, transcripts, and scheduled background tasks live in edge SQLite, while local computer operations route securely to the local PC via a reverse RPC bridge.

### 1.2 Non-Negotiable Law: "The Rest of the App Remains the Same"
The external surface and core product mechanics of BalaBot remain completely preserved:
- **Product UI:** The React SPA (`ui/src/`) retains 100% feature and visual parity (Bot Roster, Command Palette, Chat, Thinking disclosures, editable Draft Cards, Voice Memo player, Routines list, Intervention Cards, and OpenUI Generative UI).
- **Multi-Tenant Orgs & Group Chats:** Multi-tenant workspace partitioning (`/api/org/*`, `orgs.py`) and multi-agent group broadcasts (`/api/groups/*`, `groups.py`) are strictly preserved.
- **Agent Hierarchy:** Four-tier model preserved: User > Principal Bot > Governor > Persistent Agents > Sub-agents.
- **Jev (TypeSafe AI):** Remains a **hard infrastructure dependency** (System 1 fast probabilistic decision engine for frustration detection, decision gating, memory relevance re-ranking, and skill selection). Fails loud in production; supports an offline heuristic engine (`JEV_MODE=heuristic`) in isolated local mode.
- **Decision Ledger:** Open Knowledge Format (**OKF v0.2**) markdown documents with YAML frontmatter remain the master, human-readable, git-diffable ledger.
- **Secret Perimeter (W4):** Client-side direct HTTP ingestion for credentials; raw secret values never appear in chat messages, thinking streams, tool parameters, or SQLite transcripts.
- **Memory:** Holographic SQLite fact store with FTS5, HRR algebra, and trust scoring, enhanced with Jev prefetch re-ranking.
- **Personas & Skills:** Pre-shipped `principal` and `governor` souls, fleet roster bots, and three-tier skill resolution (Shipped > Brought > Learned with Curator governance).

### 1.3 Total Docker Retirement & The "Never The Host" Security Law
- **Total Docker Retirement:** Docker, `docker-compose.yml`, `Dockerfile`, s6-overlay, and container-bound virtual displays (`agent-computer-linux-vm` / `cua-driver`) are **retired completely**. No container virtualization is required on any user machine.
- **The "NEVER THE HOST" Desktop Law:** Agent computer automation is strictly quarantined. The agent NEVER injects raw synthetic mouse or keyboard events (`SendInput`, `CGEvent`, `uinput`) into the user's active host desktop session. All computer interactions execute inside an isolated virtual display (e.g. headless Chromium via Chrome DevTools Protocol or an isolated off-screen virtual framebuffer) with an explicit filesystem sandbox.

---

## 2. System Architecture & Topology

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   BALABOT TOPOLOGY                                     │
└────────────────────────────────────────────────────────────────────────────────────────┘

                     ┌──────────────────────────────────────────┐
                     │         BalaBot React SPA (UI)          │
                     │  (Bot Roster, Chat, OpenUI, Composer)    │
                     └────────────────────┬─────────────────────┘
                                          │
                                          ▼
                     ┌──────────────────────────────────────────┐
                     │       Native Rust Desktop Shell          │
                     │       (Tauri v2 + Tokio Engine)          │
                     └─────────────┬────────────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │ Mode Selector:                          │
              │ [ Local PC ]  vs  [ Cloudflare Remote ] │
              └─────────────┬───────────────────┬───────┘
                            │                   │
             (Mode 1: Local)│                   │(Mode 2: Remote)
                            ▼                   ▼
    ┌───────────────────────────────┐   ┌────────────────────────────────┐
    │     Local PC Server           │   │    Cloudflare Edge Worker      │
    │  (127.0.0.1:9119 / Tokio IPC) │   │   (bot.balacode.xyz / WSS)     │
    ├───────────────────────────────┤   ├────────────────────────────────┤
    │ • Pi Durable Engine (Node/Bun)│   │ • Cloudflare Agents SDK        │
    │ • SQLite (~/.balabot/data/)   │   │ • PiHarness (agents/harness/pi)│
    │ • Local FS & Shell Execution  │   │ • Durable Objects SQLite       │
    │ • Native OS Automation (CUA)  │   │ • Cloudflare Workers AI / GW   │
    │ • Jev System 1 Client         │   │ • Jev System 1 Client          │
    │ • Holographic Memory Store    │   │ • Holographic Edge Store       │
    │ • OKF Markdown Ledger         │   │ • OKF Edge Sync Engine         │
    └───────────────────────────────┘   └───────────────┬────────────────┘
                                                        │ Reverse RPC
                                                        │ (Tool Bridge)
                                                        ▼
                                        ┌────────────────────────────────┐
                                        │  Rust Local Tool Bridge        │
                                        │  • Local File / Git Ops        │
                                        │  • Local Command Execution     │
                                        │  • Native Screen / OS Autom.   │
                                        └────────────────────────────────┘
```

### 2.1 Mode 1: Local Autonomous Mode (PC as Server & Client)
In this mode, the PC functions as both the server and the client:
* **Architecture:** The Rust desktop application launches an embedded background server process (using an embedded V8/Node runtime sidecar) hosting `@earendil-works/pi-durable`.
* **Network Binding:** Listens on `127.0.0.1:9119` for HTTP/WebSocket traffic or communicates directly over internal inter-process communication (IPC).
* **Storage:** State is stored in standard OS user application data directories:
  - Windows: `%APPDATA%\balabot\data\`
  - macOS: `~/Library/Application Support/balabot/data/`
  - Linux: `~/.config/balabot/data/` (or `~/.local/share/balabot/data/`)
* **Computer Automation ("NEVER THE HOST"):** Replaces the heavy Xvfb/cua-driver container with **quarantined sandboxed automation**:
  - Web & DOM automation via headless Chromium managed via Chrome DevTools Protocol (CDP).
  - Desktop automation confined strictly to isolated virtual displays or off-screen framebuffers.
  - Native OS synthetic input injection (`SendInput`, `CGEvent`, `uinput`) into the host's interactive desktop session is **strictly prohibited**.
  - Local shell and filesystem operations are strictly confined within user-designated workspace directories.
* **Zero Cloud Dependency:** The agent can operate entirely offline when paired with local models (Ollama, llama.cpp) and the local heuristic System 1 engine (`JEV_MODE=heuristic`), or connect directly to frontier LLMs via API keys stored in the local OS credential vault.

### 2.2 Mode 2: Cloudflare Remote Mode (Cloudflare Edge Server)
In this mode, the agent compute and durable state reside on Cloudflare's serverless infrastructure:
* **Architecture:** Deployed as a Cloudflare Worker utilizing the **Cloudflare Agents SDK** (`@cloudflare/agents`).
* **Multi-Tenant Durable Object Partitioning:** Each persistent agent instance is isolated by tenant, organization, and bot identifier using composite keys: `${tenant_id}:${org_id}:${bot_id}`. This eliminates cross-tenant state collisions.
* **Storage:** State is persisted to zero-latency SQLite embedded in each Durable Object (`this.sql`), utilizing isolated tables prefixed with `pi_`.
* **Wake-Up & Alarms:** The in-memory Pi scheduler delegates to Durable Object Alarms (`this.ctx.storage.setAlarm()`). Idle agents sleep at zero cost; scheduled routines or incoming user messages wake the Durable Object automatically.
* **Hardened Local Execution Bridge (Reverse RPC):** When an agent on Cloudflare needs to interact with the user's local workstation (e.g. read files in a local directory, run a test suite, or inspect a browser):
  1. The Cloudflare agent invokes a registered bridge tool (`local_exec`, `local_read`, `local_screen`).
  2. The invocation payload is cryptographically signed (Ed25519) and parameter-validated against an explicit allow-list. Arbitrary, unsanitized shell string injection is blocked.
  3. The local Rust client receives the request, verifies signature and lease validity, evaluates it against the user's consent policy (with an interactive approval dialog for writes or outside-workspace access), executes the action within the scoped workspace jail, and streams the output back over the WebSocket.

### 2.3 Mode Switching & Parity
The user can switch between **Local PC** and **Cloudflare Remote** via a simple switch in the UI header. Both runtimes implement the exact same REST and WebSocket API grammar, ensuring the UI code requires zero modification.

### 2.4 State Synchronization Protocol
To prevent data divergence when switching between Local PC and Cloudflare Remote modes:
* **Storage Independence by Default:** Each mode maintains its own primary SQLite store to preserve low-latency execution and privacy.
* **Explicit Ledger & Memory Sync:** When requested by the user, the client initiates a cryptographic state sync:
  1. Compares high-water-mark sequence numbers (`seq`) in `pi_messages` and `topic_spans`.
  2. Syncs OKF v0.2 decision markdown documents (`docs/kb/decisions/`) via bidirectional content-hashed merge.
  3. Reconciles holographic memory facts via Lamport timestamps and origin hashes.
* **Secret Redaction Invariant:** Secrets and local environment tokens are **never** synced to Cloudflare. Remote workers use Cloudflare Worker Secrets/KV directly.

---

## 3. Pi Durable Agent Harness Specification

### 3.1 Core Harness Loop
The legacy Hermes gateway is replaced by `@earendil-works/pi-durable`. Pi Durable manages the agent loop with transactional guarantees:
1. **Turn Ingestion:** Messages are committed to `pi_messages` before prompting the model.
2. **Model Invocation:** Handled by `@earendil-works/pi-ai`, normalizing OpenAI, Anthropic, Gemini, DeepSeek, and Cloudflare Workers AI.
3. **Reasoning Stream Extraction:** The harness intercepts reasoning deltas (`choices[].delta.reasoning_content`) and routes them to a dedicated `thinking` channel.
4. **Tool Call Journaling:** Tool intents and parameters are journaled to SQLite before dispatch; outputs are appended on return.
5. **Crash Resilience:** If process execution halts mid-turn, re-opening the database resumes the pending task graph from the last valid checkpoint without repeating side effects.

### 3.2 Schema Specification (SQLite)
Both the local SQLite database and Cloudflare Durable Object SQLite share the identical relational schema, reconciling all legacy Hermes databases (`continuity.db`, `queue.db`, `handoffs.db`, `approvals.db`) into an authoritative, typed structure:

```sql
-- 1. Core Pi Durable State (managed by @earendil-works/pi-durable & PiHarness)
CREATE TABLE IF NOT EXISTS pi_sessions (
    session_id          TEXT PRIMARY KEY,
    agent_id            TEXT NOT NULL,
    bot_id              TEXT NOT NULL, -- explicit bot identifier for roster mapping
    purpose             TEXT,          -- first-class purpose contract (balabot/sessions.py)
    compaction_count    INTEGER NOT NULL DEFAULT 0,
    last_compaction_at  INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    metadata            TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pi_messages (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    thinking        TEXT,           -- persisted chain-of-thought tokens (prevents reload loss)
    tool_calls      TEXT,           -- structured JSON tool intents and arguments
    created_at      INTEGER NOT NULL,
    UNIQUE(session_id, seq)
);

CREATE TABLE IF NOT EXISTS pi_tasks (
    task_id         TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    parent_task_id  TEXT,
    task_type       TEXT NOT NULL,
    status          TEXT NOT NULL, -- pending, running, completed, failed, paused
    input_payload   TEXT NOT NULL,
    output_payload  TEXT,
    error_message   TEXT,
    wake_at         INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- Absorbs legacy queue.db and handoffs.db into unified transactional inbox
CREATE TABLE IF NOT EXISTS pi_inbox (
    message_id      TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    session_id      TEXT REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    source_agent    TEXT,
    message_type    TEXT NOT NULL, -- steer, follow_up, handoff, secret_grant
    payload         TEXT NOT NULL,
    seq             INTEGER,
    handled         INTEGER NOT NULL DEFAULT 0,
    claimed_at      INTEGER,
    delivered_at    INTEGER,
    created_at      INTEGER NOT NULL
);

-- 2. Purpose Records & Spans (preserves balabot/sessions.py contracts)
CREATE TABLE IF NOT EXISTS topic_spans (
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    topic           TEXT NOT NULL,
    start_seq       INTEGER NOT NULL,
    end_seq         INTEGER NOT NULL,
    PRIMARY KEY (session_id, start_seq)
);

-- Renamed to session_decisions to eliminate collision with approvals.db:decisions
CREATE TABLE IF NOT EXISTS session_decisions (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES pi_sessions(session_id) ON DELETE CASCADE,
    decision_text   TEXT NOT NULL,
    provenance      TEXT NOT NULL,
    recorded_at     TEXT NOT NULL
);

-- 3. Multi-Tenant Orgs & Group Broadcasts (replaces loose JSON in /opt/data/)
CREATE TABLE IF NOT EXISTS pi_orgs (
    org_id          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    metadata        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS pi_groups (
    group_id        TEXT PRIMARY KEY,
    org_id          TEXT NOT NULL REFERENCES pi_orgs(org_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_messages (
    id              TEXT PRIMARY KEY,
    group_id        TEXT NOT NULL REFERENCES pi_groups(group_id) ON DELETE CASCADE,
    sender_id       TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

-- 4. Fleet & Governance Ledger
CREATE TABLE IF NOT EXISTS fleet_roster (
    bot_id          TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    title           TEXT NOT NULL,
    icon            TEXT NOT NULL,
    color           TEXT NOT NULL,
    role_class      TEXT NOT NULL, -- shipped, persistent, subagent
    created_by      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    config_json     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_audit_ledger (
    id              TEXT PRIMARY KEY,
    timestamp       TEXT NOT NULL,
    actor           TEXT NOT NULL,
    target_bot      TEXT NOT NULL,
    action          TEXT NOT NULL,
    diff_json       TEXT NOT NULL,
    rollback_token  TEXT NOT NULL
);
```

### 3.3 Structured Concurrency & Sub-Agents
In legacy Hermes, sub-agents were operating system subprocesses registered in `/opt/data/spawn-ledger.json`. In Pi Durable:
- **Sub-agents are child tasks:** Spanned within Pi's task DAG (`pi_tasks` with `parent_task_id`).
- **Context Isolation:** A sub-agent receives an isolated context window with its specific task prompt; it never sees the parent conversation history.
- **Summary Return:** When the child task finishes, its final result is posted back into the parent agent's `pi_inbox` as a typed message.
- **UI Visibility:** The UI queries `/api/subagents`, which now queries `SELECT * FROM pi_tasks WHERE parent_task_id IS NOT NULL AND status IN ('running', 'pending')`, reporting honest live states with zero `/proc` polling.

### 3.4 Compaction & Context Window Management
To prevent LLM context saturation while respecting storage boundaries:
- **On-Demand Context Pruning:** Compaction is an active projection pipeline for model prompt construction, NOT destructive physical row deletion. `pi_messages` rows remain intact in SQLite for transcript auditability and user scrolling.
- **Physical Row Purging:** In Cloudflare Durable Objects subject to strict 10 GB storage quotas, physical table compaction is scheduled via DO Alarms when session length exceeds 5,000 turns. Before purging, Jev extracts salient facts and binding decisions, persisting them to holographic memory and OKF markdown.

---

## 4. Preservation of BalaBot Core Capabilities

### 4.1 Hierarchy & Roster
The three classes of agents defined in `docs/architecture.md` are strictly preserved:
1. **Shipped Agents (`principal`, `governor`):** Seeded automatically during bootstrap. Their system configurations and identities are locked; edit/delete/purge requests return HTTP 409 Conflict.
2. **Persistent User-Created Agents (e.g. `scout`):** Created via the owner-consent flow, recorded in `fleet_roster`. Have durable SQLite state, private memory, and individual routines.
3. **Sub-Agents:** Temporary, unnamed, ephemeral child tasks in `pi_tasks`. Never registered in the roster; garbage-collected upon completion.

### 4.2 Jev (TypeSafe AI) System 1 Infrastructure Dependency
Jev remains a core dependency (`POST https://api.typesafe.ai/v1/systemone` using `TYPESAFE_API_KEY`). The Pi Durable runtime implements the four-tier Jev pipeline:
1. **Frustration Sensor:**
   - Turn-time keyword dictionary detects markers.
   - Triggers Jev System 1 Noul call: `"is this user frustrated?"`.
   - If confirmed with calibrated probability > threshold, writes signal to `growth_audit_ledger` and notifies the Principal Bot.
2. **Decision Gate:**
   - Every assistant turn is evaluated by Jev: `"does this message establish or record a binding decision?"`.
   - Calibrated Noul evaluation determines whether to admit the entry into the Governor's OKF ledger.
3. **Memory Relevance Re-Ranking:**
   - Holographic SQLite memory retrieves candidate facts via FTS5/HRR.
   - Jev evaluates candidate relevance against the current turn context, pruning noise and preventing context window bloat.
4. **Skill Selection:**
   - Turn-time routing evaluates user intent against the skill registry and injects the top-ranked skill triggers.
5. **Operational Modes & Fail-Loud Contract:**
   - **Cloudflare Remote / Production Mode (`JEV_MODE=cloud`):** If `TYPESAFE_API_KEY` is missing or the Jev API returns unrecoverable errors, the system **fails loudly** and raises a visible incident banner in the UI. No silent degradation.
   - **Local Autonomous Mode (`JEV_MODE=heuristic`):** For fully offline local operation, allows an embedded deterministic heuristic engine (local FTS5 ranking and calibrated keyword confidence), displaying an honest "Offline System 1" badge in the UI.

### 4.3 Open Knowledge Format (OKF v0.2) Decision Ledger
- The Governor Bot continues to write all confirmed decisions to markdown files formatted according to OKF v0.2 (YAML frontmatter with `type: decision`, `title`, `description`, `timestamp`, `status`, and source citations).
- **Storage Location:**
  - *Local Mode:* Written directly to `docs/kb/` or user's local vault directory.
  - *Cloudflare Mode:* Committed to Durable Object SQLite and synced to the connected git repository via GitHub API / Worker KV.

### 4.4 OpenUI Generative UI Integration
- When an agent requires human consent, structured input, or parameters (e.g. hiring an agent or approving a secret grant), it emits declarative OpenUI code inside triple-backtick fences:
  ````markdown
  ```openui-lang
  root = HireAgentCard("Marketing Specialist", "marketing-bot", "Drives organic growth and SEO.", "SEO, Copywriting")
  ```
  ````
- The React frontend receives this block, passes it to the `@openuidev/react-lang` parser in `ui/src/openui/library.tsx`, and renders the interactive card directly within the transcript stream.

### 4.5 Thinking Stream ("Reasoning Content")
- Frontiers models emitting private chain-of-thought tokens on `choices[].delta.reasoning_content` are streamed by Pi AI on a separate channel.
- The UI retains the top navigation toggle (`Show thinking`, persisted in `localStorage` under `balabot.showThinking.v1`).
- Thinking content renders inside a muted, collapsible `<details>` widget and is never merged into the main message text.
- Thinking tokens are persisted to `pi_messages.thinking` to prevent transcript loss on browser refresh.

### 4.6 Human Intervention Flow
- When an agent encounters an obstacle requiring human interaction (e.g. 2FA challenge, bot verification, or login screen), it calls the `request_intervention` tool.
- Pi Durable pauses the current task and emits an SSE/WebSocket frame:
  ```json
  {"event": "intervention", "data": {"bot_id": "scout", "reason": "Cloudflare Turnstile captcha", "resume_token": "token_abc123"}}
  ```
- The UI triggers `InterventionCard.tsx`, displaying the target window or screen.
- Once the human resolves the challenge and clicks **Done - resume**, the client dispatches `POST /api/intervention/{resume_token}/resolve`, and Pi Durable automatically resumes the task.

### 4.7 Multi-Tenant Organizations & Group Broadcasts
- **Multi-Tenant Orgs (`pi_orgs`, `orgs.py` parity):** All routes under `/api/org/*` are preserved. Roster queries, memory partitions, and routine execution are strictly scoped to the active `org_id`.
- **Group Broadcasts (`pi_groups`, `group_messages`):** Replaces legacy loose JSON files in `/opt/data/groups/` with SQLite tables. Broadcasts to a group dispatch individual inbox items to all member bots transactionally.

### 4.8 W4 Secret Store Security Perimeter
- **Zero-Plaintext Invariant:** Raw secret values are **strictly forbidden** from appearing in chat transcripts, model prompts, thinking tokens, or tool payloads.
- **Client-Side Direct Ingestion:** Users input credentials via `SecretRequestCard.tsx`, posting directly to the native OS credential vault (Local Mode) or encrypted Worker Secrets (Cloudflare Mode).
- **Inspection Integrity:** Responses surface only key names, SHA-256 fingerprints, and authorized bot lists (`granted_to: ["steve"]`). Plaintext values are never returned over any API route.

### 4.9 Skill Precedence & Curator Governance
- **Resolution Order:** Tool resolution enforces strict precedence: `Shipped` (immutable system tools) > `Brought` (explicitly imported by user) > `Learned` (generated by agents).
- **Curator Gate:** Newly proposed skills are staged in pending status until reviewed and approved via the Governor's curation workflow.

---

## 5. Native Rust Desktop Application

### 5.1 Architecture & Tech Stack
The desktop client is developed in **Rust** using **Tauri v2**:
* **Backend:** Compiled Rust binary running on Tokio async runtime.
* **Frontend:** Serves the existing React/TypeScript SPA (`ui/dist`) directly into the platform native WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux).
* **Binary Size & Footprint:** ~120 MB packaged bundle (compiled Tauri binary + embedded V8/Node execution runner + built UI assets); active memory footprint ~150 MB RAM (a 10x reduction compared to 1.5–3.0 GB for Docker Desktop / WSL2).

```
┌─────────────────────────────────────────────────────────────┐
│                   Tauri v2 Desktop App                      │
├─────────────────────────────────────────────────────────────┤
│  Frontend (WebView):                                        │
│    • BalaBot React SPA (ui/src)                             │
│    • Real-time WebSocket Client                             │
│    • OpenUI Card Renderer                                   │
├─────────────────────────────────────────────────────────────┤
│  Rust Native Core:                                          │
│    • Host Mode Switcher (Local Server vs Cloudflare Remote) │
│    • Local Server Runner (Embedded Pi Durable Engine)       │
│    • Reverse RPC Tool Bridge (Hardened, Signed JSON-RPC)    │
│    • Quarantined Automation (CDP / Virtual Display Jail)    │
│    • Native Secret Store (Windows Credential / Keychain)    │
│    • Global Shortcuts (Cmd/Ctrl+K, Cmd/Ctrl+D)              │
│    • System Tray & Background Worker                        │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Local Execution Bridge (Reverse RPC Protocol)
When running in Cloudflare Remote Mode, the Cloudflare agent communicates with the local machine over the existing WebSocket via structured, cryptographically signed JSON-RPC:

```json
// Cloudflare Agent -> Local Rust Client (Signed Request)
{
  "jsonrpc": "2.0",
  "id": "req-9842",
  "method": "bridge.execute_action",
  "params": {
    "action": "run_command",
    "executable": "git",
    "args": ["status", "--porcelain"],
    "cwd": "/Users/ali/workspace/my-project",
    "timeout_ms": 30000,
    "lease_token": "lease_ed25519_valid_signature_abc123"
  }
}

// Local Rust Client -> Cloudflare Agent (Response)
{
  "jsonrpc": "2.0",
  "id": "req-9842",
  "result": {
    "exit_code": 0,
    "stdout": "?? newfile.txt\n",
    "stderr": ""
  }
}
```

#### Security & Permissions:
- **No Arbitrary Shell Strings:** The bridge dispatches structured executable + argument arrays (`args: []`); raw shell strings (`bash -c "..."`) are prohibited by default.
- **Strict Directory Jailing:** Actions are confined to explicitly configured workspace paths. Any access attempt outside designated workspaces is rejected.
- **Human Consent Boundary:** Destructive operations (file deletion, writes, system modifications) trigger a native OS modal prompt or OpenUI approval card before execution.
- **NEVER THE HOST:** Pointer, keyboard, and screen automation never target the host OS desktop; all CUA tools interact only with headless browser instances via CDP or dedicated off-screen virtual framebuffers.

---

## 6. Docker Retirement & Legacy Clean-Up Plan

### 6.1 Artifacts to be Removed
The following files and systems are permanently decommissioned:
1. `Dockerfile` and `docker-compose.yml`.
2. `entrypoint.sh` and s6-overlay service definitions (`docker/s6-rc.d/*`).
3. Container-specific paths and workarounds (`/opt/data`, `/opt/balabot`).
4. Container process-table inspection scripts (`which-hermes.sh`, `s6-svstat` queries).
5. Xvfb / cua-driver Linux container display configs (`agent-computer-linux-vm.md`).

### 6.2 Path Migration
All state directory references are migrated from hardcoded container paths to OS-standard paths:

| Artifact | Legacy Path (Container) | Modern Path (Local Mode) | Modern Path (Cloudflare Mode) |
| :--- | :--- | :--- | :--- |
| **Continuity DB** | `/opt/data/sessions/continuity.db` | `~/.balabot/data/continuity.db` | Durable Object SQLite (`this.sql`) |
| **Memory Store** | `/opt/data/profiles/{bot}/memory_store.db` | `~/.balabot/data/memory/{bot}.db` | Durable Object SQLite (`this.sql`) |
| **Fleet Roster** | `/opt/data/fleet/bots.json` | `~/.balabot/data/fleet/bots.json` | Durable Object SQLite table `fleet_roster` |
| **OKF Ledger** | `/opt/data/governor/ledger/` | `~/.balabot/data/ledger/` (or git repo) | Cloudflare KV / DO SQLite + Git Sync |
| **Routines** | `/opt/data/routines/` | `~/.balabot/data/routines/` | Durable Object Alarms + Table |
| **Groups & Chats** | `/opt/data/groups/*.json` | `~/.balabot/data/groups/` (or SQLite) | Durable Object SQLite `pi_groups` |

### 6.3 Automated Data Migration ETL (`scripts/migrate_legacy_data.ts`)
To prevent data loss for existing users upgrading from legacy BalaBot containers, an automated migration ETL script runs during first launch:
1. **Sessions & Transcripts:** Extracts `sessions` and `messages` from `continuity.db`, mapping them to `pi_sessions` (populating `bot_id`, `purpose`) and `pi_messages` (preserving `thinking` and `tool_calls`).
2. **Inbox & Queues:** Extracts pending items from `queue.db` and `handoffs.db`, mapping them into `pi_inbox` with typed message kinds.
3. **Decisions:** Reads `approvals.db` and `continuity.db:decisions`, populating `session_decisions` and verifying OKF ledger consistency.
4. **Fleet & Groups:** Reads `fleet/bots.json` into `fleet_roster`, and imports JSON group definitions into `pi_orgs`, `pi_groups`, and `group_messages`.
5. **Memory Facts:** Copies existing SQLite holographic stores into the designated user app data directory.

---

## 7. Unified API Specification

The API adapter exposes the same endpoints for both Local and Cloudflare modes:

### 7.1 Core Endpoints
* `GET /healthz`: Health check returning `{ "status": "ok", "engine": "pi-durable", "mode": "local"|"cloudflare" }`.
* `GET /api/fleet`, `GET /api/bots`: Returns registered bots from the roster.
* `POST /api/chat`: Unified streaming chat endpoint (SSE or WebSocket) streaming:
  - `event: thinking` (chain-of-thought tokens)
  - `event: text` (content tokens)
  - `event: tool_call` / `event: tool_result`
  - `event: intervention` (paused turn requesting human input)
  - `event: openui` (OpenUI card payload)
  - `event: jev` (calibrated decision evaluation)
  - `event: jev_carrier` (system carrier frame handled cleanly without leaking raw XML into transcript)
* `GET /api/subagents`: Returns active child tasks from `pi_tasks`.
* `GET /api/memory`: Queries holographic memory for the active bot.
* `GET /api/governance`: Reads OKF decision ledger entries.
* `POST /api/intervention/{token}/resolve`: Resumes a paused turn.
* `GET/POST /api/bots/{id}/routines`: Manages scheduled background routines.
* `GET /api/org/current`, `GET /api/org/secrets`, `POST /api/org/secrets`: Preserves multi-tenant organization and W4 credential intake perimeter.
* `GET /api/org/skills/library`: Returns skill catalog with three-tier precedence (`Shipped` > `Brought` > `Learned`).
* `GET/POST /api/groups`, `POST /api/groups/{id}/broadcast`: Preserves group chat management and message broadcasting.

---

## 8. Implementation Waves & Roadmap

The migration is partitioned into 8 sequential waves:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      MIGRATION IMPLEMENTATION WAVES                    │
└────────────────────────────────────────────────────────────────────────┘

 [Wave 0]  ETL Migration & Test Suite Translation Harness
     │
     ▼
 [Wave 1]  Rust Desktop Shell Setup (Tauri v2 + WebView + SPA embedding)
     │
     ▼
 [Wave 2]  Pi Durable Core Engine & SQLite Schema (Local Runtime Spike)
     │
     ▼
 [Wave 3]  Jev System 1 Pipeline Port (Frustration, Decision Gate, Skills)
     │
     ▼
 [Wave 4]  Cloudflare Workers & Agent Pi (PiHarness on Durable Objects)
     │
     ▼
 [Wave 5]  Reverse RPC Local Tool Bridge (Cloudflare -> Local PC Ops)
     │
     ▼
 [Wave 6]  UI Integration & Verification (OpenUI, Thinking, Interventions)
     │
     ▼
 [Wave 7]  Docker Deprecation, Cleanup & Final KB Synchronization
```

### Wave 0: ETL Migration & Test Suite Translation Harness
- Develop `scripts/migrate_legacy_data.ts` to extract and transform existing `/opt/data/` stores into unified `pi_*` SQLite schema.
- Translate 527 legacy Python pytest test cases into native TypeScript/Rust integration tests (`vitest` / `cargo test`), establishing a non-negotiable verification harness before decommissioning Python modules.

### Wave 1: Rust Desktop Shell Setup
- Initialize Tauri v2 application in `src-tauri/`.
- Embed the built React SPA (`ui/dist`).
- Implement native window chrome, system tray, and mode switcher settings.
- Verify binary size (~120 MB package with embedded runtime) and RAM footprint (~150 MB).

### Wave 2: Pi Durable Core Engine & SQLite Persistence
- Integrate `@earendil-works/pi-durable` and `@earendil-works/pi-ai`.
- Implement unified SQLite schema (`pi_sessions`, `pi_messages`, `pi_tasks`, `pi_inbox`, `topic_spans`, `session_decisions`, `pi_orgs`, `pi_groups`).
- Verify atomic turn commits, context pruning, and crash recovery.

### Wave 3: Jev Continuity & Sensor Pipeline
- Port Jev client (`balabot/jev.py`) to TypeScript/Rust.
- Wire frustration keyword detector → Jev Noul evaluation.
- Wire decision gate and memory relevance re-ranking.
- Enforce fail-loud contract in cloud mode; provide local heuristic fallback (`JEV_MODE=heuristic`).

### Wave 4: Cloudflare Workers & Agent Pi (`PiHarness`)
- Scaffold Cloudflare Worker with `@cloudflare/agents`.
- Implement multi-tenant `BalaBotAgent` Durable Object with `PiHarness` partitioned by `${tenant_id}:${org_id}:${bot_id}`.
- Wire DO SQLite storage (`this.sql`) and Lifecycle alarms for task scheduling.
- Configure Workers AI and AI Gateway provider bindings.

### Wave 5: Reverse RPC Local Tool Bridge
- Implement WebSocket JSON-RPC protocol between Cloudflare Worker and Rust client with Ed25519 signing.
- Expose safe, parameter-validated actions (`local_exec`, `local_read`, `local_write`, `local_screen`).
- Enforce workspace directory jailing and "NEVER THE HOST" sandboxed virtual display / CDP automation.

### Wave 6: UI Integration & Verification
- Verify OpenUI card rendering (`HireAgentCard`, `ConfirmButtons`).
- Verify thinking stream disclosure toggle (`balabot.showThinking.v1`).
- Verify human intervention take-over flow.
- Fix carrier text leak in `ui/src/api.ts` `handleFrame`.
- Run complete 527-test translated test suite + E2E scenarios.

### Wave 7: Docker Deprecation & Final Cleanup
- Decommission `Dockerfile`, `docker-compose.yml`, and s6-overlay files.
- Update project documentation, README, and `docs/STATUS.md`.
- Synchronize Knowledge Base (`docs/kb/`) with ratified OKF notes.

---

## 9. Verification & Acceptance Criteria

Every wave must be verified against the strict BalaBot proof bar:

1. **Zero-Container Verification:** The application must install and run on a clean machine without Docker, Docker Desktop, or WSL2 installed.
2. **Crash Resilience Check:** Kill the desktop app process mid-turn while the model is emitting tokens or executing a tool. Reopening the app must automatically restore the conversation state and resume the task without corrupting SQLite or dropping turns.
3. **Jev Fail-Loud Test:** Unset `TYPESAFE_API_KEY` in cloud mode. The system must immediately surface an honest error banner in the UI and refuse silent degraded operation. In offline mode, the system clearly badges `Offline System 1`.
4. **Local/Remote Parity:** Switch between Local PC mode and Cloudflare Remote mode. The same chat session, persona roster, and UI cards must render identically with zero console errors.
5. **OpenUI Execution:** Emit a bot hire proposal in chat. The interactive `HireAgentCard` must render, accept user input, and upon confirmation, create the registered bot in the fleet roster.
6. **No Phantom Code:** Every module must have a verified production call site reachable from the UI or CLI.
7. **Regression Suite Proof:** All 527 translated integration tests pass cleanly with zero mocks of SQLite storage or business logic.

---

## 10. Security Perimeters & Invariants

The modernized architecture enforces five non-negotiable security invariants:

1. **The "NEVER THE HOST" Containment Law:** Agent computer automation operates exclusively inside isolated headless Chromium instances via Chrome DevTools Protocol (CDP) or off-screen virtual framebuffers. Direct OS input injection (`SendInput`, `CGEvent`, `uinput`) into the user's interactive desktop session is architecturally prohibited.
2. **W4 Secret Intake Perimeter:** Raw credentials and API tokens never traverse the chat transcript, model context window, thinking tokens, or SQLite message tables. Credentials are submitted via client-side direct POST into the native OS credential vault or encrypted Cloudflare Worker Secrets; only fingerprints and grant authorizations are exposed.
3. **Signed Reverse RPC Execution:** Local workstation tool calls originating from Cloudflare Agents are cryptographically signed with Ed25519 tokens, restricted to parameter-validated whitelisted commands, and strictly jailed to designated workspace directories. Raw unsanitized shell string execution is denied.
4. **Multi-Tenant Durable Object Partitioning:** Durable Object actor instances on Cloudflare are partitioned by `${tenant_id}:${org_id}:${bot_id}`, ensuring strict physical and cryptographic boundaries between organizational tenants and agent personas.
5. **Jev Boundary Integrity:** Jev fast probabilistic decisions run as an authenticated System 1 gating layer. Carrier signals are handled cleanly by protocol framing, preventing raw XML or heuristic leakage into user-visible transcript streams.
