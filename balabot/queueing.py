"""Durable, per-session message queue for BalaBot — messages that arrive
while an agent is mid-turn are QUEUED, not dropped, and drain in FIFO
order at the top of that agent's next chat turn.

FIND-BEFORE-CREATE verdict (why this module exists): the repo already has
two pending stores, but neither is a per-SESSION ordered queue.
`balabot/bot_tools.py` keeps org request rows in a JSON file keyed by bot,
and `balabot/handoffs.py` keeps per-PROFILE handoff frames in an
in-memory dict (lost on restart, not per-session). This module is a
durable, per-session, ordered message queue using the SAME SQLite pattern
as `balabot/sessions.py` — one file, explicit path, no in-memory fallback.

Design (binding):

- DURABLE: every enqueue is committed to SQLite before the function
  returns. A process restart (new MessageQueue on the same file) sees
  exactly the same queue. There is no in-memory fallback — durability is
  the point.

- FIFO ORDER: rows get a monotonically increasing per-session `seq` at
  insert time; drain returns them in `seq` order. Two messages queued
  during one busy turn arrive in the order they were sent.

- AT-MOST-ONCE: drain claims rows with a conditional UPDATE
  (`... AND delivered_at IS NULL`) and only returns rows the UPDATE
  actually flipped. A row is delivered zero or one times, never twice,
  even if drain is called again before the turn finishes or after a
  crash between claim and send.

- HONEST FAILURE: if the queue cannot persist (unwritable store path,
  missing database directory, locked file), enqueue raises
  QueueStoreUnavailable — a typed error — and the message is NEVER
  silently accepted. A dropped user message is the worst outcome here,
  so enqueue fails loud instead.

- BUSY STATE: the caller marks the turn busy/idle; the state is stored
  (so a restart mid-turn stays busy) and exposed via queue_state() so
  the UI can show "queued" honestly instead of pretending delivery.

- SSE FRAMES: drain_sse_frames() yields ready-to-send frames in the
  exact grammar ui/src/api.ts already parses — `event: handoff` with
  {from, to, summary, at} — reusing format_handoff_frame so no new
  event type is invented and the UI needs zero changes.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from balabot.handoffs import format_handoff_frame

__all__ = [
    "QueueError",
    "QueueStoreUnavailable",
    "UnknownSession",
    "MessageQueue",
]

DEFAULT_DB_PATH = "/opt/data/sessions/queue.db"


class QueueError(RuntimeError):
    """Base: the queue is a hard dependency; failures are fatal, never silent."""


class QueueStoreUnavailable(QueueError):
    """The queue cannot persist (unwritable store). Fail LOUD — a message
    the queue cannot persist is refused, never silently accepted."""


class UnknownSession(QueueError):
    """The session id is not in the store. Fail loud — never auto-create."""


_SCHEMA = """
CREATE TABLE IF NOT EXISTS queue_messages (
    message_id   TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    content      TEXT NOT NULL,
    enqueued_at  TEXT NOT NULL,
    seq          INTEGER NOT NULL,
    delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS queue_turns (
    session_id TEXT PRIMARY KEY,
    busy       INTEGER NOT NULL DEFAULT 0
);
"""


def _env_db_path() -> Path:
    return Path(os.environ.get("BALABOT_QUEUE_DB", DEFAULT_DB_PATH))


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class MessageQueue:
    """SQLite-backed durable per-session message queue. One file, one owner."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        # Explicit path wins; otherwise env/default. Never a silent
        # in-memory fallback: durability is the point of this module.
        self._path = Path(db_path) if db_path is not None else _env_db_path()
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self._path), isolation_level=None,
                                         timeout=2.0)
            self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.executescript(_SCHEMA)
        except (sqlite3.Error, OSError) as exc:
            raise QueueStoreUnavailable(
                f"queue store unavailable at {self._path}: "
                f"{type(exc).__name__}: {exc}") from exc

    def close(self) -> None:
        self._conn.close()

    # ── turn state ────────────────────────────────────────────────────────

    def mark_busy(self, session_id: str) -> None:
        """The agent's turn started. Persisted so a restart mid-turn stays busy."""
        self._write(lambda: self._conn.execute(
            "INSERT INTO queue_turns (session_id, busy) VALUES (?, 1) "
            "ON CONFLICT(session_id) DO UPDATE SET busy = 1", (session_id,)))

    def mark_idle(self, session_id: str) -> None:
        self._write(lambda: self._conn.execute(
            "INSERT INTO queue_turns (session_id, busy) VALUES (?, 0) "
            "ON CONFLICT(session_id) DO UPDATE SET busy = 0", (session_id,)))

    def is_busy(self, session_id: str) -> bool:
        row = self._conn.execute(
            "SELECT busy FROM queue_turns WHERE session_id = ?",
            (session_id,)).fetchone()
        return bool(row and row[0])

    # ── enqueue ───────────────────────────────────────────────────────────

    def enqueue(self, session_id: str, content: str,
                message_id: str | None = None) -> dict:
        """Queue one message for `session_id`. Durable before return.

        Raises QueueStoreUnavailable if the write cannot persist — the
        message is refused loudly, never silently dropped.
        Idempotent on message_id: a re-sent id returns the existing row
        (at-most-once starts at enqueue time).
        """
        if not isinstance(content, str) or not content.strip():
            raise QueueError("content must be a non-empty string")
        mid = message_id or f"q-{_now_iso()}-{os.urandom(6).hex()}"
        at = _now_iso()

        existing = self._conn.execute(
            "SELECT message_id, session_id, content, enqueued_at, seq, delivered_at "
            "FROM queue_messages WHERE message_id = ?", (mid,)).fetchone()
        if existing is not None:
            if existing[1] != session_id:
                raise QueueError(f"message_id {mid!r} already queued for another session")
            return self._row_to_dict(existing)

        def _do() -> None:
            next_seq = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM queue_messages "
                "WHERE session_id = ?", (session_id,)).fetchone()[0]
            self._conn.execute(
                "INSERT INTO queue_messages (message_id, session_id, content, "
                "enqueued_at, seq, delivered_at) VALUES (?, ?, ?, ?, ?, NULL)",
                (mid, session_id, content, at, next_seq))

        self._write(_do)
        return {"message_id": mid, "session_id": session_id, "content": content,
                "enqueued_at": at, "seq": self._conn.execute(
                    "SELECT seq FROM queue_messages WHERE message_id = ?",
                    (mid,)).fetchone()[0],
                "delivered_at": None}

    # ── drain ─────────────────────────────────────────────────────────────

    def drain(self, session_id: str) -> list[dict]:
        """Pop all undelivered messages for `session_id` in FIFO order.

        Each row is claimed atomically with a conditional UPDATE checked
        by rowcount, so a row can only ever be returned once (at-most-once).
        """
        rows = self._conn.execute(
            "SELECT message_id, session_id, content, enqueued_at, seq, delivered_at "
            "FROM queue_messages WHERE session_id = ? AND delivered_at IS NULL "
            "ORDER BY seq ASC", (session_id,)).fetchall()
        delivered: list[dict] = []
        for row in rows:
            with self._conn:
                cur = self._conn.execute(
                    "UPDATE queue_messages SET delivered_at = ? "
                    "WHERE message_id = ? AND delivered_at IS NULL",
                    (_now_iso(), row[0]))
                if cur.rowcount != 1:
                    continue  # another drainer claimed it first
                delivered.append({**self._row_to_dict(row),
                                  "delivered_at": _now_iso()})
        return delivered

    def drain_messages(self, session_id: str, from_bot: str = "user",
                       to_bot: str = "") -> tuple[list[dict], list[str]]:
        """Drain undelivered messages for `session_id`, returning (messages, sse_frames).

        Frames use the existing `event: handoff` grammar (ui/src/api.ts
        parses {from, to, summary, at}) — no new event type is invented.
        Delivery state is committed in the same pass, so draining is
        at-most-once even across restarts.
        """
        msgs = self.drain(session_id)
        frames: list[str] = []
        for m in msgs:
            frames.append(format_handoff_frame(
                from_bot, to_bot or m["session_id"],
                summary=m["content"], at=m["enqueued_at"]))
        return msgs, frames

    def drain_sse_frames(self, session_id: str, from_bot: str = "user",
                         to_bot: str = "") -> list[str]:
        """Drain as ready-to-yield SSE frames the UI already parses.

        Frames use the existing `event: handoff` grammar (ui/src/api.ts
        parses {from, to, summary, at}) — no new event type is invented.
        Delivery state is committed in the same pass, so draining is
        at-most-once even across restarts.
        """
        _, frames = self.drain_messages(session_id, from_bot=from_bot, to_bot=to_bot)
        return frames

    # ── state for the UI ("queued" shown honestly) ────────────────────────

    def pending_count(self, session_id: str) -> int:
        return self._conn.execute(
            "SELECT COUNT(*) FROM queue_messages "
            "WHERE session_id = ? AND delivered_at IS NULL",
            (session_id,)).fetchone()[0]

    def queue_state(self, session_id: str) -> dict:
        """Honest queue state for the UI: busy flag + pending messages in order."""
        rows = self._conn.execute(
            "SELECT message_id, content, enqueued_at, seq FROM queue_messages "
            "WHERE session_id = ? AND delivered_at IS NULL ORDER BY seq ASC",
            (session_id,)).fetchall()
        return {
            "session_id": session_id,
            "busy": self.is_busy(session_id),
            "pending_count": len(rows),
            "pending": [{"message_id": r[0], "content": r[1],
                         "enqueued_at": r[2], "seq": r[3]} for r in rows],
        }

    def require_session(self, session_id: str) -> None:
        if self._conn.execute(
                "SELECT 1 FROM queue_turns WHERE session_id = ?",
                (session_id,)).fetchone() is None:
            raise UnknownSession(f"unknown session {session_id!r}")

    # ── internals ─────────────────────────────────────────────────────────

    def _write(self, fn) -> None:
        try:
            fn()
            self._conn.commit()
        except (sqlite3.Error, OSError) as exc:
            raise QueueStoreUnavailable(
                f"queue store write failed at {self._path}: "
                f"{type(exc).__name__}: {exc}") from exc

    @staticmethod
    def _row_to_dict(row) -> dict:
        return {"message_id": row[0], "session_id": row[1], "content": row[2],
                "enqueued_at": row[3], "seq": row[4], "delivered_at": row[5]}
