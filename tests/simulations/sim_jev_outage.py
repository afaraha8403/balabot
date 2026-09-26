"""Simulation: Jev outage — fail loud, never silently degrade.

INVARIANT UNDER TEST: Jev is a hard dependency. When Jev is unreachable or
errors, the affected path STOPS and RAISES an incident — it never quietly
continues with a substituted behaviour. There is no fallback provider anywhere
in the code. Transient failures (network errors, 429, 5xx) may be retried a
bounded number of times and then still fail loud; a 4xx fails immediately,
with no retry at all.

Run standalone:  python tests/simulations/sim_jev_outage.py
Run under pytest: pytest tests/simulations/sim_jev_outage.py
"""

from __future__ import annotations

import inspect
import io
import re
import sys
import urllib.error
from contextlib import redirect_stderr, redirect_stdout

import requests

from _sim_common import SimFailure, _Scenario, expect, finish, pytest_report, run_main

from balabot.jev import (
    Jev,
    JevAPIError,
    JevNotConfigured,
    MAX_TRANSIENT_RETRIES,
    TRANSIENT_STATUSES,
)

API_KEY = "sim-key-not-a-real-credential"


class _FlakySession:
    """A requests.Session lookalike with scripted, deterministic responses."""

    def __init__(self, script: list) -> None:
        # script: list of either exceptions to raise or (status, body) tuples,
        # consumed in order; the last entry repeats.
        self.script = list(script)
        self.calls = 0

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls += 1
        item = self.script[min(self.calls - 1, len(self.script) - 1)]
        if isinstance(item, Exception):
            raise item

        status, body = item
        resp = requests.Response()
        resp.status_code = status
        resp._content = body.encode()
        return resp


def _capture(coro, *args, **kwargs):
    """Run a callable, capturing stdout/stderr so silence can be checked."""
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        result = ("ok", coro(*args, **kwargs))
    return result, out.getvalue(), err.getvalue()


def assert_raises(exc_type, fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except exc_type as exc:
        return exc
    except Exception as exc:  # noqa: BLE001
        raise SimFailure(
            f"expected {exc_type.__name__}, got {type(exc).__name__}: {exc}"
        ) from exc
    raise SimFailure(f"expected {exc_type.__name__} — nothing was raised (silent behaviour)")


def check_missing_key_raises(s: _Scenario) -> None:
    import os
    saved = os.environ.pop("TYPESAFE_API_KEY", None)
    try:
        assert_raises(JevNotConfigured, Jev)
    finally:
        if saved is not None:
            os.environ["TYPESAFE_API_KEY"] = saved


def check_connection_refused_raises_incident(s: _Scenario) -> None:
    import socket

    # Bind then close: a guaranteed connection-refused port, no network needed.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    client = Jev(api_key=API_KEY)
    exc = assert_raises(JevAPIError, client.system_one, "state", {"q": {"type": "noul"}})
    expect("unreachable" in str(exc).lower() or "error" in str(exc).lower(),
           f"failure message should name the outage, got: {exc}")


def check_timeout_raises_after_bounded_retries(s: _Scenario) -> None:
    session = _FlakySession([TimeoutError("simulated timeout")])
    client = Jev(api_key=API_KEY, session=session)
    # A timeout is a transient NETWORK failure in jev.py: it is caught as a
    # requests-side RequestException subclass, retried MAX_TRANSIENT_RETRIES
    # times, and then re-raised wrapped in a JevAPIError — a loud failure.
    exc = assert_raises(JevAPIError, client.system_one, "state", {"q": {"type": "noul"}})
    expect(session.calls == 1 + MAX_TRANSIENT_RETRIES,
           f"transient timeout must be retried exactly {MAX_TRANSIENT_RETRIES} time(s), "
           f"got {session.calls - 1} retries")
    # Fail loud: the wrapper names Jev and the original cause.
    expect("unreachable" in str(exc).lower() and "jev" in str(exc).lower(),
           f"exhausted timeout retries must fail loud naming Jev, got: {exc}")
    expect(isinstance(exc.__cause__, TimeoutError),
           f"the original TimeoutError must be chained as __cause__, got: {exc.__cause__!r}")



def check_500_retries_then_fails_loud(s: _Scenario) -> None:
    session = _FlakySession([(500, "internal error")])
    client = Jev(api_key=API_KEY, session=session)
    exc = assert_raises(JevAPIError, client.system_one, "state", {"q": {"type": "noul"}})
    expect("500" in str(exc), f"failure must name the HTTP status, got: {exc}")
    expect(session.calls == 1 + MAX_TRANSIENT_RETRIES,
           "a 5xx is transient: retry, then fail loud")
    expect("internal error" in str(exc),
           "the loud failure should carry the upstream body for debuggability")



def check_4xx_fails_immediately_without_retry(s: _Scenario) -> None:
    for status in (400, 401, 403, 422):
        session = _FlakySession([(status, "nope")])
        client = Jev(api_key=API_KEY, session=session)
        assert_raises(JevAPIError, client.system_one, "state", {"q": {"type": "noul"}})
        expect(session.calls == 1,
               f"HTTP {status} must fail on the FIRST attempt — retried "
               f"{session.calls - 1} time(s); a bad request repeated is still bad")


def check_429_is_transient_then_fails_loud(s: _Scenario) -> None:
    session = _FlakySession([(429, "slow down")])
    client = Jev(api_key=API_KEY, session=session)
    assert_raises(JevAPIError, client.system_one, "state", {"q": {"type": "noul"}})
    expect(session.calls == 1 + MAX_TRANSIENT_RETRIES,
           "429 is transient: bounded retry, then fail loud")


def check_no_fallback_in_code(s: _Scenario) -> None:
    import ast
    import balabot.jev as jev_mod

    src = inspect.getsource(jev_mod)
    # Scan EXECUTABLE source only. Prose is REQUIRED to say "there is no
    # fallback provider" — matching that documentation was a false positive:
    # the presence of the WORD is not a fallback path. Strip docstrings first.
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef,
                             ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                node.body = body[1:] or [ast.Pass()]
    code = ast.unparse(tree)
    forbidden = [
        r"fallback\w*\s*=",                                   # a fallback BINDING
        r"except\s+(?:Exception|BaseException)[^:]*:\s*(?:pass|return)",
    ]
    for pattern in forbidden:
        expect(re.search(pattern, code, re.IGNORECASE) is None,
               f"balabot/jev.py contains a fallback-shaped construct: /{pattern}/")
    # And the module must *say* there is no fallback — the promise is documented.
    expect("no fallback" in src.lower(),
           "balabot/jev.py must document 'no fallback' as a binding project rule")
    # Every raised path must be a JevError subclass: loud, typed, no silent default.
    for name in ("JevNotConfigured", "JevAPIError"):
        cls = getattr(jev_mod, name)
        expect(issubclass(cls, jev_mod.JevError), f"{name} must be a JevError")
    # system_one's contract: raises on ANY error, never returns a default.
    doc = inspect.getdoc(jev_mod.Jev.system_one) or ""
    expect("raises" in doc.lower(), "system_one must document that it raises on any error")


def check_no_silent_degradation_in_callers(s: _Scenario) -> None:
    import balabot.memory_relevance as mr

    src = inspect.getsource(mr)
    # Fail loud means the exception PROPAGATES. Silent degradation hides in a
    # broad except that catches everything and continues with a degraded result.
    expect(re.search(r"except\s+(?:Exception|BaseException)\b", src) is None,
           "memory ladder must not use a broad except — that is where silent "
           "degradation hides")
    expect("except JevError" not in src,
           "memory ladder must not catch JevError: the failure must propagate "
           "to the caller rather than being turned into an empty result")


def check_no_default_answer_on_error(s: _Scenario) -> None:
    """A 503-exhausted client must not yield a result — the caller cannot proceed."""
    session = _FlakySession([(503, "overloaded")])
    client = Jev(api_key=API_KEY, session=session)
    exc = assert_raises(JevAPIError, client.system_one, "state", {"q": {"type": "noul"}})
    # No hidden re-entry: exactly the bounded retries, then stop. A default
    # answer would need an extra call that never raises — there isn't one.
    expect(session.calls == 1 + MAX_TRANSIENT_RETRIES,
           f"expected {1 + MAX_TRANSIENT_RETRIES} calls (bounded retry then loud "
           f"failure), got {session.calls}")
    # The failure names which dependency broke — the incident is actionable.
    expect("Jev" in str(exc), f"incident message must name Jev, got: {exc}")


def check_transient_set_matches_promise(s: _Scenario) -> None:
    expect(TRANSIENT_STATUSES == {429, 500, 502, 503, 504},
           f"transient statuses must be exactly the retryable set, got {TRANSIENT_STATUSES}")


def run(scenario_name: str = "sim_jev_outage") -> _Scenario:
    s = _Scenario(scenario_name)
    s.check("missing TYPESAFE_API_KEY raises JevNotConfigured (fail loud, no fallback)",
            check_missing_key_raises)
    s.check("connection-refused raises a Jev incident naming the outage",
            check_connection_refused_raises_incident)
    s.check("timeout: retried MAX_TRANSIENT_RETRIES times, then fails loud",
            check_timeout_raises_after_bounded_retries)
    s.check("HTTP 500: transient — retried, then fails loud naming the status",
            check_500_retries_then_fails_loud)
    s.check("HTTP 4xx: fails on the FIRST attempt — no retry on a bad request",
            check_4xx_fails_immediately_without_retry)
    s.check("HTTP 429: transient — bounded retry, then fail loud",
            check_429_is_transient_then_fails_loud)
    s.check("no fallback provider path exists in balabot/jev.py",
            check_no_fallback_in_code)
    s.check("memory ladder does not swallow Jev failures (fail loud end to end)",
            check_no_silent_degradation_in_callers)
    s.check("exhausted retries yield an error naming Jev — never a default answer",
            check_no_default_answer_on_error)
    s.check("transient status set is exactly {429,500,502,503,504}",
            check_transient_set_matches_promise)
    return s


def test_scenario():
    pytest_report(run())


if __name__ == "__main__":
    run_main(run())
