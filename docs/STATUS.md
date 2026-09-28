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
| Skill Library (read view + precedence resolver) | SHIPPED | Library view `/api/skills/library` (`ui/server.py:1145`); precedence resolver `balabot.skills_registry.resolve` called by `ui/server.py:_jev_prepare` (`:1800`); pin/promote routes `/api/org/skills/pin` & `/api/org/skills/promote` (`:1072-1110`) |
| Skill curator (principal review loop) | SHIPPED | `balabot/skills_registry.py:curate` wired into `POST /api/org/skills/curate` (`ui/server.py:1113-1124`) for review/curate passes |
| Groups (create/list/delete, serial turns, @mentions) | SHIPPED | `balabot/groups.py` (`mention_targets`); routes `/api/groups*` incl. serial `/api/groups/{gid}/turn` (`ui/server.py:1131-1216`) |
| Bot creation with consent | SHIPPED | Same as agent create — consent ladder enforced at `bot_creation.py:171-202` (self-approval refused; create step checks recorded consent) |
| Jev health + incidents | SHIPPED | `check_jev_health` (`balabot/jev.py:244`); routes `/api/jev/health`, `/api/jev/incidents` (`ui/server.py:452-465`); incident list via `bootstrap.list_jev_incidents` |
| Jev decision gate (`is_decision_worthy`) | SHIPPED | Wired in `ui/server.py:_jev_prepare` (`:1773`) on chat send path; fails open with stated degrade frame (`event: jev`); decisions persisted to durable session store via `_chat_append_session_state` |
| Jev skill selection (`select_skills` + `prompt_line`) | SHIPPED | Wired in `ui/server.py:_jev_prepare` (`:1800`) calling `select_and_render` → `jev_prompt._render_line` → `jev_depth.prompt_line`; emitted via `event: jev_carrier` riding user message |
| Jev saliency checkpoint (pre-compaction) | SHIPPED | `jev_continuity.saliency_pass` called by the `balabot-jev` memory plugin: `hermes/plugins/balabot-jev/checkpoint.py:120-127`, surfaced via `on_pre_compress` (`hermes/plugins/balabot-jev/__init__.py:394`); plugin seeded by `bootstrap.py:494-505` |
| Jev memory relevance ladder (`memory_relevance.py`) | SHIPPED | `balabot/memory_relevance.py` (`run_relevance_ladder`) wired into `hermes/plugins/balabot-jev/__init__.py:305-373` (`prefetch` -> `_jev_ranked_suffix`); tested in `tests/test_balabot_jev_plugin.py:465` |
| Session store + continuity (durable sessions) | SHIPPED | `balabot/sessions.py` (SQLite `continuity.db`) wired into `ui/server.py`: `_prepare_chat_session` runs `route_session`, `_resume_carrier` re-anchors, `_chat_append_session_state` appends; UI receives carriers (`ui/src/App.tsx:402`) |
| Compaction / session continuity | SHIPPED | Checkpoint-before-compress path: `on_pre_compress` → `run_saliency_pass` → durable evidence store, with re-anchor block (`checkpoint.py:240-263`); abort-on-failure contract documented at `checkpoint.py:21` |
| Intervention flow (human takes over a bot mid-run) | SHIPPED | `balabot/intervention.py`; tool `request_intervention` (`bot_tools.py:361`); routes `/api/intervention/{resume_token}{,/resolve}`, `/api/interventions` (`ui/server.py:557-594`); drained as `event: intervention` into `/api/chat` stream (`:2077`) |
| Bot-to-bot messaging (`message_agent`, handoff frames) | SHIPPED | `balabot/bot_tools.py:message_agent` (`:293`) & CLI; queues inbox delivery and handoff frames via `balabot.handoffs.enqueue_handoff`; drained into `/api/chat` stream (`ui/server.py:2074-2076`); rendered in UI (`ui/src/api.ts:254`) |
| Attachments | SHIPPED | `POST /api/attachments` upload & `GET /api/attachments/{file_id}/{filename}` in `ui/server.py:539-605`; wired in `ui/src/Composer.tsx` (`uploadAttachment`), `ui/src/App.tsx:send`, and `POST /api/chat` (`:2296`) forward to upstream context; tested in `tests/test_growth.py:328` |
| PWA / installability | SHIPPED | `ui/public/manifest.webmanifest`, `sw.js`, offline.html, icons; served from `ui/dist` |
| Message queueing (offline bot → pending messages) | SHIPPED | `balabot/queueing.py`; routes `GET/POST /api/queue/{session_id}` (`ui/server.py:606-635`); drained at top of `/api/chat` stream (`ui/server.py:2102`) with turn busy/idle tracking |
| Hierarchy enforcement (409 on shipped/default edit, reference-complete purge) | SHIPPED | Route guards return `getattr(exc,'status',409)` on protected bots (`ui/server.py:1515/1527/1546`); shipped-profile refusal in container snippet (`:1454`); `lifecycle.classify_profile` + `_ref_state` (`lifecycle.py:177/164`) |
| Growth loop (frustration scan → ledger → growth job) | SHIPPED | Frustration sensor (`growth.scan` + `growth.classify`) wired into `ui/server.py:chat` turn path (`:2308-2331`), recording confirmed/escalated signals to governor ledger; routes `GET /api/growth/ledger` & `POST /api/growth/run` (`:473-495`); tested in `tests/test_growth.py` |
| Growth-loop audit trail | SHIPPED | Durable audit ledger & rollback path in `balabot/growth.py` (`record_audit_entry`, `read_audit_entries`, `rollback_audit_entry`); bot tools & CLI in `balabot/bot_tools.py` (`record_growth_audit`, `rollback_growth_audit`); routes `GET/POST /api/growth/audit` & `POST /api/growth/audit/{id}/rollback` in `ui/server.py:497-537`; tested in `tests/test_growth.py` and `tests/test_bot_tools.py` |

## Known false claims this table corrects

- `docs/architecture.md` (pre-correction): "Agent-to-agent messaging … **exists**" — false; see Bot-to-bot messaging row.
- Vault plan "Wave 7 ✅ SHIPPED" (Jev signals + skill selection) — false at the time; the three functions (`is_decision_worthy`, `select_skills`, `prompt_line`) had 0 call sites. Their status here is PARTIAL — not wired.
