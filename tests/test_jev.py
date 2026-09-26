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
