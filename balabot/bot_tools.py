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

import ipaddress
import json
import os
import socket
import sys
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

import httpcore
from httpcore._backends.sync import SyncBackend
from httpcore._backends.base import NetworkStream

from balabot import approvals
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
    "secret_request",
    "main",
]

_HTTP_TRANSPORT: httpx.BaseTransport | None = None


def _get_http_transport() -> httpx.BaseTransport | None:
    return _HTTP_TRANSPORT


class SSRFBlockedError(Exception):
    """Raised when an outbound connection targets a prohibited address or DNS rebinding is detected."""


class _PinnedSyncBackend(SyncBackend):
    """Network backend pinning the TCP connection to a pre-validated IP.

    Option (a) connection pinning:
    Prevents DNS rebinding TOCTOU attacks where a hostile resolver answers the initial
    validation query with a benign public IP but returns a private/loopback IP on
    connect. We resolve and validate the IP once, then connect directly to that pinned IP
    while preserving the original hostname in request headers and TLS SNI for certificate
    validation. Also performs an immediate post-connect verification on the actual socket peer
    address as belt-and-braces (Option b).
    """

    def __init__(self, pinned_ip: str):
        super().__init__()
        self._pinned_ip = pinned_ip

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ) -> NetworkStream:
        # Check if the hostname resolves to a prohibited address at connect time (rebinding detection)
        try:
            addr_infos = socket.getaddrinfo(host, port)
            for *_, sockaddr in addr_infos:
                ip = ipaddress.ip_address(sockaddr[0])
                if (
                    ip.is_loopback
                    or ip.is_private
                    or ip.is_link_local
                    or ip.is_reserved
                    or ip.is_unspecified
                ):
                    raise SSRFBlockedError(
                        f"SSRF blocked: destination {host} resolves to prohibited address {ip}"
                    )
        except socket.gaierror:
            pass

        stream = super().connect_tcp(
            self._pinned_ip,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )
        peer_addr = stream.get_extra_info("server_addr")
        if peer_addr:
            peer_ip_str = peer_addr[0]
            try:
                ip = ipaddress.ip_address(peer_ip_str)
                if (
                    ip.is_loopback
                    or ip.is_private
                    or ip.is_link_local
                    or ip.is_reserved
                    or ip.is_unspecified
                    or peer_ip_str != self._pinned_ip
                ):
                    stream.close()
                    raise SSRFBlockedError(
                        f"SSRF blocked: connection peer {peer_ip_str} is prohibited"
                    )
            except ValueError:
                stream.close()
                raise SSRFBlockedError(
                    f"SSRF blocked: invalid peer address {peer_ip_str}"
                )
        return stream


def _make_pinned_transport(pinned_ip: str) -> httpx.HTTPTransport:
    transport = httpx.HTTPTransport(verify=True)
    transport._pool = httpcore.ConnectionPool(
        network_backend=_PinnedSyncBackend(pinned_ip),
        ssl_context=transport._pool._ssl_context,
        http1=True,
        http2=False,
    )
    return transport


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


def request_secret(
    name: str, description: str | None = None, *, bot_id: str | None = None, **kwargs
) -> dict:
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
    row = _append_pending(
        {
            "id": f"pr_{uuid.uuid4().hex[:12]}",
            "kind": "secret_request",
            "bot_id": bot_id,
            "name": name,
            "description": description or "",
            "created_at": _now(),
            "status": "awaiting_user",
        }
    )
    # THE PRODUCER HALF of the secret_request SSE path: enqueue into the
    # org-request queue ui/server.py drains as `event: secret_request` frames
    # on this bot's next /api/chat stream. Without this the frames can never
    # fire. The durable pending row stays too (it is the honest record when
    # the UI process is not running); a queue failure never fails the request
    # itself — the pending row is the source of truth.
    profile = bot_id or "principal"
    try:
        enqueue_org_request(
            profile,
            {
                "kind": "secret_request",
                "bot": profile,
                "name": name,
                "description": description or "",
            },
        )
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
        rows.append(
            {
                "name": s["name"],
                "description": s.get("description", ""),
                "granted": (s["name"], s["org"]) in granted_keys,
                "origin_org": s["org"],
                "fingerprint": s.get("fingerprint", "…"),
            }
        )
    rows.sort(key=lambda r: (r["origin_org"], r["name"]))
    return rows


def request_secret_access(bot_id: str, name: str, reason: str) -> dict:
    """Record an access request. Adds NO grant — a human approves in chat."""
    _require_str(bot_id, "bot_id")
    _require_str(name, "name")
    _require_str(reason, "reason")
    row = _append_pending(
        {
            "id": f"pr_{uuid.uuid4().hex[:12]}",
            "kind": "secret_access_request",
            "bot_id": bot_id,
            "name": name,
            "reason": reason,
            "created_at": _now(),
            "status": "awaiting_user",
        }
    )
    # Producer half: same org-request queue as request_secret (see there) —
    # drained as `event: secret_access_request` SSE frames. Failure here never
    # fails the request; the pending row is the source of truth.
    try:
        enqueue_org_request(
            bot_id,
            {
                "kind": "secret_access_request",
                "bot": bot_id,
                "name": name,
                "reason": reason,
            },
        )
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
            "system fields, or roles through this tool"
        )
    if from_bot.strip().lower() in _OWNER_IDENTITIES:
        raise ValueError(
            f"{from_bot!r} is a human identity — a bot can never message an "
            "agent as the owner; the owner talks to bots directly"
        )
    if from_bot.strip() == to_bot.strip():
        raise ValueError("a bot cannot message itself")
    rostered = _rostered_ids()
    if to_bot.strip() not in rostered:
        raise ValueError(
            f"{to_bot!r} is not in the fleet roster — only rostered bots "
            "are messageable"
        )
    summary = message.strip().splitlines()[0][:120] if message.strip() else ""
    # The delivery itself: the target's inbox.
    _append_pending(
        {
            "id": f"ma_{uuid.uuid4().hex[:12]}",
            "kind": "agent_message",
            "bot_id": to_bot.strip(),
            "from_bot": from_bot.strip(),
            "message": message,
            "created_at": _now(),
            "status": "delivered",
        }
    )
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


def request_intervention(
    bot_id: str,
    reason: str,
    hint: str = "",
    url: str = "",
    timeout: float = 120.0,
    wait: bool = True,
    poll_interval: float = 0.25,
) -> dict:
    """A bot asks for human intervention (captcha, login, 2FA) and pauses its turn."""
    _require_str(bot_id, "bot_id")
    _require_str(reason, "reason")
    from balabot.intervention import (
        enqueue_intervention,
        request_intervention as _req_iv,
        state as _iv_state,
        what_the_bot_was_told as _what_told,
    )

    rec = _req_iv(bot_id=bot_id, reason=reason, hint=hint, url=url, timeout=timeout)
    enqueue_intervention(rec)
    token = rec["resume_token"]

    cur_state = rec
    if wait and timeout > 0:
        deadline = time.time() + float(timeout)
        while time.time() < deadline:
            cur_state = _iv_state(token)
            if cur_state["state"] in ("accepted", "rejected", "expired"):
                break
            time.sleep(poll_interval)
        else:
            cur_state = _iv_state(token)
    else:
        cur_state = _iv_state(token)

    told = _what_told(token)
    return {
        "requested": True,
        "resume_token": token,
        "bot": rec["bot"],
        "reason": rec["reason"],
        "hint": rec.get("hint", ""),
        "url": rec.get("url", ""),
        "state": cur_state["state"],
        "resolved": told.get("resolved", cur_state["state"] in ("accepted", "expired")),
        "outcome": cur_state["state"],
        "note": told.get("note", cur_state.get("owner_note", "")),
        "expires_at": cur_state["expires_at"],
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
        raise ValueError(f"propose_bot accepts no extra kwarg(s) {sorted(kwargs)!r}")
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
        enqueue_org_request(
            proposing_bot.strip(),
            {
                "kind": "bot_proposal",
                "bot": proposing_bot.strip(),
                "name": spooled["name"],
                "role": spooled["role"],
                "reason": spooled["reason"],
            },
        )
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


def _secret_audit_path() -> Path:
    return _data_root() / "orgs" / "secret_audit.json"


def _record_secret_audit(
    bot: str,
    secret_name: str,
    origin: str,
    method: str,
    status: str,
    reason: str | None = None,
    response_status: int | None = None,
) -> None:
    """Record an audit trail entry for every secret_request invocation.

    Hard rule: The audit trail must NEVER record the secret value, nor the raw URL
    which can leak query strings, tokens, credentials, or sensitive path fragments.
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bot": bot,
        "secret_name": secret_name,
        "origin": origin,
        "method": method.upper(),
        "status": status,
        "reason": reason,
        "response_status": response_status,
    }
    p = _secret_audit_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        audits = []
        if p.exists():
            try:
                audits = json.loads(p.read_text(encoding="utf-8"))
                if not isinstance(audits, list):
                    audits = []
            except Exception:
                audits = []
        audits.append(entry)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(audits, indent=2), encoding="utf-8")
        tmp.replace(p)
    except Exception:
        pass


def secret_request(
    bot_id: str,
    name: str,
    url: str,
    *,
    method: str = "GET",
    headers: dict | None = None,
    body: str | dict | None = None,
    auth_header: str = "Authorization",
    auth_scheme: str = "Bearer",
) -> dict:
    """Execute a server-side proxied HTTP request using a granted secret.

    Decrypts the secret on the backend, enforces origin allowlists and SSRF
    protections, executes the request without exposing the secret to the agent,
    redacts the credential from response body and headers, and records an audit log.
    """
    _require_str(bot_id, "bot")
    _require_str(name, "name")
    _require_str(url, "url")
    method = (method or "GET").upper()

    parsed = urllib.parse.urlsplit(url)
    origin = (
        f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else (parsed.scheme or "")
    )
    if parsed.scheme not in ("http", "https"):
        _record_secret_audit(
            bot_id, name, origin, method, "refused", "invalid URL scheme"
        )
        return {
            "ok": False,
            "error": f"invalid scheme {parsed.scheme!r}; only http/https allowed",
            "status_code": 400,
        }

    hostname = parsed.hostname or ""

    # Verify active grant for bot
    grants = orgs.grants_for(bot_id, kind="secret")
    grant = next((g for g in grants if g.get("resource", {}).get("name") == name), None)
    if grant is None:
        _record_secret_audit(
            bot_id,
            name,
            origin,
            method,
            "refused",
            f"bot {bot_id!r} has no grant for secret {name!r}",
        )
        return {
            "ok": False,
            "error": f"bot {bot_id!r} has no grant for secret {name!r}",
            "status_code": 403,
        }

    resource_org = grant.get("resource_org") or "balacode"

    # Per-secret origin allowlist enforcement
    reg = orgs.load()
    sec_meta = next(
        (
            s
            for s in reg.get("secrets", [])
            if s.get("name") == name and s.get("org") == resource_org
        ),
        None,
    )
    allowed_origins = (sec_meta or {}).get("allowed_origins")
    if allowed_origins:
        if origin not in allowed_origins and hostname not in allowed_origins:
            _record_secret_audit(
                bot_id, name, origin, method, "refused", "origin not in allowed_origins"
            )
            return {
                "ok": False,
                "error": f"origin {origin!r} not in allowed origins for secret {name!r}",
                "status_code": 403,
            }

    # SSRF protection: reject loopback, link-local, private networks
    if hostname.lower() in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        _record_secret_audit(
            bot_id, name, origin, method, "refused", "SSRF blocked: loopback address"
        )
        return {
            "ok": False,
            "error": f"SSRF blocked: destination {hostname} is a loopback address",
            "status_code": 400,
        }

    target_ip = None
    try:
        ip = ipaddress.ip_address(hostname)
        if (
            ip.is_loopback
            or ip.is_private
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_unspecified
        ):
            _record_secret_audit(
                bot_id, name, origin, method, "refused", f"SSRF blocked: {ip}"
            )
            return {
                "ok": False,
                "error": f"SSRF blocked: destination {hostname} is a prohibited address",
                "status_code": 400,
            }
        target_ip = str(ip)
    except ValueError:
        # Hostname, not IP literal -> resolve DNS
        try:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            addr_infos = socket.getaddrinfo(hostname, port)
            for family, socktype, proto, canonname, sockaddr in addr_infos:
                resolved_ip = ipaddress.ip_address(sockaddr[0])
                if (
                    resolved_ip.is_loopback
                    or resolved_ip.is_private
                    or resolved_ip.is_link_local
                    or resolved_ip.is_reserved
                    or resolved_ip.is_unspecified
                ):
                    _record_secret_audit(
                        bot_id,
                        name,
                        origin,
                        method,
                        "refused",
                        f"SSRF blocked: {resolved_ip}",
                    )
                    return {
                        "ok": False,
                        "error": f"SSRF blocked: destination {hostname} resolves to prohibited address {resolved_ip}",
                        "status_code": 400,
                    }
                if target_ip is None:
                    target_ip = str(resolved_ip)
        except socket.gaierror:
            pass

    # Retrieve and decrypt secret
    secret_val = orgs.read_secret_value(resource_org, name)
    if secret_val is None:
        _record_secret_audit(
            bot_id,
            name,
            origin,
            method,
            "refused",
            "secret decryption failed or missing",
        )
        return {
            "ok": False,
            "error": f"secret {name!r} could not be retrieved or decrypted",
            "status_code": 404,
        }

    # Inject credential into headers
    req_headers = dict(headers or {})
    if auth_scheme:
        req_headers[auth_header] = f"{auth_scheme} {secret_val}".strip()
    else:
        req_headers[auth_header] = secret_val

    # Execute request
    transport = _get_http_transport()
    if transport is None:
        if target_ip is None:
            _record_secret_audit(
                bot_id,
                name,
                origin,
                method,
                "refused",
                f"SSRF blocked: unable to resolve destination {hostname}",
            )
            return {
                "ok": False,
                "error": f"SSRF blocked: unable to resolve destination {hostname}",
                "status_code": 400,
            }
        transport = _make_pinned_transport(target_ip)

    try:
        with httpx.Client(
            transport=transport, follow_redirects=False, timeout=30.0
        ) as client:
            if isinstance(body, dict):
                resp = client.request(
                    method=method, url=url, headers=req_headers, json=body
                )
            elif isinstance(body, str):
                resp = client.request(
                    method=method,
                    url=url,
                    headers=req_headers,
                    content=body.encode("utf-8"),
                )
            else:
                resp = client.request(method=method, url=url, headers=req_headers)
    except SSRFBlockedError as exc:
        _record_secret_audit(bot_id, name, origin, method, "refused", str(exc))
        return {
            "ok": False,
            "error": str(exc),
            "status_code": 400,
        }
    except Exception as exc:
        _record_secret_audit(
            bot_id,
            name,
            origin,
            method,
            "error",
            f"request failed: {type(exc).__name__}",
        )
        return {
            "ok": False,
            "error": f"request failed: {type(exc).__name__}",
            "status_code": 502,
        }

    # Redact secret value from response body and headers
    resp_text = resp.text
    if secret_val and secret_val in resp_text:
        resp_text = resp_text.replace(secret_val, "[REDACTED_SECRET]")

    scrubbed_headers = {}
    for k, v in resp.headers.items():
        if secret_val and secret_val in v:
            v = v.replace(secret_val, "[REDACTED_SECRET]")
        scrubbed_headers[k] = v

    _record_secret_audit(
        bot_id, name, origin, method, "allowed", response_status=resp.status_code
    )

    return {
        "ok": resp.is_success,
        "status_code": resp.status_code,
        "headers": scrubbed_headers,
        "body": resp_text,
    }


# ---- CLI -------------------------------------------------------------------


def _json_out(obj) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True))


def _check_gate(tool: str, args: dict, scope: str | None) -> dict | None:
    """Classify + gate one tool call through the approval ledger.

    Every call is logged (the classifier is explicit and auditable). Returns
    the refusal/expiry/replay body to print — which STOPS the dispatch — or
    None when the call may proceed (observe, unenforced, or approved)."""
    gate = approvals.check_mutation(tool, args, scope=scope)
    if gate.get("decision") in ("refused", "replay", "expired"):
        return gate
    return None


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
        "request_intervention": [
            "--bot",
            "--reason",
            "--hint",
            "--url",
            "--timeout",
            "--no-wait",
        ],
        "list_pending_requests": ["--bot"],
        "record_growth_audit": [
            "--action",
            "--target",
            "--description",
            "--author",
            "--patch",
            "--bot",
        ],
        "rollback_growth_audit": ["--change-id", "--reason", "--bot"],
        "propose_bot": ["--bot", "--name", "--role", "--reason", "--model"],
        "secret_request": [
            "--bot",
            "--name",
            "--url",
            "--method",
            "--headers",
            "--body",
            "--auth-header",
            "--auth-scheme",
        ],
    }
    allowed = known_flags.get(tool)
    if allowed is not None:
        unknown = [a for a in args if a.startswith("--") and a not in allowed]
        if unknown:
            # Especially: no flag here may ever carry a secret VALUE — argv is
            # explicitly a no-secret zone per the spec.
            print(
                f"error: unknown option(s) {unknown!r} for {tool}; "
                f"accepted: {allowed}. Note: no bot-tools CLI accepts a "
                "secret value.",
                file=sys.stderr,
            )
            return 1

    def _opt(flag: str, default=None):
        return args[args.index(flag) + 1] if flag in args else default

    try:
        if tool == "request_secret":
            name = _opt("--name")
            if not name:
                raise ValueError("request_secret needs --name <NAME>")
            gate = _check_gate(
                "request_secret",
                {
                    "name": name,
                    "description": _opt("--description"),
                    "bot_id": _opt("--bot"),
                },
                scope=_opt("--bot"),
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(request_secret(name, _opt("--description"), bot_id=_opt("--bot")))
            return 0
        if tool == "list_org_secrets":
            bot = _opt("--bot")
            if not bot:
                raise ValueError("list_org_secrets needs --bot <id>")
            gate = _check_gate("list_org_secrets", {"bot_id": bot}, scope=bot)
            if gate:
                _json_out(gate)
                return 0
            _json_out(list_org_secrets(bot))
            return 0
        if tool == "request_secret_access":
            bot, name = _opt("--bot"), _opt("--name")
            reason = _opt("--reason")
            if not (bot and name and reason):
                raise ValueError("request_secret_access needs --bot, --name, --reason")
            gate = _check_gate(
                "request_secret_access",
                {"bot_id": bot, "name": name, "reason": reason},
                scope=bot,
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(request_secret_access(bot, name, reason))
            return 0
        if tool == "list_org_skills":
            bot = _opt("--bot")
            if not bot:
                raise ValueError("list_org_skills needs --bot <id>")
            gate = _check_gate("list_org_skills", {"bot_id": bot}, scope=bot)
            if gate:
                _json_out(gate)
                return 0
            _json_out(list_org_skills(bot))
            return 0
        if tool == "message_agent":
            src, dst, msg = _opt("--from"), _opt("--to"), _opt("--message")
            if not (src and dst and msg):
                raise ValueError("message_agent needs --from, --to, --message")
            gate = _check_gate(
                "message_agent", {"from": src, "to": dst, "message": msg}, scope=src
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(message_agent(src, dst, msg))
            return 0
        if tool == "request_intervention":
            bot, reason = _opt("--bot"), _opt("--reason")
            if not (bot and reason):
                raise ValueError("request_intervention needs --bot, --reason")
            gate = _check_gate(
                "request_intervention",
                {
                    "bot_id": bot,
                    "reason": reason,
                    "hint": _opt("--hint", ""),
                    "url": _opt("--url", ""),
                },
                scope=bot,
            )
            if gate:
                _json_out(gate)
                return 0
            timeout_str = _opt("--timeout", "120.0")
            try:
                timeout = float(timeout_str)
            except ValueError:
                timeout = 120.0
            wait = "--no-wait" not in args
            _json_out(
                request_intervention(
                    bot,
                    reason,
                    hint=_opt("--hint", ""),
                    url=_opt("--url", ""),
                    timeout=timeout,
                    wait=wait,
                )
            )
            return 0
        if tool == "list_pending_requests":
            gate = _check_gate(
                "list_pending_requests", {"bot_id": _opt("--bot")}, scope=_opt("--bot")
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(list_pending_requests(_opt("--bot")))
            return 0
        if tool == "record_growth_audit":
            action, target, desc = (
                _opt("--action"),
                _opt("--target"),
                _opt("--description"),
            )
            if not (action and target and desc):
                raise ValueError(
                    "record_growth_audit needs --action, --target, --description"
                )
            gate = _check_gate(
                "record_growth_audit",
                {
                    "action": action,
                    "target": target,
                    "description": desc,
                    "author": _opt("--author", "principal"),
                    "rollback_patch": _opt("--patch"),
                    "name": _opt("--bot", "principal"),
                },
                scope=_opt("--bot", "principal"),
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(
                record_growth_audit(
                    action,
                    target,
                    desc,
                    author=_opt("--author", "principal"),
                    rollback_patch=_opt("--patch"),
                    name=_opt("--bot", "principal"),
                )
            )
            return 0
        if tool == "rollback_growth_audit":
            cid = _opt("--change-id")
            if not cid:
                raise ValueError("rollback_growth_audit needs --change-id <ID>")
            gate = _check_gate(
                "rollback_growth_audit",
                {
                    "change_id": cid,
                    "reason": _opt("--reason", ""),
                    "name": _opt("--bot", "principal"),
                },
                scope=_opt("--bot", "principal"),
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(
                rollback_growth_audit(
                    cid,
                    reason=_opt("--reason", ""),
                    name=_opt("--bot", "principal"),
                )
            )
            return 0
        if tool == "propose_bot":
            bot, name, role = _opt("--bot"), _opt("--name"), _opt("--role")
            if not (bot and name and role):
                raise ValueError("propose_bot needs --bot, --name, --role")
            gate = _check_gate(
                "propose_bot",
                {
                    "bot_id": bot,
                    "name": name,
                    "role": role,
                    "reason": _opt("--reason", ""),
                    "model": _opt("--model"),
                    "proposed_by": bot,
                },
                scope=bot,
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(
                propose_bot(
                    bot,
                    name,
                    role,
                    reason=_opt("--reason", ""),
                    model=_opt("--model"),
                )
            )
            return 0
        if tool == "secret_request":
            bot, name, url = _opt("--bot"), _opt("--name"), _opt("--url")
            if not (bot and name and url):
                raise ValueError("secret_request needs --bot, --name, --url")
            headers_raw = _opt("--headers")
            headers = json.loads(headers_raw) if headers_raw else None
            body_raw = _opt("--body")
            if body_raw:
                try:
                    body = json.loads(body_raw)
                except Exception:
                    body = body_raw
            else:
                body = None
            gate = _check_gate(
                "secret_request",
                {
                    "name": name,
                    "url": url,
                    "method": _opt("--method", "GET"),
                    "headers": headers,
                    "body": body,
                    "auth_header": _opt("--auth-header", "Authorization"),
                    "auth_scheme": _opt("--auth-scheme", "Bearer"),
                },
                scope=bot,
            )
            if gate:
                _json_out(gate)
                return 0
            _json_out(
                secret_request(
                    bot,
                    name,
                    url,
                    method=_opt("--method", "GET"),
                    headers=headers,
                    body=body,
                    auth_header=_opt("--auth-header", "Authorization"),
                    auth_scheme=_opt("--auth-scheme", "Bearer"),
                )
            )
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
            timeout_str = _opt("--timeout", "120.0")
            try:
                timeout = float(timeout_str)
            except ValueError:
                timeout = 120.0
            wait = "--no-wait" not in args
            _json_out(
                request_intervention(
                    bot,
                    reason,
                    hint=_opt("--hint", ""),
                    url=_opt("--url", ""),
                    timeout=timeout,
                    wait=wait,
                )
            )
            return 0
        if tool == "list_pending_requests":
            _json_out(list_pending_requests(_opt("--bot")))
            return 0
        if tool == "record_growth_audit":
            action, target, desc = (
                _opt("--action"),
                _opt("--target"),
                _opt("--description"),
            )
            if not (action and target and desc):
                raise ValueError(
                    "record_growth_audit needs --action, --target, --description"
                )
            _json_out(
                record_growth_audit(
                    action,
                    target,
                    desc,
                    author=_opt("--author", "principal"),
                    rollback_patch=_opt("--patch"),
                    name=_opt("--bot", "principal"),
                )
            )
            return 0
        if tool == "rollback_growth_audit":
            cid = _opt("--change-id")
            if not cid:
                raise ValueError("rollback_growth_audit needs --change-id <ID>")
            _json_out(
                rollback_growth_audit(
                    cid,
                    reason=_opt("--reason", ""),
                    name=_opt("--bot", "principal"),
                )
            )
            return 0
        if tool == "propose_bot":
            bot, name, role = _opt("--bot"), _opt("--name"), _opt("--role")
            if not (bot and name and role):
                raise ValueError("propose_bot needs --bot, --name, --role")
            _json_out(
                propose_bot(
                    bot,
                    name,
                    role,
                    reason=_opt("--reason", ""),
                    model=_opt("--model"),
                )
            )
            return 0
        if tool == "secret_request":
            bot, name, url = _opt("--bot"), _opt("--name"), _opt("--url")
            if not (bot and name and url):
                raise ValueError("secret_request needs --bot, --name, --url")
            headers_raw = _opt("--headers")
            headers = json.loads(headers_raw) if headers_raw else None
            body_raw = _opt("--body")
            if body_raw:
                try:
                    body = json.loads(body_raw)
                except Exception:
                    body = body_raw
            else:
                body = None
            _json_out(
                secret_request(
                    bot,
                    name,
                    url,
                    method=_opt("--method", "GET"),
                    headers=headers,
                    body=body,
                    auth_header=_opt("--auth-header", "Authorization"),
                    auth_scheme=_opt("--auth-scheme", "Bearer"),
                )
            )
            return 0
    except (ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(
        "usage: python -m balabot.bot_tools "
        "request_secret --name N [--description D] [--bot B] | "
        "list_org_secrets --bot B | "
        "request_secret_access --bot B --name N --reason R | "
        "list_org_skills --bot B | "
        "message_agent --from B --to B --message M | "
        "request_intervention --bot B --reason R [--hint H] [--url U] [--timeout T] [--no-wait] | "
        "list_pending_requests [--bot B] | "
        "record_growth_audit --action A --target T --description D [--author AU] [--patch P] [--bot B] | "
        "rollback_growth_audit --change-id ID [--reason R] [--bot B] | "
        "propose_bot --bot B --name N --role R [--reason REASON] [--model M] | "
        "secret_request --bot B --name N --url U [--method M] [--headers H] [--body BD] [--auth-header AH] [--auth-scheme AS]",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
