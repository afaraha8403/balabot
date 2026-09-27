"""Sub-agent reader for the BalaBot UI — the truth about live spawn state.

TRUTH (verified by inspecting the running container `balabot-balabot-1`):

  /opt/data/spawn-ledger.json exists (364 bytes) and holds a JSON array of
  spawn records: {pid, create_time, purpose, install, spawner_pid,
  spawner_create, registered_at, argv, host, port, profile}. Hermes writes a
  record when it spawns a long-lived child process (e.g. the dashboard was
  the only entry: `hermes dashboard --host 0.0.0.0 --port 9119 --no-open`).

  There is NO sub-agent tree beyond this ledger. gateway_state.json reports
  `active_agents: 0` / `active_work: null`, and /opt/data/runtime/
  active_sessions.json holds only the CLI lease — neither names sub-agents.

So this module reads the spawn ledger plus /proc liveness inside the container
(a ledger entry is only a "live sub-agent" if its pid is actually running),
maps each record to a parent profile via its `profile` / argv fields, and
returns honest rows: {parent, id, title, status, startedAt}. When nothing is
spawned (or the container is unreachable) it returns an empty list plus a
reason string — it never invents rows.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import time

CONTAINER = "balabot-balabot-1"
LEDGER_PATH = "/opt/data/spawn-ledger.json"

PROFILES = ("principal", "governor", "chief-of-staff", "default")


def _docker_exec(script: str, timeout: float = 15.0) -> str | None:
    """Run a shell snippet inside the container; None on any failure."""
    try:
        r = subprocess.run(
            ["docker", "exec", CONTAINER, "sh", "-c", script],
            capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            return None
        return r.stdout
    except Exception:
        return None


def _parent_of(entry: dict) -> str:
    """Best-effort parent attribution, strictly from the record itself."""
    profile = entry.get("profile") or ""
    if profile in PROFILES:
        return profile
    argv = str(entry.get("argv") or "")
    for p in PROFILES:
        if p in argv:
            return p
    return "main-hermes"  # spawned by the top-level Hermes process


def read_subagents() -> dict:
    """Read real spawn state. Honest contract:

    returns {"available": bool, "reason": str|None, "subagents": [row...]}
    where each row is {parent, id, title, status, startedAt} (ISO string) —
    or an EMPTY list with a reason when there is genuinely nothing running.
    """
    if _docker_exec("true") is None:
        return {"available": False,
                "reason": "balabot container is not running — no spawn data",
                "subagents": []}

    out = _docker_exec(
        "python3 - <<'PY'\n"
        "import json, os, pathlib\n"
        "p = pathlib.Path('" + LEDGER_PATH + "')\n"
        "rows = json.loads(p.read_text()) if p.is_file() else []\n"
        "live = []\n"
        "for e in rows:\n"
        "    pid = e.get('pid')\n"
        "    running = False\n"
        "    if pid:\n"
        "        try:\n"
        "            os.kill(int(pid), 0)\n"
        "            running = True\n"
        "        except (ProcessLookupError, PermissionError, ValueError):\n"
        "            running = False\n"
        "    if running:\n"
        "        live.append(e)\n"
        "print(json.dumps(live))\n"
        "PY", timeout=20.0)
    if out is None:
        return {"available": False,
                "reason": f"could not read {LEDGER_PATH} inside the container",
                "subagents": []}
    try:
        live = json.loads(out.strip().splitlines()[-1])
    except Exception:
        return {"available": False,
                "reason": "spawn ledger parse failed inside the container",
                "subagents": []}

    if not live:
        return {"available": True,
                "reason": ("the spawn ledger has no live entries — no "
                           "sub-agents are running right now"),
                "subagents": []}

    now = time.time()
    subagents = []
    for e in live:
        started = e.get("registered_at") or e.get("create_time") or now
        age_s = max(0, int(now - float(started)))
        if age_s >= 86400:
            age = f"{age_s // 86400}d {age_s % 86400 // 3600}h"
        elif age_s >= 3600:
            age = f"{age_s // 3600}h {age_s % 3600 // 60}m"
        else:
            age = f"{age_s // 60}m"
        subagents.append({
            "parent": _parent_of(e),
            "id": f"spawn-{e.get('pid')}",
            "title": str(e.get("purpose") or "spawned process"),
            "status": "live",
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(started))),
            "age": age,
            "pid": e.get("pid"),
        })
    return {"available": True, "reason": None, "subagents": subagents}
