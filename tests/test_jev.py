"""Jev client contracts: hard dependency, retry policy, request shape, parsing."""

from __future__ import annotations

import pytest

from balabot.jev import (
    DEFAULT_MODEL,
    Jev,
    JevAPIError,
    JevNotConfigured,
    SYSTEM_ONE_URL,
)

NOUL_RESPONSE = {
    "model": "jev-1.13.0",
    "answers": {"x": {"type": "noul", "noul": 0.99}},
    "usage": {"input_tokens": 10, "output_tokens": 2},
}
CHOICE_RESPONSE = {
    "answers": {
        "x": {
            "type": "choice",
            "choice": "returns",
            "confidence": 1.0,
            "probabilities": {"a": 0.0, "returns": 1.0},
        }
    }
}
SCORE_RESPONSE = {
    "answers": {
        "x": {
            "type": "score",
            "score": 1.43,
            "confidence": 0.35,
            "legend": {"0": "a", "1": "b"},
            "probabilities": {"0": 0.57, "1": 0.43},
        }
    }
}

QUESTIONS = {"x": {"type": "noul", "instructions": "Is this state acceptable?"}}


@pytest.fixture(autouse=True)
def _no_env_key(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)


def _client():
    return Jev(api_key="test-key")


# ---- hard dependency: no key, no fallback ----

def test_missing_key_raises_not_configured():
    with pytest.raises(JevNotConfigured):
        Jev()


def test_missing_key_raises_even_via_env(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "")
    with pytest.raises(JevNotConfigured):
        Jev()


def test_no_fallback_raises_rather_than_returning_default(http_responses):
    """Contract: with no key the code path RAISES; it cannot return a default."""
    queue, recorded = http_responses  # nothing queued — no HTTP call should happen
    with pytest.raises(JevNotConfigured):
        Jev().system_one("state", QUESTIONS)
    # And no HTTP request was ever attempted (a fallback would have called out).
    assert recorded["bodies"] == []


# ---- HTTP layer via real client code ----

def test_correct_request_body_shape(http_responses):
    queue, recorded = http_responses
    queue(200, NOUL_RESPONSE)
    client = Jev(api_key="test-key", timeout_s=1.0)
    client.system_one("the state string", QUESTIONS)
    body = recorded["bodies"][0]
    assert recorded["bodies"][0] == {
        "model": DEFAULT_MODEL,
        "state": "the state string",
        "questions": QUESTIONS,
    }
    assert recorded["headers"][0]["Authorization"] == "Bearer test-key"


def test_endpoint_and_model(http_responses):
    queue, recorded = http_responses
    queue(200, NOUL_RESPONSE)
    _client().system_one("s", QUESTIONS)
    # Model id is the published jev-1.13.0 (contract, not snapshot: it is the
    # default the client sends when not overridden).
    assert recorded["bodies"][0]["model"] == "jev-1.13.0"


def test_400_raises_and_is_not_retried(http_responses):
    queue, recorded = http_responses
    queue(400, {"error": "bad request"})
    with pytest.raises(JevAPIError, match="400"):
        _client().system_one("s", QUESTIONS)
    # Exactly ONE HTTP call: 4xx must never be retried.
    assert len(recorded["bodies"]) == 1


def test_429_retries_then_succeeds(http_responses, monkeypatch):
    monkeypatch.setattr("balabot.jev.time.sleep", lambda s: None)
    queue, recorded = http_responses
    queue(429, {"error": "slow down"})
    queue(429, {"error": "slow down"})
    queue(200, NOUL_RESPONSE)
    result = _client().system_one("s", QUESTIONS)
    assert result["answers"]["x"]["noul"] == 0.99
    # Transient statuses DO retry: 3 HTTP calls for 2×429 + success.
    assert len(recorded["bodies"]) == 3


def test_5xx_retries_then_fails_loud(http_responses, monkeypatch):
    monkeypatch.setattr("balabot.jev.time.sleep", lambda s: None)
    queue, _ = http_responses
    for _ in range(3):
        queue(503, {"error": "down"})
    with pytest.raises(JevAPIError):
        _client().system_one("s", QUESTIONS)


def test_network_error_is_transient_and_retried(http_responses, monkeypatch):
    monkeypatch.setattr("balabot.jev.time.sleep", lambda s: None)
    import requests

    calls = {"n": 0}

    def flaky_post(url, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise requests.ConnectionError("boom")
        return make_ok()

    monkeypatch.setattr("requests.Session.post", flaky_post)
    result = _client().system_one("s", QUESTIONS)
    assert result["model"] == "jev-1.13.0"


def make_ok():
    class Resp:
        status_code = 200
        text = "{}"

        def json(self):
            return NOUL_RESPONSE

    return Resp()


def test_shadow_flag_annotates_response(http_responses):
    queue, _ = http_responses
    queue(200, NOUL_RESPONSE)
    result = _client().system_one("s", QUESTIONS, shadow=True)
    assert result["shadow"] is True
    # Non-shadow leaves the response untouched.
    queue(200, NOUL_RESPONSE)
    result_plain = _client().system_one("s", QUESTIONS)
    assert "shadow" not in result_plain


def test_noul_response_shape_parses(http_responses):
    queue, _ = http_responses
    queue(200, NOUL_RESPONSE)
    result = _client().system_one("s", QUESTIONS)
    ans = result["answers"]["x"]
    assert ans["type"] == "noul"
    assert ans["noul"] == 0.99
    assert result["usage"]["input_tokens"] == 10


def test_choice_response_shape_parses(http_responses):
    queue, _ = http_responses
    queue(200, CHOICE_RESPONSE)
    result = _client().system_one("s", QUESTIONS)
    ans = result["answers"]["x"]
    assert ans["type"] == "choice"
    assert ans["choice"] == "returns"
    assert ans["confidence"] == 1.0


def test_score_response_shape_parses(http_responses):
    queue, _ = http_responses
    queue(200, SCORE_RESPONSE)
    result = _client().system_one("s", QUESTIONS)
    ans = result["answers"]["x"]
    assert ans["type"] == "score"
    assert ans["score"] == 1.43
    assert ans["legend"]["0"] == "a"


def test_empty_questions_rejected(http_responses):
    queue, recorded = http_responses
    with pytest.raises(ValueError):
        _client().system_one("s", {})
    assert recorded["bodies"] == []  # nothing sent


# ---------------------------------------------------------------------------
# noul_probability — the ONE accessor for a Noul answer's probability.
#
# Regression cover for a systemic bug: the live wire shape puts the probability
# under "noul" ({"type": "noul", "noul": 0.73}), but the whole depth layer read
# ".get('probability', 0.0)" — which yields 0.0 against the real API, i.e.
# indistinguishable from a confident "no". The decision gate then rejected every
# decision, skill selection selected nothing, frustration never confirmed, and
# the pre-compaction saliency pass dropped everything.
# ---------------------------------------------------------------------------


def test_noul_probability_reads_the_live_wire_shape():
    from balabot.jev import noul_probability

    # Verbatim shape returned by api.typesafe.ai for a noul question.
    live = {"type": "noul", "noul": 0.73}
    assert noul_probability(live) == 0.73


def test_noul_probability_tolerates_the_legacy_probability_key():
    from balabot.jev import noul_probability

    assert noul_probability({"probability": 0.4}) == 0.4
    # "noul" wins when both are present — it is the documented key.
    assert noul_probability({"noul": 0.9, "probability": 0.1}) == 0.9


def test_noul_probability_raises_rather_than_reading_a_confident_zero():
    """A malformed body must not be mistaken for evidence of "no"."""
    from balabot.jev import JevResponseError, noul_probability

    for bad in ({}, {"type": "noul"}, {"noul": None}, {"noul": "0.9"}, None, 0.5):
        with pytest.raises(JevResponseError):
            noul_probability(bad)


def test_noul_probability_rejects_booleans():
    """bool is an int in Python — True must not silently read as 1.0."""
    from balabot.jev import JevResponseError, noul_probability

    with pytest.raises(JevResponseError):
        noul_probability({"noul": True})


# ---------------------------------------------------------------------------
# P1-5: Heuristic fallback mode (JEV_MODE=heuristic) for offline/local use
# ---------------------------------------------------------------------------

def test_jev_heuristic_mode_initializes_without_api_key(monkeypatch):
    """When JEV_MODE=heuristic, Jev client initializes without TYPESAFE_API_KEY."""
    monkeypatch.setenv("JEV_MODE", "heuristic")
    client = Jev()
    assert client.mode == "heuristic"
    assert client.api_key is None


def test_jev_heuristic_system_one_evaluates_noul_and_choice(monkeypatch):
    """Heuristic mode provides rule-based and FTS5 rank ordering responses."""
    monkeypatch.setenv("JEV_MODE", "heuristic")
    client = Jev()
    
    # 1. Noul decision-worthy question
    resp_noul = client.system_one(
        "we will approve and deploy the change to production",
        {"decision_worthy": {"type": "noul", "instructions": "Is this a decision?"}},
    )
    ans_noul = resp_noul["answers"]["decision_worthy"]
    assert ans_noul["type"] == "noul"
    assert ans_noul["noul"] >= 0.5

    # 2. Choice with FTS5 BM25 rank ordering
    criteria = {
        "pptx-read": "read and extract text from PowerPoint presentations",
        "xlsx": "create and edit Excel spreadsheets",
    }
    resp_choice = client.system_one(
        "read powerpoint slides and deck",
        {"candidates": {"type": "choice", "criteria": criteria}},
    )
    candidates = resp_choice["answers"]["candidates"]
    assert candidates["pptx-read"] > candidates["xlsx"]


def test_jev_heuristic_health_check(monkeypatch):
    """check_jev_health returns ok when JEV_MODE=heuristic without API key."""
    from balabot.jev import check_jev_health
    monkeypatch.setenv("JEV_MODE", "heuristic")
    health = check_jev_health()
    assert health.status == "ok"
    assert health.ok
    assert "heuristic" in health.detail.lower()


def test_jev_heuristic_depth_integration(monkeypatch):
    """Real Jev client in heuristic mode drives jev_depth decision gate and skill selection."""
    from balabot.jev_depth import is_decision_worthy, select_skills

    monkeypatch.setenv("JEV_MODE", "heuristic")
    client = Jev()

    # Decision gate
    decision = is_decision_worthy("we will deploy the new release", jev=client)
    assert decision.worthy is True

    # Skill selection with SQLite FTS5 rank ordering
    catalog = {
        "pptx-read": "Read and extract text from PowerPoint presentations.",
        "xlsx": "Create, read, and edit Excel workbooks.",
    }
    selected = select_skills("extract text from PowerPoint presentation deck", catalog, jev=client)
    assert selected == ["pptx-read"]


def test_entrypoint_boot_gate_allows_heuristic_mode():
    """entrypoint.sh accepts JEV_MODE=heuristic when TYPESAFE_API_KEY is unset."""
    import os
    import shutil
    import subprocess
    from pathlib import Path

    bash_bin = shutil.which("bash") or "bash"
    repo_root = Path(__file__).resolve().parent.parent
    entrypoint = repo_root / "entrypoint.sh"
    assert entrypoint.exists()

    # Read the first 27 lines (the Jev boot gate)
    content = entrypoint.read_text(encoding="utf-8")
    lines = content.splitlines()[:27]
    script = "\n".join(lines)

    # 1. Without JEV_MODE or key, exits 1
    env_empty = dict(os.environ)
    env_empty.pop("TYPESAFE_API_KEY", None)
    env_empty.pop("JEV_MODE", None)
    res_empty = subprocess.run(
        [bash_bin, "-c", script],
        capture_output=True,
        text=True,
        env=env_empty,
    )
    assert res_empty.returncode == 1
    assert "FATAL: TYPESAFE_API_KEY is not set" in res_empty.stderr

    # 2. With JEV_MODE=heuristic, passes gate (exit 0)
    env_heuristic = dict(os.environ, JEV_MODE="heuristic")
    env_heuristic.pop("TYPESAFE_API_KEY", None)
    res_heuristic = subprocess.run(
        [bash_bin, "-c", script],
        capture_output=True,
        text=True,
        env=env_heuristic,
    )
    assert res_heuristic.returncode == 0
    assert "JEV_MODE=heuristic" in res_heuristic.stdout


