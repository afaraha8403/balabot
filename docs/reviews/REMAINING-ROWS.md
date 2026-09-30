# Remaining rows — land one at a time

What each cleared row proves, its RED-to-GREEN evidence, and anything left undone.

## W2-2 — client sends only the delta

**Proves:** a client that owns a `session_id` uploads ONLY the new user turn
(the delta) to `/api/chat`, never the full history. The durable session store is
the transcript source of truth: the server rebuilds the whole conversation from
the store and appends the delta before forwarding upstream, so the model still
answers with full context. Legacy clients that upload the full history are
untouched (additive, W2-8).

**Changes:**
- `ui/src/api.ts` `streamChat` — computes the wire payload as only the
  messages the server has NOT confirmed yet (no durable `seq`); sets
  `delta: true` + `session_id`.
- `ui/src/App.tsx` — passes `seq` through so the client can compute the delta.
- `ui/server.py` `/api/chat` — when `delta` is set, reads `store.messages()`
  and prepends the rebuilt history to the incoming delta (dedup of a re-sent
  idempotent turn). A store-read failure degrades to the delta alone — honest,
  never a fabricated error.
- `tests/e2e/bridge_api_e2e.py` — `w2_02_client_sends_only_the_delta()` replaces
  the old pending registration.

**RED evidence** (against the pre-change server, which ignored `delta`):
```
[PASS] W2-2 delta-only send accepted                 HTTP 200
[FAIL] W2-2 reply proves store history was rebuilt  W2D2-326FBC  [fails if: ...]
[FAIL] W2-2 store keeps seed AND delta              3 rows  [fails if: ...]
[PASS] W2-2 legacy full-history send still works    HTTP 200
```

**GREEN evidence** (with the server rebuild path live):
```
[PASS] W2-2 delta-only send accepted                 HTTP 200
[PASS] W2-2 reply proves store history was rebuilt  PLUM-A54043
[PASS] W2-2 store keeps seed AND delta              3 rows
[PASS] W2-2 legacy full-history send still works    HTTP 200
```

Full harness after landing: **40 passed / 0 failed / 11 pending** (was 36 / 0 / 12).
`npm run build` in `ui/` deployed the SPA change.

**Not done:** the counterpart UI-harness network-capture row (`ui_bridge_e2e.mjs`)
was not touched — the HTTP-level scenario proves the same contract; a browser
wire-capture is left as future work if the UI harness needs it.