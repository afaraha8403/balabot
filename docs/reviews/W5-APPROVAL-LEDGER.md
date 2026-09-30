# W5 — Approval Ledger: Live Acceptance

Review date: 2026-09-30 · Harness: `python tests/e2e/bridge_api_e2e.py` (the eight former `pending("W5-…")`
stubs are now real scenarios) · Runtime artifact: `balabot-balabot-1` container, adapter on `http://127.0.0.1:9119`

## What was tested

The approval gate is exercised through the **real Hermes call site** — `python3 -m balabot.bot_tools …`
inside the container — exactly as the gateway invokes it. The container's `/opt/balabot` is
image-baked (only `/opt/data` is a volume), so the harness deploys the W5-committed
`balabot/approvals.py` + gate-wired `balabot/bot_tools.py` into the container, drives every scenario
against them, and restores the container's previous files on exit (verified byte-identical after —
`approvals.py` removed, `bot_tools.py` back to the pre-W5 snapshot). No product code keys off any
test string (constraint #1 is untouched: the harness only deploys the committed tree and sets env on
the invocation).

**Enforcement is engaged per-process.** Each gated scenario runs the container CLI with
`BALABOT_APPROVALS_ENFORCE=1` and an isolated `BALABOT_APPROVALS_DB` on the `docker exec` invocation
env — the exact deploy switch, default OFF, so the running server on `:9119` never sees it and the
W1–W4/W8/W9 rows are untouched. A scenario that never engages the gate would prove nothing; every
gate-engaged row goes RED when the switch is absent (shown under Mutation proof 1).

## The interception point — and why the real mutating traffic transits it

| Concern | Answer |
|---|---|
| Where is the gate placed? | `balabot/bot_tools.py:959` `_check_gate(tool, args, scope)` — called at the **top of almost every dispatch branch** in `main` (11 of 12 tools; e.g. `request_secret` at `bot_tools.py:1034`, `record_growth_audit` at `:1148`, `secret_request` at `:1241`). |
| Is it on the path the model actually drives? | Yes. Hermes invokes `python3 -m balabot.bot_tools <tool> …` in the container; `main()` runs the gate before the tool body and **stops the dispatch** when `check_mutation` returns a refusal/expiry/replay body. A gate the actual verbs bypass would be worthless — the scenarios prove interception by asserting the refusal body is what the CLI prints AND (for the mutation verbs used here) that the tool's own side-effect file never grew. |
| Is every call audited? | `check_mutation` (`balabot/approvals.py:387`) appends an `attempts` row on every invocation regardless of verdict — observe, allowed, refused, expired, replay, authorized — so the classification is explicit AND logged even with the switch off. |
| Failure direction | Deliberate fail-CLOSED deviation from Jev fail-open: if the ledger cannot be read while enforcement is on, the mutation is refused as `approval ledger unavailable` (`approvals.py:446–466`). |

## The canonical-key scheme

`effect_key(tool, args, scope)` (`balabot/approvals.py:265`) = first 12 hex chars of
`sha256("balabot/effect/v1\0" + JSON{tool, scope, args:_normalized})`. `_normalize` (`:228`) sorts
dict keys, strips strings, and upper-cases the HTTP `method` field; numeric types are **not** coerced
(`1` vs `1.0` encode different HTTP bodies — they must stay distinct keys). So the same call hashes to
the same key in every process and every run, reordered/whitespace/cased-equivalent args collapse to the
same key, and mutation-relevant differences produce a new, separately-approved action. W5-3 proves
determinism + canonicality; W5-5 proves args-sensitivity.

## Ledger schema

`balabot/approvals.py:131–170` (`_get_conn`, WAL, `busy_timeout`:30 s, default
`<BALABOT_DATA_ROOT>/approvals/approvals.db`):

- **`decisions`** — `effect_key` PK, `tool`, `scope`, `canonical`, `state`
  (`refused|approved|expired|executed`), `created_at`, `expires_at` (epoch), `approved_by`,
  `approved_at`, `denied_by`, `denied_at`, `executed_at`, `claim_scope`, `note`.
- **`approval_events`** — append-only `(effect_key, actor, action, at, detail)`: `approve`, `deny`,
  `system/expire`, `claim`.
- **`attempts`** — append-only `(effect_key, tool, kind, scope, decision, at, detail)`: the
  classification/outcome log, one row per call.

Exactly-once claim: one atomic `UPDATE … SET state='executed', executed_at=?, claim_scope=? WHERE
state='approved' AND executed_at IS NULL AND expires_at >= ?` (`approvals.py:567`) — only the caller
that wins `rowcount == 1` executes; replayed/concurrent calls read state and report `replay`.

## How enforcement is engaged in the scenarios

The harness block `w5_scenarios()` (`tests/e2e/bridge_api_e2e.py`):

1. snapshots the container's current `/opt/balabot/balabot/{approvals.py,bot_tools.py}`,
2. `docker cp`s the committed W5 files in (same deploy reality W4 documented),
3. runs the eight scenarios, each on its own ledger file under `/opt/data/approvals/w5-<tag>-<n>.db`
   and each CLI call carrying `BALABOT_APPROVALS_ENFORCE=1` on the container invocation env,
4. restores the container's previous files + deletes fixture ledgers in `finally`.

Observation of "did the mutation actually run" uses the tool's real side effect
(`record_growth_audit` appends to `/opt/data/profiles/…/ledger/growth_audit.jsonl`), counted via
`balabot.growth.read_audit_entries` in-container — an authorized call grows it by exactly one, a
refused/replay call never touches it.

## The eight outcomes (all GREEN — final run)

```
[  ok ] W5-setup deploy approvals+bot_tools to container  committed W5 files live in /opt/balabot (snapshot restored on exit)
[  ok ] W5-1  unapproved mutation refused + recorded       refused=True ledger=refused attempts=['refused']
[  ok ] W5-3  effect key deterministic + canonical         key(reordered+cased)='ec13506bd86d' == 'ec13506bd86d', different scope differs=True, different args differ=True
[  ok ] W5-4  turn replay does not double-execute          approved=True ran_tool=True retry=replay/409 ledger=executed growth_entries=1
[  ok ] W5-5  mutated args produce a new action            keys differ=True (…) running A + refusing B=True
[  ok ] W5-8  classification explicit + logged             observe ran=True observe_logged=True mutate_logged=True
[  ok ] W5-11 approval expiry                              approved=True result=expired ledger=expired
[  ok ] W5-13 concurrent approvals of the same key         verdicts=['authorized','replay','replay','replay'] growth_entries=1
[  ok ] W5-14 read-only tools never gated                  list_org_secrets under enforce=1 -> list
33 passed, 0 failed, 15 pending   (pending = feature not built — never folded into passes)
```

Every scenario carries its explicit **fails-if** next to the assertion, e.g. W5-1 *"fails if: an
unapproved mutation executes at all (gate off/absent) or the refusal is not persisted to the ledger
attempts log"*, W5-13 *"fails if: two concurrent callers both authorize one key … — double
execution"*.

## Mutation proofs (RED → restore → GREEN), applied to the running artifact

Both mutations were applied to the container's copy (the artifact the harness drives) via `docker cp`
of a locally-mutated `approvals.py`, then the committed tree was restored byte-for-byte; final state
verified `git diff balabot/approvals.py` empty and the container restored (seen above).

### Proof 1 — let an unapproved mutate through (gate off) → W5-1 goes RED

Mutation: `enforcement_enabled()` (`approvals.py:174`) now `return False`. With the switch ignored,
`check_mutation` returns `allowed` for an unapproved mutation, the tool runs, and W5-1's
"refused + recorded" cannot hold. RED:

```
[FAIL] W5-1 unapproved mutation refused + recorded   refused=False ledger=None attempts=[]  [fails if: …
27 passed, 6 failed, 15 pending
```

(5 other gate-engaged rows also go red — expected; they all depend on the switch.) Restored → GREEN:

```
[  ok ] W5-1 unapproved mutation refused + recorded   refused=True ledger=refused attempts=['refused']
33 passed, 0 failed, 15 pending
```

### Proof 2 — make `effect_key` ignore arguments → W5-5 (and W5-3's args-sensitivity) go RED

Mutation: the `args` member of the key blob replaced with `{}` (`approvals.py:272`). Now every call
to a tool+scope shares one key, so "mutated args produce a new action" collapses and approvals leak
between different calls. RED:

```
[FAIL] W5-3 effect key deterministic + canonical   key(reordered+cased)='2cc9717f5e6a' == '2cc9717f5e6a', different scope differs=True, different args differ=False
[FAIL] W5-5 mutated args produce a new action      keys differ=False (51fde2607ff2 vs 51fde2607ff2) running A + refusing B=False
31 passed, 2 failed, 15 pending
```

W5-3 additionally proves it is non-vacuous: it asserts a **different** key for different args, so it
cannot pass simply because reordered args collapse. Restored → GREEN:

```
[  ok ] W5-3 effect key deterministic + canonical   … different scope differs=True, different args differ=True
[  ok ] W5-5 mutated args produce a new action      keys differ=True (…) running A + refusing B=True
33 passed, 0 failed, 15 pending
```

## Regression bar

- `python tests/e2e/bridge_api_e2e.py` → **33 passed, 0 failed, 15 pending** (W1-*, W2-*, W3-*, W4
  nine rows, W6-*, W8-*, W9-9, Polaris guards unchanged and green; only the eight W5 stubs became
  real scenarios).
- `pytest tests -q -rs` (env sourced) → **476 passed**, no regression.

## Anything not done / gaps

1. **The gate is enforced per-process in these scenarios, not on the long-lived server.** The switch
   is read from the environment at call time (`enforcement_enabled`), so a deployment that wants the
   gate ON for the gateway sets `BALABOT_APPROVALS_ENFORCE=1` in the container/service env; the
   harness passes it per invocation and restores the prior (default-off) state, which is the honest
   way to prove the gate without leaving the platform mutated.
2. **Concurrency is demonstrated at the CLI/lookup level** (four racing `docker exec` processes over
   one SQLite WAL ledger — exactly one `authorized`, three `replay`, one growth entry). A
   per-key multi-process hammer beyond that adds no new property; the atomic claim is the same code
   path (`approvals.py:567`).
3. **No HTTP approval surface yet.** There is no `/api/approvals/*` route/approval card UI — approvals
   are recorded via the CLI (`python3 -m balabot.approvals approve …`) / module API. The W5-11
   "approval cards not implemented" stub was replaced by a TTL-expiry check (the ledger half); wiring
   an owner-facing approval endpoint remains future work.
4. The mutation proofs mutated the container copy; the host tree is byte-identical to the committed
   tree (only the pre-existing dirty `tests/e2e/ui-bridge-e2e-results.json` from the W9-9 run was
   unrelated work left untouched).

## Commits

```
13b9bde test(e2e): W5-3 also asserts args-sensitivity so it cannot pass vacuously
f50c301 test(e2e): W5-5 uses same scope (bot) for both calls; drop duplicate check
a0811b0 test(e2e): replace W5 pending stubs with eight live container scenarios
9df2b9a fix(approvals): audit rows persist; executions mark the ledger executed
0a10839 feat(bot_tools): route mutating tools through the approval gate   (prior secured work)
40ba6a2 feat(approvals): approval ledger, canonical effect keys, observe/mutate classifier (prior secured work)
```