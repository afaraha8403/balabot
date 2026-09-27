"""Cache-safe injection path for Jev skill selection.

``jev_depth`` already implements the decision machinery — ``select_skills()``
and ``prompt_line()`` — but nothing calls them. This module is the wiring:
it runs the selection once per turn and hands the resulting
``<skill_relevance>`` line to the caller as a **cache-safe carrier**.

CACHE-SAFETY RULE (the point of this module)
--------------------------------------------
The original note proposed shipping the suggestion as "ONE extra system-prompt
line, appending after the roster prefix". That mechanism is REJECTED here.
Hermes' binding architecture invariant is that the system prompt must remain
BYTE-STABLE for the life of a conversation; the only sanctioned context
mutation is compression. Editing the system prompt mid-conversation
invalidates the cached prefix and multiplies the owner's token cost on every
subsequent request. Hermes' own precedents inject mid-conversation content
through sanctioned carriers instead:

- skill slash commands inject as a USER MESSAGE (Hermes ``agent/skill_commands.py``);
- subdirectory ``AGENTS.md`` hints append to a TOOL RESULT.

Therefore :func:`inject` returns a structure describing a USER-MESSAGE ride.
It never returns anything intended for the system prompt; the return type and
its keys make that constraint explicit and testable (see
``tests/test_jev_prompt.py``). The rendered ``<skill_relevance>`` line itself
is unchanged from ``jev_depth.prompt_line`` — only the carrier differs.

Degrade behaviour: when Jev is unavailable (no client injected, or any
``JevError``), the result carries NO line and a stated reason. No skill is
ever guessed and no exception escapes into the caller's turn loop.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .jev import Jev, JevError
from .jev_depth import MAX_REQUESTS_PER_TURN, PROMPT_LINE_TAG, select_skills

__all__ = ["SkillInjection", "InjectionCarrier", "select_and_render", "inject"]

#: Carriers this module may produce. A single, deliberately narrow set:
#: mid-conversation content may ride a user message; it may NEVER ride or
#: mutate the system prompt. Enforced structurally, not by convention.
SUPPORTED_CARRIERS = frozenset({"user_message"})

#: Mirror of jev_depth's budget for an explicit, local assertion.
_LOCAL_MAX_REQUESTS = MAX_REQUESTS_PER_TURN


@dataclass(frozen=True)
class SkillInjection:
    """Typed result of one turn's selection + rendering.

    Attributes:
        selected: skill names Jev selected (subset of the catalog keys).
        line: the rendered ``<skill_relevance>...</skill_relevance>`` line,
            or ``''`` when nothing was selected (never an empty tag pair).
        requests_used: Jev requests actually consumed this turn (<= 2).
        degraded: True when selection could not run (no Jev / JevError) —
            then ``line == ''`` and ``reason`` states why.
        reason: human-readable explanation, populated on degrade.
    """

    selected: tuple[str, ...]
    line: str
    requests_used: int
    degraded: bool
    reason: str


@dataclass(frozen=True)
class InjectionCarrier:
    """The cache-safe payload: a USER-MESSAGE ride, nothing else.

    ``carrier`` is pinned to ``'user_message'`` by construction — there is
    deliberately no field that could describe a system-prompt mutation, and
    constructing one is impossible (the dataclass has no such key and
    :func:`inject` validates ``carrier`` against ``SUPPORTED_CARRIERS``).
    The caller places ``content`` into the next user turn (or a synthetic
    user message) and must NOT touch the system prompt.
    """

    carrier: str
    content: str
    session_id: str

    def __post_init__(self) -> None:
        if self.carrier not in SUPPORTED_CARRIERS:
            raise ValueError(
                f"unsupported carrier {self.carrier!r}: mid-conversation "
                "injection may only ride a user message (system prompt must "
                "stay byte-stable for prefix caching)"
            )
        if "system" in self.carrier:
            raise ValueError("system-prompt carriers are forbidden")


class _Seen:
    """Mutable holder for the proxy's observations."""

    __slots__ = ("calls", "error")

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.error: BaseException | None = None


class _RecordingJev:
    """Delegates to the injected Jev and records calls/errors for the
    budget assertion and honest degrade detection. Adds no behaviour of
    its own — every request still goes to the real/fake client."""

    __slots__ = ("_inner", "_seen")

    def __init__(self, inner: Jev, seen: _Seen) -> None:
        self._inner = inner
        self._seen = seen

    def system_one(self, state: str, questions: dict, *, shadow: bool = False) -> dict:
        self._seen.calls.append((state, dict(questions)))
        try:
            return self._inner.system_one(state, questions, shadow=shadow)
        except BaseException as exc:  # noqa: BLE001 - observe, re-raise
            self._seen.error = exc
            raise


def select_and_render(
    turn_text: str,
    catalog: dict[str, str],
    *,
    jev: Jev | None = None,
    session_id: str = "",
) -> SkillInjection:
    """Run one Jev skill selection for ``turn_text`` over ``catalog``.

    ``catalog`` maps skill NAME -> description (the shape ``skills_registry``
    resolves records into; pass ``{r['name']: (r.get('source') or '') ...}``
    or whatever descriptive text the caller has). Reuses
    ``jev_depth.select_skills`` unchanged — same 60-char truncation, same
    0.30 gate, same request budget.

    Degrade path: ``jev is None`` -> no request, no line, stated reason.
    Any ``JevError`` -> the same. Never raises into the caller's turn loop
    and never invents a skill name.
    """
    if jev is None:
        return SkillInjection(
            selected=(), line="", requests_used=0, degraded=True,
            reason="Jev unavailable: no client injected; no skill guessed",
        )
    if not catalog:
        return SkillInjection(
            selected=(), line="", requests_used=0, degraded=True,
            reason="Jev unavailable: empty skill catalog; no skill guessed",
        )
    seen = _Seen()
    try:
        selected = select_skills(turn_text, catalog, jev=_RecordingJev(jev, seen))
    except JevError as exc:  # pragma: no cover - belt-and-braces
        return SkillInjection(
            selected=(), line="", requests_used=len(seen.calls), degraded=True,
            reason=f"Jev unavailable ({exc}); no skill guessed",
        )
    except Exception as exc:  # noqa: BLE001 - never escape into the turn loop
        return SkillInjection(
            selected=(), line="", requests_used=len(seen.calls), degraded=True,
            reason=f"Jev selection failed ({type(exc).__name__}: {exc}); no skill guessed",
        )
    if seen.error is not None:
        # select_skills catches JevError internally and returns [] — that is
        # still a degrade, not a clean "nothing selected". Say so.
        return SkillInjection(
            selected=(), line="", requests_used=len(seen.calls), degraded=True,
            reason=f"Jev unavailable ({seen.error}); no skill guessed",
        )
    line = _render_line(selected)
    requests_used = len(seen.calls)
    assert requests_used <= _LOCAL_MAX_REQUESTS, (
        f"request budget violated: {requests_used} > {MAX_REQUESTS_PER_TURN}"
    )
    return SkillInjection(
        selected=tuple(selected),
        line=line,
        requests_used=requests_used,
        degraded=False,
        reason="",
    )


def _render_line(selected: list[str]) -> str:
    """Single-line render; never an empty tag pair (nothing -> '')."""
    if not selected:
        return ""
    return f"<{PROMPT_LINE_TAG}>Relevant to the current request: {', '.join(selected)}</{PROMPT_LINE_TAG}>"


def inject(
    result: SkillInjection,
    *,
    session_id: str = "",
) -> InjectionCarrier | None:
    """Wrap a selection result as a cache-safe USER-MESSAGE ride.

    Returns ``None`` when there is nothing to inject (no line, degraded or
    empty selection) — the caller simply does nothing, and the system prompt
    stays byte-stable. Otherwise returns an :class:`InjectionCarrier` whose
    ``carrier`` key is pinned to ``'user_message'``. There is no field, key,
    or code path here that targets the system prompt; the rejection of the
    original system-prompt mechanism is structural (see module docstring).
    """
    if not result.line:
        return None
    return InjectionCarrier(
        carrier="user_message",
        content=result.line,
        session_id=session_id,
    )
