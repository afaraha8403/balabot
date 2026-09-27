---
type: reference
title: BalaBot — capability status (verified)
description: Single honest status table for every major BalaBot capability, verified against the repo with grep/call-site checks on 2026-09-27. SHIPPED = wired with a production caller/route; PARTIAL = built but not wired (missing half named); MISSING = not built.
tags: [balabot, status, capability-matrix, verification]
timestamp: 2026-09-27T00:00:00Z
---

# BalaBot capability status

Verified 2026-09-27 against the repo (call-site greps excluding `tests/` and the defining module; route checks in `ui/server.py`). This is the single source of truth. Rules used: a module existing is not a capability; "PARTIAL — not wired (0 call sites)" means no production code calls it.

| Capability | Status | Evidence / missing half |
|---|---|---|
| Agent create (consent flow) | SHIPPED | `balabot/bot_creation.py` (propose → human approval → create, self-approval refused); routes `/api/bot-proposals*` at `ui/server.py:1390-1483`; UI dialog `ui/src/BotCreationDialog.tsx` |
| Agent edit | SHIPPED | `lifecycle.update_registered_bot` (`balabot/lifecycle.py:377`), route `PATCH /api/bots/{id}` (`ui/server.py:1631`) |
| Agent delete / purge / reap | SHIPPED | `lifecycle.delete_registered_bot`, `purge_orphan`, `reap_subagent_artifacts` (`lifecycle.py:359/323/346`); routes `DELETE /api/bots/{id}` (`:1617`), `/api/orphans/{name}` (`:1590`), `/api/orphans/reap` (`:1603`) |
| Orphan adopt | SHIPPED | `lifecycle.adopt_orphan` (`lifecycle.py:244`), route `POST /api/orphans/{name}/adopt` (`ui/server.py:1577`) |
| Sub-agent visibility (UI) | SHIPPED | `ui/subagents.py` reads `/opt/data/spawn-ledger.json` + `/proc` liveness; route `GET /api/subagents` (`ui/server.py:470`); UI poll `ui/src/App.tsx:249-256`. Caveat: ledger currently only records long-lived spawns, not ephemeral `delegate_task` children |
| Agent Computer (screen view + action) | SHIPPED | `balabot/computer.py`; routes `GET /api/computer/{bot_id}/frame` + `POST /api/computer/{bot_id}/action` (`ui/server.py:504/524`); s6 service `docker/s6-rc.d/agent-computer` |
| Org + grants registry | SHIPPED | `balabot/orgs.py`; routes `/api/orgs`, `/api/org/secrets`, `/api/org/grants{,/revoke}` (`ui/server.py:793-905`); auto-registered at first boot (`bootstrap.init_org`) |
| Secret delivery (`secrets.sources` helper) | SHIPPED | `balabot/secret_helper.py` filters org registry by bot's live grants; wired into persona config at `bootstrap.py:176` (`python3 -m balabot.secret_helper --profile <name>`) |
| In-chat secret/access request flow | SHIPPED | `balabot/bot_tools.py` (`request_secret`, `request_secret_access` CLI, argv is a no-secret zone); queue + SSE drain in `ui/server.py:753-800`; UI approval routes `/api/org/requests` (`:907-937`). Caveat: `bot_tools` is invoked via CLI; no Hermes tool-schema wrapper |
| Skill Library (read view + precedence resolver) | PARTIAL | Library view SHIPPED (`/api/skills/library`, `ui/server.py:993`, walks live profile tree). Precedence resolver (`balabot/skills_registry.py`) exists but **not wired — 0 call sites** outside tests. Missing half: pin/promote routes are stubs returning "not wired yet" (`ui/server.py:943-948`) |
| Skill curator (principal review loop) | MISSING | Only prose skill `skills/agent-growth-review/SKILL.md`; no code invokes a review/curate pass |
| Groups (create/list/delete, serial turns, @mentions) | SHIPPED | `balabot/groups.py` (`mention_targets`); routes `/api/groups*` incl. serial `/api/groups/{gid}/turn` (`ui/server.py:1131-1216`) |
| Bot creation with consent | SHIPPED | Same as agent create — consent ladder enforced at `bot_creation.py:171-202` (self-approval refused; create step checks recorded consent) |
| Jev health + incidents | SHIPPED | `check_jev_health` (`balabot/jev.py:244`); routes `/api/jev/health`, `/api/jev/incidents` (`ui/server.py:452-465`); incident list via `bootstrap.list_jev_incidents` |
| Jev decision gate (`is_decision_worthy`) | PARTIAL — not wired (0 call sites) | Defined `balabot/jev_depth.py:65`; only caller is its own wiring module `jev_prompt.py`, which itself has 0 production callers. Nothing feeds chat turns through the gate |
| Jev skill selection (`select_skills` + `prompt_line`) | PARTIAL — not wired (0 call sites) | Defined `jev_depth.py:109/190`; wiring module `jev_prompt.py` (built for it) has 0 production callers. Nothing injects the `<skill_relevance>` line into live turns |
| Jev saliency checkpoint (pre-compaction) | SHIPPED | `jev_continuity.saliency_pass` called by the `balabot-jev` memory plugin: `hermes/plugins/balabot-jev/checkpoint.py:120-127`, surfaced via `on_pre_compress` (`hermes/plugins/balabot-jev/__init__.py:394`); plugin seeded by `bootstrap.py:494-505` |
| Jev memory relevance ladder (`memory_relevance.py`) | PARTIAL — not wired (0 call sites) | `balabot/memory_relevance.py` has no production importers; the plugin's prefetch wrapper (`checkpoint.py:265-283`) forwards to the inner provider without Jev re-ranking |
| Session store + continuity (durable sessions) | SHIPPED (server side) | `balabot/sessions.py` (SQLite `continuity.db`, resume_state, topic spans) used by the plugin (`checkpoint.py:281-300`). UI sessions are localStorage only (`ui/src/sessions.ts`) — the two are not connected |
| Compaction / session continuity | SHIPPED | Checkpoint-before-compress path: `on_pre_compress` → `run_saliency_pass` → durable evidence store, with re-anchor block (`checkpoint.py:240-263`); abort-on-failure contract documented at `checkpoint.py:21` |
| Intervention flow (human takes over a bot mid-run) | MISSING | `grep -rn intervention` over all `.py/.ts` returns 0 production hits |
| Bot-to-bot messaging (`message_agent`, handoff frames) | MISSING | `grep -rn message_agent` → 0 hits anywhere; no production `event: handoff` emitter. UI handoff renderer (`ui/src/api.ts:254`) + server frame grammar (`ui/server.py:753`) are staged for it; the secret-request queue uses the same grammar but is not messaging |
| Attachments | PARTIAL | Composer UI sends an attachments array (`ui/src/Composer.tsx:18-38`), but `POST /api/chat` (`ui/server.py:1654`) accepts only JSON text messages — no upload endpoint, no file delivery to the backend |
| PWA / installability | SHIPPED | `ui/public/manifest.webmanifest`, `sw.js`, offline.html, icons; served from `ui/dist` |
| Message queueing (offline bot → pending messages) | PARTIAL | Only the org request queue exists (`_org_request_queue`, `ui/server.py:754-772`, drained on next `/api/chat` stream). No queue for user→bot messages while a bot is offline |
| Hierarchy enforcement (409 on shipped/default edit, reference-complete purge) | SHIPPED | Route guards return `getattr(exc,'status',409)` on protected bots (`ui/server.py:1515/1527/1546`); shipped-profile refusal in container snippet (`:1454`); `lifecycle.classify_profile` + `_ref_state` (`lifecycle.py:177/164`) |
| Growth loop (frustration scan → ledger → growth job) | PARTIAL — not wired (0 call sites) | `balabot/growth.py` implements the full pipeline (`scan`, `classify`, `record_frustration`, `growth_job`) but has **no production caller** — `grep -rn 'from .growth'` outside tests = 0. The Jev health/incident feed is wired separately; the growth loop itself is not |
| Growth-loop audit trail | MISSING | No audit/rollback log exists for principal changes; `skills/agent-growth-review/SKILL.md` only instructs the agent to log changes in prose |

## Known false claims this table corrects

- `docs/architecture.md` (pre-correction): "Agent-to-agent messaging … **exists**" — false; see Bot-to-bot messaging row.
- Vault plan "Wave 7 ✅ SHIPPED" (Jev signals + skill selection) — false at the time; the three functions (`is_decision_worthy`, `select_skills`, `prompt_line`) had 0 call sites. Their status here is PARTIAL — not wired.
