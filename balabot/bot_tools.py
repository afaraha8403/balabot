"""BalaBot bot tools — the agent-facing surface to the org layer.

Four tools per kb/plans/org-secrets-and-skills.md (build step 5):

- request_secret(name, description=None)        -> record a PENDING secret request
- list_org_secrets(bot_id)                      -> metadata only, never values
- request_secret_access(bot_id, name, reason)   -> record an access request
- list_org_skills(bot_id)                       -> skill grants from the registry

SECURITY BOUNDARY (hard rule from the spec):
    A bot can never obtain a secret VALUE through any tool here. Requests are
    recorded so the UI can surface the in-chat form; the human supplies the
    value through that form (POST straight to the backend), never through the
    agent, and never in argv (so no CLI here accepts a value either).

Pending requests live at <BALABOT_DATA_ROOT>/orgs/pending.json, separated from
the registry so tool writes never touch registry state.

CLI: python -m balabot.bot_tools <tool> --bot <id> [args]   (JSON on stdout)
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from balabot import orgs
from balabot.handoffs import HandoffError, enqueue_handoff

__all__ = [
    "request_secret",
    "list_org_secrets",
    "request_secret_access",
    "list_org_skills",
    "message_agent",
    "request_intervention",
    "list_pending_requests",
    "record_growth_audit",
    "rollback_growth_audit",
    "enqueue_org_request",
    "propose_bot",
    "main",
]

PENDING_KINDS = {"secret_request", "secret_access_request"}


def _data_root() -> Path:
    return Path(os.environ.get("BALABOT_DATA_ROOT", str(orgs.DEFAULT_DATA_ROOT)))


def _pending_path() -> Path:
    return _data_root() / "orgs" / "pending.json"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_pending() -> list[dict]:
    path = _pending_path()
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _save_pending(rows: list[dict]) -> None:
    path = _pending_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _append_pending(row: dict) -> dict:
    rows = _load_pending()
    rows.append(row)
    _save_pending(rows)
    return row


def _require_str(value, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty string")
    return value


# ---- tools -----------------------------------------------------------------


def enqueue_org_request(profile: str, event: dict) -> dict:
    """Queue an org request into the org-request queue the UI server drains.

    THE EXISTING QUEUE API: ui/server.py owns the queue (module-level
    ``_org_request_queue`` + enqueue_org_request/_drain_org_request_frames +
    GET/POST /api/org/requests). This producer does NOT invent a second queue —
    it uses the same one, directly when ui.server is importable in-process
    (tests, monolith runs), else via the POST /api/org/requests HTTP contract
    the server itself serves. Either way the next /api/chat stream for
    `profile` emits the ``event: secret_request`` / ``event:
    secret_access_request`` SSE frame.

    Raises only ValueError/HTTP-level connection errors — never a secret leak
    (the payload is metadata only: kind/bot/name/description/reason).
    """
    try:  # in-process (tests, single-process deploys) — the real queue object
        from ui import server as _ui_server

        return _ui_server.enqueue_org_request(profile, event)
    except Exception:
        pass
    # Fall back to the server's own HTTP contract (same queue, over POST).
    import requests

    host = os.environ.get("BALABOT_UI_HOST_URL", "http://127.0.0.1:9120")
    try:
        resp = requests.post(
            f"{host}/api/org/requests",
            json={"bot": profile, **event},
            timeout=5,
        )
        resp.raise_for_status()
        return resp.json().get("request") or {}
    except requests.RequestException as exc:
        raise ValueError(f"org request queue unavailable: {exc}") from exc


def request_secret(name: str, description: str | None = None, *,
                   bot_id: str | None = None, **kwargs) -> dict:
    """Record a PENDING secret request so the UI can surface the in-chat form.

    The bot NEVER supplies, stores or receives a value here — the user does
    that through the in-chat form (client-side, posted straight to the
    backend). Passing anything like value=... is rejected outright.
    """
    _require_str(name, "name")
    if kwargs:
        raise ValueError(
            "request_secret does not accept a secret value or any extra "
            f"kwarg(s) {sorted(kwargs)!r}: values are supplied by the user "
            "through the in-chat form, never through the agent"
        )
    row = _append_pending({
        "id": f"pr_{uuid.uuid4().hex[:12]}",
        "kind": "secret_request",
        "bot_id": bot_id,
        "name": name,
        "description": description or "",
        "created_at": _now(),
        "status": "awaiting_user",
    })
    # THE PRODUCER HALF of the secret_request SSE path: enqueue into the
    # org-request queue ui/server.py drains as `event: secret_request` frames
    # on this bot's next /api/chat stream. Without this the frames can never
    # fire. The durable pending row stays too (it is the honest record when
    # the UI process is not running); a queue failure never fails the request
    # itself — the pending row is the source of truth.
    profile = bot_id or "principal"
    try:
        enqueue_org_request(profile, {
            "kind": "secret_request",
            "bot": profile,
            "name": name,
            "description": description or "",
        })
    except Exception:
        pass
    return {
        "requested": True,
        "name": row["name"],
        "description": row["description"],
        "status": row["status"],
    }


def list_org_secrets(bot_id: str) -> list[dict]:
    """[{name, description, granted, origin_org, fingerprint}] — metadata
    only, NEVER values. Every registered secret the bot could ask about:
    granted rows come from live grants, ungranted ones are listed with
    granted=False so the bot knows what to request access to. Cross-org
    entries carry their origin org.
    """
    _require_str(bot_id, "bot_id")
    reg = orgs.load()
    granted_keys = {
        (g["resource"]["name"], g["resource_org"])
        for g in orgs.grants_for(bot_id, kind="secret")
    }
    rows = []
    for s in reg["secrets"]:
        rows.append({
            "name": s["name"],
            "description": s.get("description", ""),
            "granted": (s["name"], s["org"]) in granted_keys,
            "origin_org": s["org"],
            "fingerprint": s.get("fingerprint", "…"),
        })
    rows.sort(key=lambda r: (r["origin_org"], r["name"]))
    return rows


def request_secret_access(bot_id: str, name: str, reason: str) -> dict:
    """Record an access request. Adds NO grant — a human approves in chat."""
    _require_str(bot_id, "bot_id")
    _require_str(name, "name")
    _require_str(reason, "reason")
    row = _append_pending({
        "id": f"pr_{uuid.uuid4().hex[:12]}",
        "kind": "secret_access_request",
        "bot_id": bot_id,
        "name": name,
        "reason": reason,
        "created_at": _now(),
        "status": "awaiting_user",
    })
    # Producer half: same org-request queue as request_secret (see there) —
    # drained as `event: secret_access_request` SSE frames. Failure here never
    # fails the request; the pending row is the source of truth.
    try:
        enqueue_org_request(bot_id, {
            "kind": "secret_access_request",
            "bot": bot_id,
            "name": name,
            "reason": reason,
        })
    except Exception:
        pass
    return {
        "requested": True,
        "name": row["name"],
        "reason": row["reason"],
        "status": row["status"],
    }


def list_org_skills(bot_id: str) -> list[dict] | dict:
    """[{name, scope, origin}] from the registry's skill grants.

    If the skill registry does not exist yet, returns an honest empty list
    plus a reason string instead of inventing entries.
    """
    _require_str(bot_id, "bot_id")
    skill_grants = orgs.grants_for(bot_id, kind="skill")
    if not skill_grants:
        skill_registry = _data_root() / "orgs" / "skills.json"
        if not skill_registry.exists():
            return {
                "skills": [],
                "reason": f"skill registry not found at {skill_registry} — "
                          "the skills layer (build step 6) is not set up yet",
            }
        return []
    rows = [
        {
            "name": g["resource"]["name"],
            "scope": g["scope"],
            "origin": g["resource_org"],
        }
        for g in skill_grants
    ]
    rows.sort(key=lambda r: (r["origin"], r["name"]))
    return rows


def _roster_path() -> Path:
    return _data_root() / "fleet" / "bots.json"


def _rostered_ids() -> set[str]:
    """IDs of bots that actually exist in the fleet roster — the source of
    truth for who is messageable. Same file lifecycle.py owns; same shapes:
    a top-level key per created bot, plus rows in the `bots` list."""
    path = _roster_path()
    if not path.exists():
        return set()
    try:
        fleet = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return set()
    if not isinstance(fleet, dict):
        return set()
    ids: set[str] = set()
    for row in fleet.get("bots", []):
        if isinstance(row, dict) and row.get("id"):
            ids.add(str(row["id"]))
    ids |= {k for k in fleet.keys() if k != "bots" and isinstance(fleet[k], dict)}
    return ids


_OWNER_IDENTITIES = frozenset({"user", "ali", "owner", "human", "admin"})


def message_agent(from_bot: str, to_bot: str, message: str, **kwargs) -> dict:
    """Bot-to-bot messaging: `from_bot` sends `message` to `to_bot`.

    ROSTER RULE (hard): `to_bot` must be in the fleet roster
    (<BALABOT_DATA_ROOT>/fleet/bots.json). An unrostered target is refused,
    never silently accepted, and no message is queued for it.

    IMPERSONATION RULE (hard): `from_bot` may never be a human identity
    (user/ali/owner/human/admin) — the owner talks to bots directly, not
    through a bot's tool calls. Self-send is refused too (a handoff to
    yourself is a loop, not a message).

    DELIVERY: the message is queued in `to_bot`'s inbox AND an `event: handoff`
    frame (from/to/summary/at) is enqueued so the to-bot's next /api/chat
    stream surfaces the delivery visibly in the transcript. The sender's
    summary that travels the frame is the first line of the message, stripped
    — the full message waits in the inbox; the frame is a notice, not a
    transport for arbitrary content.

    Returns a typed JSON-able dict (repo tool convention).
    """
    _require_str(from_bot, "from_bot")
    _require_str(to_bot, "to_bot")
    _require_str(message, "message")
    if kwargs:
        raise ValueError(
            "message_agent accepts no extra kwarg(s) "
            f"{sorted(kwargs)!r} — bots cannot smuggle sender identity, "
            "system fields, or roles through this tool")
    if from_bot.strip().lower() in _OWNER_IDENTITIES:
        raise ValueError(
            f"{from_bot!r} is a human identity — a bot can never message an "
            "agent as the owner; the owner talks to bots directly")
    if from_bot.strip() == to_bot.strip():
        raise ValueError("a bot cannot message itself")
    rostered = _rostered_ids()
    if to_bot.strip() not in rostered:
        raise ValueError(
            f"{to_bot!r} is not in the fleet roster — only rostered bots "
            "are messageable")
    summary = message.strip().splitlines()[0][:120] if message.strip() else ""
    # The delivery itself: the target's inbox.
    _append_pending({
        "id": f"ma_{uuid.uuid4().hex[:12]}",
        "kind": "agent_message",
        "bot_id": to_bot.strip(),
        "from_bot": from_bot.strip(),
        "message": message,
        "created_at": _now(),
        "status": "delivered",
    })
    # The visible handoff frame for the target's chat stream.
    try:
        frame = enqueue_handoff(from_bot.strip(), to_bot.strip(), summary)
    except HandoffError as exc:  # pragma: no cover — guards above match
        raise ValueError(f"handoff refused: {exc}") from exc
    return {
        "sent": True,
        "from": from_bot.strip(),
        "to": to_bot.strip(),
        "summary": summary,
        "delivered": "inbox",
        "handoff_queued": True,
        "frame": frame,
    }


def request_intervention(bot_id: str, reason: str, hint: str = "",
                         url: str = "", timeout: float = 120.0) -> dict:
    """A bot asks for human intervention (captcha, login, 2FA) and pauses its turn."""
    _require_str(bot_id, "bot_id")
    _require_str(reason, "reason")
    from balabot.intervention import enqueue_intervention, request_intervention as _req_iv
    rec = _req_iv(bot_id=bot_id, reason=reason, hint=hint, url=url, timeout=timeout)
    enqueue_intervention(rec)
    return {
        "requested": True,
        "resume_token": rec["resume_token"],
        "bot": rec["bot"],
        "reason": rec["reason"],
        "state": rec["state"],
        "expires_at": rec["expires_at"],
    }


def list_pending_requests(bot_id: str | None = None) -> list[dict]:
    """Pending requests the UI/backend can serve (optionally per bot)."""
    rows = _load_pending()
    if bot_id is not None:
        rows = [r for r in rows if r.get("bot_id") == bot_id]
    return rows


def record_growth_audit(
    action: str,
    target: str,
    description: str,
    *,
    before_state: Any = None,
    after_state: Any = None,
    rollback_patch: Any = None,
    author: str = "principal",
    name: str = "principal",
) -> dict:
    """Record a growth-loop change with rollback instructions into the audit ledger."""
    from balabot.growth import record_audit_entry
    return record_audit_entry(
        action=action,
        target=target,
        description=description,
        before_state=before_state,
        after_state=after_state,
        rollback_patch=rollback_patch,
        author=author,
        name=name,
    )


def rollback_growth_audit(
    change_id: str,
    *,
    reason: str = "",
    name: str = "principal",
) -> dict:
    """Reverse a previous growth-loop change recorded in the audit ledger."""
    from balabot.growth import rollback_audit_entry
    return rollback_audit_entry(change_id, name=name, reason=reason)


def propose_bot(
    bot_id: str | None = None,
    name: str = "",
    role: str = "",
    reason: str = "",
    *,
    proposed_by: str | None = None,
    model: str | None = None,
    **kwargs,
) -> dict:
    """A bot proposes the creation of a new bot/agent into the consent ladder.

    SECURITY & CONSENT BOUNDARY:
        A bot NEVER writes root-owned stores (fleet roster or proposal store)
        directly. Instead, it writes into an agent-writable spool. The server-side
        drain (running as root) turns spooled proposals into real proposals
        for the human owner to approve in the dashboard.
        A bot can NEVER approve a proposal (self-approval is refused).
    """
    proposing_bot = bot_id or proposed_by
    _require_str(proposing_bot, "bot")
    _require_str(name, "name")
    _require_str(role, "role")
    if kwargs:
        raise ValueError(
            "propose_bot accepts no extra kwarg(s) "
            f"{sorted(kwargs)!r}"
        )
    if proposing_bot.strip().lower() in _OWNER_IDENTITIES:
        raise ValueError(
            f"{proposing_bot!r} is a human identity — a bot can never propose "
            "an agent as the owner; use the proposing bot's own id"
        )
    from balabot import bot_creation
    try:
        spooled = bot_creation.spool_proposal(
            name=name.strip(),
            role=role.strip(),
            proposed_by=proposing_bot.strip(),
            reason=(reason or "").strip(),
            model=(model or "").strip() if model else None,
        )
    except bot_creation.CreationError as exc:
        raise ValueError(str(exc)) from exc

    try:
        enqueue_org_request(proposing_bot.strip(), {
            "kind": "bot_proposal",
            "bot": proposing_bot.strip(),
            "name": spooled["name"],
            "role": spooled["role"],
            "reason": spooled["reason"],
        })
    except Exception:
        pass

    return {
        "proposed": True,
        "id": spooled["id"],
        "bot_id": spooled["bot_id"],
        "name": spooled["name"],
        "role": spooled["role"],
        "reason": spooled["reason"],
        "proposed_by": spooled["proposed_by"],
        "status": spooled["status"],
        "created_at": spooled["created_at"],
    }


# ---- CLI -------------------------------------------------------------------


def _json_out(obj) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    tool = argv[0] if argv else ""
    args = argv[1:]

    known_flags = {
        "request_secret": ["--name", "--description", "--bot"],
        "list_org_secrets": ["--bot"],
        "request_secret_access": ["--bot", "--name", "--reason"],
        "list_org_skills": ["--bot"],
        "message_agent": ["--from", "--to", "--message"],
        "request_intervention": ["--bot", "--reason", "--hint", "--url"],
        "list_pending_requests": ["--bot"],
        "record_growth_audit": ["--action", "--target", "--description", "--author", "--patch", "--bot"],
        "rollback_growth_audit": ["--change-id", "--reason", "--bot"],
        "propose_bot": ["--bot", "--name", "--role", "--reason", "--model"],
    }
    allowed = known_flags.get(tool)
    if allowed is not None:
        unknown = [a for a in args if a.startswith("--") and a not in allowed]
        if unknown:
            # Especially: no flag here may ever carry a secret VALUE — argv is
            # explicitly a no-secret zone per the spec.
            print(f"error: unknown option(s) {unknown!r} for {tool}; "
                  f"accepted: {allowed}. Note: no bot-tools CLI accepts a "
                  "secret value.", file=sys.stderr)
            return 1

    def _opt(flag: str, default=None):
        return args[args.index(flag) + 1] if flag in args else default

    try:
        if tool == "request_secret":
            name = _opt("--name")
            if not name:
                raise ValueError("request_secret needs --name <NAME>")
            _json_out(request_secret(name, _opt("--description"),
                                     bot_id=_opt("--bot")))
            return 0
        if tool == "list_org_secrets":
            bot = _opt("--bot")
            if not bot:
                raise ValueError("list_org_secrets needs --bot <id>")
            _json_out(list_org_secrets(bot))
            return 0
        if tool == "request_secret_access":
            bot, name = _opt("--bot"), _opt("--name")
            reason = _opt("--reason")
            if not (bot and name and reason):
                raise ValueError("request_secret_access needs --bot, --name, --reason")
            _json_out(request_secret_access(bot, name, reason))
            return 0
        if tool == "list_org_skills":
            bot = _opt("--bot")
            if not bot:
                raise ValueError("list_org_skills needs --bot <id>")
            _json_out(list_org_skills(bot))
            return 0
        if tool == "message_agent":
            src, dst, msg = _opt("--from"), _opt("--to"), _opt("--message")
            if not (src and dst and msg):
                raise ValueError("message_agent needs --from, --to, --message")
            _json_out(message_agent(src, dst, msg))
            return 0
        if tool == "request_intervention":
            bot, reason = _opt("--bot"), _opt("--reason")
            if not (bot and reason):
                raise ValueError("request_intervention needs --bot, --reason")
            _json_out(request_intervention(bot, reason, hint=_opt("--hint", ""), url=_opt("--url", "")))
            return 0
        if tool == "list_pending_requests":
            _json_out(list_pending_requests(_opt("--bot")))
            return 0
        if tool == "record_growth_audit":
            action, target, desc = _opt("--action"), _opt("--target"), _opt("--description")
            if not (action and target and desc):
                raise ValueError("record_growth_audit needs --action, --target, --description")
            _json_out(record_growth_audit(
                action, target, desc,
                author=_opt("--author", "principal"),
                rollback_patch=_opt("--patch"),
                name=_opt("--bot", "principal"),
            ))
            return 0
        if tool == "rollback_growth_audit":
            cid = _opt("--change-id")
            if not cid:
                raise ValueError("rollback_growth_audit needs --change-id <ID>")
            _json_out(rollback_growth_audit(
                cid,
                reason=_opt("--reason", ""),
                name=_opt("--bot", "principal"),
            ))
            return 0
        if tool == "propose_bot":
            bot, name, role = _opt("--bot"), _opt("--name"), _opt("--role")
            if not (bot and name and role):
                raise ValueError("propose_bot needs --bot, --name, --role")
            _json_out(propose_bot(
                bot, name, role,
                reason=_opt("--reason", ""),
                model=_opt("--model"),
            ))
            return 0
    except (ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print("usage: python -m balabot.bot_tools "
          "request_secret --name N [--description D] [--bot B] | "
          "list_org_secrets --bot B | "
          "request_secret_access --bot B --name N --reason R | "
          "list_org_skills --bot B | "
          "message_agent --from B --to B --message M | "
          "request_intervention --bot B --reason R [--hint H] [--url U] | "
          "list_pending_requests [--bot B] | "
          "record_growth_audit --action A --target T --description D [--author AU] [--patch P] [--bot B] | "
          "rollback_growth_audit --change-id ID [--reason R] [--bot B] | "
          "propose_bot --bot B --name N --role R [--reason REASON] [--model M]",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
