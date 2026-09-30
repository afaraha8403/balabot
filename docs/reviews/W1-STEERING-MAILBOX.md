# W1 — Steering Mailbox: Durable Store + Honest Delivery

Review date: 2026-09-30 · Harness: `python tests/e2e/bridge_api_e2e.py` (the three former `pending("W1-…")`
stubs — W1-9, W1-2, W1-11 — are now real scenarios) · Runtime artifact: the BalaBot adapter on
`http://127.0.0.1:9119` (host `python ui/server.py`, which imports the host `balabot/*` tree) and the
`balabot-balabot-1` container (upstream `http://127.0.0.1:8642`).

## What was tested

Three properties of the mid-turn steering path:

| Row | Property | Proven by |
|---|---|---|
| **W1-9 steering mailbox durable store** | A steer submitted mid-turn is durably held until delivered to the model or resolved — it must survive a process restart, not live only in the in-flight request. | Enqueue a steer, force a **real server restart**, read it back from `GET /api/queue`, then run a real governor turn and watch the steer reach the model and leave `pending`. |
| **W1-2 drained msg not delivered w/o model** | A message drained from the mailbox whose turn the model never consumed must **not** be reported delivered; the delivery state must be observable, not inferred. | Drain the steer into a turn, abort the turn before any model output, then read `GET /api/queue` and assert the message is still `queued` and `delivered == 0`. |
| **W1-11 halt-and-replan fallback honest** | Mid-turn injection into an already-open model stream does not exist in this product; the fallback (hold in the mailbox for the next turn) must be **stated honestly** in API state, never a silent "delivered". | Assert `POST /api/queue` answers `routing.injected == false`, `path == next_turn`, and the pending entry's `delivery_state == queued` with `delivered == 0`. |

## Where the mailbox is persisted — and why a steer cannot be lost

The mailbox is `balabot.queueing.MessageQueue` (`balabot/queueing.py`), a durable SQLite store:

- **One file, explicit path**: default `<BALABOT_DATA_ROOT>/sessions/queue.db` (the deploy's `/opt/data`
  volume is a named docker volume); the API adapter resolves it through `BALABOT_QUEUE_DB` when set.
  Tables: `queue_messages` (per-session FIFO with `seq`) and `queue_turns` (`busy` flag).
- **Durable before return**: `enqueue` commits the row to SQLite *before* the function returns. There is
  no in-memory fallback — the module docstring says it and the store refuses to open/write silently.
- **Survives a restart**: W1-9 proves it against the live artifact: the harness enqueues a steer, kills
  the `:9119` process, starts a fresh process on the **same** store file, and `GET /api/queue` still
  shows the steer `queued`. That is the exact regression this row exists to block: a steer kept only in
  the request that happened to be in flight would vanish on restart.
- **Claim vs delivered is durable too**: a `claimed_at` stamp (the row is "draining" — in a turn, not yet
  confirmed) and a `delivered_at` stamp (the model consumed it). Both are columns in the same WAL
  SQLite file, so an at-most-once claim survives restarts exactly as the pre-existing queue did.

## How delivery state is exposed — and what makes it trustworthy

`GET /api/queue/{session_id}` now returns per-message and summary delivery state:

```json
{"ok": true, "state": {
  "session_id": "…", "busy": false,
  "pending_count": 1,
  "delivery": {"queued": 1, "draining": 0, "delivered": 0},
  "pending": [{"message_id": "…", "content": "…", "enqueued_at": "…", "seq": 1,
               "delivery_state": "queued", "injected": false, "path": "next_turn"}],
  "last_delivered": []
}}
```

The trust chain for "not delivered":

1. The server **claims** the undelivered rows at the top of a chat turn (`claimed_at` set,
   `delivered_at` untouched) instead of the old behavior of marking `delivered_at` at drain time.
2. It flips them to `delivered` only when the upstream model turn **return 200** (`upstream_consumed`
   is set at `r.status_code == 200` in the `/api/chat` stream generator — the model accepted the
   payload that contained the steers).
3. If the turn is refused/errored/**aborted** (the model never consumed it), the stream's `finally`
   calls `release_claims`, returning the rows to `queued` so the next turn retries them.

The "upstream-refusing stub" from the old pending note is realized as an **aborted turn**, and it had to
be: I verified against the real gateway (`:8642`) that a genuine upstream 400 *cannot* be triggered
after a drain, because the drained steer is appended to the payload and that append makes the payload
well-formed (`messages: []` → `[user steer]` → `200`; `[tool, x]` → `[tool, x, user steer]` → `200`).
The only way a drained message's turn is "never consumed" end-to-end is the client walking away mid-turn
— which is exactly the honest failure W1-2 guards: the row was claimed, no model answer ever came, and
the state must not claim delivery. The scenario aborts the connection right after the drain frames start
streaming (HTTP 200 response, 64 bytes read, then close), so the serve genuinely claimed the row first —
under the old eager code that row is immediately marked delivered (RED), under the new code it is
released back to `queued` (GREEN).

No product code keys off any test string: the harness only sets `BALABOT_QUEUE_DB` on *its own* server
invocation and points it at `tests/e2e/_scratch/w1/queue.db` for the W1 block, then restores the server
to the original environment.

## How the fallback is surfaced honestly

`POST /api/queue/{session_id}` answers, alongside `queue`, an explicit `routing` block:

```json
"routing": {
  "injected": false,
  "path": "next_turn",
  "delivery_state": "queued",
  "note": "mid-turn injection unavailable — steer waits in the durable mailbox for the next model turn"
}
```

This is W1-11: the product has no mid-turn injection channel (nothing can push into an already-open
upstream stream), so every steer's real path is the fallback — wait in the durable mailbox for the next
model turn. The API says exactly that instead of silently claiming the steer landed.

## The three outcomes (final run)

```
[  ok ] W1-9  steering mailbox durable store        held=True survived_restart=True delivered_to_model=True emptied=True pending=0 delivered=1
[  ok ] W1-2  drained msg not delivered w/o model   queued=True settled=queued delivery={'queued': 1, 'draining': 0, 'delivered': 0}
[  ok ] W1-11 halt-and-replan fallback honest       routing={'injected': False, 'path': 'next_turn', 'delivery_state': 'queued', ...}
36 passed, 0 failed, 12 pending   (pending = feature not built — never folded into passes)
```

Full harness run (the three rows plus all prior rows):

```
36 passed, 0 failed, 12 pending (pending = feature not built — honest, never a vacuous pass)
```

Each row carries its explicit **fails-if** next to the assertion, e.g. W1-9 *"fails if: the steer was
lost on restart (in-memory/request-only), or was never drained into the model, or the store claims
delivery while it is still pending"*, W1-2 *"fails if: a drained message is reported delivered while the
model never consumed the turn, or is stuck mid-claim, or delivery state is not observable"*, W1-11
*"fails if: mid-turn injection unavailable but the API claims the steer was injected or delivered when
it only sits queued for the next turn"*.

## Mutation proofs (RED → restore → GREEN), applied to the running artifact

Both mutations edited the **host tree the live `:9119` server imports** and were then committed-tree
restored (verified `git diff ui/server.py` empty and `git diff balabot/queueing.py` empty afterwards).
Each run reports the isolated W1 block.

### Proof 1 — make the mailbox non-durable → W1-9 goes RED

Mutation: `MessageQueue.enqueue` replaced its INSERT `_do()` with a no-op — the API answers "ok" but the
steer is never written, exactly the "lives only in the in-flight request" regression. RED:

```
FAIL | W1-9 steering mailbox durable store    held=False  [fails if: the steer is not held at all — it lives only in the in-flight request]
FAIL | W1-2 drained msg not delivered w/o model  queued=False settled=None delivery={'queued': 0, 'draining': 0, 'delivered': 0}
FAIL | W1-11 halt-and-replan fallback honest   routing={} entry=None delivered=None
```

(W1-2/W1-11 also go red — expected: a steer that was never stored cannot be observed; the durability
property is load-bearing for all three.) Restored → GREEN:

```
PASS | W1-9  steering mailbox durable store    held=True survived_restart=True delivered_to_model=True emptied=True pending=0 delivered=1
PASS | W1-2  drained msg not delivered w/o model   queued=True settled=queued delivery={'queued': 1, 'draining': 0, 'delivered': 0}
PASS | W1-11 halt-and-replan fallback honest   routing={'injected': False, 'path': 'next_turn', ...}
```

### Proof 2 — confirm delivery at drain regardless of the model → W1-2 goes RED

Mutation: the `/api/chat` stream `finally` is changed to call `q.mark_delivered(...)` unconditionally
when rows were claimed (the old eager-marking behavior). The aborted turn now marks the drained message
delivered even though the model never consumed it. RED:

```
PASS | W1-9  steering mailbox durable store    held=True survived_restart=True ...
FAIL | W1-2  drained msg not delivered w/o model   queued=True settled=delivered delivery={'queued': 0, 'draining': 0, 'delivered': 1}  [fails if: a drained message is reported delivered while the model never consumed the turn ...]
PASS | W1-11 halt-and-replan fallback honest
```

Restored → GREEN:

```
PASS | W1-2  drained msg not delivered w/o model   queued=True settled=queued delivery={'queued': 1, 'draining': 0, 'delivered': 0}
```

## Regression bar

- `python tests/e2e/bridge_api_e2e.py` → **36 passed, 0 failed, 12 pending** (all W1-9/W1-2/W1-11 are
  PASS; W1-1, W1-10, W1-14, W1-15, W2-*, W3-*, the nine W4 rows, the eight W5 rows, W6-*, W8-*, W9-9,
  Polaris guards unchanged and green).
- `pytest tests -q -rs` (env sourced into the process) → **476 passed**, no regression.

## Anything not done / gaps

1. **The "upstream-refusing stub" is the aborted turn, not a refusing model.** I could not build a
   scenario where a *real upstream 400* happens after the drain, because appending the drained steer to
   the payload makes it well-formed (verified on the live gateway). The honest "model never consumed
   the turn" case in this product is the client abort, and the harness drives that. If a future product
   change lets the upstream genuinely refuse after accepting a drained payload, this row should grow an
   explicit refusing-upstream leg.
2. **The harness restarts the product server.** The W1 block brings the `:9119` server up under a
   repo-local `BALABOT_QUEUE_DB` (needed to prove durability by a real restart and to keep the store
   inside the sandboxed repo), then kills it and relaunches the server with the original environment.
   `:9119` is left healthy and on the original configuration. "Reuse the server; never start a second
   one" is honoured — only one process listens at a time and the original is what runs again afterwards.
3. **No mid-turn injection channel exists.** W1-11 is therefore about honesty of the fallback, not about
   a togglable injection path. If a mid-turn injection mechanism is ever built, its availability must
   flip `routing.injected` and the W1-11 assertion should then exercise the injected path too.
4. **The pre-existing dirty files** `tests/e2e/ui-bridge-e2e-results.json`, `tests/e2e/ui_bridge_e2e.mjs`
   and `ui/src/sessions.ts` were present in the working tree before this work and were left untouched —
   they are not part of these three rows.

## Commits

```
000af24 docs(review): W1 steering-mailbox live acceptance + silent-restore harness fix
028b2a5 test(e2e): send a valid Content-Length in the aborted-chat turn (W1-2)
b893673 feat(queue): durable steering mailbox with honest, observable delivery state (W1-9/W1-2/W1-11)
```