"""Tests for the org HTTP surface in ui/server.py.

Core rule under test (kb/plans/org-secrets-and-skills.md):
    "The interface is in the chat. The value never is."
A POSTed secret value must appear in NO response of ANY org route, and never
in the SSE frames emitted by /api/chat.

The org routes exec their registry work INSIDE the container (see
server._org_run). Tests stay hermetic by monkeypatching _org_run with an
in-process interpreter that runs the SAME snippet against an isolated
BALABOT_DATA_ROOT — identical code path, no docker, no touching the real
registry.
"""
import contextlib
import io
import json as _json
import os
import sys
import pathlib

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "ui"))

import server  # noqa: E402

SENTINEL = "«redacted:sk-…»"


def _fake_org_run(snippet: str, payload: dict | None = None,
                  timeout: float = 30.0) -> dict:
    """Run a _org_run snippet in-process against the test data root.

    Mirrors the container path exactly: same env-driven data root, same
    payload contract, same {"ok": false} error passthrough, same
    parse-the-last-JSON-line behaviour. stdout is captured so a stray print
    can never reach a test log.
    """
    ns: dict = {}
    src = "from balabot import orgs\n"
    buf = io.StringIO()
    try:
        if payload is not None:
            # The wrapped snippet reads the payload JSON from the
            # _BALABOT_ORG_PAYLOAD env var, exactly as the container does.
            os.environ["_BALABOT_ORG_PAYLOAD"] = _json.dumps(payload)
        else:
            src = "import sys\n" + src
        try:
            with contextlib.redirect_stdout(buf):
                exec(compile(src + snippet, "<org-snippet>", "exec"), ns)
        except SystemExit:
            pass  # the container-side snippets exit(0) after an error print
    except Exception as exc:  # noqa: BLE001 — surface it like the bridge would
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
    """TestClient with basic auth + an isolated org data root."""
    data_root = tmp_path / "data"
    data_root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    from balabot import orgs
    orgs.add_org("balacode", "Balacode", members=["principal", "governor"])
    orgs.add_org("otherorg", "Other", members=["oscar"])
    monkeypatch.setattr(server, "_org_run", _fake_org_run)
    monkeypatch.setattr(server, "container_ok", lambda: True)
    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    c = TestClient(server.app)
    c.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw
    yield c


def _save_secret(client, **over):
    body = {"name": "STRIPE_SECRET_KEY", "value": SENTINEL, "org": "balacode",
            "description": "test key", "share_scope": "one", "bots": ["principal"]}
    body.update(over)
    return client.post("/api/org/secrets", json=body)


# ---- auth -------------------------------------------------------------------

def test_no_credentials_gets_401(client, monkeypatch):
    c = TestClient(server.app)  # no Authorization header
    for path in ("/api/orgs", "/api/org/secrets", "/api/org/grants",
                 "/api/org/requests"):
        r = c.get(path)
        assert r.status_code == 401, (path, r.status_code)
    r = c.post("/api/org/secrets", json={})
    assert r.status_code == 401


# ---- POST/GET secrets -------------------------------------------------------

def test_save_secret_returns_metadata_only(client):
    r = _save_secret(client)
    assert r.status_code == 200
    data = r.json()
    assert data["saved"] is True
    assert data["name"] == "STRIPE_SECRET_KEY"
    assert data["share_scope"] == "one"
    assert data["granted_to"] == ["principal"]
    assert data["fingerprint"] == "…" + SENTINEL[-4:]
    assert SENTINEL not in r.text


def test_save_secret_share_scopes(client):
    r = _save_secret(client, name="ALL", share_scope="all")
    assert r.json()["granted_to"] == ["org:balacode:principal",
                                      "org:balacode:governor"]
    r = _save_secret(client, name="CHOOSE", share_scope="choose",
                     bots=["governor"])
    assert r.json()["granted_to"] == ["governor"]
    r = _save_secret(client, name="CROSS", share_scope="another_org",
                     target_org="otherorg")
    assert r.json()["granted_to"] == ["org:otherorg"]


def test_get_secrets_metadata_only(client):
    _save_secret(client)
    r = client.get("/api/org/secrets")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["name"] == "STRIPE_SECRET_KEY"
    assert row["org"] == "balacode"
    assert row["fingerprint"] == "…" + SENTINEL[-4:]
    assert row["granted_to"] == ["principal"]
    assert SENTINEL not in r.text


# ---- grants CRUD ------------------------------------------------------------

def test_grants_crud(client):
    r = _save_secret(client)
    grant_id = r.json()["grant_ids"][0]
    lst = client.get("/api/org/grants").json()["grants"]
    assert any(g["id"] == grant_id for g in lst)
    r = client.post("/api/org/grants", json={
        "subject_bot": "governor", "subject_org": "balacode",
        "resource": {"kind": "secret", "name": "STRIPE_SECRET_KEY"},
        "scope": "bot", "access": "inject"})
    assert r.status_code == 200
    new_id = r.json()["grant"]["id"]
    r = client.post(f"/api/org/grants/{new_id}/revoke")
    assert r.status_code == 200
    assert r.json()["revoked"] is True
    assert r.json()["grant"]["revoked_at"] is not None
    # revocation never deletes
    lst = client.get("/api/org/grants").json()["grants"]
    row = next(g for g in lst if g["id"] == new_id)
    assert row["revoked_at"] is not None


# ---- orgs list --------------------------------------------------------------

def test_orgs_list(client):
    r = client.get("/api/orgs")
    assert r.status_code == 200
    ids = [o["id"] for o in r.json()["orgs"]]
    assert ids == ["balacode", "otherorg"]


# ---- access-request queue + SSE ---------------------------------------------

def test_requests_queue_and_sse_frame(client):
    r = client.post("/api/org/requests", json={
        "bot": "principal", "kind": "secret_request",
        "name": "STRIPE_SECRET_KEY", "description": "for billing"})
    assert r.status_code == 200
    q = client.get("/api/org/requests").json()
    assert q["count"] == 1
    assert q["requests"][0]["name"] == "STRIPE_SECRET_KEY"

    import httpx as _httpx

    class FakeUpstream:
        def __init__(self):
            self.status_code = 200

        async def aiter_bytes(self):
            yield b'event: handoff\ndata: {"from":"principal","to":"governor"}\n\n'
            yield b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'

        async def aread(self):
            return b""

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, *a, **k):
            return FakeUpstream()

    monkeypatch_attr = _httpx.AsyncClient
    server.httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        with client.stream("POST", "/api/chat",
                           json={"bot_id": "principal", "messages": []}) as resp:
            assert resp.status_code == 200
            text = "".join(resp.iter_text())
    finally:
        server.httpx.AsyncClient = monkeypatch_attr

    assert "event: secret_request" in text
    assert '"name": "STRIPE_SECRET_KEY"' in text or '"name":"STRIPE_SECRET_KEY"' in text
    assert '"requestedBy": "principal"' in text or '"requestedBy":"principal"' in text
    assert "event: handoff" in text
    # queue drained
    assert client.get("/api/org/requests").json()["count"] == 0


# ---- the value never leaves the backend -------------------------------------

def test_value_never_in_any_response_or_log(client, caplog):
    import logging
    with caplog.at_level(logging.DEBUG):
        r = _save_secret(client)
        assert r.status_code == 200
        routes = [
            ("GET", "/api/orgs"), ("GET", "/api/org/secrets"),
            ("GET", "/api/org/grants"), ("GET", "/api/org/requests"),
        ]
        texts = [r.text]
        for method, path in routes:
            resp = client.request(method, path)
            assert resp.status_code == 200
            texts.append(resp.text)
    for t in texts:
        assert SENTINEL not in t
    assert SENTINEL not in caplog.text


def test_value_not_in_error_detail(client):
    r = _save_secret(client, value=SENTINEL, org="nope")
    assert r.status_code == 404
    assert SENTINEL not in r.text
    r = _save_secret(client, value=SENTINEL, share_scope="another_org")
    assert r.status_code == 400
    assert SENTINEL not in r.text


def test_secret_helper_delivery_grant_scoping(client):
    """Raw delivery to shell environment is discontinued (P0-4); secret_lines_for returns []."""
    from balabot import secret_helper
    _save_secret(client)
    assert secret_helper.secret_lines_for("principal") == []
    assert secret_helper.secret_lines_for("governor") == []
