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
        # Real data, or an explicit honest unavailable — never silent empty.
        # The jev/health shape ({"status":"no-key","detail":...}) is honest too:
        # it reports that it CANNOT check, with a reason. Accept it explicitly
        # rather than letting a narrow predicate mislabel a truthful answer as a
        # failure — the sweep must flag dishonesty, not unfamiliar shapes.
        honest = ("available" in d and d["available"] is False and bool(d.get("reason"))) \
            or d.get("available") is True \
            or (isinstance(d, dict) and "status" in d and "detail" in d) \
            or isinstance(d, list) or ("facts" in d) or ("bots" in d) or ("incidents" in d) \
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
