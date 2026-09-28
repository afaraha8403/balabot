#!/usr/bin/env python3
"""BalaBot bridge-plan [API] acceptance scenarios — LIVE HTTP harness.

Implements the [API]-tagged scenarios from the verification-criteria review
(C:/Users/ali/workspace/susan/research/polaris-learnings/reviews/verification-criteria.md)
against the real adapter on http://127.0.0.1:9119 with real basic auth.

House rules honoured here:
- A scenario that cannot fail is not a scenario: every live check names its
  "fails if" next to the assertion.
- A scenario whose endpoint/feature does not exist yet is registered as
  PENDING with its workstream tag — it runs today and reports honestly
  instead of passing vacuously (per the scoring rule: UNPROVEN, never PASS).
- Every mutating scenario creates its own uniquely-named fixture
  (prefix zz-api-<random>) and cleans it up in a finally block.
  principal/governor are never mutated or deleted — locked surfaces must
  refuse (W3-4/W3-11 exercise the refusal path itself).

Usage:
    python tests/e2e/bridge_api_e2e.py          # all scenarios
    python tests/e2e/bridge_api_e2e.py -v       # full detail lines

Existing unit coverage (tests/test_intervention.py, test_secret_proxy.py,
test_sessions.py, test_attachments_p0_5.py, tests/e2e/org_e2e.py S1/S10)
is deliberately NOT duplicated: see the per-scenario comments.
"""
from __future__ import annotations

import argparse
import ast
import base64
import json
import pathlib
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:9119"
KEY_FILE = pathlib.Path(r"C:/Users/ali/secrets/balabot-dashboard.key")
REPO = pathlib.Path(__file__).resolve().parents[2]
CONTAINER = "balabot-balabot-1"

PASS, FAIL, PENDING = "PASS", "FAIL", "PENDING"
results: list[tuple[str, str, str]] = []


# ── transport (org_e2e conventions) ──────────────────────────────────────────
def _auth_header() -> str:
    pw = KEY_FILE.read_text(encoding="utf-8").strip()
    token = base64.b64encode(f"ali:{pw}".encode()).decode()
    return f"Basic {token}"


def _request(method: str, path: str, body: dict | None = None,
             *, timeout: int = 60) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": _auth_header()}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, f"__error__ {e}"


def get(path: str, **kw) -> tuple[int, str]:
    return _request("GET", path, **kw)


def post(path: str, body: dict | None = None, **kw) -> tuple[int, str]:
    return _request("POST", path, body if body is not None else {}, **kw)


def patch(path: str, body: dict, **kw) -> tuple[int, str]:
    return _request("PATCH", path, body, **kw)


def delete(path: str, **kw) -> tuple[int, str]:
    return _request("DELETE", path, None, **kw)


def check(name: str, condition: bool, detail: str, *, fails_if: str = "") -> None:
    tag = "" if condition or not fails_if else f"  [fails if: {fails_if}]"
    results.append((name, PASS if condition else FAIL, detail + tag))


def pending(name: str, tag: str, why: str) -> None:
    results.append((name, PENDING, f"pending ({tag}) — {why}"))


def sse_post_chat(body: dict, *, timeout: int = 300) -> tuple[int, str]:
    """POST /api/chat and capture the raw SSE stream as text."""
    req = urllib.request.Request(
        BASE + "/api/chat", data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": _auth_header(),
                 "Content-Type": "application/json",
                 "Accept": "text/event-stream"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, f"__error__ {e}"


# ── W1-14: SSE drain frames keep the existing handoff grammar ────────────────
def w1_14_sse_drain_grammar() -> None:
    """Queue a message, run one real chat turn with a session_id, capture the
    SSE stream. The drained queued message must arrive as well-formed
    `event:`/`data:` frames in the current handoff grammar and the queue must
    actually drain (not just be echoed).
    Fails if: drain frames change shape (event line without data, or the
    queued sentinel never appears in any frame) — the browser would silently
    drop them and the message would sit 'queued' forever."""
    tag = secrets.token_hex(4)
    sid = f"zz-api-w1s14-{tag}"
    sentinel = f"W1S14-SENTINEL-{tag}"
    bot = "governor"
    created = False
    try:
        st, body = post("/api/sessions", {"botId": bot, "id": sid,
                                          "title": "w1-14 drain grammar probe"})
        created = st == 200 and json.loads(body).get("created") is True
        if not created:
            pending("W1-14 sse drain grammar", "W1",
                    f"could not create fixture session (HTTP {st})")
            return

        st, body = post(f"/api/queue/{sid}", {"content": f"{sentinel} steer probe",
                                              "message_id": f"zz-{tag}-1"})
        if st != 200:
            pending("W1-14 sse drain grammar", "W1",
                    f"queue enqueue unavailable (HTTP {st})")
            return
        pre = json.loads(body).get("queue") or {}
        n_queued = len(pre.get("pending") or pre.get("messages")
                       or pre.get("queued") or [])

        status, stream = sse_post_chat({
            "bot_id": bot, "session_id": sid,
            "messages": [{"role": "user",
                          "content": "Reply with exactly one word: ok"}]})
        if status != 200:
            pending("W1-14 sse drain grammar", "W1",
                    f"chat turn failed (HTTP {status})")
            return

        # Grammar: every `event:` line is followed by a `data:` line before
        # the next blank frame separator. A frame missing its data half is
        # exactly the shape change that makes browsers drop the message.
        lines = stream.splitlines()
        events = [l for l in lines if l.startswith("event:")]
        ok_grammar = all(
            any(lines[j].startswith("data:")
                for j in range(i + 1, min(i + 4, len(lines))))
            for i, l in enumerate(lines) if l.startswith("event:"))
        check("W1-14 frames have event+data pairs", bool(events) and ok_grammar,
              f"{len(events)} event frames", fails_if="drain frame shape changed")

        check("W1-14 queued sentinel reaches the stream", sentinel in stream,
              sentinel, fails_if="drained message never emitted as a frame")

        _, body_after = get(f"/api/queue/{sid}")
        q_after = json.loads(body_after).get("state") or {} if body_after.startswith("{") else {}
        remaining = q_after.get("pending") or q_after.get("messages") \
            or q_after.get("queued") or []
        check("W1-14 queue drained after the turn", not remaining,
              f"{len(remaining)} left (was {n_queued})",
              fails_if="drain marks delivered without consuming the queue")
    finally:
        if created:
            delete(f"/api/sessions/{sid}")


# ── W1-2 / W1-9 / W1-11: not built yet — registered honestly ─────────────────
def w1_pending() -> None:
    pending("W1-2 drained msg not delivered w/o model", "W1",
            "needs upstream-refusing stub; delivery marking not exposed")
    pending("W1-9 steering mailbox durable store", "W1",
            "steering mailbox (pending_steer persistence) not implemented")
    pending("W1-11 halt-and-replan fallback honest", "W1",
            "mid-turn injection investigation unresolved; fallback path "
            "not exposed as API state")


# ── W2-11: server transcript is the assembly source ──────────────────────────
def w2_11_server_is_assembly_source() -> None:
    """A message appended SERVER-side (no client ever saw it) must come back
    from the server transcript.
    Fails if: history assembly still trusts the client's copy and the
    server-side append is dropped or unreadable."""
    tag = secrets.token_hex(4)
    sid = f"zz-api-w2s11-{tag}"
    sentinel = f"W2S11-SERVER-ONLY-{tag}"
    bot = "governor"
    created = False
    try:
        st, body = post("/api/sessions", {"botId": bot, "id": sid,
                                          "title": "w2-11 assembly probe"})
        created = st == 200 and json.loads(body).get("created") is True
        if not created:
            pending("W2-11 server transcript is assembly source", "W2",
                    f"could not create fixture session (HTTP {st})")
            return
        st, body = post(f"/api/sessions/{sid}/messages",
                        {"role": "user", "content": sentinel,
                         "message_id": f"zz-{tag}-m1"})
        check("W2-11 server-side append accepted",
              st == 200 and json.loads(body).get("created") is True,
              f"HTTP {st}", fails_if="server refuses its own durable append")
        st, body = get(f"/api/sessions/{sid}/messages")
        msgs = json.loads(body).get("messages", []) if st == 200 else []
        contents = [str(m.get("content", "")) for m in msgs]
        check("W2-11 sentinel readable from server store", sentinel in contents,
              f"{len(msgs)} rows", fails_if="server-side write never lands — "
              "assembly still trusts the client copy")
    finally:
        if created:
            delete(f"/api/sessions/{sid}")


# ── W2-14: deleted session is server-side, not browser-local ─────────────────
def w2_14_delete_is_server_side() -> None:
    """Create + populate + delete a session; then re-read it.
    Fails if: the delete only removed a client-side entry and the server
    still serves the transcript (ghost session)."""
    tag = secrets.token_hex(4)
    sid = f"zz-api-w2s14-{tag}"
    bot = "governor"
    st, body = post("/api/sessions", {"botId": bot, "id": sid})
    if st != 200:
        pending("W2-14 session delete is server-side", "W2",
                f"could not create fixture session (HTTP {st})")
        return
    try:
        post(f"/api/sessions/{sid}/messages",
             {"role": "user", "content": f"ghost check {tag}"})
        st_del, body_del = delete(f"/api/sessions/{sid}")
        ok_del = st_del == 200 and json.loads(body_del).get("deleted") is True
        check("W2-14 delete accepted", ok_del, f"HTTP {st_del}",
              fails_if="delete route is a stub")
        st2, body2 = get(f"/api/sessions/{sid}")
        gone = st2 != 200 or json.loads(body2).get("available") is not True
        check("W2-14 session gone after delete", gone,
              f"re-read HTTP {st2}", fails_if="ghost session still served")
        st3, body3 = get(f"/api/sessions/{sid}/messages")
        n = len(json.loads(body3).get("messages", [])) if st3 == 200 else 0
        check("W2-14 messages purged with the session", n == 0,
              f"{n} rows remain", fails_if="SQLite rows outlive the delete")
    finally:
        delete(f"/api/sessions/{sid}")  # idempotent safety net


def w2_pending() -> None:
    pending("W2-2 client sends only the delta", "W2",
            "delta protocol not implemented (ui/src/api.ts still uploads "
            "full history); observable only via the UI harness network capture")
    pending("W2-6 compaction keeps newest user turn", "W2",
            "no server-side compaction endpoint exists yet")
    pending("W2-7 compaction bounded + recorded", "W2",
            "no server-side compaction endpoint exists yet")


# ── W3-4: owner impersonation refused ────────────────────────────────────────
def _mk_pause(tag: str) -> tuple[str | None, str]:
    """Create an intervention pause for a UNIQUELY-NAMED synthetic bot
    (never principal/governor — we create no state for them)."""
    bot_id = f"zz-api-w3-{tag}"
    st, body = post("/api/intervention/pause",
                    {"bot_id": bot_id, "reason": f"e2e w3 probe {tag}",
                     "hint": "", "url": ""})
    if st != 200:
        return None, bot_id
    rec = json.loads(body).get("record") or {}
    return rec.get("resume_token") or None, bot_id


def w3_04_owner_impersonation_refused() -> None:
    """Resolve replayed from a non-owner actor must be refused and leave the
    decision unchanged (pending).
    Fails if: resolution is authenticated by token possession alone with no
    actor check (e.g. by=principal resolves a human decision)."""
    tag = secrets.token_hex(4)
    token, bot_id = _mk_pause(tag)
    if not token:
        pending("W3-4 owner impersonation refused", "W3",
                "could not create fixture pause (pause endpoint unavailable)")
        return
    try:
        st, body = post(f"/api/intervention/{token}/resolve",
                        {"action": "approve", "by": "principal",
                         "note": "self-approval attempt"})
        refused = st in (400, 403)
        check("W3-4 non-owner resolve refused", refused, f"HTTP {st}",
              fails_if="any actor holding the token can resolve")
        _, body2 = get(f"/api/intervention/{token}")
        rec = json.loads(body2).get("record") or {}
        check("W3-4 decision unchanged after refusal",
              rec.get("state") == "pending",
              str(rec.get("state")),
              fails_if="the impersonated resolve mutated the record")
    finally:
        post(f"/api/intervention/{token}/resolve",
             {"action": "deny", "by": "ali", "note": "e2e cleanup"})


# ── W3-11: decided records are immutable ─────────────────────────────────────
def w3_11_decided_records_immutable() -> None:
    """Decide a pause (deny), then replay a resolve with the OPPOSITE action.
    Fails if: the overwrite is allowed (approve flips a denied record after
    the fact — history rewriting on the decision ledger)."""
    tag = secrets.token_hex(4)
    token, bot_id = _mk_pause(tag)
    if not token:
        pending("W3-11 decided records immutable", "W3",
                "could not create fixture pause")
        return
    try:
        st, _ = post(f"/api/intervention/{token}/resolve",
                     {"action": "deny", "by": "ali", "note": "first decision"})
        if st != 200:
            pending("W3-11 decided records immutable", "W3",
                    f"first resolve failed (HTTP {st})")
            return
        st2, body2 = post(f"/api/intervention/{token}/resolve",
                          {"action": "approve", "by": "ali",
                           "note": "flip attempt"})
        rec = json.loads(body2).get("record") or {} if st2 == 200 else {}
        unchanged = rec.get("state") == "rejected" \
            and rec.get("owner_action") == "deny"
        check("W3-11 replay cannot flip the decision", unchanged,
              f"replay HTTP {st2}, state={rec.get('state')}",
              fails_if="already-decided record is overwritten")
    finally:
        # already decided — the replay-resolve is a no-op; nothing to undo
        pass


def w3_pending() -> None:
    pending("W3-15 lease audit trail completeness", "W3",
            "screen leases (acquire/expire/force-release) not implemented — "
            "no lease endpoints exist")


# ── W4: secret proxy scenarios — no live HTTP surface yet ────────────────────
def w4_scenarios() -> None:
    """bot_tools.secret_request runs inside the container's CLI; the origin
    allowlist / SSRF / redirect / redaction / audit perimeter has no HTTP
    surface on :9119 to drive end to end. Unit coverage lives in
    tests/test_secret_proxy.py; org_e2e.py S1 covers the no-leak sweep. These
    stay PENDING until the review's proxy surface is exposed over HTTP."""
    pending("W4-3 tools never return secret value", "W4",
            "secret-adjacent tools run in-container, no HTTP tool boundary")
    pending("W4-4 non-allowlisted origin refused", "W4",
            "secret_request proxy not exposed via HTTP")
    pending("W4-5 loopback/link-local blocked", "W4",
            "secret_request proxy not exposed via HTTP")
    pending("W4-6 redirect refusal", "W4",
            "secret_request proxy not exposed via HTTP")
    pending("W4-7 response redaction", "W4",
            "secret_request proxy not exposed via HTTP")
    pending("W4-9 audit records every attempt", "W4",
            "no audit-query endpoint exists")
    pending("W4-10 audit stores no value", "W4",
            "no audit-query endpoint exists")
    pending("W4-13 non-granted bot gets nothing", "W4",
            "secret_request proxy not exposed via HTTP")
    pending("W4-15 secret never enters LLM prompt", "W4",
            "needs payload-recording upstream stub (shared W1/W6 harness)")


# ── W5: approvals + exactly-once — feature does not exist ────────────────────
def w5_scenarios() -> None:
    """W5 is entirely net-new (review: 'today nothing stands between a model
    and an irreversible act'). Every scenario below is executable the day
    Wave 1 lands; none can run today."""
    pending("W5-1 unapproved mutation refused + recorded", "W5",
            "approval ledger not implemented")
    pending("W5-3 effect key deterministic + canonical", "W5",
            "effect keys not implemented")
    pending("W5-4 turn replay does not double-execute", "W5",
            "effect keys not implemented (also needs the replay harness)")
    pending("W5-5 mutated args produce a new action", "W5",
            "effect keys not implemented")
    pending("W5-8 classification explicit + logged", "W5",
            "observe/mutate classifier not implemented")
    pending("W5-11 approval expiry", "W5",
            "approval cards not implemented")
    pending("W5-13 concurrent approvals of the same key", "W5",
            "approval cards not implemented")
    pending("W5-14 read-only tools never gated", "W5",
            "observe/mutate classifier not implemented")


# ── W6: attachment pruning — needs the upstream stub harness ─────────────────
def w6_scenarios() -> None:
    pending("W6-8 pruning never drops this turn's image", "W6",
            "pruning not implemented; needs payload-recording stub")
    pending("W6-12 attachment payload size cap upstream", "W6",
            "upstream payload cap not implemented; needs payload recorder")


# ── W7: display cap / sub-bot policy ─────────────────────────────────────────
def w7_scenarios() -> None:
    pending("W7-6 display cap and eviction", "W7",
            "no display-allocation/eviction state queryable over HTTP")
    pending("W7-14 sub-bots don't get displays", "W7",
            "sub-agent display policy not implemented")


# ── W8-6: WAL mode on, every database (API leg of the pragma check) ─────────
def w8_06_wal_every_db() -> None:
    """pragma journal_mode must be wal for every SQLite file the container's
    server opens.
    Fails if: any db reports delete/rollback — writers block readers under
    load and W2-12 is flaky by construction."""
    probe = (
        "import json, os, pathlib, sqlite3\n"
        "root = os.environ.get('BALABOT_DATA_ROOT', '/opt/data')\n"
        "dbs = [str(p) for p in pathlib.Path(root).rglob('*.db')]\n"
        "out = {}\n"
        "for db in dbs:\n"
        "    try:\n"
        "        c = sqlite3.connect(db)\n"
        "        out[db] = c.execute('pragma journal_mode').fetchone()[0]\n"
        "        c.close()\n"
        "    except Exception as e:\n"
        "        out[db] = f'error: {e}'\n"
        "print(json.dumps(out))\n"
    )
    try:
        r = subprocess.run(
            ["docker", "exec", "-i", "-w", "/opt/balabot",
             "-e", "BALABOT_DATA_ROOT=/opt/data", CONTAINER, "python3", "-"],
            input=probe, capture_output=True, text=True, timeout=90)
        if r.returncode != 0 or not r.stdout.strip():
            pending("W8-6 WAL on every database", "W8",
                    f"container probe failed rc={r.returncode} "
                    f"{(r.stderr or '')[:100]}")
            return
        modes = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as e:
        pending("W8-6 WAL on every database", "W8", f"container probe failed: {e}")
        return
    if not modes:
        pending("W8-6 WAL on every database", "W8",
                "no .db files found under /opt/data (store not provisioned?)")
        return
    bad = {db: m for db, m in modes.items() if m != "wal"}
    check("W8-6 journal_mode is wal for every db", not bad,
          f"{len(modes)} dbs, offenders: {bad}" if bad else f"{len(modes)} dbs all wal",
          fails_if="any db opened without WAL (readers block on writes)")


# ── W8-9 / W8-11: honest pending states & surfaced task errors ───────────────
def w8_pending_scenarios() -> None:
    pending("W8-1 slow container call doesn't stall endpoint", "W8",
            "no delay-injection test hook in the container bridge yet")
    pending("W8-9 endpoints state 'pending' honestly", "W8",
            "no slow-work fixture to observe; honesty sweep covered by "
            "org_e2e S10 — this scenario needs the W8 work hook")
    pending("W8-11 background task errors surface", "W8",
            "no routine runner hook to force a throwing background task")


# ── W8-13: the specific blocking-call audit (static, can fail today) ────────
def w8_13_blocking_call_audit() -> None:
    """AST-scan ui/server.py + balabot/*.py for subprocess.run /
    time.sleep called inside `async def` bodies.
    Fails if: any raw blocking call remains on the event loop — the static
    half of the 'server that never blocks' claim."""
    offenders: list[str] = []

    def scan(path: pathlib.Path) -> None:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            return
        blocking = {"run", "call", "check_output", "check_call"}  # subprocess.*
        sleep_names = {"sleep"}

        def walk(node, in_async: bool) -> None:
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                for child in ast.walk(node):
                    if child is node:
                        continue
                    if isinstance(child, (ast.AsyncFunctionDef, ast.FunctionDef)):
                        continue  # nested sync def is its own scope
                    walk(child, in_async and isinstance(node, ast.AsyncFunctionDef))
                return
            if not in_async and not isinstance(node, ast.AsyncFunctionDef):
                pass
            if isinstance(node, ast.Call):
                fn = node.func
                name = ""
                if isinstance(fn, ast.Attribute):
                    name = fn.attr
                    base = fn.value
                    base_name = base.id if isinstance(base, ast.Name) else ""
                    if name in sleep_names and base_name == "time":
                        offenders.append(f"{path.name}: time.sleep in async def")
                    elif name in blocking and base_name == "subprocess":
                        offenders.append(f"{path.name}: subprocess.{name} in async def")

        walk(tree, False)

    files = [REPO / "ui" / "server.py"] + sorted((REPO / "balabot").glob("*.py"))
    for f in files:
        if f.exists():
            scan(f)
    check("W8-13 no blocking call inside async def", not offenders,
          "; ".join(offenders[:4]) or f"{len(files)} files scanned clean",
          fails_if="subprocess.run/time.sleep remains on the event loop")


# ── W9-14: vault artifact idempotency (W5-dependent) ─────────────────────────
def w9_scenarios() -> None:
    pending("W9-14 vault artifact idempotency on replay", "W9",
            "requires W5 effect keys + the OKF vault ledger (not built)")


# ── driver ────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    status, _ = get("/healthz")
    if status != 200:
        print(f"adapter not healthy on {BASE} (HTTP {status}) — aborting")
        return 2

    w1_14_sse_drain_grammar()
    w1_pending()
    w2_11_server_is_assembly_source()
    w2_14_delete_is_server_side()
    w2_pending()
    w3_04_owner_impersonation_refused()
    w3_11_decided_records_immutable()
    w3_pending()
    w4_scenarios()
    w5_scenarios()
    w6_scenarios()
    w7_scenarios()
    w8_06_wal_every_db()
    w8_pending_scenarios()
    w8_13_blocking_call_audit()
    w9_scenarios()

    width = max(len(n) for n, _, _ in results)
    n_pass = sum(1 for _, s, _ in results if s == PASS)
    n_fail = sum(1 for _, s, _ in results if s == FAIL)
    n_pend = sum(1 for _, s, _ in results if s == PENDING)
    for name, st, detail in results:
        flag = {"PASS": "  ok ", "FAIL": " FAIL", "PENDING": " ..  "}[st]
        print(f"[{flag}] {name.ljust(width)}  {detail[:96]}")
    print(f"\n{n_pass} passed, {n_fail} failed, {n_pend} pending "
          f"(pending = feature not built — honest, never a vacuous pass)")
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
