---
type: reference
timestamp: 2026-09-25T22:47:35Z
title: Grok Bot — product model, interface, collaboration and computer use
description: What xAI's Grok Bot actually is: the app's interface (Bots, chats, group chats, Agent Computer), how Bots collaborate, and how computer use works — mapped against our Hermes GrokBot stack.
tags: [grokbot, grok-bot, xai, reference, bot-mode, interface, computer-use, parity]
status: stable
generated: { by: susan/okf, at: 2026-09-25T22:55:00Z }
sources:
  - id: xai-overview
    resource: https://docs.x.ai/grok-bot/overview
    title: Grok Bot — Overview (xAI docs)
    last_modified: 2026-09-21
  - id: xai-chat
    resource: https://docs.x.ai/grok-bot/chat-and-collaboration
    title: Message and collaborate (xAI docs)
    last_modified: 2026-09-25
  - id: xai-computer
    resource: https://docs.x.ai/grok-bot/computer-and-apps
    title: Use the computer and apps (xAI docs)
    last_modified: 2026-09-14
  - id: xai-mobile
    resource: https://docs.x.ai/grok-bot/mobile
    title: Grok Bot for Mobile (xAI docs)
    last_modified: 2026-09-25
  - id: xai-101
    resource: https://x.ai/bot/guides/grok-bot-101
    title: Grok Bot 101 (xAI guide)
    last_modified: 2026-09-25
---

# Grok Bot — product model, interface, collaboration, computer use

Raw captures: `C:/Users/ali/workspace/susan/research/grokbot-product-study/`.
This note is the *product* reference (interface + behaviour). The landscape survey of clones lives in
`scratchpad/hermes-grokbot-parity-2026-09.md`; our own build state lives in `kb/team/bot-mode-roster.md`.

# The one-line model

**Named, persistent AI teammates with jobs — each working on a persistent cloud computer, reachable
from desktop and phone, that message each other, hand off ownership, and learn routines from
demonstration.** xAI's own framing: *a chief-of-staff bot on top, a specialist per lane.*

# The interface (what the app actually looks like)

**Shape:** sidebar of **Bots** + conversations on the left, transcript in the middle, and an
**Agent Computer** pane you can open from any conversation.

- **Open a Bot from the sidebar and message it** — type, dictate, or start a voice chat.
- Composer affordances: paste text/links/images, attach files, **dictate** (`Cmd/Ctrl+D`; mobile **Start dictation**),
  **voice chat** when the composer is empty, **`/` to reference a saved skill**, **`@` to mention a Bot / group / routine / connector**,
  reply-in-thread, reactions.
- The transcript interleaves **tool activity, computer use, created files, questions, approval requests and voice memos**
  alongside normal messages — not a plain chat log.
- **Editable drafts**: when a Bot prepares an email/Slack message, the conversation shows a draft card with
  **Send email / Send message / Discard** — the human approves before anything leaves.
- **Group chats**: `New` → select **2–6 Bots** → describe the shared outcome. Address normally (bots self-route),
  or `@` a specific Bot, or `@everyone` (sparingly).
- **Keyboard-first**: `Cmd/Ctrl+K` command palette, `Cmd/Ctrl+Shift+F` search Bots, `Cmd/Ctrl+N` new, `Cmd/Ctrl+1..9`
  jump to sidebar Bot, `Control+Tab` cycle Bots, `Cmd/Ctrl+Shift+M` Marketplace.
- Search spans **Messages, Bots, Group Chats, Files, Routines**.

# How the agents work together

1. **Asynchronous bot-to-bot messaging** — one Bot sends another a message; the receiver *wakes*, handles it,
   replies later. The handoff is **visible in the conversation**.
2. **Group chats** — several Bots, one shared outcome, visible handoffs. Bots post into the group and pass work
   among themselves.
3. **Ownership transfer** — a stage is owned by exactly one Bot; the kickoff names who owns the next step.
4. **Parallelism** — Bots reason, use connectors, work files and coordinate in parallel; each gets its own
   **screen** on the shared computer, and **one Bot runs one computer-use task per screen at a time**.
5. **Guidance from xAI's own docs**: *"Ask for a single owner at each stage. Too many parallel handoffs
   create duplicate work and noisy updates."* Bots can send images directly to another Bot when a teammate
   must inspect it (group handoff messages are text-only).
6. **Human direction**: a direct message outranks background work and can redirect the current turn;
   *"Stop now"* ends work immediately (without undoing completed actions).

# Computer use (the differentiator)

- Each Bot has a **persistent cloud computer**: **browser + filesystem + terminal**. It works with the
  laptop closed — the app is a window, not the runtime.
- **One computer per account, shared by all Bots** — shared cookies/signed-in sessions, shared files,
  shared CLI credentials. *"The screens are separate work surfaces, not separate security boundaries."*
- **Agent Computer view**: open from a conversation to watch clicks, typing, navigation and status live;
  you can leave the preview while work continues.
- **Human take-over for sensitive steps**: password/passkey, 2FA, CAPTCHA, payment or identity check,
  or a site that demands a human. The Bot *hands the step to you* rather than working around it.
- **Connectors first, browser for everything else** — connectors are plugins from **Marketplace**,
  installed account-wide; prefer a connector when one exists, use the browser for services without one.
- **Shared workspace at `/workspace`** for durable files; temp dirs and ad-hoc packages are treated as
  replaceable.
- **Local computer is separate** — a Bot only runs commands on *your* machine when enabled and approved.
- **Recover / Update / Reset** the cloud computer from Settings → Updates (Reset rebuilds from the last snapshot).

# Mobile (the part we were missing)

The mobile app is a **first-class client, not a companion**: same Bots, conversations, routines, connectors
and shared computer. From a phone you can message, dictate, voice-chat, take/attach photos, be mentioned in
groups, reply in threads, react, **review the computer, take over for a password/2FA/CAPTCHA**, review
routines and run history, and search across Messages/Bots/Groups/Files/Routines. Group creation is
`+ → New Group Chat`. Editing a routine's schedule/instruction stays desktop-only.

# Parity map — Grok Bot ↔ our Hermes GrokBot (Steve/Jim/Oscar)

| Grok Bot capability | Hermes equivalent | State here |
|---|---|---|
| Named persistent Bots with jobs | Hermes **profiles** + `ui_meta['hermes-bots']` titles | ✅ built (Steve/Jim/Oscar) |
| Bot roster UI (iMessage look) | Hermes Desktop **Bot Mode** + `hermes-bot-kit` (bubble-mode, bot-sections) | ✅ installed — **desktop-only** |
| Per-Bot chat with tools/files in transcript | Bot Chat in Desktop | ✅ desktop |
| Bot-to-bot async messaging + handoff | `message_agent` in a canonical **Bot Chat** session | ✅ verified |
| Group chat (2–6 Bots, visible handoffs) | not native — needs a group session/board | ❌ gap |
| Routines per Bot | Hermes **cron** per profile | ✅ native |
| Learn workflow from demonstration → skill | Hermes **skills** (written from experience) | ✅ native |
| Approvals / editable drafts before send | Hermes rule: never send without explicit approval | ✅ policy, not UI card |
| **Persistent cloud computer per account** (browser+filesystem+terminal) | needs Docker/E2B/Daytona/Box or a dedicated box | ⚠️ partial |
| **Agent Computer live view + take-over** | `computer-viewer` desktop plugin (Orgo computers) | ⚠️ desktop-only |
| **Phone app / mobile web client** | dashboard (ops UI) or `nesquena/hermes-webui` (generic) | ❌ **the gap that matters now** |
| Marketplace of connectors | Hermes plugins / MCP servers | ✅ native |

# The gap, stated plainly

Grok Bot's magic is **not** the roster — we have that. It is (a) the **shared cloud computer with a live
view you can take over**, and (b) **the phone being a real client of the same Bots**. Our Bot Mode roster is
locked inside Hermes Desktop, so `bot.balacode.xyz` served a generic Hermes dashboard instead of a GrokBot
surface. That is the thing to fix.
