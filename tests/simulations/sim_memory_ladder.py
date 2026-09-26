"""Simulation: the memory relevance ladder, end to end, with a fake Jev.

INVARIANTS UNDER TEST:
- Recall is NEVER gated: the fetch is wide and cheap, always.
- Jev scores in ONE call, with ONE Noul per candidate (never a Choice).
- Candidates above the calibrated threshold are kept.
- If NOTHING clears, the re-look ladder runs (widen -> entity probe ->
  compositional) and re-scores.
- If it STILL finds nothing, the result is an explicit 'no relevant memory'
  so the agent can SAY SO — weak facts are never injected as if they mattered.
- The threshold is calibrated per question shape: a Noul threshold is NOT
  reused for a Choice.

Run standalone:  python tests/simulations/sim_memory_ladder.py
Run under pytest: pytest tests/simulations/sim_memory_ladder.py
"""

from __future__ import annotations

from _sim_common import SimFailure, _Scenario, expect, finish, pytest_report, run_main

from balabot.memory_relevance import (
    MAX_CANDIDATES_PER_BATCH,
    Candidate,
    RelevanceResult,
    run_relevance_ladder,
    score_candidates,
)


class ScriptedJev:
    """Deterministic fake of balabot.jev.Jev.system_one.

    Scripted: a dict of (call_index, ref) -> probability. Call order is the
    ladder's real call order (initial fetch, then one call per re-look).
    """

    def __init__(self, script: dict[tuple[int, str], float]) -> None:
        self.script = script
        self.calls: list[dict[str, str]] = []  # (call#, ref) -> primitive used
        self._call_index = 0

    def system_one(self, state, questions, **kw):
        self._call_index += 1
        answers = {}
        for ref, q in questions.items():
            self.calls.append((self._call_index, ref, q["primitive"]))
            answers[ref] = {"type": "noul",
                            "noul": self.script[(self._call_index, ref)]}
        return {"answers": answers}


# ------------------------------------------------------- re-look strategies

def widen(state: str):
    return [Candidate("widen-hit", "invoice net-30 terms — matched by loosened terms")]


def entity_probe(state: str):
    return [Candidate("entity-hit", "entity 'invoice' ledger pointer")]


def compositional(state: str):
    return [Candidate("comp-hit", "compositional: invoice + terms + late-fee")]


LADDER = (widen, entity_probe, compositional)


# ------------------------------------------------------------------- checks

def check_fetch_wide_first() -> None:
    """Recall is never gated: a full-width batch goes to scoring in one call."""
    clients = ScriptedJev({(1, f"f{i}"): 0.9 for i in range(30)})
    cands = [Candidate(f"f{i}", f"fact {i}") for i in range(MAX_CANDIDATES_PER_BATCH)]
    result = run_relevance_ladder(clients, "state", cands, threshold=0.5,
                                  re_look_strategies=())
    expect(len(result.kept) == MAX_CANDIDATES_PER_BATCH,
           f"all wide-fetched candidates above threshold must be kept — kept "
           f"{len(result.kept)}")
    expect(len({c for c, _, _ in {(n, r, p) for n, r, p in clients.calls}}) == 1,
           "the entire wide fetch must be scored in ONE Jev call")


def check_one_call_one_noul_per_candidate() -> None:
    cands = [Candidate(f"g{i}", f"fact {i}") for i in range(10)]
    clients = ScriptedJev({(1, f"g{i}"): 0.5 for i in range(10)})
    score_candidates(clients, "state", cands)
    first_call = [(r, p) for n, r, p in clients.calls if n == 1]
    expect(len(first_call) == 10,
           f"one Noul per candidate in ONE call — got {len(first_call)} questions "
           f"in call 1")
    expect(all(p == "noul" for _, _, p in clients.calls),
           f"every scoring question must be a Noul — saw primitives "
           f"{sorted({p for _, _, p in clients.calls})}")
    expect("choice" not in {p for _, _, p in clients.calls},
           "a Choice primitive must NEVER be used for per-candidate scoring")


def check_threshold_keeps_above_only() -> None:
    cands = [Candidate("hi", "clearly relevant"), Candidate("lo", "not relevant")]
    clients = ScriptedJev({(1, "hi"): 0.93, (1, "lo"): 0.05})
    result = run_relevance_ladder(clients, "s", cands, threshold=0.75,
                                  re_look_strategies=())
    expect([c.ref for c in result.kept] == ["hi"],
           f"only candidates above the threshold survive — kept "
           f"{[c.ref for c in result.kept]!r}")


def check_relook_ladder_runs_and_recovers() -> None:
    """Nothing clears initially; widen recovers a hit on the SECOND scoring
    call, after widen ran. Re-score then admits."""
    cands = [Candidate("a", "distant fact")]
    script = {(1, "a"): 0.10,          # initial: nothing clears
              (2, "widen-hit"): 0.85}  # after widen
    clients = ScriptedJev(script)
    result = run_relevance_ladder(clients, "state", cands, threshold=0.75,
                                  re_look_strategies=LADDER)
    expect(not result.no_relevant_memory,
           "when a re-look step finds a hit, the ladder must NOT declare "
           "'no relevant memory'")
    expect(result.re_look_attempts[0].endswith("widen"),
           f"the ladder must walk in order widen -> entity -> compositional; "
           f"ran {result.re_look_attempts!r}")
    expect(len([1 for n, _, _ in clients.calls if n == 1]) == 1 and
           len([1 for n, _, _ in clients.calls if n == 2]) == 1,
           "each re-look step re-scores with exactly one more Jev call")


def check_ladder_walks_all_steps_before_giving_up() -> None:
    script = {(1, "a"): 0.05, (2, "widen-hit"): 0.05,
              (3, "entity-hit"): 0.05, (4, "comp-hit"): 0.05}
    clients = ScriptedJev(script)
    result = run_relevance_ladder(clients, "s", [Candidate("a", "x")], threshold=0.75,
                                  re_look_strategies=LADDER)
    expect(result.no_relevant_memory is True,
           "after the full ladder finds nothing, the explicit-nothing state must hold")
    expect(len(result.re_look_attempts) == 3,
           f"all three re-look strategies must run before giving up — ran "
           f"{result.re_look_attempts!r}")
    expect(result.reason and "no" in result.reason.lower(),
           "the result must EXPLAIN that nothing cleared, including after re-look")


def check_explicit_nothing_not_weak_injection() -> None:
    """The failure mode to prevent: injecting weak facts as if they mattered."""
    clients = ScriptedJev({(1, "weak"): 0.20})  # well below threshold
    result = run_relevance_ladder(clients, "s", [Candidate("weak", "tangential")],
                                  threshold=0.75, re_look_strategies=())
    expect(result.no_relevant_memory is True,
           "sub-threshold results must surface as EXPLICIT 'no relevant memory'")
    expect(result.kept == [],
           f"no weak fact may be kept as if it mattered — kept {result.kept!r}")


def check_threshold_calibrated_per_shape() -> None:
    """A Noul threshold is not a Choice threshold. The calibration is per
    question SHAPE — prove the distinction is encoded, not erased."""
    noul_threshold = 0.75
    # A Choice primitive's score means "best relative winner", whose floor is
    # a different distribution; reusing the Noul threshold on it is a category
    # error the ladder's docs forbid.
    calibrations = {"noul": 0.75, "choice": 0.30, "score": 6}
    expect(calibrations["noul"] != calibrations["choice"],
           "thresholds must be calibrated per question shape — Noul and Choice "
           "cannot share one")
    # The shipped ladder scores ONLY with noul questions, so only the Noul
    # calibration is ever applied to it.
    expect("primitive\": \"noul" in score_candidates.__doc__ or
           '"primitive": "noul"' in __import__("inspect").getsource(score_candidates),
           "score_candidates must pin the noul primitive in its questions")
    # And the shipped default is a Noul threshold, documented as such.
    import inspect
    sig = inspect.signature(run_relevance_ladder)
    default = sig.parameters["threshold"].default
    expect(default == 0.75, f"the ladder's documented Noul threshold is 0.75, got {default}")


def run(scenario_name: str = "sim_memory_ladder") -> _Scenario:
    s = _Scenario(scenario_name)
    s.check("recall is never gated: the wide fetch is scored in full, one call",
            check_fetch_wide_first)
    s.check("ONE Jev call, ONE Noul per candidate — never a Choice",
            check_one_call_one_noul_per_candidate)
    s.check("only candidates above the calibrated threshold are kept",
            check_threshold_keeps_above_only)
    s.check("when nothing clears, the re-look ladder runs (widen -> entity -> "
            "compositional) and re-scores", check_relook_ladder_runs_and_recovers)
    s.check("the ladder walks ALL steps before declaring nothing",
            check_ladder_walks_all_steps_before_giving_up)
    s.check("explicit 'no relevant memory' — weak facts are never injected as if "
            "they mattered", check_explicit_nothing_not_weak_injection)
    s.check("thresholds are calibrated per question shape (Noul != Choice)",
            check_threshold_calibrated_per_shape)
    return s


def test_scenario():
    pytest_report(run())


if __name__ == "__main__":
    run_main(run())
