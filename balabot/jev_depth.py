"""Jev depth layer: the decision gate, skill selection, and the prompt line.

Implements the three depth behaviours the architecture doc specifies
(`balabot-architecture.md` §1 Infrastructure role):

1. **The decision gate** (`is_decision_worthy`) — Jev answers "is this
   decision-worthy?" *before* the ledger admits a decision, so the governor
   admits decisions, not transcripts. The gate is tuned to **over-admit**
   (bloat is recoverable, a missing decision is not) and — critically — it
   **fails open** when Jev itself is unavailable: a decision gate that blocks
   work whenever the classifier is down silently loses decisions, which is
   exactly the failure the ledger exists to prevent. (The doc's own
   simulation is named `sim_decision_gate_failopen`.)
2. **Skill selection** (`select_skills`) — the TypeSafe cookbook over
   Hermes' skill catalog: skim all descriptions (truncated to 60 chars —
   the same truncation the catalog itself uses, so the model sees what the
   roster sees), re-read the top candidates, and gate on **0.30** — below
   that, select nothing rather than guess. The documented budget is **two
   requests per turn** (skim → re-read top 3, free to reject all); that
   budget is enforced, not ignored.
3. **The skill-relevance prompt line** (`prompt_line`) — the suggestion
   ships as ONE extra system-prompt line
   (`<skill_relevance>...</skill_relevance>`), appending after the roster
   prefix without rewriting it, so any prefix caching over the roster still
   holds. Nothing selected → empty string, never an empty tag pair.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .jev import Jev, JevError

#: The cookbook's gate threshold: below 0.30, select nothing rather than guess.
SKILL_GATE_THRESHOLD = 0.30

#: Description truncation length in the prompt (Hermes' own roster truncation).
DESC_TRUNCATION = 60

#: The documented request budget per turn: skim all → re-read top candidates.
MAX_REQUESTS_PER_TURN = 2

#: Tag word for the single extra system-prompt line (XML-style pair).
PROMPT_LINE_TAG = "skill_relevance"

#: How many top candidates are re-read in the second request.
TOP_N_RE_READ = 3


@dataclass
class Decision:
    """Typed result of the decision gate.

    `failed_open` is True when Jev was unavailable and the gate admitted the
    decision anyway — the caller can log/consolidate it differently.
    """

    worthy: bool
    reason: str
    confidence: float
    failed_open: bool = False


def is_decision_worthy(
    statement: str,
    *,
    jev: Jev | None = None,
) -> Decision:
    """Ask Jev "is this decision-worthy?" before the ledger admits it.

    Tuned to over-admit: the governor deduplicates and consolidates
    afterwards, but a decision silently dropped by the gate is gone forever.
    Consequently the gate FAILS OPEN on any Jev failure: it returns
    `worthy=True` with `reason='gate unavailable - failed open'` and
    `failed_open=True` rather than blocking work while the classifier is down.
    """
    if jev is None:
        # No client injected: nothing to classify with. Fail open for the
        # same reason as a Jev outage — never lose a decision to the gate.
        return Decision(True, "gate unavailable - failed open", 0.0, failed_open=True)
    try:
        response = jev.system_one(
            statement,
            {
                "decision_worthy": {
                    "type": "noul",
                    "instructions": (
                        "Is this statement a decision — a choice that sets "
                        "direction or commits the agent to an action — rather "
                        "than chatter, a transcript, or a question?"
                    ),
                }
            },
        )
    except JevError as exc:
        # Fail open: blocking on classifier downtime loses decisions
        # invisibly, which is the worst outcome for the ledger.
        return Decision(
            True, f"gate unavailable - failed open ({exc})", 0.0, failed_open=True
        )
    answer = (response.get("answers") or {}).get("decision_worthy") or {}
    probability = float(answer.get("probability", 0.0))
    confidence = float(response.get("confidence", probability))
    worthy = probability >= 0.5  # over-admit: borderline goes in, not out
    return Decision(worthy, "jev decision gate", confidence)


def select_skills(
    task: str,
    available: dict[str, str],
    *,
    jev: Jev | None = None,
    requests_allowed: int = MAX_REQUESTS_PER_TURN,
) -> list[str]:
    """Select relevant skill names for a task via the Jev cookbook.

    `available` maps skill NAME → description. The prompt truncates each
    description to 60 chars (the catalog's own truncation, so the model
    judges the same text the roster shows). Each candidate's relevance is a
    Noul scored 0..1; anything under `SKILL_GATE_THRESHOLD` (0.30) is
    rejected — below that, select nothing rather than guess. The budget of
    two requests per turn is enforced: the skim plus the re-read must fit,
    or the selection aborts empty.

    Returns SKILL NAMES only, restricted to keys of `available` — a name not
    in `available` is dropped, never invented. With no Jev client (or an
    exhausted budget) returns `[]`: refusing to guess is the spec.
    """
    if jev is None or not available:
        return []
    budget = _Budget(requests_allowed)
    skim_lines = [
        f"- {name}: {(desc or '')[:DESC_TRUNCATION]}" for name, desc in available.items()
    ]
    state = f"Task: {task}\nSkill catalog:\n" + "\n".join(skim_lines)
    try:
        skim = jev.system_one(
            state,
            {
                "candidates": {
                    "type": "choice",
                    "criteria": {name: f"Relevant to the task: {name}" for name in available},
                }
            },
        )
        budget.spend()
        top = (skim.get("answers") or {}).get("candidates") or {}
        ranked = [name for name, _ in sorted(top.items(), key=lambda kv: -kv[1])][:TOP_N_RE_READ]
        ranked = [name for name in ranked if name in available][: budget.remaining]
        if not ranked:
            return []
        scores = jev.system_one(
            state,
            {
                name: {
                    "type": "noul",
                    "instructions": "Score 0..1: how relevant is this skill to the task?",
                }
                for name in ranked
            },
        )
        budget.spend()
        answers = scores.get("answers") or {}
    except JevError:
        # No selection on failure — never guess a skill name.
        return []
    return [
        name
        for name in ranked
        if float((answers.get(name) or {}).get("probability", 0.0)) >= SKILL_GATE_THRESHOLD
    ]


class _Budget:
    """Enforces the documented two-requests-per-turn budget."""

    __slots__ = ("remaining",)

    def __init__(self, allowed: int) -> None:
        self.remaining = max(0, int(allowed))

    def spend(self) -> None:
        if self.remaining <= 0:
            raise JevError("request budget exhausted (max 2 per turn)")
        self.remaining -= 1


def prompt_line(selected: list[str], roster_prefix: str) -> str:
    """One extra system-prompt line, appended AFTER the roster prefix.

    Format: `<skill_relevance>Relevant to the current request: a, b</skill_relevance>`
    The roster prefix is returned untouched (prefix caching holds); nothing
    selected → empty string, never an empty tag pair.
    """
    if not selected:
        return ""
    inner = f"Relevant to the current request: {', '.join(selected)}"
    line = f"<{PROMPT_LINE_TAG}>{inner}</{PROMPT_LINE_TAG}>"
    return f"{roster_prefix}{line}" if roster_prefix else line
