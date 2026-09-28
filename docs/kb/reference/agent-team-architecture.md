---
type: reference
title: Agent Team Architecture — Hermes vs Grok Bot (feature parity)
description: Grounded answers to the bot-team architecture questions Ali raised — agent-created agents, containment, bot-to-bot messaging, groups, hierarchy, person files, skill scoping, and secrets handling — with a corrected Grok Bot baseline.
tags: [grokbot, bot-mode, architecture, parity, profiles, secrets, delegation]
timestamp: 2026-09-26T20:05:00Z
status: active
---

# Agent Team Architecture — Hermes vs Grok Bot

Grounded in the local install (`~/AppData/Local/hermes/`) and the Hermes source tree. Every claim
below traces to a file that was read, not to inference. Supersedes the parity claim in
`workspace/susan/research/hermes-grokbot-parity/FINDINGS.md` that Grok Bot gives each bot its own
cloud VM — **it does not** (see Corrections).

## 1. The straight answers

| Question | Answer | Mechanism |
|---|---|---|
| Can an agent create other agents? | **Yes — both kinds.** | Ephemeral: `delegate_task` spawns in-process children. Persistent: an agent can run `hermes profile create --clone` itself via its terminal tool. |
| Are they contained? | **Yes — two layers.** | Subagents: fresh conversation, own task_id/terminal session, cannot see the parent's history; parent sees only the summary. Profiles: independent islands — own config, `.env`, memory, sessions, skills, cron, gateway state. |
| Do they have computer use? | **Yes, and it is real GUI control — but not for the web bots today.** | `computer_use` tool (MCP → cua-driver): accessibility-tree capture, click/type/drag/scroll, synthesized input that does **not** steal the user's cursor or focus. Excluded from the `hermes-api-server` toolset, so `bot.balacode.xyz` bots cannot drive it yet. |
| Can they use a CLI? | **Yes — full terminal.** | `terminal` + `process_manage` + `execute_code`, with backends: local, docker, ssh, modal, daytona, singularity, vercel_sandbox. |
| Can they talk to each other? | **Yes — a real implementation.** | `message_agent` (`tools/bot_mode_dm.py`), injected **only** into a bot's canonical Bot Chat session. Local transport delivers into the target profile's own Bot Chat; cross-machine via `hermes peer dm` (the peer's api_server is the transport) + `bot_relay` file plumbing. Fire-and-forget, 16k char cap. |
| Can I put them in channels/groups? | **Groups yes; channels no.** | Bot Mode groups: 2–6 bots, up to 3 serial rounds per send, `@`-mentions, each member keeps its own `Group: <name>` session, mirrored across gateways. **No** Buzz-style channel primitive, no `/api/groups`. |
| Can I establish a hierarchy? | **No formal hierarchy.** | Depth tracking (parent/child lineage, `delegation.max_spawn_depth`) is a spawning mechanic, not reporting lines. Kanban adds role-based routing. Bot Mode "sections" are display folders. Everything else is prompt-level/advisory. |
| Can I edit their soul files / AGENTS.md? | **Yes — plain markdown.** | Per profile: `SOUL.md` (identity + operating rules), `profile.yaml` (`description`, `ui_meta` title/avatar/color), `memories/MEMORY.md` + `USER.md`, optional `.hermes.md`/`AGENTS.md`. |
| Install skills globally or per bot? | **Both.** | Global = the default profile's `skills/`. Per bot = `hermes -p jim skills install …` writes into that profile's `skills/`. Project dirs (`<root>/.hermes/skills`) take **higher** precedence and shadow by name. |
| Env vars & secret keys — is there a store? | **Layers exist; no store UI.** | Per-profile `.env` + global `.env` + OS env + `~/.secrets/`. A real vault abstraction is opt-in via `secrets.sources` (Bitwarden, 1Password, generic command helper) with `secrets.profile_alias` (`FOO_<PROFILE>` → `FOO`). |

## 2. Parity verdict vs Grok Bot

**Where we are ahead of Grok Bot (verified):**

- **Per-bot isolation.** Grok Bot: one shared computer per *account*; the docs state plainly that
  per-bot screens "are separate work surfaces, **not separate security boundaries**", and that all
  bots share browser cookies, files, and CLI credentials. We give each bot its own profile, `.env`,
  memory, sessions and skills — genuinely separate.
- **Per-bot skills/connectors.** Grok Bot installs skills and connectors **account-wide** ("one
  library shared by all your Bots"). Ours are per-profile installable.
- **Per-bot model.** Grok Bot documents no per-bot model picker; each of our bots carries its own
  `model.default`/`model.provider`.
- **A real CLI and real secrets vault backends.** Grok Bot's credentials live shared on the computer.

**Where we are behind (the honest list):**

1. **The shared Agent Computer pane.** Grok Bot's differentiator: one visual cloud desktop every bot
   gets a screen on, watchable and take-over-able from the conversation — and from mobile. We have
   the *capability* (`computer_use`) but no shared surface a human can watch, and it is disabled for
   the API-server toolset the web bots run under.
2. **Bot-created bots with consent.** Grok Bot: an existing Bot can propose and create a new Bot,
   you approve. Ours requires the human/agent to run profile CLI — there is no in-UI spawn flow.
3. **Async handoff visible in the transcript.** Grok Bot shows the handoff in the conversation. Our
   web UI does not surface `message_agent` deliveries yet (the primitive works; the UI events are not emitted).
4. **No formal hierarchy in either system** — equal footing here; orchestrator patterns are
   user-built in both.

## 3. The "store" question — recommended design

Today: plaintext `.env` per profile, duplicated across bots, no UI, no encryption at rest. Two
problems: rotation means editing N files, and a leaked profile dir leaks its keys.

Recommended shape, in order of effort:

1. **Adopt `secrets.sources` with one source of truth** — put keys in Bitwarden (or `pass`/keepassxc
   via the command helper), set `secrets.sources` once, and let every profile hydrate from it.
   `secrets.profile_alias` gives per-bot values from a single store: one `OPENROUTER_API_KEY` entry
   → `OPENROUTER_API_KEY_JIM` for Jim's differently-scoped key.
2. **Keep `~/.secrets/` for machine-level credentials** that never belong in a bot (fal admin key,
   API-server key). Never inside `workspace/`.
3. **Never paste raw keys at an agent without intake** — use the `credential-intake` skill so the
   value is written to the right store and masked in every echo.

## 4. Corrections to prior research

- **WRONG (now corrected):** "Grok Bot gives each bot its own cloud VM." Reality: one shared computer
  per account, per-bot screens, explicitly not a security boundary. Our per-profile model is *more*
  isolated, not less.
- **Correction:** hierarchy/orchestration is not an xAI product feature — user-built patterns.
- **Correction:** Grok Bot skills/connectors are account-wide, not per-bot.

# Citations

[1] `~/AppData/Local/hermes/hermes-agent/tools/bot_mode_dm.py` — `message_agent`, bot-to-bot DM
[2] `~/AppData/Local/hermes/hermes-agent/tools/bot_relay.py`, `hermes_cli/subcommands/peer.py` — cross-gateway relay + peer DM
[3] `~/AppData/Local/hermes/hermes-agent/tools/delegate_tool.py`, `delegate_tool_config.py` — subagents, depth, containment
[4] `~/AppData/Local/hermes/hermes-agent/hermes_cli/profiles.py` — profile islands, `--clone` file set
[5] `~/AppData/Local/hermes/hermes-agent/toolsets.py` — toolset definitions; `computer_use` excluded from api-server
[6] `~/AppData/Local/hermes/hermes-agent/website/docs/user-guide/bot-mode.md` — groups, Routines, roster
[7] `~/AppData/Local/hermes/hermes-agent/website/docs/user-guide/secrets/index.md` — vault sources, precedence, `profile_alias`
[8] `~/AppData/Local/hermes/hermes-agent/agent/skill_utils.py`, `hermes_cli/skills_hub.py` — skill scoping and install target
[9] `~/workspace/susan/research/grokbot-product-study/` — captured xAI docs (bots, computer-and-apps, chat-and-collaboration, mobile)
