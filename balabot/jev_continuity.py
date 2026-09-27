"""Jev-backed session continuity: saliency, context signals, session routing.

Three behaviours, all following the `jev_depth` house pattern — an INJECTED
Jev callable (default `None`), a stated gate threshold, and a fail-open that
names its reason:

1. **Pre-compaction saliency** (`saliency_pass`) — before compaction drops
   turns, each item is classified into exactly four destinations:

   - a decision was taken → the governor ledger;
   - a durable fact about a person/project → holographic memory;
   - live task state ("we are mid-way through X") → the working set;
   - noise → dropped DELIBERATELY.

   Implemented as per-item typed Nouls (`is_decision` / `is_durable_fact` /
   `is_live_task_state`) for every item, batched into ONE `system_one`
   request (questions in one request evaluate in parallel, so stacking them
   barely changes latency).

   WHY NOUL, NOT CHOICE: with a Choice, "none of these" and "two of them"
   are unrepresentable — a Choice forces exactly one winner from the named
   criteria, so an item that is nothing, or an item that is both a durable
   fact AND live task state, cannot be expressed. Noul is absolute: each
   candidate predicate can independently be low for every item, and the
   "nothing fits → deliberately dropped" case falls out naturally.

   Fail-open WITH A STATED REASON (the jev_depth decision-gate precedent):
   bloat is recoverable, a silently dropped decision is not. If Jev is
   unavailable, every item routes to the working set (the recoverable
   destination — holographic memory and the ledger can be re-derived from
   the working set later, but not from a compaction that already ran) and
   the result carries `degraded=True` plus a `reason`. Never a silent
   default, never an exception that loses the evidence.

2. **Context signals** (`context_signals`) — three typed signals for the
   session governor:

   - `near_limit`: computed IN CODE from the token budget. Jev cannot count
     or do arithmetic; asking it would be malpractice. Code answers
     "tokens_used / token_limit >= NEAR_LIMIT_RATIO".
   - `drift`: ONE Noul over the session's PURPOSE RECORD as state — "has
     this conversation drifted from its stated purpose?"
   - `repetition`: CODE finds candidate repeats from past turns (normalized
     token overlap, a purely lexical computation), then a Noul judges
     whether the current turn is the same question as the best candidate.
     No candidates → no question asked.

3. **Session routing** (`route_session`) — THREE outcomes only, never a
   binary: 'resume' (same purpose continues), 'new_linked' (new topic, old
   one still reachable), 'new_clean' (unrelated). Implemented as ONE Noul
   PER CANDIDATE plus a separate Noul for "does this need a new session at
   all?" — never a Choice, for the same reason as above: with a Choice,
   "resume none of them" and "resume two" are unrepresentable.

   PRE-FILTER IN CODE, before Jev sees anything: same bot only, recency
   window, and a lexical-overlap floor against the turn text. Jev never
   receives the metadata of hundreds of sessions. The filtered candidate
   set that was actually sent is returned on the result.

   CONFIDENCE GATE: when no candidate clears the resume bar AND the
   "needs a new session" Noul is also low, the signal is genuinely
   ambiguous → outcome 'ask_user' with the shortlist and the probabilities,
   rather than guessing. The owner does zero session management in the
   common case and is consulted only at real ambiguity.

   Fail-open: a Jev outage also resolves to 'ask_user' (with
   `degraded=True` and the reason) — asking the owner beats guessing a
   session identity from a broken classifier. With no client injected the
   same holds.

   `shadow=True` passes through to `system_one` so a caller can log the
   proposed routing while keeping its old behaviour.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from .jev import Jev, JevError, noul_probability

# ---------------------------------------------------------------------------
# Constants — gates are DATA at module level, per the house pattern.
# ---------------------------------------------------------------------------

#: Saliency gate: a predicate at/above this routes the item to that destination.
#: Below it, the predicate does not claim the item (over-admit is intentional
#: for `is_decision`, which is evaluated first and is the irreversible drop).
SALIENCY_GATE = 0.50

#: Near-limit ratio: at/above this fraction of the token budget, the session
#: is near its context limit. Computed in code, never by Jev.
NEAR_LIMIT_RATIO = 0.85

#: Drift gate: at/above this, the conversation has drifted from its purpose.
DRIFT_GATE = 0.60

#: Repetition gate: at/above this, the current turn repeats an earlier one.
REPETITION_GATE = 0.60

#: Resume gate: a candidate at/above this IS the same purpose → 'resume'.
RESUME_GATE = 0.70

#: New-session gate: at/above this, the turn needs a fresh session.
NEW_SESSION_GATE = 0.60

#: Linkage floor: best candidate at/above this (but below RESUME_GATE)
#: means the old purpose is still reachable → 'new_linked'.
LINKAGE_GATE = 0.35

#: Recency window: candidates last active more than this many days ago are
#: pre-filtered OUT in code. Date arithmetic stays in code — Jev cannot
#: compare dates.
MAX_CANDIDATE_AGE_DAYS = 14.0

#: Lexical-overlap floor (Jaccard over normalized tokens) between the turn
#: text and a candidate summary, below which the candidate is pre-filtered
#: OUT in code. Pure counting — never delegated to Jev.
MIN_LEXICAL_OVERLAP = 0.10

DESTINATIONS = ("ledger", "holographic", "working_set", "dropped")
OUTCOMES = ("resume", "new_linked", "new_clean", "ask_user")

_WORD_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are as at be but by for from i if in is it of on or that the this to "
    "was we what when with you your do does did".split()
)


# ---------------------------------------------------------------------------
# 1. Saliency pass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SaliencyItem:
    """One item's routing verdict. Exactly one destination, no default bucket."""

    index: int
    destination: str  # one of DESTINATIONS
    probabilities: dict[str, float]
    failed_open: bool = False


@dataclass(frozen=True)
class SaliencyResult:
    """The batch verdict. `degraded` is True only when Jev was unavailable and
    every item was routed to the working set (the recoverable destination)."""

    items: tuple[SaliencyItem, ...]
    degraded: bool = False
    reason: str = ""


def _saliency_questions(n: int) -> dict[str, dict[str, Any]]:
    """Per-item typed Nouls, batched into one request's question dict."""
    questions: dict[str, dict[str, Any]] = {}
    for i in range(n):
        questions[f"{i}_is_decision"] = {
            "type": "noul",
            "instructions": (
                "Does this item record a decision — a choice that sets "
                "direction or commits the agent to an action?"
            ),
        }
        questions[f"{i}_is_durable_fact"] = {
            "type": "noul",
            "instructions": (
                "Is this item a durable fact about a person or a project — "
                "something still true long after this conversation ends?"
            ),
        }
        questions[f"{i}_is_live_task_state"] = {
            "type": "noul",
            "instructions": (
                "Is this item live task state — where the work currently "
                "stands, such as being mid-way through something?"
            ),
        }
    return questions


def _destination_for(probs: dict[str, float]) -> str:
    """Apply the destination precedence: decision > durable fact > live state.

    `is_decision` is evaluated first because dropping a decision silently is
    the one unrecoverable outcome (bloat is recoverable); over-admit is its
    deliberate bias, matching the jev_depth gate.
    """
    if probs["is_decision"] >= SALIENCY_GATE:
        return "ledger"
    if probs["is_durable_fact"] >= SALIENCY_GATE:
        return "holographic"
    if probs["is_live_task_state"] >= SALIENCY_GATE:
        return "working_set"
    return "dropped"


def saliency_pass(evidence: list[str], jev: Jev | None = None) -> SaliencyResult:
    """Classify what compaction is about to drop into exactly four destinations.

    `evidence` is a list of item texts (turns, excerpts) in the order they
    appear. Every item gets a typed Noul per predicate, all in ONE
    `system_one` request. There is no default destination that silently
    catches everything: an item no predicate claims is DROPPED DELIBERATELY.

    On any Jev failure (outage, error, no injected client) the pass fails
    OPEN WITH A STATED REASON: every item routes to `working_set` — the
    recoverable destination — and the result carries `degraded=True` plus a
    `reason`. Bloat is recoverable; a silently dropped decision is not.
    """
    n = len(evidence)
    if n == 0:
        return SaliencyResult(())
    if jev is None:
        return _degraded_saliency(
            n, "no Jev client injected - failed open to working_set"
        )
    state = "\n".join(f"[{i}] {text}" for i, text in enumerate(evidence))
    try:
        response = jev.system_one(state, _saliency_questions(n))
    except JevError as exc:
        # Fail open, never raise: an exception here would lose the evidence
        # to the very compaction this pass exists to protect.
        return _degraded_saliency(n, f"Jev unavailable - failed open ({exc})")
    answers = response.get("answers") or {}
    items: list[SaliencyItem] = []
    for i in range(n):
        probs = {
            pred: noul_probability(
                answers.get(f"{i}_{pred}") or {}, context=f"saliency {i}_{pred}"
            )
            for pred in ("is_decision", "is_durable_fact", "is_live_task_state")
        }
        items.append(SaliencyItem(i, _destination_for(probs), probs))
    return SaliencyResult(tuple(items))


def _degraded_saliency(n: int, reason: str) -> SaliencyResult:
    items = tuple(
        SaliencyItem(
            i,
            "working_set",
            {"is_decision": 0.0, "is_durable_fact": 0.0, "is_live_task_state": 0.0},
            failed_open=True,
        )
        for i in range(n)
    )
    return SaliencyResult(items, degraded=True, reason=reason)


# ---------------------------------------------------------------------------
# 2. Context signals
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ContextSignals:
    """The three signals, each with its derivation stated."""

    near_limit: bool
    usage_ratio: float
    drifted: bool
    drift_probability: float
    repeated: bool
    repetition_probability: float
    repetition_candidate: str | None
    degraded: bool = False
    reason: str = ""


def _tokens(text: str) -> set[str]:
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOPWORDS}


def _candidate_repeats(current: str, past_turns: list[str]) -> list[str]:
    """Code finds candidate repeats: past turns with normalized-token Jaccard
    overlap against the current turn. Pure counting — Jev sees only the
    surviving candidates, never does the counting itself."""
    cur = _tokens(current)
    if not cur:
        return []
    out: list[str] = []
    for past in past_turns:
        pt = _tokens(past)
        if not pt:
            continue
        jaccard = len(cur & pt) / len(cur | pt)
        if jaccard >= MIN_LEXICAL_OVERLAP:
            out.append(past)
    return out


def context_signals(
    *,
    tokens_used: int,
    token_limit: int,
    purpose_record: str,
    current_turn: str,
    past_turns: list[str],
    jev: Jev | None = None,
    shadow: bool = False,
) -> ContextSignals:
    """Three context-limit signals for the session governor.

    (a) `near_limit` is computed IN CODE from `tokens_used` / `token_limit`.
    (b) `drift` is ONE Noul over the PURPOSE RECORD as state.
    (c) `repetition`: code finds candidate repeats among `past_turns`, then
        one Noul judges whether the current turn is the same question as the
        best candidate. No candidates → False without a Jev round-trip.

    No arithmetic, counting, or date comparison is ever asked of Jev. On a
    Jev failure the drift/repetition Nouls default to "no signal" with
    `degraded=True` and a `reason` — the near-limit signal is unaffected
    because it never touches Jev at all.
    """
    if token_limit <= 0:
        raise ValueError("token_limit must be positive")
    ratio = min(1.0, max(0, tokens_used) / float(token_limit))
    near_limit = ratio >= NEAR_LIMIT_RATIO

    repeats = _candidate_repeats(current_turn, past_turns)
    best_repeat = repeats[0] if repeats else None

    drifted = False
    drift_p = 0.0
    repeated = False
    rep_p = 0.0
    degraded = False
    reason = ""

    if jev is not None:
        questions: dict[str, Any] = {
            "drifted": {
                "type": "noul",
                "instructions": (
                    "Has this conversation drifted from its stated purpose?"
                ),
            }
        }
        if best_repeat is not None:
            questions["same_question"] = {
                "type": "noul",
                "instructions": (
                    "Is the current turn the same question as the earlier "
                    "turn, asked again?"
                ),
            }
        state = (
            f"PURPOSE RECORD:\n{purpose_record}\n\n"
            f"CURRENT TURN:\n{current_turn}"
            + (f"\n\nEARLIER TURN:\n{best_repeat}" if best_repeat else "")
        )
        try:
            response = jev.system_one(state, questions, shadow=shadow)
            answers = response.get("answers") or {}
            drift_p = noul_probability(
                answers.get("drifted") or {}, context="drift signal"
            )
            drifted = drift_p >= DRIFT_GATE
            if best_repeat is not None:
                rep_p = noul_probability(
                    answers.get("same_question") or {}, context="repetition signal"
                )
                repeated = rep_p >= REPETITION_GATE
        except JevError as exc:
            # Fail soft to "no signal" for the Jev-judged parts only; the
            # code-computed near-limit signal stands regardless.
            degraded = True
            reason = f"Jev unavailable - drift/repetition unchecked ({exc})"
    else:
        degraded = True
        reason = "no Jev client injected - drift/repetition unchecked"

    return ContextSignals(
        near_limit=near_limit,
        usage_ratio=ratio,
        drifted=drifted,
        drift_probability=drift_p,
        repeated=repeated,
        repetition_probability=rep_p,
        repetition_candidate=best_repeat if repeated else None,
        degraded=degraded,
        reason=reason,
    )


# ---------------------------------------------------------------------------
# 3. Session routing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SessionRoute:
    """The routing verdict. `outcome` is one of OUTCOMES — never a binary."""

    outcome: str
    candidate_id: str | None
    candidate_probabilities: dict[str, float]  # filtered candidate id -> p
    needs_new_probability: float
    filtered_candidates: list[str] = field(default_factory=list)
    degraded: bool = False
    reason: str = ""


def _prefilter_candidates(
    turn_text: str,
    candidates: list[dict[str, Any]],
    *,
    bot_id: str,
    now: float,
) -> list[dict[str, Any]]:
    """Code-side pre-filter BEFORE Jev sees anything: same bot, recency
    window, lexical-overlap floor. Jev never sees hundreds of sessions."""
    cur = _tokens(turn_text)
    keep: list[dict[str, Any]] = []
    for cand in candidates:
        if cand.get("bot_id") != bot_id:
            continue
        last_active = cand.get("last_active")
        if last_active is not None and (now - float(last_active)) / 86400.0 > MAX_CANDIDATE_AGE_DAYS:
            continue
        cand_tokens = _tokens(str(cand.get("summary", "")) + " " + str(cand.get("text", "")))
        if cand_tokens and cur:
            overlap = len(cur & cand_tokens) / len(cur | cand_tokens)
            if overlap < MIN_LEXICAL_OVERLAP:
                continue
        keep.append(cand)
    return keep


def _routing_questions(cand_ids: list[str]) -> dict[str, dict[str, Any]]:
    questions: dict[str, dict[str, Any]] = {
        "needs_new_session": {
            "type": "noul",
            "instructions": (
                "Does this turn need a NEW session — a purpose not already "
                "covered by any listed candidate?"
            ),
        }
    }
    for cid in cand_ids:
        questions[f"same_purpose_{cid}"] = {
            "type": "noul",
            "instructions": (
                "Is this turn a continuation of the SAME purpose as the "
                "candidate?"
            ),
        }
    return questions


def route_session(
    turn_text: str,
    candidates: list[dict[str, Any]],
    jev: Jev | None = None,
    *,
    bot_id: str,
    now: float | None = None,
    shadow: bool = False,
) -> SessionRoute:
    """Route a turn to 'resume' | 'new_linked' | 'new_clean' — or 'ask_user'.

    Pre-filters candidates IN CODE (same bot, recency, lexical overlap),
    then asks ONE Noul per surviving candidate plus ONE Noul for "does this
    need a new session at all?" — never a Choice.

    Resolution:
    - best candidate >= RESUME_GATE → 'resume' (that candidate);
    - else needs_new >= NEW_SESSION_GATE → 'new_linked' if the best
      candidate is at/above LINKAGE_GATE (old purpose still reachable),
      else 'new_clean';
    - else (no candidate resumes AND needs_new is low) → 'ask_user' with
      the shortlist and probabilities: the signal is genuinely ambiguous,
      and the owner is consulted rather than guessed at.

    On a Jev outage (or no injected client) the route also resolves to
    'ask_user' with `degraded=True` and the stated reason — asking beats
    guessing a session identity from a broken classifier.
    """
    now = time.time() if now is None else now
    kept = _prefilter_candidates(turn_text, candidates, bot_id=bot_id, now=now)
    kept_ids = [str(c["id"]) for c in kept]

    if jev is None:
        return SessionRoute(
            "ask_user",
            None,
            {},
            0.0,
            filtered_candidates=kept_ids,
            degraded=True,
            reason="no Jev client injected - routing unresolved",
        )
    state_parts = [f"TURN:\n{turn_text}", "CANDIDATES:"]
    for cand in kept:
        state_parts.append(
            f"- id {cand['id']}: {cand.get('summary', '')} {cand.get('text', '')}".strip()
        )
    if not kept:
        state_parts.append("(no candidates)")
    try:
        response = jev.system_one("\n\n".join(state_parts), _routing_questions(kept_ids), shadow=shadow)
    except JevError as exc:
        return SessionRoute(
            "ask_user",
            None,
            {},
            0.0,
            filtered_candidates=kept_ids,
            degraded=True,
            reason=f"Jev unavailable - routing unresolved ({exc})",
        )
    answers = response.get("answers") or {}
    needs_new_p = noul_probability(
        answers.get("needs_new_session") or {}, context="needs new session"
    )
    cand_probs = {
        cid: noul_probability(
            answers.get(f"same_purpose_{cid}") or {}, context=f"same purpose {cid}"
        )
        for cid in kept_ids
    }
    best_id = max(cand_probs, key=lambda c: cand_probs[c]) if cand_probs else None
    best_p = cand_probs.get(best_id, 0.0) if best_id else 0.0

    if best_p >= RESUME_GATE:
        return SessionRoute("resume", best_id, cand_probs, needs_new_p, kept_ids)
    if needs_new_p >= NEW_SESSION_GATE:
        outcome = "new_linked" if best_p >= LINKAGE_GATE else "new_clean"
        return SessionRoute(outcome, None, cand_probs, needs_new_p, kept_ids)
    # Genuinely ambiguous: no candidate resumes, and a new session is not
    # clearly warranted. Consult the owner with the shortlist and the
    # probabilities rather than guess.
    return SessionRoute("ask_user", best_id, cand_probs, needs_new_p, kept_ids)
