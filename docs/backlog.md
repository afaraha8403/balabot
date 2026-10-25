---
type: backlog
title: BalaBot UI test backlog
description: Issues found while exercising the running BalaBot UI (http://127.0.0.1:9119) in a full, non-headless Chrome browser over the Chrome DevTools Protocol.
timestamp: 2026-10-24T00:00:00Z
status: resolved
---

# BalaBot UI backlog

Issues found by driving the live application through its user interface. **No code was changed.**
Each item is intended to be assigned to an agent as-is.

## Test context

- **Build under test:** the Pi Durable server on `http://127.0.0.1:9119` (`server/index.ts`), serving the built UI in `ui/dist/`.
- **Browser:** Google Chrome 155, launched non-headless, controlled over CDP on port 9222.
- **Viewport:** 1440–1500 px desktop, plus a 500 px narrow-window pass.
- **Date:** 2026-10-24.
- **Account:** the local single-user profile (`Ali`). No real secrets were entered.
- **Cleanup:** test-only data created during the run (one group, one bot, two empty sessions, one MCP entry) was removed afterwards. The group had to be deleted directly from SQLite because no UI/API delete path exists.

## Coverage

Exercised through the UI: boot and roster, sections and filtering, pin/hide/archive/unread, bot menus (pin, move, duplicate, clear, archive, delete), bot settings (identity, model, thinking, memory), bot creation by proposal and by OpenUI card, command palette, user menu, all Settings tabs, Plugins/Connectors/Installed Skills/MCP Servers, Agent Computer and Teach a Task, Routines, message composer (attachments, mentions, slash skills, send), streamed chat, reply, reactions, sessions (new/switch/delete), group chat setup, artifacts, deep screens (Agents, Memory, Decisions, Governance, Ops, Cost), PWA service worker/manifest, dark/light themes, keyboard shortcuts, and the narrow layout.

**Blocked / not exerciseable in this environment:** real connector OAuth, real desktop automation, microphone audio capture, group member execution (blocked by BB-054), and Cloudflare remote mode.

## Recheck — round 2 (2026-10-24)

Re-ran the same UI pass against the rebuilt server and UI (`ui/dist` built after the fixes). Chrome 155, non-headless CDP, desktop plus a 390 px emulation pass. No source changes were made for this recheck.

- **Original backlog:** 35 fixed, 6 partially fixed, 7 still open.
- **New defects found:** 9 (BB-049–BB-057), mostly gaps exposed by the fixes rather than regressions.
- **Still blocking a credible demo:** stale default model (BB-003), client-side provider keys (BB-016), fake Agent Computer (BB-023), non-functional pause (BB-025 + BB-053), cosmetic safety settings (BB-026), attachments the model cannot read (BB-049), group members that never run (BB-054), and the dead create menu (BB-055).
- **Do not regress:** group creation/reload (BB-001), explicit model errors (BB-002), proposal consent flow (BB-004), bot editing (BB-006), session delete/clear (BB-011/BB-012), deep screens (BB-013), unused fake artifact/usage data (BB-014/BB-018), skills (BB-019), bot deletion purge (BB-036), and the missing-bot route (BB-047).

**Fixed and verified:** BB-001, BB-002, BB-004, BB-006, BB-007, BB-008, BB-009, BB-010, BB-011, BB-012, BB-013, BB-014, BB-015, BB-017, BB-018, BB-019, BB-020, BB-022, BB-024, BB-027, BB-028, BB-031, BB-032, BB-033, BB-034, BB-035, BB-036, BB-037, BB-039, BB-040, BB-041, BB-043, BB-044, BB-045, BB-047.

**Partially fixed:** BB-005 (duplicate click guarded, but the card resets after creation), BB-021 (fake defaults removed; registry still client-only), BB-025 (endpoint exists; it flags but does not stop generation — see BB-053), BB-029 (reaction picker fixed; message menu still clipped), BB-038 (Governance real; Memory still empty), BB-046 (menu now has both choices but never opens — see BB-055).

**Still open:** BB-003, BB-016, BB-023, BB-026, BB-030, BB-042, BB-048.


## Issue index

| ID | Severity | Area | Status | Title |
|---|---|---|---|---|
| BB-001 | Critical | Groups | Fixed — verified | Creating a group leaves the app unable to render after reload (white screen) |
| BB-002 | Critical | Chat engine | Fixed — verified | Model failures silently return scripted persona replies and falsely claim the API key is missing |
| BB-003 | High | Chat engine / models | Open | New and legacy bots default to a model that no longer exists |
| BB-004 | High | Agent creation | Fixed — verified | UI-created bot proposals can never be approved |
| BB-005 | High | OpenUI / agent creation | Partially fixed | Approving a HireAgentCard submits twice and the card stays active |
| BB-006 | High | Bot settings | Fixed — verified | Editing a bot's name, title, description, or colour saves but never takes effect |
| BB-007 | High | Attachments | Fixed — verified | Attachment upload fails with 404 but the file still appears attached (fixed; forwarding is BB-049) |
| BB-008 | High | Routines | Fixed — verified | Routines cannot be created (fixed; execution is BB-050) |
| BB-009 | High | Bot memory | Fixed — verified | Adding a bot memory fails with an unhandled page error |
| BB-010 | High | Sessions / streaming | Fixed — verified | Every session open requests a missing events endpoint |
| BB-011 | High | Sessions | Fixed — verified | Deleting a conversation silently fails |
| BB-012 | High | Conversations | Fixed — verified | “Clear conversation” is local-only and messages return after reload |
| BB-013 | High | Deep screens | Fixed — verified | Agents, Ops, Decisions, and Cost screens are unreachable (404) |
| BB-014 | High | Usage | Fixed — verified | Usage and spend numbers are fabricated placeholders |
| BB-015 | High | Computer settings | Fixed — verified | Computer settings reports a Docker container “Online” and contradicts its own 404 (fixed; orphan scan is BB-052) |
| BB-016 | High | Secrets / settings | Open | Provider keys are localStorage-only; the UI reports “No key saved” while the server has one |
| BB-017 | High | Artifacts | Fixed — verified | Artifacts page is completely unstyled |
| BB-018 | Medium | Artifacts | Fixed — verified | Artifacts page seeds fabricated artifacts |
| BB-019 | High | Skills | Fixed — verified | Skill library is never loaded; composer always says “No skills installed” |
| BB-020 | High | Command palette | Fixed — verified | Skill Library and Agent Computer palette actions do nothing |
| BB-021 | High | MCP | Partially fixed | MCP servers are localStorage-only, with fabricated “Active” entries |
| BB-022 | High | Connectors | Fixed — verified | Connectors show fabricated “Connected” state and never contact a backend |
| BB-023 | High | Agent Computer | Open | Agent Computer is a non-functional stub presented as a live desktop |
| BB-024 | Medium | Groups | Fixed — verified | Group setup UI is unstyled and its member tokens expose icon names |
| BB-025 | Medium | Intervention | Partially fixed | Pause/intervention controls have no working backend |
| BB-026 | Medium | Settings | Open | Memory, Voice, Messaging, and Approvals settings are cosmetic |
| BB-027 | Medium | Settings | Fixed — verified | “Check for updates” always reports “up to date” after a fake delay |
| BB-028 | Medium | Navigation | Fixed — verified | User menu is clipped by the sidebar |
| BB-029 | Medium | Chat UI | Partially fixed | Reaction picker and message menu are clipped at the right panel |
| BB-030 | Medium | Responsive | Open | Narrow layout overlaps header controls and opens the side panel over the chat |
| BB-031 | Medium | Theming | Fixed — verified | Light theme secondary text is below comfortable contrast |
| BB-032 | Medium | Chat | Fixed — verified | Reactions are UI-only and disappear |
| BB-033 | Medium | Sessions | Fixed — verified | New conversations are indistinguishable and cannot be renamed |
| BB-034 | Medium | Keyboard | Fixed — verified | `Cmd/Ctrl+1..9` selects roster order, not pinned bots |
| BB-035 | Medium | Models | Fixed — verified | Model picker offers batch variants that break live chat |
| BB-036 | Medium | Bot lifecycle | Fixed — verified | Deleting a bot leaves its persona directory behind |
| BB-037 | Medium | Proposals | Fixed — verified | Proposals live only in server memory |
| BB-038 | Medium | Memory / Governance | Partially fixed | Memory and Governance are permanently empty placeholders |
| BB-039 | Low | Hidden bots | Fixed — verified | Un-hiding a bot is labelled “Archive” |
| BB-040 | Low | Roster search | Fixed — verified | No-match state says the roster is empty |
| BB-041 | Low | Chat UI | Fixed — verified | Two “Pause bot” controls are always visible, even when idle |
| BB-042 | Low | Navigation | Open | “Team Fleet” in the space switcher does nothing |
| BB-043 | Low | Copy | Fixed — verified | Legacy Docker/container wording remains in a zero-Docker product |
| BB-044 | Low | Accessibility | Fixed — verified | “Show thinking” checkbox has no accessible name |
| BB-045 | Low | Data | Fixed — verified | Test-fixture conversations are visible in the user’s session list |
| BB-046 | Low | New bot | Partially fixed | “New bot or group” only opens bot creation |
| BB-047 | Low | Routing | Fixed — verified | Deep link to a deleted bot silently shows Principal |
| BB-048 | Low | Chat UI | Open | Reply preview renders the whole raw message, including `openui-lang` source |
| BB-049 | High | Attachments | Open | Uploaded attachments are never sent to the model |
| BB-050 | High | Routines | Open | Routines save but never execute; handler binding returns 404 |
| BB-051 | Medium | Usage / Cost | Open | Real model turns are never recorded in usage or cost |
| BB-052 | Medium | Orphans | Open | Orphan reconciliation always reports zero |
| BB-053 | High | Intervention | Open | “Pause turn” records a flag but generation continues |
| BB-054 | High | Groups | Open | Group messages never invoke group members |
| BB-055 | High | Navigation | Open | “New bot or group” menu never opens |
| BB-056 | Low | Groups | Open | Group roster stays stale after create/delete until reload |
| BB-057 | Medium | Bot lifecycle | Open | Deleting a bot leaves its routines and memories in SQLite |

---

## Critical

### BB-001 — Creating a group leaves the app unable to render after reload (white screen)

- **Status:** Fixed — verified
- **Severity:** Critical
- **Area:** Group chat, roster persistence
- **Description:** A group created through the UI is persisted without a `members` array. The roster renders `F.members.map(...)`, so the next page load throws and the application renders nothing. In the tested build the error was `TypeError: Cannot read properties of undefined (reading 'map')` inside the group-chat roster branch. The same missing shape also makes “Open group” show an empty picker. Recovering required deleting the group row from SQLite, because neither the UI nor the API can remove a group.
- **Reproduction:**
  1. Open the app and press `Cmd/Ctrl+K`.
  2. Search for “Start a Group Chat” and run it.
  3. Name the group, add at least two bots, and click **Create group**.
  4. Observe that the dialog falls back to “Pick a group” and the group does not appear in the sidebar.
  5. Reload the page (`Cmd+R`).
- **Expected:** The group persists with its members, appears in the roster, opens for chat, and the app still renders after reload.
- **Actual:** After reload, `#root` is empty and the console shows the `members.map` TypeError. No way to remove the broken group from the UI.
- **Evidence:** `GET /api/groups` returned `{"group_id":"grp-…","org_id":"balacode","name":"QA room",…}` with no `members`, while the UI expects `id`, `members`, `transcript`, etc.

### BB-002 — Model failures silently return scripted persona replies and falsely claim the API key is missing

- **Status:** Fixed — verified
- **Severity:** Critical
- **Area:** Chat engine, honesty
- **Description:** When the OpenRouter request fails (for example, because the configured model is unknown) and the Pi AI fallback also fails, the harness silently drops into a scripted “local soul reasoning engine”. The user sees a normal assistant message with no error prefix, and the scripted text says to set `OPENROUTER_API_KEY` even when the key is present in `.env` and loaded by the server. This is the exact “declared capability, zero effect, no error” failure mode and violates the no-fabrication rule.
- **Reproduction:**
  1. Select **Governor** (its model is `anthropic/claude-3.5-sonnet`, which is absent from the live catalogue).
  2. Send “Hello governor, quick check.”
  3. Read the assistant reply.
- **Expected:** A visible, explicit model/provider error with the real cause, or a clearly labelled offline mode. Never a fabricated persona answer that misreports configuration.
- **Actual:** “Governor here… [Notice: Running in offline local mode. To connect live frontier models … set OPENROUTER_API_KEY …]” while `OPENROUTER_API_KEY` is set and Principal was answering through the live model moments earlier.
- **Evidence:** Response captured in the transcript; the fallback text is produced in `server/harness.ts` after swallowing the model error.

### BB-003 — New and legacy bots default to a model that no longer exists

- **Status:** Open
- **Severity:** High
- **Area:** Models, bot creation
- **Description:** Bots without an explicit model are mapped to `anthropic/claude-3.5-sonnet`. The live OpenRouter catalogue served by `/api/models` contains 469 models and none whose id contains `claude-3.5`. Every such bot falls into the silent scripted fallback in BB-002. Bots created through the proposal flow inherit the same default.
- **Reproduction:**
  1. Open `GET /api/models` and search for `claude-3.5` — no results.
  2. Open `GET /api/bots` and note `governor` and `seo-expert` use `anthropic/claude-3.5-sonnet`.
  3. Chat with either bot through the UI.
- **Expected:** A model that exists in the catalogue, or an explicit “model unavailable” warning with a picker to choose a live model before chatting.
- **Actual:** Silent fallback reply (BB-002); the fallback repeats the retired model name inside its notice.

### BB-004 — UI-created bot proposals can never be approved

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Agent creation, consent flow
- **Description:** The backend creates proposals with `status: "pending"`, while the UI classifies only `status === "proposed"` as pending. Every new proposal therefore lands in the “Decided” list and no Approve button is rendered. The “Awaiting your approval” section displays “No pending proposals” at the same time.
- **Reproduction:**
  1. Click the **New bot or group** button in the sidebar.
  2. Enter a name and role and click **Propose bot**.
  3. Inspect the create panel.
- **Expected:** The proposal appears under “Awaiting your approval” with Approve/Reject controls.
- **Actual:** The proposal appears under “Decided” with the status text `pending`; there is no approval path. `GET /api/bot-proposals` confirms all such proposals are `"status": "pending"`.
- **Evidence:** `test-bot` and `seo-expert copy` both showed as `pending` under “Decided”.

### BB-005 — Approving a HireAgentCard submits twice and the card stays active

- **Status:** Partially fixed
- **Severity:** High
- **Area:** OpenUI, agent creation
- **Description:** One click on **Approve & Hire Agent** created two proposals one millisecond apart (`prop-…433248` and `prop-…433249`), both immediately `approved`. The bot itself was created once because the slug collides, which hides the duplicate from the roster. The card remains in the transcript and can be clicked again, so repeats create more proposals. The proposal status is never advanced to a terminal “registered” state.
- **Reproduction:**
  1. Ask Principal for a hire (or use the existing proposal card with values `quill` / Blog Writer).
  2. Click **Approve & Hire Agent** once.
  3. Call `GET /api/bot-proposals` and compare the two new records.
  4. Observe that the card is still interactive.
- **Expected:** One proposal, one approval, one creation, idempotent repeat clicks, and a resolved/disabled card.
- **Actual:** Two approved proposals for one click; card remains clickable.
- **Round 2:** The in-card double-click guard works. However, after the bot is created the app reloads the transcript, remounts the card in `pending` state, and the buttons return. Clicking again created a second `registered` proposal for the same bot.

---

## High

### BB-006 — Editing a bot's name, title, description, or colour saves but never takes effect

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Bot settings
- **Description:** The settings panel sends a PATCH, and the server merges the fields into `config_json`. The roster and settings panel read `name`, `title`, and description from the `fleet_roster` columns, so the edit is invisible and the form snaps back. Model changes do work because they are read from `config_json`.
- **Reproduction:**
  1. Select `seo-expert` and click **Bot settings**.
  2. Change **Title** to `SEO Specialist QA` and click **Save changes**.
  3. Inspect the field, the header, and `GET /api/bots`.
- **Expected:** Title updates everywhere and survives reload.
- **Actual:** Field resets to `SEO Specialist`; `GET /api/bots` still reports `SEO Specialist`, while the PATCH response echoes the old title. The new value is only present inside `config.title`.

### BB-007 — Attachment upload fails with 404 but the file still appears attached

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Composer, attachments
- **Description:** `POST /api/attachments` is not implemented. The UI nevertheless shows an attachment chip with name, MIME type, and size, and the message sends with that metadata. There is no error toast or inline failure. The model never receives file content or a server-side file id.
- **Reproduction:**
  1. Open any bot chat.
  2. Click **Attach file** and choose a small `.txt` file.
  3. Observe the chip and the network log.
  4. Send a message.
- **Expected:** Upload succeeds and the message references a real attachment, or the UI shows an explicit upload failure and removes the chip.
- **Actual:** `404 POST /api/attachments`; chip remains; the sent bubble renders `upload-test.txt text/plain · 30 B` as if attached.
- **Evidence:** Console reports the 404; no error is surfaced.
- **Round 2:** Upload now returns 200 and stores the file; the remaining content-forwarding gap is BB-049.

### BB-008 — Routines cannot be created

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Routines
- **Description:** The right-panel routine editor posts to `/api/bots/{id}/routines`, which the server does not implement. The panel shows the raw error. There is also no run history because the corresponding endpoints are stubs. Ending a Teach-a-Task recording attempts the same missing routine POST.
- **Reproduction:**
  1. Select a bot and open **Routines** in the right panel.
  2. Click **+** → **Create Routine**.
  3. Fill a name and instructions and click **Save**.
- **Expected:** Routine persists, appears in the list, and can be toggled.
- **Actual:** Panel shows `POST /api/bots/{bot}/routines -> 404`; routine is not saved. `GET …/routines` always returns `[]`.
- **Round 2:** Creation now persists; the handler binding still 404s and nothing executes (BB-050).

### BB-009 — Adding a bot memory fails with an unhandled page error

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Bot memory
- **Description:** The bot settings “Memory” dialog loads from a missing endpoint and adding a memory posts to another missing endpoint. The failure surfaces only as a `pageerror` in the console; the dialog still says “Nothing here yet”.
- **Reproduction:**
  1. Select Principal → **Bot settings** → **Principal Memory & Knowledge**.
  2. Type a memory and click **Add memory**.
- **Expected:** Memory is stored and listed, or a visible inline error explains why not.
- **Actual:** `GET /api/bots/principal/memory -> 404`, `POST /api/bots/principal/memory -> 404`, `pageerror` in console, no user-facing error.

### BB-010 — Every session open requests a missing events endpoint

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Sessions, live updates
- **Description:** Opening any bot or creating any session triggers `GET /api/sessions/{id}/events?since_seq=0`, which returns 404. The console fills with errors and the live event subscription never works, so cross-tab/live updates and interruption events cannot arrive.
- **Reproduction:**
  1. Clear the console.
  2. Open the app, switch bots, or create a new conversation.
- **Expected:** A successful event stream (SSE/WebSocket) or no request when unsupported.
- **Actual:** `404 GET /api/sessions/…/events?since_seq=0` on every open; no live updates.

### BB-011 — Deleting a conversation silently fails

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Sessions
- **Description:** The Space Switcher offers a delete action with a confirmation dialog, but `DELETE /api/sessions/{id}` is not implemented. The dialog closes, the session remains in the list and in `GET /api/sessions`.
- **Reproduction:**
  1. Open the space switcher.
  2. Click the trash icon on any session → **Delete**.
  3. Refresh and check `GET /api/sessions?bot=principal`.
- **Expected:** Session and its messages are removed.
- **Actual:** Session still listed; `DELETE /api/sessions/…` returns 404.

### BB-012 — “Clear conversation” is local-only and messages return after reload

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Conversations
- **Description:** The clear action wipes the in-memory session only. It never calls a delete/clear API, so the persisted server messages come back whenever the session is reopened or the page reloads. The dialog promises “permanently removes every message”.
- **Reproduction:**
  1. On a session with messages, open the bot menu → **Clear conversation** → **Clear**.
  2. Observe the transcript is empty.
  3. Reload and reopen that session from the space switcher.
- **Expected:** Messages are gone permanently.
- **Actual:** The full transcript returns from SQLite.

### BB-013 — Agents, Ops, Decisions, and Cost screens are unreachable (404)

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Deep screens
- **Description:** Four of the six deep screens tell the user “Could not reach the API” because their endpoints are not implemented. This also breaks the command palette destinations and the user-menu entries.
- **Reproduction:**
  1. Visit `/app/fleet`, `/app/ops`, `/app/decisions`, and `/app/cost` (or use the user menu / command palette).
  2. Read each screen.
- **Expected:** Real data or a clear, specific unavailable state tied to the missing capability.
- **Actual:** `404` for `/api/agents`, `/api/ops`, `/api/decisions`, `/api/cost`; each screen renders an error block.

### BB-014 — Usage and spend numbers are fabricated placeholders

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Usage
- **Description:** When `/api/cost` fails, the settings Usage panel falls back to hardcoded `142 runs`, `184,520` tokens, and `119,938 in · 64,582 out`. The screen presents them as real metrics with “Fleet operations healthy”.
- **Reproduction:**
  1. Open Settings → **Usage** (or the user menu → **Usage**).
  2. Read the totals and compare with `GET /api/cost` (404).
- **Expected:** An explicit unavailable state, never invented totals.
- **Actual:** Fabricated totals presented as actual token accounting.

### BB-015 — Computer settings reports a Docker container “Online” and contradicts its own 404

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Settings, architecture honesty
- **Description:** Settings → Computer claims “Docker workspace container: `balabot-balabot-1` — Online” in a zero-Docker product. Its orphan section fails with `GET /api/orphans -> 404` and immediately prints “Every profile on disk is registered in the roster or shipped. Nothing to reconcile.” — a success claim after a failed request. The Refresh button cannot recover, and “Reap sub-agent debris” stays disabled.
- **Reproduction:**
  1. Open Settings → **Computer**.
  2. Read the container line, then the orphan section.
- **Expected:** Truthful local-runtime status and an explicit error for inventory when the API is missing.
- **Actual:** Fake Docker “Online” plus a contradictory false-clean orphan message.
- **Round 2:** The Docker/container copy is gone. Orphan inventory is now hardcoded to zero despite `personas/tester` existing (BB-052).

### BB-016 — Provider keys are localStorage-only; the UI reports “No key saved” while the server has one

- **Status:** Open
- **Severity:** High
- **Area:** Secrets, settings
- **Description:** The Models and Voice settings panels save keys to `localStorage` and never contact the backend. The panel says “No key saved” for every provider even though `OPENROUTER_API_KEY` is configured in `.env` and the server is using it. “Save Key” and “Voice Test” therefore neither prove nor enable anything, and credentials sit in browser storage instead of the OS vault required by the secrets policy.
- **Reproduction:**
  1. Open Settings → **Models** (OpenRouter is the default provider).
  2. Observe `No key saved` / `Not configured`.
  3. Enter any value in the key field and click **Save Key**.
  4. Inspect `localStorage`; then chat with a live-model bot.
- **Expected:** Backend-owned key presence/fingerprint, never the value; saving a key should actually configure the provider.
- **Actual:** Presence is reported from localStorage only; the value is never used by the server; a real configured key is shown as missing.

### BB-017 — Artifacts page is completely unstyled

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Artifacts
- **Description:** The artifacts route renders as a vertical stack of raw HTML: no grid, no card chrome, no header layout, and no spacing. It uses Tailwind utility class names, but the project deliberately ships no Tailwind build, so those classes are inert. This is the “declared capability, zero effect” defect the repo already tracks.
- **Reproduction:**
  1. Navigate to `/app/artifacts`.
  2. Compare with the rest of the Polaris UI; try both light and dark themes.
- **Expected:** A styled card grid with a header and a preview pane.
- **Actual:** Unstyled text list and raw iframe; the artifact detail pane is also unpositioned.

### BB-018 — Artifacts page seeds fabricated artifacts

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Artifacts
- **Description:** `ArtifactsPage` ships three hardcoded “seed” artifacts attributed to non-existent agents (`core-architect`, `ux-designer`, `infra-bot`). There is no artifacts API, so the first visit always shows invented data with relative timestamps (“45m ago”) as if it were real.
- **Reproduction:**
  1. Clear site data for the app (or open a fresh profile).
  2. Visit `/app/artifacts`.
- **Expected:** Empty state or real artifacts from the backend.
- **Actual:** Three fabricated artifacts, one with an embedded HTML preview, with no “demo” label.

### BB-019 — Skill library is never loaded; composer always says “No skills installed”

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Skills
- **Description:** `GET /api/skills/library` returns three shipped skills, but the App never fetches it into composer state. The slash menu therefore always shows “No skills installed”. The Skill Library dialog reads `brought`/`learned`, while the server returns a flat `skills` array, so it also says “No brought skills”. The slash action “Open Skill Library” only raises a toast; it does not open the dialog.
- **Reproduction:**
  1. Open any chat and type `/`.
  2. Observe “No skills installed”.
  3. Choose **Open Skill Library** and observe only the banner.
  4. Press `Cmd/Ctrl+Shift+M`; the dialog opens but the Brought tab is empty despite `/api/skills/library` containing skills.
- **Expected:** Skills load once, appear in both the composer and the library, and the slash action opens the dialog.
- **Actual:** Empty in every place; the slash action is a no-op beyond a banner.

### BB-020 — Skill Library and Agent Computer palette actions do nothing

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Command palette
- **Description:** The palette emits action ids `skills` and `computer`, but the App handles `open-skills` and `open-computer`. Executing those entries closes the palette and does nothing. Verified for both entries.
- **Reproduction:**
  1. Press `Cmd/Ctrl+K`, search “Skill Library”, press Enter.
  2. Repeat with “Open Agent Computer”.
- **Expected:** The requested overlay opens.
- **Actual:** No overlay opens; only the palette closes.

### BB-021 — MCP servers are localStorage-only, with fabricated “Active” entries

- **Status:** Partially fixed
- **Severity:** High
- **Area:** MCP
- **Description:** The MCP overlay ships two default “Active” servers (a container filesystem `npx` command and a Brave endpoint) that no process has verified and that no agent reads. Registering a custom server writes only to `localStorage` and shows the new row as “Active”; the backend has no MCP endpoint and the harness never consumes the registry. Assigning bots has no effect.
- **Reproduction:**
  1. Plugins → **MCP Servers**.
  2. Register a server named “QA MCP” with `https://example.com/mcp`, assigned to Principal.
  3. Inspect `localStorage["balabot:mcp-servers"]` and ask a bot to use it.
- **Expected:** Registration is persisted server-side, health-checked, and available to the assigned bots — or the UI states it is not implemented.
- **Actual:** Row appears as “Active” from local state only; no backend effect.

### BB-022 — Connectors show fabricated “Connected” state and never contact a backend

- **Status:** Fixed — verified
- **Severity:** High
- **Area:** Plugins, connectors
- **Description:** GitHub and Slack are rendered as “Connected” on a fresh profile. Connect/Disconnect only flips component state; there is no OAuth, no credential, no API call, and no persistence beyond the component lifecycle. This tells the user integrations exist when they do not.
- **Reproduction:**
  1. Open Plugins → Connectors.
  2. Observe GitHub and Slack as Connected.
  3. Click **Disconnect** then **Connect** on Linear; reload or close/reopen.
- **Expected:** Real connection status from the backend, or an explicit unavailable state.
- **Actual:** Static/hardcoded status; toggles do nothing.

### BB-023 — Agent Computer is a non-functional stub presented as a live desktop

- **Status:** Open
- **Severity:** High
- **Area:** Agent Computer
- **Description:** The frame endpoint returns an empty `b64` and the dialog shows “Screen unavailable / Pi Durable Virtual Frame Buffer” while still announcing “You have control”. Type/Send/Key/Scroll actions post to a stub that returns `simulated_desktop_action`, with no visible effect. “Teach a task” starts a 10-minute timer and says the bot is “watching, not acting” over an unavailable screen. “More computer actions” opens nothing. The right-panel preview advertises the same empty surface.
- **Reproduction:**
  1. Click the monitor icon (Agent Computer).
  2. Type text and click **Send text**; press keys; scroll.
  3. Click **Teach a task**, enter a goal, **Start recording**.
  4. Click the **…** menu.
- **Expected:** A real sandboxed frame and real input, or a disabled surface with an explicit blocker and no “You have control” claim.
- **Actual:** Empty black frame, simulated actions, fake recording, inert menu.

---

## Medium

### BB-024 — Group setup UI is unstyled and its member tokens expose icon names

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Group chat UI
- **Description:** The group setup dialog is a full-screen sheet with all content pinned to the left and a large empty area; the selected members render as raw strings like `ScaleIcon Governor` and `ShieldCheckIcon Principal` instead of the bot name/avatar. After Create group, the dialog shows “Pick a group” and the group never appears in the sidebar. Opening “Open group” is empty.
- **Reproduction:** Open a group chat dialog, add members, and inspect the tokens and the post-create state.
- **Expected:** A properly laid-out two-column setup with clean member chips, and the new group listed in the roster.
- **Actual:** Unstyled layout, raw icon identifiers in chips, group missing after creation.

### BB-025 — Pause/intervention controls have no working backend

- **Status:** Partially fixed
- **Severity:** Medium
- **Area:** Intervention / Hold everything
- **Description:** The header and composer each show a “Pause bot” pill; both open a popover whose only action (“Pause turn”) is disabled when idle. `POST /api/intervention/pause` is not implemented, so a pause cannot persist. Sending a long request and attempting to pause before it finished did not produce a paused turn; the control returned to `IDLE`. No intervention record or resolution is ever created.
- **Reproduction:**
  1. Click either **Pause bot** control while not streaming.
  2. Observe the disabled **Pause turn** in the popover.
  3. Send a long generation and try to pause it.
- **Expected:** A working pause that halts the turn and a resume/deny path.
- **Actual:** Idle-only dead control; missing API.

### BB-026 — Memory, Voice, Messaging, and Approvals settings are cosmetic

- **Status:** Open
- **Severity:** Medium
- **Area:** Settings
- **Description:** These panels persist to `localStorage` and never affect runtime behaviour. “Test voice” waits 1.8 s and claims “Voice test completed” without playing audio. Approval rules say bots execute tools automatically and that added rules require review, but no server code reads them. Messaging quiet hours do not gate delivery; memory provider/chunk settings do not change retrieval.
- **Reproduction:** Open each tab, change a setting, click its save/test action, then inspect `localStorage` and the server logs/state.
- **Expected:** Settings are enforced by the backend, or the panel explains that the capability is not wired.
- **Actual:** Local-only state and a fabricated voice test result.

### BB-027 — “Check for updates” always reports “up to date” after a fake delay

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Settings, Updates
- **Description:** The button shows “Checking remote repository and release channels…” and then a hardcoded “BalaBot is up to date (Polaris re-base Wave 7…)” after 1.2 s. It never contacts git, a release feed, or npm. The version is also a hardcoded string.
- **Reproduction:** Settings → Updates → **Check for updates**.
- **Expected:** A real check with success/failure and the actual installed version.
- **Actual:** Fixed success message regardless of network or release state.

### BB-028 — User menu is clipped by the sidebar

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Navigation / layout
- **Description:** The bottom-left user popover is clipped at the sidebar’s overflow boundary. Items render as “Fleet & Hie…”, “Cost & Usa…”, “Decisions L…”, “Governanc…”, “Holographi…”, “Container O…”. The menu also sits half outside the sidebar.
- **Reproduction:** At desktop width, click the **Ali** avatar in the sidebar footer.
- **Expected:** A fully visible floating menu over the main surface.
- **Actual:** Truncated menu clipped by the sidebar’s scroll container.

### BB-029 — Reaction picker and message menu are clipped at the right panel

- **Status:** Partially fixed
- **Severity:** Medium
- **Area:** Chat UI
- **Description:** The message reaction picker opens at the bubble’s right edge and the 🚀 emoji is cut off by the right panel; the reaction badge itself is partly hidden under the composer. The “More” menu opens with only a sliver visible (“C…”). Both are effectively unusable at the default open-panel layout.
- **Reproduction:**
  1. Hover the last assistant message and click the emoji.
  2. Observe the picker cut at the right panel.
  3. Click **…** on the same message.
- **Expected:** Popovers flip to stay inside the viewport and above the composer.
- **Actual:** Clipped at the main-panel boundary.

### BB-030 — Narrow layout overlaps header controls and opens the side panel over the chat

- **Status:** Open
- **Severity:** Medium
- **Area:** Responsive layout
- **Description:** At 500 px, the right panel is open by default and covers the transcript. After closing it, the workspace header still overlaps the bot name/“Pause bot” pill; “Jump (Ctrl+K)” and other desktop shortcuts remain. The composer stays at the bottom but the chat is missing behind the panel.
- **Reproduction:** Resize the Chrome window to ~500 px wide, open a bot, then close the right panel.
- **Expected:** Mobile-first header and a closed-by-default side panel, with a clear way to reopen it.
- **Actual:** Overlapping title/pause pill and an overlay panel hiding the main transcript.

### BB-031 — Light theme secondary text is below comfortable contrast

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Theming, accessibility
- **Description:** In light mode, roster status lines (“Shipped · locked”, “No messages yet”), section hints, and message metadata render at very low contrast against the near-white surface. Several muted labels are effectively unreadable.
- **Reproduction:** Switch to light theme via the header icon or Settings → General → Light; inspect the roster and the right panel.
- **Expected:** Text meets WCAG AA contrast in both themes.
- **Actual:** Muted tokens collapse toward the background in light mode.

### BB-032 — Reactions are UI-only and disappear

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Chat
- **Description:** Adding 👍 updates only component state. There is no reactions API and reactions are not written to the session store or `localStorage`, so a reload or bot switch loses them.
- **Reproduction:** Hover a message → 👍, confirm the badge, reload the page, reopen the session.
- **Expected:** Reaction persists per message.
- **Actual:** Badge disappears after reload.

### BB-033 — New conversations are indistinguishable and cannot be renamed

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Sessions
- **Description:** Every new chat is titled “New chat” (server purpose “Principal: New chat”), and palette entries render as “Session sess-1792…”/“Session s_1792…”. Multiple identical entries cannot be told apart. No rename affordance exists. The local title and server purpose also diverge.
- **Reproduction:** Click **New conversation** twice, then open the space switcher and the command palette.
- **Expected:** Distinct, editable conversation names.
- **Actual:** Identical truncated identifiers and no rename action.

### BB-034 — `Cmd/Ctrl+1..9` selects roster order, not pinned bots

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Keyboard shortcuts
- **Description:** With `seo-expert` pinned, `Cmd+1` navigated to `/app/principal` (unpinned) instead of the first pinned bot. The shortcut ignores the pinned section that the docs and palette hints imply.
- **Reproduction:** Pin a bot, then press `Cmd/Ctrl+1`.
- **Expected:** The first pinned bot is selected.
- **Actual:** The first roster bot (Principal) is selected.

### BB-035 — Model picker offers batch variants that break live chat

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Models
- **Description:** The picker lists `:batch` variants (for example `openai/gpt-4o:batch`) with no warning. Selecting one persists it as the bot’s model; it is not suitable for interactive streaming. The picker also contained 469 entries with duplicate version suffixes, and the current default model was absent from the list.
- **Reproduction:** Bot settings → **Frontier Model** → search `gpt-4o` → select the `(batch)` row → check `GET /api/bots`.
- **Expected:** Batch models are filtered or labelled ineligible for chat.
- **Actual:** `model: "openai/gpt-4o:batch"` is persisted with no warning.

### BB-036 — Deleting a bot leaves its persona directory behind

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Bot lifecycle
- **Description:** Deleting a UI-created bot returned `{success:true,purged:"quill"}`, but `personas/quill/` (including `SOUL.md`) remained on disk. There is no purge endpoint in the modern server, so repeated test hires accumulate orphan profiles that the roster cannot see.
- **Reproduction:** Hire a bot, then Delete it with typed confirmation; check `personas/`.
- **Expected:** The persona workspace and metadata are removed, or the response does not claim “purged”.
- **Actual:** Directory remains (`personas/quill/SOUL.md`); response claims purge.

### BB-037 — Proposals live only in server memory

- **Status:** Fixed — verified
- **Severity:** Medium
- **Area:** Proposals
- **Description:** The proposal registry is a `Map` on the server object. Restarting the server loses every pending/approved proposal, while created bots and their personas persist. This breaks the consent trail and leaves approved proposals that will never register.
- **Reproduction:** Create a proposal, restart `npm run server`, check `GET /api/bot-proposals`.
- **Expected:** Proposals persist in SQLite with their decision history.
- **Actual:** Empty list after restart (code-confirmed; no restart performed against the session server).

### BB-038 — Memory and Governance are permanently empty placeholders

- **Status:** Partially fixed
- **Severity:** Medium
- **Area:** Memory / Governance
- **Description:** `/api/memory` always returns `{facts: []}` and `/api/governance` always returns `{decisions: []}` regardless of session content or audits. The screens therefore show “0 facts” and “0 entries” even after real conversations and recorded decisions. The views do not explain that the data source is not wired.
- **Reproduction:** Chat with a bot, then visit `/app/memory` and `/app/governance`.
- **Expected:** Real facts/decisions or an explicit “not connected” state.
- **Actual:** Silent empty state from hardcoded responses.

---

## Low

### BB-039 — Un-hiding a bot is labelled “Archive”

- **Status:** Fixed — verified
- **Severity:** Low
- **Area:** Hidden bots
- **Description:** The Hidden Bots drawer offers the same **Archive** item for a hidden bot; clicking it unhides the bot. The action label is wrong for the current state, so the only restore affordance looks destructive.
- **Reproduction:** Archive a bot, open **Hidden Bots**, open its menu.
- **Expected:** “Unhide” / “Restore”.
- **Actual:** “Archive” (which actually unhides).

### BB-040 — No-match state says the roster is empty

- **Status:** Fixed — verified
- **Severity:** Low
- **Area:** Roster search
- **Description:** Searching for a non-existent bot shows “No bots in the roster yet.” even though bots exist and the list is filtered. It should distinguish no matches from an empty roster.
- **Reproduction:** Type `zzzz` into the bot search box.
- **Expected:** “No bots match ‘zzzz’.”
- **Actual:** “No bots in the roster yet.”

### BB-041 — Two “Pause bot” controls are always visible, even when idle

- **Status:** Fixed — verified
- **Severity:** Low
- **Area:** Chat UI
- **Description:** The header pill and composer pill duplicate the same control. Both stay visible (and enabled) while the bot is idle; the only action inside is disabled. This suggests the bot is pausable when it is not doing anything.
- **Reproduction:** Open any bot with no turn running; compare header and composer.
- **Expected:** One control, enabled only during a turn.
- **Actual:** Two identical idle pills with a dead action.

### BB-042 — “Team Fleet” in the space switcher does nothing

- **Status:** Open
- **Severity:** Low
- **Area:** Navigation
- **Description:** The Space Switcher lists “Personal Space” and “Team Fleet”, but selecting Team Fleet leaves the trigger on Personal Space and no scope changes.
- **Reproduction:** Click the space trigger → **Team Fleet**.
- **Expected:** The active space changes, or the item is marked unavailable.
- **Actual:** Nothing happens.

### BB-043 — Legacy Docker/container wording remains in a zero-Docker product

- **Status:** Fixed — verified
- **Severity:** Low
- **Area:** Copy, architecture
- **Description:** The user menu still has “Container Ops”; Settings → Computer shows `Docker workspace container: balabot-balabot-1`; Settings → Memory describes “Embedded SQLite … under /opt/data/memory”. These are legacy container concepts that contradict the zero-Docker architecture and mislead the user.
- **Reproduction:** Open the user menu and Settings → Computer / Memory.
- **Expected:** Local native paths (e.g. `~/Library/Application Support/balabot/data`) and no Docker wording.
- **Actual:** Container-specific copy and paths.

### BB-044 — “Show thinking” checkbox has no accessible name

- **Status:** Fixed — verified
- **Severity:** Low
- **Area:** Accessibility
- **Description:** The bot settings checkbox has no `aria-label`, no associated `<label>`, and no text content; screen readers announce an unnamed checkbox. The adjacent text is not a label element.
- **Reproduction:** In bot settings, inspect the checkbox in the accessibility tree / DOM.
- **Expected:** A programmatic label such as “Show thinking”.
- **Actual:** Unnamed checkbox.

### BB-045 — Test-fixture conversations are visible in the user’s session list

- **Status:** Fixed — verified
- **Severity:** Low
- **Area:** Data hygiene
- **Description:** The shipped development database contains sessions named `test-live-server`, `test-live-run`, `test-err`, `test-live-key`, `test-user-turn`, etc. They appear in the user’s space switcher and command palette as real conversations.
- **Reproduction:** Open the space switcher on a fresh boot of this environment.
- **Expected:** Only real conversations, or clearly labelled fixtures.
- **Actual:** Test fixtures presented as user sessions.

### BB-046 — “New bot or group” only opens bot creation

- **Status:** Partially fixed
- **Severity:** Low
- **Area:** Navigation
- **Description:** The sidebar’s “New bot or group” button always opens the bot proposal panel; there is no group option in that flow. Group creation is only reachable through the command palette.
- **Reproduction:** Click the icon next to the sidebar title.
- **Expected:** A chooser (bot vs group) or two distinct actions.
- **Actual:** Bot creation only.

### BB-047 — Deep link to a deleted bot silently shows Principal

- **Status:** Fixed — verified
- **Severity:** Low
- **Area:** Routing
- **Description:** Visiting `/app/quill` after deleting `quill` leaves the URL unchanged but renders Principal’s chat, so the address bar and content disagree. There is no “bot not found” state.
- **Reproduction:** Delete a bot, then navigate to `/app/<deleted-id>`.
- **Expected:** A not-found state with a route back to the roster.
- **Actual:** Principal’s chat under the deleted bot’s URL.

### BB-048 — Reply preview renders the whole raw message, including `openui-lang` source

- **Status:** Open
- **Severity:** Low
- **Area:** Chat UI
- **Description:** Clicking **Reply** on an assistant message puts the entire message into the quote bar, including the fenced `openui-lang` program and code. The one-line preview becomes a wall of context and pushes the composer area around.
- **Reproduction:** Hover a message containing an OpenUI card → **Reply**.
- **Expected:** A short, clipped text snippet with the raw fence stripped.
- **Actual:** Full raw message, including the UI DSL.

---

## New issues — round 2

### BB-049 — Uploaded attachments are never sent to the model

- **Status:** Open
- **Severity:** High
- **Area:** Attachments
- **Description:** Upload now succeeds and the chip renders, but `/api/chat` ignores the `attachments` array. The harness builds history from message text only, so the model never sees the file bytes, URL, name, or metadata. The UI gives every appearance of a successful attachment.
- **Reproduction:**
  1. Start a new conversation with Principal.
  2. Attach a text file containing `PURPLE-ELEPHANT-42`.
  3. Send “What code is in the attached file? Answer with just the code.”
- **Expected:** The model can read the file and replies `PURPLE-ELEPHANT-42`.
- **Actual:** The model replies “No file came through — nothing is attached to this message.”
- **Evidence:** The attachment API stored the file under `~/.balabot/data/attachments/`, and the transcript rendered `secret-note.txt text/plain · 19 B`; the reply proves the payload was not forwarded.

### BB-050 — Routines save but never execute; handler binding returns 404

- **Status:** Open
- **Severity:** High
- **Area:** Routines
- **Description:** The create form now persists a routine, but the follow-up `POST /api/bots/{bot}/routines/{routineId}/handler` returns 404 and the editor displays the raw error. The server also has no scheduler or execution path for routines, so an “Active routine” is inert. This is a capability claim with no effect.
- **Reproduction:**
  1. Select any bot → right panel → **Create Routine**.
  2. Fill a name, schedule, and prompt → **Save**.
  3. Read the error and inspect `GET /api/bots/{bot}/routines`.
- **Expected:** The routine is bound to an executor, scheduled, and visible with run history.
- **Actual:** Routine row exists, but the panel says `POST …/handler -> 404`; nothing ever runs it.

### BB-051 — Real model turns are never recorded in usage or cost

- **Status:** Open
- **Severity:** Medium
- **Area:** Usage / Cost
- **Description:** The fake 142-run fallback is gone, but the new accounting still has no writer. `/api/cost` returns `{rows: []}` forever, so the Cost screen shows `$0.00` and “0 models” even after several real OpenRouter turns. The Usage settings panel shows “No usage recorded yet.”
- **Reproduction:**
  1. Send two or three successful messages to Principal.
  2. Open `/app/cost` and Settings → Usage.
- **Expected:** Token counts and spend update from the turns just executed.
- **Actual:** Every counter stays at zero; there is no usage table or recording hook in the harness.

### BB-052 — Orphan reconciliation always reports zero

- **Status:** Open
- **Severity:** Medium
- **Area:** Orphans / Computer settings
- **Description:** The endpoint is hardcoded to `count: 0, orphans: [], profiles: []` instead of scanning `personas/`. During the recheck `personas/tester` existed with no roster row, while Settings → Computer still said “Every profile on disk is registered in the roster or shipped. Nothing to reconcile.” The adopt/purge UI therefore cannot see real debris.
- **Reproduction:**
  1. Create a directory under `personas/` that is not in the roster (or observe the existing `tester` directory).
  2. Open Settings → Computer.
  3. Compare with `GET /api/orphans`.
- **Expected:** The orphan appears with adopt/purge actions.
- **Actual:** Forced empty list and a false all-clear.

### BB-053 — “Pause turn” records a flag but generation continues

- **Status:** Open
- **Severity:** High
- **Area:** Intervention / Hold everything
- **Description:** `POST /api/intervention/pause` only stores an in-memory `{paused: true, token}`. It does not abort the active harness turn or prevent further tokens. In the UI, clicking **Pause turn** during a live stream left the bot “Working…” and the answer kept growing. The flag also survives the turn, so a stale pause record later makes “Pause bot” appear while the bot is idle, with no resolution UI.
- **Reproduction:**
  1. Send a long generation to Principal.
  2. While “Working…”, open the Pause bot popover and click **Pause turn**.
  3. Watch the stream for several seconds; then check `GET /api/intervention/active/principal`.
- **Expected:** Generation stops immediately and the UI shows a resolvable intervention state.
- **Actual:** Content continues; the active record remains set after the turn ends.

### BB-054 — Group messages never invoke group members

- **Status:** Open
- **Severity:** High
- **Area:** Groups
- **Description:** The group dialog claims “serial rounds” and “leave it bare for every member in order”, but `/api/groups/{gid}/turn` only appends the user's message and returns `results: []`. After sending to a two-bot group, the transcript contains only the user row, the round increments, and both members show `0 msgs`. No bot ever answers, with or without `@mention`.
- **Reproduction:**
  1. Create a group with Principal and Governor.
  2. Send “hello group” and wait.
  3. Also try `@principal hello`.
- **Expected:** Each member takes a serial turn (or a clear “group execution unavailable” state).
- **Actual:** Only the user's message is recorded; no member output.

### BB-055 — “New bot or group” menu never opens

- **Status:** Open
- **Severity:** High
- **Area:** Navigation
- **Description:** The sidebar's create button now wraps a Popover with “New Bot” and “New Group Chat”, but the popover never becomes visible. The trigger reports `aria-expanded="false"` after click, keyboard Enter, and pointer down/up; the menu buttons remain 0×0. Bot/group creation is only reachable through the command palette.
- **Reproduction:**
  1. Click the circular **+** next to the sidebar title (aria-label “New bot or group”).
  2. Inspect the page; repeat with keyboard or after a reload.
- **Expected:** A two-item menu opens.
- **Actual:** Nothing opens; only the hidden menu nodes exist in the DOM.

### BB-056 — Group roster stays stale after create/delete until reload

- **Status:** Open
- **Severity:** Low
- **Area:** Groups
- **Description:** Creating a group does not add it to the sidebar's Group Chats section until the page reloads; deleting one leaves the deleted group visible with its old preview until reload. The dialog itself updates correctly.
- **Reproduction:**
  1. Create a group and close the dialog; the sidebar still lacks it.
  2. Delete the group; the sidebar still shows it.
  3. Reload; the state corrects.
- **Expected:** The roster refreshes immediately after both mutations.
- **Actual:** Stale sidebar until reload.


### BB-057 — Deleting a bot leaves its routines and memories in SQLite

- **Status:** Open
- **Severity:** Medium
- **Area:** Bot lifecycle
- **Description:** `DELETE /api/bots/{id}` now purges the persona directory, but it does not remove dependent rows. After deleting the test bot, `bot_routines` still held its routine and `bot_memories` still held its note, both keyed by a bot id that no longer exists. Repeated hires/deletes accumulate invisible data.
- **Reproduction:**
  1. Create a bot, add a routine and a memory.
  2. Delete the bot (typed confirmation).
  3. Query `bot_routines` and `bot_memories` for its id, or re-create a bot with the same id.
- **Expected:** Dependent rows are deleted with the bot.
- **Actual:** Rows remain; the response still says the bot was purged.


---

## Notes for triage (round 2)

- **Fix before any demo:** BB-003 (default model is not in the live catalogue), BB-016 (keys live in localStorage and are shown as missing), BB-023 (Agent Computer is still a stub), BB-025/BB-053 (pause does not stop a turn), and BB-026 (approval/messaging/memory settings do not gate anything).
- **New honesty gaps exposed by the fixes:** BB-049 (attachment content never forwarded), BB-050 (routines never execute), BB-051 (no usage recording), BB-052 (orphan scan is hardcoded zero), BB-054 (group members never run), and BB-055 (create menu is dead).
- **Cheap UI wins:** BB-029 (More menu clipped), BB-030 (narrow layout), BB-042 (Team Fleet no-op), BB-048 (raw reply preview), and BB-056 (stale group sidebar).
- **Recheck policy:** a "Fixed — verified" item was exercised through the UI in round 2. A "Partially fixed" item has a working first half and a named remaining gap, usually with a new BB entry.
- **Test artifacts:** the round-2 test bot, group, sessions, and MCP registration were removed. `personas/tester` is pre-existing debris and was intentionally left as evidence for BB-052.
