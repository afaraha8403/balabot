"""Bot creation with human consent (Wave 6 P4).

The consent ladder, in order — nothing skips a step:

    PROPOSED   a bot (or the user) filed a proposal
    APPROVED   a HUMAN approved it (explicit act, never inferred)
    CREATED    the profile/workspace actually provisioned
    REGISTERED the new bot is a fleet + org member

Invariants:
- Nothing is created without an explicit human approval action. A proposal
  that is approved with `approved_by` unset, or approved-by-itself (the
  proposing bot's own id), is refused.
- Proposal text is metadata: name, role description, proposing bot. Never a
  secret, never executed.
- `create_approved_bot` provisions via balabot.bootstrap's real machinery
  (template + workspace + rules + skills) against the SHIPPED persona
  templates, and registers the bot in the org registry and the fleet data.
  A deployment without a matching persona template fails loudly — it is
  never silently half-created.

State: <BALABOT_DATA_ROOT>/bot_creation/proposals.json — one atomic file,
same durability model as the org registry. Nothing at import time.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

__all__ = [
    "CreationError",
    "propose_bot",
    "spool_proposal",
    "drain_spool",
    "list_proposals",
    "get_proposal",
    "approve_proposal",
    "reject_proposal",
    "create_approved_bot",
    "new_bot_id",
]

HUMAN_APPROVER = "user"
PROPOSALS_DIRNAME = "bot_creation"
SPOOL_SUBDIR = "spool/bot_proposals"


class CreationError(ValueError):
    """A proposal/action is invalid or not in the right state."""


def _root() -> Path:
    return Path(os.environ.get("BALABOT_DATA_ROOT", "/opt/data")) / PROPOSALS_DIRNAME


def _spool_dir() -> Path:
    return Path(os.environ.get("BALABOT_DATA_ROOT", "/opt/data")) / SPOOL_SUBDIR


def _ensure_spool_dir() -> Path:
    sdir = _spool_dir()
    sdir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(sdir, 0o777)
    except OSError:
        pass
    return sdir


def _path() -> Path:
    return _root() / "proposals.json"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _empty() -> dict:
    return {"version": 1, "proposals": []}


def _load() -> dict:
    p = _path()
    if not p.exists():
        return _empty()
    data = json.loads(p.read_text(encoding="utf-8"))
    data.setdefault("proposals", [])
    return data


def _save(data: dict) -> None:
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".bc-", suffix=".tmp")
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


def new_bot_id(name: str) -> str:
    """Fleet id for a proposed bot: slugified name, e.g. 'Research' -> 'research'."""
    slug = re.sub(r"[^a-z0-9_-]+", "-", (name or "").strip().lower()).strip("-")
    if not slug:
        raise CreationError("name must contain at least one usable character")
    return slug[:32]


def propose_bot(
    *,
    name: str,
    role: str,
    proposed_by: str,
    model: str | None = None,
    reason: str = "",
) -> dict:
    """File a bot-creation proposal. Metadata only; nothing is provisioned."""
    if not name or not isinstance(name, str) or len(name.strip()) > 60:
        raise CreationError("bot name must be a non-empty string (max 60 chars)")
    if not role or not isinstance(role, str) or len(role) > 800:
        raise CreationError("role must be a non-empty description (max 800 chars)")
    if not proposed_by or not isinstance(proposed_by, str):
        raise CreationError("proposed_by must be the proposing bot id or 'user'")
    bot_id = new_bot_id(name)
    data = _load()
    # One live proposal per target id: a duplicate is a real conflict, not a
    # second row — the roster cannot hold two bots with one id.
    for pr in data["proposals"]:
        if pr["bot_id"] == bot_id and pr["status"] in ("proposed", "approved"):
            raise CreationError(
                f"a {pr['status']} proposal for bot id {bot_id!r} already exists"
            )
    proposal = {
        "id": f"bp_{uuid.uuid4().hex[:10]}",
        "bot_id": bot_id,
        "name": name.strip(),
        "role": role.strip(),
        "reason": (reason or "").strip(),
        "model": model or "",
        "proposed_by": proposed_by,
        "status": "proposed",
        "created_at": _now(),
        "approved_by": None,
        "approved_at": None,
        "decided_at": None,
        "created_result": None,
    }
    data["proposals"].append(proposal)
    _save(data)
    return proposal


def spool_proposal(
    *,
    name: str,
    role: str,
    proposed_by: str,
    reason: str = "",
    model: str | None = None,
) -> dict:
    """Spool a bot proposal into the agent-writable spool.

    Validates input without touching root-owned proposals.json.
    """
    if not name or not isinstance(name, str) or len(name.strip()) > 60:
        raise CreationError("bot name must be a non-empty string (max 60 chars)")
    if not role or not isinstance(role, str) or len(role) > 800:
        raise CreationError("role must be a non-empty description (max 800 chars)")
    if not proposed_by or not isinstance(proposed_by, str) or not proposed_by.strip():
        raise CreationError("proposed_by must be the proposing bot id or 'user'")
    bot_id = new_bot_id(name)
    spool_id = f"sp_{uuid.uuid4().hex[:12]}"
    record = {
        "id": spool_id,
        "bot_id": bot_id,
        "name": name.strip(),
        "role": role.strip(),
        "reason": (reason or "").strip(),
        "proposed_by": proposed_by.strip(),
        "model": (model or "").strip() if model else "",
        "created_at": _now(),
        "status": "spooled",
    }
    sdir = _ensure_spool_dir()
    target = sdir / f"{spool_id}.json"
    fd, tmp = tempfile.mkstemp(dir=str(sdir), prefix=".sp-", suffix=".tmp")
    try:
        try:
            os.fchmod(fd, 0o666)
        except (AttributeError, OSError):
            pass
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, target)
        try:
            os.chmod(target, 0o666)
        except OSError:
            pass
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return record


def drain_spool() -> dict:
    """Drain spooled proposals into real proposals.json records.

    Safe to call concurrently or repeatedly. Returns a dict with:
    - 'drained': list of successfully created proposals
    - 'discarded': list of items that were deliberately discarded (CreationError)
      with a 'reason' field explaining why

    If an UNEXPECTED error occurs (not CreationError), the spool file is left
    in place and the error propagates.
    """
    sdir = _spool_dir()
    if not sdir.exists():
        return {"drained": [], "discarded": []}
    drained: list[dict] = []
    discarded: list[dict] = []
    for p in sorted(sdir.glob("sp_*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            # Malformed spool file — discard it so it doesn't loop
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
            continue
        try:
            res = propose_bot(
                name=data["name"],
                role=data["role"],
                proposed_by=data.get("proposed_by") or "user",
                model=data.get("model") or None,
                reason=data.get("reason") or "",
            )
            drained.append(res)
            # Success: remove the spool file
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        except CreationError as exc:
            # Duplicate conflict or bad input — discard spool so it doesn't loop
            discarded.append(
                {
                    "bot_id": new_bot_id(data.get("name", "")),
                    "name": data.get("name", ""),
                    "reason": str(exc),
                    "spool_id": data.get("id", ""),
                }
            )
            # Remove the discarded spool file
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        # REMOVED the 'finally:' that unconditionally deleted the spool file.
        # Now, if an UNEXPECTED exception (not CreationError) is raised,
        # the spool file remains and the error propagates.
    return {"drained": drained, "discarded": discarded}


def get_proposal(pid: str) -> dict:
    for pr in _load()["proposals"]:
        if pr["id"] == pid:
            return pr
    raise CreationError(f"unknown proposal {pid!r}")


def list_proposals(status: str | None = None) -> list[dict]:
    rows = _load()["proposals"]
    if status:
        rows = [r for r in rows if r["status"] == status]
    return rows


def _set_status(pid: str, status: str, *, approved_by: str | None = None) -> dict:
    data = _load()
    row = next((r for r in data["proposals"] if r["id"] == pid), None)
    if row is None:
        raise CreationError(f"unknown proposal {pid!r}")
    expected = "proposed" if status in ("approved", "rejected") else "approved"
    if row["status"] != expected:
        raise CreationError(
            f"proposal {pid} is {row['status']!r}, cannot move to {status!r} "
            f"(must be {expected!r})"
        )
    if status == "approved":
        # THE CONSENT GATE: only a human may approve, and the approver must
        # not be the proposing bot itself (self-approval is not consent).
        if not approved_by or approved_by == HUMAN_APPROVER and False:
            pass
        if not approved_by:
            raise CreationError("approval requires an explicit human approver")
        if approved_by == row["proposed_by"] and approved_by != HUMAN_APPROVER:
            raise CreationError(
                "self-approval is not consent: a bot cannot approve its own "
                "proposal — the human operator must approve"
            )
    row["status"] = status
    row["approved_by"] = approved_by
    row["approved_at"] = _now() if status == "approved" else row["approved_at"]
    row["decided_at"] = _now()
    _save(data)
    return row


def approve_proposal(pid: str, *, approved_by: str) -> dict:
    """Record the HUMAN's approval. The bot still does not exist."""
    if approved_by != HUMAN_APPROVER:
        raise CreationError(
            "only the human operator ('user') may approve a bot proposal"
        )
    return _set_status(pid, "approved", approved_by=approved_by)


def reject_proposal(pid: str) -> dict:
    return _set_status(pid, "rejected")


def create_approved_bot(pid: str, *, fleet_bots: dict | None = None) -> dict:
    """Provision + register an APPROVED proposal. Refuses anything not yet
    approved — the create step literally checks the recorded consent.

    `fleet_bots` is the caller's current fleet meta map ({id: meta}); the new
    bot is appended and returned so the HTTP layer can hand it straight to
    the fleet route.
    """
    proposal = get_proposal(pid)
    if proposal["status"] != "approved":
        raise CreationError(
            f"proposal {pid} is {proposal['status']!r} — a bot is created only "
            "after explicit human approval"
        )
    bot_id = proposal["bot_id"]
    if fleet_bots is not None and bot_id in fleet_bots:
        raise CreationError(f"a bot with id {bot_id!r} already exists in the fleet")

    from . import bootstrap as bootstrap_mod

    actions: list[str] = []
    # A newly approved bot has no personas/<bot_id>/ of its own — it is
    # provisioned from the first SHIPPED persona template. Identity stays the
    # new bot's; only the template/rules files are borrowed.
    template_persona = bootstrap_mod.PERSONAS[0] if bootstrap_mod.PERSONAS else None
    actions.extend(
        bootstrap_mod.provision_persona(bot_id, template_persona=template_persona)[
            "actions"
        ]
    )
    # Deliverable 2: a created worker gets the SCOPED worker set, not the
    # skills/ dump. Worker bots must not carry operator/ledger tooling
    # (owner-onboarding, contradiction-audit, agent-liveness-recovery,
    # agent-growth-review). Scout's original creation wrongly installed all
    # four of those; DEFAULT_WORKER_SKILLS is the corrected scope.
    actions.extend(
        bootstrap_mod.install_skills(bot_id, skills=bootstrap_mod.DEFAULT_WORKER_SKILLS)
    )
    actions.extend(bootstrap_mod.init_ledger(bot_id))

    from . import orgs

    org = orgs.show_org(bootstrap_mod.DEFAULT_ORG)
    if org is None:
        # First-boot normally registers the default org; a deployment that
        # skipped it must not get a half-registered bot — finish the setup.
        orgs.add_org(
            bootstrap_mod.DEFAULT_ORG, bootstrap_mod.DEFAULT_ORG_NAME, members=[bot_id]
        )
    else:
        orgs.add_bot(bootstrap_mod.DEFAULT_ORG, bot_id)

    meta = {
        "id": bot_id,
        "name": proposal["name"],
        "title": f"{proposal['name']} — {proposal['role'][:80]}",
        "icon": "🤖",
        "color": "violet",
        "order": 999,
        "description": proposal["role"],
        "createdFrom": proposal["id"],
        "createdBy": proposal["approved_by"],
    }
    if fleet_bots is not None:
        fleet_bots[bot_id] = meta

    data = _load()
    row = next(r for r in data["proposals"] if r["id"] == pid)
    row["status"] = "registered"
    row["created_result"] = {
        "bot_id": bot_id,
        "actions": actions,
        "org": bootstrap_mod.DEFAULT_ORG,
        "registered_at": _now(),
    }
    _save(data)
    return {**row, "bot": meta}
