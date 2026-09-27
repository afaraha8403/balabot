"""Wiring tests: prove the four orphaned features now have REAL call sites.

Every test here is about a production call path that previously existed only
in tests (the audit's orphaned-module class):

1. Jev incident write at boot      -> bootstrap.run_bootstrap calls
                                      enforce_jev_dependency
2. Memory relevance ladder         -> the balabot-jev provider prefetch calls
                                      run_relevance_ladder (non-blocking)
3. Jev decision gate on the ledger -> growth.record_decision passes through
                                      jev_depth.is_decision_worthy
4. Org secret_request producer     -> bot_tools.request_secret enqueues into
                                      the org-request queue the UI drains

No network anywhere: Jev is injected or monkeypatched at the seam.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from balabot import bootstrap as bootstrap_mod
from balabot import bot_tools, growth
from balabot.bootstrap import list_jev_incidents
from balabot.jev import JevHealth


# ---------------------------------------------------------------------------
# 1. Jev incident write at boot
# ---------------------------------------------------------------------------


def test_run_bootstrap_calls_enforce_jev_dependency(hermes_env, fake_repo, monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(bootstrap_mod, "_repo_root", lambda: fake_repo)
    monkeypatch.setattr(
        bootstrap_mod, "enforce_jev_dependency",
        lambda name, **kw: calls.append(name) or JevHealth("ok", "answered"),
    )
    bootstrap_mod.run_bootstrap()
    assert calls == list(bootstrap_mod.PERSONAS)


def test_run_bootstrap_records_incident_on_transient_outage_and_continues(
    hermes_env, fake_repo, monkeypatch
):
    """A transient Jev outage at boot records the durable incident AND still
    provisions every persona — record-and-continue, never an abort."""
    monkeypatch.setattr(bootstrap_mod, "_repo_root", lambda: fake_repo)

    def unreachable(*args, **kw):
        return JevHealth("unreachable", "transport error: ConnectionError")

    import balabot.jev

    monkeypatch.setattr(balabot.jev, "check_jev_health", unreachable)
    reports = bootstrap_mod.run_bootstrap()  # must NOT raise
    assert [r["persona"] for r in reports] == list(bootstrap_mod.PERSONAS)
    for persona in bootstrap_mod.PERSONAS:
        incidents = list_jev_incidents(persona)
        assert len(incidents) == 1
        assert incidents[0]["status"] == "unreachable"
        assert incidents[0]["severity"] == "critical"


def test_run_bootstrap_ok_health_writes_no_incident(hermes_env, fake_repo, monkeypatch):
    monkeypatch.setattr(bootstrap_mod, "_repo_root", lambda: fake_repo)
    monkeypatch.setattr(
        bootstrap_mod, "enforce_jev_dependency",
        lambda name, **kw: JevHealth("ok", "answered"),
    )
    bootstrap_mod.run_bootstrap()
    for persona in bootstrap_mod.PERSONAS:
        assert list_jev_incidents(persona) == []


# ---------------------------------------------------------------------------
# 2. Memory relevance ladder in the provider prefetch
# ---------------------------------------------------------------------------

_PLUGIN_DIR = Path(__file__).resolve().parent.parent / "hermes" / "plugins" / "balabot-jev"
if str(_PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_DIR))


def _load_plugin():
    if "balabot_jev_plugin_wiring" in sys.modules:
        return sys.modules["balabot_jev_plugin_wiring"]
    spec = importlib.util.spec_from_file_location(
        "balabot_jev_plugin_wiring", _PLUGIN_DIR / "__init__.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["balabot_jev_plugin_wiring"] = module
    spec.loader.exec_module(module)
    return module


plugin = _load_plugin()
BalabotJevProvider = plugin.BalabotJevProvider


class _Store:
    """Minimal durable store exposing recalled decisions to the ladder."""

    def __init__(self, decisions):
        self._decisions = decisions

    def re_anchor(self, session_id):
        return {"decisions": [{"text": d} for d in self._decisions]}


class _Inner:
    def prefetch(self, query, *, session_id=""):
        return "recall text"


def _provider(decisions):
    p = BalabotJevProvider(delegate=_Inner())
    p._session_id = "sess"
    p._store_adapter = _Store(decisions)
    return p


class _FakeJev:
    """Answers every candidate with the given probability."""

    def __init__(self, prob):
        self.prob = prob
        self.calls = []

    def system_one(self, state, questions, *, shadow=False):
        self.calls.append((state, dict(questions)))
        return {
            "answers": {ref: {"type": "noul", "noul": self.prob} for ref in questions},
        }


def test_prefetch_runs_relevance_ladder(monkeypatch):
    calls: list[dict] = []

    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    import balabot.memory_relevance as mr

    def fake_ladder(client, state, candidates, *, threshold=0.75, **kw):
        calls.append({"state": state, "refs": [c.ref for c in candidates],
                      "texts": [c.text for c in candidates]})
        from balabot.memory_relevance import RelevanceResult

        return RelevanceResult(
            kept=list(candidates), scores={c.ref: 0.9 for c in candidates},
            threshold=threshold, no_relevant_memory=False, reason="ok",
        )

    monkeypatch.setattr(mr, "run_relevance_ladder", fake_ladder)
    p = _provider(["Decided: deploy on Tuesdays only."])
    out = p.prefetch("how do we deploy?", session_id="sess")
    assert len(calls) == 1
    assert calls[0]["refs"] and "deploy on Tuesdays" in calls[0]["texts"][0]
    assert "recall text" in out  # unranked parts preserved
    assert "deploy on Tuesdays" in out  # ranked suffix present


def test_prefetch_jev_failure_degrades_to_unranked_without_raising(monkeypatch):
    from balabot import memory_relevance as mr

    def boom(client, state, candidates, *, threshold=0.75, **kw):
        raise mr.Jev.__init__.__self__.__class__ if False else RuntimeError("jev down")

    monkeypatch.setattr(mr, "run_relevance_ladder", boom)
    p = _provider(["Decided: deploy on Tuesdays only."])
    out = p.prefetch("how do we deploy?", session_id="sess")  # must NOT raise
    assert "recall text" in out  # the unranked parts came through


def test_prefetch_ladder_missing_module_degrades(monkeypatch):
    import balabot.memory_relevance as mr

    monkeypatch.setattr(mr, "run_relevance_ladder", None)  # import-guard path
    p = _provider(["Decided: deploy on Tuesdays only."])
    out = p.prefetch("q", session_id="sess")  # must NOT raise
    assert "recall text" in out


def test_prefetch_no_candidates_skips_the_ladder(monkeypatch):
    from balabot import memory_relevance as mr

    def fail(*a, **kw):
        raise AssertionError("ladder must not run with no candidates")

    monkeypatch.setattr(mr, "run_relevance_ladder", fail)
    p = _provider([])
    assert p.prefetch("q", session_id="sess") == "recall text"


# ---------------------------------------------------------------------------
# 3. Jev decision gate on the governor's ledger path
# ---------------------------------------------------------------------------


def test_record_decision_passes_through_gate(hermes_env):
    calls: list[str] = []

    def fake_gate(statement, *, jev=None):
        calls.append(statement)
        from balabot.jev_depth import Decision

        return Decision(worthy=True, reason="jev decision gate", confidence=0.9)

    rec = growth.record_decision("We will deploy on Tuesdays.", gate=fake_gate)
    assert calls == ["We will deploy on Tuesdays."]
    assert rec is not None
    assert rec["type"] == "decision"
    assert rec["persona"] == growth.GOVERNOR
    assert rec["gate_failed_open"] is False
    path = hermes_env["data_root"] / "profiles" / "governor" / "ledger" / "frustration.jsonl"
    assert "We will deploy on Tuesdays." in path.read_text(encoding="utf-8")


def test_record_decision_gate_rejects(hermes_env):
    from balabot.jev_depth import Decision

    rec = growth.record_decision(
        "what time is it?",
        gate=lambda s, **kw: Decision(False, "jev decision gate", 0.1),
    )
    assert rec is None
    assert growth.read_frustration_entries() == []


def test_record_decision_gate_failure_fails_open_and_never_blocks(hermes_env):
    """The documented over-admit contract: a Jev outage admits the decision
    WITH a stated reason — it never raises into the caller's work."""
    from balabot.jev import JevError
    from balabot.jev_depth import Decision

    def broken_gate(statement, *, jev=None):
        # the real is_decision_worthy already fails open on JevError; simulate
        # the outage path through the REAL gate with a raising client
        from balabot.jev_depth import is_decision_worthy

        class Exploding:
            def system_one(self, *a, **kw):
                raise JevError("Jev unreachable after retries")

        return is_decision_worthy(statement, jev=Exploding())

    rec = growth.record_decision("Decided: adopt the new format.", gate=broken_gate)
    assert rec is not None  # admitted
    assert rec["gate_failed_open"] is True
    assert "failed open" in rec["gate"]
    # and the default (no gate / no client) also fails open, never blocks:
    rec2 = growth.record_decision("Decided: also this one.", jev=None)
    assert rec2 is not None and rec2["gate_failed_open"] is True


def test_record_decision_uses_real_gate_by_default(hermes_env, monkeypatch):
    """Without an injected gate, the REAL jev_depth.is_decision_worthy runs."""
    import balabot.jev_depth as jd

    seen: list[tuple] = []
    real = jd.is_decision_worthy

    def spy(statement, *, jev=None):
        seen.append((statement, jev))
        return real(statement, jev=jev)

    monkeypatch.setattr(jd, "is_decision_worthy", spy)
    monkeypatch.setattr(growth, "is_decision_worthy", spy, raising=False)
    growth.record_decision("Decided: ship it.")
    assert seen and seen[0][0] == "Decided: ship it."


# ---------------------------------------------------------------------------
# 4. Org secret_request producer
# ---------------------------------------------------------------------------


@pytest.fixture
def org_env(tmp_path, monkeypatch):
    """Isolated BALABOT_DATA_ROOT (same contract as test_bot_tools' fixture)."""
    data_root = tmp_path / "data"
    data_root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    return {"data_root": data_root}


@pytest.fixture
def server_queue(monkeypatch):
    """A fake of ui.server's org-request queue (the EXISTING queue API)."""
    queue: dict[str, list[dict]] = {}

    def enqueue(profile: str, event: dict) -> dict:
        item = {"id": "r_test", "created_at": "now", **event}
        queue.setdefault(profile, []).append(item)
        return item

    import types
    ui_pkg = types.ModuleType("ui")
    server_mod = types.ModuleType("ui.server")
    server_mod.enqueue_org_request = enqueue
    monkeypatch.setitem(sys.modules, "ui", ui_pkg)
    monkeypatch.setitem(sys.modules, "ui.server", server_mod)
    ui_pkg.server = server_mod
    return queue


def test_request_secret_enqueues_into_org_request_queue(org_env, server_queue):
    out = bot_tools.request_secret("SLACK_TOKEN", "bot posts", bot_id="steve")
    assert out["requested"] is True
    queued = server_queue.get("steve") or []
    assert len(queued) == 1
    assert queued[0]["kind"] == "secret_request"
    assert queued[0]["name"] == "SLACK_TOKEN"
    assert queued[0]["bot"] == "steve"
    # durable pending row still written
    assert bot_tools.list_pending_requests("steve")


def test_request_secret_access_enqueues_too(org_env, server_queue):
    bot_tools.request_secret_access("oscar", "AWS_KEY", "needs it")
    queued = server_queue.get("oscar") or []
    assert queued and queued[0]["kind"] == "secret_access_request"
    assert queued[0]["reason"] == "needs it"


def test_request_secret_queue_failure_never_fails_the_request(org_env, monkeypatch):
    def boom(profile, event):
        raise ValueError("org request queue unavailable")

    import types
    ui_pkg = types.ModuleType("ui")
    server_mod = types.ModuleType("ui.server")
    server_mod.enqueue_org_request = boom
    monkeypatch.setitem(sys.modules, "ui", ui_pkg)
    monkeypatch.setitem(sys.modules, "ui.server", server_mod)
    ui_pkg.server = server_mod
    out = bot_tools.request_secret("SLACK_TOKEN", bot_id="steve")  # must not raise
    assert out["requested"] is True
    assert bot_tools.list_pending_requests("steve")  # durable row survived


def test_produced_item_matches_the_server_frame_contract(org_env, server_queue):
    """The enqueued item carries exactly the fields ui/server.py's drain
    reads (kind/bot/name/description) — so the SSE frame grammar holds."""
    bot_tools.request_secret("STRIPE_KEY", "payments", bot_id="governor")
    item = server_queue["governor"][0]
    assert item["kind"] in ("secret_request", "secret_access_request")
    assert item["bot"] == "governor"
    assert item["name"] == "STRIPE_KEY"
    assert item["description"] == "payments"
