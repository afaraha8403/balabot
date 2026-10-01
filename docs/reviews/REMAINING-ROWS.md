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

## W2-6 / W2-7 — server-side compaction keeps the newest user turn, bounded + recorded

**Proves:** a session transcript can be compacted server-side without severing
the live thread.

- **W2-6** — compaction ALWAYS retains the newest user turn, even when the tail
  window holds only a newer *assistant* message and would otherwise drop it.
- **W2-7** — compaction is BOUNDED (keeps exactly `protect_first_n` +
  `protect_last_n`, never prunes below the floor, idempotent once at the floor)
  and RECORDED (`compaction_count` increments, `last_compaction_at` set).

**Changes:**
- `balabot/sessions.py` — `SessionStore.compact()`: reads the ordered messages,
  keeps the immortal head + live tail window, force-retains the newest user
  turn, deletes only the messages between them, and calls `record_compaction()`.
  Fail-loud on an unknown id (`_require`).
- `ui/server.py` — `POST /api/sessions/{id}/compact` (`_SESSIONS_COMPACT_SNIPPET`),
  returns `{compacted, pruned, remaining, compactionCount, lastCompactionAt}`.
- `tests/test_sessions.py` — three unit tests for the two rows + unknown-id.
- `tests/e2e/bridge_api_e2e.py` — `w2_compact_scenarios()` replaces `w2_pending()`
  and drives the real HTTP endpoint. `balabot/sessions.py` is image-baked, so the
  block snapshots the container copy, deploys the committed one, runs, and
  restores on exit (same contract as the W5 rows).

**RED evidence — W2-6 (newest-user-turn protection removed):**
```
E       AssertionError: ['user msg 1', 'reply 3']
E       assert 'user msg 3' in ['user msg 1', 'reply 3']
tests\test_sessions.py:179: AssertionError
FAILED tests/test_sessions.py::test_compact_keeps_newest_user_turn_even_outside_tail
```
The fixture is `u1,a1,u2,a2,u3,a3` with `protect_first_n=1, protect_last_n=1`,
so the tail holds only `a3`; without the protection `u3` is pruned. (A prior
attempt at this row used a trailing *user* message, so its "protection" check
could never fail — the fixture here puts an assistant turn last on purpose.)

**RED evidence — W2-7 (tail window ignored):**
```
E       assert 4 == 8
tests\test_sessions.py:198: AssertionError
FAILED tests/test_sessions.py::test_compact_is_bounded_and_recorded
```

**GREEN evidence:**
```
$ pytest tests/test_sessions.py -q
20 passed in 1.53s

$ pytest tests -q
484 passed in 31.99s

$ python tests/e2e/bridge_api_e2e.py
[  ok ] W2-6 compact accepted                              HTTP 200
[  ok ] W2-6 newest user turn survives compaction          3 messages after compact
[  ok ] W2-6 middle turns dropped (not a no-op)            3 of 6 survive (u1 + u3 + a3)
[  ok ] W2-7 compaction bounded + recorded                 HTTP 200 remaining=8 pruned=2 count=1 at=True
[  ok ] W2-7 re-compact idempotent at the floor            pruned=0 remaining=8 count=2
[  ok ] W2-7 newest user turn inside the surviving window  8 messages remain
...
46 passed, 0 failed, 9 pending
```

**Harness defect fixed while landing this row (not a product change):** the
pre-existing W2-2 scenario asserted `sentinel in stream` against the RAW SSE
bytes, but the gateway splits the reply across `data:` frames, so a correct
answer failed whenever the codename spanned two frames. Proven live:
```
sentinel: PLUM-0D36C4
raw-in-stream: False
in-assembled: True
assembled reply: '\n\nPLUM-0D36C4 — that\'s what you just told me, and it\'s in the ledger now. ...'
```
Added `sse_reply_text()` (joins `choices[0].delta.content` fragments) and used
it for the two model-text checks in W2-2. This cannot mask a broken store
rebuild: a token absent from the assembled reply is still absent.

**Not done:** the container still runs its image-baked `sessions.py` — the
harness restores it after proving the endpoint (leaving `/opt/balabot` mutated
would be a side effect). `POST /api/sessions/{id}/compact` therefore reports an
honest `unavailable` against the running container until `balabot/sessions.py`
is deployed (image rebuild or `docker cp`), exactly as the W5 approval rows are.