"""Tests for balabot.jev_depth — no network in any test (Jev is faked)."""

from __future__ import annotations

import pytest

from balabot import jev_depth
from balabot.jev import JevError
from balabot.jev_depth import (
    Decision,
    is_decision_worthy,
    prompt_line,
    select_skills,
)


class FakeJev:
    """Scripted stand-in for the Jev client; records every request."""

    def __init__(self, responses: list[dict] | Exception | None = None) -> None:
        self.responses = responses if isinstance(responses, list) else []
        self.error = responses if isinstance(responses, Exception) else None
        self.calls: list[tuple] = []

    def system_one(self, state, questions, *, shadow: bool = False) -> dict:
        self.calls.append((state, dict(questions)))
        if self.error is not None:
            raise self.error
        if not self.responses:
            raise JevError("no scripted response")
        return self.responses.pop(0)


def noul(prob: float) -> dict:
    return {
        "answers": {"decision_worthy": {"probability": prob}},
        "confidence": prob,
    }


# --- decision gate ---------------------------------------------------------


def test_gate_admits_high_probability_decision():
    gate = is_decision_worthy("migrate the DB to v3", jev=FakeJev([noul(0.93)]))
    assert gate.worthy and not gate.failed_open
    assert gate.confidence == pytest.approx(0.93)


def test_gate_rejects_low_probability():
    gate = is_decision_worthy("casual chatter", jev=FakeJev([noul(0.04)]))
    assert not gate.worthy


def test_gate_fails_open_on_jev_error():
    gate = is_decision_worthy("ship it", jev=FakeJev(JevError("503 from Jev")))
    assert gate.worthy is True
    assert gate.reason.startswith("gate unavailable - failed open")
    assert gate.failed_open is True


def test_gate_fails_open_with_no_client():
    gate = is_decision_worthy("ship it")
    assert gate.worthy and gate.failed_open
    assert gate.reason == "gate unavailable - failed open"


# --- skill selection -------------------------------------------------------

CATALOG = {
    "pptx-author": "Create and edit PowerPoint decks from scratch.",
    "pptx-read": "Read and extract text from existing .pptx files.",
    "xlsx": "Create, read, and edit Excel workbooks.",
}


def test_select_skills_truncates_descriptions_to_60_chars():
    long_desc = "x" * 200
    jev = FakeJev(
        [
            {"answers": {"candidates": {"pptx-read": 0.9}}},
            {"answers": {"pptx-read": {"probability": 0.8}}},
        ]
    )
    select_skills("extract deck text", {"pptx-read": long_desc}, jev=jev)
    state = jev.calls[0][0]
    assert ("x" * 60) in state
    assert ("x" * 61) not in state


def test_select_skills_enforces_two_request_budget():
    jev = FakeJev(
        [
            {"answers": {"candidates": {"pptx-read": 0.9, "xlsx": 0.5}}},
            {"answers": {"pptx-read": {"probability": 0.8}}},
        ]
    )
    picked = select_skills("workbooks", CATALOG, jev=jev)
    assert picked == ["pptx-read"]
    assert len(jev.calls) == 2


def test_select_skills_budget_exhausted_selects_nothing():
    jev = FakeJev([{"answers": {"candidates": {"pptx-read": 0.9}}}])
    assert select_skills("decks", CATALOG, jev=jev, requests_allowed=1) == []


def test_select_skills_drops_unknown_names():
    # Jev hallucinates a name outside the roster → must be dropped, not invented.
    jev = FakeJev(
        [
            {"answers": {"candidates": {"ghost-skill": 0.99, "pptx-read": 0.8}}},
            {"answers": {"pptx-read": {"probability": 0.8}}},
        ]
    )
    assert select_skills("decks", CATALOG, jev=jev) == ["pptx-read"]


def test_select_skills_below_threshold_selects_nothing():
    jev = FakeJev(
        [
            {"answers": {"candidates": {"xlsx": 0.9}}},
            {"answers": {"xlsx": {"probability": 0.29}}},
        ]
    )
    assert select_skills("spreadsheets", CATALOG, jev=jev) == []


def test_select_skills_no_client_returns_empty():
    assert select_skills("anything", CATALOG, jev=None) == []


def test_threshold_constant_is_030():
    assert jev_depth.SKILL_GATE_THRESHOLD == 0.30


# --- prompt line -----------------------------------------------------------


def test_prompt_line_format_is_exact():
    line = prompt_line(["pptx-author", "xlsx"], "ROSTER_PREFIX ")
    assert line == (
        "ROSTER_PREFIX <skill_relevance>Relevant to the current request: "
        "pptx-author, xlsx</skill_relevance>"
    )


def test_prompt_line_preserves_roster_prefix_untouched():
    prefix = "roster (never rewritten)"
    out = prompt_line(["a"], prefix)
    assert out.startswith(prefix)
    assert prompt_line(["a"], prefix)[len(prefix):].startswith("<skill_relevance>")


def test_prompt_line_empty_when_nothing_selected():
    assert prompt_line([], "prefix ") == ""
    assert prompt_line([], "") == ""


def test_decision_dataclass_shape():
    d = Decision(worthy=True, reason="r", confidence=0.5)
    assert (d.worthy, d.reason, d.confidence) == (True, "r", 0.5)
