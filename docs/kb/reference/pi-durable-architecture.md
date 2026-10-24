---
type: reference
title: BalaBot — Pi Durable & Cloudflare client/server architecture
description: Technical architecture specification for the zero-Docker BalaBot platform powered by Pi Durable, Cloudflare Agent Pi (PiHarness), and a native Rust desktop client/server.
resource: ../../PRD-PI-DURABLE.md
tags: [balabot, architecture, pi-durable, cloudflare-agents, piharness, rust, tauri, jev, okf]
timestamp: 2026-10-23T22:30:00Z
status: stable
sources:
  - id: prd-pi-durable
    resource: ../../PRD-PI-DURABLE.md
    title: BalaBot Modernization PRD
  - id: pi-dev
    resource: https://pi.dev/
    title: Pi Agent Harness
  - id: cf-agents
    resource: https://developers.cloudflare.com/agents/
    title: Cloudflare Agents SDK
---

# BalaBot — Pi Durable & Cloudflare Client/Server Architecture

> **REFERENCE SPECIFICATION:** Defines the dual-mode Client/Server architecture of BalaBot after replacing the containerized Hermes gateway with **Pi Durable** and **Cloudflare Agent Pi** (`PiHarness`)[^cf-agents]. Docker is permanently retired[^prd-pi-durable].

## 1. System Topology Overview

BalaBot operates under a unified Client/Server topology using a single native Rust desktop application (built with Tauri v2). The system supports two operational modes:

| Dimension | Mode 1: Local Autonomous Mode | Mode 2: Cloudflare Remote Mode |
| :--- | :--- | :--- |
| **Server Host** | Local PC (`127.0.0.1:9119` via embedded Pi engine) | Cloudflare Edge Worker + Durable Objects |
| **Client** | Native Rust Desktop Shell (Tauri v2 + WebView) | Native Rust Desktop Shell (Tauri v2 + WebView) |
| **Agent Engine** | `@earendil-works/pi-durable` running locally | `PiHarness` (`agents/harness/pi`) inside Durable Objects |
| **Persistence** | OS User App Data SQLite (`~/.balabot/data/`) | Co-located Durable Object SQLite (`this.sql`) |
| **Scheduling** | Local in-memory timer / background worker | Durable Object Lifecycle Alarms (`setAlarm()`) |
| **Local Tool Execution** | Quarantined Sandbox (CDP / Virtual Jail - NEVER THE HOST) | Signed & Jailed WebSocket Reverse RPC Bridge |
| **Docker Requirement** | **None** | **None** |

## 2. Core Primitives

### 2.1 Pi Durable Harness
Pi Durable (`@earendil-works/pi-durable`)[^pi-dev] replaces the Hermes gateway:
- **Pre-execution Journaling:** State is committed to SQLite before calling the model or dispatching tools, guaranteeing zero data loss during mid-turn crashes.
- **Model Agnosticism:** Uses `@earendil-works/pi-ai`, normalizing request schemas and streaming thinking deltas across Workers AI, OpenRouter, Anthropic, Gemini, and DeepSeek.
- **Structured Task Trees:** Sub-agents are managed as child tasks within a task DAG rather than heavy operating system subprocesses.
- **Context Pruning & Compaction:** Context window is projected on-demand for LLM inference; historical turns remain in SQLite for auditing and human scrolling.

### 2.2 Cloudflare Agent Pi (`PiHarness`)
In Cloudflare Remote Mode:
- Each persistent agent runs inside a dedicated Durable Object isolate extending `Agent`, partitioned by composite key `${tenant_id}:${org_id}:${bot_id}` to guarantee multi-tenant cryptographic isolation.
- `PiHarness` delegates SQLite storage to `this.sql` using isolated tables (`pi_sessions`, `pi_messages`, `pi_tasks`, `pi_inbox`, `topic_spans`, `session_decisions`, `pi_orgs`, `pi_groups`, `group_messages`).
- Lifecycle alarms wake sleeping or evicted agents when tasks or inboxes require attention.

### 2.3 The Hardened Reverse RPC Local Tool Bridge
When running on Cloudflare, agents needing to interact with the user's local workstation route requests through the **Hardened Reverse RPC Bridge**:
1. Cloudflare Agent issues tool call `local_exec(action, executable, args, cwd)`.
2. Request is signed with an Ed25519 lease token and serialized over the active client WebSocket as a JSON-RPC message.
3. Rust desktop client verifies signature validity, validates parameters against allow-lists, evaluates workspace directory bounds, and executes natively within the sandbox.
4. Synthetic OS mouse/keyboard events (`SendInput`, `CGEvent`) into the user's live desktop session are strictly denied ("NEVER THE HOST").

## 3. Preserved Capabilities Matrix

Every core pillar of BalaBot remains active with zero functional loss:

1. **User Interface (`ui/src/`):** React SPA runs identically in the desktop WebView or web browser. Bot Roster, Command Palette (`Cmd/Ctrl+K`), editable Draft Cards, Voice Memo player, Routines, and Message Hover Metadata are 100% preserved.
2. **Four-Tier Hierarchy:** User > Principal Bot > Governor > Persistent Agents > Sub-agents.
3. **Multi-Tenant Orgs & Group Broadcasts:** Preserves `/api/org/*` workspace partitioning and `/api/groups/*` multi-bot broadcast communication.
4. **W4 Secret Store HTTP Perimeter:** Direct client-side POST ingestion of credentials; raw values never leak into transcripts, model prompts, or thinking streams.
5. **Jev (TypeSafe AI):** System 1 calibrated probabilistic decisions (`POST https://api.typesafe.ai/v1/systemone`) remain a hard dependency for:
   - Turn-time user frustration detection.
   - Decision gating into the OKF ledger.
   - Holographic memory relevance re-ranking.
   - Skill routing.
   - Operates with fail-loud contract in cloud mode; supports deterministic heuristic mode (`JEV_MODE=heuristic`) when running offline.
6. **Skill Precedence & Curator:** Strict resolution (`Shipped` > `Brought` > `Learned`) with Governor curation review for newly proposed tools.
7. **OKF Decision Ledger:** Human-readable Open Knowledge Format v0.2 markdown files remain the authoritative record of binding decisions.
8. **OpenUI Generative UI:** Interactive confirmation cards (`HireAgentCard`, `Card`, etc.) emitted within ````openui-lang```` fences render seamlessly.
9. **Reasoning Stream Visibility:** Model `thinking` deltas stream to a collapsible disclosure widget gated by `balabot.showThinking.v1`, persisted in SQLite.
10. **Human Intervention Flow:** Pauses turn execution, renders `InterventionCard.tsx`, and resumes upon human completion.

[^prd-pi-durable]: [Product Requirements Document (PRD): BalaBot Modernization](../../PRD-PI-DURABLE.md)
[^cf-agents]: [Cloudflare Agents Documentation](https://developers.cloudflare.com/agents/)
[^pi-dev]: [Pi Minimal Extensible Agent Harness](https://pi.dev/)
