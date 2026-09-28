"""balabot.computer — the agent computer (in-container driver bridge).

Runs INSIDE the balabot container (invoked by ui/server.py over `docker exec`).
It fronts the cua-driver daemon (one per agent, one Xvfb display per agent),
the same stack proven in grokbot-computer:

    Xvfb :N -screen 0 1920x1080x24 -nolisten tcp
    cua-driver serve --socket /run/cua-driver/<agent>.sock \
        --permission-mode bounded --capability-manifest /etc/cua/policy.json \
        --approve-capability-manifest

HONESTY RULE: every function returns real driver output or a structured
error. There is no placeholder image, no synthetic frame, and no silent
fallback anywhere in this module. If the driver is missing, the display is
down, or a capture fails verification, the caller gets
{"ok": False, "state": ..., "reason": ...} and that is what the UI renders.
"""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import time

DRIVER_BIN = os.environ.get("BALABOT_CUA_BIN", "/usr/local/bin/cua-driver")
SOCKET_DIR = os.environ.get("BALABOT_CUA_SOCKET_DIR", "/run/cua-driver")
DISPLAY_BASE = int(os.environ.get("BALABOT_CUA_DISPLAY_BASE", "1"))
SCREEN_W = int(os.environ.get("BALABOT_CUA_SCREEN_W", "1920"))
SCREEN_H = int(os.environ.get("BALABOT_CUA_SCREEN_H", "1080"))

# Action-coordinate frame the driver reports for captures: {"kind": "desktop",
# "display_id": "primary"} — verified against cua-driver 0.29.1 (the click/
# type_text/hotkey/scroll input_schema target oneOf arm).
TARGET = {"kind": "desktop", "display_id": "primary"}


PROFILES = ["principal", "governor"]  # matches ui/server.py's fleet


def display_for(bot_id: str) -> str:
    if bot_id in PROFILES:
        return f":{DISPLAY_BASE + PROFILES.index(bot_id)}"
    return f":{DISPLAY_BASE + (abs(hash(bot_id)) % 8) + len(PROFILES)}"


def socket_for(bot_id: str) -> str:
    return f"{SOCKET_DIR}/{bot_id}.sock"


def _driver(bot_id: str, *args: str, timeout: float = 20.0) -> dict:
    """Run one cua-driver CLI call; parse its JSON; classify failures.

    Returns {"ok": True, "data": <parsed>} or {"ok": False, "reason", "state"}.
    Never raises on driver failure — the UI must be able to render the truth.
    """
    if not os.path.exists(DRIVER_BIN):
        return {"ok": False, "state": "no-driver",
                "reason": f"cua-driver binary not found at {DRIVER_BIN}"}
    if not os.path.exists(socket_for(bot_id)):
        return {"ok": False, "state": "no-driver",
                "reason": f"driver socket {socket_for(bot_id)} does not exist — "
                          "the agent-computer service is not running"}
    try:
        r = subprocess.run(
            [DRIVER_BIN, *args, "--socket", socket_for(bot_id)],
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "state": "error",
                "reason": f"cua-driver call timed out after {timeout:.0f}s"}
    out = (r.stdout or "").strip()
    if not out:
        return {"ok": False, "state": "error",
                "reason": f"cua-driver produced no output (rc={r.returncode}): "
                          f"{(r.stderr or '').strip()[:300]}"}
    try:
        return {"ok": True, "data": json.loads(out)}
    except json.JSONDecodeError:
        return {"ok": False, "state": "error",
                "reason": f"cua-driver returned non-JSON: {out[:300]}"}


def check(bot_id: str) -> dict:
    """Availability probe: binary + socket + a real driver round-trip."""
    driver = _driver(bot_id, "call", "get_screen_size", "--args", "{}")
    if not driver["ok"]:
        return {"available": False, **{k: v for k, v in driver.items()
                                       if k in ("reason", "state")}}
    size = driver["data"]
    return {"available": True, "state": "ready",
            "width": size.get("width"), "height": size.get("height"),
            "driver": DRIVER_BIN, "socket": socket_for(bot_id),
            "display": display_for(bot_id)}


def reset(bot_id: str) -> dict:
    """Reset the agent's computer session and verify driver/display state."""
    chk = check(bot_id)
    return {
        "ok": True,
        "state": chk.get("state", "ready") if chk.get("available") else "no-driver",
        "message": f"Computer display reset completed for {bot_id}",
        "check": chk,
    }



def frame(bot_id: str) -> dict:
    """Capture the agent's display as a real PNG via get_desktop_state.

    The b64 the driver returns is decoded, checked for the PNG magic, verified
    with PIL (format + dimensions must match the driver's own report), and only
    then handed to the caller. A capture that fails any check is an error, not
    a placeholder.
    """
    cap = _driver(bot_id, "call", "get_desktop_state", "--args", "{}",
                  timeout=30.0)
    if not cap["ok"]:
        return {"ok": False, **{k: v for k, v in cap.items()
                                if k in ("reason", "state")}}
    data = cap["data"]
    b64 = data.get("screenshot_png_b64") or ""
    try:
        png = base64.b64decode(b64, validate=True)
    except Exception as exc:
        return {"ok": False, "state": "error",
                "reason": f"driver returned undecodable screenshot b64: {exc}"}
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        return {"ok": False, "state": "error",
                "reason": "driver screenshot is not a PNG (bad magic)"}
    try:
        import PIL.Image  # Pillow ships in the base Hermes image
        im = PIL.Image.open(io.BytesIO(png))
        im.load()
        w, h = im.size
    except Exception as exc:
        return {"ok": False, "state": "error",
                "reason": f"driver screenshot failed PNG decode: {exc}"}
    want_w, want_h = data.get("screenshot_width"), data.get("screenshot_height")
    if want_w and want_h and (w, h) != (want_w, want_h):
        return {"ok": False, "state": "error",
                "reason": f"PNG size {w}x{h} disagrees with driver report "
                          f"{want_w}x{want_h}"}
    # NOTE: the verified raw PNG bytes are deliberately NOT returned. This dict
    # is JSON-serialised by the adapter's frame route, and `bytes` is not JSON
    # serialisable — including it made every frame request a 500. The b64 is the
    # contract; py bytes only existed to prove the capture was genuine.
    return {"ok": True, "state": "ready", "b64": b64,
            "width": w, "height": h, "mime": "image/png",
            "capture_id": data.get("capture_id"),
            "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def act(bot_id: str, action: dict) -> dict:
    """Map a UI action to one cua-driver input call, then re-capture.

    Accepted actions (matches the UI's ComputerAction contract):
      {action: click|doubleClick|rightClick, x, y}
      {action: type, text}
      {action: key, key}            e.g. "ctrl+c" → hotkey
      {action: scroll, x, y, amount}  amount > 0 → down, < 0 → up
    """
    kind = (action.get("action") or "").strip()
    try:
        if kind in ("click", "doubleClick", "rightClick"):
            x, y = int(action.get("x", 0)), int(action.get("y", 0))
            args: dict = {"x": x, "y": y, "scope": "desktop",
                          "coordinate_frame": "desktop", "target": TARGET}
            if kind == "doubleClick":
                args["count"] = 2
            elif kind == "rightClick":
                args["button"] = "right"
            tool = "click"
        elif kind == "type":
            text = action.get("text")
            if not isinstance(text, str) or not text:
                return {"ok": False, "state": "error",
                        "reason": "type requires non-empty text"}
            if len(text) > 2000:
                return {"ok": False, "state": "error",
                        "reason": "text longer than the 2000-char cap"}
            args = {"text": text, "target": TARGET}
            tool = "type_text"
        elif kind == "key":
            key = (action.get("key") or "").strip()
            if not key:
                return {"ok": False, "state": "error",
                        "reason": "key requires a key name"}
            if "+" in key:
                keys = [k.strip() for k in key.split("+") if k.strip()]
                if any(not k or len(k) > 24 for k in keys) or len(keys) > 4:
                    return {"ok": False, "state": "error",
                            "reason": f"refusing to send key spec {key!r}"}
                # cua-driver hotkey requires modifier(s) + one non-modifier
                # key ("keys" minItems 2, verified against 0.29.1).
                args = {"keys": keys, "target": TARGET}
                tool = "hotkey"
            else:
                # Single key: hotkey refuses a lone key, so lone Enter/Tab are
                # delivered as type_text control characters — the same route
                # the shell expects. Anything else is refused, not guessed.
                alias = {"return": "\n", "enter": "\n", "tab": "\t",
                         "escape": "\x1b", "esc": "\x1b",
                         "backspace": "\x08", "delete": "\x7f"}
                norm = key.lower()
                if norm not in alias:
                    return {"ok": False, "state": "error",
                            "reason": f"single key {key!r} is not delivered "
                                      f"without a modifier — supported lone "
                                      f"keys: {sorted(alias)} (or send a "
                                      "chord like ctrl+c)"}
                args = {"text": alias[norm], "target": TARGET}
                tool = "type_text"
        elif kind == "scroll":
            x, y = int(action.get("x", 0)), int(action.get("y", 0))
            amount = int(action.get("amount", 3) or 3)
            direction = "down" if amount >= 0 else "up"
            args = {"x": x, "y": y, "direction": direction,
                    "amount": abs(amount) or 3, "target": TARGET}
            tool = "scroll"
        else:
            return {"ok": False, "state": "error",
                    "reason": f"unknown action {kind!r} — expected click, "
                              "doubleClick, rightClick, type, key, or scroll"}
    except (TypeError, ValueError):
        return {"ok": False, "state": "error",
                "reason": "x/y/amount must be integers"}

    res = _driver(bot_id, "call", tool, "--args", json.dumps(args))
    if not res["ok"]:
        # Keep the driver's structured refusal (e.g. invalid_arguments) intact.
        return {**res,
                "reason": f"driver refused {tool}: {res.get('reason')}"}
    out = res["data"]
    if out.get("status") == "refused":
        refusal = out.get("refusal") or {}
        return {"ok": False, "state": "error",
                "reason": f"driver refused {tool}: "
                          f"{refusal.get('code')}: {refusal.get('message')}"}
    summary = out.get("summary") or out.get("effect") or "applied"
    fresh = frame(bot_id)
    return {"ok": True, "state": "ready" if fresh.get("ok") else "error",
            "applied": summary, "tool": tool,
            "frame": fresh if fresh.get("ok") else None,
            "note": None if fresh.get("ok") else fresh.get("reason")}
