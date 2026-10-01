"""W6-12: per-turn attachment payload cap on the /api/chat assembly path.

The per-file limit in `upload_attachment` (10 MiB) bounds one upload. These
tests cover the separate per-turn budget on the *summed* attachment payload
that `/api/chat` folds into the messages it forwards upstream:

- 1 byte over the cap is refused with an explicit 4xx naming the limit and the
  offending size — never truncated or dropped.
- at/under the cap the turn proceeds and the attachment still reaches the
  upstream payload as a multimodal `image_url` part (regression-proof).
"""

from __future__ import annotations

import asyncio
import base64

import pytest

from ui import server


def _body(attachments, text="look at this"):
    return {
        "bot_id": "principal",
        "messages": [{"role": "user", "content": text}],
        "attachments": attachments,
    }


def _image_attachment(raw: bytes):
    return {
        "name": "shot.png",
        "mime_type": "image/png",
        "content": base64.b64encode(raw).decode("ascii"),
    }


def _request(body):
    async def fake_json():
        return body

    return type("R", (), {"json": staticmethod(fake_json)})()


class _CaptureStream:
    async def __aenter__(self):
        class _R:
            status_code = 200

            async def aread(self):
                return b""

            async def aiter_bytes(self):
                yield b'event: final\ndata: {"content": "ok"}\n\n'

        return _R()

    async def __aexit__(self, *a):
        return False


def _install_capture(monkeypatch):
    captured: list[dict] = []

    class _CaptureClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url, json=None, headers=None):
            captured.append(json)
            return _CaptureStream()

    monkeypatch.setattr(server.httpx, "AsyncClient", _CaptureClient)
    monkeypatch.setattr(server, "_jev_chat_client", lambda: None)
    monkeypatch.setattr(server, "_JEV_CHAT_CLIENT", None)
    monkeypatch.setattr(server, "_JEV_CHAT_REASON", "disabled")
    return captured


def _drive_chat(body, monkeypatch):
    """Run /api/chat to completion and return the upstream payloads captured."""
    captured = _install_capture(monkeypatch)

    async def go():
        resp = await server.chat(_request(body))
        async for _ in resp.body_iterator:
            pass

    asyncio.run(go())
    return captured


def test_one_byte_over_cap_is_refused_explicitly(monkeypatch):
    """A payload 1 byte over the cap is refused, naming limit and size."""
    monkeypatch.setattr(server, "CHAT_ATTACHMENT_PAYLOAD_MAX_BYTES", 1024)
    body = _body([_image_attachment(b"A" * 1025)])

    with pytest.raises(server.HTTPException) as excinfo:
        asyncio.run(server.chat(_request(body)))

    exc = excinfo.value
    assert 400 <= exc.status_code < 500
    detail = exc.detail
    assert detail["error"] == "attachment_payload_exceeds_limit"
    assert detail["limit_bytes"] == 1024
    assert detail["attachment_bytes"] == 1025


def test_at_cap_succeeds_and_reaches_upstream(monkeypatch):
    """At/under the cap the turn runs and the image reaches the payload."""
    raw = b"B" * 1024
    expected_b64 = base64.b64encode(raw).decode("ascii")
    monkeypatch.setattr(server, "CHAT_ATTACHMENT_PAYLOAD_MAX_BYTES", 1024)
    captured = _drive_chat(_body([_image_attachment(raw)]), monkeypatch)

    assert len(captured) == 1
    user = next(
        m
        for m in captured[0]["messages"]
        if isinstance(m, dict) and m.get("role") == "user"
    )
    assert isinstance(user["content"], list)
    image_parts = [p for p in user["content"] if p.get("type") == "image_url"]
    assert len(image_parts) == 1
    assert expected_b64 in image_parts[0]["image_url"]["url"]


def test_under_cap_multiple_attachments_sum_correctly(monkeypatch):
    """The cap is on the SUM: three files that individually fit still sum."""
    monkeypatch.setattr(server, "CHAT_ATTACHMENT_PAYLOAD_MAX_BYTES", 1024)
    body = _body(
        [
            _image_attachment(b"C" * 400),
            _image_attachment(b"D" * 400),
            _image_attachment(b"E" * 225),
        ]
    )

    with pytest.raises(server.HTTPException) as excinfo:
        asyncio.run(server.chat(_request(body)))

    assert excinfo.value.detail["attachment_bytes"] == 1025
    assert excinfo.value.detail["limit_bytes"] == 1024
