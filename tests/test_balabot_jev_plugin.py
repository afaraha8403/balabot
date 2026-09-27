"""Tests for the balabot-jev Hermes memory-provider plugin.

No network, no Jev API, no real balabot SQLite store: the saliency pass is
stubbed at the plugin boundary (balabot-jev.checkpoint.run_saliency_pass) and
the durable store is an in-memory fake matching the documented
balabot.sessions.SessionStore contract. The plugin dir (dash in its name, so
not a valid package identifier) is loaded by file path — the repo is not
restructured.
"""

from __future__ import annotations

import importlib.util
import json
import socket
import sys
from pathlib import Path

import pytest

_PLUGIN_DIR = Path(__file__).resolve().parent.parent / "hermes" / "plugins" / "balabot-jev"
if str(_PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR))


def _load_plugin():
    if "balabot_jev_plugin" in sys.modules:
        return sys.modules["balabot_jev_plugin"]
    spec = importlib.util.spec_from_file_location("balabot_jev_plugin", _PLUGIN_DIR / "__init__.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["balabot_jev_plugin"] = module
    spec.loader.exec_module(module)
    return module


plugin = _load_plugin()
BalabotJevProvider = plugin.BalabotJevProvider
# The plugin's own checkpoint module (its relative import); patch THIS object,
# not a second top-level copy, or monkeypatching misses the call sites.
jev_checkpoint = plugin.checkpoint
from checkpoint import CheckpointUnavailable, content_hash, normalize_evidence  # noqa: E402,F401


# -- fakes --------------------------------------------------------------------


class FakeStore:
    """In-memory durable store matching the balabot.sessions contract."""

    def __init__(self, fail=False):
        self.fail = fail
        self.decisions = []
        self.compaction_records = []
        self._resume_state = {}
        self._known = set()

    def create_session(self, session_id, bot_id, purpose):
        if fail_write(self):
            raise RuntimeError("durable store unreachable")
        self._known.add(session_id)
        self._resume_state[session_id] = {}

    def resume_state(self, session_id):
        if fail_write(self):
            raise RuntimeError("durable store unreachable")
        if session_id not in self._known:
            raise UnknownSessionFake(session_id)
        return self._resume_state[session_id]

    def set_resume_state(self, session_id, resume_state):
        if fail_write(self):
            raise RuntimeError("durable store unreachable")
        self._resume_state[session_id] = dict(resume_state)

    def record_decision(self, session_id, text, provenance, *, at):
        if fail_write(self):
            raise RuntimeError("durable store unreachable")
        self.decisions.append({"session_id": session_id, "text": text, "provenance": provenance})

    def record_compaction(self, session_id, *, at):
        if fail_write(self):
            raise RuntimeError("durable store unreachable")
        self.compaction_records.append({"session_id": session_id, "at": at})

    def re_anchor(self, session_id):
        if fail_write(self):
            raise RuntimeError("durable store unreachable")
        if session_id not in self._known:
            raise UnknownSessionFake(session_id)
        return {
            "session_id": session_id,
            "purpose": "test purpose",
            "topic_spans": [],
            "decisions": list(self.decisions),
            "resume_state": dict(self._resume_state.get(session_id, {})),
            "recent_window": "last-20-messages",
        }


class UnknownSessionFake(Exception):
    pass


def fail_write(store):
    return store.fail


class FakeAdapter:
    """Duck-typed stand-in for SessionsStoreAdapter over a FakeStore."""

    def __init__(self, store):
        self._store = store

    def write_checkpoint(self, session_id, evidence_hash, context, extracted):
        return _adapter_write(self._store, session_id, evidence_hash, context, extracted)

    def record_compaction(self, session_id, evidence_hash):
        self._store.record_compaction(session_id, at="now")

    def re_anchor(self, session_id):
        return self._store.re_anchor(session_id)


def _adapter_write(store, session_id, evidence_hash, context, extracted):
    """Mirror of SessionsStoreAdapter.write_checkpoint against FakeStore."""
    from checkpoint import CheckpointWriteUnconfirmed

    try:
        store.resume_state(session_id)
    except UnknownSessionFake:
        store.create_session(session_id, "hermes-jev", "ckpt")
    prior = store.resume_state(session_id)
    if isinstance(prior, dict) and prior.get("checkpoint_hash") == evidence_hash:
        return True
    for item in extracted:
        if item.get("destination") == "ledger":
            store.record_decision(session_id, item["text"], f"jev-checkpoint:{evidence_hash[:12]}", at="now")
    merged = dict(prior) if isinstance(prior, dict) else {}
    merged.update({"checkpoint_hash": evidence_hash, "context": context, "extracted": extracted})
    store.set_resume_state(session_id, merged)
    readback = store.resume_state(session_id)
    if not (isinstance(readback, dict) and readback.get("checkpoint_hash") == evidence_hash):
        raise CheckpointWriteUnconfirmed("did not confirm")
    return True


class RecordingDelegate:
    """Records every delegated call so forwarding can be asserted."""

    def __init__(self):
        self.calls = []
        self.tools = [{"name": "fact_store", "description": "x", "parameters": {"type": "object"}}]

    def initialize(self, session_id, **kwargs):
        self.calls.append(("initialize", session_id, kwargs))

    def system_prompt_block(self):
        return "# Holographic Memory\ninner block"

    def prefetch(self, query, *, session_id=""):
        self.calls.append(("prefetch", query, session_id))
        return "recall"

    def get_tool_schemas(self):
        return list(self.tools)

    def handle_tool_call(self, tool_name, args, **kwargs):
        self.calls.append(("handle_tool_call", tool_name))
        return json.dumps({"ok": True})

    def on_turn_start(self, turn_number, message, **kwargs):
        self.calls.append(("on_turn_start", turn_number))

    def on_session_end(self, messages):
        self.calls.append("on_session_end")

    def on_session_switch(self, new_session_id, **kwargs):
        self.calls.append(("on_session_switch", new_session_id))

    def shutdown(self):
        self.calls.append("shutdown")


MESSAGES = [
    {"role": "system", "content": "system prompt"},
    {"role": "user", "content": "Decided: deploy on Tuesdays only."},
    {"role": "assistant", "content": "Noted, Tuesday deploys."},
    {"role": "tool", "content": "tool output", "tool_call_id": "t1"},
]

SALIENCY = [{"index": 0, "destination": "ledger", "text": "Decided: deploy on Tuesdays only.",
             "failed_open": False, "degraded": False, "reason": ""}]


@pytest.fixture(autouse=True)
def stub_saliency(monkeypatch):
    monkeypatch.setattr(
        jev_checkpoint, "run_saliency_pass",
        lambda evidence, session_id="": [dict(SALIENCY[0], text=e["content"])
                                         for e in evidence if "Decided" in e["content"]],
        raising=True,
    )
    # Keep the lazy Jev client builder off the network/env in every test.
    monkeypatch.setattr(jev_checkpoint, "_build_jev_client", lambda: None, raising=True)


def make_provider(store=None):
    store = store if store is not None else FakeStore()
    provider = BalabotJevProvider(delegate=RecordingDelegate())
    provider._store_adapter = FakeAdapter(store)
    return provider, store


class BrokenAdapter:
    """Adapter whose store is unreachable — every write path raises."""

    def write_checkpoint(self, *a, **kw):
        raise CheckpointUnavailable("durable store unreachable")

    def record_compaction(self, *a, **kw):
        raise CheckpointUnavailable("durable store unreachable")

    def re_anchor(self, *a, **kw):
        return None


# -- 1. API version -----------------------------------------------------------


def test_advertises_checkpoint_api_version_2():
    assert BalabotJevProvider.pre_compress_checkpoint_api_version == 2
    assert BalabotJevProvider.pre_compress_checkpoint_api_version > 1


# -- 2. checkpoint persists durably and returns the context --------------------


def test_on_pre_compress_persists_and_returns_context():
    provider, store = make_provider()
    provider.initialize("sess-1", hermes_home="/tmp/hh", platform="cli")
    context = provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    assert "Tuesdays" in context
    assert len(store.decisions) == 1  # durable decision record
    assert store.decisions[0]["text"] == "Decided: deploy on Tuesdays only."
    assert store.compaction_records  # churn-detection record appended
    rb = provider._store_adapter.re_anchor("sess-1")
    assert rb["resume_state"]["checkpoint_hash"] == content_hash(normalize_evidence(MESSAGES))
    # tool payload must never be checkpointed as evidence
    assert "tool output" not in json.dumps(store.decisions)


# -- 3. strict mode raises when the store is unreachable ------------------------


def test_strict_mode_raises_when_store_unreachable():
    provider, _ = make_provider()
    provider._store_adapter = BrokenAdapter()
    with pytest.raises(Exception) as excinfo:
        provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    assert "checkpoint" in str(excinfo.value).lower()


def test_strict_mode_raises_when_saliency_pass_unavailable(monkeypatch):
    provider, _ = make_provider()

    def boom(evidence, session_id=""):
        raise jev_checkpoint.SaliencyUnavailable("balabot.jev_continuity unavailable: no module")

    monkeypatch.setattr(jev_checkpoint, "run_saliency_pass", boom, raising=True)
    with pytest.raises(Exception) as excinfo:
        provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    assert "saliency" in str(excinfo.value).lower() or "unavailable" in str(excinfo.value).lower()


# -- 4. best-effort mode does NOT raise ------------------------------------------


def test_best_effort_mode_does_not_raise():
    provider, _ = make_provider()
    provider._store_adapter = BrokenAdapter()
    assert provider.on_pre_compress(MESSAGES, require_checkpoint=False) == ""


# -- 5. idempotency --------------------------------------------------------------


def test_same_evidence_twice_does_not_double_write():
    provider, store = make_provider()
    first = provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    second = provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    assert len(store.decisions) == 1  # no double-write of decisions
    assert first == second


# -- 6. hermes_home honoured ------------------------------------------------------


def test_initialize_honours_hermes_home_kwarg(tmp_path, monkeypatch):
    # Bare provider (no injected store) so initialize() actually opens the
    # store and must pass the caller's hermes_home through — never ~/.hermes.
    provider = BalabotJevProvider(delegate=RecordingDelegate())
    hermes_home = tmp_path / "hermes-home"
    observed = {}
    monkeypatch.setattr(
        jev_checkpoint, "load_sessions_store",
        lambda hh: observed.setdefault("hermes_home", hh), raising=True,
    )
    provider.initialize("sess-2", hermes_home=str(hermes_home), platform="telegram")
    assert observed["hermes_home"] == str(hermes_home)  # respected, not ~/.hermes
    assert "~" not in str(observed["hermes_home"])
    # the delegate received the same kwargs
    assert provider._delegate.calls[0] == ("initialize", "sess-2", {"hermes_home": str(hermes_home), "platform": "telegram"})


def test_store_open_uses_hermes_home_scoped_db(tmp_path, monkeypatch):
    """load_sessions_store builds the DB path under the given hermes_home.

    Patches ``balabot.sessions.SessionStore`` on the REAL module rather than
    swapping ``sys.modules``. Production reads the attribute off the module
    (``import balabot.sessions as sessions`` then ``sessions.SessionStore(...)``),
    and an attribute binding is what the call site actually reads — a
    sys.modules swap is bypassed once the real module has been imported
    anywhere earlier in the session (import caches the package attribute).
    """
    import balabot.sessions as real_sessions

    opened = {}

    class FakeSessionStore:  # signature: (db_path=None)
        def __init__(self, db_path=None):
            opened["db_path"] = db_path

    monkeypatch.setattr(real_sessions, "SessionStore", FakeSessionStore)
    jev_checkpoint.load_sessions_store(str(tmp_path / "hh"))
    assert opened["db_path"] == str(tmp_path / "hh" / "memory" / "balabot-jev" / "continuity.db")


# -- 7. is_available makes no network call ----------------------------------------


def test_is_available_makes_no_network_call(monkeypatch):
    provider, _ = make_provider()

    def _no_socket(*a, **kw):
        raise AssertionError("network access attempted in is_available()")

    monkeypatch.setattr(socket, "socket", _no_socket)
    assert provider.is_available() is True


# -- wrap-don't-replace: delegation ------------------------------------------------


def test_delegation_reaches_inner_provider():
    provider, _ = make_provider()
    delegate = provider._delegate
    provider.initialize("sess-3", hermes_home="/tmp/hh", platform="cli")
    assert ("initialize", "sess-3", {"hermes_home": "/tmp/hh", "platform": "cli"}) in delegate.calls

    assert provider.system_prompt_block().startswith("# Holographic Memory")
    assert provider.prefetch("q", session_id="s") == "recall"
    assert provider.get_tool_schemas() == delegate.tools  # inner tools surface
    assert json.loads(provider.handle_tool_call("fact_store", {})) == {"ok": True}
    provider.on_turn_start(1, "hi", remaining_tokens=100)
    assert ("on_turn_start", 1) in delegate.calls
    provider.on_session_end([])
    provider.shutdown()
    assert "on_session_end" in delegate.calls
    assert "shutdown" in delegate.calls


def test_missing_inner_provider_does_not_crash_wrapper(monkeypatch):
    """Genuinely missing inner provider: the checkpoint survives, loudly degraded.

    This test used to simulate absence by assigning ``_delegate_error`` — and it
    only passed because ``_build_delegate()`` crashed on an absent config key
    (``dict(None)`` → TypeError), leaving the delegate None. Removing that bug
    exposed the false pass: ``initialize()`` simply built the real delegate. The
    absence must be simulated at the import, which is the thing that actually
    fails when the bundled provider is not there.
    """
    import builtins

    real_import = builtins.__import__

    def _import_without_holographic(name, *args, **kwargs):
        if name == "plugins.memory.holographic":
            raise ImportError("simulated missing module")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _import_without_holographic)

    provider = BalabotJevProvider(delegate=None)
    provider._store_adapter = FakeAdapter(FakeStore())
    provider.initialize("sess-4", hermes_home="/tmp/hh", platform="cli")
    assert provider._delegate is None
    assert provider._delegate_error
    # checkpoint still works without holographic
    context = provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    assert "Tuesdays" in context
    # degraded, loudly — the block must NOT pretend holographic is working
    block = provider.system_prompt_block()
    assert "DEGRADED" in block
    assert provider.get_tool_schemas() == []


def test_tool_schemas_surface_inner_provider_tools():
    """fact_store / fact_feedback MUST keep working through the wrapper."""
    provider, _ = make_provider()
    names = [t["name"] for t in provider.get_tool_schemas()]
    assert "fact_store" in names


def test_session_switch_rebinds_state():
    provider, store = make_provider()
    provider.initialize("sess-a", hermes_home="/tmp/hh", platform="cli")
    provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    provider.on_session_switch("sess-b", reset=False)
    assert ("on_session_switch", "sess-b") in provider._delegate.calls
    provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    # each session checkpoints independently
    assert {d["session_id"] for d in store.decisions} == {"sess-a", "sess-b"}


def test_reanchor_uses_durable_state_not_summary():
    """system_prompt_block must re-anchor from the store's re_anchor bundle."""
    provider, store = make_provider()
    provider.initialize("sess-5", hermes_home="/tmp/hh", platform="cli")
    provider.on_pre_compress(MESSAGES, require_checkpoint=True)
    block = provider.system_prompt_block()
    assert "Re-anchored from durable Jev checkpoint state" in block
    assert "Decided: deploy on Tuesdays only." in block


# -- delegate config normalisation (live-container regression) --------------------


def test_delegate_config_absent_key_is_none_never_dict_none():
    """REGRESSION — found only by running against the real bundled provider.

    An absent ``holographic`` config key used to reach ``dict(None)``, raising
    TypeError. The delegate was then never built, ``get_tool_schemas()`` returned
    [], and fact_store / fact_feedback were silently OFF while the checkpoint
    still reported healthy. Every unit test passed because the delegate is faked;
    the live container is what caught it. Absent must map to None — the inner
    provider loads its own config from config.yaml when given None.
    """
    assert plugin._delegate_config(None) is None
    assert plugin._delegate_config({}) == {}
    # non-dict config (a malformed config.yaml value) must not explode either
    assert plugin._delegate_config("holographic") is None
    assert plugin._delegate_config([1, 2]) is None


def test_delegate_config_copies_rather_than_aliases():
    """The inner provider must not be able to mutate our config in place."""
    raw = {"db_path": "/tmp/store.db"}
    normalised = plugin._delegate_config(raw)
    assert normalised == raw
    assert normalised is not raw
    normalised["db_path"] = "/tmp/other.db"
    assert raw["db_path"] == "/tmp/store.db"
