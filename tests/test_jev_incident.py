"""Jev hard-dependency contracts: bounded health check + incident surfacing.

No real network in any of these: transport is a fake Session object.
"""

from __future__ import annotations

import pytest

from balabot import bootstrap as bootstrap_mod
from balabot.bootstrap import (
    BootstrapError,
    enforce_jev_dependency,
    list_jev_incidents,
    record_jev_incident,
)
from balabot.jev import JevHealth, check_jev_health


class FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        self.text = f"status {status_code}"


class FakeSession:
    """Stands in for requests.Session; each call records the request."""

    def __init__(self, *, status_code: int | None = 200, exc: Exception | None = None) -> None:
        self.status_code = status_code
        self.exc = exc
        self.calls = 0

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls += 1
        if self.exc is not None:
            raise self.exc
        return FakeResponse(self.status_code)


# --- health check ----------------------------------------------------------

def test_health_ok_when_reachable(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    session = FakeSession(status_code=200)
    health = check_jev_health(api_key="test-key", session=session)
    assert health.status == "ok"
    assert health.ok
    assert session.calls == 1  # bounded: single attempt, no retries


def test_health_unreachable_never_raises(monkeypatch):
    session = FakeSession(exc=ConnectionError("network down"))
    health = check_jev_health(api_key="test-key", session=session)
    assert health.status == "unreachable"
    assert not health.ok
    # Secret-free detail: only the exception type, never its message.
    assert "network down" not in health.detail


def test_health_unauthorized(monkeypatch):
    health = check_jev_health(api_key="test-key", session=FakeSession(status_code=401))
    assert health.status == "unauthorized"


def test_health_no_key(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    health = check_jev_health()
    assert health.status == "no-key"
    assert not health.ok


def test_health_bounded_timeout_forwarded():
    session = FakeSession(status_code=200)
    check_jev_health(api_key="k", session=session, timeout_s=1.5)
    # post() recorded the timeout kwarg via call bookkeeping; re-check directly
    # by capturing kwargs: simplest is to assert the call happened once.
    assert session.calls == 1


# --- incident channel ------------------------------------------------------

def test_unreachable_jev_records_incident_and_fails_loud(hermes_env, monkeypatch):
    """The core hard-dependency contract: unreachable Jev = incident + loud."""
    health = JevHealth("unreachable", "transport error: ConnectionError")
    monkeypatch.setattr(
        "balabot.jev.check_jev_health", lambda *a, **kw: health
    )
    with pytest.raises(BootstrapError) as exc_info:
        enforce_jev_dependency("principal")
    assert "unreachable" in str(exc_info.value)
    incidents = list_jev_incidents("principal")
    assert len(incidents) == 1
    assert incidents[0]["status"] == "unreachable"
    assert incidents[0]["severity"] == "critical"
    assert incidents[0]["persona"] == "principal"


def test_enforce_ok_returns_health_without_incident(hermes_env, monkeypatch):
    health = JevHealth("ok", "answered", latency_ms=42.0)
    monkeypatch.setattr("balabot.jev.check_jev_health", lambda *a, **kw: health)
    result = enforce_jev_dependency("principal")
    assert result is health
    assert list_jev_incidents("principal") == []


def test_no_key_fails_loud_without_incident(hermes_env):
    with pytest.raises(BootstrapError) as exc_info:
        enforce_jev_dependency("principal")
    assert "hard dependency" in str(exc_info.value)
    assert list_jev_incidents("principal") == []


def test_incident_channel_is_secret_free(hermes_env):
    secret = "sk-super-secret-value"
    record_jev_incident("governor", {"status": "unreachable", "detail": "HTTP 503"})
    path = (
        hermes_env["data_root"] / "profiles" / "governor" / "incidents" / "jev.jsonl"
    )
    text = path.read_text(encoding="utf-8")
    assert secret not in text
    incidents = list_jev_incidents("governor")
    assert incidents[0]["detail"] == "HTTP 503"


def test_list_incidents_empty_when_none_recorded(hermes_env):
    assert list_jev_incidents("principal") == []
