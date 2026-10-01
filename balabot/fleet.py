"""Per-org agent-computer fleet resolver.

Each organization gets its own agent computer space — its own container,
displays, driver sockets and workspaces (see
kb/plans/org-secrets-and-skills.md, "Computer spaces per org"). The space is
described by a manifest at ``fleet/<org>.json``:

    {
      "version": 1,
      "org": "balacode",
      "container": "agent-computer-balacode",
      "agents": [
        {"id": "principal", "display": ":1", "socket": "/run/cua-driver/principal.sock"},
        {"id": "governor",  "display": ":2", "socket": "/run/cua-driver/governor.sock"}
      ]
    }

Isolation between orgs is structural: an org's agents only ever resolve into
their own manifest. A cross-org grant is the only sanctioned path from one org
to another's machine — and this resolver never performs one implicitly.

Resolution rules (honest failure, never a guessed default):
- Unknown org, unknown agent, or a malformed manifest raises FleetError.
- Displays and sockets are validated (":N" and an absolute path) so a typo
  cannot silently cross two agents onto one display.
- Duplicate display numbers or socket paths *within* one manifest are refused.

Runtime display allocation (W7-6 / W7-14) is layered on top of the manifests:
- An org may hold at most `display_cap()` concurrent displays (default 5).
- Only a *named persistent agent* — one declared in the org's manifest — may
  hold a display. A sub-agent is a short-lived, unnamed job, so a display
  request for an id the manifest does not declare is refused with the policy
  reason and consumes no cap slot.
- When a named persistent agent requests a display at the cap, the
  least-recently-used allocation is evicted and recorded before the request
  is granted. An eviction with no record never happens.
- The whole allocation state (per org: allocations, evictions, cap) is exposed
  by `displays_state` so it can be queried over HTTP.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

__all__ = [
    "FleetError",
    "FleetManifest",
    "fleet_dir",
    "load",
    "agents",
    "for_agent",
    "display_cap",
    "display_pool_base",
    "displays_db",
    "displays_state",
    "allocate_display",
]

VERSION = 1

_DISPLAY_RE = re.compile(r"^:\d+$")

# W7-6: the default ceiling on concurrent displays per org. Named here (not
# inlined) so the cap is one fact a reader can find, and overridable from the
# environment for a deployment that needs a different ceiling.
DISPLAY_CAP_DEFAULT = 5
_DISPLAY_CAP_ENV = "BALABOT_DISPLAY_CAP"
_DISPLAYS_DB_ENV = "BALABOT_DISPLAYS_DB"
_DISPLAY_POOL_BASE_ENV = "BALABOT_DISPLAY_POOL_BASE"

# Serialises the read-modify-write of the allocation state file so two
# concurrent requests cannot both read the same LRU and lose an eviction.
_state_lock = threading.Lock()


class FleetError(Exception):
    """A manifest is missing, malformed, or asks for an unknown org/agent."""


class FleetManifest:
    """A validated per-org computer-space manifest."""

    __slots__ = ("org", "container", "agents", "_path")

    def __init__(self, data: dict, path: Path):
        if not isinstance(data, dict):
            raise FleetError(f"{path}: manifest must be a JSON object")
        version = data.get("version", VERSION)
        if version != VERSION:
            raise FleetError(f"{path}: unsupported manifest version {version!r}")
        org = data.get("org")
        if not isinstance(org, str) or not org.strip():
            raise FleetError(f"{path}: missing/invalid 'org'")
        if org != path.stem:
            raise FleetError(
                f"{path}: manifest 'org' ({org!r}) does not match filename ({path.stem!r})"
            )
        container = data.get("container")
        if not isinstance(container, str) or not container.strip():
            raise FleetError(f"{path}: missing/invalid 'container'")
        raw_agents = data.get("agents")
        if not isinstance(raw_agents, list) or not raw_agents:
            raise FleetError(f"{path}: 'agents' must be a non-empty list")

        agents: dict[str, dict[str, str]] = {}
        seen_displays: dict[str, str] = {}
        seen_sockets: dict[str, str] = {}
        for entry in raw_agents:
            if not isinstance(entry, dict):
                raise FleetError(f"{path}: each agent must be a JSON object")
            agent_id = entry.get("id")
            display = entry.get("display")
            socket = entry.get("socket")
            if not isinstance(agent_id, str) or not agent_id.strip():
                raise FleetError(f"{path}: agent entry missing valid 'id'")
            if agent_id in agents:
                raise FleetError(f"{path}: duplicate agent id {agent_id!r}")
            if not isinstance(display, str) or not _DISPLAY_RE.match(display):
                raise FleetError(
                    f"{path}: agent {agent_id!r} has invalid display {display!r} (want ':N')"
                )
            if not isinstance(socket, str) or not socket.startswith("/"):
                raise FleetError(
                    f"{path}: agent {agent_id!r} has invalid socket {socket!r} (want absolute path)"
                )
            if display in seen_displays:
                raise FleetError(
                    f"{path}: agents {seen_displays[display]!r} and {agent_id!r} share display {display}"
                )
            if socket in seen_sockets:
                raise FleetError(
                    f"{path}: agents {seen_sockets[socket]!r} and {agent_id!r} share socket {socket}"
                )
            agents[agent_id] = {"id": agent_id, "display": display, "socket": socket}
            seen_displays[display] = agent_id
            seen_sockets[socket] = agent_id

        self.org = org
        self.container = container
        self.agents = agents
        self._path = path

    @classmethod
    def from_file(cls, path: Path) -> "FleetManifest":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise FleetError(f"fleet manifest not found: {path}") from exc
        except json.JSONDecodeError as exc:
            raise FleetError(f"{path}: invalid JSON ({exc})") from exc
        return cls(data, path)


def fleet_dir() -> Path:
    """Where manifests live: <repo root>/fleet, overridable for tests."""
    override = os.environ.get("BALABOT_FLEET_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "fleet"


def load(org: str) -> FleetManifest:
    """Load + validate the manifest for *org*. Unknown org raises FleetError."""
    if not isinstance(org, str) or not org.strip():
        raise FleetError("org id must be a non-empty string")
    if "/" in org or "\\" in org or org in (".", ".."):
        raise FleetError(f"invalid org id {org!r}")
    path = fleet_dir() / f"{org}.json"
    if not path.exists():
        known = (
            sorted(p.stem for p in fleet_dir().glob("*.json"))
            if fleet_dir().exists()
            else []
        )
        raise FleetError(
            f"no fleet manifest for org {org!r} (known orgs: {known or 'none'})"
        )
    return FleetManifest.from_file(path)


def agents(org: str) -> list[dict[str, str]]:
    """All declared agents for *org*, in manifest order."""
    return [dict(entry) for entry in load(org).agents.values()]


def for_agent(agent_id: str, org: str) -> dict[str, str]:
    """Resolve (display, socket) for *agent_id* within *org*'s computer space.

    Returns a copy of the agent entry. Unknown agent/org raises FleetError —
    this function never guesses a default.
    """
    manifest = load(org)
    if agent_id not in manifest.agents:
        known = sorted(manifest.agents)
        raise FleetError(
            f"agent {agent_id!r} is not declared in org {org!r}'s manifest (known: {known})"
        )
    return dict(manifest.agents[agent_id])


# ── runtime display allocation (W7-6 cap/eviction, W7-14 sub-agent policy) ───


def display_cap() -> int:
    """Concurrent-display ceiling for one org. Defaults to DISPLAY_CAP_DEFAULT.

    Reads `BALABOT_DISPLAY_CAP`; a non-integer or a value below 1 raises
    FleetError rather than silently accepting a nonsensical cap.
    """
    raw = os.environ.get(_DISPLAY_CAP_ENV, "").strip()
    if not raw:
        return DISPLAY_CAP_DEFAULT
    try:
        cap = int(raw)
    except ValueError as exc:
        raise FleetError(f"{_DISPLAY_CAP_ENV} must be an integer, got {raw!r}") from exc
    if cap < 1:
        raise FleetError(f"{_DISPLAY_CAP_ENV} must be >= 1, got {cap}")
    return cap


def display_pool_base() -> int:
    """First display number the allocator hands out (":<base>"). Default 1."""
    raw = os.environ.get(_DISPLAY_POOL_BASE_ENV, "").strip()
    if not raw:
        return 1
    try:
        base = int(raw)
    except ValueError as exc:
        raise FleetError(
            f"{_DISPLAY_POOL_BASE_ENV} must be an integer, got {raw!r}"
        ) from exc
    if base < 0:
        raise FleetError(f"{_DISPLAY_POOL_BASE_ENV} must be >= 0, got {base}")
    return base


def displays_db() -> Path:
    """Where display-allocation state lives; overridable for tests/ops."""
    override = os.environ.get(_DISPLAYS_DB_ENV)
    if override:
        return Path(override)
    root = os.environ.get("BALABOT_DATA_ROOT", "/opt/data")
    return Path(root) / "displays.json"


def _read_state() -> dict:
    path = displays_db()
    if not path.exists():
        return {"orgs": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FleetError(f"display state {path} is unreadable: {exc}") from exc
    if not isinstance(data, dict):
        raise FleetError(f"display state {path} is not a JSON object")
    data.setdefault("orgs", {})
    return data


def _write_state(data: dict) -> None:
    path = displays_db()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write-then-rename: a crash mid-write can never leave a half file that
    # loses every org's allocations.
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def _empty_bucket() -> dict:
    return {"next_seq": 1, "allocations": {}, "evictions": []}


def _bucket(data: dict, org: str) -> dict:
    bucket = data["orgs"].setdefault(org, _empty_bucket())
    bucket.setdefault("next_seq", 1)
    bucket.setdefault("allocations", {})
    bucket.setdefault("evictions", [])
    return bucket


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def displays_state(org: str) -> dict:
    """The queryable allocation state for *org*: cap, allocations, evictions.

    Raises FleetError for an unknown org (no manifest) so the caller can
    answer `unavailable` rather than fabricating an empty state.
    """
    load(org)
    cap = display_cap()
    with _state_lock:
        data = _read_state()
        bucket = data["orgs"].get(org) or _empty_bucket()
    allocations = sorted(
        bucket["allocations"].values(), key=lambda a: a.get("last_used_seq", 0)
    )
    return {
        "org": org,
        "cap": cap,
        "count": len(bucket["allocations"]),
        "allocations": [
            {
                "display": a["display"],
                "agent": a["agent"],
                "allocated_at": a.get("allocated_at"),
                "last_used_at": a.get("last_used_at"),
            }
            for a in allocations
        ],
        "evictions": list(bucket["evictions"]),
    }


def allocate_display(org: str, agent_id: str) -> dict:
    """Grant *agent_id* a display in *org*, evicting the LRU at the cap.

    Contract:
    - Only a named persistent agent (declared in the org's manifest) is
      eligible. Any other id is a sub-agent job and is refused, consuming no
      cap slot (W7-14).
    - At the cap, the least-recently-used allocation is evicted and an
      eviction record (who was evicted, by whom, why, when) is stored before
      the request is granted. Eviction is never silent (W7-6).
    - Re-requesting the same agent refreshes its recency and returns the same
      display (idempotent touch).

    Returns a JSON-able dict. An unknown org raises FleetError.
    """
    manifest = load(org)
    if not isinstance(agent_id, str) or not agent_id.strip():
        raise FleetError("agent id must be a non-empty string")
    agent_id = agent_id.strip()
    cap = display_cap()

    if agent_id not in manifest.agents:
        return {
            "ok": True,
            "available": True,
            "granted": False,
            "refused": True,
            "state": "refused",
            "org": org,
            "agent": agent_id,
            "cap": cap,
            "reason": (
                "sub-agents do not receive displays — a display is allocated "
                "only to a named persistent agent declared in the org's "
                f"computer-space manifest; {agent_id!r} is not a declared "
                f"agent of org {org!r}"
            ),
        }

    with _state_lock:
        data = _read_state()
        bucket = _bucket(data, org)
        seq = bucket["next_seq"]
        now = _now()

        existing = bucket["allocations"].get(agent_id)
        if existing is not None:
            existing["last_used_seq"] = seq
            existing["last_used_at"] = now
            bucket["next_seq"] = seq + 1
            _write_state(data)
            return {
                "ok": True,
                "available": True,
                "granted": True,
                "refused": False,
                "org": org,
                "agent": agent_id,
                "display": existing["display"],
                "evicted": None,
                "cap": cap,
                "count": len(bucket["allocations"]),
            }

        used = {a["display"] for a in bucket["allocations"].values()}
        base = display_pool_base()
        slot = None
        for n in range(base, base + cap):
            candidate = f":{n}"
            if candidate not in used:
                slot = candidate
                break

        evicted = None
        if slot is None:
            lru_agent, lru = min(
                bucket["allocations"].items(),
                key=lambda kv: kv[1].get("last_used_seq", 0),
            )
            slot = lru["display"]
            evicted = {
                "display": slot,
                "evicted_agent": lru_agent,
                "requested_by": agent_id,
                "reason": (
                    f"display cap ({cap}) reached — least-recently-used "
                    f"display evicted for {agent_id!r}"
                ),
                "at": now,
            }
            bucket["evictions"].append(evicted)
            del bucket["allocations"][lru_agent]

        bucket["allocations"][agent_id] = {
            "display": slot,
            "agent": agent_id,
            "allocated_at": now,
            "last_used_at": now,
            "last_used_seq": seq,
        }
        bucket["next_seq"] = seq + 1
        _write_state(data)

    return {
        "ok": True,
        "available": True,
        "granted": True,
        "refused": False,
        "org": org,
        "agent": agent_id,
        "display": slot,
        "evicted": evicted,
        "cap": cap,
        "count": len(bucket["allocations"]),
    }
