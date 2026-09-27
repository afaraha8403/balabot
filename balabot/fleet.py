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
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

__all__ = [
    "FleetError",
    "FleetManifest",
    "fleet_dir",
    "load",
    "agents",
    "for_agent",
]

VERSION = 1

_DISPLAY_RE = re.compile(r"^:\d+$")


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
                raise FleetError(f"{path}: agent {agent_id!r} has invalid display {display!r} (want ':N')")
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
        known = sorted(p.stem for p in fleet_dir().glob("*.json")) if fleet_dir().exists() else []
        raise FleetError(f"no fleet manifest for org {org!r} (known orgs: {known or 'none'})")
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
        raise FleetError(f"agent {agent_id!r} is not declared in org {org!r}'s manifest (known: {known})")
    return dict(manifest.agents[agent_id])
