"""Durable-checkpoint seam for the balabot-jev memory provider.

Bridges the plugin to the two parallel-authored balabot modules, both imported
LAZILY (never at module import) so a missing module can never crash the agent
host at import time:

- ``balabot.jev_continuity.saliency_pass(evidence: list[str], jev=None) ->
  SaliencyResult`` — typed Noul routing of each evidence item to exactly one
  destination (``ledger`` decision / ``holographic`` durable fact /
  ``working_set`` live state / ``dropped``). Fails OPEN (degraded, all items
  to working_set) when no Jev client is injected; a Jev client is built
  lazily from ``balabot.jev.Jev`` when TYPESAFE_API_KEY exists. Tests
  monkeypatch :func:`run_saliency_pass` — they never hit the Jev API.

- ``balabot.sessions.SessionStore(db_path)`` — the durable store. The
  checkpoint persists extracted material as DECISIONS
  (``record_decision``), updates the session's resume_state with the
  checkpoint bundle (``set_resume_state``), and appends the compaction
  record for churn detection (``record_compaction``). Confirmation is a
  real READBACK (``resume_state`` returns the checkpoint hash we wrote) —
  the adapter never pretends a write succeeded.

Fail-closed semantics: the adapter raises :class:`CheckpointUnavailable`
(store/module not openable), :class:`CheckpointWriteUnconfirmed` (write not
readback-confirmed) or :class:`SaliencyUnavailable` (saliency pass could not
run at all). The provider propagates these in strict mode; the Hermes host
wraps them as ``BLOCKED_MISSING_PREREQUISITE`` and refuses compaction.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class CheckpointUnavailable(RuntimeError):
    """The durable session store could not be opened/imported. Fail closed."""


class CheckpointWriteUnconfirmed(RuntimeError):
    """The durable write did not confirm on readback. Fail closed."""


class SaliencyUnavailable(RuntimeError):
    """The Jev saliency pass could not run (module missing / hard failure)."""


# -- Evidence normalisation ---------------------------------------------------
#
# v2 contract: the host hands v2 providers host-normalised direct evidence
# (user/assistant prose). We normalise locally too so the plugin is safe
# against raw callers: derivative compaction summaries and tool payloads must
# NEVER re-enter the checkpoint, or the immortal-session churn
# (summary-of-summary) starts over from here.

_COMPRESSED_SUMMARY_KEYS = ("_compressed_summary", "compressed_summary")


def normalize_evidence(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only direct user/assistant prose; drop system, tool payloads and
    derivative compaction summaries. Never mutates the input list."""
    evidence: List[Dict[str, Any]] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        if any(msg.get(key) for key in _COMPRESSED_SUMMARY_KEYS):
            continue
        if msg.get("tool_calls") and not (isinstance(msg.get("content"), str) and msg.get("content", "").strip()):
            continue  # pure tool-call envelope; the payload is not evidence
        content = msg.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        evidence.append({"role": role, "content": content})
    return evidence


def content_hash(evidence: List[Dict[str, Any]]) -> str:
    """Stable sha256 over the normalised evidence — the idempotency key."""
    payload = json.dumps(evidence, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# -- Jev saliency pass (lazy, injected in tests) -------------------------------


def _build_jev_client():
    """Lazily build a Jev client if the key exists; None means 'pass degrades
    open to working_set' — a stated degradation, not a silent default."""
    try:
        from balabot.jev import Jev, JevNotConfigured  # lazy

        try:
            return Jev()
        except JevNotConfigured:
            return None
    except ImportError:
        return None


def run_saliency_pass(evidence: List[Dict[str, Any]], *, session_id: str = "") -> List[Dict[str, Any]]:
    """Run the Jev saliency pass over the normalised evidence.

    Returns normalised extracted items:
    ``[{"index", "destination", "text", "failed_open", "degraded", "reason"}]``
    — 'dropped' items are excluded (a drop is deliberate; bloat is
    recoverable, a silently lost decision is not). Raises
    :class:`SaliencyUnavailable` only when the pass cannot run at all
    (module missing). Tests monkeypatch this function — no network.
    """
    try:
        from balabot.jev_continuity import saliency_pass  # lazy; never at module import
    except Exception as exc:
        raise SaliencyUnavailable(f"balabot.jev_continuity unavailable: {exc}") from exc

    texts = [e["content"] for e in evidence]
    jev = _build_jev_client()
    try:
        result = saliency_pass(texts, jev=jev)
    except Exception as exc:
        raise SaliencyUnavailable(f"saliency_pass failed: {exc}") from exc

    items = getattr(result, "items", None)
    if items is None:  # defensive: a plain list/iterable shape
        items = result
    extracted: List[Dict[str, Any]] = []
    for item in items:
        destination = getattr(item, "destination", None) or (item.get("destination") if isinstance(item, dict) else None)
        index = getattr(item, "index", None)
        if index is None:
            index = item.get("index") if isinstance(item, dict) else None
        if destination == "dropped":
            continue
        text = texts[index] if isinstance(index, int) and 0 <= index < len(texts) else ""
        if not text:
            continue
        extracted.append({
            "index": index,
            "destination": destination,
            "text": text,
            "failed_open": bool(getattr(item, "failed_open", False)),
            "degraded": bool(getattr(result, "degraded", False)),
            "reason": str(getattr(result, "reason", "") or ""),
        })
    extracted.sort(key=lambda i: i["index"])
    return extracted


def render_context(extracted: List[Dict[str, Any]]) -> str:
    """The extracted context string fed into the compression summary prompt
    (and persisted as the durable re-anchor source)."""
    if not extracted:
        return ""
    degraded = any(i.get("degraded") for i in extracted)
    lines = ["## Jev pre-compaction checkpoint (durable)"]
    if degraded:
        lines.append("NOTE: Jev unavailable — classification degraded open to working_set.")
    for item in extracted:
        lines.append(f"- [{item['destination']}] {item['text']}")
    return "\n".join(lines)


# -- Durable store adapter (balabot.sessions.SessionStore) ---------------------


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionsStoreAdapter:
    """Defensive adapter over ``balabot.sessions.SessionStore``.

    The store never auto-creates sessions on reads (fail-loud design), so a
    checkpoint against an unseen session id first creates it (bot_id
    'hermes-jev', purpose from the checkpoint itself) — a deliberate write,
    not a silent default.

    Confirmation is a READBACK: after writing the checkpoint bundle into
    ``resume_state``, the adapter reads it back and only a matching
    checkpoint hash counts as confirmed.
    """

    def __init__(self, store: Any) -> None:
        self._store = store

    @property
    def raw(self) -> Any:
        return self._store

    def _ensure_session(self, session_id: str) -> None:
        try:
            self._store.resume_state(session_id)
        except Exception:
            # UnknownSession (or similar) -> create the session deliberately.
            try:
                self._store.create_session(
                    session_id, "hermes-jev",
                    "Checkpointed by the balabot-jev memory provider before compaction.",
                )
            except Exception as exc:
                raise CheckpointUnavailable(
                    f"session {session_id!r} not in store and create_session failed: {exc}"
                ) from exc

    def write_checkpoint(
        self, session_id: str, evidence_hash: str, context: str, extracted: List[Dict[str, Any]],
    ) -> bool:
        """Persist the checkpoint durably; True = confirmed by readback."""
        self._ensure_session(session_id)

        # Idempotency: a checkpointed evidence hash already in resume_state
        # means the SAME evidence set was checkpointed before — no double
        # write. Return True (the earlier write was confirmed).
        try:
            prior = self._store.resume_state(session_id)
        except Exception as exc:
            raise CheckpointUnavailable(f"resume_state read failed: {exc}") from exc
        if isinstance(prior, dict) and prior.get("checkpoint_hash") == evidence_hash:
            return True

        now = _utc_now_iso()
        provenance = f"jev-checkpoint:{evidence_hash[:12]}"
        for item in extracted:
            if item.get("destination") != "ledger":
                continue
            try:
                self._store.record_decision(session_id, item["text"], provenance, at=now)
            except Exception as exc:
                raise CheckpointWriteUnconfirmed(f"record_decision failed: {exc}") from exc

        bundle = {
            "checkpoint_hash": evidence_hash,
            "checkpoint_at": now,
            "context": context,
            "extracted": extracted,
        }
        merged = dict(prior) if isinstance(prior, dict) else {}
        merged.update(bundle)
        try:
            self._store.set_resume_state(session_id, merged)
        except Exception as exc:
            raise CheckpointWriteUnconfirmed(f"set_resume_state failed: {exc}") from exc

        # Readback confirmation — the write is real only if we read it back.
        try:
            readback = self._store.resume_state(session_id)
        except Exception as exc:
            raise CheckpointWriteUnconfirmed(f"readback after write failed: {exc}") from exc
        if not (isinstance(readback, dict) and readback.get("checkpoint_hash") == evidence_hash):
            raise CheckpointWriteUnconfirmed(
                f"durable checkpoint write did not confirm on readback (session {session_id!r})"
            )
        return True

    def record_compaction(self, session_id: str, evidence_hash: str) -> None:
        """Append the compaction record (churn detection). Non-fatal."""
        try:
            self._store.record_compaction(session_id, at=_utc_now_iso())
        except Exception as exc:
            logger.debug("compaction record failed (non-fatal): %s", exc)

    def re_anchor(self, session_id: str) -> Optional[Dict[str, Any]]:
        """The durable ground-truth bundle (purpose, spans, decisions,
        resume_state) used to RE-ANCHOR FROM STATE, not from the summary."""
        try:
            return self._store.re_anchor(session_id)
        except Exception as exc:
            logger.debug("re_anchor read failed: %s", exc)
            return None


def load_sessions_store(hermes_home: Optional[str] = None) -> SessionsStoreAdapter:
    """Open the durable session store (lazy import of ``balabot.sessions``).

    DB path precedence: ``BALABOT_CONTINUITY_DB`` env (the store's own
    contract) > ``<hermes_home>/memory/balabot-jev/continuity.db`` when
    hermes_home is given > the store module's default. ``~/.hermes`` is never
    hardcoded — hermes_home comes from the host's ``initialize`` kwargs.
    """
    try:
        import balabot.sessions as sessions  # lazy; /opt/balabot on sys.path at runtime
    except Exception as exc:
        raise CheckpointUnavailable(f"balabot.sessions unavailable: {exc}") from exc

    db_path: Optional[str] = None
    if hermes_home:
        root = Path(hermes_home) / "memory" / "balabot-jev"
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise CheckpointUnavailable(f"cannot create storage root {root}: {exc}") from exc
        db_path = str(root / "continuity.db")

    try:
        store = sessions.SessionStore(db_path) if db_path else sessions.SessionStore()
    except Exception as exc:
        raise CheckpointUnavailable(f"balabot.sessions.SessionStore() failed: {exc}") from exc
    return SessionsStoreAdapter(store)


def storage_root(hermes_home: Optional[str]) -> Optional[Path]:
    """Where this provider's durable state lives — under the caller-supplied
    hermes_home, never a hardcoded ~/.hermes."""
    if not hermes_home:
        return None
    return Path(hermes_home) / "memory" / "balabot-jev"
