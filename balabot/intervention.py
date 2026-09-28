"""Agent intervention flow — the bot pauses and a human takes over.

Implements the approved playbook (kb/plans/agent-intervention-flow.md,
status: approved-for-build):

    bot hits a wall
      → tool: request_intervention(reason, hint?, url?)
      → SSE frame: event: intervention   {bot, reason, hint, url, resume_token}
      → owner takes over THAT bot's display and clicks Done — resume
      → resolve(resume_token, approve|deny, note?)
      → the bot's paused turn is released (or denied) and continues

Design decisions taken verbatim from the plan:

- **The bot pauses its turn and waits** (Ali, 2026-09-26). It holds its place;
  `state()` is the honest record the requester polls: pending / accepted /
  rejected / expired. There is no silent no-op — every outcome is explicit.
- **Scoped to one bot's display.** The record carries only the requesting bot's
  id; nothing here can reach another bot's display or the host.
- **Pause has a timeout.** If nobody responds before `expires_at`, the request
  is explicitly `expired` (never applied) and the bot resumes unattended.
- **The bot is told only that the human finished** — `{resolved, note?}` where
  the note is owner-chosen and optional. Nothing the owner typed on the screen
  travels back.
- **No intervention screenshots in logs.** There is deliberately no capture
  API on this record and the frame carries text fields only.

Refuse-unsafe defaults (binding on this module):

- **No owner impersonation.** Only the owner resolves; a bot can never resolve
  its own request (self-approval is not consent — same rule as
  bot_creation.approve) and never sends a frame `as` the owner.
- **No history rewrite.** An intervention carries reason/hint/url text and an
  optional owner note. There is no API to edit past messages, and an
  intervention cannot be created `as` the owner to inject chat content.
- **No stale application.** A request whose turn has ended, or whose pause
  expired, resolves to `expired`/`rejected` and is NEVER delivered. The parent
  marks the turn ended with `end_turn(token, ...)`.

Server-side emission model (same as balabot.handoffs): the chat passthrough is
a plain OpenAI-compatible stream, so `event: intervention` frames are QUEUED
per bot here and drained at the top of that bot's /api/chat stream.

PARENT INTEGRATION (one hook; ui/server.py owned elsewhere): inside the
`stream()` generator of the /api/chat route, next to the existing
`_drain_org_request_frames(profile)` and `drain_handoff_frames(profile)`
loops, add:

    from balabot.intervention import drain_intervention_frames
    for frame in drain_intervention_frames(profile):
        yield frame

Frame grammar (matches the named-event grammar ui/src/api.ts:handleFrame
parses — `event:` line + one `data:` line with a single JSON object, frames
separated by a blank line):

    event: intervention
    data: {"bot":"<bot>","reason":"...","hint":"...","url":"...",
           "resume_token":"<token>"}
    <blank line>
"""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

__all__ = [
    "InterventionError",
    "DEFAULT_PAUSE_TIMEOUT",
    "request_intervention",
    "resolve_intervention",
    "state",
    "end_turn",
    "active_for_bot",
    "format_intervention_frame",
    "enqueue_intervention",
    "drain_intervention_frames",
    "pending_intervention_count",
]

DEFAULT_PAUSE_TIMEOUT = 120.0  # seconds a pause may sit unattended


class InterventionError(ValueError):
    """An intervention request/resolve violates the intervention rules."""


_ACTIONS = {"approve", "deny"}
# States the requester can observe — always explicit, never silent.
_STATES = {"pending", "accepted", "rejected", "expired"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(ts: str) -> datetime | None:
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _clean(text: str, field: str) -> str:
    if text is None:
        return ""
    if not isinstance(text, str):
        raise InterventionError(f"{field} must be a string")
    return text.strip()


# Owner identities a bot may never claim — same refusal rule as handoffs.
_OWNER_NAMES = frozenset({"user", "ali", "owner", "human", "admin"})


def _check_bot(bot_id: str) -> str:
    bot = _clean(bot_id, "bot")
    if not bot:
        raise InterventionError("bot must be a non-empty string")
    if bot.lower() in _OWNER_NAMES:
        raise InterventionError(
            f"{bot!r} is a human identity — an intervention belongs to a bot, "
            "and no record may be created as the owner")
    return bot


# In-process records: token → record. The parent process owns the pause
# lifecycle, so per-process storage matches the handoffs queue model.
_records: dict[str, dict] = {}
# Queued `event: intervention` frames per bot profile, drained by that bot's
# next /api/chat stream.
_pending_frames: dict[str, list[str]] = {}


def request_intervention(bot_id: str, reason: str, hint: str = "",
                         url: str = "", timeout: float = DEFAULT_PAUSE_TIMEOUT,
                         *, now: datetime | None = None) -> dict:
    """A bot hits a wall and PAUSES its turn to ask for help.

    Returns the full record, including the resume_token the owner's resolve
    call needs. The turn is expected to hold until `state(token)` leaves
    `pending` or `expires_at` passes.
    """
    bot = _check_bot(bot_id)
    reason = _clean(reason, "reason")
    if not reason:
        raise InterventionError("reason is required — an intervention must say why")
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        raise InterventionError("timeout must be a positive number of seconds")
    token = f"iv_{uuid.uuid4().hex[:12]}_{secrets.token_hex(4)}"
    ts = now or _now()
    record = {
        "resume_token": token,
        "bot": bot,
        "reason": reason,
        "hint": _clean(hint, "hint"),
        "url": _clean(url, "url"),
        "state": "pending",
        "requested_at": _iso(ts),
        "expires_at": _iso(ts + timedelta(seconds=timeout)),
        # The turn this pause belongs to is open until the parent says
        # otherwise; once ended, the intervention can never be applied.
        "turn_ended": False,
    }
    _records[token] = record
    return dict(record)


def state(token: str, *, now: datetime | None = None) -> dict:
    """The honest current state of an intervention, including expiry.

    Expiry is evaluated lazily against `expires_at` and PERSISTED when seen,
    so a poll after the timeout always reports `expired` explicitly.
    `now` is injectable so callers (and tests) can reason at a fixed time.
    """
    record = _records.get(_clean(token, "resume_token"))
    if record is None:
        raise InterventionError("unknown intervention token")
    record = _tick(record, now)
    return dict(record)


def _tick(record: dict, now: datetime | None = None) -> dict:
    """Apply the pause timeout honestly: past expires_at + still pending →
    expired. Never re-opens a decided record."""
    if record["state"] != "pending":
        return record
    exp = _parse(record["expires_at"])
    if exp is not None and (now or _now()) >= exp:
        record["state"] = "expired"
    return record


def end_turn(token: str, *, now: datetime | None = None) -> dict:
    """The parent marks the targeted turn as ENDED (finished, errored, or
    aborted). Any pending intervention for that turn becomes explicitly
    expired — never applied — because the moment it targeted is gone."""
    record = _records.get(_clean(token, "resume_token"))
    if record is None:
        raise InterventionError("unknown intervention token")
    record["turn_ended"] = True
    if record["state"] == "pending":
        record["state"] = "expired"
        if now is not None:
            record["expires_at"] = _iso(now)  # honest: it lapsed right now
    return dict(record)


def resolve_intervention(token: str, action: str, note: str = "",
                         *, by: str, now: datetime | None = None) -> dict:
    """The OWNER acts on a paused bot: approve (release the turn), deny (the
    turn ends), or steer (approve with a steering note — still `accepted`,
    the note is plainly owner-attributed, not impersonated chat history).

    Refusals, all explicit:
    - `by` must be the owner; a bot — including the requesting bot itself —
      can never resolve (self-approval is not consent).
    - unknown token → error, not a shrug.
    - already-decided or expired record → returned as-is with its decided
      state; the new action is NOT applied (no silent overwrite of history).
    """
    by = _clean(by, "by")
    if not by or by.lower() not in _OWNER_NAMES:
        raise InterventionError(
            f"only the owner may resolve an intervention; {by!r} may not "
            "(self-approval is not consent)")
    action = _clean(action, "action").lower()
    if action not in _ACTIONS:
        raise InterventionError(
            f"action must be one of {sorted(_ACTIONS)}, got {action!r}")
    record = _records.get(_clean(token, "resume_token"))
    if record is None:
        raise InterventionError("unknown intervention token")
    record = _tick(record, now)
    if record["state"] != "pending":
        # Stale: return the honest decided state — never apply over it.
        return dict(record)
    if record["turn_ended"]:
        # Belt-and-braces: end_turn already expired it, but if it was
        # re-opened somehow the turn boundary still wins.
        record["state"] = "expired"
        return dict(record)
    record["state"] = "accepted" if action == "approve" else "rejected"
    record["resolved_by"] = "owner"
    record["resolved_at"] = _iso(now or _now())
    record["owner_action"] = action
    record["owner_note"] = _clean(note, "note")
    return dict(record)


def active_for_bot(bot_id: str, *, now: datetime | None = None) -> dict | None:
    """The pending intervention a bot is paused on, if any (post-expiry tick).
    The bot's paused turn resumes when this is None or state != pending."""
    bot = _check_bot(bot_id)
    for token in list(_records):
        record = _records.get(token)
        if record and record["bot"] == bot:
            record = _tick(record, now)
            if record["state"] == "pending":
                return dict(record)
    return None


def what_the_bot_was_told(token: str, *, now: datetime | None = None) -> dict:
    """The ONLY thing the paused bot learns when its pause clears: that the
    human finished, plus the optional owner-chosen note. Never what the owner
    typed on the screen, never a screenshot, never the credentials context."""
    record = state(token, now=now)
    if record["state"] == "pending":
        return {"resolved": False}
    return {
        "resolved": record["state"] in ("accepted", "expired"),
        "outcome": record["state"],
        "note": record.get("owner_note", ""),
    }


# --- SSE emission (same per-profile queue/drain model as balabot.handoffs) ---


def format_intervention_frame(record: dict) -> str:
    """The exact `event: intervention` SSE frame. Text fields only — reason,
    hint, url — no capture, no credentials field, no chat content."""
    payload = {
        "bot": record["bot"],
        "reason": record.get("reason", ""),
        "hint": record.get("hint", ""),
        "url": record.get("url", ""),
        "resume_token": record["resume_token"],
    }
    return (f"event: intervention\n"
            f"data: {json.dumps(payload, sort_keys=True)}\n\n")


def enqueue_intervention(record: dict) -> str:
    """Queue the intervention frame for the requesting bot's next chat stream,
    so the UI sees 'needs you' the moment it connects. Returns the frame."""
    frame = format_intervention_frame(record)
    _pending_frames.setdefault(record["bot"], []).append(frame)
    return frame


def drain_intervention_frames(profile: str) -> list[str]:
    """Pop queued intervention frames for `profile` as ready-to-yield frames.

    PARENT INTEGRATION (ui/server.py is owned elsewhere this wave): inside the
    `stream()` generator of the /api/chat route, alongside the existing
    `_drain_org_request_frames(profile)` and `drain_handoff_frames(profile)`
    loops, add:

        from balabot.intervention import drain_intervention_frames
        for frame in drain_intervention_frames(profile):
            yield frame
    """
    return _pending_frames.pop(profile, [])


def pending_intervention_count(profile: str) -> int:
    """Test/diagnostic peek — frames queued for `profile`."""
    return len(_pending_frames.get(profile, []))
