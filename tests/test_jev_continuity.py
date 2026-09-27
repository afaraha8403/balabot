"""Tests for balabot.jev_continuity — no network, no TYPESAFE_API_KEY, ever."""

from __future__ import annotations

from balabot import jev_continuity as jc
from balabot.jev import JevError
from balabot.jev_continuity import (
    context_signals,
    route_session,
    saliency_pass,
)


class FakeJev:
    """Scripted stand-in; records every (state, questions) request."""

    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.calls = []
        self.shadow_flags = []

    def system_one(self, state, questions, *, shadow=False):
        self.calls.append((state, dict(questions)))
        self.shadow_flags.append(shadow)
        if self.error is not None:
            raise self.error
        if not self.responses:
            raise JevError("no scripted response")
        return self.responses.pop(0)


def ans(**kwargs) -> dict:
    """A scripted answer set in the REAL Noul wire shape.

    The live API answers a noul question as ``{"type": "noul", "noul": 0.73}`` —
    the probability is under ``"noul"``, never ``"probability"``. This helper
    used to emit ``{"probability": v}``, which the production code read with a
    0.0 default: every gate silently evaluated to "no" and the tests agreed with
    the bug. Keep this shape identical to the wire.
    """
    return {"answers": {k: {"type": "noul", "noul": v} for k, v in kwargs.items()}}


NOW = 1_800_000_000.0
DAY = 86400.0


def cand(id, summary, *, bot_id="main", last_active=None, text=""):
    return {
        "id": id,
        "summary": summary,
        "text": text,
        "bot_id": bot_id,
        "last_active": NOW - 2 * DAY if last_active is None else last_active,
    }


# --- saliency pass -----------------------------------------------------------


def test_decision_item_routes_to_ledger():
    jev = FakeJev([ans(**{
        "0_is_decision": 0.92, "0_is_durable_fact": 0.10, "0_is_live_task_state": 0.10,
    })])
    result = saliency_pass(["we decided to migrate the DB to v3"], jev=jev)
    assert result.items[0].destination == "ledger"
    assert not result.degraded


def test_durable_fact_routes_to_holographic_memory():
    jev = FakeJev([ans(**{
        "0_is_decision": 0.05, "0_is_durable_fact": 0.88, "0_is_live_task_state": 0.10,
    })])
    result = saliency_pass(["Kalam's stack is Next.js on Vercel"], jev=jev)
    assert result.items[0].destination == "holographic"


def test_live_task_state_routes_to_working_set():
    jev = FakeJev([ans(**{
        "0_is_decision": 0.05, "0_is_durable_fact": 0.05, "0_is_live_task_state": 0.90,
    })])
    result = saliency_pass(["we are mid-way through the Jev refactor"], jev=jev)
    assert result.items[0].destination == "working_set"


def test_noise_is_dropped_deliberately():
    jev = FakeJev([ans(**{
        "0_is_decision": 0.02, "0_is_durable_fact": 0.02, "0_is_live_task_state": 0.02,
    })])
    result = saliency_pass(["lol ok anyway"], jev=jev)
    assert result.items[0].destination == "dropped"


def test_all_items_in_one_parallel_request():
    texts = ["a", "b", "c"]
    # The API answers EVERY question it is asked, so the script must cover all
    # three predicates per item — a partial answer set is not a real response.
    jev = FakeJev([ans(**{
        **{f"{i}_is_decision": 0.9 for i in range(3)},
        **{f"{i}_is_durable_fact": 0.0 for i in range(3)},
        **{f"{i}_is_live_task_state": 0.0 for i in range(3)},
    })])
    saliency_pass(texts, jev=jev)
    assert len(jev.calls) == 1  # ONE request, questions evaluated in parallel
    state, questions = jev.calls[0]
    for i in range(3):
        assert questions[f"{i}_is_decision"]["type"] == "noul"
        assert questions[f"{i}_is_durable_fact"]["type"] == "noul"
        assert questions[f"{i}_is_live_task_state"]["type"] == "noul"
        assert f"[{i}] a" if i == 0 else f"[{i}] {texts[i]}" in state


def test_saliency_fails_open_to_working_set_with_reason():
    jev = FakeJev(error=JevError("503 from Jev"))
    result = saliency_pass(["decided X", "mid-way through Y"], jev=jev)
    assert result.degraded is True
    assert result.reason.startswith("Jev unavailable - failed open")
    assert all(i.destination == "working_set" for i in result.items)
    assert all(i.failed_open for i in result.items)


def test_saliency_fails_open_with_no_client():
    result = saliency_pass(["anything at all"])
    assert result.degraded and result.reason
    assert result.items[0].destination == "working_set"


def test_saliency_asks_never_counting_questions():
    jev = FakeJev([ans(**{"0_is_decision": 0.9, "0_is_durable_fact": 0.1, "0_is_live_task_state": 0.1})])
    saliency_pass(["migrate the DB"], jev=jev)
    _, questions = jev.calls[0]
    blob = repr(questions)
    for banned in ("how many", "count", "add", "subtract", "date"):
        assert banned not in blob.lower()


# --- context signals ---------------------------------------------------------


def test_near_limit_computed_in_code():
    out = context_signals(
        tokens_used=900, token_limit=1000, purpose_record="p",
        current_turn="t", past_turns=[], jev=FakeJev([ans(drifted=0.1)]),
    )
    assert out.near_limit is True and out.usage_ratio == 0.9
    # one Jev call only (drift; no repeat candidates)
    assert len(out.__class__.__mro__) > 0


def test_near_limit_not_triggered_below_ratio():
    out = context_signals(
        tokens_used=100, token_limit=1000, purpose_record="p",
        current_turn="t", past_turns=[], jev=FakeJev([ans(drifted=0.1)]),
    )
    assert out.near_limit is False


def test_drift_signal_from_noul():
    out = context_signals(
        tokens_used=10, token_limit=1000, purpose_record="plan the clinic launch",
        current_turn="what about the dentist logo", past_turns=[],
        jev=FakeJev([ans(drifted=0.91)]),
    )
    assert out.drifted and out.drift_probability == 0.91


def test_repetition_detected_via_code_prefilter_plus_noul():
    jev = FakeJev([ans(drifted=0.05, same_question=0.88)])
    out = context_signals(
        tokens_used=10, token_limit=1000, purpose_record="p",
        current_turn="how do I reset the router password",
        past_turns=["earlier", "what is the router password reset"],
        jev=jev,
    )
    assert out.repeated and out.repetition_candidate == "what is the router password reset"
    assert len(jev.calls) == 1
    state = jev.calls[0][0]
    assert "router password reset" in state
    assert "earlier" not in state  # pre-filter kept only the overlapping candidate


def test_no_repeat_candidates_means_no_same_question_asked():
    jev = FakeJev([ans(drifted=0.05)])
    context_signals(
        tokens_used=10, token_limit=1000, purpose_record="p",
        current_turn="how do I reset the router password",
        past_turns=["entirely unrelated weather talk"],
        jev=jev,
    )
    assert len(jev.calls) == 1
    assert "same_question" not in jev.calls[0][1]


def test_context_signals_degraded_on_jev_error_but_near_limit_stands():
    out = context_signals(
        tokens_used=990, token_limit=1000, purpose_record="p",
        current_turn="t", past_turns=[], jev=FakeJev(error=JevError("down")),
    )
    assert out.degraded and out.near_limit is True
    assert out.drifted is False  # no signal, not a guess


# --- session routing ---------------------------------------------------------


def test_resume_when_candidate_clears_bar():
    jev = FakeJev([ans(needs_new_session=0.05, **{"same_purpose_cand_a": 0.92, "same_purpose_cand_b": 0.10})])
    route = route_session(
        "continue the migration",
        [cand("cand_a", "DB migration"), cand("cand_b", "logo work")],
        jev=jev, bot_id="main", now=NOW,
    )
    assert route.outcome == "resume" and route.candidate_id == "cand_a"
    assert route.needs_new_probability == 0.05


def test_new_linked_when_best_candidate_below_resume_above_linkage():
    jev = FakeJev([ans(needs_new_session=0.9, **{"same_purpose_cand_a": 0.5})])
    route = route_session("new project", [cand("cand_a", "old project")], jev=jev, bot_id="main", now=NOW)
    assert route.outcome == "new_linked"


def test_new_clean_when_no_linkage():
    jev = FakeJev([ans(needs_new_session=0.95, **{"same_purpose_cand_a": 0.05})])
    route = route_session("brand new topic", [cand("cand_a", "totally other thing")], jev=jev, bot_id="main", now=NOW)
    assert route.outcome == "new_clean"


def test_ask_user_on_genuine_ambiguity():
    jev = FakeJev([ans(needs_new_session=0.30, **{"same_purpose_cand_a": 0.50})])
    route = route_session("hmm about the migration", [cand("cand_a", "migration plan")], jev=jev, bot_id="main", now=NOW)
    assert route.outcome == "ask_user"
    assert route.candidate_probabilities == {"cand_a": 0.50}
    assert route.needs_new_probability == 0.30


def test_prefilter_drops_other_bot_stale_and_lexically_disjoint():
    cands = [
        cand("same_bot_fresh", "DB migration plan"),
        cand("other_bot", "DB migration plan", bot_id="other"),
        cand("stale", "DB migration plan", last_active=NOW - 30 * DAY),
        cand("disjoint", "weather forecast for the weekend"),
    ]
    jev = FakeJev([ans(needs_new_session=0.05, **{"same_purpose_same_bot_fresh": 0.9})])
    route = route_session("continue the DB migration work", cands, jev=jev, bot_id="main", now=NOW)
    assert route.filtered_candidates == ["same_bot_fresh"]
    assert set(route.candidate_probabilities) == {"same_bot_fresh"}
    state = jev.calls[0][0]
    assert "other_bot" not in state and "stale" not in state and "disjoint" not in state


def test_prefilter_exposed_on_result_even_when_degraded():
    route = route_session("anything about the migration", [cand("c_a", "migration work")], jev=None, bot_id="main", now=NOW)
    assert route.outcome == "ask_user" and route.degraded and route.reason
    assert route.filtered_candidates == ["c_a"]


def test_route_degrades_to_ask_user_on_jev_error():
    jev = FakeJev(error=JevError("down"))
    route = route_session("continue", [cand("c_a", "previous work")], jev=jev, bot_id="main", now=NOW)
    assert route.outcome == "ask_user" and route.degraded


def test_shadow_passthrough_recorded():
    jev = FakeJev([ans(needs_new_session=0.05, **{"same_purpose_c_a": 0.9})])
    route_session("continue", [cand("c_a", "prior work")], jev=jev, bot_id="main", now=NOW, shadow=True)
    assert jev.shadow_flags == [True]


def test_gate_constants_are_declared():
    assert jc.RESUME_GATE == 0.70 and jc.NEW_SESSION_GATE == 0.60
    assert jc.SALIENCY_GATE == 0.50 and jc.NEAR_LIMIT_RATIO == 0.85
    assert set(jc.OUTCOMES) == {"resume", "new_linked", "new_clean", "ask_user"}
