"""balabot-jev — Jev pre-compaction checkpoint memory provider (Hermes plugin).

WRAP-DON'T-REPLACE (why the architecture looks like this): the principal and
governor profiles are forced onto the bundled holographic provider
(balabot/bootstrap.py: FORCED_MEMORY_PROVIDER = "holographic"), its
``memory_store.db`` is live and the product's /api/memory reads it, and Hermes
allows only ONE external plugin provider. Replacing holographic would destroy
fact_store / fact_feedback and product memory. So this provider IS the single
active external provider and internally composes (wraps) the bundled
``plugins.memory.holographic`` provider: the entire delegated surface is
forwarded, and the Jev checkpoint + context-limit signals are added on top.

Deployment: the image copies this directory to /opt/data/plugins/balabot-jev/
(user-plugin discovery root $HERMES_HOME/plugins/<name>/). Activation is
``memory.provider: balabot-jev`` in config.yaml; the fail-closed switch is
``compression.checkpoint_required: true``.

WHY (the immortal-session bug this fixes): a long-lived session converges on
"first 3 messages + a stack of summaries + last 20" and the middle is
repeatedly re-summarised — a summary of a summary. With
``abort_on_summary_failure: false`` a failed summarisation is SILENT and
COMPOUNDING. This provider checkpoints what matters durably via
``balabot.sessions`` BEFORE the compressor runs, implements the pre-compress
checkpoint API v2 and is FAIL-CLOSED: when ``require_checkpoint=True`` and the
durable write cannot be confirmed it raises — the host turns that into
``BLOCKED_MISSING_PREREQUISITE`` and compaction is refused rather than being
silently lossy. In best-effort mode (``require_checkpoint=False``) it never
raises.

Idempotency: the SAME evidence set checkpointed twice does NOT double-write
decisions. The normalised evidence is fingerprinted with a content hash
(checkpoint.content_hash, sha256 over the role/content pairs); an already-
seen hash short-circuits the durable write and the stored context is
returned unchanged.

Degrade-loudly contract: if the inner holographic provider cannot be
imported/constructed, the wrapper logs a WARNING and keeps working for the
checkpoint, but ``system_prompt_block()`` says plainly that holographic is
DEGRADED and tool schemas are empty — it never pretends holographic is
functioning.

Import safety: nothing here can crash the agent host at import time.
``agent.memory_provider`` falls back to a local ABC when unavailable, and
``balabot.sessions`` / ``balabot.jev_continuity`` are imported lazily inside
methods, defended against ImportError.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from . import checkpoint as _checkpoint
from .checkpoint import (
    CheckpointUnavailable,
    CheckpointWriteUnconfirmed,
    SaliencyUnavailable,
    content_hash,
    normalize_evidence,
    render_context,
    storage_root,
)

logger = logging.getLogger(__name__)

# Prefer the host's canonical constant; fall back to the v2 value so the
# plugin stays importable (and testable) outside a full Hermes install.
try:  # pragma: no cover - exercised only inside a real Hermes host
    from agent.memory_provider import (  # type: ignore
        PRE_COMPRESS_CHECKPOINT_API_VERSION as _API_VERSION,
    )
    from agent.memory_provider import MemoryProvider as _HostMemoryProvider
except Exception:  # ImportError or partial install — NEVER crash the host here
    from abc import ABC, abstractmethod

    class _HostMemoryProvider(ABC):  # type: ignore[no-redef]
        """Minimal stand-in for agent.memory_provider.MemoryProvider."""

        pre_compress_checkpoint_api_version = 1

        @property
        @abstractmethod
        def name(self) -> str: ...

        @abstractmethod
        def is_available(self) -> bool: ...

        @abstractmethod
        def initialize(self, session_id: str, **kwargs) -> None: ...

        @abstractmethod
        def get_tool_schemas(self) -> List[Dict[str, Any]]: ...

    _API_VERSION = 2


def _delegate_config(raw: Any) -> Optional[Dict[str, Any]]:
    """Normalise the inner holographic provider's config.

    ``HolographicMemoryProvider`` takes ``config: dict | None`` and loads its own
    config from config.yaml when given None. An ABSENT key must therefore map to
    None — not to ``dict(None)``, which raises TypeError. That exact bug shipped
    once: the delegate silently failed to build, ``get_tool_schemas()`` returned
    [], and fact_store/fact_feedback were OFF while the checkpoint still reported
    healthy. Absent or non-dict → None; a dict → a copy.
    """
    return dict(raw) if isinstance(raw, dict) else None


class BalabotJevProvider(_HostMemoryProvider):
    """Holographic delegate + Jev pre-compress checkpoint (API v2, fail-closed)."""

    pre_compress_checkpoint_api_version = _API_VERSION  # 2 — the opt-in contract

    def __init__(self, delegate=None, config: Optional[Dict[str, Any]] = None) -> None:
        # ``delegate`` is injectable for tests; in production it is built in
        # initialize() from the bundled plugins.memory.holographic (lazy import,
        # guarded — never at module import, never in tests).
        self._delegate = delegate
        self._config = dict(config or {})
        self._session_id: str = ""
        self._hermes_home: Optional[str] = None
        self._store_adapter = None
        # session_id -> set of evidence hashes already durably checkpointed
        self._checkpointed: Dict[str, set] = {}
        self._last_context: Dict[str, str] = {}
        self._delegate_error: Optional[str] = None
        self._last_turn_signal: Dict[str, Any] = {}

    # -- identity -------------------------------------------------------------

    @property
    def name(self) -> str:
        return "balabot-jev"

    # -- availability (config/deps only, NO network) ---------------------------

    def is_available(self) -> bool:
        # No network probe: a missing balabot module only disables the
        # checkpoint at run time (and raises in strict mode), it does not make
        # the provider "unavailable". Delegate availability is not required —
        # see the degrade-loudly contract in the module docstring.
        return True

    def unavailable_reason(self) -> str:
        if self._delegate_error:
            return f"holographic delegate degraded: {self._delegate_error}"
        return ""

    # -- lifecycle -------------------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        """Bind the session. kwargs include hermes_home and platform.

        hermes_home is RESPECTED for storage (this provider's durable state
        lives under <hermes_home>/memory/balabot-jev/); ~/.hermes is never
        hardcoded. The durable store is opened lazily so a temporarily absent
        balabot.sessions cannot break startup.
        """
        self._session_id = session_id
        self._hermes_home = kwargs.get("hermes_home") or self._hermes_home
        root = storage_root(self._hermes_home)
        if root is not None:
            try:
                root.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                logger.warning("balabot-jev: could not create storage root %s: %s", root, exc)

        # Open the durable store eagerly so a misconfigured store surfaces at
        # startup, not silently at the first compaction. (Checkpointing
        # itself re-opens nothing: _store_adapter is already bound.)
        try:
            self._get_store()
        except Exception as exc:
            logger.warning("balabot-jev: durable store not openable at initialize: %s", exc)

        if self._delegate is None:
            self._build_delegate()

        inner_init = getattr(self._delegate, "initialize", None)
        if callable(inner_init):
            try:
                inner_init(session_id, **kwargs)
            except Exception as exc:
                logger.warning("balabot-jev: holographic initialize failed: %s", exc)
                self._delegate_error = str(exc)

    def _build_delegate(self) -> None:
        """Lazy-import the bundled holographic provider. Missing it is a loud
        degradation (WARNING + degraded system-prompt block), never a crash.

        Config handling: the inner provider takes ``config: dict | None`` and
        builds its own config from config.yaml when given None. Passing an
        absent key straight through is the bug this guards — ``dict(None)``
        raises TypeError, which would silently disable fact_store/fact_feedback
        (the live container caught exactly that: holographic DEGRADED, zero tool
        schemas). Absent or non-dict → None, never a half-built config.
        """
        try:
            from plugins.memory.holographic import HolographicMemoryProvider  # lazy

            raw_cfg = self._config.get("holographic")
            delegate_cfg = _delegate_config(raw_cfg)
            self._delegate = HolographicMemoryProvider(config=delegate_cfg)
            self._delegate_error = None
        except Exception as exc:
            self._delegate = None
            self._delegate_error = str(exc)
            logger.warning(
                "balabot-jev: holographic delegate unavailable (%s) — checkpoint still active, "
                "holographic features DEGRADED (fact_store/fact_feedback/memory recall are OFF)",
                exc,
            )

    def _get_store(self):
        """Lazily open the durable balabot.sessions store (hermes_home-scoped)."""
        if self._store_adapter is None:
            self._store_adapter = _checkpoint.load_sessions_store(self._hermes_home)
        return self._store_adapter

    # -- delegated surface (forwarded to the inner holographic provider) -------

    def system_prompt_block(self) -> str:
        inner = getattr(self._delegate, "system_prompt_block", lambda: "")()
        if self._delegate is None:
            return (
                "# balabot-jev memory\n"
                "Active (checkpoint only). Holographic memory DEGRADED: the bundled "
                "holographic provider is unavailable, so fact_store / fact_feedback and "
                "holographic recall are NOT working. Do not claim stored facts exist."
            )
        combined = inner or ""
        # Re-anchor from durable STATE, not from the previous summary.
        anchor = self._reanchor_block()
        if anchor:
            combined = (combined + "\n\n" + anchor).strip()
        return combined

    def _reanchor_block(self) -> str:
        """Re-anchor from durable STATE (the store's re_anchor bundle), not
        from the previous summary."""
        try:
            store = self._get_store()
            bundle = store.re_anchor(self._session_id)
        except Exception:
            return ""
        if not bundle:
            return ""
        lines = ["[Re-anchored from durable Jev checkpoint state]"]
        purpose = bundle.get("purpose")
        if purpose:
            lines.append(f"Purpose: {purpose}")
        decisions = bundle.get("decisions") or []
        for d in decisions:
            text = d.get("text") if isinstance(d, dict) else str(d)
            if text:
                lines.append(f"- [decision] {text}")
        resume_state = bundle.get("resume_state") or {}
        context = resume_state.get("context") if isinstance(resume_state, dict) else None
        if isinstance(context, str) and context.strip():
            lines.append(context.strip())
        return "\n".join(lines) if len(lines) > 1 else ""

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        sid = session_id or self._session_id
        parts: List[str] = []
        inner = getattr(self._delegate, "prefetch", None)
        if callable(inner):
            try:
                got = inner(query, session_id=sid)
            except TypeError:
                got = inner(query)
            if got:
                parts.append(got)
        return "\n\n".join(parts)

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        inner = getattr(self._delegate, "queue_prefetch", None)
        if callable(inner):
            try:
                inner(query, session_id=session_id or self._session_id)
            except TypeError:
                inner(query)

    def recall_status(self):
        inner = getattr(self._delegate, "recall_status", None)
        if callable(inner):
            try:
                return inner()
            except Exception:
                return None
        return None

    def sync_turn(self, user_content: str, assistant_content: str, *,
                  session_id: str = "", messages: Optional[List[Dict[str, Any]]] = None) -> None:
        inner = getattr(self._delegate, "sync_turn", None)
        if callable(inner):
            try:
                inner(user_content, assistant_content, session_id=session_id or self._session_id, messages=messages)
            except Exception as exc:
                logger.debug("balabot-jev: holographic sync_turn failed: %s", exc)

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """The inner provider's tools (fact_store / fact_feedback) MUST keep
        working — the product depends on them. This plugin adds no core tool."""
        if self._delegate is None:
            return []
        try:
            return list(self._delegate.get_tool_schemas())
        except Exception as exc:
            logger.warning("balabot-jev: holographic get_tool_schemas failed: %s", exc)
            return []

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if self._delegate is None:
            return json.dumps({"error": "holographic delegate degraded; tool unavailable"})
        return self._delegate.handle_tool_call(tool_name, args, **kwargs)

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        """Context-limit signal: record the host's remaining-tokens signal so
        re-anchoring can react to pressure, and forward to the delegate."""
        self._last_turn_signal = {
            "turn_number": turn_number,
            "remaining_tokens": kwargs.get("remaining_tokens"),
            "model": kwargs.get("model"),
            "platform": kwargs.get("platform"),
        }
        inner = getattr(self._delegate, "on_turn_start", None)
        if callable(inner):
            try:
                inner(turn_number, message, **kwargs)
            except Exception as exc:
                logger.debug("balabot-jev: holographic on_turn_start failed: %s", exc)

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Final purpose-record pass: checkpoint everything salient one last
        time (best-effort — a session end must never crash teardown)."""
        if messages:
            try:
                self.on_pre_compress(messages, require_checkpoint=False)
            except Exception as exc:
                logger.warning("balabot-jev: final purpose-record pass failed: %s", exc)
        inner = getattr(self._delegate, "on_session_end", None)
        if callable(inner):
            try:
                inner(messages)
            except Exception as exc:
                logger.debug("balabot-jev: holographic on_session_end failed: %s", exc)

    def on_session_switch(self, new_session_id: str, *, parent_session_id: str = "",
                          reset: bool = False, rewound: bool = False, **kwargs) -> None:
        """Rebind per-session state — session_id can change mid-process."""
        self._session_id = new_session_id
        inner = getattr(self._delegate, "on_session_switch", None)
        if callable(inner):
            try:
                inner(new_session_id, parent_session_id=parent_session_id,
                      reset=reset, rewound=rewound, **kwargs)
            except TypeError:
                inner(new_session_id)
            except Exception as exc:
                logger.debug("balabot-jev: holographic on_session_switch failed: %s", exc)

    def on_memory_write(self, action: str, target: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        inner = getattr(self._delegate, "on_memory_write", None)
        if callable(inner):
            try:
                inner(action, target, content, metadata)
            except TypeError:
                inner(action, target, content)
            except Exception as exc:
                logger.debug("balabot-jev: holographic on_memory_write failed: %s", exc)

    def backup_paths(self) -> List[str]:
        inner = getattr(self._delegate, "backup_paths", None)
        if callable(inner):
            try:
                return list(inner())
            except Exception:
                return []
        return []

    def shutdown(self) -> None:
        inner = getattr(self._delegate, "shutdown", None)
        if callable(inner):
            try:
                inner()
            except Exception as exc:
                logger.debug("balabot-jev: holographic shutdown failed: %s", exc)

    # -- the checkpoint (v2, fail-closed) ---------------------------------------

    def on_pre_compress(self, messages: List[Dict[str, Any]], *, require_checkpoint: bool = False) -> str:
        """Pre-compaction checkpoint (pre-compress checkpoint API v2).

        Runs the Jev saliency pass over the host-normalised evidence, persists
        the extracted material durably via balabot.sessions, appends the
        compaction record for churn detection, and returns the extracted
        context string for the summary prompt.

        Idempotency: the SAME evidence set checkpointed twice does NOT
        double-write decisions — the normalised evidence is fingerprinted with
        a content hash (sha256 over role/content pairs) and a repeated hash
        short-circuits the durable write, returning the stored context.

        Failure policy: with require_checkpoint=True an unconfirmed durable
        write RAISES (CheckpointUnavailable / CheckpointWriteUnconfirmed /
        SaliencyUnavailable) — never a silent default; the host converts that
        into BLOCKED_MISSING_PREREQUISITE and refuses compaction. In
        best-effort mode (require_checkpoint=False) failures are logged and ""
        is returned — never raises.
        """
        evidence = normalize_evidence(messages)
        if not evidence:
            # Nothing salient to lose: an empty checkpoint is vacuously durable.
            return ""

        fp = content_hash(evidence)
        seen = self._checkpointed.setdefault(self._session_id, set())
        if fp in seen:
            return self._last_context.get(f"{self._session_id}:{fp}", "")

        extracted = _checkpoint.run_saliency_pass(evidence, session_id=self._session_id)
        context = render_context(extracted)

        try:
            store = self._get_store()
            confirmed = store.write_checkpoint(
                self._session_id, fp, context, extracted,
            )
            if confirmed:
                seen.add(fp)
                self._last_context[f"{self._session_id}:{fp}"] = context
                store.record_compaction(self._session_id, fp)
            elif require_checkpoint:
                raise CheckpointWriteUnconfirmed(
                    "balabot-jev pre-compress checkpoint: durable write to balabot.sessions "
                    f"did not confirm (session {self._session_id!r}, evidence {fp[:12]}…)"
                )
        except (CheckpointUnavailable, CheckpointWriteUnconfirmed, SaliencyUnavailable):
            if require_checkpoint:
                raise
            logger.warning("balabot-jev: best-effort checkpoint skipped: %s", exc)
            return ""
        except Exception as exc:
            if require_checkpoint:
                if isinstance(exc, CheckpointWriteUnconfirmed):
                    raise
                raise CheckpointWriteUnconfirmed(
                    f"balabot-jev pre-compress checkpoint failed: {exc}"
                ) from exc
            logger.warning("balabot-jev: best-effort checkpoint failed: %s", exc)
            return ""

        return context


def register(ctx) -> None:
    """Plugin-system registration (used when loaded by PluginManager)."""
    register_memory_provider(ctx)


def register_memory_provider(ctx) -> None:
    """Register the provider with the memory-provider discovery path."""
    ctx.register_memory_provider(BalabotJevProvider())
