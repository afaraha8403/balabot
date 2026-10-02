---
type: reference
title: Polaris — vendored UI reference (read-only)
description: Read-only copies of the Polaris component sources named in docs/reference/polaris-ui-reference.md, vendored into the repo so sandboxed coding agents (scope wall = repo only) can read the exact structure they must mirror.
tags: [ui, parity, polaris, reference, vendored]
timestamp: 2026-10-02T10:00:00Z
---

# Polaris — vendored source (read-only reference)

These files are **reference material only**. They are vendored from the Polaris clone
(`C:/Users/ali/workspace/susan/reference/polaris`, Apache-2.0) because BalaBot's coding agents run
under a **scope wall** that permits reads only inside this repo — the clone path is auto-rejected as
`external_directory` and kills a run.

## Rules

1. **Read, mirror, adapt — do not import wholesale.** Apache-2.0 makes reuse legal, but anything that
   lands in `ui/src/` must pass *our* build, types and tests, and must use BalaBot's Astryx component
   vocabulary and tokens (`ui/src/tokens.css`, `var(--color-*|--spacing-*)`), **not** Tailwind.
2. **Do not copy brand assets, icon files, or product naming.**
3. **Do not add a dependency because Polaris has one.**
4. Refer to it as **Polaris** in every commit, doc and comment. Never name the source project.
5. Nothing in this directory is compiled or imported by the build.

## Contents (mirrors `apps/web/src/`)

| Vendor path | Polaris source | BalaBot counterpart |
|---|---|---|
| `components/teach/TeachCaptureOverlay.tsx` | teach overlay | `ui/src/TeachCaptureOverlay.tsx` |
| `components/teach/TeachComputerOverlay.tsx` | teach computer overlay | `ui/src/TeachComputerOverlayControl.tsx` |
| `components/teach/TeachRecordingChrome.tsx` | recording chrome | `ui/src/TeachRecordingChrome.tsx` |
| `components/teach/SkillDraftCard.tsx` | skill draft card | `ui/src/cards/SkillDraftCard.tsx` |
| `components/ArtifactFileCard.tsx` | artifact card | `ui/src/ArtifactFileCard.tsx` |
| `components/PdfViewer.tsx` | PDF viewer | `ui/src/PdfViewer.tsx` |
| `components/SandboxedHtmlViewer.tsx` | sandboxed HTML | `ui/src/SandboxedHtmlViewer.tsx` |
| `components/ApprovalRulesSettings.tsx` | approval rules panel | **absent** — gap |
| `pages/Artifacts.tsx` | artifacts page | `ui/src/ArtifactsPage.tsx` |
| `pages/ModelSettingsOverlay.tsx` | model settings | `ui/src/ModelSettingsOverlay.tsx` |
| `pages/MemorySettingsOverlay.tsx` | memory settings | `ui/src/MemorySettingsOverlay.tsx` |
| `pages/PluginsOverlay.tsx` | plugins settings | `ui/src/PluginsOverlay.tsx` |
| `pages/McpServersOverlay.tsx` | MCP servers | `ui/src/McpServersOverlay.tsx` |
| `pages/MessagingSettingsOverlay.tsx` | messaging settings | **absent** — gap |
| `pages/AccountSettingsOverlay.tsx` | account settings | `ui/src/AccountSettingsPanels.tsx` |
| `pages/RoutineEditor.tsx` | routine editor | `ui/src/RoutinesList.tsx` (`RoutineEditor`) |
| `pages/RoutineSchedule.tsx` | routine schedule | **absent** — gap |
| `pages/ActivityList.tsx` | routine activity list | **absent** — gap |
