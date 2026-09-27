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

__all__ = [
    "request_secret",
    "list_org_secrets",
    "request_secret_access",
    "list_org_skills",
    "list_pending_requests",
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


def list_pending_requests(bot_id: str | None = None) -> list[dict]:
    """Pending requests the UI/backend can serve (optionally per bot)."""
    rows = _load_pending()
    if bot_id is not None:
        rows = [r for r in rows if r.get("bot_id") == bot_id]
    return rows


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
        "list_pending_requests": ["--bot"],
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
        if tool == "list_pending_requests":
            _json_out(list_pending_requests(_opt("--bot")))
            return 0
    except (ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print("usage: python -m balabot.bot_tools "
          "request_secret --name N [--description D] [--bot B] | "
          "list_org_secrets --bot B | "
          "request_secret_access --bot B --name N --reason R | "
          "list_org_skills --bot B | list_pending_requests [--bot B]",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
