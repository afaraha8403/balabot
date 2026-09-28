---
type: playbook
timestamp: 2026-08-18T19:21:17Z
title: Gate 0
description: Nothing public until a stranger can download, install, and dictate without emailing us.
tags: [launch, blockers]
status: draft
generated: { by: chief-of-staff/okf-init, at: 2026-08-18T19:14:05Z }
sources:
  - id: kalam-43
    resource: https://github.com/balacodeio/kalam/issues/43
    title: Azure Authenticode signing
  - id: kalam-42
    resource: https://github.com/balacodeio/kalam/issues/42
    title: Microsoft Store MSIX
  - id: website-6
    resource: https://github.com/balacodeio/kalam-website/issues/6
    title: Stale showcase screenshots
---

# Rule

If two things fail on first run, people dump the app. Unsigned installer plus a broken download page is two things.

# Blockers

1. Sign via [Azure #43](https://github.com/balacodeio/kalam/issues/43) and/or [Store #42](https://github.com/balacodeio/kalam/issues/42).[^kalam-43][^kalam-42] Copy must not say "signed" until one ships.
2. Download page must serve the file on a cold Windows box. SHA256 visible.
3. Replace [8 stale screenshots](https://github.com/balacodeio/kalam-website/issues/6).[^website-6]
4. Stripe + 14-day no-CC trial, cancel drops to Free. Ali runs it once.
5. Homepage 4.9 / 17+ / 200+ wpm: source or remove.
6. [kalam#51](https://github.com/balacodeio/kalam/issues/51) hotkey vs terminal TUIs: fix, change default, or known-issue. Do not showcase terminal in PH until closed.

# Exit

5 strangers download, install, and dictate into Notepad and Slack without emailing us.

[^kalam-43]: Azure Authenticode signing
[^kalam-42]: Microsoft Store MSIX
[^website-6]: Stale showcase screenshots
