---
type: reference
title: Polaris — UI reference for BalaBot parity
description: Polaris is the internal codename for the third-party project supplied as the code-level match for GrokBot's UI. Local clone, stack, design-token contract, and the exact screens BalaBot must mirror.
tags: [ui, parity, polaris, grokbot, balabot, reference]
timestamp: 2026-09-28T15:40:00Z
---

# Polaris — the UI reference

**Polaris** is our internal codename for the third-party project supplied as *"an example project
that matches the code for GrokBot"* (2026-09-28). Use the codename everywhere: product docs, KB
notes, code comments, commit messages. **Do not name the source project or its author in our
artefacts** — keep it out of anything a client, contractor or the public might read.

**Local clone (read it directly):** `C:/Users/ali/workspace/susan/reference/polaris`.
The upstream URL exists only inside that clone's git remote — run `git remote -v` there if you need
it. Licence: Apache-2.0.

## Stack

React 19.2 · Vite · **Tailwind 4.3** · react-router 7 · lucide-react · pnpm 9.15 + turbo monorepo ·
Geist Variable font. `apps/` (web, api, worker) · `packages/` (ui-web, ui-tokens, chat-ui, core, db,
contracts, memory, testkit, adapters) · `infra/sandboxes/computer`.

## The token contract (mirror this)

`packages/ui-tokens/src/tokens.css` is the source; `packages/ui-web/src/styles.css` maps it into
Tailwind 4 via `@theme inline`. Dark mode is `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` —
theme switches on `data-theme`, **not** Tailwind's default `class`.

Required variables (shadcn vocabulary + two additions):

- surfaces: `--background --foreground --card --card-foreground --popover --popover-foreground`
- actions: `--primary --primary-foreground --secondary --secondary-foreground --accent --accent-foreground --destructive --destructive-foreground`
- chat: **`--chat-user --chat-user-foreground`** (the user's own message bubble colour)
- sidebar: **`--sidebar --sidebar-foreground --sidebar-border --sidebar-accent --sidebar-accent-foreground`**
- form/state: `--muted --muted-foreground --border --input --ring --link --success --warning`
- chrome: `--overlay --scrollbar --scrollbar-hover`
- radii: `--radius` plus derived `--radius-sm|md|lg|xl|2xl` = radius −4 / −2 / +0 / +4 / +8 px

Scroll regions use the `.rk-scroll` pattern (6px thumb, thin, transparent track).

## Screens and components to mirror

| BalaBot surface | Polaris reference |
|---|---|
| App shell, roster, bot switching | `apps/web/src/pages/shell/` — `bot-panel.tsx`, `bot-picker.tsx`, `message-cards.tsx`, `dialogs.tsx`, `avatar-studio-popover.tsx` |
| Command palette + hotkey | `pages/shell/command-palette.tsx`, `command-palette-hotkey.ts` |
| Chat rendering, markdown, hover metadata | `packages/chat-ui/src/` (`markdown.web.tsx`, `markdown.native.tsx`, `icons.tsx`), `components/ai/primitives.tsx`, `MessageHoverMetadata.tsx`, `AskCard.tsx` |
| **Teach a task (recording)** | `components/teach/` — `TeachCaptureOverlay.tsx`, `TeachComputerOverlay.tsx`, `TeachRecordingChrome.tsx`, `SkillDraftCard.tsx` |
| Agent computer | `components/computer/` — `ComputerWorkspace.tsx`, `FilesApp.tsx`, `TerminalApp.tsx`; plus `novnc-html.ts`, `screen-proxy.ts`, `HostComputerPrompt.tsx`, `ComputerMaintenanceActions.tsx` |
| Routines | `pages/RoutineEditor.tsx`, `RoutineSchedule.tsx`, `ActivityList.tsx` |
| Artifacts / files | `pages/Artifacts.tsx`, `components/ArtifactFileCard.tsx`, `PdfViewer.tsx`, `SandboxedHtmlViewer.tsx` |
| Settings overlays | `ModelSettingsOverlay.tsx`, `MemorySettingsOverlay.tsx`, `PluginsOverlay.tsx`, `McpServersOverlay.tsx`, `MessagingSettingsOverlay.tsx`, `AccountSettingsOverlay.tsx` |
| Approvals | `components/ApprovalRulesSettings.tsx` |
| Avatars | `packages/ui-web/src/bot-avatar.tsx`, `group-avatar.tsx`, `avatar-style.tsx` |

## Rules for using it

1. **Mirror structure and tokens; do not import their code wholesale.** Apache-2.0 makes reuse legal,
   but anything copied into our tree still has to pass *our* build and tests.
2. **Do not copy their brand assets, icon files, or product naming.** BalaBot's identity is its own.
3. **Do not add a dependency just because Polaris has one.** Check what BalaBot already ships first;
   this is a reference for *shape*, not a licence to re-platform.
4. Where a BalaBot screen and Polaris disagree, **Polaris wins on visual/interaction parity** — that is
   exactly what the owner asked for.
5. Verify with the existing probe scripts (`verify_ui_parity.mjs`, `capture_ui_shots.mjs`) and
   `cd ui && npm run build`. A build is not proof of parity — a probe that exercises the control is.
6. Refer to it as **Polaris** in every commit, doc and comment. The codename is the only name we use.
