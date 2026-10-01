"""Screen leases — one agent holds one screen (a display/session resource) at a time.

A *screen* is a display/session resource (a bot's X display, a take-over
target). A *lease* is the time-boxed right for exactly one agent to hold that
screen. The lifecycle is explicit over HTTP:

    acquire(agent, resource)          none    -> active
    release(lease, holder)            active  -> released
    force_release(lease, owner, why)  active  -> force_released  (owner only)
    expiry (lazy, on read and sweep)  active  -> expired

Every transition appends exactly one immutable audit row (who / from->to /
when / why). A transition with no audit row is a bug; the audit trail is the
point of this module. Renewal is NOT a transition: a holder re-acquiring the
same resource extends ``expires_at`` in place and appends no row, so the count
of audit rows equals the count of state transitions.

Design decisions (binding):

- **TTL 60 s default**, renewed by re-acquire. Expiry is evaluated *on read*
  (a lease past ``expires_at`` reads as ``expired``) and swept *lazily* by the
  list/audit paths, so no background timer is required.
- **No silent stealing.** Acquiring a resource already actively leased to a
  different agent is refused with an error that names the holder. Only
  ``force_release`` (owner only, reason required) takes a lease away, and it is
  audited like every other transition.
- **No lost updates.** An expiry sweep reads active leases and then flips each
  one with a conditional ``UPDATE ... WHERE state = 'active'``; it appends the
  expiry audit row only when *this* call actually changed the row. A release
  that landed between the sweep's read and its write therefore cannot be
  reverted to `expired`, and no phantom audit row is written. This mirrors the
  guard in ``balabot/intervention.py`` (``_db_expire_if_pending``): never write
  back a whole record you merely read.
- **Illegal states are unrepresentable.** A partial unique index on
  ``resource_id WHERE state = 'active'`` guarantees at most one active lease
  per resource at the storage layer; a racing acquire that loses surfaces as an
  explicit refusal naming the holder, never a second active row.
"""

from __future__ import annotations

import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

__all__ = [
    "LeaseError",
    "LeaseNotFound",
    "DEFAULT_TTL",
    "acquire_lease",
    "release_lease",
    "force_release",
    "expire_leases",
    "get_lease",
    "list_leases",
    "list_audit",
    "active_lease_for_resource",
]

DEFAULT_TTL = 60.0  # seconds a lease may sit unrenewed
# The states a lease can be observed in — always explicit, never silent.
_STATES = frozenset({"active", "released", "expired", "force_released"})
# Owner identities a bot may never claim — same refusal rule as intervention.
_OWNER_NAMES = frozenset({"user", "ali", "owner", "human", "admin"})
_EXPIRY_ACTOR = "system"
_EXPIRY_REASON = "ttl_elapsed"


class LeaseError(ValueError):
    """A lease operation violates the screen-lease rules."""


class LeaseNotFound(LeaseError):
    """The referenced lease id does not exist."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _clean(text: str | None, field: str) -> str:
    if text is None:
        return ""
    if not isinstance(text, str):
        raise LeaseError(f"{field} must be a string")
    return text.strip()


def _check_agent(agent_id: str) -> str:
    agent = _clean(agent_id, "agent_id")
    if not agent:
        raise LeaseError("agent_id must be a non-empty string")
    return agent


def _check_owner(actor: str) -> str:
    who = _clean(actor, "actor")
    if not who or who.lower() not in _OWNER_NAMES:
        raise LeaseError(f"only the owner may force-release a lease; {actor!r} may not")
    return who


# Storage: durable SQLite database backed by BALABOT_SCREEN_LEASES_DB
# (default: <BALABOT_DATA_ROOT>/screen_leases/screen_leases.db).


def _db_path() -> Path:
    env = os.environ.get("BALABOT_SCREEN_LEASES_DB")
    if env:
        return Path(env)
    root = os.environ.get("BALABOT_DATA_ROOT", "/opt/data")
    return Path(root) / "screen_leases" / "screen_leases.db"


def _db_conn() -> sqlite3.Connection:
    p = _db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), timeout=30.0)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.row_factory = sqlite3.Row
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS screen_leases (
                lease_id    TEXT PRIMARY KEY,
                agent_id    TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                state       TEXT NOT NULL DEFAULT 'active',
                acquired_at TEXT NOT NULL,
                expires_at  TEXT NOT NULL,
                released_at TEXT,
                reason      TEXT NOT NULL DEFAULT ''
            );
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS screen_lease_audit (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                lease_id   TEXT NOT NULL,
                actor      TEXT NOT NULL,
                from_state TEXT NOT NULL,
                to_state   TEXT NOT NULL,
                at         TEXT NOT NULL,
                reason     TEXT NOT NULL DEFAULT ''
            );
        """)
        # At most one ACTIVE lease per resource — enforced in storage so a
        # racing acquire can never create two holders for one screen.
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_screen_leases_active_resource
            ON screen_leases(resource_id) WHERE state = 'active';
        """)
    return conn


def _row_to_lease(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["released_at"] = d.get("released_at")
    d["reason"] = d.get("reason") or ""
    return d


def _append_audit(
    conn: sqlite3.Connection,
    lease_id: str,
    actor: str,
    from_state: str,
    to_state: str,
    at: str,
    reason: str,
) -> None:
    """Append one immutable audit row for a single state transition."""
    conn.execute(
        """
        INSERT INTO screen_lease_audit
            (lease_id, actor, from_state, to_state, at, reason)
        VALUES (?, ?, ?, ?, ?, ?)
    """,
        (lease_id, actor, from_state, to_state, at, reason),
    )


def _db_get(lease_id: str) -> dict | None:
    conn = _db_conn()
    try:
        row = conn.execute(
            "SELECT * FROM screen_leases WHERE lease_id = ?", (lease_id,)
        ).fetchone()
        return _row_to_lease(row) if row is not None else None
    finally:
        conn.close()


def _db_list_all() -> list[dict]:
    conn = _db_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM screen_leases ORDER BY acquired_at ASC"
        ).fetchall()
        return [_row_to_lease(r) for r in rows]
    finally:
        conn.close()


def _db_list_active_raw() -> list[dict]:
    """Active leases as currently stored, WITHOUT the expiry tick.

    The lazy sweep reads this and then flips each lapsed lease conditionally
    (see ``_expire_if_active``), so a record read here may already be stale by
    the time the write lands — which is exactly what the conditional guards.
    """
    conn = _db_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM screen_leases WHERE state = 'active' ORDER BY acquired_at ASC"
        ).fetchall()
        return [_row_to_lease(r) for r in rows]
    finally:
        conn.close()


def _expire_if_active(lease_id: str, *, now: datetime) -> bool:
    """Flip a still-active lease to expired, atomically.

    The WHERE clause pins ``state = 'active'``, so this can never overwrite a
    release (or force-release) committed by another process or thread between
    the sweep's read and this write. The audit row is appended only when THIS
    call actually won the race (rowcount == 1), so a clobbered transition
    leaves no phantom audit row. Returns True iff this call expired the lease.
    """
    ts = _iso(now)
    conn = _db_conn()
    try:
        with conn:
            cur = conn.execute(
                "UPDATE screen_leases SET state = 'expired', released_at = ?, reason = ? "
                "WHERE lease_id = ? AND state = 'active'",
                (ts, _EXPIRY_REASON, lease_id),
            )
            if cur.rowcount != 1:
                return False
            _append_audit(
                conn, lease_id, _EXPIRY_ACTOR, "active", "expired", ts, _EXPIRY_REASON
            )
            return True
    finally:
        conn.close()


def _is_expired(record: dict, now: datetime) -> bool:
    exp = _parse(record.get("expires_at"))
    return exp is not None and now >= exp


def expire_leases(*, now: datetime | None = None) -> list[str]:
    """Lazily expire every active lease past its ``expires_at``.

    Returns the lease ids this call actually transitioned. Each transition
    goes through the conditional update, so a concurrent release is never
    clobbered and never double-audited.
    """
    at = now or _now()
    expired: list[str] = []
    for record in _db_list_active_raw():
        if _is_expired(record, at) and _expire_if_active(record["lease_id"], now=at):
            expired.append(record["lease_id"])
    return expired


def active_lease_for_resource(
    resource_id: str, *, now: datetime | None = None
) -> dict | None:
    """The active lease currently holding ``resource_id``, or None.

    Expiry is evaluated on read: a lapsed lease is flipped (and audited) before
    the lookup answers, so an expired holder never blocks, and never appears to
    hold, a resource it no longer owns.
    """
    resource = _clean(resource_id, "resource_id")
    if not resource:
        raise LeaseError("resource_id must be a non-empty string")
    at = now or _now()
    conn = _db_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM screen_leases WHERE resource_id = ? AND state = 'active'",
            (resource,),
        ).fetchall()
    finally:
        conn.close()
    for row in rows:
        record = _row_to_lease(row)
        if _is_expired(record, at):
            _expire_if_active(record["lease_id"], now=at)
            continue
        return record
    return None


def get_lease(lease_id: str, *, now: datetime | None = None) -> dict:
    """The honest current state of a lease, including lazy expiry.

    A lease past ``expires_at`` reads as ``expired`` and is persisted through
    the conditional update — never written back from a stale in-memory copy.
    """
    clean = _clean(lease_id, "lease_id")
    record = _db_get(clean)
    if record is None:
        raise LeaseNotFound("unknown lease_id")
    at = now or _now()
    if record["state"] == "active" and _is_expired(record, at):
        _expire_if_active(clean, now=at)
        record = _db_get(clean) or record
    return record


def list_leases(*, now: datetime | None = None) -> list[dict]:
    """All leases, ticked against expiry (sweeping any lapsed active lease)."""
    at = now or _now()
    expire_leases(now=at)
    return _db_list_all()


def list_audit(
    lease_id: str | None = None, *, now: datetime | None = None
) -> list[dict]:
    """The immutable audit trail, ordered by transition time (insertion order).

    Expiry is swept first so the trail reflects the read: a lease that just
    lapsed carries its expired row. Filtering by ``lease_id`` scopes the trail
    to one lease; omitted, every transition is returned.
    """
    at = now or _now()
    expire_leases(now=at)
    conn = _db_conn()
    try:
        if lease_id is None:
            rows = conn.execute(
                "SELECT * FROM screen_lease_audit ORDER BY id ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM screen_lease_audit WHERE lease_id = ? ORDER BY id ASC",
                (lease_id,),
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def acquire_lease(
    agent_id: str,
    resource_id: str,
    ttl: float = DEFAULT_TTL,
    *,
    now: datetime | None = None,
) -> dict:
    """Acquire a screen for an agent, or renew the agent's existing lease.

    Refuses to acquire a resource already actively leased to a DIFFERENT agent,
    naming the holder — there is no silent stealing. The same agent re-acquiring
    its own active lease renews the TTL in place (no new state, no audit row).
    A fresh acquisition is a ``none -> active`` transition and is audited.
    """
    agent = _check_agent(agent_id)
    resource = _clean(resource_id, "resource_id")
    if not resource:
        raise LeaseError("resource_id must be a non-empty string")
    if not isinstance(ttl, (int, float)) or ttl <= 0:
        raise LeaseError("ttl must be a positive number of seconds")
    at = now or _now()

    existing = active_lease_for_resource(resource, now=at)
    if existing is not None:
        if existing["agent_id"] != agent:
            raise LeaseError(
                f"resource {resource!r} is already leased by "
                f"{existing['agent_id']!r}; release it or force-release it first"
            )
        new_expires = _iso(at + timedelta(seconds=ttl))
        conn = _db_conn()
        try:
            with conn:
                conn.execute(
                    "UPDATE screen_leases SET expires_at = ? "
                    "WHERE lease_id = ? AND state = 'active'",
                    (new_expires, existing["lease_id"]),
                )
        finally:
            conn.close()
        return get_lease(existing["lease_id"], now=at)

    lease_id = f"sl_{uuid.uuid4().hex[:12]}_{secrets.token_hex(4)}"
    expires_at = _iso(at + timedelta(seconds=ttl))
    conn = _db_conn()
    try:
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO screen_leases
                        (lease_id, agent_id, resource_id, state, acquired_at,
                         expires_at, released_at, reason)
                    VALUES (?, ?, ?, 'active', ?, ?, NULL, '')
                """,
                    (lease_id, agent, resource, _iso(at), expires_at),
                )
                _append_audit(
                    conn, lease_id, agent, "none", "active", _iso(at), "acquired"
                )
        except sqlite3.IntegrityError:
            holder = active_lease_for_resource(resource, now=at)
            raise LeaseError(
                f"resource {resource!r} is already leased by "
                f"{(holder or {}).get('agent_id')!r}; release it or force-release it first"
            )
    finally:
        conn.close()
    return get_lease(lease_id, now=at)


def release_lease(lease_id: str, agent_id: str, *, now: datetime | None = None) -> dict:
    """Release an active lease (``active -> released``), audited.

    Only the holder may release its own lease. Releasing an already-ended lease
    is a no-op that returns the honest state — it never rewrites history and
    never appends a second row.
    """
    holder = _check_agent(agent_id)
    at = now or _now()
    record = get_lease(lease_id, now=at)
    if record["state"] != "active":
        return record
    if record["agent_id"] != holder:
        raise LeaseError(
            f"lease {lease_id!r} is held by {record['agent_id']!r}; "
            f"{holder!r} may not release it"
        )
    conn = _db_conn()
    try:
        with conn:
            cur = conn.execute(
                "UPDATE screen_leases SET state = 'released', released_at = ?, reason = ? "
                "WHERE lease_id = ? AND state = 'active'",
                (_iso(at), "released", lease_id),
            )
            if cur.rowcount == 1:
                _append_audit(
                    conn, lease_id, holder, "active", "released", _iso(at), "released"
                )
    finally:
        conn.close()
    return get_lease(lease_id, now=at)


def force_release(
    lease_id: str, actor: str, reason: str, *, now: datetime | None = None
) -> dict:
    """The OWNER takes a lease away (``active -> force_released``), audited with
    the owner's reason.

    Owner-only: a bot can never force-release (no self-approval). A reason is
    required — a takeover must say why. Force-releasing an already-ended lease
    is a no-op that returns the honest state.
    """
    who = _check_owner(actor)
    why = _clean(reason, "reason")
    if not why:
        raise LeaseError("reason is required — a force-release must say why")
    at = now or _now()
    record = get_lease(lease_id, now=at)
    if record["state"] != "active":
        return record
    conn = _db_conn()
    try:
        with conn:
            cur = conn.execute(
                "UPDATE screen_leases SET state = 'force_released', released_at = ?, reason = ? "
                "WHERE lease_id = ? AND state = 'active'",
                (_iso(at), why, lease_id),
            )
            if cur.rowcount == 1:
                _append_audit(
                    conn, lease_id, who, "active", "force_released", _iso(at), why
                )
    finally:
        conn.close()
    return get_lease(lease_id, now=at)
