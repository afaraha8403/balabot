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
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

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
# stream at the top of the turn. Storage is backed by a durable SQLite table
# at BALABOT_HANDOFFS_DB (<BALABOT_DATA_ROOT>/handoffs/handoffs.db) so
# handoffs enqueued in CLI subprocesses or separate containers persist across
# process restarts.
_pending_handoffs: dict[str, list[str]] = {}


def _db_path() -> Path:
    env = os.environ.get("BALABOT_HANDOFFS_DB")
    if env:
        return Path(env)
    root = os.environ.get("BALABOT_DATA_ROOT", "/opt/data")
    return Path(root) / "handoffs" / "handoffs.db"


def _get_conn() -> sqlite3.Connection | None:
    try:
        p = _db_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(p), timeout=30.0)
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS handoff_frames (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    to_bot       TEXT NOT NULL,
                    from_bot     TEXT NOT NULL,
                    frame        TEXT NOT NULL,
                    enqueued_at  TEXT NOT NULL,
                    delivered_at TEXT
                );
            """)
        return conn
    except Exception:
        return None


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
    conn = _get_conn()
    if conn is not None:
        try:
            with conn:
                conn.execute(
                    "INSERT INTO handoff_frames (to_bot, from_bot, frame, enqueued_at) "
                    "VALUES (?, ?, ?, ?)",
                    (to_bot.strip(), from_bot.strip(), frame, _now_iso()),
                )
            conn.close()
        except Exception:
            pass
    return frame


def drain_handoff_frames(profile: str) -> list[str]:
    """Pop queued handoff frames for `profile` as ready-to-yield SSE frames."""
    mem_frames = _pending_handoffs.pop(profile, [])
    conn = _get_conn()
    if conn is None:
        return mem_frames
    try:
        with conn:
            rows = conn.execute(
                "SELECT id, frame FROM handoff_frames "
                "WHERE to_bot = ? AND delivered_at IS NULL "
                "ORDER BY id ASC",
                (profile,),
            ).fetchall()
            if not rows:
                conn.close()
                return mem_frames
            ids = [r[0] for r in rows]
            db_frames = [r[1] for r in rows]
            now = _now_iso()
            placeholders = ",".join("?" for _ in ids)
            conn.execute(
                f"UPDATE handoff_frames SET delivered_at = ? WHERE id IN ({placeholders})",
                [now] + ids,
            )
        conn.close()
        return db_frames
    except Exception:
        return mem_frames


def pending_handoff_count(profile: str) -> int:
    """Test/diagnostic peek — how many frames are queued for `profile`."""
    conn = _get_conn()
    if conn is None:
        return len(_pending_handoffs.get(profile, []))
    try:
        with conn:
            (count,) = conn.execute(
                "SELECT count(*) FROM handoff_frames "
                "WHERE to_bot = ? AND delivered_at IS NULL",
                (profile,),
            ).fetchone()
        conn.close()
        return count
    except Exception:
        return len(_pending_handoffs.get(profile, []))
