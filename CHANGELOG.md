# Changelog

## [Unreleased]

### Features
- Seed and activate `texting-style` plugin in profiles, setting SMS register in persona SOUL.md.
- Wire Jev decision gate (`is_decision_worthy`) and skill selection (`select_skills`, `prompt_line`) into the `/api/chat` send path with user-message carriers and stated degrades.
- Implement and wire agent intervention flow (`balabot.intervention`): bot pause on wall, `request_intervention` tool, `event: intervention` SSE stream emission, and `/api/intervention/{token}/resolve` routes.
- Implement and wire durable per-session message queueing (`balabot.queueing`): `GET/POST /api/queue/{session_id}` routes and FIFO draining at the top of `/api/chat` turns with busy/idle state tracking.
- Wire skill library management routes: `POST /api/org/skills/pin`, `POST /api/org/skills/promote`, and `POST /api/org/skills/curate` to `balabot.skills_registry`.
- Wire Jev memory relevance ladder into Hermes balabot-jev memory prefetch with candidate re-ranking.
- Implement and wire growth-loop audit trail and rollback ledger (`balabot.growth`, `bot_tools.py`, routes `GET/POST /api/growth/audit` and `/api/growth/audit/{id}/rollback`).
- Wire growth loop frustration sensor into `/api/chat` turn stream, recording signals into governor ledger with routes `GET /api/growth/ledger` and `POST /api/growth/run`.
- Implement and wire attachments intake: `POST /api/attachments` upload, `GET /api/attachments/{id}/{name}`, Composer UI upload handling, and `/api/chat` context delivery.

