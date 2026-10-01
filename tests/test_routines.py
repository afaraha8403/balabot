"""Tests for the background routine runner in ``ui/server.py`` (W8-11).

The runner is the one thing that can actually execute a routine. These tests
pin the property the row exists for: a routine that throws has its failure
recorded and readable over HTTP — it is never swallowed — and the failure does
not kill the runner or any endpoint. A registered handler's successful result
is recorded too, so the run log is the operator-visible history either way.
"""

from __future__ import annotations

import time

import pytest


def _boom(routine):
    raise RuntimeError("routine boom")


def _make_routine(client, bot_id, title: str) -> dict:
    resp = client.post(
        f"/api/bots/{bot_id}/routines",
        json={"title": title, "prompt": "work"},
    )
    assert resp.status_code == 200
    return resp.json()["routine"]


def _wait_for_status(client, bot_id, routine_id, status, timeout=5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        runs = client.get(f"/api/bots/{bot_id}/routines/runs").json()["runs"]
        for run in runs:
            if run["routineId"] == routine_id and run["status"] == status:
                return run
        time.sleep(0.02)
    raise AssertionError(f"no {status} run for {routine_id} within {timeout}s")


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from ui import server

    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    with server._routine_runs_lock:
        server._routine_runs.clear()
        server._routine_handlers.clear()
    c = TestClient(server.app)
    c.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw
    yield c
    with server._routine_runs_lock:
        server._routine_runs.clear()
        server._routine_handlers.clear()
        server._routine_tasks.clear()


def test_throwing_routine_error_surfaces_over_http(client):
    from ui import server

    bot = "zz-w8-11"
    routine = _make_routine(client, bot, "Throwing routine")
    server.register_routine_handler(routine["id"], _boom)

    resp = client.post(f"/api/bots/{bot}/routines/{routine['id']}/run")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "started": True, "routineId": routine["id"]}

    run = _wait_for_status(client, bot, routine["id"], "failed")
    assert run["status"] == "failed"
    assert "routine boom" in run["error"]
    assert "RuntimeError" in run["error"]
    assert run["routineId"] == routine["id"]
    assert run["botId"] == bot
    assert run["startedAt"] > 0
    assert run["finishedAt"] >= run["startedAt"]


def test_failing_routine_does_not_kill_runner_or_endpoint(client):
    from ui import server

    bot = "zz-w8-11b"
    bad = _make_routine(client, bot, "Bad routine")
    good = _make_routine(client, bot, "Good routine")
    server.register_routine_handler(bad["id"], _boom)
    server.register_routine_handler(good["id"], lambda routine: {"ran": True})

    assert client.post(f"/api/bots/{bot}/routines/{bad['id']}/run").status_code == 200
    assert client.post(f"/api/bots/{bot}/routines/{good['id']}/run").status_code == 200

    assert _wait_for_status(client, bot, bad["id"], "failed")["status"] == "failed"
    completed = _wait_for_status(client, bot, good["id"], "completed")
    assert completed["result"] == {"ran": True}

    # The endpoint and the runner are still alive after the failure.
    assert client.get(f"/api/bots/{bot}/routines").status_code == 200
    assert client.get(f"/api/bots/{bot}/routines/runs").status_code == 200


def test_run_without_a_registered_handler_is_an_honest_409(client):
    bot = "zz-w8-11c"
    routine = _make_routine(client, bot, "No handler")

    resp = client.post(f"/api/bots/{bot}/routines/{routine['id']}/run")
    assert resp.status_code == 409
    assert "handler" in resp.json()["detail"]


def test_run_unknown_routine_is_a_404(client):
    bot = "zz-w8-11d"
    resp = client.post(f"/api/bots/{bot}/routines/no-such-routine/run")
    assert resp.status_code == 404
