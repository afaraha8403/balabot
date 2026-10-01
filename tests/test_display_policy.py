"""W7-6 / W7-14 — display cap, LRU eviction, and the sub-agent display policy.

These tests pin the runtime display allocator added to ``balabot.fleet`` and
the HTTP surface in ``ui/server.py``:

- W7-6: an org may hold at most ``display_cap()`` displays; a request at the
  cap evicts the least-recently-used allocation and records the eviction
  (who, by whom, why, when) before granting. The state is queryable over HTTP.
- W7-14: a sub-agent (an id the org manifest does not declare) is refused with
  the policy reason and consumes no cap slot.

HTTP tests mirror ``test_org_endpoints``: the routes run their work inside the
container via ``server._org_run``, so the fake here executes the *same*
snippets in-process against an isolated fleet dir + data root.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "ui"))

from balabot import fleet as fleet_mod  # noqa: E402
from balabot.fleet import FleetError  # noqa: E402

import server  # noqa: E402

ORG = "balacode"
AGENTS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]


def _manifest(org: str, agent_ids: list[str]) -> dict:
    return {
        "version": 1,
        "org": org,
        "container": f"agent-computer-{org}",
        "agents": [
            {"id": a, "display": f":{i + 1}", "socket": f"/run/cua-driver/{a}.sock"}
            for i, a in enumerate(agent_ids)
        ],
    }


@pytest.fixture
def display_env(tmp_path, monkeypatch):
    """Isolated fleet dir + data root; env overrides cleared to the defaults."""
    fleet_dir = tmp_path / "fleet"
    fleet_dir.mkdir()
    data_root = tmp_path / "data"
    data_root.mkdir()
    monkeypatch.setenv("BALABOT_FLEET_DIR", str(fleet_dir))
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    monkeypatch.delenv("BALABOT_DISPLAY_CAP", raising=False)
    monkeypatch.delenv("BALABOT_DISPLAYS_DB", raising=False)
    monkeypatch.delenv("BALABOT_DISPLAY_POOL_BASE", raising=False)
    (fleet_dir / f"{ORG}.json").write_text(
        json.dumps(_manifest(ORG, AGENTS)), encoding="utf-8"
    )
    return {"fleet": fleet_dir, "data": data_root}


def _fake_org_run(
    snippet: str, payload: dict | None = None, timeout: float = 30.0
) -> dict:
    """Execute an org snippet in-process against the isolated env.

    Mirrors ``server._org_run``: payload travels via the dedicated env var,
    stdout is captured, the last JSON line is the contract, and a printed
    ``{"ok": false}`` is an honest error passthrough.
    """
    ns: dict = {}
    buf = io.StringIO()
    try:
        if payload is not None:
            os.environ["_BALABOT_ORG_PAYLOAD"] = json.dumps(payload)
        try:
            with contextlib.redirect_stdout(buf):
                exec(compile(snippet, "<display-snippet>", "exec"), ns)
        except SystemExit:
            pass
    except Exception as exc:  # noqa: BLE001 — surface it like the bridge would
        return {"ok": False, "reason": f"{type(exc).__name__}: {exc}"}
    finally:
        os.environ.pop("_BALABOT_ORG_PAYLOAD", None)
    try:
        parsed = json.loads(buf.getvalue().strip().splitlines()[-1])
    except Exception:
        return {
            "ok": False,
            "reason": f"snippet returned non-JSON: {buf.getvalue()[:200]}",
        }
    if isinstance(parsed, dict) and parsed.get("ok") is False:
        return parsed
    return (
        {"ok": True, **parsed}
        if isinstance(parsed, dict)
        else {"ok": True, "data": parsed}
    )


@pytest.fixture
def client(display_env, monkeypatch):
    monkeypatch.setattr(server, "_org_run", _fake_org_run)
    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    c = TestClient(server.app)
    c.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw
    return c


# ── W7-6: cap is a named constant read from config ───────────────────────────


def test_default_display_cap_is_five(display_env):
    assert fleet_mod.display_cap() == fleet_mod.DISPLAY_CAP_DEFAULT == 5


def test_display_cap_is_configurable_and_validated(display_env, monkeypatch):
    monkeypatch.setenv("BALABOT_DISPLAY_CAP", "2")
    assert fleet_mod.display_cap() == 2
    monkeypatch.setenv("BALABOT_DISPLAY_CAP", "0")
    with pytest.raises(FleetError, match=">= 1"):
        fleet_mod.display_cap()
    monkeypatch.setenv("BALABOT_DISPLAY_CAP", "many")
    with pytest.raises(FleetError, match="must be an integer"):
        fleet_mod.display_cap()


# ── W7-6: allocation under the cap never evicts ──────────────────────────────


def test_allocate_under_cap_grants_and_never_evicts(display_env):
    out = fleet_mod.allocate_display(ORG, "alpha")
    assert out["granted"] is True and out["refused"] is False
    assert out["display"] == ":1"
    assert out["evicted"] is None
    state = fleet_mod.displays_state(ORG)
    assert state["cap"] == 5
    assert state["count"] == 1
    assert [a["agent"] for a in state["allocations"]] == ["alpha"]
    assert state["evictions"] == []


def test_allocate_is_idempotent_and_refreshes_recency(display_env):
    first = fleet_mod.allocate_display(ORG, "alpha")
    fleet_mod.allocate_display(ORG, "bravo")
    again = fleet_mod.allocate_display(ORG, "alpha")
    assert again["display"] == first["display"]
    assert again["evicted"] is None
    state = fleet_mod.displays_state(ORG)
    assert state["count"] == 2
    assert state["evictions"] == []
    assert state["allocations"][-1]["agent"] == "alpha"


# ── W7-6: at the cap, LRU is evicted, recorded, then granted ─────────────────


def test_allocate_at_cap_evicts_lru_with_record_and_grants(display_env, monkeypatch):
    monkeypatch.setenv("BALABOT_DISPLAY_CAP", "3")
    for a in ("alpha", "bravo", "charlie"):
        fleet_mod.allocate_display(ORG, a)
    out = fleet_mod.allocate_display(ORG, "delta")
    assert out["granted"] is True
    assert out["display"] == ":1"  # freed slot reused
    assert out["evicted"] is not None
    assert out["evicted"]["evicted_agent"] == "alpha"
    assert out["evicted"]["requested_by"] == "delta"
    assert "cap (3)" in out["evicted"]["reason"]
    assert out["evicted"]["at"].endswith("Z")

    state = fleet_mod.displays_state(ORG)
    assert state["count"] == 3
    assert [a["agent"] for a in state["allocations"]] == ["bravo", "charlie", "delta"]
    assert len(state["evictions"]) == 1
    assert state["evictions"][0]["evicted_agent"] == "alpha"


def test_lru_distinguishes_recency(display_env, monkeypatch):
    """touch alpha, then bravo, then charlie; fill to cap; touch alpha again.
    The next request must evict bravo (now LRU), not alpha (oldest by
    allocation time but most recently used)."""
    monkeypatch.setenv("BALABOT_DISPLAY_CAP", "3")
    for a in ("alpha", "bravo", "charlie"):
        fleet_mod.allocate_display(ORG, a)
    fleet_mod.allocate_display(ORG, "alpha")  # touch alpha -> most recent
    out = fleet_mod.allocate_display(ORG, "delta")
    assert out["evicted"]["evicted_agent"] == "bravo"
    survivors = {a["agent"] for a in fleet_mod.displays_state(ORG)["allocations"]}
    assert "alpha" in survivors and "bravo" not in survivors


# ── W7-14: a sub-agent gets no display and no cap slot ───────────────────────


def test_subagent_refused_with_policy_reason_and_no_allocation(display_env):
    out = fleet_mod.allocate_display(ORG, "worker-job-7")
    assert out["granted"] is False
    assert out["refused"] is True
    assert "sub-agent" in out["reason"]
    assert "named persistent agent" in out["reason"]
    state = fleet_mod.displays_state(ORG)
    assert state["count"] == 0
    assert state["allocations"] == []
    assert state["evictions"] == []


def test_subagent_does_not_count_against_cap_or_evict(display_env, monkeypatch):
    monkeypatch.setenv("BALABOT_DISPLAY_CAP", "2")
    fleet_mod.allocate_display(ORG, "alpha")
    fleet_mod.allocate_display(ORG, "bravo")
    before = fleet_mod.displays_state(ORG)
    out = fleet_mod.allocate_display(ORG, "worker-job-7")
    after = fleet_mod.displays_state(ORG)
    assert out["refused"] is True
    assert after["count"] == before["count"] == 2
    assert after["evictions"] == []  # a sub-agent request must not trigger eviction
    assert {a["agent"] for a in after["allocations"]} == {"alpha", "bravo"}


def test_unknown_org_raises(display_env):
    with pytest.raises(FleetError, match="no fleet manifest"):
        fleet_mod.allocate_display("nonexistent", "alpha")


# ── W7-6: the allocation state is queryable over HTTP ────────────────────────


def test_http_display_state_shows_cap_and_allocations(client):
    st, body = _http_get(client, f"/api/orgs/{ORG}/displays")
    assert st == 200
    data = json.loads(body)
    assert data["available"] is True
    assert data["cap"] == 5
    assert data["count"] == 0

    st, body = _http_post(client, f"/api/orgs/{ORG}/displays", {"agent": "alpha"})
    assert st == 200 and json.loads(body)["granted"] is True

    st, body = _http_get(client, f"/api/orgs/{ORG}/displays")
    data = json.loads(body)
    assert data["count"] == 1
    assert data["allocations"][0]["agent"] == "alpha"
    assert data["allocations"][0]["display"] == ":1"


def test_http_cap_visible_and_eviction_recorded(client, monkeypatch):
    monkeypatch.setenv("BALABOT_DISPLAY_CAP", "2")
    for a in ("alpha", "bravo"):
        st, _ = _http_post(client, f"/api/orgs/{ORG}/displays", {"agent": a})
        assert st == 200
    st, body = _http_post(client, f"/api/orgs/{ORG}/displays", {"agent": "charlie"})
    assert st == 200
    grant = json.loads(body)
    assert grant["granted"] is True
    assert grant["evicted"]["evicted_agent"] == "alpha"

    st, body = _http_get(client, f"/api/orgs/{ORG}/displays")
    state = json.loads(body)
    assert state["cap"] == 2
    assert state["count"] == 2
    assert len(state["evictions"]) == 1
    assert state["evictions"][0]["requested_by"] == "charlie"


def test_http_subagent_refused_with_reason_and_state_unchanged(client):
    st, body = _http_post(client, f"/api/orgs/{ORG}/displays", {"agent": "worker-job-7"})
    assert st == 200
    refusal = json.loads(body)
    assert refusal["granted"] is False
    assert refusal["refused"] is True
    assert "sub-agent" in refusal["reason"]

    st, body = _http_get(client, f"/api/orgs/{ORG}/displays")
    state = json.loads(body)
    assert state["count"] == 0
    assert state["evictions"] == []


def test_http_unknown_org_is_honest_unavailable(client):
    st, body = _http_get(client, "/api/orgs/nope/displays")
    assert st == 200
    assert json.loads(body)["available"] is False


def test_http_allocate_requires_agent(client):
    st, body = _http_post(client, f"/api/orgs/{ORG}/displays", {})
    assert st == 400


def _http_get(client: TestClient, path: str):
    r = client.get(path)
    return r.status_code, r.text


def _http_post(client: TestClient, path: str, body: dict):
    r = client.post(path, json=body)
    return r.status_code, r.text
