---
type: playbook
title: GrokBot Feature Build Plan — dedicated fleet, Agent Computer, visible handoffs
description: Phased build plan to close the Grok Bot parity gaps on our own surface: a GrokBot-only agent fleet (never the personal Hermes agents), the shared Agent Computer pane, visible bot-to-bot handoffs, groups, bot creation with consent, and a real secrets store.
tags: [grokbot, plan, build, parity, astryx, computer-use, secrets]
timestamp: 2026-09-26T20:40:00Z
status: active
---

# GrokBot Feature Build Plan

**Standing rule (Ali, 2026-09-26):** GrokBot's agents are its **own dedicated fleet**. The personal
Hermes agents — Susan/default, William, Jimmy, Oraya, Bookkeeper, Clippy — are **never** part of
GrokBot and must be structurally unreachable from the GrokBot surface. GrokBot agents carry their
own `fleet: grokbot` marker.

## Baseline (measured, not assumed)

- Fleet today: `steve` (Chief of Staff), `jim` (Launch), `oscar` (Research) — three dedicated
  profiles, already separate from the personal set.
- `computer_use` is present on steve's **CLI** toolset but **excluded from the api-server toolset** —
  which is what the web surface runs on. cua-driver status unverified (`hermes computer-use status`).
- Bot-to-bot works (`message_agent`) but is invisible in the web transcript.
- No groups UI, no bot-creation UI, no secrets store UI; keys are plaintext per-profile `.env`.

## Frozen API contracts (all waves build against these)

```
GET  /api/bots                 -> {bots:[{id,name,title,icon,color,description,fleet,profile,order}]}
GET  /api/fleet                -> {fleet:"grokbot", agents:[...], excluded:[<personal profile names>]}
POST /api/chat                 -> SSE; frames: choices[].delta.content | event:token|final|done|error
                                  NEW: event:handoff  data:{from,to,summary,at}
POST /api/chat                 -> 404 when bot_id is not a GrokBot-fleet agent

GET  /api/computer/{botId}/frame  -> {ok,b64,capturedAt,width,height,state:ready|no-driver|error,note}
POST /api/computer/{botId}/action -> {action:click|doubleClick|rightClick|type|key|scroll,
                                      x?,y?,text?,key?,amount?} -> {ok,effect,escalation}

GET  /api/groups                  -> {groups:[{id,name,botIds,createdAt}]}
POST /api/groups                  -> {name,botIds} (2..6) -> {group}
POST /api/groups/{id}/chat        -> SSE, per-round frames carry {botId}
POST /api/bots                    -> {name,title,description,icon,cloneFrom?,approve:true}
```

## Phases

| # | Phase | Owner | Acceptance |
|---|---|---|---|
| P0 | ✅ **Fleet separation** — DONE 2026-09-26 | backend | `/api/bots` returns exactly the GrokBot fleet, each flagged `fleet: grokbot`; `/api/fleet` lists personal agents as excluded; william / jimmy / oraya / bookkeeper / default each return **404** on `/api/chat` — all verified |
| P1 | ✅ **Agent Computer pane** — DONE 2026-09-26 | infra + UI | cua-driver 0.29.1 installed + daemon running; `/api/computer/{bot}/frame` returns a real 1920×1080 PNG; the Astryx pane renders it live with type/key/scroll take-over; `/action` wired and refuses unknown actions cleanly |
| P2 | ✅ **Visible handoffs** — backend + UI emit/render `event: handoff` | backend + UI | steve→jim handoff frame emitted on the SSE stream and rendered as a transcript row (parses OpenAI tool-call deltas; deduped per turn) |
| P3 | **Groups** — 2–6 bots, serial rounds, @mentions, per-member sessions | backend + UI | a 3-bot group answers a prompt with labelled rounds |
| P4 | **Bot creation with consent** — propose → approve → create + fleet registration | backend + UI | a new GrokBot agent appears in the roster after approval |
| P5 | **Secrets store** — `secrets.sources` + `secrets.profile_alias`, migrate per-profile keys | infra | every bot still authenticates after migration; one source of truth |
| P6 | ✅ **Tests + E2E + ship** — DONE 2026-09-26 | Susan | `workspace/susan/scripts/e2e_grokbot_surface.mjs`: **16/16 checks pass against the live public URL**; UI passes tsc + vite build; 5 processes registered as logon Scheduled Tasks (hidden) |

Deferred/dropped: `.env` backups from the infra wave remain in each bot profile as `.env.bak-20260926`.

## Current state — box score

- **Over the public URL:** fleet separation (5 personal agents 404), a real streamed GrokBot turn, a
  live 1920×1080 screen capture with correct take-over dimensions, the Agent Computer pane opening
  in a phone-viewport browser with zero JS errors, roster rendering.
- **Not yet exercised end-to-end:** a real mouse/keyboard take-over action against the live desktop
  (deliberately untested — it would seize Ali's actual machine), and the P3–P5 features.

## Guardrails

- Never expose the Hermes dashboard publicly; the GrokBot surface is its own app.
- Every credential masked in logs; no secret values in chat, notes, or workspace.
- Ship behind the existing basic-auth; the tunnel maps `bot.balacode.xyz` → `:9119` and the app
  behind the port is the deploy.
