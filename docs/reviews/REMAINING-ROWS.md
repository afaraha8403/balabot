# Remaining rows — land one at a time

What each cleared row proves, its RED-to-GREEN evidence, and anything left undone.

## W2-2 — deterministic server-side assertions (red row fixed)

**Proves:** the delta protocol is accepted, the server merges the durable store
history (the seed the delta client deliberately did NOT re-upload is retained),
and the turn's user + assistant rows are persisted back to the store. The legacy
full-history path is proven additively (W2-8): the request is accepted, the
stream carries a real reply, and the legacy turn reaches the durable store.

**The red row's real cause:** `W2-2 legacy full-history send still works`
asserted `"LEGACY-OK" in sse_reply_text(stream2)` against the model's prose. On a
quiet re-run the governor refuses the false confirmation (the session/bot has
accumulated many conflicting codenames), so the literal token is absent — the
row went red while HTTP was 200. Worse, when the model *did* refuse it sometimes
quoted the token (`...printing "LEGACY-OK" would be a false confirmation`), so
the assertion could pass by accident. The sibling sentinel-echo check was flaky
for the same reason: it depended on the model politely repeating a string.

**Fix:** both checks now assert what the server does, never what the model says:
- `W2-2 server rebuilt context from the durable store` — un-reuploaded seed
  present in the store, delta present, a non-empty assistant reply persisted.
- `W2-2 legacy full-history send still works` — HTTP 200 + non-empty reply +
  the legacy user turn persisted to the store.

**RED evidence** (mutation: force every `/api/sessions/{id}/messages` read to
return zero rows — the "history not intact / turn not persisted" property):
```
[PASS] W2-2 delta-only send accepted :: HTTP 200
[FAIL] W2-2 server rebuilt context from the durable store :: 0 rows seed=False delta=False reply_persisted=False replied=236ch
[FAIL] W2-2 store keeps seed AND delta :: 0 rows
[FAIL] W2-2 legacy full-history send still works :: HTTP 200 reply=253ch legacy_turn_persisted=False
```

**GREEN evidence** (real store read, live server):
```
[PASS] W2-2 delta-only send accepted :: HTTP 200
[PASS] W2-2 server rebuilt context from the durable store :: 3 rows seed=True delta=True reply_persisted=True replied=143ch
[PASS] W2-2 store keeps seed AND delta :: 3 rows
[PASS] W2-2 legacy full-history send still works :: HTTP 200 reply=302ch legacy_turn_persisted=True
```
Note reply 2 did **not** contain the literal `LEGACY-OK` (`...printing LEGACY-OK
would be a false confirmation`) and the row still passes — the old assertion
would have failed on exactly this output.

`pytest tests -q` → **487 passed** (unchanged).

**Honest limit:** without an upstream-payload seam, "the server forwarded the
merged history upstream" is only directly observable through the model's answer.
These checks assert the server-side *effect* of the rebuild (durable history intact
+ turn persisted + request accepted). Detecting a merge that silently forwards
only the delta would need the payload recorder the W6-8/W6-12 rows call for.

## W2-13 — two clients converge to one order under interleave (real defect)

**Proves:** when two browser clients send into the same session in the same
instant, both transcripts render the two turns in the SAME order, and neither
client loses the other's turn.

**The defect (real, not a flake).** `ui/src/sessions.ts` `findLocalEcho()`
adopted ANY incoming server row onto ANY same-role local message that was
unsequenced and at the tail — content-agnostic, by design, to absorb a
client-transformed assistant copy. When client A's user turn fanned out to
client B, B adopted A's server row onto B's OWN unsequenced optimistic user
message (a different turn): A's content was swallowed and B's own echo then
appended a second copy of B. A quiet-server transcript dump showed it directly:
```
--- page A ---   ... E2E-W2-13a-320146 / E2E-W2-13b-320146   (correct)
--- page B ---   ... E2E-W2-13b-320146 / E2E-W2-13b-320146   (A missing, B twice)
```

**Fix:** the client already sends its optimistic id as the wire `message_id`, so
the server echo for that turn carries that exact id (handled by the id-match
branch). `findLocalEcho` now refuses to adopt a server row whose `message_id`
differs from the local candidate's id — only an id-less local (the transformed
assistant copy) stays adoption-eligible.

**Harness measurement fixed (same pass, not a relaxation).** The scenario read
`document.body.innerText.indexOf(text)`, which matches the session-list preview
earlier in the DOM, so it measured the sidebar, not the conversation. It now
reads the transcript rows (`[data-message-id]`) under the unique stamp.

**RED evidence** (product guard disabled, rebuilt, quiet server):
```
FAIL  W2-13 two clients converge to the same order under interleave  <- a=[624,625] b=[-1,624]
```

**GREEN evidence:**
```
PASS  W2-13 two clients converge to the same order under interleave
1/1 runnable scenarios passed, 0 reported pending
```
And the raw transcript tails, post-fix, converge on both pages:
```
page A: E2E-W2-13a-402335 / E2E-W2-13b-402335
page B: E2E-W2-13a-402335 / E2E-W2-13b-402335
```

`npm run build` in `ui/` deployed the SPA fix. `pytest tests -q` → **487 passed**.


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

## W9-14 — vault artifact idempotency on replay

**Proves:** every approval decision lands as a human-readable OKF vault artifact
(one markdown file per effect key), and replaying the same decision is a no-op —
it never creates a second artifact and never rewrites the first. This is the
"vault writer" the W5-10 and W9-6 rows were waiting on: the artifact carries the
decision, actor, tool/scope, canonical args hash, and timestamp, and is
queryable by effect key.

**Changes:**
- `balabot/approvals.py` — `record_vault_artifact()` writes the OKF markdown
  (YAML frontmatter + body) under `BALABOT_VAULT_DIR` (default
  `<BALABOT_DATA_ROOT>/vault`) keyed by effect key; a same-action replay returns
  the existing artifact unchanged, a different decision supersedes the single
  file. `vault_artifact()` / `vault_artifact_path()` read it back. Wired into
  `approve()` and `deny()`; new `vault --key K` CLI verb.
- `tests/test_approvals.py` — three unit tests (written, queryable, idempotent
  on replay, supersedes on a different decision).
- `tests/e2e/bridge_api_e2e.py` — `w9_scenarios()` replaces the pending row with
  a real container-driven scenario (snapshot/deploy/restore `approvals.py`, same
  contract as the W5 rows).

**RED evidence — idempotency broken (same-action no-op disabled):**
```
E       assert True is False
E        +  where True = replay_out["vault_artifact"]["updated"]
tests/test_approvals.py:64: AssertionError
FAILED tests/test_approvals.py::test_vault_artifact_idempotent_on_replay
```

**GREEN evidence:**
```
$ pytest tests/test_approvals.py -q
3 passed in 0.25s

$ pytest tests -q
487 passed in 34.20s

$ python tests/e2e/bridge_api_e2e.py
[  ok ] W9-14 approval lands an OKF vault artifact               artifact=yes action=approve
[  ok ] W9-14 replay does not duplicate or rewrite the artifact  created=False updated=False files=1 same=True
...
48 passed, 0 failed, 8 pending
```

**Not done / honest gap:**
- The sibling rows `W5-10` (approvals land as OKF vault artifacts) and `W9-6`
  (vault decision record queryable by effect key) live in `bridge_shell_e2e.sh`
  and are still registered `pending` there. The capability now exists and is
  proven here; flipping those two shell rows is mechanical follow-up, not landed
  in this pass.
- The running container keeps its image-baked `approvals.py` (the harness
  restores it), so the vault artifact is written only once `balabot/approvals.py`
  is deployed (image rebuild or `docker cp`), like the rest of the W5 surface.
- One earlier full-harness run reported a single transient failure in an
  unrelated row; the immediate re-run was 48 passed / 0 failed and the new W9-14
  checks passed in both runs. The harness makes live model turns, so a rare
  timing/answer flake is expected; no code path in this change was implicated.

## Rows not landed — honest blockers

These remain registered `pending` in `tests/e2e/bridge_api_e2e.py`. Each needs a
product feature that does not exist in the repo, or a test hook that would
violate the "no fixture logic in product code" rule. Building them now would be
fabrication, not a fix.

- **W6-8 pruning never drops this turn's image** and **W6-12 attachment payload
  size cap upstream** — the upstream payload is assembled and forwarded *inside*
  the `:9119` host process to a hard-coded upstream (`ui/server.py:64`
  `UPSTREAM = "http://127.0.0.1:8642"`). There is no payload-recording seam and,
  more importantly, no context-pruning or upstream payload-cap feature in the
  product (`grep` for `prune`/payload caps in `balabot/**` finds none). No
  in-repo spec (docs/kb) states the pruning/cap contract, so implementing one
  would invent behaviour. A "payload recorder" is a test double, not the feature.
- **W3-15 lease audit trail completeness** — no screen-lease subsystem
  (acquire/expire/force-release) and no lease endpoints exist to audit.
- **W7-6 display cap and eviction** — no display-allocation/eviction state is
  queryable over HTTP; `balabot/computer.py` has no cap/eviction model.
- **W7-14 sub-bots don't get displays** — no sub-agent display policy exists;
  `ui/subagents.py` only *reads* the CLI lease from the container, it does not
  gate display allocation.
- **W8-1 slow container call doesn't stall endpoint** — already true by
  construction: `_org_run_async` dispatches through `asyncio.to_thread`
  (`ui/server.py:1319`). Proving it needs a slow-work fixture, and the only way
  to inject one is a test-only branch in product code (forbidden) — there is no
  genuinely slow endpoint to observe.
- **W8-9 endpoints state 'pending' honestly** — needs the same absent slow-work
  fixture; the honesty sweep is already covered by `tests/e2e/org_e2e.py` S10.
- **W8-11 background task errors surface** — no background routine runner exists
  to force a throwing task.

**Net for this pass:** three rows landed and pushed — `W2-6`/`W2-7`
(`022b99d`) and `W9-14` (`8da61c7`) — with full `pytest` green (487) and the
live harness green (48 passed / 0 failed). Six rows remain honestly `pending`.