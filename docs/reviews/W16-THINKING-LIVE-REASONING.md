---
type: review
title: W16 — t16 "expanding live thinking reveals the reasoning" (18/19 -> 19/19)
description: Confirmed cause of the last red check in the thinking harness, and the harness-measurement fix. Verdict — harness measurement bugs, no product regression.
resource: docs/reviews/W16-THINKING-LIVE-REASONING.md
tags: [balabot, review, e2e, thinking, live-reasoning]
timestamp: 2026-10-01T00:00:00Z
status: resolved
---

# W16 — t16 live-reasoning disclosure (18/19 -> 19/19)

## Verdict

**Harness measurement. No product regression.** The product streams the model's
`delta.reasoning_content`, buffers it on its own channel, attaches it to the
finished message, and reveals it when the live disclosure is expanded. `t16` was
red because the harness measured the live turn at the wrong moment and with a
fragile needle, not because the product failed to expose live reasoning.

## The product gate is intact

- `ui/src/api.ts:703` — `if (c.delta?.reasoning_content) emitReasoning(c.delta.reasoning_content);`
- `ui/src/App.tsx:966-969` — `onReasoning` sets `thinkingRef.current` and `setStreamThinking`.
- `ui/src/App.tsx:989` — the finished turn is built with `thinking: thinkingRef.current || undefined`.
- `ui/src/App.tsx:1912` — `{showThinking && streamThinking ? <ThinkingBlock … isLive …/> : null}`.
- `ui/src/App.tsx:1762` — `{showThinking && m.thinking ? <ThinkingBlock …/> : null}`.

## Direct evidence

Isolated worktree instance (own `BALABOT_HOME` + `BALABOT_UI_PORT`, never `:9119`):

```
BALABOT_HOME=C:/Users/ali/workspace/balabot-wt/w16 \
BALABOT_UI_PORT=9231 BALABOT_ENV_FILE=<worktree>/.env.local \
PYTHONPATH=<worktree> python ui/server.py
```

Scratch probe (event-based wait, unique session id) against that server:

```
BEFORE SEND  {"live":false,"stop":false,"triggers":["Thinking"],"bodyLen":66}
AFTER WAIT   {"live":false,"stop":false,"triggers":["Thinking","Thinking"],"bodyLen":198}
             elapsedMs=5130 streamingSeen=true chatCount=1
lastReasoning RAW="Answer: 391."        <- the model was terse
DOM BEFORE EXPAND ... "Principal\nThinking\n391.\nComplete\nterminal…"
clicked triggers=2 revealsAnySeg=true    <- expanding DID reveal the reasoning
```

A second probe with a long reply captured `reasoningChars=83, segs=2,
revealsAnySeg=true`. The product exposes live reasoning in both the terse and
verbose cases. `t14`/`t16` were the measurement.

## Confirmed harness defects (`tests/e2e/ui_thinking_e2e.mjs`)

1. **`sendPrompt` waited on body-text-length stability.** With the intercepted
   `/api/chat` body buffered by `route.fetch()`, the page text does not change
   during the model's latency. The loop's `stable >= 3` (3 x 2 s) fired during the
   pre-first-token window, so `lastReasoning` was still `''` and the newest
   `Thinking` disclosure did not exist yet. The run then closed the browser with
   the intercepted request still in flight (the `TargetClosedError` the first run
   printed at `ui_thinking_e2e.mjs:156`).

2. **The live needle discarded a real but terse reasoning.** `segs` filtered the
   captured reasoning to period/newline segments `> 15` chars. A live turn whose
   whole reasoning is `"Answer: 391."` yields `segs=0` — so `t16` reported
   `segs=0` even though the product rendered the reasoning. This is the exact
   18/19 signature (`t14` passes because the reasoning is non-empty; `t16` fails
   because there is no long segment).

3. **A fixed `s_seed` id made repeated runs non-independent.** The app persists
   every live turn to the server-backed session with that id; the next run
   replays the prior run's transcript over SSE (`ui/src/sessions.ts:112`), which
   polluted repeated runs (intermittent `t12` failures) and bloated the model
   context.

## Fix (harness only — no product file touched)

- `sendPrompt` now calls `waitForLiveTurn`: it waits for the real in-flight
  affordance (`[data-message-id="progress:live"]` / `button[aria-label="Stop"]`)
  to appear, then to disappear with the finished message's own `Thinking`
  disclosure rendered (seed 1 -> live 2). No raised sleep.
- The live-disclosure needle is a distinctive injected `delta.reasoning_content`
  canary appended to the real SSE body (`LIVE_CANARY`), mirroring the existing
  seeded-canary technique. `t14` still checks the **model's own** reasoning
  (`lastReasoning`); `t15`/`t16` check the canary the product must parse, buffer,
  and reveal.
- `SEED_ID` is now unique per run, so each run is hermetic against the server
  store.

Check count is unchanged (19, `t00`–`t18`); no assertion was weakened.

## RED then GREEN

| Run | Result |
|-----|--------|
| Before fix (`node tests/e2e/ui_thinking_e2e.mjs`) | 17/19 — `t14 reasoningChars=0`, `t16 segs=0` |
| Independent run (reported) | 18/19 — `t16 segs=0` |
| After fix, 3 consecutive runs | **19/19, 19/19, 19/19** |

Mutation check — the harness can still fail. Temporarily changed the product's
final attach `thinking: thinkingRef.current \|\| undefined` -> `thinking: undefined`,
rebuilt, ran: **`t16 FAIL canaryVisible=false`, `t14` PASS** (18/19). Restored and
rebuilt -> 19/19.

## How to reproduce

```
# in the worktree, isolated from :9119
set -a && . ./.env.local && set +a
BALABOT_HOME=$(pwd) BALABOT_UI_PORT=9231 BALABOT_ENV_FILE=$(pwd)/.env.local \
  PYTHONPATH=$(pwd) python ui/server.py &
( cd ui && npm run build )      # build the SPA into <worktree>/ui/dist
BASE=http://127.0.0.1:9231 node tests/e2e/ui_thinking_e2e.mjs
```

## Honest gaps

- `t14` still depends on the model emitting *some* reasoning; the reasoning
  channel is a real-model integration check. In every observed run the model
  emitted reasoning (106, 83, 12, 692 chars). If the gateway ever stops emitting
  `reasoning_content`, `t14` alerts — that is intended.
- The canary is appended after the real body's final `[DONE]`; `streamChat`
  processes every `data:` frame in order and does not stop on `[DONE]`, so the
  canary is parsed. Verified by `t15`/`t16` passing.
- `w16_probe.mjs` was a scratch diagnostic and was not committed.
