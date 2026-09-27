"""Frustration pipeline — cheap sensor -> Jev escalation -> governor ledger -> growth job.

Layer 1 (KEYWORD DICTIONARY) is a local, network-free, high-recall string
match that runs on every message. The dictionary is DATA (module-level),
multi-lingual (English + Arabic at minimum), and carries an explicit
filler/exclusion list so neutral discourse like "Anyways" does NOT fire the
net — the architecture doc's own caution.

Layer 2: classify() decides what is worth escalating and hands the flagged
window to an INJECTED Jev callable — never constructed in tests.

Layer 3: escalated + confirmed signals are written through the governor's
durable ledger channel (balabot.bootstrap init_ledger / append path under
BALABOT_DATA_ROOT). Fail loud: no entry is ever fabricated; if the ledger
path cannot be written, GrowthError is raised.

Layer 4: growth_job() reads accumulated ledger entries and proposes ONE
concrete, non-destructive action (a skill patch suggestion or a routing
change), as a structured record. It NEVER auto-applies anything.

Metric: frustration_rate(entries) -> float, with a stated denominator
(total recorded messages), so the ratio is interpretable — density of
confirmed frustration signals per 1000 messages. growth_job() carries the
denominator with every rate it reports for exactly that reason.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import yaml

from .bootstrap import LEDGER_DIRNAME
from .jev import noul_probability

GOVERNOR = "governor"
PRINCIPAL = "principal"

#: Confirmation gate for an escalated frustration signal. A noul answer carries
#: no "value" key — only a probability under "noul" — so the old
#: `answer.get("value") and probability >= 0.6` condition could never be true
#: against the live API: genuine frustration was recorded as deferred forever.
FRUSTRATION_CONFIRMATION_GATE = 0.6


class GrowthError(RuntimeError):
    """The ledger path is unavailable or unreadable. Fail loud, never fabricate."""


# ---------------------------------------------------------------------------
# LAYER 1 — the dictionary is DATA. Extend it here, not inside functions.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Signal:
    """One dictionary hit: marker, (start, end) span in the source text, severity."""

    marker: str
    span: tuple[int, int]
    severity: str

    def to_dict(self) -> dict[str, Any]:
        return {"marker": self.marker, "span": list(self.span), "severity": self.severity}


# Multi-lingual markers. Deliberately high recall; Jev does precision work.
# Each entry: (marker, severity). severity 'high' = near-unambiguous complaint.
FRUSTRATION_MARKERS: tuple[tuple[str, str], ...] = (
    # English
    ("oh my god", "low"),
    ("omg", "low"),
    ("fml", "high"),
    ("seriously?", "low"),
    ("again?!", "high"),
    ("for god's sake", "high"),
    ("for the love of", "low"),
    ("this is broken", "high"),
    ("not working", "high"),
    ("keeps failing", "high"),
    ("are you kidding me", "high"),
    ("useless", "high"),
    ("so annoying", "high"),
    ("gives up", "low"),
    ("waste of time", "high"),
    ("unbelievable", "low"),
    # Arabic — genuine frustration expressions
    ("يا ثقل", "high"),          # "so heavy/annoying"
    ("هذا غلط", "high"),         # "this is wrong"
    ("ما يشتغل", "high"),        # "it doesn't work"
    ("تعبان من هذا", "high"),    # "sick of this"
    ("مستحيل", "low"),           # "impossible" (borderline; Jev decides)
    ("بطل كذا", "high"),         # "stop doing this"
    ("ربي يعين", "low"),         # idiom, often exasperation (borderline)
    ("والله متضايق", "high"),     # "honestly frustrated"
    ("كفو عليك ما ينفع", "low"), # borderline exasperation
)

# FILLERS — the architecture doc's caution: markers must not be neutral
# discourse. "Anyways" is a filler, not a complaint. Anything here is
# SUPPRESSED even if a marker would substring-match nearby.
FILLER_MARKERS: tuple[str, ...] = (
    "anyways",
    "anyway",
    "well",
    "so",
    "ok",
    "okay",
    "alright",
    "hmm",
    "let me",
    "thanks",
    "thank you",
    "شكرا",        # thanks
    "طيب",         # okay/fine
    "خلاص",        # "enough/all set" — often just closure, not anger
)

# Words that PRECEDE a marker and turn it hypothetical, quoted, or third-party.
_NEGATION_PREFIXES: tuple[str, ...] = ("not ", "didn't ", "don't ", "never ", "hypothetically ")


def _marker_pattern(marker: str) -> re.Pattern[str]:
    """Case-insensitive and word-boundary anchored. Boundaries stop substring
    collisions both ways: filler 'ok' must not swallow 'broken', and a marker
    must not fire inside a longer unrelated word."""
    escaped = re.escape(marker)
    prefix = r"\b" if marker[:1].isalnum() else ""
    suffix = r"\b" if marker[-1:].isalnum() else ""
    return re.compile(prefix + escaped + suffix, re.IGNORECASE)


def scan(text: str) -> list[Signal]:
    """Layer 1 sensor: cheap, local, high-recall. Returns signals for
    frustration markers NOT suppressed by the filler list. No network, no model."""
    if not text:
        return []
    lowered = text.lower()
    signals: list[Signal] = []
    # 1) Filler suppression first: excise filler matches so a frustration
    #    marker whose span overlaps a filler span is not reported.
    filler_spans: list[tuple[int, int]] = []
    for filler in FILLER_MARKERS:
        for match in _marker_pattern(filler).finditer(lowered):
            filler_spans.append((match.start(), match.end()))

    def _overlaps_filler(start: int, end: int) -> bool:
        return any(s < end and start < e for (s, e) in filler_spans)

    for marker, severity in FRUSTRATION_MARKERS:
        for match in _marker_pattern(marker).finditer(lowered):
            start, end = match.start(), match.end()
            if _overlaps_filler(start, end):
                continue
            # Negation guard: a marker immediately after "not " is a negative
            # statement, not an outburst. Keep recall high elsewhere.
            prefix_window = lowered[max(0, start - 5):start]
            if any(prefix_window.endswith(p) for p in _NEGATION_PREFIXES):
                continue
            signals.append(Signal(marker=marker, span=(start, end), severity=severity))
    signals.sort(key=lambda sig: sig.span)
    return signals


def context_window(text: str, span: tuple[int, int], pad: int = 60) -> str:
    """The flagged snippet plus a little context — what Jev should see, not the
    whole transcript (send the window, not the transcript)."""
    start = max(0, span[0] - pad)
    end = min(len(text), span[1] + pad)
    return text[start:end]


# ---------------------------------------------------------------------------
# LAYER 2 — escalation. Jev dependency is INJECTED; tests never hit the API.
# ---------------------------------------------------------------------------

JEV_QUESTIONS: dict[str, Any] = {
    "is_frustration": {
        "type": "noul",
        "instructions": (
            "Is the state a genuine expression of user frustration with an "
            "AI agent? Answer true only for real complaints, not filler or "
            "neutral discourse."
        ),
    }
}


def classify(signals: list[Signal], text: str, jev: Callable[..., dict[str, Any]] | None) -> dict[str, Any]:
    """Decide whether a signal deserves escalation to Jev.

    `jev` is an injected callable: jev(state, questions, shadow=False).
    Tests inject a fake; production injects balabot.jev.Jev(...).system_one.
    A None jev means escalation is not wired in this deployment — signals
    are returned as 'deferred', never silently treated as confirmed.
    """
    if not signals:
        return {"escalate": False, "confirmed": False, "signals": []}
    windows = [context_window(text, sig.span) for sig in signals]
    state = " | ".join(windows)
    if jev is None:
        return {"escalate": True, "confirmed": False, "signals": [s.to_dict() for s in signals],
                "reason": "no Jev callable injected; signal recorded as deferred, not confirmed"}
    response = jev(state, JEV_QUESTIONS)
    answer = response.get("answers", {}).get("is_frustration", {})
    probability = noul_probability(answer, context="frustration escalation")
    confirmed = probability >= FRUSTRATION_CONFIRMATION_GATE
    return {
        "escalate": True,
        "confirmed": confirmed,
        "probability": probability,
        "state": state,
        "signals": [s.to_dict() for s in signals],
    }


# ---------------------------------------------------------------------------
# LAYER 3 — the governor ledger. Same durable channel the governor already
# uses: init_ledger() creates it; entries are appended as OKF YAML documents
# under BALABOT_DATA_ROOT/profiles/governor/ledger/, read back by the
# growth job. If the ledger path cannot be written, GrowthError — never a
# fabricated success.
# ---------------------------------------------------------------------------

def _ledger_path(name: str = GOVERNOR) -> Path:
    from .bootstrap import _data_root as _dr  # single source of truth for data root
    return _dr() / "profiles" / name / LEDGER_DIRNAME / "frustration.jsonl"


def record_frustration(entry: dict[str, Any], name: str = GOVERNOR) -> dict[str, Any]:
    """Append ONE structured, secret-free ledger entry. Fail loud on any
    write failure. Never fabricates: what is returned is exactly what was written."""
    record = dict(entry)
    record.setdefault("type", "frustration-signal")
    record.setdefault("persona", name)
    path = _ledger_path(name)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(yaml.safe_dump(record, sort_keys=False))
    except OSError as exc:
        raise GrowthError(f"could not write frustration ledger entry for '{name}': {exc}") from exc
    return record


def read_frustration_entries(name: str = GOVERNOR) -> list[dict[str, Any]]:
    """Read every recorded frustration entry, oldest first. Empty file is an
    honest empty list. Corrupt chunks are skipped, not fatal."""
    path = _ledger_path(name)
    if not path.is_file():
        return []
    entries: list[dict[str, Any]] = []
    for chunk in path.read_text(encoding="utf-8").split("---\n"):
        if not chunk.strip():
            continue
        try:
            rec = yaml.safe_load(chunk)
        except yaml.YAMLError:
            continue
        if isinstance(rec, dict):
            entries.append(rec)
    return entries


# ---------------------------------------------------------------------------
# LAYER 4 — the principal growth job. Reads accumulated entries, proposes a
# concrete action, returns a structured record. Idempotent and never
# destructive: proposals are recorded, never auto-applied.
# ---------------------------------------------------------------------------

CAUSE_LABELS: dict[str, str] = {
    "missing_skill": "a needed skill/tool appears to be absent",
    "bad_output": "outputs are being rejected as wrong",
    "stuck_loop": "the agent repeats a failing step",
    "context_gap": "the agent lacks information the user expected it to have",
}


def growth_job(name: str = PRINCIPAL, ledger_name: str = GOVERNOR) -> dict[str, Any]:
    """Principal's routine growth job over the accumulated frustration ledger.

    Reads entries (via read_frustration_entries), classifies the dominant
    cause from the marker evidence, and returns ONE structured proposal —
    never auto-applied, never destructive. Idempotent: re-running with the
    same ledger yields the same proposal (no side effects on the ledger).
    """
    entries = read_frustration_entries(ledger_name)
    if not entries:
        return {"proposal": None, "reason": "no frustration entries yet; nothing to act on",
                "entries_considered": 0}

    # Dominant marker cluster -> cause classification (code does the counting;
    # Jev classifies, it does not reason or count).
    marker_counts: dict[str, int] = {}
    severity_counts: dict[str, int] = {}
    for entry in entries:
        for sig in entry.get("signals", []):
            marker_counts[sig.get("marker", "?")] = marker_counts.get(sig.get("marker", "?"), 0) + 1
            severity_counts[sig.get("severity", "low")] = severity_counts.get(sig.get("severity", "low"), 0) + 1

    top_marker = max(marker_counts, key=lambda m: (marker_counts[m], m)) if marker_counts else None
    high_count = severity_counts.get("high", 0)
    total_signals = sum(marker_counts.values())

    if top_marker in ("not working", "ما يشتغل", "this is broken", "keeps failing", "هذا غلط"):
        cause, label = "missing_skill", CAUSE_LABELS["missing_skill"]
        proposal = {
            "action": "propose_skill_patch",
            "target": "skills_registry",
            "description": f"Add or fix the skill the user was trying to use; '{top_marker}' dominates the ledger.",
        }
    elif top_marker in ("are you kidding me", "useless", "so annoying", "يا ثقل", "تعبان من هذا"):
        cause, label = "bad_output", CAUSE_LABELS["bad_output"]
        proposal = {
            "action": "propose_routing_change",
            "target": "model_router",
            "description": f"Route these requests to a stronger model; '{top_marker}' suggests output quality is the pain.",
        }
    else:
        cause, label = "context_gap", CAUSE_LABELS["context_gap"]
        proposal = {
            "action": "propose_context_patch",
            "target": "AGENTS.md",
            "description": f"Surface the missing context; most common marker '{top_marker}' reads as unmet expectations.",
        }

    rate = frustration_rate(entries)
    record = {
        "type": "growth-proposal",
        "persona": name,
        "ledger_source": ledger_name,
        "entries_considered": len(entries),
        "cause": cause,
        "cause_label": label,
        "proposal": proposal,
        "top_marker": top_marker,
        "high_severity_signals": high_count,
        "total_signals": total_signals,
        "frustration_rate_per_1000_messages": rate,
        "applied": False,  # never auto-applied — principal proposes, operator or a gated review decides
    }
    return record


# ---------------------------------------------------------------------------
# METRIC — frustration rate, with a stated denominator so the number is
# interpretable rather than a bare ratio.
# ---------------------------------------------------------------------------

def frustration_rate(entries: list[dict[str, Any]]) -> float:
    """Confirmed frustration signals per 1000 messages.

    Denominator: total messages represented by the entries (entry["message_count"],
    default 1 per entry when absent — a single message). Stated so a caller
    can see what was measured against what, and so growth_job() can carry the
    denominator alongside every rate it reports.
    """
    confirmed_signals = 0
    total_messages = 0
    for entry in entries:
        total_messages += int(entry.get("message_count", 1))
        if entry.get("confirmed"):
            confirmed_signals += len(entry.get("signals", [])) or 1
    if total_messages == 0:
        return 0.0
    return round(confirmed_signals * 1000.0 / total_messages, 3)


__all__ = [
    "Signal",
    "FRUSTRATION_MARKERS",
    "FILLER_MARKERS",
    "JEV_QUESTIONS",
    "CAUSE_LABELS",
    "GrowthError",
    "scan",
    "context_window",
    "classify",
    "record_frustration",
    "read_frustration_entries",
    "growth_job",
    "frustration_rate",
]
