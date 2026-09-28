"""Tests for deterministic offline model emulator (P2-1).

Verifies:
1. Real loopback HTTP server emits synthetic OpenAI-compatible SSE chunk streams.
2. Supports streaming text, tool calls, error states, and non-streaming responses.
3. The emulator CAN FAIL: catches real regressions when expected payloads differ.
4. Fails when steps are unconsumed or unexpected requests are made.
5. End-to-end integration with ui/server.py chat endpoint over real HTTP loopback.
"""

from __future__ import annotations

import json
import pytest
import requests

from tests.model_emulator import ModelEmulatorStep, start_model_emulator


def test_emulator_streaming_text():
    steps = [
        ModelEmulatorStep(
            expect=lambda req: req["model"] == "principal" and len(req["messages"]) > 0,
            response={"type": "text", "text": "Hello world from emulator!"},
        )
    ]
    with start_model_emulator(steps=steps) as emu:
        url = f"{emu.base_url}/p/principal/v1/chat/completions"
        r = requests.post(
            url,
            json={"model": "principal", "messages": [{"role": "user", "content": "hi"}], "stream": True},
            headers={"Authorization": "Bearer test-key"},
            stream=True,
        )
        assert r.status_code == 200
        assert "text/event-stream" in r.headers.get("content-type", "")

        lines = [line.decode("utf-8") for line in r.iter_lines() if line]
        data_lines = [l[6:] for l in lines if l.startswith("data: ")]
        assert "data: [DONE]" in lines or "[DONE]" in data_lines

        parsed_chunks = [json.loads(d) for d in data_lines if d != "[DONE]"]
        content_deltas = [
            c["choices"][0]["delta"].get("content", "")
            for c in parsed_chunks
            if "content" in c["choices"][0]["delta"]
        ]
        assert "".join(content_deltas) == "Hello world from emulator!"
        emu.assert_complete()


def test_emulator_streaming_tool_call():
    steps = [
        ModelEmulatorStep(
            response={
                "type": "tool",
                "id": "call_123",
                "name": "search",
                "arguments": {"query": "balabot docs"},
            }
        )
    ]
    with start_model_emulator(steps=steps) as emu:
        url = f"{emu.base_url}/v1/chat/completions"
        r = requests.post(
            url,
            json={"model": "governor", "messages": [{"role": "user", "content": "search"}], "stream": True},
            stream=True,
        )
        assert r.status_code == 200
        lines = [line.decode("utf-8") for line in r.iter_lines() if line]
        data_lines = [l[6:] for l in lines if l.startswith("data: ")]
        parsed = [json.loads(d) for d in data_lines if d != "[DONE]"]

        tool_calls = []
        for p in parsed:
            tc = p["choices"][0]["delta"].get("tool_calls")
            if tc:
                tool_calls.extend(tc)
        assert len(tool_calls) >= 1
        assert tool_calls[0]["id"] == "call_123"
        assert tool_calls[0]["function"]["name"] == "search"
        emu.assert_complete()


def test_emulator_non_streaming():
    steps = [
        ModelEmulatorStep(
            expect=lambda req: req["stream"] is False,
            response={"type": "text", "text": "Non-streaming answer"},
        )
    ]
    with start_model_emulator(steps=steps) as emu:
        url = f"{emu.base_url}/p/principal/v1/chat/completions"
        r = requests.post(
            url,
            json={"model": "principal", "messages": [{"role": "user", "content": "ping"}], "stream": False},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["choices"][0]["message"]["content"] == "Non-streaming answer"
        emu.assert_complete()


def test_emulator_catches_regression_when_expect_fails():
    """Prove the emulator is NOT a rubber stamp: fails loudly on unexpected payload."""
    def expect_injected_secret(req):
        last_msg = req["messages"][-1]["content"]
        assert "INJECTED_CONTEXT" in last_msg, "Regression: required context was not injected!"

    steps = [
        ModelEmulatorStep(
            expect=expect_injected_secret,
            response={"type": "text", "text": "ok"},
        )
    ]
    with start_model_emulator(steps=steps) as emu:
        url = f"{emu.base_url}/p/principal/v1/chat/completions"
        # Bug/regression: client failed to inject the required context!
        r = requests.post(
            url,
            json={"model": "principal", "messages": [{"role": "user", "content": "plain message"}], "stream": True},
        )
        # Request failed or was flagged
        with pytest.raises(AssertionError, match="Regression: required context was not injected!"):
            emu.assert_complete()


def test_emulator_fails_when_steps_unconsumed():
    """Prove the emulator fails when expected turns were skipped."""
    steps = [
        ModelEmulatorStep(response={"type": "text", "text": "turn 1"}),
        ModelEmulatorStep(response={"type": "text", "text": "turn 2"}),
    ]
    with start_model_emulator(steps=steps) as emu:
        url = f"{emu.base_url}/v1/chat/completions"
        requests.post(url, json={"model": "m", "messages": [], "stream": True})
        with pytest.raises(AssertionError, match="Not all model emulator steps were consumed: 1/2"):
            emu.assert_complete()


def test_emulator_fails_on_unexpected_extra_request():
    """Prove the emulator fails when unexpected extra calls are made."""
    steps = [ModelEmulatorStep(response={"type": "text", "text": "turn 1"})]
    with start_model_emulator(steps=steps) as emu:
        url = f"{emu.base_url}/v1/chat/completions"
        r1 = requests.post(url, json={"model": "m", "messages": [], "stream": True})
        assert r1.status_code == 200
        r2 = requests.post(url, json={"model": "m", "messages": [], "stream": True})
        assert r2.status_code == 400
        with pytest.raises(AssertionError, match="Unexpected model request"):
            emu.assert_complete()


def test_emulator_handles_error_response():
    steps = [
        ModelEmulatorStep(response={"type": "error", "status": 503, "message": "upstream model overloaded"})
    ]
    with start_model_emulator(steps=steps) as emu:
        url = f"{emu.base_url}/v1/chat/completions"
        r = requests.post(url, json={"model": "m", "messages": [], "stream": True})
        assert r.status_code == 503
        data = r.json()
        assert data["error"]["message"] == "upstream model overloaded"
        assert data["error"]["type"] == "fixture_error"
        emu.assert_complete()


def test_make_model_emulator_fixture(make_model_emulator):
    """Verify make_model_emulator pytest fixture behaves identically and auto-cleans."""
    emu = make_model_emulator(steps=[
        ModelEmulatorStep(response={"type": "text", "text": "fixture response"})
    ])
    r = requests.post(f"{emu.base_url}/v1/chat/completions", json={"model": "test", "messages": [], "stream": False})
    assert r.status_code == 200
    assert r.json()["choices"][0]["message"]["content"] == "fixture response"
    emu.assert_complete()


@pytest.mark.asyncio
async def test_server_upstream_turn_with_emulator(make_model_emulator, monkeypatch):
    """End-to-end integration: ui/server._upstream_turn making real loopback request to emulator."""
    import sys
    import pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "ui"))
    import server

    emu = make_model_emulator(steps=[
        ModelEmulatorStep(
            expect=lambda req: req["model"] == "governor" and req["messages"][0]["content"] == "audit check",
            response={"type": "text", "text": "audit passed successfully"},
        )
    ])
    monkeypatch.setattr(server, "UPSTREAM", emu.base_url)

    result = await server._upstream_turn("governor", [{"role": "user", "content": "audit check"}])
    assert result == "audit passed successfully"
    emu.assert_complete()

