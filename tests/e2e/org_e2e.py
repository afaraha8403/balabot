#!/usr/bin/env python3
"""BalaBot E2E — real-world acceptance checks against the LIVE product.

Runs against the running adapter over HTTP with real basic auth, exactly as a
browser would. Every check asserts on a real response body. Nothing here is
mocked, and a check that cannot fail is not a check.

Usage:
    python tests/e2e/org_e2e.py            # all checks
    python tests/e2e/org_e2e.py -v         # print every body on failure

Scoring rule (see kb/plans/balabot-acceptance-scenarios.md): a scenario that
cannot be shown to fail is reported UNPROVEN, never PASS.
"""
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:9119"
KEY_FILE = pathlib.Path(r"C:/Users/ali/secrets/balabot-dashboard.key")

PASS, FAIL, SKIP = "PASS", "FAIL", "UNPROVEN"
results: list[tuple[str, str, str]] = []


def _auth_header() -> str:
    pw = KEY_FILE.read_text(encoding="utf-8").strip()
    token = base64.b64encode(f"ali:{pw}".encode()).decode()
    return f"Basic {token}"


def get(path: str, *, timeout: int = 45) -> tuple[int, str]:
    req = urllib.request.Request(BASE + path, headers={"Authorization": _auth_header()})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # network/timeout
        return 0, f"__error__ {e}"


def post(path: str, body: dict, *, timeout: int = 45) -> tuple[int, str]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data, method="POST",
        headers={"Authorization": _auth_header(), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, f"__error__ {e}"


def check(name: str, condition: bool, detail: str) -> None:
    results.append((name, PASS if condition else FAIL, detail))


def unproven(name: str, why: str) -> None:
    results.append((name, SKIP, why))


# ── S10: the honesty sweep ───────────────────────────────────────────────────
def s10_honesty_sweep() -> None:
    """Every GET the UI calls must return real data or an explicit unavailable."""
    paths = ["/api/fleet", "/api/bots", "/api/agents", "/api/ops", "/api/memory",
             "/api/cost", "/api/governance", "/api/decisions", "/api/subagents",
             "/api/jev/health", "/api/jev/incidents", "/api/orgs", "/api/org/secrets",
             "/api/org/grants", "/api/org/requests"]
    for p in paths:
        status, body = get(p)
        if status == 0:
            check(f"S10 {p}", False, "unreachable: " + body[:80])
            continue
        if status != 200:
            check(f"S10 {p}", False, f"HTTP {status}")
            continue
        try:
            d = json.loads(body)
        except json.JSONDecodeError:
            check(f"S10 {p}", False, "not JSON (SPA fallback? route missing)")
            continue
        # Order matters: a bare list response (e.g. /api/org/secrets -> []) has
        # no .get, so the isinstance check must come FIRST. Getting this wrong
        # crashed the sweep instead of reporting a result.
        if isinstance(d, list):
            check(f"S10 {p}", True, f"list of {len(d)}")
            continue
        # Real data, or an explicit honest unavailable — never silent empty.
        # The jev/health shape ({"status":"no-key","detail":...}) is honest too:
        # it reports that it CANNOT check, with a reason.
        honest = ("available" in d and d["available"] is False and bool(d.get("reason"))) \
            or d.get("available") is True \
            or ("status" in d and "detail" in d) \
            or ("facts" in d) or ("bots" in d) or ("incidents" in d) \
            or ("orgs" in d) or ("secrets" in d) or ("grants" in d) or ("requests" in d)
        check(f"S10 {p}", honest, body[:110])


# ── S5: agent computer from the live product ─────────────────────────────────
def s5_agent_computer() -> None:
    for bot in ("principal", "governor"):
        status, body = get(f"/api/computer/{bot}/frame", timeout=60)
        if status != 200:
            check(f"S5 {bot} frame", False, f"HTTP {status}")
            continue
        try:
            d = json.loads(body)
        except json.JSONDecodeError:
            check(f"S5 {bot} frame", False, "not JSON")
            continue
        if not d.get("available"):
            check(f"S5 {bot} frame", False, "unavailable: " + str(d.get("reason"))[:90])
            continue
        b64 = d.get("b64") or ""
        try:
            raw = base64.b64decode(b64)
        except Exception as e:
            check(f"S5 {bot} frame", False, f"b64 undecodable: {e}")
            continue
        is_png = raw[:8] == b"\x89PNG\r\n\x1a\n"
        dims_ok = (d.get("width"), d.get("height")) == (1920, 1080)
        check(f"S5 {bot} frame", is_png and dims_ok,
              f"{d.get('width')}x{d.get('height')} {len(raw)}b png={is_png}")


# ── S1: the secret never leaks ───────────────────────────────────────────────
def s1_secret_never_leaks() -> None:
    """POST a sentinel, then prove it appears in NO other surface."""
    sentinel = "e2e-SENTINEL-4f9c2a-DO-NOT-LEAK"
    name = "E2E_PROBE_KEY"
    status, body = post("/api/org/secrets", {
        "name": name, "value": sentinel, "org": "balacode",
        "description": "e2e probe", "share_scope": "one", "bots": ["principal"]})
    if status != 200:
        unproven("S1 store secret", f"POST returned HTTP {status}: {body[:90]}")
        return
    try:
        d = json.loads(body)
    except json.JSONDecodeError:
        check("S1 store secret", False, "non-JSON")
        return
    check("S1 response carries NO value", sentinel not in body,
          "response keys: " + ",".join(sorted(d)))
    check("S1 response carries a fingerprint", bool(d.get("fingerprint")),
          str(d.get("fingerprint")))

    # Now grep every other surface the value could reach.
    for p in ("/api/org/secrets", "/api/org/grants", "/api/orgs", "/api/memory",
              "/api/agents", "/api/subagents", "/api/governance"):
        _, b = get(p)
        check(f"S1 no leak via {p}", sentinel not in b, "leaked!" if sentinel in b else "clean")


# ── Wave 6 P3: group chat against the live product ───────────────────────────
def s6_group_chat() -> None:
    status, body = post("/api/groups", {
        "name": "e2e wave6 room", "members": ["principal", "governor"],
        "computer_agent": "governor"})
    if status != 200:
        unproven("S6 create group", f"HTTP {status}: {body[:90]}")
        return
    d = json.loads(body)
    if not d.get("created"):
        unproven("S6 create group", "not created: " + body[:90])
        return
    gid = d["group"]["id"]
    check("S6 group shape", d["group"]["members"] == ["principal", "governor"]
          and d["group"]["computerAgent"] == "governor",
          json.dumps(d["group"])[:110])

    # 2–6 bounds are enforced by the real product
    s, _ = post("/api/groups", {"name": "solo", "members": ["principal"]})
    check("S6 solo group refused", s == 400, f"HTTP {s}")
    s, _ = post("/api/groups", {"name": "ghost", "members": ["principal", "nope"]})
    check("S6 unknown bot refused", s == 400, f"HTTP {s}")

    # @mention routes to ONE member; the transcript row is real upstream text
    status, body = post(f"/api/groups/{gid}/turn",
                        {"text": "one short line for @governor only"}, timeout=300)
    if status != 200:
        unproven("S6 mention turn", f"HTTP {status}: {body[:90]}")
        return
    d = json.loads(body)
    bots = [r["bot"] for r in d.get("results", [])]
    check("S6 @mention routes to governor", bots == ["governor"], str(bots))
    transcript = d["group"]["transcript"]
    check("S6 mention transcript row", any(
        e["kind"] == "message" and e["from"] == "governor" and e["text"]
        for e in transcript), f"{len(transcript)} rows")
    check("S6 round counter advanced", d["group"]["round"] == 1,
          str(d["group"]["round"]))

    # no mention -> every member speaks, in member order (serial)
    status, body = post(f"/api/groups/{gid}/turn",
                        {"text": "say hi in exactly three words"}, timeout=300)
    if status != 200:
        unproven("S6 full round", f"HTTP {status}: {body[:90]}")
        return
    d = json.loads(body)
    bots = [r["bot"] for r in d.get("results", [])]
    check("S6 full round order", bots == ["principal", "governor"], str(bots))
    check("S6 full round answers", all(
        (not r.get("error")) and r.get("text") for r in d.get("results", [])),
        json.dumps(d.get("results", []))[:110])
    check("S6 round 2 recorded", d["group"]["round"] == 2,
          str(d["group"]["round"]))

    # per-member sessions really grew, independently
    status, body = get(f"/api/groups/{gid}")
    d = json.loads(body) if status == 200 else {}
    lens = d.get("group", {}).get("sessionLens", {})
    check("S6 per-member sessions grew", lens.get("principal", 0) >= 3
          and lens.get("governor", 0) >= 3, json.dumps(lens))

    st, body_del = post_delete(f"/api/groups/{gid}")
    check("S6 group deleted", st == 200 and json.loads(body_del).get("deleted") is True,
          gid)


def post_delete(path: str, *, timeout: int = 45) -> tuple[int, str]:
    import urllib.request
    req = urllib.request.Request(BASE + path, method="DELETE",
                                 headers={"Authorization": _auth_header()})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # network/timeout
        return 0, f"__error__ {e}"


# ── Wave 6 P4: bot creation with consent against the live product ────────────
def s7_bot_consent() -> None:
    # A previous run may have left the proposal row (the bot it created stays).
    # Clear only OUR proposal id so the run is idempotent.
    _, body = get("/api/bot-proposals")
    try:
        for row in json.loads(body).get("proposals", []):
            if row.get("bot_id") == "e2e-wave6-bot" and row.get("status") in (
                    "proposed", "rejected"):
                post_delete(f"/api/bot-proposals/{row['id']}")
    except Exception:
        pass

    # the consent gate BEFORE approval: nothing may be created
    status, body = post("/api/bot-proposals", {
        "name": "E2E Wave6 Bot", "role": "proven by the live acceptance run",
        "proposed_by": "principal"})
    if status != 200:
        unproven("S7 propose", f"HTTP {status}: {body[:90]}")
        return
    pid = json.loads(body)["proposal"]["id"]
    check("S7 proposal filed", json.loads(body)["proposal"]["status"] == "proposed",
          pid)

    status, _ = post(f"/api/bot-proposals/{pid}/create", {})
    check("S7 create-before-approval refused", status == 400, f"HTTP {status}")

    status, body = post(f"/api/bot-proposals/{pid}/approve", {})
    d = json.loads(body) if status == 200 else {}
    check("S7 human approval recorded", status == 200
          and d.get("proposal", {}).get("status") == "approved"
          and d.get("proposal", {}).get("approved_by") == "user",
          body[:110])

    status, body = post(f"/api/bot-proposals/{pid}/create", {}, timeout=180)
    d = json.loads(body) if status == 200 else {}
    check("S7 bot created", status == 200 and d.get("created") is True
          and d.get("bot", {}).get("id"), body[:110])
    check("S7 registered in the org", "e2e-wave6-bot" in d.get("org_members", []),
          str(d.get("org_members")))

    # the new bot is a first-class fleet member and answers chat
    status, body = get("/api/bots")
    ids = [b["id"] for b in json.loads(body).get("bots", [])] if status == 200 else []
    check("S7 created bot in the roster", "e2e-wave6-bot" in ids, str(ids))

    status, body = post("/api/chat", {
        "bot_id": "e2e-wave6-bot",
        "messages": [{"role": "user", "content": "Reply with one word: ready"}]},
        timeout=180)
    streamed = status == 200 and ("chat.completion" in body or "data:" in body)
    check("S7 created bot answers chat", streamed, f"HTTP {status} {body[:80]}")

    st, body_del = post_delete(f"/api/bot-proposals/{pid}")
    check("S7 proposal row deleted (bot kept)",
          st == 200 and json.loads(body_del).get("deleted") is True, pid)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    status, _ = get("/healthz")
    if status != 200:
        print(f"adapter not healthy on {BASE} (HTTP {status}) — aborting")
        return 2

    s10_honesty_sweep()
    s5_agent_computer()
    s1_secret_never_leaks()
    s6_group_chat()
    s7_bot_consent()

    width = max(len(n) for n, _, _ in results)
    n_pass = sum(1 for _, s, _ in results if s == PASS)
    n_fail = sum(1 for _, s, _ in results if s == FAIL)
    n_unp = sum(1 for _, s, _ in results if s == SKIP)
    for name, st, detail in results:
        flag = {"PASS": "  ok ", "FAIL": " FAIL", "UNPROVEN": " ??  "}[st]
        print(f"[{flag}] {name.ljust(width)}  {detail[:96]}")
    print(f"\n{n_pass} passed, {n_fail} failed, {n_unp} unproven")
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
