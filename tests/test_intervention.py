"""Tests for the agent intervention flow (kb/plans/agent-intervention-flow.md).

The bot pauses its turn and waits; the owner approves/denies; the requester
sees honest state (pending / accepted / rejected / expired); unsafe things are
refused: owner impersonation, history overwrite, stale application.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from balabot.intervention import (
    InterventionError,
    active_for_bot,
    enqueue_intervention,
    end_turn,
    format_intervention_frame,
    pending_intervention_count,
    request_intervention,
    resolve_intervention,
    state,
    what_the_bot_was_told,
)

# A moving base ("now" at import), so tests that observe without injecting
# `now` stay within a fresh request's pause window; every timed assertion
# below injects an explicit `now` anyway.
T0 = datetime.now(timezone.utc).replace(microsecond=0)


@pytest.fixture(autouse=True)
def _isolated_store(monkeypatch, tmp_path):
    """Fresh record/frame stores per test."""
    from balabot import intervention as iv
    monkeypatch.setenv("BALABOT_INTERVENTIONS_DB", str(tmp_path / "interventions.db"))
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(iv, "_records", {})
    monkeypatch.setattr(iv, "_pending_frames", {})


def _req(**kw):
    kw.setdefault("bot_id", "worker")
    kw.setdefault("reason", "login page is blocking me")
    kw.setdefault("now", T0)
    return request_intervention(**kw)


# --- happy path ------------------------------------------------------------


def test_pause_then_owner_approves_releases_turn():
    rec = _req()
    assert rec["state"] == "pending"
    assert rec["bot"] == "worker"
    # the turn holds: still pending before expiry
    st = state(rec["resume_token"])
    assert st["state"] == "pending"
    out = resolve_intervention(rec["resume_token"], "approve",
                               by="owner", now=T0 + timedelta(seconds=5))
    assert out["state"] == "accepted"
    assert state(rec["resume_token"])["state"] == "accepted"


def test_owner_deny_marks_rejected_and_bot_is_told():
    rec = _req()
    resolve_intervention(rec["resume_token"], "deny", by="owner",
                         now=T0 + timedelta(seconds=3))
    told = what_the_bot_was_told(rec["resume_token"])
    # deny ends the turn: not "resolved=continue", but explicitly rejected —
    # never a silent no-op.
    assert told["outcome"] == "rejected"
    assert told["resolved"] is False


def test_steer_is_approve_with_owner_note():
    rec = _req(reason="captcha wall", hint="choose the traffic lights")
    resolve_intervention(rec["resume_token"], "approve",
                         note="use the second tab instead",
                         by="owner", now=T0 + timedelta(seconds=4))
    st = state(rec["resume_token"])
    assert st["state"] == "accepted"
    assert st["owner_note"] == "use the second tab instead"
    assert st["resolved_by"] == "owner"
    # the bot learns only the note the owner chose to send
    told = what_the_bot_was_told(rec["resume_token"])
    assert told == {"resolved": True, "outcome": "accepted",
                    "note": "use the second tab instead"}


# --- refusals ---------------------------------------------------------------


def test_no_owner_impersonation_as_requester():
    with pytest.raises(InterventionError):
        _req(bot_id="ali")
    with pytest.raises(InterventionError):
        _req(bot_id="owner")


def test_only_owner_may_resolve():
    rec = _req()
    with pytest.raises(InterventionError):
        resolve_intervention(rec["resume_token"], "approve", by="worker")
    with pytest.raises(InterventionError):
        resolve_intervention(rec["resume_token"], "approve", by="")
    # a bot cannot approve its own pause (self-approval is not consent)
    with pytest.raises(InterventionError):
        resolve_intervention(rec["resume_token"], "approve", by="worker")
    assert state(rec["resume_token"], now=T0)["state"] == "pending"


def test_invalid_action_and_unknown_token_refused():
    rec = _req()
    with pytest.raises(InterventionError):
        resolve_intervention(rec["resume_token"], "force", by="owner")
    with pytest.raises(InterventionError):
        resolve_intervention("iv_unknown", "approve", by="owner")
    with pytest.raises(InterventionError):
        state("iv_unknown")
    # reason is required — an intervention must say why
    with pytest.raises(InterventionError):
        _req(reason="   ")


# --- staleness / expiry -----------------------------------------------------


def test_pause_timeout_marks_expired_and_never_applies():
    rec = _req(timeout=60)
    # past expires_at
    later = T0 + timedelta(seconds=61)
    # resolving after expiry does NOT apply — it returns the honest state
    out = resolve_intervention(rec["resume_token"], "approve", by="owner", now=later)
    assert out["state"] == "expired"
    st = state(rec["resume_token"])
    assert st["state"] == "expired"


def test_turn_ended_makes_pending_intervention_expired():
    rec = _req()
    done = end_turn(rec["resume_token"], now=T0 + timedelta(seconds=2))
    assert done["state"] == "expired"
    # resolving afterwards does NOT apply — the moment it targeted is gone
    out = resolve_intervention(rec["resume_token"], "approve", by="owner",
                               now=T0 + timedelta(seconds=3))
    assert out["state"] == "expired"


def test_decided_record_is_never_overwritten():
    rec = _req()
    resolve_intervention(rec["resume_token"], "approve", by="owner",
                         now=T0 + timedelta(seconds=1))
    again = resolve_intervention(rec["resume_token"], "deny", by="owner",
                                 now=T0 + timedelta(seconds=2))
    # history not rewritten: the first decision stands
    assert again["state"] == "accepted"
    assert state(rec["resume_token"])["state"] == "accepted"


def test_active_for_bot_reflects_pause_and_expiry():
    rec = _req(timeout=30)
    assert active_for_bot("worker", now=T0)["resume_token"] == rec["resume_token"]
    assert state(rec["resume_token"], now=T0)["state"] == "pending"
    # after expiry nothing is pending — the bot resumes unattended
    _ = T0 + timedelta(seconds=31)
    assert state(rec["resume_token"], now=_ )["state"] == "expired"
    assert active_for_bot("worker", now=_) is None


# --- honest-state transitions ------------------------------------------------


def test_state_is_explicit_at_every_step():
    rec = _req(timeout=10)
    assert rec["state"] == "pending"
    st = state(rec["resume_token"], now=T0)
    assert st["state"] == "pending"
    assert st["requested_at"] and st["expires_at"]
    resolve_intervention(rec["resume_token"], "deny", by="owner",
                         now=T0 + timedelta(seconds=1))
    st = state(rec["resume_token"], now=T0 + timedelta(seconds=1))
    assert st["state"] == "rejected"
    assert st["resolved_at"] and st["owner_action"] == "deny"


def test_bot_was_told_pending_is_not_resolved():
    rec = _req()
    assert what_the_bot_was_told(rec["resume_token"]) == {"resolved": False}


def test_expired_tells_bot_to_resume_unattended():
    rec = _req(timeout=5)
    resolve_intervention(rec["resume_token"], "approve", by="owner",
                         now=T0 + timedelta(seconds=1))
    told = what_the_bot_was_told(rec["resume_token"])
    assert told["resolved"] is True
    # unattended expiry resolves the pause with an explicit note field
    rec2 = _req(timeout=5)
    out = resolve_intervention(rec2["resume_token"], "approve", by="owner",
                               note="unattended: resumed",
                               now=T0 + timedelta(seconds=2))
    assert out["state"] == "accepted"


# --- SSE frame emission ------------------------------------------------------


def test_frame_matches_ui_named_event_grammar():
    rec = _req(reason="2fa code needed", hint="authenticator", url="https://x")
    frame = format_intervention_frame(rec)
    assert frame.startswith("event: intervention\ndata: ")
    assert frame.endswith("\n\n")
    # one data line, one JSON object with exactly the documented keys
    data_line = frame.splitlines()[1]
    assert data_line.startswith("data: ")
    import json
    payload = json.loads(data_line[len("data: "):])
    assert set(payload) == {"bot", "reason", "hint", "url", "resume_token"}
    assert payload["bot"] == "worker"
    assert payload["resume_token"] == rec["resume_token"]
    assert "2fa code needed" in payload["reason"]


def test_enqueue_and_drain_per_profile():
    rec = _req()
    enqueue_intervention(rec)
    assert pending_intervention_count("worker") == 1
    assert pending_intervention_count("other") == 0
    from balabot.intervention import drain_intervention_frames
    frames = drain_intervention_frames("worker")
    assert len(frames) == 1
    assert frames[0].startswith("event: intervention\n")
    # drained exactly once
    assert drain_intervention_frames("worker") == []
    assert pending_intervention_count("worker") == 0


# --- Call sites: HTTP routes, bot_tools CLI, chat stream integration --------


def test_bot_tools_request_intervention():
    from balabot import bot_tools
    out = bot_tools.request_intervention("principal", "captcha wall", hint="select cats", wait=False)
    assert out["requested"] is True
    assert out["bot"] == "principal"
    assert out["reason"] == "captcha wall"
    assert pending_intervention_count("principal") == 1


def test_bot_tools_request_intervention_cli(capsys):
    import json
    from balabot import bot_tools
    rc = bot_tools.main([
        "request_intervention", "--bot", "principal",
        "--reason", "login needed", "--hint", "2fa code", "--no-wait"
    ])
    assert rc == 0
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert payload["requested"] is True
    assert payload["bot"] == "principal"
    assert payload["reason"] == "login needed"


def test_bot_tools_request_intervention_waits_and_resolves():
    import threading
    import time
    from balabot import bot_tools, intervention

    def resolve_later():
        time.sleep(0.1)
        active = intervention.active_for_bot("worker_wait")
        if active:
            intervention.resolve_intervention(active["resume_token"], "approve", note="unblocked", by="owner")

    t = threading.Thread(target=resolve_later)
    t.start()
    out = bot_tools.request_intervention("worker_wait", "captcha wall", timeout=5, poll_interval=0.05)
    t.join()
    assert out["requested"] is True
    assert out["state"] == "accepted"
    assert out["resolved"] is True
    assert out["note"] == "unblocked"


def test_intervention_http_routes(monkeypatch):
    from fastapi.testclient import TestClient
    from ui import server

    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    client = TestClient(server.app)
    client.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw

    # 1. Request an intervention
    from balabot.intervention import request_intervention
    rec = request_intervention("principal", "needs login")
    token = rec["resume_token"]

    # 2. GET /api/interventions
    resp = client.get("/api/interventions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    tokens = [i["resume_token"] for i in data["interventions"]]
    assert token in tokens

    # 3. GET /api/intervention/{token}
    resp = client.get(f"/api/intervention/{token}")
    assert resp.status_code == 200
    assert resp.json()["record"]["state"] == "pending"

    # 4. POST /api/intervention/{token}/resolve (approve)
    resp = client.post(f"/api/intervention/{token}/resolve", json={"action": "approve", "note": "all set"})
    assert resp.status_code == 200
    res_data = resp.json()
    assert res_data["ok"] is True
    assert res_data["record"]["state"] == "accepted"
    assert res_data["record"]["owner_note"] == "all set"

    # 5. GET /api/intervention/{token} after resolve
    resp = client.get(f"/api/intervention/{token}")
    assert resp.status_code == 200
    assert resp.json()["record"]["state"] == "accepted"

    # 6. POST /api/intervention/pause (owner hold)
    resp = client.post("/api/intervention/pause", json={"bot_id": "principal", "reason": "Hold everything triggered"})
    assert resp.status_code == 200
    hold_data = resp.json()
    assert hold_data["ok"] is True
    assert hold_data["record"]["state"] == "pending"
    hold_token = hold_data["record"]["resume_token"]

    # 7. GET /api/intervention/active/principal
    resp = client.get("/api/intervention/active/principal")
    assert resp.status_code == 200
    assert resp.json()["record"]["resume_token"] == hold_token

    # 8. POST /api/intervention/{token}/end (turn ended marks expired)
    resp = client.post(f"/api/intervention/{hold_token}/end")
    assert resp.status_code == 200
    assert resp.json()["record"]["state"] == "expired"

    # 9. Stale resolve after turn ended does NOT apply - returns expired
    resp = client.post(f"/api/intervention/{hold_token}/resolve", json={"action": "approve"})
    assert resp.status_code == 200
    assert resp.json()["record"]["state"] == "expired"


def test_cli_subprocess_persists_and_waits_for_resolution(tmp_path, monkeypatch):
    import json
    import os
    import subprocess
    import sys
    import time
    from fastapi.testclient import TestClient
    from ui import server

    db_path = tmp_path / "interventions.db"
    env = dict(os.environ, BALABOT_INTERVENTIONS_DB=str(db_path), BALABOT_DATA_ROOT=str(tmp_path))
    monkeypatch.setenv("BALABOT_INTERVENTIONS_DB", str(db_path))
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")

    # Start CLI in a separate subprocess
    cmd = [
        sys.executable, "-m", "balabot.bot_tools",
        "request_intervention", "--bot", "principal",
        "--reason", "captcha wall", "--hint", "solve puzzle",
        "--timeout", "10",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)

    # Wait for the subprocess to write the intervention record into persistent storage
    client = TestClient(server.app)
    client.headers.update({"Authorization": "Basic YWxpOnB3"})
    interventions = []
    for _ in range(50):
        resp = client.get("/api/interventions")
        assert resp.status_code == 200
        interventions = resp.json().get("interventions", [])
        if interventions:
            break
        time.sleep(0.1)

    # 1. The subprocess must be running (blocking/waiting) and not exited prematurely
    assert len(interventions) >= 1, "Intervention record not visible to host process"
    assert proc.poll() is None, "CLI subprocess exited prematurely without waiting for human intervention"

    target = interventions[0]
    token = target["resume_token"]

    # 2. Resolve the intervention via the server API
    resolve_resp = client.post(f"/api/intervention/{token}/resolve", json={"action": "approve", "note": "captcha solved"})
    assert resolve_resp.status_code == 200

    # 3. The subprocess should now unblock, exit 0, and output the resolved record
    stdout, stderr = proc.communicate(timeout=5)
    assert proc.returncode == 0
    payload = json.loads(stdout)
    assert payload["state"] == "accepted"
    assert payload["outcome"] == "accepted"
    assert payload["resolved"] is True
    assert payload["note"] == "captcha solved"



