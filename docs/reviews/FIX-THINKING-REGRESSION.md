---
type: review
title: F8 — "Show thinking" relocation E2E failure
description: Confirmed cause of the 8/15 ui_thinking_e2e failure after 76fde2b, and the minimal harness fix. Verdict — harness determinism, not a product regression.
resource: docs/reviews/FIX-THINKING-REGRESSION.md
tags: [balabot, review, e2e, thinking, regression]
timestamp: 2026-09-30T00:00:00Z
status: resolved
---

# F8 — "Show thinking" relocation E2E failure

## Verdict

**Harness determinism bug. No product regression.** Commit `76fde2b` moved the
switch correctly and left the render gate, state, and persistence intact. The
8/15 result came from the E2E harness measuring element counts document-wide and
booting the wrong session, then crashing before the live-stream checks ran.

## The product gate is intact

`grep -n "showThinking" ui/src/App.tsx ui/src/BotSettings.tsx`:

- `ui/src/App.tsx:372` — `const [showThinking, setShowThinking] = useState<boolean>(() => loadShowThinking());`
- `ui/src/App.tsx:1762` — `{showThinking && m.thinking ? (<ThinkingBlock …/>) : null}`
- `ui/src/App.tsx:1912` — `{showThinking && streamThinking ? (<ThinkingBlock … isLive …/>) : null}`
- `ui/src/App.tsx:2080` — threads `showThinking` + setter into `<BotSettings …>`
- `ui/src/BotSettings.tsx:170` — `<Switch label="Show thinking" value={showThinking} …/>`

The reasoning element is still mounted **only** when `showThinking && …`.

## Confirmed causes (`file:line`)

Three independent harness defects; the first two are the reported symptom, the
third produced the `8/15` count and the "null click" crash.

1. **`disclosures()` counted every `.astryx-collapsible` in the document.**
   The bots sidebar renders Astryx `Collapsible` sections —
   `ui/src/screens/BotRoster.tsx:334` and `:434` (OPS, GOVERNANCE, Hidden Bots).
   On the live server that is 3 elements, so `t02 no thinking disclosure element
   in the DOM when off` (`disclosures === 0`) failed **even with the gate off**.
   `t08` then read `disclosures=3 triggers=[]`: three sidebar collapsibles, zero
   reasoning disclosures.

2. **Stage-2 reload activated a live server session, not the fixture.**
   After the first reload the app fetches the server session register and merges
   it into the same store — `ui/src/sessions.ts:260-272`, persisted by
   `saveSessions` (`ui/src/sessions.ts:296-300`). `activeSessionId` initializes
   from `loadSessions()[0]` (`ui/src/App.tsx:237-240`). The merged register is
   sorted newest-first, so the second reload opened a live session. Probe (exact
   harness flow) after the stage-2 reload:
   `firstStoredId = s_1790803400901_pl5epx`, `transcriptHasSeedQuestion = false`,
   `transcriptCollapsibles = 0`. `t08`–`t13` therefore measured a page with no
   seeded reasoning at all.

3. **`sendPrompt` used a selector that no longer exists.**
   The harness typed into `[aria-label="Message input"]`; the composer textarea is
   `aria-label="Message Principal"` (`ui/src/Composer.tsx:994-996`). The
   `querySelector(...)` returned `null`, `el.click()` threw
   (`TypeError: Cannot read properties of null`), and the `catch` aborted the run
   **before `t14`–`t18`**. That is why the failure printed `8/15`: the harness
   defines 19 checks (`t00`–`t18` plus the catch-all) but only 15 records existed
   after the crash. The committed results file likewise held 19 entries at HEAD.

## Why `t01` was blind while `t02` caught it

`t01` is text-level: it asks whether the seeded reasoning **string** is in the
body. The `showThinking &&` gate kept the `ThinkingBlock` unmounted, so the
reasoning text stayed hidden and `t01` passed. `t02` is element-level: it counts
disclosure **elements**. The three sidebar `Collapsible`s are elements that have
nothing to do with reasoning, so the text check passed while the element check
failed. `t00` also looked healthy because the canary answer text appears in the
sidebar session preview as well as the transcript, so "the seeded session
rendered" was not actually proven.

## Minimal fix (harness only — `tests/e2e/ui_thinking_e2e.mjs`)

No product file was touched. Check count unchanged (19 defined; all now run).

- `disclosures()` now counts only collapsibles whose trigger reads
  `Thinking` / `Thinking…`, i.e. the actual contract, not sidebar chrome.
  This does **not** weaken `t02`/`t08`; it removes an unrelated false positive so
  the assertion measures the thinking disclosure it names.
- Added `seedSessions()` and call it immediately **before** the stage-2 reload.
  It re-seeds only `balabot.sessions.v1` + `balabot.lastBot.v1`, leaving the
  toggle-written `balabot.showThinking.v1` untouched, so `t06` remains a real
  persistence test and the fixture stays the active conversation.
- `waitForText` now scopes to `[data-testid="transcript"]`, so a sidebar preview
  can no longer make a "hidden" pass vacuous.
- `sendPrompt` targets the real composer textarea
  (`[data-testid="composer-fieldset"] textarea`).

No fixture string was added to product code; the only edits are under `tests/`.

## Evidence after the fix

| Bar | Result |
|-----|--------|
| `node tests/e2e/ui_thinking_e2e.mjs` | **19/19 passed, EXIT=0** (all 19 checks ran) |
| `node tests/e2e/ui_bridge_e2e.mjs` | 38/41 runnable, 8 pending — no pty needed |
| `python tests/e2e/bridge_api_e2e.py` | 36 passed / 0 failed / 12 pending |
| `pytest tests -q -rs` | 476 passed |
| `npm test` (`ui/`) | 6 files, 71 tests passed |
| `npm run build` (`ui/`) | built cleanly |

Direct DOM probe of the scoped counter (scratch, not committed): with the toggle
off the transcript holds **0** thinking disclosures; with it on, exactly **1**
(`aria-expanded="false"` initially). That off/on contrast is the sensitivity that
makes `t02` meaningful after the scoping change.

## Honest gaps

- The resume header said "15 checks"; the committed harness defines **19**
  (`t00`–`t18` + catch-all). The "8/15" and "15/15" figures are the post-crash
  subsets. The check count was neither reduced nor expanded.
- `ui_bridge_e2e.mjs` is flaky across runs: this run failed `W2-15`, `W6-13`,
  `W9-11` (SSE burst ordering, mid-turn queue chip, steering+approval compose);
  the previous run's scratch log failed `W2-13`. These are live-server timing
  scenarios in a **different** harness and cannot be affected by an edit to
  `ui_thinking_e2e.mjs`; the plugin "no pty" warning in the brief is stale (the
  harness runs without a tty).
