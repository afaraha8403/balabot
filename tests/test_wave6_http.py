"""Wave 6 HTTP layer tests — /api/groups/* and /api/bot-proposals/*.

Same hermetic pattern as test_org_endpoints: monkeypatch server._org_run
with an in-process interpreter that runs the SAME snippet against an
isolated BALABOT_DATA_ROOT. The groups turn route's serial loop is tested
with a fake upstream (httpx.AsyncClient) that records the ORDER of the
per-member calls — serial means one call finishes before the next starts.
"""
from __future__ import annotations

import contextlib
import io
import json as _json
import os
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "ui"))

import server  # noqa: E402


def _fake_org_run(snippet: str, payload: dict | None = None,
                  timeout: float = 30.0) -> dict:
    ns: dict = {}
    src = "from balabot import orgs\n"
    buf = io.StringIO()
    try:
        if payload is not None:
            os.environ["_BALABOT_ORG_PAYLOAD"] = _json.dumps(payload)
        else:
            src = "import sys\n" + src
        try:
            with contextlib.redirect_stdout(buf):
                exec(compile(src + snippet, "<wave6-snippet>", "exec"), ns)
        except SystemExit:
            pass
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": f"{type(exc).__name__}: {exc}"}
    finally:
        os.environ.pop("_BALABOT_ORG_PAYLOAD", None)
    try:
        parsed = _json.loads(buf.getvalue().strip().splitlines()[-1])
    except Exception:
        return {"ok": False,
                "reason": f"snippet returned non-JSON: {buf.getvalue()[:200]}"}
    if isinstance(parsed, dict) and parsed.get("ok") is False:
        return parsed
    return {"ok": True, **parsed} if isinstance(parsed, dict) else {"ok": True, "data": parsed}


@pytest.fixture
def client(monkeypatch, tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    from balabot import orgs
    orgs.add_org("balacode", "Balacode", members=["principal", "governor"])
    monkeypatch.setattr(server, "_org_run", _fake_org_run)
    monkeypatch.setattr(server, "container_ok", lambda: True)
    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    c = TestClient(server.app)
    c.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw
    yield c


def _make_group(client, **over):
    body = {"name": "war room", "members": ["principal", "governor"]}
    body.update(over)
    r = client.post("/api/groups", json=body)
    assert r.status_code == 200, r.text
    return r.json()["group"]


# ---- P3: groups -------------------------------------------------------------

def test_group_create_list_get_delete(client):
    g = _make_group(client, members=["principal", "governor"],
                    computer_agent="governor")
    assert g["members"] == ["principal", "governor"]
    assert g["computerAgent"] == "governor"
    lst = client.get("/api/groups").json()
    assert lst["available"] is True and lst["groups"][0]["id"] == g["id"]
    one = client.get(f"/api/groups/{g['id']}").json()
    assert one["group"]["id"] == g["id"]
    assert client.delete(f"/api/groups/{g['id']}").json()["deleted"] is True
    r = client.get(f"/api/groups/{g['id']}")
    assert r.status_code == 404


def test_group_create_validates_against_the_fleet(client):
    r = client.post("/api/groups", json={"name": "x",
                                         "members": ["principal", "ghost"]})
    assert r.status_code == 400
    r = client.post("/api/groups", json={"name": "x", "members": ["principal"]})
    assert r.status_code == 400  # below the 2-bot floor


def test_group_turn_is_serial_and_persists(client, monkeypatch):
    g = _make_group(client)
    calls: list[tuple[float, str]] = []
    clock = {"t": 0.0}

    class FakeResp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": f"reply-{len(calls)}"}}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **k):
            import asyncio, time
            # Simulate real work: the second member's request must START only
            # after the first has FINISHED — that is the serial contract.
            await asyncio.sleep(0.01)
            calls.append((time.time(), url))
            await asyncio.sleep(0.01)
            return FakeResp()

    import httpx as _httpx
    original = server.httpx.AsyncClient
    server.httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        r = client.post(f"/api/groups/{g['id']}/turn",
                        json={"text": "hello @governor report"})
    finally:
        server.httpx.AsyncClient = original
    assert r.status_code == 200, r.text
    # @governor routes to exactly one member
    data = r.json()
    assert [x["bot"] for x in data["results"]] == ["governor"]
    assert data["group"]["round"] == 1
    transcript = data["group"]["transcript"]
    assert transcript[-1]["from"] == "governor"
    assert transcript[-1]["text"] == "reply-1"
    # persisted: a fresh GET sees the round and the per-member session growth
    one = client.get(f"/api/groups/{g['id']}").json()["group"]
    assert one["round"] == 1
    assert one["sessionLens"]["governor"] >= 2
    # serial: the single upstream call started strictly after nothing else
    assert len(calls) == 1


def test_group_turn_without_mention_hits_every_member_in_order(client, monkeypatch):
    g = _make_group(client)
    order: list[str] = []

    class FakeResp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "ack"}}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **k):
            order.append(url)  # starts strictly one-after-another
            return FakeResp()

    import httpx as _httpx
    original = server.httpx.AsyncClient
    server.httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        r = client.post(f"/api/groups/{g['id']}/turn", json={"text": "round up"})
    finally:
        server.httpx.AsyncClient = original
    assert r.status_code == 200
    assert [u.split("/p/")[1].split("/")[0] for u in order] == \
        ["principal", "governor"]
    data = r.json()
    assert [x["bot"] for x in data["results"]] == ["principal", "governor"]


def test_group_turn_records_member_errors_honestly(client, monkeypatch):
    g = _make_group(client)
    n = {"calls": 0}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **k):
            n["calls"] += 1
            raise RuntimeError(f"backend {503} down")

    import httpx as _httpx
    original = server.httpx.AsyncClient
    server.httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        r = client.post(f"/api/groups/{g['id']}/turn", json={"text": "go"})
    finally:
        server.httpx.AsyncClient = original
    assert r.status_code == 200  # per-member failure is not a route failure
    data = r.json()
    assert all(x.get("error") for x in data["results"])
    errs = [e for e in data["group"]["transcript"] if e["kind"] == "error"]
    assert errs and "503" in errs[-1]["detail"]


def test_group_turn_unknown_group_404(client):
    r = client.post("/api/groups/g_0000000000/turn", json={"text": "hi"})
    assert r.status_code == 404


# ---- P4: bot proposals --------------------------------------------------------

def test_proposal_lifecycle_full_consent_ladder(client):
    r = client.post("/api/bot-proposals", json={
        "name": "Research Scout", "role": "market signals",
        "proposed_by": "principal"})
    assert r.status_code == 200, r.text
    p = r.json()["proposal"]
    assert p["status"] == "proposed" and p["proposed_by"] == "principal"
    lst = client.get("/api/bot-proposals").json()
    assert lst["available"] is True and p["id"] in [x["id"] for x in lst["proposals"]]

    r = client.post(f"/api/bot-proposals/{p['id']}/approve")
    assert r.status_code == 200
    assert r.json()["proposal"]["status"] == "approved"
    assert r.json()["proposal"]["approved_by"] == "user"


def test_cannot_create_before_approval(client):
    r = client.post("/api/bot-proposals", json={
        "name": "Scout", "role": "scouting"})
    pid = r.json()["proposal"]["id"]
    r = client.post(f"/api/bot-proposals/{pid}/create")
    assert r.status_code == 400  # the consent gate holds at the HTTP layer
    assert "human approval" in r.json()["detail"]


def test_create_runs_inside_the_container_and_registers(client, monkeypatch):
    """Full ladder against the real (in-process) snippet: propose -> approve
    -> create, with creation provisioning real artifacts under the test data
    root and appending to the fleet map."""
    # the create snippet writes /opt/data/fleet/bots.json — repoint via the
    # fake run's env is BALABOT_DATA_ROOT, but the snippet hardcodes /opt/data.
    # The fake interpreter runs the snippet verbatim; give it a patched path
    # by monkeypatching the snippet's constant through the module.
    r = client.post("/api/bot-proposals", json={
        "name": "Scout", "role": "scouting", "proposed_by": "principal"})
    pid = r.json()["proposal"]["id"]
    assert client.post(f"/api/bot-proposals/{pid}/approve").status_code == 200

    # Repoint the snippet's fleet file into the isolated data root.
    fleet_file = pathlib.Path(os.environ["BALABOT_DATA_ROOT"]) / "fleet" / "bots.json"
    real_run = server._org_run

    def run_with_fleet_override(snippet, payload=None, timeout=30.0):
        snippet = snippet.replace("'/opt/data/fleet/bots.json'",
                                  repr(str(fleet_file)))
        return real_run(snippet, payload, timeout)

    monkeypatch.setattr(server, "_org_run", run_with_fleet_override)

    r = client.post(f"/api/bot-proposals/{pid}/create")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["bot"]["id"] == "scout"
    assert "scout" in data["org_members"]
    on_disk = _json.loads(fleet_file.read_text(encoding="utf-8"))
    assert on_disk["scout"]["name"] == "Scout"


def test_propose_by_unknown_bot_404s(client):
    r = client.post("/api/bot-proposals", json={
        "name": "X", "role": "y", "proposed_by": "not-a-bot"})
    assert r.status_code == 404


def test_proposals_list_honest_when_container_down(client, monkeypatch):
    monkeypatch.setattr(server, "container_ok", lambda: False)
    r = client.get("/api/bot-proposals")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False and body["reason"]
