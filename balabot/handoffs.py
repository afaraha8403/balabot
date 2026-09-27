"""Bot-to-bot handoff frames — the producer for the UI's `event: handoff` SSE.

The UI has always been able to render handoffs: `ui/src/api.ts` parses
`event: handoff` payloads as `{from, to, summary, at}` and `App.tsx` renders a
from→to system row per handoff. Until now nothing in production EMITTED that
frame — the only emitter in the repo was a test fixture — so the renderer was
dead code. This module is the real producer.

Frame grammar (copied from the documented working grammar in ui/server.py,
"the same frame grammar the working `event: handoff` frames use", and parsed
by ui/src/api.ts:254):

    event: handoff
    data: {"from": "<bot>", "to": "<bot>", "summary": "...", "at": "<ISO8601Z>"}
    <blank line>

A data line is exactly one JSON object with the four keys the UI reads.
No secret value, no message body beyond the summary the sender chose to
publish — this frame is a transcript-visibility notice, not a transport.

Server-side emission model (same as the org-request frames): the chat
passthrough is a plain OpenAI-compatible stream with no handoff event of its
own, so frames are QUEUED per profile here and drained at the top of that
profile's /api/chat stream. ui/server.py owns its own SSE loop — the one-line
integration hook for the parent is in the module docstring of the drain
function and in the commit message, not here.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

__all__ = [
    "HandoffError",
    "format_handoff_frame",
    "enqueue_handoff",
    "drain_handoff_frames",
    "pending_handoff_count",
]


class HandoffError(ValueError):
    """A handoff request is malformed or violates the roster/owner rules."""


# Names a bot may NEVER claim in a handoff `from` — owner impersonation is
# refused outright. The human ("Ali") is not a bot and never a frame sender.
_OWNER_NAMES = frozenset({"user", "ali", "owner", "human", "admin"})


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_handoff_frame(from_bot: str, to_bot: str, summary: str = "",
                         at: str | None = None) -> str:
    """The exact `event: handoff` SSE frame the UI parses. Pure formatting —
    no state, no network. `at` is injectable so tests are deterministic."""
    for name in (from_bot, to_bot):
        if not isinstance(name, str) or not name.strip():
            raise HandoffError("from/to must be non-empty strings")
    if not isinstance(summary, str):
        raise HandoffError("summary must be a string")
    payload = {
        "from": from_bot.strip(),
        "to": to_bot.strip(),
        "summary": summary,
        "at": at or _now_iso(),
    }
    return (f"event: handoff\n"
            f"data: {json.dumps(payload, sort_keys=True)}\n\n")


# Pending handoff frames, per profile, drained by that profile's /api/chat SSE
# stream at the top of the turn — the same pattern ui/server.py documents for
# the org-request queue.
_pending_handoffs: dict[str, list[str]] = {}


def enqueue_handoff(from_bot: str, to_bot: str, summary: str = "") -> str:
    """Queue a handoff frame for `to_bot`'s next chat stream. Returns the
    frame text. Refuses owner impersonation: `from_bot` may never be a human
    identity — only rostered bots produce handoffs."""
    if from_bot.strip().lower() in _OWNER_NAMES:
        raise HandoffError(
            f"{from_bot!r} is a human identity — a bot can never send a "
            "handoff as the owner")
    frame = format_handoff_frame(from_bot, to_bot, summary)
    _pending_handoffs.setdefault(to_bot.strip(), []).append(frame)
    return frame


def drain_handoff_frames(profile: str) -> list[str]:
    """Pop queued handoff frames for `profile` as ready-to-yield SSE frames.

    PARENT INTEGRATION (ui/server.py is owned elsewhere this wave): inside the
    `stream()` generator of the /api/chat route, alongside the existing
    `_drain_org_request_frames(profile)` loop, add:

        from balabot.handoffs import drain_handoff_frames
        for frame in drain_handoff_frames(profile):
            yield frame
    """
    return _pending_handoffs.pop(profile, [])


def pending_handoff_count(profile: str) -> int:
    """Test/diagnostic peek — how many frames are queued for `profile`."""
    return len(_pending_handoffs.get(profile, []))
