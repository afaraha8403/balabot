"""Deterministic offline model emulator for testing (P2-1).

Adopts Polaris's testing pattern (Polaris packages/testkit/src/model-emulator.ts,
Polaris docs/agent-verification.md:24-36).

Implements a lightweight loopback HTTP server emitting synthetic
OpenAI-compatible SSE chunk streams for test suites, allowing comprehensive
testing of tools, handoffs, and error states without paid API calls.

Ensures the emulator can FAIL on regressions:
- Validates each incoming request against step assertions.
- Requires all scripted steps to be consumed via assert_complete().
- Rejects unexpected extra requests.
"""

from __future__ import annotations

import http.server
import json
import threading
import time
from typing import Any, Callable, Sequence


class ModelEmulatorStep:
    """A single scripted model interaction turn."""

    def __init__(
        self,
        expect: Callable[[dict[str, Any]], None] | None = None,
        response: dict[str, Any] | Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ):
        self.expect = expect
        self.response = response or {"type": "text", "text": "ok"}


class _ModelEmulatorRequestHandler(http.server.BaseHTTPRequestHandler):
    """Handles OpenAI-compatible completions requests on loopback."""

    def log_message(self, format: str, *args: Any) -> None:
        # Silent by default to avoid cluttering test outputs
        pass

    def do_POST(self) -> None:  # noqa: N802
        # Accept /v1/chat/completions or /p/<profile>/v1/chat/completions
        valid_endpoints = ("/v1/chat/completions",)
        is_profile_endpoint = (
            self.path.startswith("/p/") and self.path.endswith("/v1/chat/completions")
        )
        if not (self.path in valid_endpoints or is_profile_endpoint):
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": {"message": f"Endpoint {self.path} not found", "type": "not_found"}}).encode("utf-8")
            )
            return

        content_len = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b"{}"
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception as exc:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": {"message": f"Malformed JSON: {exc}", "type": "bad_request"}}).encode("utf-8")
            )
            return

        emu: ModelEmulator = self.server.emulator  # type: ignore[attr-defined]
        with emu._lock:
            step_idx = emu.step_index
            emu.requests.append(body)
            if step_idx >= len(emu.steps):
                err = AssertionError(f"Unexpected model request {step_idx + 1}")
                emu.failures.append(err)
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"error": {"message": str(err), "type": "fixture_error"}}).encode("utf-8")
                )
                return

            step = emu.steps[step_idx]
            emu.step_index += 1

        if step.expect is not None:
            try:
                step.expect(body)
            except Exception as exc:
                with emu._lock:
                    emu.failures.append(exc)
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"error": {"message": str(exc), "type": "fixture_error"}}).encode("utf-8")
                )
                return

        if callable(step.response):
            reply = step.response(body)
        else:
            reply = step.response or {"type": "text", "text": "ok"}

        reply_type = reply.get("type", "text")

        if reply_type == "error":
            status = reply.get("status", 400)
            msg = reply.get("message", "error")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": {"message": msg, "type": "fixture_error"}}).encode("utf-8")
            )
            return

        if reply_type == "disconnect":
            self.close_connection = True
            return

        is_stream = bool(body.get("stream", True))
        model_name = body.get("model", emu.model_id)

        if is_stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()

            def emit(delta: dict[str, Any], finish_reason: str | None = None) -> None:
                chunk = {
                    "id": f"fixture-{step_idx}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model_name,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
                }
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode("utf-8"))
                self.wfile.flush()

            emit({"role": "assistant"})
            if reply_type == "tool":
                tool_id = reply.get("id", f"call_{step_idx}")
                name = reply.get("name", "tool")
                arguments = reply.get("arguments", {})
                arg_chunks = reply.get("argument_chunks") or [json.dumps(arguments)]
                emit({
                    "tool_calls": [{
                        "index": 0,
                        "id": tool_id,
                        "type": "function",
                        "function": {"name": name, "arguments": ""},
                    }]
                })
                for fragment in arg_chunks:
                    emit({
                        "tool_calls": [{
                            "index": 0,
                            "function": {"arguments": fragment},
                        }]
                    })
                emit({}, finish_reason="tool_calls")
            else:
                text = reply.get("text", "")
                chunks = reply.get("chunks") or [text]
                for ch in chunks:
                    if ch:
                        emit({"content": ch})
                emit({}, finish_reason="stop")

            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            if reply_type == "tool":
                tool_id = reply.get("id", f"call_{step_idx}")
                name = reply.get("name", "tool")
                arguments = reply.get("arguments", {})
                msg = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": tool_id,
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments)},
                    }],
                }
                finish_reason = "tool_calls"
            else:
                msg = {"role": "assistant", "content": reply.get("text", "")}
                finish_reason = "stop"

            resp_body = {
                "id": f"fixture-{step_idx}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model_name,
                "choices": [{"index": 0, "message": msg, "finish_reason": finish_reason}],
            }
            self.wfile.write(json.dumps(resp_body).encode("utf-8"))
            self.wfile.flush()


class ModelEmulator:
    """Offline loopback model server instance."""

    def __init__(self, steps: Sequence[ModelEmulatorStep], model_id: str = "offline-fixture"):
        self.steps = list(steps)
        self.model_id = model_id
        self.requests: list[dict[str, Any]] = []
        self.failures: list[Exception] = []
        self.step_index = 0
        self._lock = threading.Lock()

        # Threading HTTP server on loopback with port 0
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _ModelEmulatorRequestHandler)
        self.server.emulator = self  # type: ignore[attr-defined]
        self.port = self.server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"
        self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self._thread.start()

    def assert_complete(self) -> None:
        """Assert that no failures occurred and all expected steps were consumed."""
        with self._lock:
            if self.failures:
                msg = f"{len(self.failures)} emulator assertion(s) failed:\n" + "\n".join(
                    str(f) for f in self.failures
                )
                raise AssertionError(msg)
            if self.step_index < len(self.steps):
                raise AssertionError(
                    f"Not all model emulator steps were consumed: {self.step_index}/{len(self.steps)}"
                )

    def close(self) -> None:
        """Shut down the emulator loopback server."""
        try:
            self.server.shutdown()
            self.server.server_close()
        except Exception:
            pass

    def __enter__(self) -> ModelEmulator:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


def start_model_emulator(
    steps: Sequence[ModelEmulatorStep] | None = None,
    model_id: str = "offline-fixture",
) -> ModelEmulator:
    """Start and return a running offline ModelEmulator."""
    return ModelEmulator(steps or [], model_id=model_id)
