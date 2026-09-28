---
type: reference
title: GrokBot UI — visual reference (captured screens)
description: Interface elements read off xAI's own GrokBot product imagery, with the four gaps the parity ledger does not yet carry. Supplements docs/UI-PARITY-LEDGER.md.
resource: docs/UI-PARITY-REFERENCE.md
tags: [grokbot, ui, parity, reference, screenshots]
timestamp: 2026-09-28T04:20:00Z
status: active
---

# GrokBot UI — visual reference

Prose cannot be eyeballed. This note records what the captured product imagery actually shows, so UI
parity is checked against pixels. Screens: `docs/reference/grokbot-screens/` (pulled from xAI's own
docs and the GrokBot 101 guide; the study text lives in
`C:/Users/ali/workspace/susan/research/grokbot-product-study/`).

Read this **alongside** `docs/UI-PARITY-LEDGER.md` — the ledger is the scoreboard, this is the target
as seen. Where the two disagree, the imagery wins.

## What the screens show (element inventory)

**Desktop app — three panes** (`guide-101-img3.jpg`):

| Pane | Contents |
|---|---|
| Left — roster | Search field; bots grouped under **collapsible category headings** (`Cursor`, `Ops`, …); a **`Hidden Bots`** section with a count; a **`Plugins`** entry; the user account footer with avatar |
| Centre — work area | Bot name + avatar header; transcript interleaving prose, **web screenshots**, and the bot's reasoning; a **`Hold everything` control with a dropdown**; composer labelled `Message <Bot>` with `+` (attach) and a mic |
| Right — context | **`<Bot>'s screen`** live preview; a **`Routines` list with enable/disable toggles** (`Friday grocery check-in`); a **gear** (settings) and a **collapse chevron** |

**Cloud computer** (`guide-101-img2.jpg`): a full dark desktop — taskbar at the bottom with
**browser, file manager, terminal** — and a **`Teach a task`** button top-right. It is a
browser-in-a-browser the human can watch and drive.

**Bot settings / routines / rules** (`guide-101-img4..6.jpg`): per-bot settings, routine triggers, and
**allow/deny rules** as first-class editable surfaces, not settings-file archaeology.

## The four gaps the ledger does not yet carry

1. **`Hold everything` — the chat-level pause.** GrokBot puts a pause-with-options control on the
   transcript itself, not buried in a menu. This is the *UI face* of the intervention flow wired in
   Phase 1 (`balabot/intervention.py`, `event: intervention`). The ledger has intervention *cards*
   (3.5) but not the composer-side pause/steer control — the element the owner actually reaches for
   when a running turn must be halted.
2. **Routines as a visible, toggleable list.** The right pane enumerates a bot's routines with on/off
   switches. We have routine *creation* ("Create Routine") but the ledger has no Routines parity row —
   no list, no toggles, no last-run state.
3. **`Teach a task` (learn by demonstration).** The computer view carries an explicit affordance for
   recording a demonstration into a routine/skill. We have skills written from experience; we have no
   way for the owner to *show* the bot a task.
4. **Roster categories / folders.** GrokBot groups bots under collapsible headings (and a separate
   `Hidden Bots` group). The ledger covers pin/hide but not grouping, which is what keeps a roster
   readable past a handful of bots.

## Honest limits of this reference

- The captures are **marketing and guide imagery**, not a live build: spacing, states, and empty
  states are idealised. Match structure and affordances; do not copy pixel values off a screenshot.
- There is **no GrokBot phone screenshot** in the set, so mobile parity is judged against the written
  spec (`kb/reference/grok-bot-interface.md`) and our own PWA behaviour, not an image.
- Anything neither the spec nor an image settles is a **gap to record**, not a licence to invent.
