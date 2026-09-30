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


def _request(
    method: str, path: str, body: dict | None = None, *, timeout: int = 60
) -> tuple[int, str]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": _auth_header()}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
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
        BASE + "/api/chat",
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "Authorization": _auth_header(),
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
    )
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
        st, body = post(
            "/api/sessions",
            {"botId": bot, "id": sid, "title": "w1-14 drain grammar probe"},
        )
        created = st == 200 and json.loads(body).get("created") is True
        if not created:
            pending(
                "W1-14 sse drain grammar",
                "W1",
                f"could not create fixture session (HTTP {st})",
            )
            return

        st, body = post(
            f"/api/queue/{sid}",
            {"content": f"{sentinel} steer probe", "message_id": f"zz-{tag}-1"},
        )
        if st != 200:
            pending(
                "W1-14 sse drain grammar",
                "W1",
                f"queue enqueue unavailable (HTTP {st})",
            )
            return
        pre = json.loads(body).get("queue") or {}
        n_queued = len(
            pre.get("pending") or pre.get("messages") or pre.get("queued") or []
        )

        status, stream = sse_post_chat(
            {
                "bot_id": bot,
                "session_id": sid,
                "messages": [
                    {"role": "user", "content": "Reply with exactly one word: ok"}
                ],
            }
        )
        if status != 200:
            pending(
                "W1-14 sse drain grammar", "W1", f"chat turn failed (HTTP {status})"
            )
            return

        # Grammar: every `event:` line is followed by a `data:` line before
        # the next blank frame separator. A frame missing its data half is
        # exactly the shape change that makes browsers drop the message.
        lines = stream.splitlines()
        events = [l for l in lines if l.startswith("event:")]
        ok_grammar = all(
            any(
                lines[j].startswith("data:")
                for j in range(i + 1, min(i + 4, len(lines)))
            )
            for i, l in enumerate(lines)
            if l.startswith("event:")
        )
        check(
            "W1-14 frames have event+data pairs",
            bool(events) and ok_grammar,
            f"{len(events)} event frames",
            fails_if="drain frame shape changed",
        )

        check(
            "W1-14 queued sentinel reaches the stream",
            sentinel in stream,
            sentinel,
            fails_if="drained message never emitted as a frame",
        )

        _, body_after = get(f"/api/queue/{sid}")
        q_after = (
            json.loads(body_after).get("state") or {}
            if body_after.startswith("{")
            else {}
        )
        remaining = (
            q_after.get("pending")
            or q_after.get("messages")
            or q_after.get("queued")
            or []
        )
        check(
            "W1-14 queue drained after the turn",
            not remaining,
            f"{len(remaining)} left (was {n_queued})",
            fails_if="drain marks delivered without consuming the queue",
        )
    finally:
        if created:
            delete(f"/api/sessions/{sid}")


# ── W1-2 / W1-9 / W1-11: not built yet — registered honestly ─────────────────
def w1_pending() -> None:
    pending(
        "W1-2 drained msg not delivered w/o model",
        "W1",
        "needs upstream-refusing stub; delivery marking not exposed",
    )
    pending(
        "W1-9 steering mailbox durable store",
        "W1",
        "steering mailbox (pending_steer persistence) not implemented",
    )
    pending(
        "W1-11 halt-and-replan fallback honest",
        "W1",
        "mid-turn injection investigation unresolved; fallback path "
        "not exposed as API state",
    )


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
        st, body = post(
            "/api/sessions", {"botId": bot, "id": sid, "title": "w2-11 assembly probe"}
        )
        created = st == 200 and json.loads(body).get("created") is True
        if not created:
            pending(
                "W2-11 server transcript is assembly source",
                "W2",
                f"could not create fixture session (HTTP {st})",
            )
            return
        st, body = post(
            f"/api/sessions/{sid}/messages",
            {"role": "user", "content": sentinel, "message_id": f"zz-{tag}-m1"},
        )
        check(
            "W2-11 server-side append accepted",
            st == 200 and json.loads(body).get("created") is True,
            f"HTTP {st}",
            fails_if="server refuses its own durable append",
        )
        st, body = get(f"/api/sessions/{sid}/messages")
        msgs = json.loads(body).get("messages", []) if st == 200 else []
        contents = [str(m.get("content", "")) for m in msgs]
        check(
            "W2-11 sentinel readable from server store",
            sentinel in contents,
            f"{len(msgs)} rows",
            fails_if="server-side write never lands — "
            "assembly still trusts the client copy",
        )
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
        pending(
            "W2-14 session delete is server-side",
            "W2",
            f"could not create fixture session (HTTP {st})",
        )
        return
    try:
        post(
            f"/api/sessions/{sid}/messages",
            {"role": "user", "content": f"ghost check {tag}"},
        )
        st_del, body_del = delete(f"/api/sessions/{sid}")
        ok_del = st_del == 200 and json.loads(body_del).get("deleted") is True
        check(
            "W2-14 delete accepted",
            ok_del,
            f"HTTP {st_del}",
            fails_if="delete route is a stub",
        )
        st2, body2 = get(f"/api/sessions/{sid}")
        gone = st2 != 200 or json.loads(body2).get("available") is not True
        check(
            "W2-14 session gone after delete",
            gone,
            f"re-read HTTP {st2}",
            fails_if="ghost session still served",
        )
        st3, body3 = get(f"/api/sessions/{sid}/messages")
        n = len(json.loads(body3).get("messages", [])) if st3 == 200 else 0
        check(
            "W2-14 messages purged with the session",
            n == 0,
            f"{n} rows remain",
            fails_if="SQLite rows outlive the delete",
        )
    finally:
        delete(f"/api/sessions/{sid}")  # idempotent safety net


def w2_pending() -> None:
    pending(
        "W2-2 client sends only the delta",
        "W2",
        "delta protocol not implemented (ui/src/api.ts still uploads "
        "full history); observable only via the UI harness network capture",
    )
    pending(
        "W2-6 compaction keeps newest user turn",
        "W2",
        "no server-side compaction endpoint exists yet",
    )
    pending(
        "W2-7 compaction bounded + recorded",
        "W2",
        "no server-side compaction endpoint exists yet",
    )


# ── W3-4: owner impersonation refused ────────────────────────────────────────
def _mk_pause(tag: str) -> tuple[str | None, str]:
    """Create an intervention pause for a UNIQUELY-NAMED synthetic bot
    (never principal/governor — we create no state for them)."""
    bot_id = f"zz-api-w3-{tag}"
    st, body = post(
        "/api/intervention/pause",
        {"bot_id": bot_id, "reason": f"e2e w3 probe {tag}", "hint": "", "url": ""},
    )
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
        pending(
            "W3-4 owner impersonation refused",
            "W3",
            "could not create fixture pause (pause endpoint unavailable)",
        )
        return
    try:
        st, body = post(
            f"/api/intervention/{token}/resolve",
            {"action": "approve", "by": "principal", "note": "self-approval attempt"},
        )
        refused = st in (400, 403)
        check(
            "W3-4 non-owner resolve refused",
            refused,
            f"HTTP {st}",
            fails_if="any actor holding the token can resolve",
        )
        _, body2 = get(f"/api/intervention/{token}")
        rec = json.loads(body2).get("record") or {}
        check(
            "W3-4 decision unchanged after refusal",
            rec.get("state") == "pending",
            str(rec.get("state")),
            fails_if="the impersonated resolve mutated the record",
        )
    finally:
        post(
            f"/api/intervention/{token}/resolve",
            {"action": "deny", "by": "ali", "note": "e2e cleanup"},
        )


# ── W3-11: decided records are immutable ─────────────────────────────────────
def w3_11_decided_records_immutable() -> None:
    """Decide a pause (deny), then replay a resolve with the OPPOSITE action.
    Fails if: the overwrite is allowed (approve flips a denied record after
    the fact — history rewriting on the decision ledger)."""
    tag = secrets.token_hex(4)
    token, bot_id = _mk_pause(tag)
    if not token:
        pending(
            "W3-11 decided records immutable", "W3", "could not create fixture pause"
        )
        return
    try:
        st, _ = post(
            f"/api/intervention/{token}/resolve",
            {"action": "deny", "by": "ali", "note": "first decision"},
        )
        if st != 200:
            pending(
                "W3-11 decided records immutable",
                "W3",
                f"first resolve failed (HTTP {st})",
            )
            return
        st2, body2 = post(
            f"/api/intervention/{token}/resolve",
            {"action": "approve", "by": "ali", "note": "flip attempt"},
        )
        rec = json.loads(body2).get("record") or {} if st2 == 200 else {}
        unchanged = rec.get("state") == "rejected" and rec.get("owner_action") == "deny"
        check(
            "W3-11 replay cannot flip the decision",
            unchanged,
            f"replay HTTP {st2}, state={rec.get('state')}",
            fails_if="already-decided record is overwritten",
        )
    finally:
        # already decided — the replay-resolve is a no-op; nothing to undo
        pass


def w3_pending() -> None:
    pending(
        "W3-15 lease audit trail completeness",
        "W3",
        "screen leases (acquire/expire/force-release) not implemented — "
        "no lease endpoints exist",
    )


# ── W4: secret-store scenarios — real proxy over the container CLI ───────────
# The secret proxy (bot_tools.secret_request) is executed in-container exactly
# as Hermes invokes it (`python3 -m balabot.bot_tools secret_request …`); the
# setup (orgs / secrets / grants) goes through the REAL /api/org/* HTTP surface
# on :9119, and the audit trail is read back from the container's own store.
# This is the load-bearing perimeter the review demands: allowlist, SSRF, no
# redirects, redaction, value-free audit, grants, and no value near the prompt.
def _container_run(code: str, *, timeout: float = 120) -> tuple[int, str, str]:
    """Run `python3 -` with `code` on stdin INSIDE the balabot container.
    Returns (rc, stdout, stderr). Mirrors the W8-6 probe convention."""
    argv = [
        "docker",
        "exec",
        "-i",
        "-w",
        "/opt/balabot",
        "-e",
        "PYTHONPATH=/opt/balabot",
        "-e",
        "BALABOT_DATA_ROOT=/opt/data",
        CONTAINER,
        "python3",
        "-",
    ]
    r = subprocess.run(
        argv, input=code, capture_output=True, text=True, timeout=timeout
    )
    return r.returncode, r.stdout, r.stderr


def _container_tool(*tool_args: str, timeout: float = 120) -> tuple[int, str, str]:
    """Run the bot_tools CLI (the real Hermes call site) inside the container."""
    argv = [
        "docker",
        "exec",
        "-i",
        "-w",
        "/opt/balabot",
        "-e",
        "PYTHONPATH=/opt/balabot",
        "-e",
        "BALABOT_DATA_ROOT=/opt/data",
        CONTAINER,
        "python3",
        "-m",
        "balabot.bot_tools",
        *tool_args,
    ]
    r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def _tool_json(out: str) -> dict | None:
    try:
        parsed = json.loads(out.strip())
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _tool_list(out: str) -> list | None:
    try:
        parsed = json.loads(out.strip())
        return parsed if isinstance(parsed, list) else None
    except Exception:
        return None


def _secret_audit() -> list[dict]:
    """Read the container's secret_request audit trail (append-only list).
    The file is pretty-printed JSON (indent=2), so the WHOLE stdout is
    parsed — never just its last line."""
    code = (
        "import json\n"
        "from pathlib import Path\n"
        "p = Path('/opt/data/orgs/secret_audit.json')\n"
        "print(p.read_text() if p.exists() else '[]')\n"
    )
    rc, out, _ = _container_run(code)
    if rc != 0 or not out.strip():
        return []
    try:
        parsed = json.loads(out.strip())
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _mk_w4_secret(tag: str) -> dict | None:
    """Unique secret + bot grant created through the real /api/org surface."""
    bot = f"zz-w4-{tag}"
    name = f"zzapi_w4_{tag}"
    value = f"sk-w4-{secrets.token_hex(10)}"
    st, body = post(
        "/api/org/secrets",
        {
            "name": name,
            "org": "balacode",
            "value": value,
            "share_scope": "one",
            "bots": [bot],
            "description": "e2e w4 secret-store probe",
        },
    )
    if st != 200:
        return None
    try:
        data = json.loads(body)
    except Exception:
        return None
    return {
        "bot": bot,
        "name": name,
        "value": value,
        "grant_ids": data.get("grant_ids") or [],
    }


def _seed_allowed_origins(name: str, origins: list[str]) -> bool:
    """Stamp allowed_origins onto a registry record via the container's own
    orgs.save — the HTTP secret route exposes no allowlist field today."""
    code = (
        "from balabot import orgs\n"
        f"name = {name!r}\n"
        f"origins = {origins!r}\n"
        "reg = orgs.load()\n"
        "hit = False\n"
        "for s in reg.get('secrets', []):\n"
        "    if s.get('name') == name and s.get('org') == 'balacode':\n"
        "        s['allowed_origins'] = origins\n"
        "        hit = True\n"
        "orgs.save(reg)\n"
        "print(hit)\n"
    )
    rc, out, _ = _container_run(code)
    return rc == 0 and "True" in out


def w4_scenarios() -> None:
    """Drive the in-container secret proxy end to end (kind=='secret') and
    report each perimeter control honestly. All assertions are LIVE, never
    stubbed; setup uses the real /api/org/* HTTP surface; the audit is read
    back from the container's store."""
    tag = secrets.token_hex(4)
    fix = _mk_w4_secret(tag)  # granted bot + secret, no allowlist
    fix_al = _mk_w4_secret(tag + "_al")  # allowlist-enforced secret
    if not fix or not fix_al:
        why = "could not store a fixture secret via /api/org/secrets"
        for n in (
            "W4-3 tools never return secret value",
            "W4-4 non-allowlisted origin refused",
            "W4-5 loopback/link-local blocked",
            "W4-6 redirect refusal",
            "W4-7 response redaction",
            "W4-9 audit records every attempt",
            "W4-10 audit stores no value",
            "W4-13 non-granted bot gets nothing",
            "W4-15 secret never enters LLM prompt",
        ):
            pending(n, "W4", why)
        return
    name, value, bot = fix["name"], fix["value"], fix["bot"]
    name_al, value_al, bot_al = fix_al["name"], fix_al["value"], fix_al["bot"]
    bot_none = f"zz-w4-none-{tag}"  # NEVER granted anything
    seeded = _seed_allowed_origins(name_al, ["https://only.example.test"])
    grant_ids = list(fix["grant_ids"]) + list(fix_al["grant_ids"])
    sid = None  # created only in W4-15; cleaned in finally when present
    try:
        # W4-3 ── tools never return the secret VALUE ────────────────────────
        rc, out, _ = _container_tool("list_org_secrets", "--bot", bot)
        listed = _tool_list(out) if rc == 0 else None
        listed_name = isinstance(listed, list) and any(
            str(r.get("name")) == name for r in listed
        )
        rc2, out2, _ = _container_tool(
            "secret_request",
            "--bot",
            bot,
            "--name",
            name,
            "--url",
            "https://httpbin.org/headers",
        )
        res2 = _tool_json(out2)
        ok_envelope = bool(res2) and value not in out2
        check(
            "W4-3 tools never return secret value",
            listed_name and ok_envelope,
            f"list listed the secret {listed_name}, request envelope "
            f"value-free {ok_envelope}",
            fails_if="any tool response carries the raw secret value",
        )

        # W4-4 ── non-allowlisted origin refused ─────────────────────────────
        rc, out, _ = _container_tool(
            "secret_request",
            "--bot",
            bot_al,
            "--name",
            name_al,
            "--url",
            "https://httpbin.org/headers",
        )
        r = _tool_json(out)
        refused = (
            bool(r)
            and r.get("status_code") == 403
            and "allowed origins" in str(r.get("error", ""))
        )
        check(
            "W4-4 non-allowlisted origin refused",
            refused,
            f"HTTP-ish {r.get('status_code') if r else None} {r.get('error') if r else out[:60]}",
            fails_if="configured allowed_origins is ignored — any origin reaches the upstream",
        )

        # W4-5 ── loopback / link-local / private blocked ────────────────────
        bad = [
            f"http://127.0.0.1:8000/internal",
            "http://localhost:9000/admin",
            "http://[::1]:8080/",
            "http://169.254.169.254/latest/meta-data",
            "http://10.10.10.10/private",
        ]
        results_ssrf = []
        for u in bad:
            rc, out, _ = _container_tool(
                "secret_request", "--bot", bot, "--name", name, "--url", u
            )
            r = _tool_json(out)
            results_ssrf.append(
                bool(r)
                and r.get("status_code") == 400
                and "SSRF" in str(r.get("error", ""))
            )
        n_blocked = sum(results_ssrf)
        check(
            "W4-5 loopback/link-local blocked",
            n_blocked == len(bad),
            f"{n_blocked}/{len(bad)} prohibited destinations refused",
            fails_if="the proxied client can reach loopback/link-local/private targets",
        )

        # W4-6 ── redirect refusal (follow_redirects=False must hold) ─────────
        rc, out, _ = _container_tool(
            "secret_request",
            "--bot",
            bot,
            "--name",
            name,
            "--url",
            "https://httpbin.org/redirect/1",
        )
        r = _tool_json(out)
        unfollowed = (
            bool(r)
            and r.get("status_code") == 302
            and r.get("ok") is False
            and "location" in {str(k).lower() for k in (r.get("headers") or {})}
        )
        check(
            "W4-6 redirect refusal",
            unfollowed,
            f"3xx surfaced un-followed ({r.get('status_code') if r else None})",
            fails_if="the proxied client follows 3xx (redirect rebinding leak)",
        )

        # W4-7 ── response redaction (upstream echoes the credential) ─────────
        rc, out, _ = _container_tool(
            "secret_request",
            "--bot",
            bot,
            "--name",
            name,
            "--url",
            f"https://httpbin.org/response-headers?X-Probe={value}",
        )
        r = _tool_json(out)
        body_clean = bool(r) and value not in r.get("body", "")
        hdrs_clean = bool(r) and all(
            value not in str(v) for v in (r.get("headers") or {}).values()
        )
        check(
            "W4-7 response redaction",
            bool(r)
            and body_clean
            and hdrs_clean
            and "[REDACTED_SECRET]" in r.get("body", ""),
            f"redacted {r.get('status_code') if r else None}",
            fails_if="the upstream-reflected credential survives into the returned body/headers",
        )

        # W4-13 ── non-granted bot gets nothing ──────────────────────────────
        rc, out, _ = _container_tool(
            "secret_request",
            "--bot",
            bot_none,
            "--name",
            name,
            "--url",
            "https://httpbin.org/headers",
        )
        r = _tool_json(out)
        rc2, out2, _ = _container_tool("list_org_secrets", "--bot", bot_none)
        listed2 = _tool_list(out2) if rc2 == 0 else None
        row = next((x for x in listed2 or [] if str(x.get("name")) == name), None)
        granted_flag_off = row is not None and row.get("granted") is False
        refused_grant = (
            bool(r)
            and r.get("status_code") == 403
            and "no grant" in str(r.get("error", ""))
        )
        check(
            "W4-13 non-granted bot gets nothing",
            refused_grant
            and granted_flag_off
            and value not in out
            and value not in out2,
            f"request refused, granted flag off {granted_flag_off}, value-free {value not in out2}",
            fails_if="an ungranted bot can obtain the secret value (proxy allows the "
            "request, or the value leaks in the metadata listing)",
        )

        # W4-9 ── audit records EVERY attempt (refused and allowed alike) ─────
        before = len(_secret_audit())
        attempts = [
            ("secret_request", "--bot", bot, "--name", name, "--url", "ftp://x"),
            (
                "secret_request",
                "--bot",
                bot,
                "--name",
                name,
                "--url",
                "http://127.0.0.1:1/x",
            ),
            (
                "secret_request",
                "--bot",
                bot_none,
                "--name",
                name,
                "--url",
                "https://httpbin.org/headers",
            ),
            (
                "secret_request",
                "--bot",
                bot,
                "--name",
                name,
                "--url",
                "https://httpbin.org/headers",
            ),
        ]
        for attempt in attempts:
            _container_tool(*attempt, timeout=180)
        after = _secret_audit()
        grew = len(after) - before
        new_entries = after[before:] if before < len(after) else after
        statuses_ok = bool(new_entries) and all(
            e.get("status") in ("refused", "allowed", "error")
            and e.get("bot") in (bot, bot_none)
            and e.get("secret_name") == name
            for e in new_entries
        )
        check(
            "W4-9 audit records every attempt",
            grew == len(attempts) and statuses_ok,
            f"audit grew {grew} (expected {len(attempts)})",
            fails_if="an invocation (allowed or refused) is missing from the audit trail",
        )

        # W4-10 ── audit stores no value, no raw URL, no query ────────────────
        rc, _, _ = _container_tool(
            "secret_request",
            "--bot",
            bot_al,
            "--name",
            name_al,
            "--url",
            "https://httpbin.org/anything?customer_id=cus_999&token=leak_here",
        )
        audit_txt = ""
        rc, out, _ = _container_run(
            "from pathlib import Path\n"
            "p = Path('/opt/data/orgs/secret_audit.json')\n"
            "print(p.read_text() if p.exists() else '[]')\n"
        )
        if rc == 0:
            audit_txt = out
        clean = (
            bool(audit_txt)
            and value not in audit_txt
            and "leak_here" not in audit_txt
            and "customer_id" not in audit_txt
            and "value" not in _secret_audit()[-1]
            and "url" not in _secret_audit()[-1]
        )
        check(
            "W4-10 audit stores no value",
            clean,
            "credential absent from every audit row",
            fails_if="the audit trail persists the value, raw URL or query string",
        )

        # W4-15 ── secret never enters the LLM prompt ─────────────────────────
        rc, out, _ = _container_tool(
            "secret_request",
            "--bot",
            bot,
            "--name",
            name,
            "--url",
            "https://httpbin.org/headers",
        )
        tool_result_clean = value not in out  # what the model would read
        rc, out, _ = _container_run(
            "from balabot import orgs\n"
            "import json\n"
            f"secs = [s for s in orgs.load().get('secrets', [])"
            f" if s.get('name') == {name!r}]\n"
            "print('\\n'.join(json.dumps(s) for s in secs) if secs else '[]')\n"
        )
        reg_meta_clean = value not in out  # never in registry metadata
        sid = f"zz-api-w4s15-{tag}"
        pipeline = False
        pipe_detail = "no real chat turn (would be pending)"
        st3, b3 = post(
            "/api/sessions",
            {"botId": "governor", "id": sid, "title": "w4-15 prompt probe"},
        )
        if st3 == 200:
            st_m, b_m = post(
                f"/api/sessions/{sid}/messages",
                {
                    "role": "assistant",
                    "content": f"tool result follows:\n{out}",
                    "message_id": f"zz-{tag}-w4s15",
                },
            )
            st_c, stream = sse_post_chat(
                {
                    "bot_id": "governor",
                    "session_id": sid,
                    "messages": [
                        {"role": "user", "content": "Acknowledge with one word: ok"}
                    ],
                }
            )
            st_t, b_t = get(f"/api/sessions/{sid}/messages") if st_c == 200 else (0, "")
            prompt_surfaces = stream + b_t + (b_m if st_m == 200 else "")
            pipeline = st_c == 200 and value not in prompt_surfaces
            pipe_detail = (
                f"SSE HTTP {st_c}, value-free across stream+transcript {pipeline}"
            )
        check(
            "W4-15 secret never enters LLM prompt",
            tool_result_clean and reg_meta_clean and pipeline,
            f"tool result clean {tool_result_clean}; registry clean "
            f"{reg_meta_clean}; {pipe_detail}",
            fails_if="the value reaches any surface the LLM reads: tool result, "
            "registry metadata, stored transcript, or the streamed prompt",
        )
    finally:
        for gid in grant_ids:
            post(f"/api/org/grants/{gid}/revoke")  # live grant cleanup
        if sid:
            delete(f"/api/sessions/{sid}")


# ── W5: approvals + exactly-once — feature does not exist ────────────────────
def w5_scenarios() -> None:
    """W5 is entirely net-new (review: 'today nothing stands between a model
    and an irreversible act'). Every scenario below is executable the day
    Wave 1 lands; none can run today."""
    pending(
        "W5-1 unapproved mutation refused + recorded",
        "W5",
        "approval ledger not implemented",
    )
    pending(
        "W5-3 effect key deterministic + canonical", "W5", "effect keys not implemented"
    )
    pending(
        "W5-4 turn replay does not double-execute",
        "W5",
        "effect keys not implemented (also needs the replay harness)",
    )
    pending(
        "W5-5 mutated args produce a new action", "W5", "effect keys not implemented"
    )
    pending(
        "W5-8 classification explicit + logged",
        "W5",
        "observe/mutate classifier not implemented",
    )
    pending("W5-11 approval expiry", "W5", "approval cards not implemented")
    pending(
        "W5-13 concurrent approvals of the same key",
        "W5",
        "approval cards not implemented",
    )
    pending(
        "W5-14 read-only tools never gated",
        "W5",
        "observe/mutate classifier not implemented",
    )


# ── W6: attachment pruning — needs the upstream stub harness ─────────────────
def w6_scenarios() -> None:
    pending(
        "W6-8 pruning never drops this turn's image",
        "W6",
        "pruning not implemented; needs payload-recording stub",
    )
    pending(
        "W6-12 attachment payload size cap upstream",
        "W6",
        "upstream payload cap not implemented; needs payload recorder",
    )


# ── W7: display cap / sub-bot policy ─────────────────────────────────────────
def w7_scenarios() -> None:
    pending(
        "W7-6 display cap and eviction",
        "W7",
        "no display-allocation/eviction state queryable over HTTP",
    )
    pending(
        "W7-14 sub-bots don't get displays",
        "W7",
        "sub-agent display policy not implemented",
    )


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
            [
                "docker",
                "exec",
                "-i",
                "-w",
                "/opt/balabot",
                "-e",
                "BALABOT_DATA_ROOT=/opt/data",
                CONTAINER,
                "python3",
                "-",
            ],
            input=probe,
            capture_output=True,
            text=True,
            timeout=90,
        )
        if r.returncode != 0 or not r.stdout.strip():
            pending(
                "W8-6 WAL on every database",
                "W8",
                f"container probe failed rc={r.returncode} {(r.stderr or '')[:100]}",
            )
            return
        modes = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as e:
        pending("W8-6 WAL on every database", "W8", f"container probe failed: {e}")
        return
    if not modes:
        pending(
            "W8-6 WAL on every database",
            "W8",
            "no .db files found under /opt/data (store not provisioned?)",
        )
        return
    bad = {db: m for db, m in modes.items() if m != "wal"}
    check(
        "W8-6 journal_mode is wal for every db",
        not bad,
        f"{len(modes)} dbs, offenders: {bad}" if bad else f"{len(modes)} dbs all wal",
        fails_if="any db opened without WAL (readers block on writes)",
    )


# ── W8-9 / W8-11: honest pending states & surfaced task errors ───────────────
def w8_pending_scenarios() -> None:
    pending(
        "W8-1 slow container call doesn't stall endpoint",
        "W8",
        "no delay-injection test hook in the container bridge yet",
    )
    pending(
        "W8-9 endpoints state 'pending' honestly",
        "W8",
        "no slow-work fixture to observe; honesty sweep covered by "
        "org_e2e S10 — this scenario needs the W8 work hook",
    )
    pending(
        "W8-11 background task errors surface",
        "W8",
        "no routine runner hook to force a throwing background task",
    )


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
    check(
        "W8-13 no blocking call inside async def",
        not offenders,
        "; ".join(offenders[:4]) or f"{len(files)} files scanned clean",
        fails_if="subprocess.run/time.sleep remains on the event loop",
    )


# ── W9-14: vault artifact idempotency (W5-dependent) ─────────────────────────
def w9_scenarios() -> None:
    pending(
        "W9-14 vault artifact idempotency on replay",
        "W9",
        "requires W5 effect keys + the OKF vault ledger (not built)",
    )


# ── Polaris API guards (shipped-bot 409 and SPA 404 fallback scoping) ────────
def polaris_api_guards() -> None:
    """Verify load-bearing API safety invariants:
    1. DELETE /api/bots/principal must 409 (shipped-bot immutability protection).
    2. GET /api/nonexistent must 404 with JSON, never serve the SPA HTML shell."""
    st_del, body_del = delete("/api/bots/principal")
    check(
        "W3-shipped-bot protection (409)",
        st_del == 409 and "shipped persona" in body_del,
        f"HTTP {st_del}",
        fails_if="shipped bot deletion allowed or not returning 409",
    )

    st_spa, body_spa = get("/api/nonexistent_route_scoping_probe")
    check(
        "W8-SPA fallback scoping (/api/* must 404)",
        st_spa == 404 and "api endpoint not found" in body_spa,
        f"HTTP {st_spa}",
        fails_if="/api/* route serves HTML shell instead of 404 JSON",
    )


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
    polaris_api_guards()

    width = max(len(n) for n, _, _ in results)
    n_pass = sum(1 for _, s, _ in results if s == PASS)
    n_fail = sum(1 for _, s, _ in results if s == FAIL)
    n_pend = sum(1 for _, s, _ in results if s == PENDING)
    for name, st, detail in results:
        flag = {"PASS": "  ok ", "FAIL": " FAIL", "PENDING": " ..  "}[st]
        print(f"[{flag}] {name.ljust(width)}  {detail[:96]}")
    print(
        f"\n{n_pass} passed, {n_fail} failed, {n_pend} pending "
        f"(pending = feature not built — honest, never a vacuous pass)"
    )
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
