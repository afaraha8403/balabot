"""Agent lifecycle: orphan classification, adoption, purge, roster edit/delete.

Taxonomy (binding):
- SHIPPED/LOCKED = bootstrap.PERSONAS ('principal', 'governor'). Pinned souls;
  never editable, never deletable. Any attempt is refused.
- PERSISTENT USER-CREATED = everything else with a roster row; named,
  long-lived, editable and deletable.
- SUB-AGENTS = never named, never long-lived — spawn-ledger processes, not
  profiles. A profile with no roster row is an ORPHAN: with a SOUL.md and/or
  config.yaml it is an 'orphan-profile' (adopt-or-purge); with neither it is a
  'subagent-artifact' (debris, reapable).

State: the fleet roster at <BALABOT_DATA_ROOT>/fleet/bots.json — the SAME file
bot creation writes, so the roster has one owner-shaped file and one durability
model: 0600 tempfile + os.replace, same as bot_creation._save.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .bot_creation import CreationError, _now
from .bootstrap import PERSONAS

__all__ = [
    "CreationError",
    "classify_profile",
    "list_profiles_with_state",
    "list_orphans",
    "adopt_orphan",
    "purge_orphan",
    "reap_subagent_artifacts",
    "delete_registered_bot",
    "update_registered_bot",
]

SHIPPED: tuple[str, ...] = tuple(PERSONAS)
# The multiplexed Hermes runtime profile — never a product bot, never deletable.
# 'default' is Hermes' own legacy/system profile (its CLI ships with it); it is
# NOT an agent, so it is never classified as an orphan and never purgeable.
FORBIDDEN_NAMES: frozenset[str] = frozenset(SHIPPED) | {"default"}

SLUG_RE = re.compile(r"^[a-z0-9_-]+$")

EDITABLE_FIELDS = ("name", "title", "description", "icon", "color")


def _data_root() -> Path:
    return Path(os.environ.get("BALABOT_DATA_ROOT", "/opt/data"))


def _profiles_root() -> Path:
    return _data_root() / "profiles"


def _workspace_root() -> Path:
    return _data_root() / "workspace"


def _run_root() -> Path:
    return Path("/run/service")


def _fleet_path() -> Path:
    return _data_root() / "fleet" / "bots.json"


def _load_fleet() -> dict:
    p = _fleet_path()
    if not p.exists():
        return {"bots": []}
    data = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {"bots": []}
    data.setdefault("bots", [])
    return data


def _save_fleet(data: dict) -> None:
    """Atomic 0600 write — the same discipline as bot_creation._save."""
    p = _fleet_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".fleet-", suffix=".tmp")
    try:
        try:
            os.fchmod(fd, 0o600)
        except AttributeError:  # Windows
            pass
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _err(message: str, status: int) -> CreationError:
    """A CreationError that carries the HTTP status it should map to."""
    exc = CreationError(message)
    exc.status = status
    return exc


def _validate_name(name: str) -> Path:
    """Slug-validate BEFORE any path is touched. Everything purge/delete
    touches is derived from the profiles root + this name — a name that is
    not a slug can never name a legitimate profile, so it is refused."""
    if not name or not SLUG_RE.match(name):
        raise _err(f"invalid profile name {name!r}", 400)
    if name in FORBIDDEN_NAMES:
        raise _err(f"{name!r} is a shipped persona — it is never editable "
                   "or deletable", 409)
    return name


def _dir_size(path: Path) -> int:
    total = 0
    if path.is_dir():
        for p in path.rglob("*"):
            try:
                if p.is_file():
                    total += p.stat().st_size
            except OSError:
                continue
    return total


def _alias_path(name: str) -> Path:
    # Hermes' per-profile CLI alias lives under the data root's .local/bin.
    return _data_root() / ".local" / "bin" / name


def _cron_dir(name: str) -> Path:
    return _profiles_root() / name / "cron"


def _gateway_dir(name: str) -> Path:
    return _run_root() / f"gateway-{name}"


def _workspace_dir(name: str) -> Path:
    return _workspace_root() / name


def _org_member(name: str) -> bool:
    from . import orgs
    reg = orgs.load()
    for org in reg.get("orgs", {}).values():
        if name in (org.get("members") or []):
            return True
    return False


def _ref_state(name: str) -> dict:
    """Dangling-reference booleans for one profile. An orphan with any of
    these set re-materializes after deletion until the reference is removed
    (the gateway/cron profile set re-creates the empty dir)."""
    return {
        "hasAlias": _alias_path(name).exists(),
        "hasGatewayDir": _gateway_dir(name).exists(),
        "hasWorkspaceDir": _workspace_dir(name).exists(),
        "hasCronDir": _cron_dir(name).exists(),
        "orgMember": _org_member(name),
    }


def classify_profile(name: str) -> str:
    """'orphan-profile' when a SOUL.md and/or config.yaml exists, else
    'subagent-artifact' (an empty shell — spawn debris, reapable)."""
    d = _profiles_root() / name
    has_soul = (d / "SOUL.md").is_file()
    has_config = (d / "config.yaml").is_file()
    return "orphan-profile" if (has_soul or has_config) else "subagent-artifact"


def list_profiles_with_state() -> list[dict]:
    """Every profile dir under the profiles root, with its on-disk state."""
    rows: list[dict] = []
    root = _profiles_root()
    if not root.is_dir():
        return rows
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        name = d.name
        has_soul = (d / "SOUL.md").is_file()
        has_config = (d / "config.yaml").is_file()
        try:
            created = datetime.fromtimestamp(d.stat().st_mtime, timezone.utc)
            created_at = created.strftime("%Y-%m-%dT%H:%M:%SZ")
        except OSError:
            created_at = None
        rows.append({
            "id": name,
            "name": name,
            "path": str(d),
            "sizeBytes": _dir_size(d),
            "hasSoul": has_soul,
            "hasConfig": has_config,
            "gatewayRunning": _gateway_dir(name).exists(),
            "shape": classify_profile(name),
            "createdAt": created_at,
            **_ref_state(name),
        })
    return rows


def list_orphans() -> dict:
    """Profiles with NO roster row. Shipped personas are never orphans — they
    are reported separately so the UI can render the lock, not a gap."""
    fleet = _load_fleet()
    rostered = {row.get("id") for row in fleet.get("bots", [])
                if isinstance(row, dict) and row.get("id")}
    rostered |= {k for k in fleet.keys() if k != "bots"}
    profiles = [r for r in list_profiles_with_state()
                if r["id"] not in rostered and r["id"] not in FORBIDDEN_NAMES]
    return {
        "profiles": profiles,
        "shipped": list(SHIPPED),
        "rostered": sorted(rostered),
        "note": ("orphan-profile = a named agent soul nobody registered "
                 "(adopt or purge); subagent-artifact = spawn debris (reapable)."),
    }


def _roster_row(fleet: dict, bot_id: str) -> dict | None:
    row = fleet.get(bot_id)
    if isinstance(row, dict) and row.get("name"):
        return row
    for r in fleet.get("bots", []):
        if isinstance(r, dict) and r.get("id") == bot_id:
            return r
    return None


def adopt_orphan(name: str, *, fleet_bots: dict | None = None) -> dict:
    """Register an existing orphan profile as a persistent user-created bot."""
    _validate_name(name)
    profile_dir = _profiles_root() / name
    if not profile_dir.is_dir():
        raise _err(f"no profile named {name!r}", 404)
    if classify_profile(name) == "subagent-artifact":
        raise _err(f"profile {name!r} has no SOUL.md or config.yaml — it is "
                   "spawn debris, purge it instead of adopting", 409)
    fleet = fleet_bots if fleet_bots is not None else _load_fleet()
    if _roster_row(fleet, name) is not None:
        raise _err(f"a bot named {name!r} is already in the roster", 409)
    if fleet_bots is not None and name in fleet_bots:
        raise _err(f"a bot with id {name!r} already exists in the fleet", 409)
    meta = {
        "id": name,
        "name": name,
        "title": f"{name} — adopted orphan profile",
        "icon": "🧩",
        "color": "violet",
        "order": 999,
        "description": f"Adopted from the existing profile {name!r}.",
        "createdFrom": f"adopt:{name}",
        "createdBy": "user",
        "adoptedAt": _now(),
    }
    fleet[name] = meta
    fleet["bots"] = [r for r in fleet.get("bots", []) if r.get("id") != name]
    fleet["bots"].append(meta)
    _save_fleet(fleet)
    if fleet_bots is not None:
        fleet_bots[name] = meta
    return meta


def _remove_paths(name: str) -> list[str]:
    """Delete ONLY the product-owned trees + references for `name`. The
    whitelist is structural: each path is rebuilt from its root + the
    validated slug. Removing the profile dir alone is NOT a purge — the
    gateway/cron profile set re-materializes an empty dir ~20s later while a
    dangling reference (alias, gateway dir, workspace, cron, org membership)
    still names the profile. Every reference goes, or none of this counts."""
    removed: list[str] = []

    def rm(target: Path) -> None:
        if target.exists() or target.is_symlink():
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            else:
                target.unlink()
            removed.append(str(target))

    for base in (_profiles_root(), _workspace_root()):
        rm(base / name)
    rm(_alias_path(name))
    rm(_gateway_dir(name))
    rm(_cron_dir(name))
    if _org_member(name):
        if _remove_from_orgs(name):
            removed.append(f"org-membership:{name}")
    return removed


def _remove_from_orgs(bot_id: str) -> bool:
    """Drop bot_id from every org's member list. True if any membership was
    actually removed."""
    from . import orgs
    reg = orgs.load()
    changed = False
    for org in reg.get("orgs", {}).values():
        members = org.get("members") or []
        if bot_id in members:
            org["members"] = [m for m in members if m != bot_id]
            changed = True
    if changed:
        orgs.save(reg)
    return changed


def purge_orphan(name: str) -> dict:
    """Purge an orphan profile: profile dir, workspace, runtime gateway dir,
    alias, cron dir, and any roster row + org membership. Refuses shipped
    personas and the 'default' profile. IDEMPOTENT: a re-run on an already-
    purged name returns a clean empty result, not a crash — the profile set
    re-materialization makes "did I already delete this?" a normal state."""
    _validate_name(name)
    profile_dir = _profiles_root() / name
    fleet = _load_fleet()
    row = _roster_row(fleet, name)
    refs = _ref_state(name)
    if not profile_dir.is_dir() and not any(refs.values()) and row is None:
        return {"profile": name, "removed": [], "roster_row": False}
    removed = _remove_paths(name)
    fleet.pop(name, None)
    had_row = row is not None
    if had_row:
        fleet["bots"] = [r for r in fleet.get("bots", [])
                         if r.get("id") != name]
        _save_fleet(fleet)
    return {"profile": name, "removed": removed, "roster_row": had_row}


def reap_subagent_artifacts() -> dict:
    """Reap every empty-shell profile (no SOUL.md, no config.yaml)."""
    reaped: list[str] = []
    for row in list_profiles_with_state():
        if row["shape"] == "subagent-artifact" and row["id"] not in FORBIDDEN_NAMES:
            try:
                purge_orphan(row["id"])
                reaped.append(row["id"])
            except CreationError:
                continue
    return {"reaped": reaped, "count": len(reaped)}


def delete_registered_bot(bot_id: str, *, fleet_bots: dict | None = None) -> dict:
    """Delete a persistent user-created bot: roster row + profile + workspace +
    runtime gateway dir + org membership. Shipped personas are refused."""
    _validate_name(bot_id)
    fleet = fleet_bots if fleet_bots is not None else _load_fleet()
    row = _roster_row(fleet, bot_id)
    if row is None:
        raise _err(f"no bot named {bot_id!r} in the roster", 404)
    removed = _remove_paths(bot_id)
    fleet.pop(bot_id, None)
    fleet["bots"] = [r for r in fleet.get("bots", []) if r.get("id") != bot_id]
    _save_fleet(fleet)
    org_removed = _remove_from_orgs(bot_id)
    if fleet_bots is not None:
        fleet_bots.pop(bot_id, None)
    return {"bot_id": bot_id, "removed": removed, "org_removed": org_removed}


def update_registered_bot(bot_id: str, *, fleet_bots: dict | None = None,
                          fields: dict | None = None) -> dict:
    """Patch editable metadata (name/title/description/icon/color). The id is
    identity, not metadata — a payload carrying one is refused, not renamed."""
    _validate_name(bot_id)
    if not isinstance(fields, dict) or not fields:
        raise _err("request body must carry at least one field to update", 400)
    if "id" in fields and str(fields["id"]) != bot_id:
        raise _err("bot id is immutable — it cannot be changed", 400)
    unknown = sorted(k for k in fields if k not in EDITABLE_FIELDS)
    if unknown:
        raise _err(f"unknown field(s): {', '.join(unknown)}", 400)
    for key in EDITABLE_FIELDS:
        val = fields.get(key)
        if val is None:
            continue
        if not isinstance(val, str) or not val.strip():
            raise _err(f"{key} must be a non-empty string", 400)
        if key == "name" and len(val) > 60:
            raise _err("name must be at most 60 characters", 400)
    fleet = fleet_bots if fleet_bots is not None else _load_fleet()
    row = _roster_row(fleet, bot_id)
    if row is None:
        raise _err(f"no bot named {bot_id!r} in the roster", 404)
    for key in EDITABLE_FIELDS:
        if fields.get(key) is not None:
            row[key] = fields[key].strip()
    fleet[bot_id] = row
    fleet["bots"] = [r for r in fleet.get("bots", []) if r.get("id") != bot_id]
    fleet["bots"].append(row)
    _save_fleet(fleet)
    if fleet_bots is not None:
        fleet_bots[bot_id] = row
    return row
