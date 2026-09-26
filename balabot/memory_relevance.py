"""The memory relevance ladder: recall wide, judge with one Jev call, fail honest.

WHY a ladder and not a single filter:
- Stage 1 (fetch): recall is FREE — never gate the fetch itself. Precision
  is what costs. The caller supplies candidates; this module does not own
  the store.
- Stage 2 (score): ONE Jev call carrying ~30 short candidate facts, using
  ONE Noul PER CANDIDATE. Deliberately NOT a Choice: a Choice is relative
  and forces exactly one winner even when the correct answer is "none of
  them". A Noul is absolute and can be low for ALL candidates — that is
  the state we must be able to detect.
- Stage 3 (threshold): keep candidates above a configurable threshold.
  WARNING: thresholds do NOT transfer between question shapes (Noul vs
  Choice vs Score) — they must be calibrated on real data, per shape.
- Stage 4 (re-look): if nothing clears the threshold, do NOT return an
  empty answer silently. Run the caller-supplied re-look ladder
  (widen/loosen terms -> entity-based lookup -> compositional), re-fetch,
  re-score.
- Stage 5 (explicit nothing): if it STILL finds nothing, return an
  explicit "no relevant memory" result so the caller can SAY SO — never
  inject weak facts as if they mattered.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

from .jev import Jev

# Stage 1 guidance: ~30 short facts per scoring call keeps the single
# Jev request cheap (~$0.042/1M input tokens) and parallel-fast.
MAX_CANDIDATES_PER_BATCH = 30


@dataclass
class Candidate:
    """One candidate fact. `text` is what Jev sees; `ref` identifies it back to the caller."""

    ref: str
    text: str


@dataclass
class RelevanceResult:
    """Outcome of the ladder. `no_relevant_memory` is explicit, never implied."""

    kept: list[Candidate]
    scores: dict[str, float]  # candidate ref -> Noul probability 0..1
    threshold: float
    no_relevant_memory: bool
    reason: str
    re_look_attempts: list[str] = field(default_factory=list)
    shadow: bool = False
    would_keep: list[Candidate] | None = None  # shadow mode only


# Re-look strategies: callables taking the original query and returning
# fresh candidates. Order matters: cheap/loose first, compositional last.
ReLookStrategy = Callable[[str], Sequence[Candidate]]


def score_candidates(
    client: Jev,
    state: str,
    candidates: Sequence[Candidate],
) -> dict[str, float]:
    """Stage 2: ONE Jev call, ONE Noul per candidate (parallel, cheap)."""
    if not candidates:
        return {}
    if len(candidates) > MAX_CANDIDATES_PER_BATCH:
        raise ValueError(
            f"{len(candidates)} candidates exceeds the {MAX_CANDIDATES_PER_BATCH} "
            "per-batch guidance; split the fetch into multiple scoring calls."
        )
    # One Noul per candidate: absolute yes/no, so "all low" is a state we
    # can detect (a Choice would force a winner where none deserves one).
    questions = {
        c.ref: {
            "type": "noul",
            "instructions": f"Is this fact relevant to the current context? Fact: {c.text}",
        }
        for c in candidates
    }
    response = client.system_one(state, questions)
    scores: dict[str, float] = {}
    for c in candidates:
        answer = response.get("answers", {}).get(c.ref, {})
        # Documented Noul answer shape: {"type": "noul", "noul": 0.99}.
        # The probability lives under "noul", NOT "probability" — verified
        # against the official docs (docs.typesafe.ai, primitives/noul).
        if not isinstance(answer, dict) or answer.get("type") != "noul":
            raise ValueError(
                f"Jev response for candidate '{c.ref}' is not a noul answer: {answer!r}"
            )
        probability = answer.get("noul")
        if probability is None:
            raise ValueError(f"Jev response missing 'noul' for candidate '{c.ref}'")
        scores[c.ref] = float(probability)
    return scores


def run_relevance_ladder(
    client: Jev,
    state: str,
    candidates: Sequence[Candidate],
    *,
    threshold: float = 0.75,
    re_look_strategies: Sequence[ReLookStrategy] = (),
    shadow: bool = False,
) -> RelevanceResult:
    """Stages 1-5. Raises on Jev errors (fail loud); never silently degrades.

    Shadow mode: returns everything it would have returned anyway, but
    also reports `would_keep` so the caller can compare against current
    behaviour before trusting the ladder in production.
    """
    re_look_attempts: list[str] = []
    working = list(candidates)

    scores = score_candidates(client, state, working)
    kept = [c for c in working if scores.get(c.ref, 0.0) >= threshold]

    # Stage 4: re-look ladder. Do not return empty silently.
    attempts = 0
    while not kept and attempts < len(re_look_strategies):
        strategy = re_look_strategies[attempts]
        re_look_attempts.append(getattr(strategy, "__name__", repr(strategy)))
        working = list(strategy(state))
        if working:
            scores = score_candidates(client, state, working)
            kept = [c for c in working if scores.get(c.ref, 0.0) >= threshold]
        attempts += 1

    if kept:
        return RelevanceResult(
            kept=kept,
            scores=scores,
            threshold=threshold,
            no_relevant_memory=False,
            reason="candidates cleared the threshold",
            re_look_attempts=re_look_attempts,
            shadow=shadow,
            would_keep=kept if shadow else None,
        )

    # Stage 5: explicit nothing — the caller should SAY "no relevant memory".
    return RelevanceResult(
        kept=[],
        scores=scores,
        threshold=threshold,
        no_relevant_memory=True,
        reason=(
            "no candidate cleared the threshold, including after "
            f"{len(re_look_attempts)} re-look attempt(s); say so explicitly "
            "rather than injecting weak facts"
        ),
        re_look_attempts=re_look_attempts,
        shadow=shadow,
        would_keep=[c for c, s in scores.items() if s >= threshold] if shadow else None,
    )
