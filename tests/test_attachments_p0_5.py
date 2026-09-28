"""Tests for P0-5: Bounded attachment uploads (10 MiB limit) and multimodal vision ingestion in /api/chat.

Verifies:
1. Bounded uploads: /api/attachments enforces ATTACHMENT_MAX_BYTES (10 MiB) limit
   and rejects oversized files with 413 Payload Too Large (multipart and JSON).
2. Multimodal vision: Image attachments reach upstream completions payload as
   OpenAI-standard multimodal content objects ({"type": "image_url", ...}) rather than
   plain filename strings.
"""

from __future__ import annotations

import asyncio
import base64
from fastapi.testclient import TestClient
import pytest

from ui import server

ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024  # 10 MiB


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    c = TestClient(server.app)
    c.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw
    return c


def test_attachment_upload_rejects_oversized_multipart(client):
    """Multipart upload exceeding 10 MiB must be rejected with 413 status."""
    oversized_data = b"X" * (ATTACHMENT_MAX_BYTES + 1024)
    files = {"file": ("big.dat", oversized_data, "application/octet-stream")}
    res = client.post("/api/attachments", files=files)
    assert res.status_code == 413
    assert "limit" in res.json().get("detail", "").lower() or "exceeds" in res.json().get("detail", "").lower()


def test_attachment_upload_rejects_oversized_json(client):
    """JSON base64 upload exceeding 10 MiB must be rejected with 413 status."""
    oversized_data = b"Y" * (ATTACHMENT_MAX_BYTES + 1024)
    b64 = base64.b64encode(oversized_data).decode("ascii")
    payload = {
        "name": "big.dat",
        "mime_type": "application/octet-stream",
        "content": b64,
    }
    res = client.post("/api/attachments", json=payload)
    assert res.status_code == 413
    assert "limit" in res.json().get("detail", "").lower() or "exceeds" in res.json().get("detail", "").lower()


def test_chat_converts_image_attachment_to_multimodal_object(tmp_path, monkeypatch):
    """Image attachments in /api/chat must reach upstream payload as multimodal image_url objects."""
    img_data = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
    img_path = tmp_path / "screenshot.png"
    img_path.write_bytes(img_data)
    expected_b64 = base64.b64encode(img_data).decode("ascii")

    recorded_payloads = []

    class _CaptureStream:
        async def __aenter__(self):
            class _R:
                status_code = 200
                async def aread(self):
                    return b""
                async def aiter_bytes(self):
                    yield b'event: final\ndata: {"content": "done"}\n\n'
            return _R()

        async def __aexit__(self, *exc):
            return False

    class _CaptureAsyncClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url, json=None, headers=None):
            recorded_payloads.append(json)
            return _CaptureStream()

    monkeypatch.setattr(server.httpx, "AsyncClient", _CaptureAsyncClient)
    monkeypatch.setattr(server, "_jev_chat_client", lambda: None)
    monkeypatch.setattr(server, "_JEV_CHAT_CLIENT", None)
    monkeypatch.setattr(server, "_JEV_CHAT_REASON", "disabled")

    body = {
        "bot_id": "principal",
        "messages": [{"role": "user", "content": "What is in this image?"}],
        "session_id": "sess_vision_test",
        "attachments": [
            {
                "id": "att_1",
                "name": "screenshot.png",
                "mime_type": "image/png",
                "path": str(img_path),
                "url": "/api/attachments/att_1/screenshot.png",
            }
        ],
    }

    async def fake_json():
        return body

    req = type("R", (), {"json": staticmethod(fake_json)})()
    resp = asyncio.run(server.chat(req))

    async def drain():
        async for _ in resp.body_iterator:
            pass

    asyncio.run(drain())

    assert len(recorded_payloads) == 1
    upstream_messages = recorded_payloads[0]["messages"]
    user_msg = next((m for m in upstream_messages if isinstance(m, dict) and m.get("role") == "user"), None)
    assert user_msg is not None

    # Must be a list of content parts including image_url multimodal object
    assert isinstance(user_msg["content"], list), f"Expected list of parts, got {type(user_msg['content'])}: {user_msg['content']}"

    image_parts = [p for p in user_msg["content"] if isinstance(p, dict) and p.get("type") == "image_url"]
    assert len(image_parts) == 1
    image_url_obj = image_parts[0]["image_url"]
    assert image_url_obj["url"].startswith("data:image/png;base64,")
    assert expected_b64 in image_url_obj["url"]
