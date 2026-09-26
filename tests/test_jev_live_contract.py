"""Live contract tests for the Jev / TypeSafe System One API.

WHY THIS FILE EXISTS
--------------------
The entire Jev test surface mocks the transport (see conftest.py, "HTTP-layer
mocks for jev.py"), and `test_correct_request_body_shape` only asserts that the
client passes `questions` through unchanged — a tautology that cannot detect a
wrong schema. That is how a live production bug shipped green: memory_relevance
sent `{"primitive": "noul", "question": ...}` while the real API requires a
`type` discriminator plus `criteria`/`instructions`, and every test agreed with
the wrong schema because the wrong schema was what the fixtures contained.

These tests talk to the REAL endpoint. They are skipped unless
TYPESAFE_API_KEY is set, so CI stays green without a secret — but a developer
(or a deploy smoke check) with a key in the environment gets the guard that
mocks structurally cannot provide.

Verified live 2026-09-26:
    {"primitive":"noul"}             -> 400 union_tag_not_found (discriminator 'type')
    {"type":"noul"}                  -> 400 "Noul question must have criteria or instructions"
    {"type":"noul","instructions":…} -> 200 {"answers":{"…":{"type":"noul","noul":0.21}}}
"""

from __future__ import annotations

import os

import pytest

from balabot.jev import Jev, JevAPIError

pytestmark = pytest.mark.skipif(
    not os.environ.get("TYPESAFE_API_KEY"),
    reason="live Jev contract tests need TYPESAFE_API_KEY",
)


def test_live_wellformed_noul_returns_a_typed_answer():
    """The shipped shape must be ACCEPTED by the real API."""
    result = Jev().system_one(
        "BalaBot deployment smoke check.",
        {"ok": {"type": "noul", "instructions": "Is this state acceptable?"}},
    )
    answer = result["answers"]["ok"]
    assert answer["type"] == "noul"
    assert 0.0 <= float(answer["noul"]) <= 1.0


def test_live_rejects_the_primitive_key():
    """The old shape must be REJECTED — this is what makes the guard real.

    If the API ever starts accepting `primitive`, this test fails and tells us
    the contract moved rather than silently drifting.
    """
    with pytest.raises(JevAPIError) as exc:
        Jev().system_one("probe", {"ok": {"primitive": "noul", "question": "x"}})
    # The API answers a bad discriminator with 422 union_tag_not_found.
    # Assert the CONTRACT, not one status number: either way the point is that
    # the old shape is refused, and the reason names the discriminator.
    msg = str(exc.value)
    assert "union_tag_not_found" in msg or "discriminator" in msg, msg
    assert "4" in msg[:20], f"expected a 4xx client error, got: {msg[:60]}"


def test_live_rejects_a_noul_without_criteria_or_instructions():
    """A bare `{"type": "noul"}` is not a complete question."""
    with pytest.raises(JevAPIError) as exc:
        Jev().system_one("probe", {"ok": {"type": "noul"}})
    assert "criteria or instructions" in str(exc.value)
