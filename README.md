# BalaBot

**A multi-agent system in a single container.** MIT, open source, based on [Grok Bot](https://github.com/xai-org/grok).

BalaBot ships with Hermes inside the image and two agents ready on first boot — a **principal** that runs
the system, and a **governor** that keeps the shared decision ledger. You talk to it; it grows.

```
USER              — most privilege. Owns the machine.
  └── PRINCIPAL   — runtime ops, system health, agent growth
        └── GOVERNOR    — the decision ledger (OKF) every agent reads
              └── PERSISTENT AGENTS   — the workers, user-facing
                    └── SUB-AGENTS    — temporary, one job, supervised by their parent
```

## ⚠️ Read this first: Jev is a hard dependency

BalaBot requires **Jev**, the System One model from **TypeSafe AI** — *not* Typeface AI. Jev returns typed
decisions with calibrated probabilities, and BalaBot uses it as infrastructure: signal classification,
memory relevance, the decision gate into the ledger.

**This is a hard dependency, by design. There is no fallback provider.** An MIT repo with a mandatory
third-party hosted API is a real dependency, not a footnote — so it is stated on line one rather than
discovered at first run.

```bash
git clone https://github.com/afaraha8403/balabot
cd balabot
cp .env.example .env      # add TYPESAFE_API_KEY and OPENROUTER_API_KEY
docker compose up --build
```

The container **validates the Jev key at startup and fails loudly** if it is missing or rejected. It will
not degrade quietly into different behaviour — no masking an error with a guess.

## Running it

```bash
docker compose up --build        # attaches a TTY -> you land in the principal agent
docker compose run --rm balabot  # one-shot interactive session
```

The inherited default command is Hermes' **interactive CLI**, so it needs a terminal — that is why the
Compose service sets `tty`/`stdin_open`. Run it detached with no TTY and it will provision correctly and
then exit cleanly (that is Hermes' own behaviour, not a failure).

**For unattended operation**, configure a messaging platform and run the gateway instead:

```bash
# 1. issue a bot token per persona (never share one — two pollers race)
# 2. set telegram.bot_token in the persona's config, then:
docker compose run --rm balabot gateway run
```

## Verified

Built, provisioned and driven end to end on Docker 29.2.1 (Linux containers):

- ✅ image builds — `FROM nousresearch/hermes-agent:v2026.9.24`
- ✅ **no Jev key → exits 1** with a loud message, no silent degradation
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
