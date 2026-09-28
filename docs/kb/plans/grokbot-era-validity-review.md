---
type: decision-sheet
title: BalaBot — GrokBot-era validity review
description: The 34 GrokBot-era claims from the vault, each with a keep/cap/defer/cut recommendation, for Ali's ruling. Companion to the gap ledger.
resource: C:/Users/ali/workspace/balabot
tags: [balabot, decisions, grokbot-era, scope, review]
timestamp: 2026-09-27T02:50:00Z
---

# BalaBot — GrokBot-era validity review

The vault's GrokBot-era material predates BalaBot. My first pass cut all of it; **that was wrong** —
Ali's correction: the product *is* supposed to ship a computer, so the agent-computer is core, not
legacy. This sheet re-examines every GrokBot-era claim so we can rule on it together.

> **SCOPE RULED BY ALI (2026-09-27): everything is IN SCOPE.** Multi-org, multi-agent group chat,
> the frustration-driven growth loop, and the whole Jev thread (J-E-V, TypeSafe AI) including signals.
> The KEEP/CAP/DEFER/CUT framing below is retained as the *reasoning*, not as a gate: DEFER and CUT
> items are now approved work unless individually contradicted by a later decision.

**Recommendation key**

- **KEEP** — valid for BalaBot as written; build it.
- **CAP** — keep the primitive, drop the GrokBot-specific shape (the "keep but cap" rule).
- **DEFER** — real, but rides on a bigger decision (org layer / multi-agent chat / growth loop).
- **CUT** — genuinely GrokBot-only; no BalaBot equivalent.

## KEEP — build these



| Claim | Status | Effort |
|---|---|---|
| Agent spawns sourced from /opt/data/spawn-ledger.json | missing | M |
| Editable draft cards (Send email / Send message / Discard) with human approval before send | missing | - |
| Agent Computer: one Linux container with per-agent Xvfb displays (:1 steve, :2 jim, :3 oscar), per-agent cua-driver daemons, /work | missing | L |
| Bot Mode groups (2-6 bots, serial rounds, @-mentions) and shared Agent Computer pane | missing | L |
| Per-org computer spaces: container agent-computer-<org>, fleet/<org>.json manifest, org 'balacode' generalising today's build | missing | L |
| Repo's architecture mapping table: 'Agent's own screen — org-scoped agent computer — shipped' | contradicted | M |

## CAP — keep the primitive, drop the shape



| Claim | Status | Effort |
|---|---|---|
| Jev re-ranker slots into providers' background non-blocking prefetch path before each turn, respecting byte-stable-prefix prompt c | missing | M |
| Skill selection at turn time via Jev cookbook (60-char description truncation, 16.8%→7.3%, 9.8%→4.0%, two requests/turn, gate thre | missing | S |
| Skill-relevance suggestion ships as one extra system prompt line (<skill_relevance>...) preserving roster prefix caching | missing | S |
| Open question: rebrand surface area — repo name, bot.balacode.xyz, grokbot-web, docs; open-sourcing needs no-secrets, LICENSE, sta | partial | M |
| Voice chat when the composer is empty | missing | - |
| `/` references a saved skill; `@` mentions a Bot/group/routine/connector | missing | - |
| Routines per Bot (create routine from the chat/panel) | partial | - |
| Model & provider selection UI (ModelSettingsDialog): main model + per-mode overrides, defaults OpenRouter + deepseek/deepseek-v4.1 | missing | - |
| Model & provider selection UI: GET/PUT /api/org/models + GET /api/providers/<p>/models and a ModelSettingsDialog.tsx | missing | L |
| P0 fleet separation DONE: /api/bots returns exactly the grokbot fleet flagged fleet: grokbot; /api/fleet lists personal agents as  | contradicted | M |
| Skill-selection integration (TypeSafe cookbook, 2 requests per turn, roster untouched) honoured | missing | M |
| Per-mode overrides list (14 aux tasks incl. vision, delegation via top-level delegation.*) surfaced dynamically | missing | - |

## DEFER — needs a scope decision from Ali

These are the three real forks: the org/multi-tenant layer, multi-agent group chat, and the frustration-driven growth loop.

| Claim | Status | Effort |
|---|---|---|
| Frustration pipeline layer 1: local keyword dictionary, high-recall, multi-lingual, runs on every message | missing | M |
| Group chats: New → select 2–6 Bots → describe shared outcome | missing | - |
| Search spans Messages, Bots, Group Chats, Files, Routines | partial | - |
| Org endpoints /api/orgs, /api/org/secrets, /api/org/grants exist for the org surface | partial | - |
| P3 Groups: GET/POST /api/groups, POST /api/groups/{id}/chat with 2-6 bots and per-round {botId} frames | missing | L |
| An organization is the tenant owning context, skills, secrets, computer spaces and members; cross-org access is a first-class revo | missing | L |
| Frustration pipeline (keyword dictionary -> Jev -> governor ledger -> principal growth job) and frustration-rate-as-metric | missing | L |
| Frustration dictionary caution: markers not neutral discourse ('Anyways' is a filler) | missing | S |
| Skill precedence for a bot: bot-own > org grant (specific bots) > org grant (all bots) > global/built-in; promotion is always a hu | missing | L |

## CUT — GrokBot-only



| Claim | Status | Effort |
|---|---|---|
| Reply-in-thread and reactions | missing | - |
| Keyboard-first: Cmd/Ctrl+K palette, Cmd/Ctrl+N new, Cmd/Ctrl+1..9 jump, etc. | missing | - |
| Connectors / Marketplace (installed account-wide, preferred over browser) | missing | - |
| Roster is Steve/Jim/Oscar (Chief of Staff / Launch / Research) reachable through the UI | contradicted | - |
| Web surface proxies each turn as SSE to per-bot Hermes API servers on steve:9121, jim:9122, oscar:9123 | contradicted | - |
| Auth: unauthenticated `/` → `302 /login`; login page; `login → {"ok":true}` | contradicted | - |

## Correction to the first pass

- **Agent Computer is KEEP, not superseded.** My earlier binning swept it in with the GrokBot roster by
  association. The container shape (`:1/:2/:3` per-agent displays) is GrokBot-specific, but the
  *capability* — a bot with its own screen you can watch and drive — is core BalaBot. Cap the naming to
  principal/governor, keep the capability.
- The "unaudited" claim that `.env` leaks a key stands refuted: `.env` is not git-tracked and is excluded
  by `.gitignore` and `.dockerignore`.
