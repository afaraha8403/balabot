"""Tests for the screen-lease subsystem (W3-15: lease audit trail completeness).

A lease is one agent holding one screen. Each state transition — acquire,
release, owner force-release, expiry — appends exactly one immutable audit row.
Acquiring a held resource is refused and names the holder. Expiry is evaluated
on read and swept lazily through a conditional update that cannot clobber a
concurrent release.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from balabot.screen_lease import (
    LeaseError,
    LeaseNotFound,
    acquire_lease,
    force_release,
    get_lease,
    list_audit,
    list_leases,
    release_lease,
)

# Fixed base so timed assertions are deterministic and never race the wall clock.
T0 = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _isolated_store(monkeypatch, tmp_path):
    """Fresh durable lease DB per test, under tmp_path."""
    monkeypatch.setenv("BALABOT_SCREEN_LEASES_DB", str(tmp_path / "screen_leases.db"))
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))


def _to_states(rows):
    return [r["to_state"] for r in rows]


# --- one scenario per transition: each transition leaves exactly one row -----


def test_acquire_appends_none_to_active_audit_row():
    rec = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    assert rec["state"] == "active"
    assert rec["agent_id"] == "agent-a"
    assert rec["resource_id"] == "screen-1"
    assert rec["expires_at"] == "2026-01-01T00:01:00Z"
    assert rec["released_at"] is None

    audit = list_audit(rec["lease_id"], now=T0)
    assert len(audit) == 1
    row = audit[0]
    assert (row["actor"], row["from_state"], row["to_state"]) == (
        "agent-a",
        "none",
        "active",
    )
    assert row["at"] == "2026-01-01T00:00:00Z"


def test_release_appends_active_to_released_audit_row():
    rec = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    out = release_lease(rec["lease_id"], "agent-a", now=T0 + timedelta(seconds=5))
    assert out["state"] == "released"
    assert out["released_at"] == "2026-01-01T00:00:05Z"

    audit = list_audit(rec["lease_id"], now=T0)
    assert _to_states(audit) == ["active", "released"]
    assert audit[1]["actor"] == "agent-a"


def test_non_holder_may_not_release():
    rec = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    with pytest.raises(LeaseError, match="held by 'agent-a'"):
        release_lease(rec["lease_id"], "agent-b", now=T0)
    assert get_lease(rec["lease_id"], now=T0)["state"] == "active"
    assert len(list_audit(rec["lease_id"], now=T0)) == 1


def test_force_release_by_owner_appends_reason():
    rec = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    out = force_release(
        rec["lease_id"],
        "owner",
        "agent wedged the display",
        now=T0 + timedelta(seconds=10),
    )
    assert out["state"] == "force_released"
    assert out["reason"] == "agent wedged the display"

    audit = list_audit(rec["lease_id"], now=T0)
    assert _to_states(audit) == ["active", "force_released"]
    assert audit[1]["actor"] == "owner"
    assert audit[1]["reason"] == "agent wedged the display"


def test_force_release_requires_owner_and_reason():
    rec = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    with pytest.raises(LeaseError, match="only the owner"):
        force_release(rec["lease_id"], "agent-b", "because", now=T0)
    with pytest.raises(LeaseError, match="reason is required"):
        force_release(rec["lease_id"], "owner", "  ", now=T0)
    assert get_lease(rec["lease_id"], now=T0)["state"] == "active"
    assert len(list_audit(rec["lease_id"], now=T0)) == 1


def test_expiry_appends_active_to_expired_audit_row():
    rec = acquire_lease("agent-a", "screen-1", ttl=10, now=T0)
    out = get_lease(rec["lease_id"], now=T0 + timedelta(seconds=30))
    assert out["state"] == "expired"
    assert out["reason"] == "ttl_elapsed"

    audit = list_audit(rec["lease_id"], now=T0 + timedelta(seconds=30))
    assert _to_states(audit) == ["active", "expired"]
    assert audit[1]["actor"] == "system"
    assert audit[1]["reason"] == "ttl_elapsed"


def test_acquire_while_held_refused_naming_the_holder():
    held = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    with pytest.raises(LeaseError, match="already leased by 'agent-a'"):
        acquire_lease("agent-b", "screen-1", ttl=60, now=T0 + timedelta(seconds=1))
    # No silent stealing: the holder is unchanged and no second lease exists.
    assert get_lease(held["lease_id"], now=T0)["state"] == "active"
    assert [l["lease_id"] for l in list_leases(now=T0)] == [held["lease_id"]]


def test_re_acquire_by_holder_renews_without_a_transition_row():
    rec = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    renewed = acquire_lease(
        "agent-a", "screen-1", ttl=60, now=T0 + timedelta(seconds=30)
    )
    assert renewed["lease_id"] == rec["lease_id"]
    assert renewed["expires_at"] == "2026-01-01T00:01:30Z"
    # Renewal keeps state active: no new transition, so no new audit row.
    assert _to_states(list_audit(rec["lease_id"], now=T0)) == ["active"]


# --- completeness: N transitions => exactly N audit rows, in order ----------


def test_audit_trail_is_exactly_n_transitions_in_order():
    a = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    release_lease(a["lease_id"], "agent-a", now=T0 + timedelta(seconds=1))
    b = acquire_lease("agent-b", "screen-1", ttl=60, now=T0 + timedelta(seconds=2))
    force_release(b["lease_id"], "owner", "stuck", now=T0 + timedelta(seconds=3))
    c = acquire_lease("agent-c", "screen-1", ttl=10, now=T0 + timedelta(seconds=4))
    get_lease(c["lease_id"], now=T0 + timedelta(seconds=120))  # lazy expire

    # 6 transitions across the resource's history => exactly 6 audit rows.
    audit = list_audit(now=T0 + timedelta(seconds=200))
    assert len(audit) == 6
    assert _to_states(audit) == [
        "active",
        "released",
        "active",
        "force_released",
        "active",
        "expired",
    ]
    # Insertion order is preserved (ids strictly increasing).
    assert [r["id"] for r in audit] == sorted(r["id"] for r in audit)
    # The row count equals the number of state transitions.
    assert len(audit) == 6


# --- lost update: the expiry sweep cannot clobber a concurrent release ------


def test_expiry_sweep_cannot_clobber_a_concurrent_release(monkeypatch):
    """A sweep that read a lease as active before a release landed must not
    revert the release.

    Lazy expiry that persisted the whole record it had read would flip a
    just-released lease back to `expired` (lost update) and add a phantom audit
    row. The sweep flips through a conditional UPDATE rooted at `state =
    'active'`, so the release wins and no expiry row is written.
    """
    from balabot import screen_lease as sl

    rec = acquire_lease("agent-a", "screen-1", ttl=60, now=T0)
    lid = rec["lease_id"]
    stale = dict(rec)  # the active copy an in-flight sweep read a moment ago

    orig_list = sl._db_list_active_raw

    def stale_list():
        # Reintroduce the now-released lease as if the sweep had already read it.
        return [stale] + [r for r in orig_list() if r["lease_id"] != lid]

    # The release lands first ...
    release_lease(lid, "agent-a", now=T0 + timedelta(seconds=5))
    assert sl._db_get(lid)["state"] == "released"

    # ... then the earlier sweep lands, holding a stale active view.
    monkeypatch.setattr(sl, "_db_list_active_raw", stale_list)
    expired = sl.expire_leases(now=T0 + timedelta(seconds=120))
    monkeypatch.setattr(sl, "_db_list_active_raw", orig_list)

    assert expired == []  # the sweep won nothing — the release held
    assert sl._db_get(lid)["state"] == "released"  # not clobbered to expired
    # No phantom audit row: exactly the acquire + release transitions.
    assert _to_states(list_audit(lid, now=T0 + timedelta(seconds=200))) == [
        "active",
        "released",
    ]


def test_expired_resource_is_reacquirable():
    """An expired holder no longer blocks its resource."""
    rec = acquire_lease("agent-a", "screen-1", ttl=10, now=T0)
    later = T0 + timedelta(seconds=30)
    fresh = acquire_lease("agent-b", "screen-1", ttl=60, now=later)
    assert fresh["state"] == "active"
    assert fresh["agent_id"] == "agent-b"
    # a's lapse is audited; b's acquire is audited.
    assert _to_states(list_audit(rec["lease_id"], now=later)) == ["active", "expired"]


def test_unknown_lease_is_not_found():
    with pytest.raises(LeaseNotFound):
        get_lease("sl_does_not_exist", now=T0)


# --- HTTP routes ------------------------------------------------------------


def test_lease_http_routes(monkeypatch):
    from fastapi.testclient import TestClient
    from ui import server

    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    client = TestClient(server.app)
    client.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw

    # acquire
    resp = client.post(
        "/api/leases/acquire", json={"agent_id": "agent-a", "resource_id": "screen-1"}
    )
    assert resp.status_code == 200
    rec = resp.json()["record"]
    lid = rec["lease_id"]
    assert rec["state"] == "active"

    # list
    resp = client.get("/api/leases")
    assert resp.status_code == 200
    assert lid in [l["lease_id"] for l in resp.json()["leases"]]

    # get
    resp = client.get(f"/api/leases/{lid}")
    assert resp.status_code == 200
    assert resp.json()["record"]["state"] == "active"

    # conflict: another agent names the holder
    resp = client.post(
        "/api/leases/acquire", json={"agent_id": "agent-b", "resource_id": "screen-1"}
    )
    assert resp.status_code == 409
    assert "agent-a" in resp.json()["detail"]

    # audit
    resp = client.get(f"/api/leases/{lid}/audit")
    assert resp.status_code == 200
    assert [r["to_state"] for r in resp.json()["audit"]] == ["active"]

    # force-release by owner, with reason
    resp = client.post(
        f"/api/leases/{lid}/force-release", json={"actor": "owner", "reason": "wedged"}
    )
    assert resp.status_code == 200
    assert resp.json()["record"]["state"] == "force_released"

    # all-audit, ordered, complete: acquire + force_released
    resp = client.get("/api/leases/audit")
    assert resp.status_code == 200
    assert [r["to_state"] for r in resp.json()["audit"]] == ["active", "force_released"]

    # unknown lease -> 404
    resp = client.get("/api/leases/sl_missing")
    assert resp.status_code == 404
