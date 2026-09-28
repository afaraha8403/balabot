---
type: reference
title: BalaBot — principal & governor provisioned
description: The two out-of-the-box BalaBot personas exist on the host as verified Hermes profiles — roles, configuration, verification evidence, and what still blocks the gateway.
tags: [balabot, principal, governor, personas, provisioning, memory, holographic, skills]
timestamp: 2026-09-27
---

# BalaBot — principal & governor provisioned

Provisioned 2026-09-26 on the host as the dev/edge configuration. In the shipped product these two
are baked into the single Docker image; here they exist as Hermes profiles so they can be built and
verified before packaging.

| | **principal** | **governor** |
|---|---|---|
| Profile | `~/AppData/Local/hermes/profiles/principal/` | `.../profiles/governor/` |
| Workspace | `C:/Users/ali/workspace/principal/` | `C:/Users/ali/workspace/governor/` |
| Model | `deepseek/deepseek-v4.1-flash` via openrouter | same |
| Memory | holographic (own SQLite store) | holographic (own store) |
| Skills | 68 in the container (10 BalaBot-shipped) | 9 (all BalaBot-shipped) |
| Telegram | **empty — token not issued** | **empty — token not issued** |

### The skills row, corrected (2026-09-27)

The earlier line read *"scoped set (56 pruned)"* / *"(55 pruned)"* — ambiguous (56 **removed** or 56
**remaining**?) and wrong either way. Measured inside the running container:

- **principal: 68 skills**, of which **10 are BalaBot-shipped** (`skills/balabot/*`).
- **governor: 9 skills, all 10-minus-`opaque-request-triage` BalaBot-shipped.** It previously held
  **one** (`jev-signals`), which is what made the two personas look lopsided.

The mechanism: `balabot/bootstrap.py::install_skills()` copies the repo's `skills/` into **every**
persona under `skills/balabot/<skill>/`, so `skills/` is the shared baseline for the whole fleet.
It held a single skill. Eight more are now authored there, each traceable to a documented role
requirement and kept deliberately **thin** (`docs/architecture.md` → "The thin skill": a skill that
"loads for everyone … earns its place in the prompt by being short and trigger-shaped, not by
lecturing"):

| Persona | Skills added |
|---|---|
| principal | `agent-liveness-recovery`, `agent-growth-review`, `owner-onboarding` |
| governor | `okf-decision-ledger`, `contradiction-audit`, `untrusted-ingestion` |
| shared | `workspace-law`, `delegation-discipline` |

**The Skill Library screen was empty for a different reason, and both had to be fixed.** It read
`/api/org/skills/library`, which answers `{"available": false}` by design — the org layer was never
wired in this build — so the screen could not display anything regardless of what the agents
carried. It now reads a real `/api/skills/library?bot=<profile>` that walks the profile's own tree
inside the container.

## Roles as written

**Principal** — the system operator and first agent. Runtime ops, system health, **agent growth and
leadership**, onboarding. May change anything system-wide. **No secret or grant authority.** Fail loud,
never mask; never let System 1 make an irreversible call; every change logged and reversible.

**Governor** — keeper of the shared **decision ledger** in OKF. Records decisions and data points
readable by persistent agents *and* sub-agents, feeds the Principal's growth loop, flags
contradictions. An **authoritative record** — but never overrules the user.

## Verification (real, not asserted)

- **principal**: fact written and read back — `fact_id 1`, status `added`, tags
  `balabot, principal, verification`, created `2026-09-26 18:44:14`; search for `principal` returned
  exactly one hit (trust 0.5, score 0.30) from a previously empty store.
- **governor**: rules loaded and quoted back verbatim (the Jev line, the secrets line); memory
  round-trip confirmed `fact_id 1`.
- **Governor showed the designed judgment unprompted**: it flagged that the fact had gone into the
  holographic store *rather than* the OKF decision ledger, and observed that a session start **is not
  itself a decision reached with the user**. That is the SOUL rule "admit decisions, not transcripts"
  and the provenance discipline operating in practice.

## The trap that cost a build cycle

**`.hermes.md` is discovered by walking UP from the runtime context cwd (`TERMINAL_CWD`) — it is NOT
read from `HERMES_HOME`.** A rules file placed at the profile root is **silently ignored**; the walk
found `C:\Users\ali\.hermes.md` instead (Susan's rules), which would have given the Principal the wrong
operating law. Fix, applied to both personas:

1. Each persona gets its own workspace dir.
2. `terminal.cwd` is set to that workspace in its `config.yaml`.
3. `.hermes.md` lives **in that workspace**, where the upward walk finds it first.

Verified by replicating the walk. **Any future BalaBot persona must be provisioned this way** — the
profile-root placement in the older bring-up notes is wrong for this install.

**Second trap:** `hermes -p <name> chat -q` does **not** load the profile's `.env`. Without
`export HERMES_HOME=<install>/profiles/<name>` the smoke test fails with "No inference provider
configured" — which is what silently killed an earlier verification attempt.

## Memory determination

**Holographic** — chosen because it is the only bundled provider that satisfies the single-container
requirement: SQLite is stdlib, FTS5 verified working (**3.53.4** — confirmed inside the shipped base
image, Debian trixie), numpy present for HRR, no
`requirements.txt`, no service, no account. ByteRover needs a CLI binary, Honcho needs a key *or a
self-hosted instance* (a second container), RetainDB is paid cloud, and Mem0/Supermemory/Hindsight/
OpenViking are API-backed. It is also already the provider on the owner's default profile, and Hermes
scopes memory per profile — so per-agent isolation comes free. (`plugins/memory/` is closed: those 8
providers are the permanent set.)

## Still blocked

1. **Jev API key** — nowhere on this system. Jev is a **hard dependency**, so the relevance pipeline
   cannot go live without it. Needed: the TypeSafe key, supplied through the secret flow.
2. **Telegram bot tokens** — must be issued per persona via BotFather (never cloned from a sibling —
   two gateways on one token race every message). Until then: no gateway, no watchdog, no
   manage-script wiring.
