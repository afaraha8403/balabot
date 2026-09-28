# Changelog

## [Unreleased]

### Features
- Adopt OpenUI (`@openuidev/react-lang` + `@openuidev/lang-core`) for agent-driven generative interfaces: add bounded component registry (`HireAgentCard`, `Card`, `CardHeader`, `FormField`, `ConfirmButtons`) in `ui/src/openui/library.tsx`, token-mapped styles in `ui/src/openui/openui.css`, dual-mode `OpenUIRenderer.tsx` embedded in the live chat transcript, interactive consent confirmation flow for bot hiring, and agent prompt instruction contracts in `docs/PROJECT-RULES.md`.
- Implement agent-side bot creation proposal flow (`propose_bot` in `balabot.bot_tools` and CLI, agent-writable spooling under `$BALABOT_DATA_ROOT/spool/bot_proposals`, and server-side root drain into dashboard proposals list) with full consent ladder preservation and persona rules.
- Implement live take-over demonstration action recording in Agent Computer dialog (`AgentComputerDialog.tsx`) with real-time click, typing, key, and scroll capture and honest daemon status disclosure.
- Implement "Hold everything" pause control with dropdown directly on transcript header and composer to pause, steer with owner guidance, approve, or deny running turns, wired end-to-end to `balabot/intervention.py` with honest state reflection.
- Implement server-backed toggleable bot routines list in right panel with on/off switches, last-run tracking, and creation/editing/deletion routes (`/api/bots/{bot_id}/routines`).
- Implement rich file and artifact preview cards (`FilePreviewCard.tsx`) with expandable image thumbnails, code snippet preview with syntax tag, and download action.
- Implement message hover action toolbar with in-thread reply quoting and reaction shortcuts (👍, ❤️, 🚀).
- Implement Agent Computer recovery controls (`POST /api/computer/{bot_id}/reset`) and "Teach a task" demonstration recording affordance.
- Add collapsible roster grouping categories (`OPS`, `CURSOR`, `GOVERNANCE`) in bot list.
- Add mobile share-sheet intake support via Web Share Target API in PWA manifest and composer URL parameter handling.
- Implement GrokBot UI parity: sidebar organization with Pinned Bots, main Bots, Group Chats, and collapsible Hidden Bots drawer with unhide affordance.
- Add Pin, Unpin, Hide, Unhide, and Duplicate actions to bot row menu with persistent client-side storage.
- Implement in-transcript interactive Intervention Card for human take-over on CAPTCHA, 2FA, and sensitive credentials with direct resolution API call.
- Implement editable Draft Cards for email and Slack messages with recipient, subject/channel, body inputs, and primary Send/Discard actions.
- Implement Voice Memo audio player card with play/pause controls, duration, and expandable transcript disclosure.
- Implement global keyboard shortcuts (`Cmd/Ctrl+K` command palette, `Cmd/Ctrl+Shift+F` search bots, `Cmd/Ctrl+N` new bot, `Cmd/Ctrl+B` toggle sidebar, `Cmd/Ctrl+1..9` jump to bot, `Alt+Up/Down` and `Ctrl+Tab` cycle bots, `Cmd/Ctrl+Shift+M` skill library).
- Implement Command Palette (`Cmd/Ctrl+K`) searching across Bots, Groups, Conversations, and System Actions.
- Implement `@` mention autocomplete (bots, groups, `@everyone`) and `/` skill reference menu in Chat Composer with `Cmd/Ctrl+D` dictation shortcut and voice chat start button.
- Implement dual-mode Right Panel: Live Screen mode with 4-second desktop frame polling, one-click Agent Computer launch, and Routines manager; Settings mode for inline bot renaming, role change, and prompt adjustment without leaving chat.
- Integrate Group Chat inline launch with direct `initialGroupId` selection.
- Seed and activate `texting-style` plugin in profiles, setting SMS register in persona SOUL.md.
- Wire Jev decision gate (`is_decision_worthy`) and skill selection (`select_skills`, `prompt_line`) into the `/api/chat` send path with user-message carriers and stated degrades.
- Implement and wire agent intervention flow (`balabot.intervention`): bot pause on wall, `request_intervention` tool, `event: intervention` SSE stream emission, and `/api/intervention/{token}/resolve` routes.
- Implement and wire durable per-session message queueing (`balabot.queueing`): `GET/POST /api/queue/{session_id}` routes and FIFO draining at the top of `/api/chat` turns with busy/idle state tracking.
- Wire skill library management routes: `POST /api/org/skills/pin`, `POST /api/org/skills/promote`, and `POST /api/org/skills/curate` to `balabot.skills_registry`.
- Wire Jev memory relevance ladder into Hermes balabot-jev memory prefetch with candidate re-ranking.
- Implement and wire growth-loop audit trail and rollback ledger (`balabot.growth`, `bot_tools.py`, routes `GET/POST /api/growth/audit` and `/api/growth/audit/{id}/rollback`).
- Wire growth loop frustration sensor into `/api/chat` turn stream, recording signals into governor ledger with routes `GET /api/growth/ledger` and `POST /api/growth/run`.
- Implement and wire attachments intake: `POST /api/attachments` upload, `GET /api/attachments/{id}/{name}`, Composer UI upload handling, and `/api/chat` context delivery.

