"""Tests for balabot/growth.py — the frustration pipeline.

No network: the Jev dependency is always injected as a fake callable.
BALABOT_DATA_ROOT is monkeypatched to a tmp dir (shared conftest fixture).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from balabot import growth
from balabot.bootstrap import init_ledger


# ---------------------------------------------------------------------------
# Layer 1 — the dictionary sensor
# ---------------------------------------------------------------------------

def test_anyways_filler_does_not_trigger_a_signal() -> None:
    """The architecture doc's caution: 'Anyways' is filler, not frustration."""
    text = "Anyways, thanks for the help, that's exactly what I needed."
    assert growth.scan(text) == []


def test_genuine_frustration_phrase_does_trigger_a_signal() -> None:
    text = "Ugh, this is broken again?! I am so done."
    signals = growth.scan(text)
    markers = {s.marker for s in signals}
    assert {"this is broken", "again?!"} & markers, markers


def test_english_and_arabic_markers_both_fire() -> None:
    en = growth.scan("this is broken")[0]
    ar = growth.scan("هذا غلط تماما")[0]
    assert en.severity == "high"
    assert ar.marker == "هذا غلط"


def test_scan_is_pure_and_cheap() -> None:
    """No network, no model: scan must not construct anything remote."""
    assert growth.scan("") == []
    signals = growth.scan("not working at all")
    assert signals and signals[0].marker == "not working"


def test_negated_marker_is_not_a_signal() -> None:
    assert growth.scan("this is not useless, it works fine") == []


def test_dictionary_is_data_not_inline() -> None:
    assert isinstance(growth.FRUSTRATION_MARKERS, tuple)
    assert isinstance(growth.FILLER_MARKERS, tuple)
    assert "anyways" in growth.FILLER_MARKERS
    # multi-lingual: at least one Arabic marker present
    assert any("\u0600" <= m[0][0] <= "\u06FF" for m in growth.FRUSTRATION_MARKERS)


def test_context_window_sends_window_not_transcript() -> None:
    text = "x" * 200 + "this is broken" + "y" * 500
    window = growth.context_window(text, (200, 214), pad=10)
    assert "this is broken" in window
    assert len(window) < len(text)


# ---------------------------------------------------------------------------
# Layer 2 — escalation with an INJECTED Jev client
# ---------------------------------------------------------------------------

class FakeJev:
    """Injected stand-in for balabot.jev.Jev().system_one. Never touches network."""

    def __init__(self, *, confirmed: bool = True, probability: float = 0.9) -> None:
        self.calls: list[dict] = []
        self.confirmed = confirmed
        self.probability = probability

    def __call__(self, state, questions, *, shadow: bool = False) -> dict:
        self.calls.append({"state": state, "questions": questions, "shadow": shadow})
        return {"answers": {"is_frustration": {"value": self.confirmed,
                                               "probability": self.probability}}}


def test_classify_uses_injected_jev_and_confirms() -> None:
    signals = growth.scan("this is broken, seriously?")
    jev = FakeJev(confirmed=True, probability=0.93)
    result = growth.classify(signals, "this is broken, seriously?", jev)
    assert result["confirmed"] is True
    assert len(jev.calls) == 1
    # send the window, not the transcript
    assert "this is broken" in jev.calls[0]["state"]


def test_classify_low_probability_is_not_confirmed() -> None:
    signals = growth.scan("again?!")
    jev = FakeJev(confirmed=False, probability=0.2)
    result = growth.classify(signals, "again?!", jev)
    assert result["confirmed"] is False
    assert result["escalate"] is True


def test_classify_without_jev_defers_never_confirms() -> None:
    signals = growth.scan("this is broken")
    result = growth.classify(signals, "this is broken", None)
    assert result["confirmed"] is False


def test_classify_no_signals_makes_no_jev_call() -> None:
    jev = FakeJev()
    result = growth.classify([], "perfectly calm message", jev)
    assert result["escalate"] is False
    assert jev.calls == []


# ---------------------------------------------------------------------------
# Layer 3 — the governor ledger (BALABOT_DATA_ROOT is tmp via conftest)
# ---------------------------------------------------------------------------

def test_record_and_read_frustration_entry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    entry = growth.record_frustration({
        "signals": [{"marker": "this is broken", "span": [0, 14], "severity": "high"}],
        "confirmed": True,
        "message_count": 3,
    })
    read_back = growth.read_frustration_entries()
    assert read_back == [entry]
    assert read_back[0]["type"] == "frustration-signal"


def test_ledger_write_failure_raises_growtherror(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    target = growth._ledger_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("", encoding="utf-8")
    target.chmod(0o444)  # read-only -> appends must fail
    try:
        with pytest.raises(growth.GrowthError):
            growth.record_frustration({"confirmed": True})
    finally:
        target.chmod(0o644)


def test_read_empty_ledger_is_honest_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    assert growth.read_frustration_entries() == []


# ---------------------------------------------------------------------------
# Layer 4 — the principal growth job (idempotent, never auto-applies)
# ---------------------------------------------------------------------------

def _seed_ledger(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, entries: list[dict]) -> None:
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    init_ledger("governor")
    for e in entries:
        growth.record_frustration(e)


def test_growth_job_empty_ledger_proposes_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_ledger(monkeypatch, tmp_path, [])
    record = growth.growth_job()
    assert record["proposal"] is None
    assert record["entries_considered"] == 0


def test_growth_job_proposes_skill_patch_for_missing_skill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    entry = {"signals": [{"marker": "not working", "span": [0, 12], "severity": "high"}],
             "confirmed": True, "message_count": 10}
    _seed_ledger(monkeypatch, tmp_path, [entry, entry])
    record = growth.growth_job()
    assert record["cause"] == "missing_skill"
    assert record["proposal"]["action"] == "propose_skill_patch"
    assert record["applied"] is False  # never auto-applied


def test_growth_job_proposes_routing_change_for_bad_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    entry = {"signals": [{"marker": "are you kidding me", "span": [0, 17], "severity": "high"}],
             "confirmed": True, "message_count": 5}
    _seed_ledger(monkeypatch, tmp_path, [entry])
    record = growth.growth_job()
    assert record["cause"] == "bad_output"
    assert record["proposal"]["action"] == "propose_routing_change"


def test_growth_job_is_idempotent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    entry = {"signals": [{"marker": "not working", "span": [0, 12], "severity": "high"}],
             "confirmed": True, "message_count": 4}
    _seed_ledger(monkeypatch, tmp_path, [entry])
    first = growth.growth_job()
    second = growth.growth_job()
    assert first == second
    # and it did not add anything to the ledger
    assert len(growth.read_frustration_entries()) == 1


# ---------------------------------------------------------------------------
# Metric — frustration rate with a stated denominator
# ---------------------------------------------------------------------------

def test_frustration_rate_denominator_is_message_count() -> None:
    entries = [
        {"confirmed": True, "message_count": 10,
         "signals": [{"marker": "not working", "severity": "high"}]},
        {"confirmed": False, "message_count": 90, "signals": []},
    ]
    # 1 confirmed signal per 100 messages == 10.0 per 1000
    assert growth.frustration_rate(entries) == 10.0


def test_frustration_rate_zero_messages_is_zero_not_crash() -> None:
    assert growth.frustration_rate([]) == 0.0


def test_frustration_rate_default_denominator_is_one_per_entry() -> None:
    entries = [{"confirmed": True, "signals": [{"marker": "useless", "severity": "high"}]}]
    assert growth.frustration_rate(entries) == 1000.0
