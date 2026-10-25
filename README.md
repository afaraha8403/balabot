# BalaBot

**Autonomous multi-agent system powered by Pi Durable, Cloudflare Agents, and Native Rust.** MIT, open source. Zero Docker dependencies.

BalaBot operates with two agents ready on first boot — a **principal** that runs the system, and a **governor** that keeps the shared decision ledger. You talk to it; it grows.

```
USER              — most privilege. Owns the machine.
  └── PRINCIPAL   — runtime ops, system health, agent growth
        └── GOVERNOR    — the decision ledger (OKF) every agent reads
              └── PERSISTENT AGENTS   — the workers, user-facing
                    └── SUB-AGENTS    — temporary, one job, supervised by their parent
```

## Architecture: Zero Docker Law

BalaBot operates natively without Docker, containers, or WSL2 virtualization:
1. **Local Autonomous Mode (PC as Server & Client):** Native Rust desktop app (Tauri v2) hosting `@earendil-works/pi-durable` locally with zero-latency SQLite persistence in standard OS application directories (`~/.balabot/data/`).
2. **Cloudflare Remote Mode (Cloudflare Edge Server):** Multi-tenant agent compute running on Cloudflare Workers and Durable Objects (`PiHarness`) with co-located SQLite (`this.sql`). Local PC tasks are bridged via a cryptographically signed Reverse RPC tool bridge.
3. **The "NEVER THE HOST" Desktop Law:** Computer automation operates exclusively inside isolated headless Chromium via Chrome DevTools Protocol (CDP) or off-screen virtual framebuffers. Direct OS input injection into the user's host desktop session is strictly prohibited.

## ⚠️ Read this first: Jev is a hard dependency

BalaBot requires **Jev**, the System One model from **TypeSafe AI** — *not* Typeface AI. Jev returns typed decisions with calibrated probabilities, and BalaBot uses it as infrastructure: signal classification, memory relevance, and the decision gate into the ledger.

- **Cloud Mode (`JEV_MODE=cloud`):** Requires `TYPESAFE_API_KEY`. Fails loudly if key is missing or invalid.
- **Offline Mode (`JEV_MODE=heuristic`):** Offline deterministic heuristic fallback for airgapped local execution.

## Running It

### 1. Native Desktop Shell (Tauri v2)
```bash
npm run build     # compiles React UI assets into ui/dist
npm run tauri dev # launches native desktop application
```

### 2. Local Headless Server
```bash
npm run server    # starts Pi Durable server on 127.0.0.1:9119
```

### 3. Cloudflare Edge Worker
```bash
cd worker
npx wrangler deploy
```

### 4. Legacy Data Migration
```bash
npm run migrate   # extracts /opt/data legacy stores into unified SQLite schema
```

## Verification

Run the full automated test suite:
```bash
npm test          # runs UI vitest suite + core Pi Durable integration suite
```
- ✅ first boot provisions `principal` + `governor`: profile config, `SOUL.md`, per-persona workspace
  with its rules file, and skills installed under `skills/balabot/`
- ✅ the principal answers a real prompt through the provisioned profile

**Build on the official Hermes image, not a bare `python:slim`.** Debian trixie ships SQLite 3.46.1,
which carries the upstream WAL-reset corruption bug; Hermes' image compiles a patched SQLite (3.53.4,
FTS5 enabled). BalaBot's per-agent memory *is* SQLite, so the difference is a silent data-loss risk in
the one subsystem we depend on. The official image also supplies the s6 supervision tree — the principal
restarts agents, so supervision is load-bearing here, not decoration.


## What you get

- **One image, one container.** Hermes, the principal, the governor, memory and skills all inside. No
  sidecars, no second service.
- **Two agents from day one.** Provisioned on first boot, not after a setup ritual. No UI is required to
  get there — the config is the deliverable.
- **Per-agent memory.** Each agent gets its own local SQLite fact store (Holographic: FTS5 full-text
  search, entity resolution, trust scoring). Zero external dependencies.
- **A decision ledger in [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)**
  — the governor keeps decisions as plain, git-able, human-readable text. If it is not in the ledger, it
  did not happen.
- **Growth that is measured.** Frustration signals feed a routine improvement job; the frustration rate
  is the metric. The principal changes skills and can always say what it changed and how to undo it.

## Architecture

- [docs/architecture.md](docs/architecture.md) — agents, hierarchy, memory, signals, the Jev role
- [docs/session-continuity.md](docs/session-continuity.md) — one continuous thread without transcript rot
- [docs/model-selection.md](docs/model-selection.md) — provider/model selection and per-mode overrides
- [docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md) — the baked-in, dormant-by-default Cloudflare tunnel
- [TESTING.md](TESTING.md) — unit tests, the architecture simulations, **21 user-usage scenarios**, the mutation check that proves they can fail, and the Docker E2E harness

## Defaults

- **Provider:** OpenRouter
- **Model:** `deepseek/deepseek-v4.1-flash` (text and images)
- Per-mode overrides (vision, compression, curator, …) are configurable; see `docs/model-selection.md`.

## Licence

MIT — see [LICENSE](LICENSE).
