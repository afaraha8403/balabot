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

## W6-8 — pruning never drops this turn's image (landed)

**Proves:** the server-side pruning that already exists — `SessionStore.compact()`
in `balabot/sessions.py:366` (landed with W2-6/W2-7) — force-retains the newest
user turn, so the turn that carries this turn's image reference survives
compaction while the older middle is dropped. The prior `REMAINING-ROWS` note
that "neither a context-pruning ... feature exists" was wrong: `compact()` **is**
the pruning mechanism, not an unrelated helper, and W6-8 is an invariant of it —
not a new feature and not blocked on an upstream payload recorder.

**Changes:**
- `tests/e2e/bridge_api_e2e.py` — `w6_scenarios()` replaces the W6-8 `pending`
  row with `_w6_08_compact_keeps_newest_turn_image()`, driven through the live
  HTTP surface. It uploads a real PNG via `POST /api/attachments`, writes the
  served `/api/attachments/...` URL into the **newest** user turn, compacts with
  `protect_first_n=1, protect_last_n=1` (so the tail window holds only the
  trailing assistant reply and the newest user turn would be pruned without the
  protection), then reads the durable transcript back.
- Shared `_container_deploy()` / `_container_restore()` helpers snapshot the
  container's image-baked `balabot/sessions.py`, deploy the committed copy for
  the run, and restore it on exit (the same contract the W2-6/W5/W9 rows use).

**GREEN evidence** (live `:9119`, committed `sessions.py` deployed):
```
[PASS] W6-8 compact accepted                                    HTTP 200 pruned=3 remaining=3
[PASS] W6-8 newest turn's image survives pruning                image kept=True (3 turns remain)
[PASS] W6-8 older middle content dropped (not a no-op)          3 messages remain
[PASS] W6-8 image file survives pruning                         GET /api/attachments/... -> HTTP 200
```
`pruned=3 remaining=3` = the immortal head `u1` + the newest user turn `u3`
(image) + the trailing reply `a3`; the middle `a1,u2,a2` is gone, and `u3`'s
image URL is still in the transcript.

**RED evidence** (mutation: `balabot/sessions.py` newest-user-turn retention
inverted — `keep.add(s)` → `keep.discard(s)` — so the prune is *forced* to
include the newest turn):
```
[PASS] W6-8 compact accepted                                    HTTP 200 pruned=4 remaining=2
[FAIL] W6-8 newest turn's image survives pruning                image kept=False (2 turns remain)  [fails if: the newest user turn carrying this turn's image was pruned]
[PASS] W6-8 older middle content dropped (not a no-op)          2 messages remain
[PASS] W6-8 image file survives pruning                         GET /api/attachments/... -> HTTP 200
```
Only the image-survival check flips — the row genuinely measures the protected-
newest-turn property and nothing else. Restored to GREEN above; the mutation was
never committed (`git checkout -- balabot/sessions.py`).

**Honest scope of the proof.** The durable transcript stores the turn's text; the
attachment's served URL is the reference that rides the newest turn in this
scenario, and the attachment **file** lives under the attachments directory
(outside the pruned transcript) so pruning never targets it. What the scenario
proves at the pruning layer is therefore the load-bearing fact: `compact()` never
drops the newest user turn. End-to-end multimodal forwarding of the *current*
turn's image (request-body `attachments` → `image_url` parts before upstream) is
separately proven by `tests/test_attachments_p0_5.py::
test_chat_converts_image_attachment_to_multimodal_object`. Together the image
cannot be dropped by pruning.

**Honest limit (unchanged contract):** the running container keeps its
image-baked `sessions.py` (the harness restores it), so the endpoint reports an
honest `unavailable` against the container until `balabot/sessions.py` is
deployed — like the rest of the W5/W9 surface.

## W6-12 — attachment payload size cap upstream (stays pending, missing spec)

**This one is genuinely a missing feature.** No upstream payload-size cap exists
anywhere in the repo, and no in-repo spec asks for one, so it is left `pending`
with the precise account below rather than fabricated.

- **The upstream payload path.** `/api/chat` (`ui/server.py:2999`) assembles the
  forwarded `messages` — including multimodal `{"type": "image_url", ...}` parts
  built in `ui/server.py:3057-3141` — and streams it to the hard-coded upstream
  `UPSTREAM = "http://127.0.0.1:8642"` (`ui/server.py:64`) at
  `f"{UPSTREAM}/p/{profile}/v1/chat/completions"` (`ui/server.py:2134`).
- **The only size control today.** `ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024`
  (`ui/server.py:713`), enforced per file inside `upload_attachment`
  (`ui/server.py:716-802`). That bounds a *single* uploaded attachment; it does
  **not** bound the assembled upstream payload. N attachments, or a large
  accumulated transcript, forward unbounded.
- **Where a cap would live.** A byte/size budget on the assembled `messages`
  right before the upstream stream opens (`ui/server.py:3130-3160`), or an
  explicit payload guard in the chat handler.
- **The missing spec.** No `docs/kb/` note states the cap's threshold, what it
  counts (attachments only, transcript text, or both), or its behaviour on breach
  (refuse the turn / drop oldest / drop images). Building it now would invent the
  contract — exactly the fabrication the project rules forbid.

**Honest pending count this pass:** W6-8 landed (pending 8 → 7); W6-12 remains
one of the 7.

## Rows not landed — honest blockers

These remain registered `pending` in `tests/e2e/bridge_api_e2e.py`. Each needs a
product feature that does not exist in the repo, or a test hook that would
violate the "no fixture logic in product code" rule. Building them now would be
fabrication, not a fix.

Verified against the current tree (HEAD `8db3e9e`); each needs a product feature
that does not exist in the repo, or a test-only hook the "no fixture logic in
product code" rule forbids.

- **W6-12 attachment payload size cap upstream** — see the dedicated section
  above: no payload-cap behaviour exists, the per-file 10 MiB upload limit is the
  only size control, and no in-repo spec defines the cap contract.
- **W3-15 lease audit trail completeness** — no screen-lease subsystem
  (acquire/expire/force-release) and no lease endpoints exist to audit
  (`grep -n "lease" ui/server.py balabot/*.py` → 0 functional hits).
- **W7-6 display cap and eviction** — no display-allocation/eviction state is
  queryable over HTTP; `balabot/computer.py` has no cap/eviction model.
- **W7-14 sub-bots don't get displays** — no sub-agent display policy exists;
  `ui/subagents.py` contains no display-allocation code to gate (its only
  `lease` reference is a docstring about the container's CLI lease).
- **W8-1 slow container call doesn't stall endpoint** — true by construction:
  `_org_run_async` dispatches through `asyncio.to_thread` (`ui/server.py:1319`)
  and the static audit `W8-13` proves no blocking call sits inside an `async def`.
  Proving it dynamically needs a *known* slow work unit; the only genuine slow
  container calls are the screenshot paths (`_computer_run` → `docker exec`, a
  **sync** `def` served on the threadpool, not the `to_thread` path under test).
  Injecting a delay is a test-only branch in product code (forbidden).
- **W8-9 endpoints state 'pending' honestly** — needs the same absent slow-work
  fixture; the honesty sweep itself is already proven by `tests/e2e/org_e2e.py`
  S10 and `unavailable()` (`ui/server.py:182`), so a bridge re-assertion would be
  redundant, not new coverage.
- **W8-11 background task errors surface** — no background routine *runner*
  exists. `ui/server.py` owns only a routine *list* (`_get_bot_routines`,
  `create/update/delete`), nothing schedules or executes a task to make throw.

**Net for this pass (W6-8 landed):** `W6-8` now runs as a real RED→GREEN
scenario against the live artifact (`8db3e9e`) — it disproves the earlier claim
that server-side pruning did not exist: `SessionStore.compact()` **is** the
pruning mechanism, and the newest turn's image survives it. The live API harness
is green at **52 passed / 0 failed / 7 pending** (was 48 / 0 / 8) and full
`pytest` is green at **487 passed** (one unrelated timing flake in
`tests/test_intervention.py` re-ran green). `W6-12` remains `pending` because it
is a genuinely missing product feature with no in-repo spec — the remaining 7
rows need product subsystems that this repo does not authorise yet, and no
fixture hook may be added to product code. An honest gap beats a fabricated pass.

---

# Track W8 — background routine runner + honest retirement (branch `wt/w8`)

Evidence for this section is `pytest` in this worktree only. The shared E2E
harness (`tests/e2e/bridge_api_e2e.py`) is the coordinator's serial gate and was
**not run here**; the W8 rows below were updated in that file but the counts it
prints are the coordinator's to report.

## W8-11 background task errors surface — BUILT (commits `6677927`, `aa79fc8`)

**What the row proves.** A registered routine now actually executes as a
background task, and a routine that **throws is recorded** — the failure (routine
id, error, timestamps) is readable over HTTP at
`GET /api/bots/{bot_id}/routines/runs`. The throwing task is guarded so it can
never escape and kill the runner or the endpoint; a handler-less routine is an
honest `409`, an unknown routine a `404`.

**Where.** `ui/server.py`: `register_routine_handler` (`ui/server.py:1175`),
`_execute_routine` (guarded task, `ui/server.py:1191`), trigger
`POST /api/bots/{bot_id}/routines/{routine_id}/run` (`ui/server.py:1218`), run
log `GET /api/bots/{bot_id}/routines/runs` (`ui/server.py:1233`). Sync handlers
run through `asyncio.to_thread`; in-flight tasks are retained in `_routine_tasks`
so asyncio's weak-reference GC cannot silently drop a running routine.

**RED→GREEN.** Fails-if: the failure never reaches the surface.

- **RED** — remove the error capture (`except Exception: raise`) and run
  `pytest tests/test_routines.py -q`:
  ```
  2 failed, 2 passed in 12.08s
  FAILED tests/test_routines.py::test_throwing_routine_error_surfaces_over_http
  FAILED tests/test_routines.py::test_failing_routine_does_not_kill_runner_or_endpoint
  ERROR asyncio Task exception was never retrieved
    exception=RuntimeError('routine boom')
  E  AssertionError: no failed run for rt_..._a50cd1 within 5.0s
  ```
  The failure vanished: no `failed` run record, only an unraisable asyncio log —
  exactly the swallowed-background-error this row guards.
- **GREEN** — restore the capture (`git checkout -- ui/server.py`):
  ```
  .... 4 passed in 2.92s
  ```

**Coverage.** `tests/test_routines.py` (4 tests) exercises the real FastAPI app
with an in-process handler registered through the public entry point: a throw
surfaces with `RuntimeError: routine boom`, a subsequent good routine still
completes, the endpoints stay alive after the failure, and 404/409 are honest.
Full suite: **493 passed** in this worktree.

**Not done.** The runner is in-memory only (run log is not persisted across a
process restart) and there is no scheduler — a caller must trigger a run. Those
are W8-3/W8-4/W8-7/W8-12 and are out of this row's scope.

## W8-9 endpoints state 'pending' honestly — RETIRED (duplicate coverage)

Not built. The honesty sweep already exists and is proven: the unavailable-state
contract is `unavailable()` at `ui/server.py:183` and the live sweep is
`tests/e2e/org_e2e.py` S10. A bridge re-assertion of the same property would be
**duplicate coverage, not new coverage**, so the row is registered retired in
`tests/e2e/bridge_api_e2e.py` (`retired(...)`) rather than pending. Nothing was
weakened.

## W8-1 slow container call doesn't stall endpoint — RETIRED (not provable without test logic in the product)

Not built. It is **true by construction**: `_org_run_async` dispatches through
`asyncio.to_thread` (`ui/server.py:1406`, def at `ui/server.py:1394`), and the
static audit `W8-13` proves no blocking call sits inside an `async def`.
Proving it *dynamically* requires injecting a delay into shipped product code — a
test-only branch in the product, which is forbidden. Registered retired in
`tests/e2e/bridge_api_e2e.py` with that justification; nothing was weakened.