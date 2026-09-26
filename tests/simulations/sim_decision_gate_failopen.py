"""Simulation: the governor's decision gate fails OPEN (recall-biased).

INVARIANT UNDER TEST: a MISSING decision silently breaks the ledger's core
promise ("if it is not in the ledger, it did not happen"); a bloated ledger is
merely recoverable. So the gate is tuned to OVER-ADMIT: everything borderline
is admitted, and contradictions are FLAGGED — both records kept, never
silently reconciled.

Run standalone:  python tests/simulations/sim_decision_gate_failopen.py
Run under pytest: pytest tests/simulations/sim_decision_gate_failopen.py
"""

from __future__ import annotations

from dataclasses import dataclass, field

from _sim_common import SimFailure, _Scenario, expect, finish, pytest_report, run_main

# The gate is tuned to over-admit: the threshold below which items are
# rejected is deliberately LOW. Anything at or above it is admitted —
# ambiguity resolves toward ADMIT, never toward silently dropping.
ADMIT_THRESHOLD = 0.30  # recall-biased: low on purpose


class FakeJev:
    """Deterministic fake of the Jev System One client.

    Scores are supplied per candidate ref by the scenario, so the gate's
    BEHAVIOUR is exercised, not a model's opinion.
    """

    def __init__(self, scores: dict[str, float], calls: list | None = None) -> None:
        self.scores = scores
        self.calls = calls if calls is not None else []

    def system_one(self, state, questions, **kw):
        self.calls.append(len(questions))
        answers = {}
        for ref in questions:
            answers[ref] = {"type": "noul", "noul": self.scores.get(ref, 0.0)}
        return {"answers": answers}


@dataclass
class Ledger:
    """The governor's OKF decision ledger with the fail-open gate."""

    admitted: list = field(default_factory=list)
    contradictions: list = field(default_factory=list)

    def admit_batch(self, client: FakeJev, items: list[dict]) -> int:
        """Gate a batch: ONE Jev call, one Noul per item, admit when the
        probability clears the (low, recall-biased) threshold. Returns the
        number admitted. NEVER raises for low scores — a miss here is the
        one failure this architecture refuses to make."""
        questions = {
            item["ref"]: {"primitive": "noul",
                          "question": "Is this decision-worthy? " + item["text"]}
            for item in items
        }
        response = client.system_one("decision-batch state", questions)
        answers = response.get("answers", {})
        admitted = 0
        for item in items:
            answer = answers.get(item["ref"], {})
            prob = float(answer.get("noul", 0.0))
            if prob >= ADMIT_THRESHOLD:
                self.admitted.append(item)
                admitted += 1
        return admitted

    def record(self, item: dict) -> None:
        """Record a decision, FLAGGING contradictions instead of reconciling."""
        for existing in self.admitted:
            if self._contradicts(existing, item):
                self.contradictions.append((existing, item))
        self.admitted.append(item)

    @staticmethod
    def _contradicts(a: dict, b: dict) -> bool:
        return a.get("subject") == b.get("subject") and \
            a.get("predicate") == b.get("predicate") and \
            a.get("value") != b.get("value")


def check_borderline_items_admitted() -> None:
    """A batch of ambiguous/borderline items: the gate admits them all."""
    items = [
        {"ref": f"b{i}", "text": t} for i, t in enumerate([
            "user half-joked about renaming the deploy pipeline",
            "mentioned maybe switching language, not clearly a decision",
            "shrugged when asked if the API version should pin",
            "offhand comment about dropping Telegram support",
        ])
    ]
    # Deliberately murky probabilities hovering at/below a strict gate.
    scores = {f"b{i}": p for i, p in enumerate([0.31, 0.33, 0.30, 0.55])}
    ledger = Ledger()
    admitted = ledger.admit_batch(FakeJev(scores), items)
    expect(admitted == len(items),
           f"FAIL-OPEN violation: gate admitted {admitted}/{len(items)} borderline "
           f"items — a missing decision silently breaks the ledger's core promise; "
           f"the gate must over-admit (threshold {ADMIT_THRESHOLD})")


def check_ambiguity_resolves_toward_admit() -> None:
    """When in doubt, ADMIT: bloat is recoverable, a missing decision is not."""
    ledger = Ledger()
    ambiguous = [{"ref": "x", "text": "was that a decision or small talk?"}]
    # Exactly at the threshold counts as admitted — no tie goes to denial.
    admitted = ledger.admit_batch(FakeJev({"x": ADMIT_THRESHOLD}), ambiguous := ambiguous_batch())
    expect(admitted == len(ambiguous), "an item exactly at the threshold must be ADMITTED")


def ambiguous_batch():
    return [{"ref": "x", "text": "was that a decision or small talk?"}]


def check_one_jev_call_per_batch() -> None:
    """The gate is cheap: one call for the whole batch (stacked questions)."""
    items = [{"ref": f"c{i}", "text": f"item {i}"} for i in range(25)]
    calls: list = []
    ledger = Ledger()
    ledger.admit_batch(FakeJev({f"c{i}": 0.9 for i in range(25)}, calls), items)
    expect(len(calls) == 1, f"the gate must ask all candidates in ONE Jev call "
                            f"(parallel questions), made {len(calls)} calls")


def check_contradictions_flagged_not_reconciled() -> None:
    ledger = Ledger()
    first = {"ref": "d1", "subject": "api", "predicate": "version_pin",
             "value": "jev-1.13.0", "text": "pin the API version"}
    second = {"ref": "d2", "subject": "api", "predicate": "version_pin",
              "value": "jev-latest", "text": "float the API version"}
    ledger.record(first)
    ledger.record(second)
    expect(len(ledger.contradictions) == 1,
           f"contradictions must be FLAGGED — found {len(ledger.contradictions)} flags "
           f"for a known contradiction")
    # BOTH records kept: never silently reconciled into one "truth".
    values = {rec["value"] for rec in ledger.admitted}
    expect(values == {"jev-1.13.0", "jev-latest"},
           f"both conflicting records must survive the ledger — admitted values are "
           f"{values!r}; silent reconciliation destroys the evidence base")


def check_unflagged_contradiction_is_detectable() -> None:
    """Prove the flag mechanism is real: a contradiction the gate missed
    would show up as a zero-length contradiction list on identical inputs."""
    ledger = Ledger()
    same = {"ref": "e1", "subject": "x", "predicate": "p", "value": "v", "text": "t"}
    ledger.record(same)
    ledger.record(dict(same, ref="e2"))
    expect(len(ledger.contradictions) == 0,
           "identical records are NOT a contradiction — only differing values flag")


def run(scenario_name: str = "sim_decision_gate_failopen") -> _Scenario:
    s = _Scenario(scenario_name)
    s.check("borderline batch: the gate admits EVERYTHING ambiguous (over-admit)",
            check_borderline_items_admitted)
    s.check("ambiguity resolves toward ADMIT — ties go to the ledger, never to denial",
            check_ambiguity_resolves_toward_admit)
    s.check("the gate scores the whole batch in ONE Jev call", check_one_jev_call_per_batch)
    s.check("contradictions are FLAGGED and BOTH records kept — never silently reconciled",
            check_contradictions_flagged_not_reconciled)
    s.check("identical records are not false-flagged as contradictions",
            check_unflagged_contradiction_is_detectable)
    return s


def test_scenario():
    pytest_report(run())


if __name__ == "__main__":
    run_main(run())
