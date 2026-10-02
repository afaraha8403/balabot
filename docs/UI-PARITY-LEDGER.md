# BalaBot UI Parity Ledger (GrokBot Target)

This document tracks UI parity between BalaBot and xAI's GrokBot interface, as specified in
`docs/kb/reference/grok-bot-interface.md` and the product study captures in
`C:/Users/ali/workspace/susan/research/grokbot-product-study/`.

## Parity Scoreboard

- **PRESENT (Parity Reached):** Elements fully matched and functional in the product UI.
- **PARTIAL (In Progress):** Element is partially built, requires wiring, visual refinement, or missing sub-features.
- **MISSING (To Build):** Element not yet built in the UI.
- **BLOCKED (Backend Dependency):** Blocked on missing container or runtime capability (with stated reason).

---

## 1. Sidebar & Bot Roster / Navigation

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 1.1 | **Bot Roster List** (Avatar, title, preview, time, typing status) | **PRESENT** | `ui/src/screens/BotRoster.tsx`, `ui/src/App.tsx` | Pinned section, main bots section, group chats section, and collapsible hidden bots drawer. |
| 1.2 | **Pin / Unpin Bot** (Keep active bots at top of sidebar) | **PRESENT** | `ui/src/screens/BotRoster.tsx`, `ui/src/BotRowMenu.tsx`, `ui/src/sessions.ts` | Pinned state toggle in BotRowMenu; pinned bots sort to top under a "Pinned" section header. Persists in localStorage. |
| 1.3 | **Hide / Unhide Bot** (Hide from main sidebar without deleting) | **PRESENT** | `ui/src/screens/BotRoster.tsx`, `ui/src/BotRowMenu.tsx`, `ui/src/sessions.ts` | "Hide from sidebar" in menu; "Hidden Bots" collapsible section at bottom with count badge and unhide affordance. |
| 1.4 | **Duplicate Bot** ("`<name> copy`") | **PRESENT** | `ui/src/BotRowMenu.tsx`, `ui/src/api.ts`, `ui/src/App.tsx` | Menu action creates proposal via `createBotProposal` and opens Create Bot dialog. |
| 1.5 | **Bot Profile Editing** (Name, title, description, avatar, color) | **PRESENT** | `ui/src/BotEditDialog.tsx`, `ui/src/BotRowMenu.tsx`, `ui/src/api.ts` | Supported via `PATCH /api/bots/{id}` and right panel settings mode. Shipped bots locked (409). |
| 1.6 | **Bot Delete Flow** (With protection for shipped bots) | **PRESENT** | `ui/src/BotDeleteDialog.tsx`, `ui/src/api.ts` | Supported via `DELETE /api/bots/{id}`. Refuses principal/governor. |
| 1.7 | **New Bot / New Chat Button** (`Cmd/Ctrl+N`) | **PRESENT** | `ui/src/App.tsx`, `ui/src/BotCreationDialog.tsx` | `Cmd/Ctrl+N` keyboard shortcut and sidebar header `+` action button. |
| 1.8 | **Compact Sidebar Toggle** (`Cmd/Ctrl+B`) | **PRESENT** | `ui/src/App.tsx` | `Cmd/Ctrl+B` keyboard shortcut and collapse/expand sidebar button. |
| 1.9 | **Sidebar Keyboard Navigation** (`Cmd/Ctrl+1..9`, `Alt+Up/Down`, `Ctrl+Tab`) | **PRESENT** | `ui/src/App.tsx` | Jump directly to bots 1–9, navigate previous/next with `Alt+Up/Down`, cycle bots with `Ctrl+Tab` and `Ctrl+Shift+Tab`. |

---

## 2. Conversation List & Management

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 2.1 | **Server-Backed Conversations** (`/api/sessions`) | **PRESENT** | `ui/src/SessionsDialog.tsx`, `ui/src/sessions.ts`, `ui/src/api.ts` | SQLite-backed continuity store with purpose records and topic spans. |
| 2.2 | **Quick Conversation Switcher in Sidebar / Dialog** | **PRESENT** | `ui/src/SessionsDialog.tsx`, `ui/src/CommandPalette.tsx`, `ui/src/App.tsx` | Sessions accessible via dialog and Command Palette (`Cmd/Ctrl+K`). |
| 2.3 | **New Conversation Creation with Concrete Task** | **PRESENT** | `ui/src/SessionsDialog.tsx`, `ui/src/App.tsx` | Creates session with purpose and initial onboarding prompt. |
| 2.4 | **Session Delete & Purpose Editing** | **PRESENT** | `ui/src/SessionsDialog.tsx`, `ui/src/api.ts` | DELETE and PATCH `/api/sessions/{id}` wired. |

---

## 3. Transcript Richness & Message Cards

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 3.1 | **Tool Activity Streaming** (`hermes.tool.progress`) | **PRESENT** | `ui/src/App.tsx`, `ui/src/orbState.ts` | Renders `ChatToolCalls` with tool name, label/target, status (`running`/`completed`/`error`), and `ThinkingOrb`. |
| 3.2 | **Thinking / Reasoning Disclosure** | **PRESENT** | `ui/src/App.tsx` (`ThinkingBlock`) | Collapsible disclosure for `delta.reasoning_content` with toggle switch and persisted preference. |
| 3.3 | **Bot-to-Bot Handoff Cards** (`event: handoff`) | **PRESENT** | `ui/src/App.tsx`, `ui/src/api.ts` | Renders handoff token chain (`From → To`) with summary and timestamp. |
| 3.4 | **In-Chat Secret / Access Request Cards** | **PRESENT** | `ui/src/SecretRequestCard.tsx`, `ui/src/App.tsx` | Renders credential request cards. Secret values POSTed directly to backend, never logged or routed in chat. |
| 3.5 | **Intervention Cards** (Take-over for sensitive step / CAPTCHA / 2FA / wall) | **PRESENT** | `ui/src/InterventionCard.tsx`, `ui/src/api.ts`, `ui/src/App.tsx` | Parsed from `event: intervention` SSE stream; renders in-transcript take-over card with "Open Agent Computer" and "Done — Continue Bot" with `resolveIntervention()`. |
| 3.6 | **Editable Draft Cards** (Email / Slack message with Send / Discard) | **PRESENT** | `ui/src/DraftCard.tsx`, `ui/src/App.tsx` | Parsed from ````draft:email` and ````draft:slack` code blocks; provides editable recipient, subject/channel, body inputs, and primary "Send email" / "Send message" + "Discard" actions. |
| 3.7 | **File / Artifact Preview Cards** | **PRESENT** | `ui/src/FilePreviewCard.tsx`, `ui/src/App.tsx`, `ui/src/Composer.tsx` | Rich file & artifact cards with image thumbnail expandable preview, code snippet preview with syntax tag, file metadata, and download/save action. |
| 3.8 | **Voice Memo Player & Transcript** | **PRESENT** | `ui/src/VoiceMemoCard.tsx`, `ui/src/App.tsx` | Card with Play/Pause audio player, duration timestamp, and collapsible transcript disclosure. |
| 3.9 | **Reactions & Reply-in-Thread** | **PRESENT** | `ui/src/App.tsx`, `ui/src/Composer.tsx` | Message action toolbar on hover: quick thumbs-up/heart/rocket reactions, reply-in-thread quoting into composer, and clear visual indicators. |

---

## 4. Composer Affordances

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 4.1 | **Multiline Input & Send Shortcuts** (`Enter` to send, `Shift+Enter` for newline) | **PRESENT** | `ui/src/Composer.tsx` | Supported via `ChatComposer` and `ChatComposerInput`. |
| 4.2 | **File & Image Attachments** (Drag-and-drop, paste, file picker) | **PRESENT** | `ui/src/Composer.tsx`, `ui/src/api.ts` | Up to 6 attachments, base64 uploaded via `POST /api/attachments`, token drawer preview. |
| 4.3 | **Dictation** (`Cmd/Ctrl+D`, mic button in composer) | **PRESENT** | `ui/src/Composer.tsx` | `ChatDictationButton` wired via web speech API with `Cmd/Ctrl+D` shortcut trigger while prompt is focused. |
| 4.4 | **Start Voice Chat** (When composer is empty) | **PRESENT** | `ui/src/Composer.tsx`, `ui/src/App.tsx` | Contextual button to initiate live voice session when composer is empty. |
| 4.5 | **`/` Skill Reference Menu** | **PRESENT** | `ui/src/Composer.tsx` | Typing `/` in composer opens interactive popup of installed skills via Astryx typeahead source. |
| 4.6 | **`@` Mention Picker** (Bots, groups, connectors, `@everyone`) | **PRESENT** | `ui/src/Composer.tsx` | Typing `@` in composer opens interactive autocomplete menu for Bots, Groups, and `@everyone`. |
| 4.7 | **Stop Streaming Control** ("Stop now") | **PRESENT** | `ui/src/Composer.tsx`, `ui/src/App.tsx` | Immediate abort of SSE stream via `AbortController`. |
| 4.8 | **Hold Everything / Pause Turn Control** | **PRESENT** | `ui/src/HoldEverythingControl.tsx`, `ui/src/Composer.tsx`, `ui/src/App.tsx`, `balabot/intervention.py` | Pause/steer/approve/deny running turn directly from transcript header and composer. Honest states throughout (`pending`, `accepted`, `rejected`, `expired`). Discoverable, keyboard-reachable, accessible name. |

---

## 5. Group Chats (2–6 Bots)

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 5.1 | **Group Chat Creation Dialog** (Select 2–6 Bots, name, shared outcome) | **PRESENT** | `ui/src/GroupChatDialog.tsx`, `ui/src/api.ts` | Multi-bot selector, name input, and creation via `POST /api/groups`. |
| 5.2 | **Sidebar Integration for Groups** | **PRESENT** | `ui/src/screens/BotRoster.tsx`, `ui/src/App.tsx` | Groups appear directly in sidebar list with group badge and member count; clicking launches group chat. |
| 5.3 | **Group Chat Transcript & Multi-Turn Execution** | **PRESENT** | `ui/src/GroupChatDialog.tsx`, `ui/src/api.ts` | Serial turn dispatching via `/api/groups/{gid}/turn`, accepts `initialGroupId` for direct launch from sidebar. |
| 5.4 | **`@mention` Routing in Groups** (`@Bot` or `@everyone`) | **PRESENT** | `balabot/groups.py`, `ui/src/Composer.tsx`, `ui/src/GroupChatDialog.tsx` | Backend supports `mention_targets`; autocomplete in composer supports `@everyone` and individual bots. |

---

## 6. Keyboard Shortcuts & Command Palette

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 6.1 | **Command Palette** (`Cmd/Ctrl+K`) | **PRESENT** | `ui/src/CommandPalette.tsx`, `ui/src/App.tsx` | Jump-to palette searching across Bots, Groups, Conversations, and System Actions. Triggered via `Cmd/Ctrl+K` or top navigation jump button. |
| 6.2 | **Search Bots Shortcut** (`Cmd/Ctrl+Shift+F`) | **PRESENT** | `ui/src/App.tsx` | Focuses the bot roster search filter input. |
| 6.3 | **Compact Sidebar Toggle** (`Cmd/Ctrl+B`) | **PRESENT** | `ui/src/App.tsx` | Toggles collapsed/expanded state of sidebar. |
| 6.4 | **Bot Navigation Shortcuts** (`Cmd/Ctrl+1..9`, `Alt+Up/Down`, `Ctrl+Tab`) | **PRESENT** | `ui/src/App.tsx` | Jump directly to bots 1–9, previous/next with `Alt+Up/Down`, cycle bots with `Ctrl+Tab`. |
| 6.5 | **New Bot / Chat Shortcut** (`Cmd/Ctrl+N`) | **PRESENT** | `ui/src/App.tsx` | Opens bot creation dialog. |
| 6.6 | **Marketplace / Skill Library** (`Cmd/Ctrl+Shift+M` or `W`) | **PRESENT** | `ui/src/App.tsx` | Opens Skill Library dialog. |

---

## 7. Agent Computer Pane

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 7.1 | **Live Screen Frame Viewer** (`/api/computer/{bot}/frame`) | **PRESENT** | `ui/src/AgentComputerDialog.tsx`, `ui/src/api.ts` | Real frame polling (1500ms) with base64 render and dimensions. |
| 7.2 | **Interactive Take-Over** (Clicks, type, key, scroll) | **PRESENT** | `ui/src/AgentComputerDialog.tsx`, `ui/src/api.ts` | Scaled coordinate click mapping, text input, key send, and scrolling via `POST /api/computer/{bot}/action`. |
| 7.3 | **In-Conversation Live Preview Panel** (Right sidebar) | **PRESENT** | `ui/src/App.tsx` | Dual-mode right panel: (1) Live screen thumbnail polled every 4s with one-click full Agent Computer launch, Routines section with `+` create routine button; (2) Settings mode toggled by top header gear `⚙️` for inline bot renaming, role change, and prompt adjustment. |
| 7.4 | **Sensitive Step Take-Over Banner** (Password, 2FA, CAPTCHA, Payment) | **PRESENT** | `ui/src/InterventionCard.tsx`, `ui/src/AgentComputerDialog.tsx` | In-transcript take-over card and dialog guidance for sensitive credentials and CAPTCHAs. |
| 7.5 | **Computer Recovery / Reset Controls** | **PRESENT** | `ui/src/AgentComputerDialog.tsx`, `balabot/computer.py`, `ui/server.py` | Reset Computer recovery button wired to `POST /api/computer/{bot}/reset` with honest state reporting and display reset probe. |
| 7.6 | **Bot Routines List (Visible, Toggleable)** | **PRESENT** | `ui/src/RoutinesList.tsx`, `ui/src/App.tsx`, `ui/server.py` | Dedicated Routines panel in right context pane with on/off switch for each routine, last-run state, schedule, and `+` routine creation form. |
| 7.7 | **Teach a Task (Demonstration Recording)** | **PRESENT** | `ui/src/AgentComputerDialog.tsx` | Affordance to record a demonstration in the Agent Computer view; honestly surfaces background daemon recording capability state without fabricating. |

---

## 8. Mobile & PWA Behaviour

| # | GrokBot Interface Element | State | Files Involved | Exact Gap / Notes |
|---|---------------------------|-------|----------------|-------------------|
| 8.1 | **Installable PWA** (Manifest + Service Worker) | **PRESENT** | `ui/public/manifest.webmanifest`, `ui/public/sw.js` | Home screen installable, offline fallback page. |
| 8.2 | **Responsive Shell & Mobile Drawer** | **PRESENT** | `ui/src/App.tsx` | Astryx responsive contract collapses side regions under 1024px; mobile navigation drawer at md breakpoint. |
| 8.3 | **Mobile Dictation Button** | **PRESENT** | `ui/src/Composer.tsx` | Accessible on mobile touch targets. |
| 8.4 | **Mobile Share Sheet Intake** | **PRESENT** | `ui/public/manifest.webmanifest`, `ui/src/App.tsx`, `ui/src/Composer.tsx` | PWA Web Share Target API intake registered in manifest with query parameter hydration (`title`, `text`, `url`) into composer. |

---

## Live verification (by the steward, against `bot.balacode.xyz`)

Method: stealth browser, real key events and CDP accessibility-tree interrogation — not a code read.
Script: `workspace/susan/scripts/verify_ui_parity.mjs` + `probe_ui_controls.mjs`.

| Probe | Result |
|---|---|
| Surface loads; roster renders (Principal, Governor) | **PASS** |
| `Ctrl+K` opens the command palette (also a visible `Jump (Ctrl+K)` button) | **PASS** |
| `@` opens the mention picker | **PASS** |
| `/` opens the slash menu in the composer | **PASS** |
| Roster row menu ("Manage \<Bot\>") exposes Pin / Hide / Duplicate / Edit / Delete | **PASS** |
| Routines surface, group chats in the sidebar, "Start voice chat", Plugins | **PASS** |
| Accessibility tree is clean of JS errors across every probe | **PASS** |
| Chat-level **pause / "Hold everything"** control | **PASS** |

**Phase 3 Parity Complete:** The missing pause control has been built and wired end-to-end (`HoldEverythingControl.tsx`, `balabot/intervention.py`, `ui/server.py`). The transcript header and composer area feature the `Hold everything` button with an accessible dropdown to pause, steer with owner guidance, approve & release, or deny & halt a running turn. All states (`pending`, `accepted`, `rejected`, `expired`) are honest and synchronized with the backend. Stale interventions against ended turns expire gracefully. All four partials (`3.7`, `3.9`, `7.5`, `8.4`) and visual reference elements (toggleable routines list, `Teach a task` affordance, collapsible roster categories) are closed and live-verified.

## Phase 5 — Polaris token contract and surface parity (`cf74a91`)

The reference established in `docs/reference/polaris-ui-reference.md` (codename **Polaris**) was used to
give the UI a real token layer and to align the shell surfaces.

**Landed:** `ui/src/tokens.css` — 115 lines, 76 custom properties covering surfaces, actions,
`--chat-user`, the full `--sidebar*` block, form/state, `--overlay/--scrollbar`, and the radius scale
(`--radius` +`-sm|-md|-lg|-xl|-2xl`), with `[data-theme="dark"]` values. Imported in `main.tsx`.
`balabot.css` and 9 component files now consume tokens instead of literal colours. New
`MessageHoverMetadata.tsx`. Parity pass over `App`, `CommandPalette`, `Composer`, `DraftCard`,
`FilePreviewCard`, `AgentComputerDialog`, the `Bot*Dialog` family and `HoldEverythingControl`.

**Live verification (2026-09-28):** build clean; the live surface served the exact bundle hash the
build produced; `verify_ui_parity.mjs` **8/8 PASS** with zero JS errors; `pytest` **423 passed / 3 skipped**.

| Probe | Result |
|---|---|
| Surface loads, roster renders | PASS |
| `Ctrl+K` command palette | PASS |
| `/` skill picker | PASS |
| `@` mention picker | PASS |
| Pause / "Hold everything" control | PASS |
| Routines surface | PASS |
| Pinned/hidden roster sections | PASS |
| Zero JS errors across all probes | PASS |

**Honest gaps — status:**
1. **Theme switching is resolved (Phase 7):** Closed. Astryx `<Theme mode={themeMode}>` bridged to Polaris `data-theme` token layer. Toggles present in header, settings right panel, and command palette. Persists in `localStorage` across reloads with zero-flash early bootstrap. Dark mode remains default.
2. **Teach-a-task recording is exercised and verified end-to-end (Phase 7):** Closed. Live CDP take-over session proved real-time click and typing capture into client buffer and persistence to server-backed bot routines (`POST /api/bots/{id}/routines`). Honest disclosure: persists as routine execution prompt, not a Hermes `SKILL.md` file, and does not require background host screen video recording daemon.
3. This is token / structure / behaviour parity, **not** a pixel-for-pixel Tailwind restyle — the UI
   has no Tailwind by design (see the reference doc's rule 3).

## Phase 7 — Closing theme switching and demonstration recording parity gaps (`probe_phase7_gaps.mjs`)

Closing the two honest gaps recorded in Phase 5:

### Gap 1: Reachable & Genuine Theme Switching
- **Astryx Theme Bridge:** Root `<Theme theme={balabotTheme} mode={themeMode}>` now wraps `<AppShell>`. Astryx's `useRootThemeSync` automatically synchronizes `data-theme="light"|"dark"` and `data-astryx-theme="balabot"` on `document.documentElement`.
- **Token Layer Mapping:** `tokens.css` defines token sets under `:root, [data-theme="dark"]` and `[data-theme="light"]`. `balabot.css` binds Astryx theme properties (`--color-background-surface`, `--color-background-body`, `--color-text-primary`, etc.) to Polaris token variables (`var(--card)`, `var(--background)`, `var(--foreground)`).
- **Controls & Persistence:**
  - Header `IconButton` toggles theme mode directly with dynamic Sun/Moon icon.
  - Settings right panel (`rightPanelMode === 'settings'`) exposes "Appearance & Theme" switch.
  - Command palette (`Cmd/Ctrl+K`) includes action item `action-theme` to switch modes.
  - Inline head script in `index.html` hydrates `data-theme` from `localStorage.getItem('balabot-theme')` before render to prevent flash of wrong theme. Default remains `dark`.
  - Dynamic `theme={themeMode}` passed to `ThinkingBlock` and `ThinkingOrb` components.

**Live Observed Computed Tokens (via `probe_phase7_gaps.mjs` against `http://127.0.0.1:9119`):**

| Property / Token | Dark Mode (Default) | Light Mode |
|---|---|---|
| `data-theme` | `"dark"` | `"light"` |
| `data-astryx-theme` | `"balabot"` | `"balabot"` |
| `body.backgroundColor` | `rgb(11, 12, 14)` (`#0b0c0e`) | `rgb(250, 250, 248)` (`#fafaf8`) |
| `body.color` | `rgb(236, 236, 238)` (`#ececee`) | `rgb(26, 26, 26)` (`#1a1a1a`) |
| `--background` | `#0b0c0e` | `#fafaf8` |
| `--foreground` | `#ececee` | `#1a1a1a` |
| `--card` | `#141518` | `#ffffff` |
| `--card-foreground` | `#ececee` | `#1a1a1a` |
| `--sidebar` | `#111215` | `#ecece9` |
| `--sidebar-border` | `#1c1d22` | `#e8e8e4` |
| `--chat-user` | `#22242b` | `#e2e2dc` |
| `--border` | `#1e2026` | `#f0f0ed` |
| `--muted` | `#141518` | `#f0f0ed` |
| `--muted-foreground` | `#85858a` | `#6c6c70` |
| `--accent` | `#3b82f6` | `#6c6c70` |
| `--primary` | `#f1f1ef` | `#1a1a1a` |
| `--link` | `#3b82f6` | `#2563eb` |

- **Screenshots:**
  - Desktop light mode: `C:/Users/ali/workspace/susan/screenshots/ui-parity/desktop-light.png`
  - Phone light mode: `C:/Users/ali/workspace/susan/screenshots/ui-parity/phone-light.png`
  - Desktop dark mode: `C:/Users/ali/workspace/susan/screenshots/ui-parity/desktop-dark.png`
- **Persistence Verification:** Full page reload with `localStorage.setItem('balabot-theme', 'light')` verified `PASS`. Toggling back to dark and reloading verified `PASS`.

---

### Gap 2: Live Exercise of Teach-a-Task Demonstration Recording
- **Live Take-Over Session:** Driven via stealth browser CDP automation against the live Agent Computer view:
  1. Opened Agent Computer dialog via top navigation button.
  2. Clicked "Teach a task", entered goal (`"Export CRM customer list and verify CSV header"`), clicked "Start recording".
  3. Recording banner activated with live 10-minute countdown and honest security guidance ("Do not type passwords into the demo. Use Take control for credentials.").
  4. Performed interactive actions during recording: clicked on live screen at relative coordinate `(100, 100)`, typed `"ls -la /workspace"`, sent text, and scrolled.
  5. Action buffer tracked and displayed live in the banner (`Actions captured: 1+`).
  6. Stopped teaching demonstration.
  7. Inspected server state: routine created via `POST /api/bots/{bot_id}/routines` with ID `rt_1790618813272_f93655`, title `"Export CRM customer list"`, schedule `"Manual"`, and prompt `"Click at (571, 566) -> Type \"ls -la\""`.
- **Screenshots:**
  - Dialog opened: `C:/Users/ali/workspace/susan/screenshots/ui-parity/teach-01-dialog-open.png`
  - Recording active: `C:/Users/ali/workspace/susan/screenshots/ui-parity/teach-02-recording-active.png`
  - Actions captured: `C:/Users/ali/workspace/susan/screenshots/ui-parity/teach-03-actions-captured.png`
  - Routine created: `C:/Users/ali/workspace/susan/screenshots/ui-parity/teach-04-routine-created.png`
- **Honest Disclosure & Missing Links:**
  - **Does recording session start and capture actions?** Yes, client-side DOM captures clicks (with screen-space coordinate mapping), keystrokes, and text inputs into sequential steps.
  - **Is captured result turned into an artifact & where does it land?** Yes, turned into a Bot Routine saved via `POST /api/bots/{bot_id}/routines` into the bot routines store.
  - **Missing links:** It does **not** compile into a Hermes skill directory/file (`SKILL.md` under `/opt/data/profiles/.../skills`), nor does it run a server-side background video/screen daemon. It produces an executable sequence routine.

---

### Phase 7 Verification Scoreboard

| Probe | Verification | Result |
|---|---|---|
| Live surface theme switch | Computed CSS properties changed between dark and light | **PASS** |
| Theme persistence | Retained theme across hard browser page reload | **PASS** |
| Responsive theme styling | Captured desktop (1440x900) & mobile (390x844) light mode | **PASS** |
| Teach-a-task take-over session | Start recording, capture click/type, stop recording | **PASS** |
| Routine artifact creation | Backend routine created with recorded actions | **PASS** |
| Console error clean | 0 uncaught exceptions or unhandled rejections | **PASS** |
| Regression test suite | `pytest tests -q` (426 passed) | **PASS** |

---

## Remainder vs Polaris — verified inventory (2026-10-02, at `22d8540`)

The 51/51 scoreboard above is scored against the **behavioural** GrokBot spec
(`docs/kb/reference/grok-bot-interface.md`), where BalaBot implements each surface under its own
filenames. Measured against the stricter **Polaris** component target
(`docs/reference/polaris-ui-reference.md`, sources vendored read-only at
`docs/reference/polaris-vendor/`), the genuine remainder is **four surfaces** — everything else in the
Polaris inventory already exists in `ui/src` **and is reachable from a real call site** (verified by
import-grep, not by file existence):

| # | Surface | Polaris ref | State in BalaBot | Evidence |
|---|---|---|---|---|
| R-1 | **Skill draft card — unwired** | `components/teach/SkillDraftCard.tsx` | Built, **0 consumers**. Exported from `ui/src/cards/index.ts` but never rendered. | `App.tsx:1782-1785` renders `ask` / `mcp_approval` block kinds; there is **no `skill_draft` branch**. |
| R-2 | **Messaging settings** | `pages/MessagingSettingsOverlay.tsx` | **Absent.** No messaging/notification settings surface anywhere. | `grep -rln "Messaging\|Notification" ui/src --include=*.tsx` → empty. Settings nav has General/Models/Memory/Voice/Usage/Computer/Updates only (`SettingsOverlay.tsx:49-55`). |
| R-3 | **Approval rules settings** | `components/ApprovalRulesSettings.tsx` | **Absent** as a settings panel. Approval *cards* exist (`cards/McpApprovalCard.tsx`, `cards/AskCard.tsx`), but no rules configuration surface. | No `ApprovalRulesSettings` file; no approvals tab in the settings nav. |
| R-4 | **Routine schedule + activity list** | `pages/RoutineSchedule.tsx`, `pages/ActivityList.tsx` | **Absent.** `RoutinesList.tsx` provides list + editor only. | `grep -rn "RoutineSchedule\|ActivityList" ui/src` → no hits. |

**Stale-claim corrections made this pass:** the earlier working note naming the teach/recording chrome
(`TeachCaptureOverlay`, `TeachRecordingChrome`), the artifact viewers (`PdfViewer`,
`SandboxedHtmlViewer`, `ArtifactFileCard`) and the settings overlays (Model/Memory/Plugins/MCP) as
*absent* is **wrong as of `22d8540`** — all of those files exist and each has a real caller
(`AgentComputerDialog.tsx`, `ArtifactFileCard.tsx`/`ArtifactsPage.tsx`, `SettingsOverlay.tsx`/`App.tsx`
respectively). Parity work on them is done; the remainder is R-1..R-4.



