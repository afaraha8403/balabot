---
type: playbook
title: Agent intervention flow — bot needs a human
description: How a GrokBot agent asks Ali for help (login, captcha, 2FA) from its own computer, how that surfaces in the chat, and how Ali takes over that bot's screen. Bot pauses and waits.
tags: [grokbot, intervention, takeover, computer-use, design]
timestamp: 2026-09-26T21:15:00Z
status: approved-for-build
---

# Agent intervention flow

## Requirement

A bot working on its computer sometimes needs a human — a login, a captcha, a 2FA code, a consent
screen. Three things are needed:

1. The interface **shows the computer** (already true — the Agent Computer pane).
2. The user can **take over** that bot's screen.
3. The bot can **ask for help** in the chat.

**Decision (Ali, 2026-09-26): the bot pauses its turn and waits.** It does not park the task and move
on; it holds its place so it resumes exactly where it stopped.

## Flow

```
bot hits a wall
  → tool: request_intervention(reason, hint?, url?)
  → SSE frame: event: intervention   {bot, reason, hint, resume_token}
  → UI: that bot's card badges "needs you", pane focuses its live screen,
        Ali is pinged (Telegram)
  → Ali takes over THAT bot's display: click / type / drag  (never another bot's, never the host)
  → Ali clicks [Done — resume]
  → POST /api/intervention/{resume_token}/resolve
  → the bot's paused turn is released and continues
```

## Rules

- **Scoped to one bot's display.** A take-over can only ever reach the bot that asked — never another
  agent's display, never the shared `/workspace/shared` surface, never the host desktop.
- **Pause has a timeout.** If nobody responds, the bot resumes with an explicit "unattended" note
  rather than hanging forever, so a queue can't wedge.
- **No intervention screenshots in logs.** A captcha or login page is exactly where credentials
  appear — captures from an intervention window are never persisted.
- **Input is already ordered for this.** The driver's pointer/keyboard tools are in every agent's
  capability allow-list, and the human path uses the same container transport as the pane.
- The bot is told only *that* the human finished (`{resolved: true, note?}`) — never what was typed.

## Related

- Computer/display architecture: [../reference/agent-computer-architecture](../reference/agent-computer-architecture.md)
- Secrets: the same in-chat interface pattern is reused for secret entry ([org-secrets-and-skills](org-secrets-and-skills.md)).
