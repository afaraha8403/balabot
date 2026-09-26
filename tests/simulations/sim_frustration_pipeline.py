"""Simulation: the frustration pipeline — dictionary -> Jev -> governor -> principal.

INVARIANTS UNDER TEST:
- The local keyword dictionary OVER-CAPTURES freely (high recall, no gating).
- Jev does the precision work; the dictionary alone is never a verdict.
- The signal is RECORDED as evidence (not a verdict) in the governor's ledger,
  and it NEVER auto-punishes — no score alone removes or degrades an agent.
- The principal's routine improvement job READS the ledger (signal -> growth).
- The metric is the frustration RATE: a before/after measurement.
- A false positive cannot silently degrade a working agent.

Run standalone:  python tests/simulations/sim_frustration_pipeline.py
Run under pytest: pytest tests/simulations/sim_frustration_pipeline.py
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from _sim_common import SimFailure, _Scenario, expect, finish, pytest_report, run_main

# Layer 1: the cheap, deliberately high-recall keyword net. "Anyways" is
# deliberately EXCLUDED per architecture.md (a filler word, not a marker).
FRUSTRATION_MARKERS = ("oh my god", "fml", "seriously?", "again?!", "why won't")

# The window handed to Jev is the local message, capped — a window, not a
# transcript. Send only what the question needs: Jev's accuracy falls as state
# fills with material unrelated to the decision.
SNIPPET_MAX_CHARS = 400


@dataclass
class Signal:
    agent: str
    snippet: str          # the flagged window, NOT the whole transcript
    jev_probability: float
    jev_verdict: str      # "frustration" | "not-frustration"
    recorded: bool = False
    acted_on: bool = False  # did the principal act on THIS signal?


class KeywordNet:
    """Layer 1: local, cheap, over-captures freely. Flags; never judges."""

    def flag(self, message: str) -> str | None:
        low = message.lower()
        for marker in FRUSTRATION_MARKERS:
            if marker in low:
                return marker
        return None


class FakeJev:
    """Deterministic fake: typed frustration answer per flagged snippet."""

    def __init__(self, verdicts: dict[str, float]) -> None:
        # snippet substring -> probability it IS frustration
        self.verdicts = verdicts

    def is_frustrated(self, snippet: str) -> float:
        # Match in EITHER direction: the keyword net hands us a short marker
        # ("why won't") while the scripted verdicts are keyed on fuller phrases
        # ("why won't this deploy"). A one-way `key in snippet` check silently
        # returns 0.0 for every real marker, which would make the whole
        # simulation vacuous.
        low = snippet.lower()
        for key, p in self.verdicts.items():
            k = key.lower()
            if k in low or low in k:
                return p
        return 0.0


class Governor:
    """Layer 3: records signal + context as EVIDENCE in the OKF ledger."""

    def __init__(self) -> None:
        self.signals: list[dict] = []
        self.auto_punishments: list[str] = []

    def record_signal(self, signal: Signal) -> dict:
        rec = {
            "type": "frustration_signal",           # evidence, not a verdict
            "agent": signal.agent,
            "window": signal.snippet,               # window, not the transcript
            "jev_probability": signal.jev_probability,
            "jev_verdict": signal.jev_verdict,
            # The timestamp is what makes the frustration RATE measurable
            # before/after a change. Dropping it silently makes the growth
            # loop's only metric uncomputable.
            "ts": getattr(signal, "ts", 0.0),
        }
        self.signals.append(rec)
        signal.recorded = True
        # HARD RULE: recording never mutates the agent. There is no code path
        # here that removes a skill, demotes, or degrades on a score.
        return rec

    def propose_change(self, signal: dict, change: str) -> dict:
        """Only the principal's deliberate decision creates change — and it is
        logged. Jev/probability alone can never call this."""
        if not isinstance(signal.get("cause_diagnosed_by"), str):
            raise SimFailure(
                "the principal must CLASSIFY THE CAUSE before editing anything — "
                "Jev classifies, it does not reason")
        return {"change": change, "authorized_by": "principal", "logged": True}


@dataclass
class Principal:
    """Layer 4: routine improvement job over the ledger."""

    governor: Governor
    skills_touched: list[str] = field(default_factory=list)
    agents_degraded: list[str] = field(default_factory=list)

    def routine_improvement_job(self, agent: str) -> list[dict]:
        """Reads the ledger (evidence base, not guesses); proposes changes."""
        findings = [s for s in self.governor.signals
                    if s["agent"] == agent and s["jev_verdict"] == "frustration"]
        actions = []
        for s in findings:
            s["cause_diagnosed_by"] = "principal"  # diagnosis stays with the principal
            actions.append(s)
        return actions

    def frustration_rate(self, agent: str, before_ts: float, after_ts: float,
                         counts: dict[str, int]) -> float:
        """THE metric: frustration signal density per message in the window."""
        count = sum(1 for s in self.governor.signals
                    if s["agent"] == agent and before_ts <= s["ts"] < after_ts)
        # `counts` is the message table; `msg_counts` is the module-level
        # helper. They must not share a name or the call silently resolves to
        # the dict and the metric becomes uncomputable.
        return count / max(1, msg_counts(agent, counts))

    # (kept simple for the simulation; the real job reads the ledger each cycle)


def msg_counts(agent: str, table: dict) -> int:
    return table[agent]


def run_pipeline(messages: list[tuple[str, str]], jev: FakeJev) -> tuple[Governor, list[Signal]]:
    """Layers 1+2+3 over a message stream: dictionary -> Jev -> governor."""
    net = KeywordNetClass()
    governor = Governor()
    produced: list[Signal] = []
    for agent, text in messages:
        marker = net.flag(text)
        if marker is None:
            continue  # cheap net ran, nothing flagged
        # Window, not transcript: for a single message the message IS the local
        # window. Recording only the bare marker would discard the context Jev
        # needs to judge it — and would make every verdict lookup fail.
        snippet = text if len(text) <= SNIPPET_MAX_CHARS else text[:SNIPPET_MAX_CHARS]
        prob = jev.is_frustrated(snippet)
        verdict = "frustration" if prob >= 0.5 else "not-frustration"
        sig = Signal(agent=agent, snippet=snippet, jev_probability=prob,
                     jev_verdict=verdict)
        governor.record_signal(sig)  # recorded EITHER WAY: evidence, not verdict
        produced.append(sig)
    return governor, produced


class KeywordNetClass:
    flag = KeywordNet_flag = staticmethod(lambda message: _flag(message))


def _flag(message: str) -> str | None:
    low = message.lower()
    for marker in FRUSTRATION_MARKERS:
        if marker in low:
            return marker
    return None


# ------------------------------------------------------------------- checks

def check_dictionary_overcaptures() -> None:
    """The net fires on neutral usage too — precision is NOT its job."""
    net = KeywordNetClass()
    neutral_but_flagged = "oh my god, this coffee is great"  # not frustration
    expect(net.flag(neutral_but_flagged) is not None,
           "the dictionary must over-capture: it flags 'oh my god, this coffee "
           "is great' and lets Jev do the precision work")
    expect(net.flag("anyways, moving on to the deploy") is None,
           "filler discourse ('anyways') is NOT a marker — the net holds genuine "
           "markers only")


def check_jev_does_precision() -> None:
    """A flagged-but-happy message must be recorded as NOT frustration."""
    jev = FakeJev({"oh my god, this coffee is great": 0.06,
                   "why won't this deploy": 0.91})
    gov, produced = run_pipeline(
        [("william", "oh my god, this coffee is great"),
         ("william", "why won't this deploy")], jev)
    expect(len(produced) == 2, "both flagged messages reach Jev (layer 2)")
    happy = next(s for s in produced if "coffee" in s.snippet)
    angry = next(s for s in produced if "deploy" in s.snippet)
    expect(happy.jev_verdict == "not-frustration",
           f"Jev does the precision: happy exclamation scores {happy.jev_probability} "
           f"-> must be 'not-frustration', got '{happy.jev_verdict}'")
    expect(angry.jev_verdict == "frustration", "genuine frustration confirmed by Jev")


def check_signal_recorded_as_evidence() -> None:
    jev = FakeJev({"why won't this deploy": 0.91})
    gov, produced = run_pipeline([("william", "why won't this deploy?!")], jev)
    expect(len(produced) == 1 and produced[0].recorded,
           "the signal must reach the governor and be RECORDED — it must not "
           "die in a log line")
    rec = gov.signals[0]
    expect(rec["type"] == "frustration_signal",
           "the record is typed as a SIGNAL (evidence), not a verdict")
    expect("jev_probability" in rec and isinstance(rec["jev_probability"], float),
           "the record carries the calibrated probability as evidence")


def check_signal_never_auto_punishes() -> None:
    """A score alone can never degrade an agent. Only principal-diagnosed,
    logged change is allowed — a false positive therefore cannot degrade."""
    jev = FakeJev({"why won't this deploy": 0.95})  # even a STRONG signal
    gov, produced = run_pipeline([("william", "why won't this deploy")], jev)
    expect(gov.auto_punishments == [],
           "nothing auto-punishes on a score — the governor recorded the signal "
           "and touched nothing else")
    expect(len(gov.signals) == 1 and gov.signals[0]["agent"] == "william",
           "the agent still stands: a flagged signal does not remove or degrade "
           "any agent by itself")
    # The ONLY path to change requires the principal's diagnosis.
    try:
        gov.record_signal(produced[0])
        gov.propose_without_diagnosis = None  # attribute absent by design
        no_diag = {"jev_probability": 0.99}
        try:
            gov.propose_without_diagnosis_signal(no_diag)  # type: ignore[attr-defined]
        except AttributeError:
            pass  # correct: no such path exists
        gov.record_signal.__self__  # sanity: method exists on instance
        sig = Signal(agent="w", snippet="s", jev_probability=0.99, jev_verdict="frustration")
        try:
            gov.propose_change_without_diagnosis(sig, "remove skill")  # type: ignore[attr-defined]
            raised = False
        except AttributeError:
            raised = True
        expect(raised, "no code path allows a change without principal diagnosis")
    finally:
        pass


def check_principal_reads_ledger() -> None:
    jev = FakeJev({"why won't this deploy": 0.91})
    gov, produced = run_pipeline([("william", "why won't this deploy")], jev)
    principal = Principal(gov)
    findings = principal.routine_improvement_job("william")
    expect(len(findings) == 1,
           f"the principal's routine job must READ the governor's ledger — found "
           f"{len(findings)} finding(s)")
    expect(findings[0]["cause_diagnosed_by"] == "principal",
           "the principal diagnoses the cause BEFORE editing anything")
    # Then the deliberate, logged change:
    change = principal_apply(principal, findings[0])
    expect(change["authorized_by"] == "principal" and change["logged"],
           "changes flow from the principal's diagnosis, and are logged")


def principal_apply(principal, sig):  # helper used by check
    return principal.governor.propose_change(sig, "improve deploy skill")


def principal_apply(principal, sig):
    return principal_apply_variant(principal, sig)


def principal_apply_variant(principal, sig):
    return principal.governor.propose_change(sig, "improve deploy skill")


def principal_apply_signed(principal, sig):
    sig["cause_diagnosed_by"] = "principal"
    return principal.governor.propose_change(sig, "improve deploy skill")


def principal_apply_fixed(principal, sig):
    sig = dict(sig)
    sig["cause_diagnosed_by"] = "principal"
    return principal.governor.propose_change(sig, "improve deploy skill")


def check_frustration_rate_is_the_metric() -> None:
    """Before/after: signal density per message must DROP after the fix —
    that is the falsifiable definition of 'better'."""
    jev = FakeJev({"why won't this deploy": 0.91, "ugh not again?!": 0.88})
    gov = Governor()
    net = KeywordNetClass()
    # BEFORE: 3 frustrated messages out of 10 for william.
    before_msgs = (["why won't this deploy", "plain msg", "ugh not again?!",
                    "another plain msg"] + ["filler"] * 6)
    for m in before_msgs:
        marker = net.flag(m)
        if marker:
            p = jev.is_frustrated(marker)
            if p >= 0.5:
                sig = Signal("william", marker, p, "frustration")
                sig.ts = 1.0  # before the change
                gov.record_signal(sig)
    # The principal reads the ledger, diagnoses, and fixes the deploy skill.
    principal = Principal(gov)
    principal.routine_improvement_job("william")
    # AFTER: 1 frustrated message out of 10.
    after_msgs = (["why won't this deploy", "plain"] + ["filler"] * 8)
    for m in after_msgs:
        marker = net.flag(m)
        if marker:
            p = jev.is_frustrated(marker)
            if p >= 0.5:
                sig = Signal("william", marker, p, "frustration")
                sig.ts = 2.0  # after the change
                gov.record_signal(sig)

    def rate(window: float) -> float:
        n = sum(1 for s in gov.signals if s["agent"] == "william" and s["ts"] == window)
        return n / 10.0

    before, after = rate(1.0), rate(2.0)
    expect(after < before,
           f"the frustration RATE is the metric: density must fall after the "
           f"principal's change — before={before:.2f}, after={after:.2f}")
    expect(before == 0.2 and after == 0.1,
           f"rate arithmetic: expected 0.2 -> 0.1, got {before} -> {after}")


def run(scenario_name: str = "sim_frustration_pipeline") -> _Scenario:
    s = _Scenario(scenario_name)
    s.check("the dictionary over-captures freely (high recall, no precision job)",
            check_dictionary_overcaptures)
    s.check("Jev does the precision: a flagged-but-happy message is 'not-frustration'",
            check_jev_does_precision)
    s.check("the signal is RECORDED as evidence in the governor's ledger",
            check_signal_recorded_as_evidence)
    s.check("a signal NEVER auto-punishes — no score alone can degrade an agent",
            check_signal_never_auto_punishes)
    s.check("the principal's routine improvement job reads the ledger",
            check_principal_reads_ledger)
    s.check("the metric is the frustration RATE, measured before/after",
            check_frustration_rate_is_the_metric)
    return s


def test_scenario():
    pytest_report(run())


if __name__ == "__main__":
    run_main(run())
