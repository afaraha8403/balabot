"""Tests for balabot.jev_prompt — no network, Jev is always a fake."""

from __future__ import annotations

import pytest

from balabot import jev_prompt
from balabot.jev import JevError
from balabot.jev_depth import MAX_REQUESTS_PER_TURN, PROMPT_LINE_TAG
from balabot.jev_prompt import inject, select_and_render

CATALOG = {
    "pdf": "PDF files: create, read, merge, fill, OCR, edit text.",
    "xlsx": "Create, read, edit Excel .xlsx workbooks and CSVs.",
    "maps": "Geocode, POIs, routes, timezones via OpenStreetMap/OSRM.",
}


class FakeJev:
    """Scripted stand-in; records every request for budget assertions."""

    def __init__(self, responses: list[dict] | Exception) -> None:
        self.responses = responses if isinstance(responses, list) else []
        self.error = responses if isinstance(responses, Exception) else None
        self.calls: list[tuple] = []

    def system_one(self, state, questions, *, shadow: bool = False) -> dict:
        self.calls.append((state, dict(questions)))
        if self.error is not None:
            raise self.error
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def skim(scores: dict[str, float]) -> dict:
    return {"answers": {"candidates": scores}, "confidence": 1.0}


def noul(scores: dict[str, float]) -> dict:
    return {
        "answers": {k: {"probability": v} for k, v in scores.items()},
        "confidence": 1.0,
    }


# --- nothing selected -> '' and never an empty tag pair --------------------


def test_nothing_selected_returns_empty_string():
    jev = FakeJev(
        [
            skim({"pdf": 0.2, "xlsx": 0.1, "maps": 0.1}),
            noul({"pdf": 0.2}),
        ]
    )
    result = select_and_render("hello", CATALOG, jev=jev)
    assert result.selected == ()
    assert result.line == ""
    assert PROMPT_LINE_TAG not in result.line
    # an empty tag pair must never exist
    assert f"<{PROMPT_LINE_TAG}></{PROMPT_LINE_TAG}>" not in result.line


# --- the 0.30 gate ---------------------------------------------------------


def test_below_threshold_selects_nothing():
    jev = FakeJev(
        [
            skim({"pdf": 0.8, "maps": 0.5}),
            noul({"pdf": 0.72, "maps": 0.29}),  # maps below the 0.30 gate
        ]
    )
    result = select_and_render("merge a PDF", CATALOG, jev=jev)
    assert "maps" not in result.selected
    assert result.selected == ("pdf",)


def test_above_threshold_selects_skill():
    jev = FakeJev(
        [
            skim({"pdf": 0.9, "xlsx": 0.2}),
            noul({"pdf": 0.85}),
        ]
    )
    result = select_and_render("edit a spreadsheet export as pdf", CATALOG, jev=jev)
    assert result.selected == ("pdf",)
    assert result.line.startswith(f"<{PROMPT_LINE_TAG}>Relevant to the current request: pdf")
    assert result.line.endswith(f"</{PROMPT_LINE_TAG}>")


# --- request budget --------------------------------------------------------


def test_request_budget_never_exceeded():
    jev = FakeJev(
        [
            skim({"pdf": 0.9, "xlsx": 0.6, "maps": 0.5}),
            noul({"pdf": 0.9, "xlsx": 0.6, "maps": 0.5}),
        ]
    )
    result = select_and_render("anything", CATALOG, jev=jev)
    assert len(jev.calls) <= MAX_REQUESTS_PER_TURN
    assert result.requests_used <= MAX_REQUESTS_PER_TURN


def test_budget_aborts_empty_when_re_read_fails():
    # skim responds, then the re-read hits a budget-exhausted JevError:
    # selection must abort empty, never guess, and the turn must degrade.
    jev = FakeJev([skim({"pdf": 0.9}), JevError("request budget exhausted (max 2 per turn)")])
    result = select_and_render("anything", CATALOG, jev=jev)
    assert result.selected == ()
    assert result.line == ""
    assert result.degraded is True
    assert "budget" in result.reason.lower()
    assert len(jev.calls) <= MAX_REQUESTS_PER_TURN


# --- degrade: Jev unavailable ----------------------------------------------


def test_no_jev_client_degrades_with_reason():
    result = select_and_render("anything", CATALOG, jev=None)
    assert result.line == ""
    assert result.selected == ()
    assert result.degraded is True
    assert result.reason  # a stated reason, not silent
    assert "unavailable" in result.reason.lower()


def test_jev_error_degrades_without_raising():
    jev = FakeJev(JevError("503 from Jev"))
    result = select_and_render("anything", CATALOG, jev=jev)  # must not raise
    assert result.line == ""
    assert result.degraded is True
    assert result.reason
    assert "503" in result.reason


# --- the carrier: user-message ride, NEVER a system-prompt field ------------


def test_carrier_is_user_message_ride_and_has_no_system_prompt_field():
    jev = FakeJev([skim({"pdf": 0.9}), noul({"pdf": 0.85})])
    result = select_and_render("merge a PDF", CATALOG, jev=jev)
    carrier = inject(result, session_id="s1")
    assert carrier is not None
    keys = set(vars(carrier))
    assert keys == {"carrier", "content", "session_id"}
    assert "system" not in keys and "system_prompt" not in keys
    assert carrier.carrier == "user_message"
    assert carrier.carrier in jev_prompt.SUPPORTED_CARRIERS
    assert "system" not in carrier.carrier


def test_inject_returns_none_when_nothing_to_inject():
    jev = FakeJev([skim({"pdf": 0.05}), noul({"pdf": 0.05})])
    result = select_and_render("anything", CATALOG, jev=jev)
    assert inject(result) is None  # empty selection: no carrier at all
    degraded = select_and_render("anything", CATALOG, jev=None)
    assert inject(degraded) is None  # degraded: no carrier at all


def test_system_carrier_is_structurally_forbidden():
    with pytest.raises(ValueError):
        jev_prompt.InjectionCarrier(carrier="system_prompt", content="x", session_id="")
    with pytest.raises(ValueError):
        jev_prompt.InjectionCarrier(carrier="system", content="x", session_id="")


# --- rendered line shape ----------------------------------------------------


def test_line_is_single_line_with_tag_exactly_once():
    jev = FakeJev([skim({"pdf": 0.9, "xlsx": 0.5}), noul({"pdf": 0.8, "xlsx": 0.6})])
    result = select_and_render("pdf to xlsx", CATALOG, jev=jev)
    assert "\n" not in result.line
    assert result.line.count(PROMPT_LINE_TAG) == 2  # open + close only
    assert result.line.count(f"<{PROMPT_LINE_TAG}>") == 1


def test_selected_names_are_always_from_catalog():
    jev = FakeJev(
        [
            skim({"pdf": 0.9, "ghost_skill": 0.95}),
            noul({"pdf": 0.8}),
        ]
    )
    result = select_and_render("merge a PDF", CATALOG, jev=jev)
    assert set(result.selected) <= set(CATALOG)  # never an invented name
