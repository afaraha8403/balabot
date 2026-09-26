"""Relevance ladder contracts: one Noul per candidate, thresholds, re-look,
explicit nothing, shadow mode, fail-loud on malformed answers."""

from __future__ import annotations

import pytest

from balabot.memory_relevance import (
    Candidate,
    run_relevance_ladder,
    score_candidates,
)
from tests.conftest import make_candidates

CANDIDATES = make_candidates("a", "b", "c")


def test_keeps_candidates_above_threshold(fake_jev):
    # a scores high, b and c score low
    client = fake_jev([{"a": 0.95, "b": 0.10, "c": 0.40}])
    result = run_relevance_ladder(client, "ctx", CANDIDATES, threshold=0.75)
    assert [c.ref for c in result.kept] == ["a"]
    assert result.no_relevant_memory is False
    assert result.scores == {"a": 0.95, "b": 0.10, "c": 0.40}
    assert result.threshold == 0.75


def test_uses_one_noul_per_candidate_not_a_choice(fake_jev):
    client = fake_jev([{"a": 0.9, "b": 0.9, "c": 0.9}])
    score_candidates(client, "ctx", CANDIDATES)
    state, questions = client.calls[0]
    # One question per candidate — and each is a noul (never a Choice).
    assert set(questions) == {"a", "b", "c"}
    for q in questions.values():
        # The live API selects the primitive with a `type` discriminator, and
        # rejects a Noul carrying neither `criteria` nor `instructions`.
        # Verified 2026-09-26 against api.typesafe.ai/v1/systemone.
        assert q["type"] == "noul"
        assert "primitive" not in q, (
            "the live API rejects 'primitive' with union_tag_not_found"
        )
        assert ("criteria" in q) or ("instructions" in q), (
            "a Noul must carry criteria or instructions"
        )


def test_re_look_invoked_when_nothing_clears_threshold(fake_jev):
    # First call: all low. Re-look fetches fresh candidates; second call: one high.
    client = fake_jev([{"a": 0.1}, {"fresh": 0.9}])
    fetched: list[list[Candidate]] = []

    def widen(state):
        fetched.append([Candidate(ref="fresh", text="new fact")])
        return fetched[-1]

    result = run_relevance_ladder(
        client, "ctx", [Candidate(ref="a", text="weak")],
        threshold=0.75, re_look_strategies=[widen],
    )
    assert fetched and fetched[0][0].ref == "fresh"
    assert "widen" in result.re_look_attempts
    assert [c.ref for c in result.kept] == ["fresh"]
    assert result.no_relevant_memory is False


def test_re_look_runs_until_success_or_exhaustion(fake_jev):
    client = fake_jev([])  # every call scores 0.0
    tried = []

    def strat(state):
        tried.append(strat.__name__)
        return [Candidate(ref="x", text="still weak")]

    result = run_relevance_ladder(
        client, "ctx", [Candidate(ref="a", text="weak")],
        threshold=0.75, re_look_strategies=[strat, strat],
    )
    assert tried == ["strat", "strat"]
    assert result.no_relevant_memory is True
    assert result.kept == []
    # Stage 5: explicit nothing — the reason says so, it's not a silent empty.
    assert "no candidate cleared" in result.reason
    assert "re-look" in result.reason


def test_explicit_nothing_is_not_an_empty_success(fake_jev):
    client = fake_jev([{"a": 0.2}])
    result = run_relevance_ladder(client, "ctx", [Candidate(ref="a", text="x")], threshold=0.75)
    # The caller can distinguish "nothing found" from "empty input":
    assert result.no_relevant_memory is True
    assert result.kept == []
    assert result.scores == {"a": 0.2}


def test_shadow_mode_returns_everything_and_reports_would_keep(fake_jev):
    # All three score high — in shadow mode everything is returned anyway.
    client = fake_jev([{"a": 0.9, "b": 0.9, "c": 0.9}])
    result = run_relevance_ladder(client, "ctx", CANDIDATES, threshold=0.5, shadow=True)
    assert result.shadow is True
    assert {c.ref for c in result.kept} == {"a", "b", "c"}
    assert {c.ref for c in result.would_keep} == {"a", "b", "c"}


def test_shadow_mode_low_scores_still_returns_but_reports_would_keep_empty(fake_jev):
    client = fake_jev([{"a": 0.1, "b": 0.2, "c": 0.3}])
    result = run_relevance_ladder(client, "ctx", CANDIDATES, threshold=0.75, shadow=True)
    # Shadow keeps observing, doesn't act: kept is empty, would_keep tells truth.
    assert result.kept == []
    assert result.would_keep == []
    assert result.no_relevant_memory is True


def test_non_shadow_has_no_would_keep(fake_jev):
    client = fake_jev([{"a": 0.9, "b": 0.1, "c": 0.9}])
    result = run_relevance_ladder(client, "ctx", CANDIDATES, threshold=0.5)
    assert result.would_keep is None


def test_malformed_non_noul_answer_raises(fake_jev):
    class ChoiceJev:
        def system_one(self, state, questions, *, shadow=False):
            return {
                "model": "jev-1.13.0",
                "answers": {
                    # Wrong primitive: a choice answer where a noul is required.
                    "a": {"type": "choice", "choice": "a", "confidence": 1.0,
                          "probabilities": {"a": 1.0}}
                },
            }

    with pytest.raises(ValueError, match="not a noul"):
        score_candidates(ChoiceJev(), "ctx", [Candidate(ref="a", text="x")])


def test_missing_noul_field_raises():
    class BadJev:
        def system_one(self, state, questions, *, shadow=False):
            return {"answers": {"a": {"type": "noul"}}}  # no 'noul' value

    with pytest.raises(ValueError, match="missing 'noul'"):
        score_candidates(BadJev(), "ctx", [Candidate(ref="a", text="x")])


def test_batch_guidance_enforced():
    class NeverCalled:
        def system_one(self, *a, **k):
            raise AssertionError("should not be called")

    too_many = [Candidate(ref=str(i), text="x") for i in range(31)]
    with pytest.raises(ValueError, match="exceeds"):
        score_candidates(NeverCalled(), "ctx", too_many)
