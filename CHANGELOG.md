# Changelog

## [Unreleased]

### Features
- Seed and activate `texting-style` plugin in profiles, setting SMS register in persona SOUL.md.
- Wire Jev decision gate (`is_decision_worthy`) and skill selection (`select_skills`, `prompt_line`) into the `/api/chat` send path with user-message carriers and stated degrades.
- Implement and wire agent intervention flow (`balabot.intervention`): bot pause on wall, `request_intervention` tool, `event: intervention` SSE stream emission, and `/api/intervention/{token}/resolve` routes.
- Implement and wire durable per-session message queueing (`balabot.queueing`): `GET/POST /api/queue/{session_id}` routes and FIFO draining at the top of `/api/chat` turns with busy/idle state tracking.

