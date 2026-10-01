# FIX — intervention poll reverted an owner's approval (lost update)

Review date: 2026-09-30 · Branch: `master` → pushed `origin master:main` ·
Impact: `balabot/intervention.py` (`state`, `_tick`, `active_for_bot`,
`list_interventions`, new `_db_expire_if_pending`), `tests/test_intervention.py`.
Status: fixed and verified; every number in the table below is a real run.

## Symptom

`tests/test_intervention.py::test_bot_tools_request_intervention_waits_and_resolves`
failed intermittently (~1 run in 6, no test-ordering plugin installed — the
model flake is timing, not order):

```
assert out["state"] == "accepted"
E   AssertionError: assert 'expired' == 'accepted'
tests	est_intervention.py:285
```

The owner resolved the pause within milliseconds and the record was committed
as `accepted`, yet the waiter still blocked the full 15 s timeout and reported
`expired`. A wrong verdict in a safety-relevant path: the bot would resume
unattended and never apply the release the owner granted.

## Root cause: read-then-write, no conditional

`intervention.state()` is the paused bot's poll. It evaluated expiry lazily —
which is correct — but then persisted the record it had just read:

```python
record = _db_get_record(clean_tok)     # reads pending
record = _tick(record, now)            # no change (not expired yet)
_records[clean_tok] = dict(record)     # in-memory copy: pending
_db_save_record(record)                # blind INSERT OR REPLACE: pending
```

`_db_save_record` is an unconditional `INSERT OR REPLACE`. When the poll's read
interleaved with `resolve_intervention`'s commit, the poll's stale `pending`
copy overwrote the committed `accepted` row — a classic lost update. It also
overwrote the in-memory copy, so nothing self-corrected and the waiter polled
`pending` until `expires_at` passed, where `_tick` finally flipped it to
`expired`.

Instrumented proof (thread resolved the token, state lost):

```
found    iv_84106c4af596_32d40bac  ... pending
resolved accepted
FAIL dt=14.35 state=expired   db row state=expired   (final)
```

Each `_get_conn()` call opens its own connection (WAL, 30 s timeout), so the
failure is not a "database is locked" error — both writes succeed, the last
one wins.

## Fix

1. `state()` observes unless the tick changed the state. `pending -> expired`
   (the only transition a poll can make) is persisted as
   `UPDATE ... SET state='expired' WHERE resume_token = ? AND state = 'pending'`
   — conditional, so a decision committed in the meantime wins.
2. `active_for_bot()` and `list_interventions()` wrote back the whole ticked
   record the same way; both now use the same conditional write.
3. `_tick()` returns a copy instead of mutating in place, so callers can
   compare before/after.

## Verification

| Check | Result |
| --- | --- |
| New deterministic regression test on pre-fix code (`git stash` of the module) | **RED** (`tests/test_intervention.py:324`) |
| New deterministic regression test on fixed code | green |
| `test_bot_tools_request_intervention_waits_and_resolves` x12 (was ~1 in 6 failing) | 12 passed |
| `tests/test_intervention.py` x12 | 22 passed each |
| `pytest tests -q` x3 | 489 passed each |
| `python tests/e2e/bridge_api_e2e.py` | 52 passed, 0 failed, 7 pending (unchanged) |

The regression test forces the interleaving instead of racing for it: it holds
a `pending` snapshot, lets the owner resolve, then serves that snapshot to the
poll and asserts the decision survives in both the store and the in-memory
copy. A second test guards the honest case (a genuinely lapsed pause is still
flipped to `expired` and persisted; a decided record is never re-expired).
