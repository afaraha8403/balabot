"""Tests for balabot/computer.py — the agent-computer driver bridge.

CONTRACT (honesty rule): the bridge never fabricates a frame and never
silently degrades. Every path returns real driver data (ok) or a structured
failure (ok=False + state + reason). These tests exercise the contract with
scripted driver output; the live end-to-end proof lives in
docs/agent-computer.md and ran against the real container.
"""

from __future__ import annotations

import base64
import io
import json
import sys
import pathlib

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from balabot import computer  # noqa: E402


# A real 1x1 PNG (magic + IHDR/IDAT/IEND) for decode-path tests.
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg"
    "YGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="
)


def _driver(monkeypatch, data=None, **kw):
    """Script computer._driver's return for one call."""
    ret = {"ok": kw.get("ok", True)}
    if data is not None:
        ret["data"] = data
    for k, v in kw.items():
        if k != "ok":
            ret[k] = v
    monkeypatch.setattr(computer, "_driver", lambda *a, **k: ret)
    return ret


def test_check_unavailable_when_binary_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(computer, "DRIVER_BIN", str(tmp_path / "missing"))
    out = computer.check("principal")
    assert out["available"] is False
    assert out["state"] == "no-driver"
    assert "cua-driver binary not found" in out["reason"]


def test_check_unavailable_when_socket_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(computer, "SOCKET_DIR", str(tmp_path))
    monkeypatch.setattr(computer, "DRIVER_BIN", str(tmp_path / "fake"))  # exists
    (tmp_path / "fake").write_text("")
    out = computer.check("principal")
    assert out["available"] is False
    assert out["state"] == "no-driver"
    assert "socket" in out["reason"] and "principal.sock" in out["reason"]


def test_check_ready_roundtrip(monkeypatch):
    _driver(monkeypatch, data={"width": 1920, "height": 1080})
    out = computer.check("principal")
    assert out["available"] is True and out["state"] == "ready"
    assert out["width"] == 1920 and out["height"] == 1080
    assert out["display"] == ":1" and out["socket"].endswith("principal.sock")


def test_display_assignment_is_stable_and_in_range():
    assert computer.display_for("principal") == ":1"
    assert computer.display_for("governor") == ":2"
    assert computer.display_for("principal") == computer.display_for("principal")


def test_frame_rejects_non_png_magic(monkeypatch):
    _driver(
        monkeypatch,
        data={
            "screenshot_png_b64": base64.b64encode(b"NOTAPNG").decode(),
            "screenshot_width": 1,
            "screenshot_height": 1,
        },
    )
    out = computer.frame("principal")
    assert out["ok"] is False and out["state"] == "error"
    assert "not a PNG" in out["reason"]


def test_frame_rejects_size_mismatch(monkeypatch):
    big = base64.b64encode(_PNG_1X1).decode()
    _driver(
        monkeypatch,
        data={
            "screenshot_png_b64": big,
            "screenshot_width": 1920,
            "screenshot_height": 1080,
        },
    )
    out = computer.frame("principal")
    assert out["ok"] is False and out["state"] == "error"
    assert "disagrees" in out["reason"]


def test_frame_rejects_bad_b64(monkeypatch):
    _driver(
        monkeypatch,
        data={
            "screenshot_png_b64": "!!!not b64!!!",
            "screenshot_width": 1,
            "screenshot_height": 1,
        },
    )
    out = computer.frame("principal")
    assert out["ok"] is False and out["state"] == "error"


def test_frame_ok_real_png(monkeypatch):
    _driver(
        monkeypatch,
        data={
            "screenshot_png_b64": base64.b64encode(_PNG_1X1).decode(),
            "screenshot_width": 1,
            "screenshot_height": 1,
            "capture_id": "capture_test",
        },
    )
    out = computer.frame("principal")
    assert out["ok"] is True and out["state"] == "ready"
    assert out["width"] == 1 and out["height"] == 1 and out["mime"] == "image/png"
    assert out["capture_id"] == "capture_test"
    assert out["capturedAt"].endswith("Z")


def test_act_rejects_unknown_and_bad_args(monkeypatch):
    out = computer.act("principal", {"action": "teleport"})
    assert out["ok"] is False and "unknown action" in out["reason"]
    out = computer.act("principal", {"action": "type"})
    assert out["ok"] is False and "non-empty text" in out["reason"]
    out = computer.act("principal", {"action": "type", "text": "x" * 2001})
    assert out["ok"] is False and "2000-char cap" in out["reason"]
    out = computer.act("principal", {"action": "key", "key": ""})
    assert out["ok"] is False
    out = computer.act("principal", {"action": "click", "x": "abc", "y": 0})
    assert out["ok"] is False and "must be integers" in out["reason"]


def test_act_click_maps_to_driver(monkeypatch):
    calls = []
    real_driver = computer._driver

    def spy(bot_id, *args, **kw):
        calls.append((bot_id, args))
        if "click" in args:
            return {
                "ok": True,
                "data": {"summary": "Sent screen-absolute click at (10,20)."},
            }
        # follow-up frame capture: hand back a real 1x1 PNG
        return {
            "ok": True,
            "data": {
                "screenshot_png_b64": base64.b64encode(_PNG_1X1).decode(),
                "screenshot_width": 1,
                "screenshot_height": 1,
                "capture_id": "c1",
            },
        }

    monkeypatch.setattr(computer, "_driver", spy)
    out = computer.act("principal", {"action": "click", "x": 10, "y": 20})
    assert out["ok"] is True and out["tool"] == "click"
    assert out["frame"] and out["frame"]["width"] == 1
    bot, args = calls[0]
    assert bot == "principal" and "click" in args
    payload = json.loads(args[args.index("--args") + 1])
    assert payload["x"] == 10 and payload["y"] == 20
    assert payload["scope"] == "desktop"
    assert payload["target"] == {"kind": "desktop", "display_id": "primary"}


def test_act_doubleclick_and_rightclick_variants(monkeypatch):
    seen = {}
    real = computer._driver

    def spy(bot_id, *args, **kw):
        tool = args[1] if len(args) > 1 else None
        if "--args" in args:
            seen.setdefault(tool, json.loads(args[args.index("--args") + 1]))
            return {"ok": True, "data": {"summary": "ok"}}
        return {
            "ok": True,
            "data": {
                "screenshot_png_b64": base64.b64encode(_PNG_1X1).decode(),
                "screenshot_width": 1,
                "screenshot_height": 1,
            },
        }

    monkeypatch.setattr(computer, "_driver", spy)
    computer.act("principal", {"action": "doubleClick", "x": 5, "y": 6})
    assert seen["click"]["count"] == 2
    seen.clear()
    computer.act("principal", {"action": "rightClick", "x": 5, "y": 6})
    assert seen["click"]["button"] == "right" and "count" not in seen["click"]
    computer.act("principal", {"action": "key", "key": "ctrl+c"})
    assert seen["hotkey"]["keys"] == ["ctrl", "c"]
    seen.clear()
    computer.act("principal", {"action": "key", "key": "Return"})
    assert seen["type_text"]["text"] == "\n"
    seen.clear()
    out = computer.act("principal", {"action": "key", "key": "F5"})
    assert out["ok"] is False and "not delivered" in out["reason"]
    computer.act("principal", {"action": "scroll", "x": 1, "y": 2, "amount": -3})
    assert seen["scroll"]["direction"] == "up"
    assert seen["scroll"]["amount"] == 3


def test_act_surfaces_driver_refusal(monkeypatch):
    real = computer._driver

    def spy(bot_id, *args, **kw):
        if "--args" in args:
            return {
                "ok": True,
                "data": {"status": "refused", "refusal": {"code": "x", "message": "y"}},
            }
        return {"ok": True, "data": {}}

    monkeypatch.setattr(computer, "_driver", spy)
    out = computer.act("principal", {"action": "click", "x": 1, "y": 2})
    assert out["ok"] is False and "driver refused click: x: y" in out["reason"]


def test_act_propagates_driver_failure_without_fabricating(monkeypatch):
    real = computer._driver

    def spy(bot_id, *args, **kw):
        if "--args" in args:
            return {"ok": False, "state": "no-driver", "reason": "socket gone"}
        return {"ok": True, "data": {}}

    monkeypatch.setattr(computer, "_driver", spy)
    out = computer.act("principal", {"action": "click", "x": 1, "y": 2})
    assert out["ok"] is False and out["state"] == "no-driver"
    assert "socket gone" in out["reason"]


# ── launch action: a KNOWN app id maps to a FIXED argv, never a command line ──
def _png_driver(bot_id, *args, **kw):
    """Driver that satisfies the post-launch frame re-capture."""
    return {
        "ok": True,
        "data": {
            "screenshot_png_b64": base64.b64encode(_PNG_1X1).decode(),
            "screenshot_width": 1,
            "screenshot_height": 1,
        },
    }


def test_act_launch_rejects_missing_and_unknown_app(monkeypatch):
    monkeypatch.setattr(computer.time, "sleep", lambda *_: None)
    out = computer.act("principal", {"action": "launch"})
    assert out["ok"] is False and "app id" in out["reason"]
    # arbitrary executables are NOT in the registry — this must stay a refusal.
    out = computer.act("principal", {"action": "launch", "app": "bash"})
    assert out["ok"] is False and "unknown app" in out["reason"]
    assert "chrome" in out["reason"]
    out = computer.act("principal", {"action": "launch", "app": 42})
    assert out["ok"] is False


def test_act_launch_missing_binary_is_honest(monkeypatch):
    monkeypatch.setattr(computer.time, "sleep", lambda *_: None)
    monkeypatch.setattr(computer, "LAUNCH_APPS", {"chrome": ["/does/not/exist"]})
    out = computer.act("principal", {"action": "launch", "app": "chrome"})
    assert out["ok"] is False and "not installed" in out["reason"]


def test_act_launch_starts_chrome_on_the_display(monkeypatch, tmp_path):
    calls = []

    class FakeProc:
        def poll(self):
            return None

    def fake_popen(argv, **kw):
        calls.append((argv, kw))
        return FakeProc()

    chrome = tmp_path / "google-chrome"
    chrome.write_text("")
    monkeypatch.setattr(computer.time, "sleep", lambda *_: None)
    monkeypatch.setattr(
        computer,
        "LAUNCH_APPS",
        {"chrome": [str(chrome), "--no-sandbox", "--start-maximized"]},
    )
    monkeypatch.setattr(computer, "_process_running", lambda bot_id: False)
    monkeypatch.setattr(computer, "_driver", _png_driver)
    monkeypatch.setattr(computer.subprocess, "Popen", fake_popen)
    out = computer.act("principal", {"action": "launch", "app": "chrome"})
    assert out["ok"] is True and out["tool"] == "launch"
    argv, kw = calls[0]
    assert argv[0] == str(chrome)
    assert "--no-sandbox" in argv
    assert "--start-maximized" in argv
    assert "--user-data-dir=/tmp/chrome-principal" in argv
    assert kw["env"]["DISPLAY"] == ":1"
    assert out["frame"] and out["frame"]["width"] == 1


def test_act_launch_is_idempotent_when_already_running(monkeypatch, tmp_path):
    popen_calls = []

    class FakeProc:
        def poll(self):
            return None

    def fake_popen(argv, **kw):
        popen_calls.append(argv)
        return FakeProc()

    chrome = tmp_path / "google-chrome"
    chrome.write_text("")
    state = {"running": False}
    monkeypatch.setattr(computer.time, "sleep", lambda *_: None)
    monkeypatch.setattr(computer, "LAUNCH_APPS", {"chrome": [str(chrome)]})
    monkeypatch.setattr(computer, "_process_running", lambda bot_id: state["running"])
    monkeypatch.setattr(computer, "_driver", _png_driver)
    monkeypatch.setattr(computer.subprocess, "Popen", fake_popen)

    out1 = computer.act("principal", {"action": "launch", "app": "chrome"})
    assert out1["ok"] is True and "launched chrome" in out1["applied"]
    assert len(popen_calls) == 1

    state["running"] = True
    out2 = computer.act("principal", {"action": "launch", "app": "chrome"})
    assert out2["ok"] is True
    assert "already running" in out2["applied"]
    assert len(popen_calls) == 1  # no duplicate spawn on the second click


def test_act_launch_reports_immediate_exit(monkeypatch, tmp_path):
    class FakeProc:
        returncode = 1

        def poll(self):
            return 1

    chrome = tmp_path / "google-chrome"
    chrome.write_text("")
    monkeypatch.setattr(computer.time, "sleep", lambda *_: None)
    monkeypatch.setattr(computer, "LAUNCH_APPS", {"chrome": [str(chrome)]})
    monkeypatch.setattr(computer, "_process_running", lambda bot_id: False)
    monkeypatch.setattr(computer.subprocess, "Popen", lambda argv, **kw: FakeProc())
    out = computer.act("principal", {"action": "launch", "app": "chrome"})
    assert out["ok"] is False and "exited immediately" in out["reason"]


def test_reset_runs_probe(monkeypatch):
    def fake_driver(bot_id, *args, **kw):
        return {"ok": True, "data": {"width": 1920, "height": 1080}}

    monkeypatch.setattr(computer, "_driver", fake_driver)
    out = computer.reset("principal")
    assert out["ok"] is True
    assert out["state"] == "ready"
    assert "principal" in out["message"]


def test_computer_endpoints_support_dynamic_fleet(monkeypatch):
    from fastapi.testclient import TestClient
    from ui import server

    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    meta = {
        "principal": {"name": "Principal"},
        "governor": {"name": "Governor"},
        "scout": {"name": "Scout", "title": "Scout Bot"},
    }
    monkeypatch.setattr(server, "_all_bot_meta", lambda: meta)

    calls = []

    def fake_computer_run(cmd, timeout=30.0):
        calls.append(cmd)
        return {
            "ok": True,
            "state": "ready",
            "b64": "fake",
            "width": 100,
            "height": 100,
            "capturedAt": "now",
            "mime": "image/png",
            "message": "reset ok",
        }

    monkeypatch.setattr(server, "_computer_run", fake_computer_run)

    client = TestClient(server.app)
    client.headers.update({"Authorization": "Basic YWxpOnB3"})

    # 1. GET /api/computer/scout/frame
    resp = client.get("/api/computer/scout/frame")
    assert resp.status_code == 200
    assert resp.json().get("reason") != "no bot named 'scout' in this fleet"
    assert resp.json().get("available") is True

    # 2. POST /api/computer/scout/action
    resp = client.post(
        "/api/computer/scout/action", json={"action": "click", "x": 10, "y": 10}
    )
    assert resp.status_code == 200
    assert resp.json().get("reason") != "no bot named 'scout' in this fleet"
    assert resp.json().get("available") is True

    # 3. POST /api/computer/scout/reset
    resp = client.post("/api/computer/scout/reset")
    assert resp.status_code == 200
    assert resp.json().get("reason") != "no bot named 'scout' in this fleet"
    assert resp.json().get("available") is True
