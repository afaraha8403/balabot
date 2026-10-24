---
type: product
title: BalaBot
description: Autonomous, multi-agent AI workspace with four-tier hierarchy, zero Docker footprint, native Rust desktop client/server, and Cloudflare edge hosting.
tags: [balabot, product, ai-agents, zero-docker, pi-durable, rust, cloudflare-agents]
timestamp: 2026-10-23T23:30:00Z
status: stable
sources:
  - id: prd-pi-durable
    resource: ../../PRD-PI-DURABLE.md
    title: BalaBot Modernization PRD
  - id: architecture
    resource: ../reference/pi-durable-architecture.md
    title: Pi Durable Architecture Reference
---

# BalaBot

BalaBot is an MIT-licensed, open-source multi-agent autonomous system built on a four-tier organizational hierarchy.[^prd-pi-durable] It operates with zero Docker container virtualization, shipping as a native Rust desktop client/server app with optional serverless edge hosting on Cloudflare Workers and Durable Objects.

## 1. What It Is

BalaBot models an autonomous AI workforce:
* **User:** Highest authority; reviews, directs, approves, and owns all keys and machines.
* **Principal Bot:** System operator, health watchdog, and agent growth reviewer.
* **Governor Bot:** Authoritative keeper of the shared Open Knowledge Format (OKF v0.2) decision ledger.
* **Persistent Agents:** Domain-focused teammates with durable state and individual routines (e.g. `scout`).
* **Sub-Agents:** Ephemeral child tasks executed in isolated context windows within the Pi task DAG.

## 2. Core Architecture Topology

Operates in a unified Client/Server configuration across two modes:[^architecture]
1. **Local Autonomous Mode (PC as Server & Client):** Single native Rust application (Tauri v2, ~120 MB package, ~150 MB active RAM) hosting an embedded `@earendil-works/pi-durable` engine and local SQLite (`~/.balabot/data/`). Zero cloud requirement and zero Docker dependencies.
2. **Cloudflare Remote Mode (Cloudflare Edge Server):** Serverless deployment on Cloudflare Workers utilizing Cloudflare Agents SDK and `PiHarness` inside Durable Objects. Workstation file and execution tools route through a cryptographically signed Reverse RPC bridge.

## 3. Key Differentiators & Invariants

* **"NEVER THE HOST" Desktop Law:** Computer automation executes exclusively inside isolated headless Chromium via Chrome DevTools Protocol (CDP) or off-screen virtual framebuffers within strict workspace directory boundaries. Synthetic mouse or keyboard injection into the host OS desktop is strictly prohibited.
* **Jev System 1 Intelligence:** Hard infrastructure dependency providing calibrated fast probabilistic decisions (frustration detection, decision gating, memory relevance re-ranking, and skill selection). Fails loud in cloud mode; supports offline deterministic heuristics (`JEV_MODE=heuristic`) in local autonomous mode.
* **W4 Secret Intake Perimeter:** Raw credentials and tokens never appear in chat transcripts, model context, or thinking tokens. Ingestion occurs via direct client-side POST to local OS credential vaults or encrypted Cloudflare secrets.
* **OKF Decision Ledger:** Authoritative binding decisions are committed to human-readable, git-diffable Open Knowledge Format markdown documents.
* **Holographic SQLite Memory:** Persistent per-agent recall combining FTS5 full-text indexing, HRR compositional algebra, and trust scoring.

## 4. Licensing & Distribution

* **License:** MIT License.
* **Source Repository:** `https://github.com/afaraha8403/balabot`
* **Distribution:** Precompiled native installers for Windows, macOS, and Linux (Tauri v2).

[^prd-pi-durable]: [Product Requirements Document (PRD): BalaBot Modernization](../../PRD-PI-DURABLE.md)
[^architecture]: [Pi Durable & Cloudflare Client/Server Architecture](../reference/pi-durable-architecture.md)
