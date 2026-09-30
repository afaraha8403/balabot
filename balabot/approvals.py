"""Approval ledger: observe/mutate classifier, canonical effect keys, and the
durable exactly-once gate for mutating bot-tool calls.

This is the W5 answer to "nothing stands between a model and an irreversible
act". Every bot_tools CLI call is classified OBSERVE (read-only — never gated)
or MUTATE (gated). A mutating call computes a deterministic CANONICAL EFFECT
KEY over (tool, normalised arguments, target scope) and consults a durable
SQLite ledger (WAL, at BALABOT_APPROVALS_DB, default
<BALABOT_DATA_ROOT>/approvals/approvals.db):

- Unapproved mutate        -> REFUSED and recorded (never dropped, never run).
- Approved mutate          -> executed EXACTLY ONCE: only one execution CLAIM
  wins (atomic UPDATE), so turn replay and concurrent approvals of the same
  key cannot double-execute.
- Approval with a TTL      -> an expired approval never authorises (lazy tick,
  same model as balabot.intervention).
- Observe tools            -> never gated, never require a ledger entry.

ENFORCEMENT SWITCH — ``BALABOT_APPROVALS_ENFORCE=1`` engages refusal. Default
OFF keeps the pre-existing repo/tests untouched; a deployment that wants the
gate on sets it in the container env (the W5 acceptance harness passes it per
invocation). Classification + the attempts log run on EVERY call regardless of
the switch, so the audit trail is complete either way.

FAILURE DIRECTION (a deliberate deviation from the Jev fail-open rule): when
enforcement is ON and the ledger itself cannot be read, the gate fails CLOSED
— it refuses the mutation stating that the approval ledger is unavailable. An
irreversible-act gate must not open because its store is down.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

__all__ = [
    "ApprovalError",
    "DEFAULT_APPROVAL_TTL",
    "OWNER_IDENTITIES",
    "enforcement_enabled",
    "classify",
    "effect_key",
    "canonical_args",
    "check_mutation",
    "approve",
    "deny",
    "ledger_state",
    "attempts",
    "events",
    "main",
]

DEFAULT_APPROVAL_TTL = 3600.0  # seconds a fresh approval stays valid
KEY_DIGEST_LEN = 12

# A bot may never approve or deny a mutation — only the owner does
# (self-approval is not consent; same rule as intervention/handoffs).
OWNER_IDENTITIES = frozenset({"user", "ali", "owner", "human", "admin"})

_TRUTHY = {"1", "true", "yes", "on"}

# Tools that merely ask for consent / record pending state — they perform no
# act in the world, so they are OBSERVE (never gated). "send, spend, delete,
# publish" is the mutate line the review drew; asking is not doing.
_OBSERVE_TOOLS = frozenset(
    {
        "list_org_secrets",
        "list_org_skills",
        "list_pending_requests",
        "request_secret",
        "request_secret_access",
        "request_intervention",
    }
)

# Tools whose purpose is an irreversible act in the world.
_MUTATE_TOOLS = frozenset(
    {
        "message_agent",
        "propose_bot",
        "record_growth_audit",
        "rollback_growth_audit",
        "secret_request",
    }
)

# secret_request is an HTTP client: a safe method is a read, anything else is
# an irreversible mutation (the caller can spend/send/delete with the secret).
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class ApprovalError(ValueError):
    """An approve/deny violates the approval rules."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _epoch(dt: datetime) -> int:
    return int(dt.timestamp())


def _db_path() -> Path:
    env = os.environ.get("BALABOT_APPROVALS_DB")
    if env:
        return Path(env)
    root = os.environ.get("BALABOT_DATA_ROOT", "/opt/data")
    return Path(root) / "approvals" / "approvals.db"


def _get_conn() -> sqlite3.Connection:
    p = _db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), timeout=30.0)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.row_factory = sqlite3.Row
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS decisions (
                effect_key    TEXT PRIMARY KEY,
                tool          TEXT NOT NULL,
                scope         TEXT NOT NULL,
                canonical     TEXT NOT NULL,
                state         TEXT NOT NULL DEFAULT 'refused',
                created_at    TEXT NOT NULL,
                expires_at    INTEGER,
                approved_by   TEXT,
                approved_at   TEXT,
                denied_by     TEXT,
                denied_at     TEXT,
                executed_at   INTEGER,
                claim_scope   TEXT,
                note          TEXT DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS approval_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                effect_key  TEXT NOT NULL,
                actor       TEXT NOT NULL,
                action      TEXT NOT NULL,
                at          TEXT NOT NULL,
                detail      TEXT DEFAULT ''
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS attempts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                effect_key  TEXT NOT NULL,
                tool        TEXT NOT NULL,
                kind        TEXT NOT NULL,
                scope       TEXT NOT NULL,
                decision    TEXT NOT NULL,
                at          TEXT NOT NULL,
                detail      TEXT DEFAULT ''
            )
        """)
    return conn


def enforcement_enabled() -> bool:
    """True when the refunding gate is engaged (BALABOT_APPROVALS_ENFORCE=1)."""
    return os.environ.get("BALABOT_APPROVALS_ENFORCE", "").strip().lower() in _TRUTHY


# ---------------------------------------------------------------------------
# Observe/mutate classification — explicit, central, auditable (never inferred
# at a call site).
# ---------------------------------------------------------------------------


def classify(tool: str, args: dict | None = None) -> dict:
    """Classify one tool call: ``{"tool", "kind", "reason"}``.

    kind is ``observe`` (read-only, never gated) or ``mutate`` (gated).
    Per-tool refinements are explicit here, not scattered across call sites:
    ``secret_request`` is a read only for safe HTTP methods; every other known
    mutate tool is a read only when it is not in the mutate table.
    """
    args = dict(args or {})
    tool = str(tool or "")
    if tool in _OBSERVE_TOOLS:
        return {
            "tool": tool,
            "kind": "observe",
            "reason": "records/reads pending state or asks for consent — no act",
        }
    if tool == "secret_request":
        method = str(args.get("method") or "GET").strip().upper() or "GET"
        if method in _SAFE_METHODS:
            return {
                "tool": tool,
                "kind": "observe",
                "reason": f"HTTP {method} is read-only — never gated",
            }
        return {
            "tool": tool,
            "kind": "mutate",
            "reason": f"HTTP {method} can perform an irreversible act — approval-gated",
        }
    if tool in _MUTATE_TOOLS:
        return {
            "tool": tool,
            "kind": "mutate",
            "reason": "can perform an irreversible act — approval-gated",
        }
    return {"tool": tool, "kind": "observe", "reason": "unknown tool — default observe"}


# ---------------------------------------------------------------------------
# Canonical effect keys — deterministic serialisation of (tool, args, scope).
# ---------------------------------------------------------------------------


def _normalize(value: Any, *, method_field: bool = False) -> Any:
    """Canonicalise one value so text/order differences that mean the same
    thing collapse to the same representation: dict keys sorted, strings
    stripped, and the HTTP method uppercased (the tool itself uppercases it,
    so ``--method post`` and ``--method POST`` are the same call). Numeric
    types are NOT coerced — ``1`` vs ``1.0`` encode different HTTP bodies, so
    they must stay distinct keys."""
    if isinstance(value, dict):
        return {
            str(k): _normalize(v, method_field=(k == "method"))
            for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))
        }
    if isinstance(value, (list, tuple)):
        return [_normalize(v) for v in value]
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped.upper() if method_field else stripped
    return str(value).strip()


def canonical_args(args: dict | None) -> str:
    """Compact, key-sorted JSON of the normalised arguments — the canonical
    serialisation of one call's arguments."""
    return json.dumps(
        _normalize(args or {}),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def effect_key(tool: str, args: dict | None, scope: str | None) -> str:
    """Deterministic, canonical digest of (tool, normalised arguments, scope).

    Same call -> same key in every process and every run. Differing
    mutation-relevant arguments or a different scope -> a different key (and
    therefore a new, separately-approved action).
    """
    blob = "balabot/effect/v1\x00" + json.dumps(
        {
            "tool": str(tool or ""),
            "scope": str(scope or ""),
            "args": _normalize(args or {}),
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:KEY_DIGEST_LEN]


# ---------------------------------------------------------------------------
# Ledger primitives
# ---------------------------------------------------------------------------


def _record_attempt(
    *, key: str, tool: str, kind: str, scope: str, decision: str, detail: str = ""
) -> None:
    """Append one attempt/classification row. Best-effort — a broken attempt
    log must never break the caller (observe calls especially)."""
    try:
        with _get_conn() as conn:
            conn.execute(
                "INSERT INTO attempts (effect_key, tool, kind, scope, decision, at, detail) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (key, tool, kind, scope or "", decision, _iso(_now()), detail),
            )
    except Exception:
        pass


def _record_event(*, key: str, actor: str, action: str, detail: str = "") -> None:
    try:
        with _get_conn() as conn:
            conn.execute(
                "INSERT INTO approval_events (effect_key, actor, action, at, detail) "
                "VALUES (?, ?, ?, ?, ?)",
                (key, actor, action, _iso(_now()), detail),
            )
    except Exception:
        pass


def _row(key: str, conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM decisions WHERE effect_key = ?", (key,)
    ).fetchone()


def _tick(key: str, conn: sqlite3.Connection, now: datetime) -> sqlite3.Row | None:
    """Apply approval expiry lazily on read: an `approved` row whose expiry has
    passed becomes `expired` and can never authorise. Same model as
    balabot.intervention._tick. Returns the (possibly updated) row."""
    row = _row(key, conn)
    if row is None or row["state"] != "approved":
        return row
    exp = row["expires_at"]
    if exp is not None and _epoch(now) >= int(exp):
        conn.execute(
            "UPDATE decisions SET state = 'expired' WHERE effect_key = ? "
            "AND state = 'approved'",
            (key,),
        )
        _record_event(
            key=key,
            actor="system",
            action="expire",
            detail="approval TTL elapsed before execution",
        )
        return _row(key, conn)
    return row


# ---------------------------------------------------------------------------
# The gate (called from bot_tools.main on every dispatch)
# ---------------------------------------------------------------------------


def check_mutation(tool: str, args: dict | None, *, scope: str | None) -> dict:
    """Classify + gate ONE tool call. ``decision`` is the verdict:

    - ``observe``   -> read-only; proceed, never gated.
    - ``allowed``   -> enforcement is OFF; proceed (recorded, unenforced).
    - ``authorized`` -> an approval was claimed; proceed and execute once.
    - ``refused``   -> unapproved mutation; DO NOT execute (recorded).
    - ``expired``   -> approval lapsed; DO NOT execute (recorded).
    - ``replay``    -> already executed exactly once; DO NOT re-execute.

    Every call appends an attempts row regardless of the verdict (the
    classification is explicit AND logged). Refusal/expiry/replay bodies carry
    ``ok: False`` + ``status_code`` so a CLI caller can surface them verbatim.
    """
    args = dict(args or {})
    scope = scope if scope is not None else ""
    c = classify(tool, args)
    key = effect_key(tool, args, scope)
    kind = c["kind"]

    if kind == "observe":
        _record_attempt(
            key=key,
            tool=tool,
            kind="observe",
            scope=scope,
            decision="observe",
            detail=c["reason"],
        )
        return {
            "decision": "observe",
            "tool": tool,
            "kind": "observe",
            "effect_key": key,
            "scope": scope,
            "reason": c["reason"],
        }

    if not enforcement_enabled():
        _record_attempt(
            key=key,
            tool=tool,
            kind="mutate",
            scope=scope,
            decision="allowed",
            detail="approval gate not engaged (BALABOT_APPROVALS_ENFORCE=0)",
        )
        return {
            "decision": "allowed",
            "tool": tool,
            "kind": "mutate",
            "effect_key": key,
            "scope": scope,
            "reason": "approval gate not engaged",
        }

    now = _now()
    try:
        conn = _get_conn()
    except Exception as exc:  # ledger down: fail CLOSED for a mutate
        msg = f"approval ledger unavailable ({type(exc).__name__}): refusing by default"
        _record_attempt(
            key=key,
            tool=tool,
            kind="mutate",
            scope=scope,
            decision="refused",
            detail=msg,
        )
        return {
            "ok": False,
            "decision": "refused",
            "tool": tool,
            "kind": "mutate",
            "effect_key": key,
            "scope": scope,
            "status_code": 503,
            "error": "requires approval",
            "detail": msg,
        }

    with conn:
        row = _tick(key, conn, now)
        if row is None:
            conn.execute(
                "INSERT INTO decisions (effect_key, tool, scope, canonical, state, "
                "created_at) VALUES (?, ?, ?, ?, 'refused', ?)",
                (key, tool, scope, canonical_args(args), _iso(now)),
            )
            _record_attempt(
                key=key,
                tool=tool,
                kind="mutate",
                scope=scope,
                decision="refused",
                detail="no approval on record",
            )
            return {
                "ok": False,
                "decision": "refused",
                "tool": tool,
                "kind": "mutate",
                "effect_key": key,
                "scope": scope,
                "status_code": 403,
                "error": "requires approval",
                "detail": "no human approval on record for this effect",
            }

        state = row["state"]
        if state == "executed":
            _record_attempt(
                key=key,
                tool=tool,
                kind="mutate",
                scope=scope,
                decision="replay",
                detail="already executed exactly once",
            )
            return {
                "ok": False,
                "decision": "replay",
                "tool": tool,
                "kind": "mutate",
                "effect_key": key,
                "scope": scope,
                "status_code": 409,
                "error": "already executed",
                "executed_at": row["executed_at"],
                "detail": "replay refused — no double-execute",
            }
        if state == "expired":
            _record_attempt(
                key=key,
                tool=tool,
                kind="mutate",
                scope=scope,
                decision="expired",
                detail="approval TTL elapsed",
            )
            return {
                "ok": False,
                "decision": "expired",
                "tool": tool,
                "kind": "mutate",
                "effect_key": key,
                "scope": scope,
                "status_code": 403,
                "error": "approval expired",
                "detail": "the approval lapsed before the mutation ran",
            }
        if state == "refused":
            _record_attempt(
                key=key,
                tool=tool,
                kind="mutate",
                scope=scope,
                decision="refused",
                detail="no approval on record",
            )
            return {
                "ok": False,
                "decision": "refused",
                "tool": tool,
                "kind": "mutate",
                "effect_key": key,
                "scope": scope,
                "status_code": 403,
                "error": "requires approval",
                "detail": "no human approval on record for this effect",
            }

        # state == "approved": atomically claim the execution. Only one
        # concurrent caller wins the rowcount==1; the loser re-reads and sees
        # executed -> replay. This is the exactly-once claim.
        cur = conn.execute(
            "UPDATE decisions SET executed_at = ?, claim_scope = ? "
            "WHERE effect_key = ? AND state = 'approved' "
            "AND executed_at IS NULL AND expires_at >= ?",
            (_epoch(now), scope, key, _epoch(now)),
        )
        if cur.rowcount == 1:
            _record_event(
                key=key,
                actor=scope,
                action="claim",
                detail="execution claimed by the approved scope",
            )
            _record_attempt(
                key=key,
                tool=tool,
                kind="mutate",
                scope=scope,
                decision="authorized",
                detail="approval claimed — execute once",
            )
            return {
                "decision": "authorized",
                "tool": tool,
                "kind": "mutate",
                "effect_key": key,
                "scope": scope,
            }
        # Lost the claim or the expiry raced us: report honestly.
        after = _tick(key, conn, now)
        if after is not None and after["state"] == "executed":
            _record_attempt(
                key=key,
                tool=tool,
                kind="mutate",
                scope=scope,
                decision="replay",
                detail="another caller claimed execution",
            )
            return {
                "ok": False,
                "decision": "replay",
                "tool": tool,
                "kind": "mutate",
                "effect_key": key,
                "scope": scope,
                "status_code": 409,
                "error": "already executed",
                "executed_at": after["executed_at"],
                "detail": "replay refused — no double-execute",
            }
        _record_attempt(
            key=key,
            tool=tool,
            kind="mutate",
            scope=scope,
            decision="expired",
            detail="approval invalidated before claim",
        )
        return {
            "ok": False,
            "decision": "expired",
            "tool": tool,
            "kind": "mutate",
            "effect_key": key,
            "scope": scope,
            "status_code": 403,
            "error": "approval expired",
            "detail": "the approval is no longer live",
        }


# ---------------------------------------------------------------------------
# Human decisions (owner only — a bot can never approve or deny)
# ---------------------------------------------------------------------------


def _require_owner(by: str) -> str:
    by = (by or "").strip()
    if not by or by.lower() not in OWNER_IDENTITIES:
        raise ApprovalError(
            f"only the owner may decide an approval; {by!r} may not "
            "(a bot approving its own mutation is not consent)"
        )
    return by


def approve(
    key: str, *, by: str, ttl: float = DEFAULT_APPROVAL_TTL, note: str = ""
) -> dict:
    """Record human consent for one effect key.

    Idempotent and order-safe under concurrency: every approve upserts the
    decision to ``approved`` and appends an approval event; the executed
    exactly-once claim happens later in check_mutation, so two concurrent
    approvals of the same key never cause a double execution. An executed key
    cannot be approved again.
    """
    by = _require_owner(by)
    key = str(key or "").strip()
    if not key:
        raise ApprovalError("effect key is required")
    if not isinstance(ttl, (int, float)) or ttl <= 0:
        raise ApprovalError("ttl must be a positive number of seconds")
    now = _now()
    with _get_conn() as conn:
        row = _row(key, conn)
        if row is not None and row["state"] == "executed":
            raise ApprovalError(
                "this effect has already been executed — no re-approval"
            )
        conn.execute(
            "INSERT INTO decisions (effect_key, tool, scope, canonical, state, "
            "created_at, approved_by, approved_at, expires_at, note) "
            "VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?) "
            "ON CONFLICT(effect_key) DO UPDATE SET "
            "state = 'approved', approved_by = excluded.approved_by, "
            "approved_at = excluded.approved_at, expires_at = excluded.expires_at, "
            "note = excluded.note, denied_by = NULL, denied_at = NULL, "
            "executed_at = NULL, claim_scope = NULL",
            (
                key,
                (row["tool"] if row else ""),
                (row["scope"] if row else ""),
                (row["canonical"] if row else "{}"),
                _iso(now),
                by,
                _iso(now),
                _epoch(now + timedelta(seconds=ttl)),
                (note or "").strip(),
            ),
        )
    _record_event(key=key, actor=by, action="approve", detail=f"approved for {ttl}s")
    return {
        "ok": True,
        "decision": "approved",
        "effect_key": key,
        "approved_by": by,
        "expires_at": _epoch(now + timedelta(seconds=ttl)),
    }


def deny(key: str, *, by: str, note: str = "") -> dict:
    """Record a human refusal for one effect key. Never reopens an executed or
    expired record's fact — it records the decision and leaves history intact."""
    by = _require_owner(by)
    key = str(key or "").strip()
    if not key:
        raise ApprovalError("effect key is required")
    now = _now()
    with _get_conn() as conn:
        row = _row(key, conn)
        if row is not None and row["state"] == "executed":
            raise ApprovalError("this effect has already been executed")
        conn.execute(
            "INSERT INTO decisions (effect_key, tool, scope, canonical, state, "
            "created_at, denied_by, denied_at, note) "
            "VALUES (?, ?, ?, ?, 'refused', ?, ?, ?, ?) "
            "ON CONFLICT(effect_key) DO UPDATE SET "
            "state = 'refused', denied_by = excluded.denied_by, "
            "denied_at = excluded.denied_at, note = excluded.note, "
            "approved_by = NULL, approved_at = NULL, expires_at = NULL",
            (
                key,
                (row["tool"] if row else ""),
                (row["scope"] if row else ""),
                (row["canonical"] if row else "{}"),
                _iso(now),
                by,
                _iso(now),
                (note or "").strip(),
            ),
        )
    _record_event(key=key, actor=by, action="deny", detail=note or "")
    return {"ok": True, "decision": "refused", "effect_key": key, "denied_by": by}


# ---------------------------------------------------------------------------
# Read surfaces / diagnostics
# ---------------------------------------------------------------------------


def ledger_state(key: str) -> dict | None:
    """Public decision row for one key (expiry ticked before returning)."""
    key = str(key or "").strip()
    with _get_conn() as conn:
        now = _now()
        row = _tick(key, conn, now)
        if row is None:
            return None
        return {
            "effect_key": row["effect_key"],
            "tool": row["tool"],
            "scope": row["scope"],
            "state": row["state"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "approved_by": row["approved_by"],
            "approved_at": row["approved_at"],
            "denied_by": row["denied_by"],
            "denied_at": row["denied_at"],
            "executed_at": row["executed_at"],
            "claim_scope": row["claim_scope"],
            "note": row["note"],
        }


def attempts(*, key: str | None = None, limit: int = 50) -> list[dict]:
    """The attempts/classification log, newest first (append-only audit)."""
    with _get_conn() as conn:
        sql = (
            "SELECT id, effect_key, tool, kind, scope, decision, at, detail "
            "FROM attempts"
        )
        params: list = []
        if key:
            sql += " WHERE effect_key = ?"
            params.append(key)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(int(limit))
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def events(*, key: str | None = None, limit: int = 100) -> list[dict]:
    """The append-only approval/claim event log (audit trail)."""
    with _get_conn() as conn:
        sql = "SELECT id, effect_key, actor, action, at, detail FROM approval_events"
        params: list = []
        if key:
            sql += " WHERE effect_key = ?"
            params.append(key)
        sql += " ORDER BY id ASC LIMIT ?"
        params.append(int(limit))
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# CLI — the admin/harness surface (`python -m balabot.approvals …`)
# ---------------------------------------------------------------------------


def _parse_flags(argv: list[str]) -> dict:
    flags: dict[str, str] = {}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg.startswith("--") and i + 1 < len(argv):
            flags[arg[2:]] = argv[i + 1]
            i += 2
        else:
            i += 1
    return flags


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print(
            "usage: python -m balabot.approvals "
            "classify --tool T [--args '<json>'] | "
            "key --tool T --scope S [--args '<json>'] | "
            "approve --key K --by B [--ttl SECONDS] [--note N] | "
            "deny --key K --by B [--note N] | "
            "state --key K | attempts [--key K] [--limit N] | "
            "events [--key K] [--limit N]",
            file=sys.stderr,
        )
        return 2
    cmd = argv[0]
    f = _parse_flags(argv[1:])
    try:
        if cmd == "classify":
            args = json.loads(f.get("args") or "{}")
            print(json.dumps(classify(f.get("tool", ""), args), sort_keys=True))
            return 0
        if cmd == "key":
            args = json.loads(f.get("args") or "{}")
            print(
                json.dumps(
                    {
                        "effect_key": effect_key(
                            f.get("tool", ""), args, f.get("scope") or ""
                        )
                    }
                )
            )
            return 0
        if cmd == "approve":
            print(
                json.dumps(
                    approve(
                        f.get("key", ""),
                        by=f.get("by", ""),
                        ttl=float(f.get("ttl") or DEFAULT_APPROVAL_TTL),
                        note=f.get("note", ""),
                    ),
                    sort_keys=True,
                )
            )
            return 0
        if cmd == "deny":
            print(
                json.dumps(
                    deny(f.get("key", ""), by=f.get("by", ""), note=f.get("note", "")),
                    sort_keys=True,
                )
            )
            return 0
        if cmd == "state":
            print(json.dumps(ledger_state(f.get("key", "")) or {}))
            return 0
        if cmd == "attempts":
            print(
                json.dumps(attempts(key=f.get("key"), limit=int(f.get("limit") or 50)))
            )
            return 0
        if cmd == "events":
            print(
                json.dumps(events(key=f.get("key"), limit=int(f.get("limit") or 100)))
            )
            return 0
        if cmd == "make-token":
            # Deterministic 12-hex token for constructing a W5 fixture key.
            print(json.dumps({"token": secrets.token_hex(6)}))
            return 0
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"unknown command {cmd!r}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
