"""Durable, server-side session + purpose-record store for BalaBot.

WHY: BalaBot's conversations currently live only in the browser's
localStorage — there is NO server-side conversation store, so the UI
filters `s.botId === activeBotId` over client state and Jev cannot route
or checkpoint over state that does not exist. This module makes sessions
durable server-side state in ONE SQLite file, created on demand at
BALABOT_CONTINUITY_DB (default /opt/data/sessions/continuity.db — the
in-container path; tests pass an explicit tmp_path instead).

Design (binding, from the approved plan):

- PURPOSE RECORDS WITH SPANS. A session records its stated purpose plus
  the topics it covered as SPANS — {topic, start_seq, end_seq} — not as
  a merged description. A session that ran topic A over messages 1-40
  then topic B over 41-90 stores TWO spans. A merged "A and B" string
  is useless as a routing key (it matches everything and nothing);
  spans stay addressable.

- APPEND/SPLIT RULES (explicit): appending a topic that EQUALS the
  currently-open span's topic EXTENDS that span's end_seq; a DIFFERENT
  topic CLOSES the open span and opens a new one starting at the next
  sequence. There is exactly one open span per session at a time.

- RESUME STATE: whatever the caller needs to rebuild the session's
  mandate (not just its topic) after compaction — a free-form
  JSON-serialisable dict.

- DECISIONS: appended records of (text, provenance, timestamp) so the
  governor's ledger has a source.

- COMPACTION BOOKKEEPING: record_compaction() tracks compaction_count
  and last_compaction_at. churn_report() returns sessions that
  compacted at least N times — a session compacting repeatedly is
  thrashing, and thrashing is a SYMPTOM to surface, not normal
  operation.

- re_anchor() is the single most important function: it returns a
  deterministic JSON-able bundle — purpose + ordered topic spans +
  decisions + resume_state + a recent-message window label — so that
  after compaction the session rebuilds from GROUND TRUTH, not from a
  summary-of-a-summary.

- FAIL LOUD: reads on an unknown session id raise UnknownSession; the
  store never auto-creates a session on a read path and never returns
  a silent default.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

__all__ = [
    "SessionError",
    "UnknownSession",
    "SessionStore",
    "backup_sessions_db",
    "verify_sessions_integrity",
    "get_product_store_paths",
    "sweep_wal_mode",
]

DEFAULT_DB_PATH = "/opt/data/sessions/continuity.db"
RECENT_WINDOW_LABEL = "last-20-messages"


class SessionError(RuntimeError):
    """Base: the session store is a hard dependency; failures are fatal."""


class UnknownSession(SessionError):
    """The session id is not in the store. Fail loud — never auto-create."""


_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT PRIMARY KEY,
    bot_id          TEXT NOT NULL,
    purpose         TEXT NOT NULL,
    resume_state    TEXT NOT NULL DEFAULT '{}',
    next_seq        INTEGER NOT NULL DEFAULT 1,
    compaction_count        INTEGER NOT NULL DEFAULT 0,
    last_compaction_at      TEXT
);
CREATE TABLE IF NOT EXISTS topic_spans (
    session_id  TEXT NOT NULL REFERENCES sessions(session_id),
    topic       TEXT NOT NULL,
    start_seq   INTEGER NOT NULL,
    end_seq     INTEGER NOT NULL,
    PRIMARY KEY (session_id, start_seq)
);
CREATE TABLE IF NOT EXISTS decisions (
    session_id  TEXT NOT NULL REFERENCES sessions(session_id),
    text        TEXT NOT NULL,
    provenance  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    seq         INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    seq        INTEGER NOT NULL
);
"""


def _env_db_path() -> Path:
    return Path(os.environ.get("BALABOT_CONTINUITY_DB", DEFAULT_DB_PATH))


class SessionStore:
    """SQLite-backed durable session store. One file, one owner."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        # Explicit path wins; otherwise env/default. Never a silent in-memory
        # fallback: durability is the point of this module.
        self._path = Path(db_path) if db_path is not None else _env_db_path()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._path))
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def backup(self, dest_path: str | Path) -> Path:
        """Create an online, consistent backup of the sessions database.

        Uses SQLite's online backup API, which safely copies pages even
        while concurrent WAL writes or readers are active.
        """
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(dest)) as dest_conn:
            self._conn.backup(dest_conn)
        return dest

    def integrity_check(self) -> bool:
        """Verify SQLite database integrity via PRAGMA integrity_check.

        Returns True if the check returns 'ok', False otherwise.
        """
        rows = self._conn.execute("PRAGMA integrity_check").fetchall()
        return len(rows) == 1 and rows[0][0].lower() == "ok"

    def __enter__(self) -> "SessionStore":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Session creation
    # ------------------------------------------------------------------

    def create_session(self, session_id: str, bot_id: str, purpose: str) -> None:
        """Create a session with its stated purpose. Fails loud if the id
        already exists — silently overwriting a session would destroy the
        very history this module exists to keep."""
        try:
            self._conn.execute(
                "INSERT INTO sessions (session_id, bot_id, purpose) VALUES (?, ?, ?)",
                (session_id, bot_id, purpose),
            )
        except sqlite3.IntegrityError as e:
            raise SessionError(f"session {session_id!r} already exists") from e
        self._conn.commit()

    # ------------------------------------------------------------------
    # Topics with spans
    # ------------------------------------------------------------------

    def record_topic(self, session_id: str, topic: str) -> None:
        """Record that the session is now on `topic` at the next sequence.

        Rules (binding):
        - Same topic as the currently OPEN span -> EXTEND it (end_seq moves
          to the next sequence). No duplicate span is created.
        - Different topic (or no open span) -> CLOSE the open span and OPEN
          a new one at the next sequence. Spans never overlap.
        """
        self._require(session_id)
        seq = self._next_seq(session_id)
        open_span = self._open_span(session_id)
        if open_span is not None and open_span[0] == topic:
            self._conn.execute(
                "UPDATE topic_spans SET end_seq = ? "
                "WHERE session_id = ? AND start_seq = ?",
                (seq, session_id, open_span[1]),
            )
        else:
            self._conn.execute(
                "INSERT INTO topic_spans (session_id, topic, start_seq, end_seq) "
                "VALUES (?, ?, ?, ?)",
                (session_id, topic, seq, seq),
            )
        self._bump_seq(session_id)
        self._conn.commit()

    def topic_spans(self, session_id: str) -> list[dict[str, Any]]:
        """Ordered topic spans: [{topic, start_seq, end_seq}, ...]."""
        self._require(session_id)
        rows = self._conn.execute(
            "SELECT topic, start_seq, end_seq FROM topic_spans "
            "WHERE session_id = ? ORDER BY start_seq",
            (session_id,),
        ).fetchall()
        return [
            {"topic": t, "start_seq": s, "end_seq": e} for (t, s, e) in rows
        ]

    # ------------------------------------------------------------------
    # Resume state
    # ------------------------------------------------------------------

    def set_resume_state(self, session_id: str, resume_state: dict[str, Any]) -> None:
        """Replace the session's resume_state — whatever is needed to rebuild
        the session's mandate after compaction, not just its topic."""
        self._require(session_id)
        try:
            blob = json.dumps(resume_state, sort_keys=True)
        except (TypeError, ValueError) as e:
            raise SessionError(f"resume_state is not JSON-serialisable: {e}") from e
        self._conn.execute(
            "UPDATE sessions SET resume_state = ? WHERE session_id = ?",
            (blob, session_id),
        )
        self._conn.commit()

    def resume_state(self, session_id: str) -> dict[str, Any]:
        self._require(session_id)
        (blob,) = self._conn.execute(
            "SELECT resume_state FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return json.loads(blob)

    # ------------------------------------------------------------------
    # Decisions
    # ------------------------------------------------------------------

    def record_decision(
        self, session_id: str, text: str, provenance: str, *, at: str
    ) -> None:
        """Append a decision record (text, provenance, timestamp) so the
        governor's ledger has a source. `at` is an ISO timestamp supplied by
        the caller — this module never invents time."""
        self._require(session_id)
        seq = self._next_seq(session_id)
        self._conn.execute(
            "INSERT INTO decisions (session_id, text, provenance, created_at, seq) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, text, provenance, at, seq),
        )
        self._bump_seq(session_id)
        self._conn.commit()

    def decisions(self, session_id: str) -> list[dict[str, Any]]:
        self._require(session_id)
        rows = self._conn.execute(
            "SELECT text, provenance, created_at FROM decisions "
            "WHERE session_id = ? ORDER BY seq",
            (session_id,),
        ).fetchall()
        return [
            {"text": t, "provenance": p, "created_at": a} for (t, p, a) in rows
        ]

    # ------------------------------------------------------------------
    # Conversation transcript messages
    # ------------------------------------------------------------------

    def record_message(
        self,
        session_id: str,
        role: str,
        content: str,
        *,
        message_id: str | None = None,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        """Record a user or assistant message to the session's durable transcript."""
        self._require(session_id)
        if not isinstance(role, str) or not role.strip():
            raise SessionError("role must be a non-empty string")
        if not isinstance(content, str):
            raise SessionError("content must be a string")
        mid = message_id or f"m_{int(time.time() * 1000):x}_{secrets.token_hex(4)}"
        at = created_at or datetime.now(timezone.utc).isoformat()
        row = self._conn.execute(
            "SELECT message_id, session_id, role, content, created_at, seq FROM messages WHERE message_id = ?",
            (mid,),
        ).fetchone()
        if row is not None:
            return {
                "message_id": row[0],
                "session_id": row[1],
                "role": row[2],
                "content": row[3],
                "created_at": row[4],
                "seq": row[5],
            }
        seq = self._next_seq(session_id)
        self._conn.execute(
            "INSERT INTO messages (message_id, session_id, role, content, created_at, seq) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (mid, session_id, role.strip(), content, at, seq),
        )
        self._bump_seq(session_id)
        self._conn.commit()
        return {
            "message_id": mid,
            "session_id": session_id,
            "role": role.strip(),
            "content": content,
            "created_at": at,
            "seq": seq,
        }

    def messages(
        self,
        session_id: str,
        *,
        since_seq: int | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Ordered conversation messages for a session: [{message_id, session_id, role, content, created_at, seq}, ...]."""
        self._require(session_id)
        query = (
            "SELECT message_id, session_id, role, content, created_at, seq FROM messages "
            "WHERE session_id = ?"
        )
        params: list[Any] = [session_id]
        if since_seq is not None and since_seq > 0:
            query += " AND seq > ?"
            params.append(since_seq)
        query += " ORDER BY seq ASC"
        if limit is not None and limit > 0:
            query += " LIMIT ?"
            params.append(limit)
        rows = self._conn.execute(query, params).fetchall()
        return [
            {
                "message_id": mid,
                "session_id": sid,
                "role": r,
                "content": c,
                "created_at": ca,
                "seq": s,
            }
            for (mid, sid, r, c, ca, s) in rows
        ]

    def compact(
        self,
        session_id: str,
        *,
        protect_first_n: int = 3,
        protect_last_n: int = 20,
        at: str | None = None,
    ) -> dict[str, Any]:
        """Prune the transcript's middle server-side: keep an immortal head, a
        live tail, and the newest user turn; drop everything between them.

        BOUNDED — only messages OUTSIDE the first+last window are removed, so
        re-running at the floor prunes nothing. RECORDED via
        record_compaction() so churn is visible to churn_report().

        Returns {pruned, remaining, protected, compaction_count,
        last_compaction_at}. `at` is an ISO timestamp supplied by the caller;
        when omitted the current time is used only to stamp the bookkeeping."""
        self._require(session_id)
        rows = self._conn.execute(
            "SELECT seq, role FROM messages WHERE session_id = ? ORDER BY seq ASC",
            (session_id,),
        ).fetchall()
        seqs = [s for (s, _) in rows]
        roles = {s: r for (s, r) in rows}
        total = len(seqs)
        head = seqs[: max(protect_first_n, 0)]
        tail = seqs[max(0, total - max(protect_last_n, 0)) :]
        window = list(dict.fromkeys(head + tail))
        keep = set(window)
        # A compaction that dropped the user's latest message would sever the
        # live thread mid-turn, so the newest user turn is retained even when
        # it falls outside the tail window.
        for s in reversed(seqs):
            if roles.get(s) == "user":
                keep.add(s)
                break
        drop = [s for s in seqs if s not in keep]
        if drop:
            placeholders = ",".join("?" for _ in drop)
            self._conn.execute(
                f"DELETE FROM messages WHERE session_id = ? AND seq IN ({placeholders})",
                [session_id, *drop],
            )
        stamp = at or datetime.now(timezone.utc).isoformat()
        self.record_compaction(session_id, at=stamp)
        row = self._conn.execute(
            "SELECT compaction_count, last_compaction_at FROM sessions "
            "WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        self._conn.commit()
        return {
            "pruned": len(drop),
            "remaining": total - len(drop),
            "protected": len(keep),
            "compaction_count": row[0],
            "last_compaction_at": row[1],
        }

    # ------------------------------------------------------------------
    # Compaction bookkeeping
    # ------------------------------------------------------------------

    def record_compaction(self, session_id: str, *, at: str) -> None:
        self._require(session_id)
        self._conn.execute(
            "UPDATE sessions SET compaction_count = compaction_count + 1, "
            "last_compaction_at = ? WHERE session_id = ?",
            (at, session_id),
        )
        self._conn.commit()

    def churn_report(self, min_compactions: int) -> list[dict[str, Any]]:
        """Sessions that compacted at least `min_compactions` times. A session
        compacting repeatedly is THRASHING — a symptom, not normal operation."""
        rows = self._conn.execute(
            "SELECT session_id, bot_id, compaction_count, last_compaction_at "
            "FROM sessions WHERE compaction_count >= ? "
            "ORDER BY compaction_count DESC, session_id",
            (min_compactions,),
        ).fetchall()
        return [
            {
                "session_id": sid,
                "bot_id": bid,
                "compaction_count": n,
                "last_compaction_at": at,
            }
            for (sid, bid, n, at) in rows
        ]

    # ------------------------------------------------------------------
    # Product surface
    # ------------------------------------------------------------------

    def list_sessions(self, bot_id: str) -> list[dict[str, Any]]:
        """All sessions for a bot, newest activity first."""
        rows = self._conn.execute(
            "SELECT s.session_id, s.purpose, s.next_seq, s.compaction_count, "
            "s.last_compaction_at, "
            "(SELECT created_at FROM messages WHERE session_id = s.session_id ORDER BY seq DESC LIMIT 1) "
            "FROM sessions s WHERE s.bot_id = ? "
            "ORDER BY (SELECT created_at FROM messages WHERE session_id = s.session_id ORDER BY seq DESC LIMIT 1) DESC NULLS LAST, s.rowid DESC",
            (bot_id,),
        ).fetchall()
        return [
            {
                "session_id": sid,
                "purpose": purpose,
                "next_seq": nseq,
                "compaction_count": n,
                "last_compaction_at": at,
                "last_activity": last_act,
            }
            for (sid, purpose, nseq, n, at, last_act) in rows
        ]

    # ------------------------------------------------------------------
    # re_anchor — the single most important function
    # ------------------------------------------------------------------

    def re_anchor(self, session_id: str) -> dict[str, Any]:
        """A deterministic JSON-able bundle for rebuilding context from ground
        truth rather than from the previous summary: purpose + ordered topic
        spans + decisions + resume_state + a recent-message window label."""
        self._require(session_id)
        (purpose, resume_blob) = self._conn.execute(
            "SELECT purpose, resume_state FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return {
            "session_id": session_id,
            "purpose": purpose,
            "topic_spans": self.topic_spans(session_id),
            "decisions": self.decisions(session_id),
            "resume_state": json.loads(resume_blob),
            "recent_window": RECENT_WINDOW_LABEL,
        }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _require(self, session_id: str) -> None:
        row = self._conn.execute(
            "SELECT 1 FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise UnknownSession(f"unknown session id: {session_id!r}")

    def _next_seq(self, session_id: str) -> int:
        (n,) = self._conn.execute(
            "SELECT next_seq FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
        return n

    def _bump_seq(self, session_id: str) -> None:
        self._conn.execute(
            "UPDATE sessions SET next_seq = next_seq + 1 WHERE session_id = ?",
            (session_id,),
        )

    def _open_span(self, session_id: str) -> tuple[str, int] | None:
        """(topic, start_seq) of the latest span, or None if no spans yet.
        The latest span is the open one — there is exactly one at a time."""
        row = self._conn.execute(
            "SELECT topic, start_seq FROM topic_spans WHERE session_id = ? "
            "ORDER BY start_seq DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        return (row[0], row[1]) if row is not None else None


# ----------------------------------------------------------------------
# Backup, Restore, and Integrity Verification
# ----------------------------------------------------------------------
# Restore drill:
#   1. Stop balabot / worker processes writing to continuity.db.
#   2. Remove existing journal/wal files if replacing DB:
#      rm -f /opt/data/sessions/continuity.db-wal /opt/data/sessions/continuity.db-shm
#   3. Copy backup file over existing store:
#      cp /path/to/backup.db /opt/data/sessions/continuity.db
#   4. Verify integrity:
#      python -m balabot.sessions verify
#   5. Start services.


def backup_sessions_db(dest_path: str | Path | None = None) -> Path:
    """Create an online, consistent backup of the sessions database.

    Uses SQLite's online backup API (VACUUM INTO / conn.backup), ensuring
    consistent point-in-time snapshot without taking the database offline.
    """
    db_path = _env_db_path()
    if dest_path is None:
        now_ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        target = db_path.parent / f"continuity_backup_{now_ts}.db"
    else:
        target = Path(dest_path)
    with SessionStore(db_path) as store:
        return store.backup(target)


def verify_sessions_integrity() -> bool:
    """Verify continuity database integrity via PRAGMA integrity_check."""
    db_path = _env_db_path()
    if not db_path.exists():
        return True
    with SessionStore(db_path) as store:
        return store.integrity_check()


# ----------------------------------------------------------------------
# Product-Owned Durable Store Discovery and WAL Mode Enforcement
# ----------------------------------------------------------------------


def get_product_store_paths(
    data_root: str | Path | None = None,
    hermes_home: str | Path | None = None,
) -> list[Path]:
    """Return the list of all product-owned durable SQLite store paths.

    Single source of truth for durable product stores across boot sweep
    and acceptance / invariant tests.
    """
    root = (
        Path(data_root)
        if data_root is not None
        else Path(os.environ.get("BALABOT_DATA_ROOT", "/opt/data"))
    )
    if hermes_home is not None:
        home = Path(hermes_home)
    else:
        env_home = os.environ.get("HERMES_HOME")
        home = Path(env_home) if env_home else root

    paths: list[Path] = []

    # 1. Continuity store (balabot.sessions)
    cont_env = os.environ.get("BALABOT_CONTINUITY_DB")
    paths.append(Path(cont_env) if cont_env else (root / "sessions" / "continuity.db"))

    # 2. Queue store (balabot.queueing)
    q_env = os.environ.get("BALABOT_QUEUE_DB")
    paths.append(Path(q_env) if q_env else (root / "sessions" / "queue.db"))
    if (root / "queue" / "queue.db").exists():
        paths.append(root / "queue" / "queue.db")

    # 3. Inter-bot handoffs store (balabot.handoffs)
    h_env = os.environ.get("BALABOT_HANDOFFS_DB")
    paths.append(Path(h_env) if h_env else (root / "handoffs" / "handoffs.db"))

    # 4. Human intervention store (balabot.intervention)
    iv_env = os.environ.get("BALABOT_INTERVENTIONS_DB")
    paths.append(Path(iv_env) if iv_env else (root / "interventions" / "interventions.db"))

    # 5. balabot-jev memory plugin stores (root and profile homes)
    paths.append(home / "memory" / "balabot-jev" / "continuity.db")

    profiles_dir = home / "profiles"
    profile_names = {"principal", "governor"}
    if profiles_dir.is_dir():
        for child in sorted(profiles_dir.iterdir()):
            if child.is_dir():
                profile_names.add(child.name)
    for name in sorted(profile_names):
        paths.append(profiles_dir / name / "memory" / "balabot-jev" / "continuity.db")

    seen: set[str] = set()
    deduped: list[Path] = []
    for p in paths:
        try:
            norm = str(p.resolve())
        except Exception:
            norm = str(p)
        if norm not in seen:
            seen.add(norm)
            deduped.append(p)
    return deduped


def sweep_wal_mode(
    store_paths: Iterable[Path | str] | None = None,
    data_root: str | Path | None = None,
    hermes_home: str | Path | None = None,
) -> list[str]:
    """Idempotent sweep applying PRAGMA journal_mode = WAL across product stores.

    Tolerates missing files, locked databases, and non-product/corrupt files.
    Never fails container startup. Logs what it changed.
    """
    targets = (
        [Path(p) for p in store_paths]
        if store_paths is not None
        else get_product_store_paths(data_root=data_root, hermes_home=hermes_home)
    )
    actions: list[str] = []
    for path in targets:
        if not path.is_file():
            actions.append(f"{path} (absent, skipped)")
            continue

        try:
            conn = sqlite3.connect(str(path), timeout=5.0)
            try:
                row = conn.execute("PRAGMA journal_mode").fetchone()
                current_mode = (row[0] if row else "").lower()
                if current_mode != "wal":
                    row = conn.execute("PRAGMA journal_mode = WAL").fetchone()
                    new_mode = (row[0] if row else "").lower()
                    actions.append(f"{path} journal_mode: {current_mode} -> {new_mode}")
                else:
                    actions.append(f"{path} journal_mode: already wal")
            finally:
                conn.close()
        except sqlite3.OperationalError as exc:
            print(f"[balabot] WARNING: WAL sweep: {path} is locked/busy ({exc})")
            actions.append(f"{path} locked ({exc})")
        except sqlite3.DatabaseError as exc:
            print(f"[balabot] WARNING: WAL sweep: {path} is not a valid SQLite database ({exc})")
            actions.append(f"{path} invalid ({exc})")
        except Exception as exc:
            print(f"[balabot] WARNING: WAL sweep: {path} unexpected error ({exc})")
            actions.append(f"{path} error ({exc})")

        # Best-effort chown to runtime user hermes if running as root on POSIX
        if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
            try:
                import pwd
                rec = pwd.getpwnam("hermes")
                for ext in ("", "-wal", "-shm"):
                    sp = Path(str(path) + ext)
                    if sp.exists():
                        os.chown(sp, rec.pw_uid, rec.pw_gid)
            except Exception:
                pass

    return actions


if __name__ == "__main__":
    import sys
    argv = sys.argv[1:]
    if argv[:1] == ["backup"]:
        dest = argv[1] if len(argv) > 1 else None
        p = backup_sessions_db(dest)
        print(json.dumps({"ok": True, "backup_path": str(p)}, indent=2))
        sys.exit(0)
    if argv[:1] == ["verify"]:
        ok = verify_sessions_integrity()
        print(json.dumps({"ok": ok, "status": "ok" if ok else "corrupt"}, indent=2))
        sys.exit(0 if ok else 1)
    if argv[:1] == ["sweep-wal"]:
        actions = sweep_wal_mode()
        print(json.dumps({"ok": True, "actions": actions}, indent=2))
        sys.exit(0)
    print("usage: python -m balabot.sessions backup [dest] | verify | sweep-wal", file=sys.stderr)
    sys.exit(2)