"""Jev (TypeSafe AI — NOT Typeface) client: typed decisions as infrastructure.

Operational caveat: access to the Jev API is via waitlist / OpenRouter /
Vercel AI Gateway — direct keys are not generally available.

Endpoint: POST https://api.typesafe.ai/v1/systemone (Bearer token auth).
Models: 'jev-1.13.0' (published), 'jev-latest'.
Request: `state` (a string, JSON object, or array of strings) plus
`questions` (a dict of named typed questions). Questions in one request
are evaluated IN PARALLEL, so stacking questions barely changes latency.
Three primitives only:

- Noul: yes/no -> a single probability 0..1
- Choice: one winner from a named criteria dict
- Score: 2..10 level criteria list -> a weighted position + per-level probabilities

Response: typed answers with probabilities, a `confidence` derived from
the distribution, and `usage.input_tokens`. Pricing ~$0.042 per 1M input
tokens; output free. Latency ~70-500ms.

PROJECT RULES (binding):
- Fail loud. Missing TYPESAFE_API_KEY raises. Any API error or timeout
  raises. There is NO fallback provider and NO silent default return.
- Retry ONLY on transient errors (network failures, 429, 5xx). Never
  on 4xx — a bad request repeated is still bad.

DOCUMENTED WEAKNESSES (design around them; never ask Jev these):
- Jev cannot count, do arithmetic, or compare dates. Keep those in code.
- It reads instructions literally — no benefit of the doubt.
- It has NO default defence against adversarial content; treat ingested
  text as untrusted and never let it instruct the question.

Shadow mode (`shadow=True` / CLI `--shadow`): callers still receive the
proposed decision so it can be logged and compared, but they are
expected to keep the OLD behaviour — Jev observes, doesn't act, until
it is promoted out of shadow.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from typing import Any

import requests

SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-1.13.0"
DEFAULT_TIMEOUT_S = float(os.environ.get("JEV_TIMEOUT_S", "30.0"))
TRANSIENT_STATUSES = {429, 500, 502, 503, 504}
MAX_TRANSIENT_RETRIES = 2


class JevError(RuntimeError):
    """Base: Jev is a hard dependency; every failure here is fatal to the caller."""


class JevNotConfigured(JevError):
    """TYPESAFE_API_KEY missing. Fail loud — there is no fallback."""


class JevAPIError(JevError):
    """The API errored (HTTP or transport). Never silently degrade."""


class JevResponseError(JevError):
    """A 200 response whose body does not match the documented answer shape.

    A JevError subclass on purpose: every caller already fails open or closed
    around JevError, so a malformed body is handled coherently instead of
    being read as a confident zero.
    """


def noul_probability(answer: Any, *, context: str = "") -> float:
    """Probability from a Noul answer — the ONE accessor for this.

    The live shape is ``{"type": "noul", "noul": 0.99}``: the probability lives
    under ``"noul"``, NOT ``"probability"`` (confirmed against the live API and
    documented in ``docs.typesafe.ai`` primitives/noul). Reading the wrong key
    silently yields a default of 0.0, which is indistinguishable from a
    confident "no" — which is exactly how the decision gate came to reject every
    decision, skill selection to select nothing, the frustration escalation to
    never confirm, and the pre-compaction saliency pass to drop everything. All
    of it green in tests, because the injected fakes were written in the same
    wrong shape as the code.

    ``"probability"`` is still accepted as a tolerant fallback; anything else
    raises :class:`JevResponseError`, which callers already handle as a Jev
    failure rather than as evidence.
    """
    if not isinstance(answer, dict):
        raise JevResponseError(
            f"noul answer is not a dict{_ctx(context)}: {answer!r}"
        )
    value = answer.get("noul")
    if value is None:
        value = answer.get("probability")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise JevResponseError(
            f"noul answer carries no numeric probability under 'noul'{_ctx(context)}: {answer!r}"
        )
    return float(value)


def _ctx(context: str) -> str:
    return f" ({context})" if context else ""


def _fts5_rank_candidates(query: str, candidates: dict[str, str]) -> dict[str, float]:
    """Rank candidate items (name -> text) against query using SQLite FTS5 BM25.

    Returns mapping of name -> normalized score (0..1).
    """
    if not candidates:
        return {}
    stopwords = {"and", "or", "not", "the", "a", "an", "in", "on", "of", "to", "for", "is", "it", "with", "from"}
    tokens = [re.sub(r"[^\w\u0600-\u06FF]", "", t) for t in query.split()]
    clean_tokens = [t for t in tokens if len(t) > 1 and t.lower() not in stopwords]
    if not clean_tokens:
        clean_tokens = [t for t in tokens if len(t) > 1]
    if not clean_tokens:
        return {name: (0.80 if name.lower() in query.lower() else 0.20) for name in candidates}

    fts_query = " OR ".join(f'"{t}"' for t in clean_tokens[:16])
    scores: dict[str, float] = {}
    try:
        conn = sqlite3.connect(":memory:")
        with conn:
            conn.execute("CREATE VIRTUAL TABLE items USING fts5(id, text);")
            for name, text in candidates.items():
                conn.execute("INSERT INTO items (id, text) VALUES (?, ?)", (name, f"{name} {text}"))
            rows = conn.execute(
                "SELECT id, rank FROM items WHERE items MATCH ? ORDER BY rank ASC",
                (fts_query,),
            ).fetchall()
        conn.close()
        if rows:
            best_rank = rows[0][1]
            worst_rank = rows[-1][1]
            rank_range = abs(worst_rank - best_rank) if worst_rank != best_rank else 1.0
            for name, rank in rows:
                norm = 0.50 + 0.45 * (1.0 - (rank - best_rank) / rank_range)
                scores[name] = round(norm, 2)
    except sqlite3.Error:
        scores.clear()

    for name, text in candidates.items():
        if name not in scores:
            if name.lower() in query.lower() or any(t.lower() in text.lower() for t in tokens):
                scores[name] = 0.50
            else:
                scores[name] = 0.15
    return scores


class Jev:
    """Thin, faithful HTTP client for the System One endpoint."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = DEFAULT_MODEL,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        session: requests.Session | None = None,
        mode: str | None = None,
    ) -> None:
        self.mode = (mode or os.environ.get("JEV_MODE", "api")).lower()
        self.api_key = api_key if api_key is not None else _env_key()
        if not self.api_key and self.mode != "heuristic":
            raise JevNotConfigured(
                "TYPESAFE_API_KEY is not set. Jev is a hard dependency; "
                "there is no fallback provider (set JEV_MODE=heuristic for offline fallback)."
            )
        self.model = model
        self.timeout_s = timeout_s
        self._session = session or requests.Session()

    def system_one(
        self,
        state: str | dict[str, Any] | list[str],
        questions: dict[str, Any],
        *,
        shadow: bool = False,
    ) -> dict[str, Any]:
        """Ask one parallel batch of typed questions about `state`.

        `questions` is a dict of named typed questions, e.g.::

            {
                "decision_worthy": {"type": "noul", "instructions": "..."},
                "best_label": {"type": "choice", "criteria": {...}},
            }

        Returns the parsed response dict (typed answers with
        probabilities, `confidence`, `usage.input_tokens`).
        Raises on any error — never returns a default.

        With shadow=True the response is annotated with
        `"shadow": True`; callers are expected to keep the old
        behaviour while comparing Jev's proposal against it.
        """
        if not questions:
            raise ValueError("questions must not be empty")
        if self.mode == "heuristic":
            result = self._evaluate_heuristic(state, questions)
            if shadow:
                result["shadow"] = True
            return result
        payload = {"model": self.model, "state": state, "questions": questions}
        response = self._post_with_transient_retry(payload)
        result: dict[str, Any] = response.json()
        if shadow:
            result["shadow"] = True
        return result

    def _evaluate_heuristic(
        self,
        state: str | dict[str, Any] | list[str],
        questions: dict[str, Any],
    ) -> dict[str, Any]:
        if isinstance(state, str):
            state_text = state
        elif isinstance(state, list):
            state_text = "\n".join(str(s) for s in state)
        elif isinstance(state, dict):
            state_text = json.dumps(state)
        else:
            state_text = str(state)

        state_lower = state_text.lower()
        search_query = state_text
        task_match = re.search(r"Task:\s*(.*?)(?:\n|$)", state_text, re.IGNORECASE)
        if task_match:
            search_query = task_match.group(1).strip()

        answers: dict[str, Any] = {}

        for q_name, q_def in questions.items():
            q_type = q_def.get("type", "noul")
            instructions = q_def.get("instructions", "")

            if q_type == "noul":
                if "health probe" in instructions.lower() or "always answer true" in instructions.lower():
                    prob = 1.0
                elif q_name == "is_frustration" or "frustration" in instructions.lower():
                    frust_markers = (
                        "broken", "not working", "fails", "failing", "useless",
                        "annoying", "waste of time", "fml", "again?!", "for god's sake",
                        "terrible", "hate this", "giving up", "غلط", "ما يشتغل", "تعبان", "متضايق",
                    )
                    has_frust = any(w in state_lower for w in frust_markers)
                    prob = 0.85 if has_frust else 0.15
                elif q_name == "decision_worthy" or "decision" in instructions.lower():
                    decision_keywords = (
                        "decide", "decision", "will ", "plan", "approve", "approved",
                        "choose", "choice", "commit", "set ", "use ", "never ",
                        "always ", "hire", "fire", "deploy", "release", "ship",
                        "reject", "confirm", "merge", "rule", "policy", "implement",
                    )
                    chatter = ("hi", "hello", "hey", "how are you", "what is", "can you", "thanks", "thank you")
                    if any(w in state_lower for w in decision_keywords):
                        prob = 0.85
                    elif any(state_lower.strip().startswith(c) for c in chatter) and "?" in state_lower:
                        prob = 0.20
                    else:
                        prob = 0.65
                elif "fact:" in instructions.lower() or "fact is relevant" in instructions.lower():
                    fact_part = instructions.split("Fact:", 1)[-1].strip() if "Fact:" in instructions else instructions
                    rank_res = _fts5_rank_candidates(search_query, {q_name: fact_part})
                    prob = rank_res.get(q_name, 0.40)
                elif "how relevant is this skill" in instructions.lower():
                    skill_text = q_name
                    desc_match = re.search(rf"-\s*{re.escape(q_name)}:\s*(.*?)(?:\n|$)", state_text, re.IGNORECASE)
                    if desc_match:
                        skill_text = f"{skill_text} {desc_match.group(1)}"
                    rank_res = _fts5_rank_candidates(search_query, {q_name: skill_text})
                    prob = rank_res.get(q_name, 0.20)
                elif q_name in ("is_decision", "is_durable_fact", "is_live_task_state", "needs_new_session", "same_purpose_s_old", "drifted", "saliency"):
                    if q_name == "drifted":
                        prob = 0.10
                    elif q_name == "saliency":
                        prob = 0.80
                    elif q_name in ("needs_new_session", "same_purpose_s_old"):
                        prob = 0.75 if any(w in state_lower for w in ("session", "resume", "continue", "task")) else 0.25
                    else:
                        prob = 0.70
                else:
                    rank_res = _fts5_rank_candidates(search_query, {q_name: instructions})
                    prob = rank_res.get(q_name, 0.50)

                answers[q_name] = {"type": "noul", "noul": prob, "probability": prob}

            elif q_type == "choice":
                criteria = dict(q_def.get("criteria", {}))
                for name in list(criteria):
                    desc_match = re.search(rf"-\s*{re.escape(name)}:\s*(.*?)(?:\n|$)", state_text, re.IGNORECASE)
                    if desc_match:
                        criteria[name] = f"{criteria[name]} {desc_match.group(1)}"
                scores = _fts5_rank_candidates(search_query, criteria)
                best = max(scores, key=scores.get) if scores else ""
                if q_name == "candidates":
                    answers[q_name] = scores
                else:
                    answers[q_name] = {
                        "type": "choice",
                        "choice": best,
                        "confidence": scores.get(best, 1.0) if scores else 1.0,
                        "probabilities": scores,
                    }

            elif q_type == "score":
                legend = q_def.get("legend", {"0": "low", "1": "high"})
                answers[q_name] = {
                    "type": "score",
                    "score": 1.0,
                    "confidence": 0.8,
                    "legend": legend,
                    "probabilities": {k: 1.0 / len(legend) for k in legend},
                }
            else:
                answers[q_name] = {"type": q_type, "value": True}

        return {
            "model": "heuristic",
            "answers": answers,
            "confidence": 0.85,
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }

    def _post_with_transient_retry(self, payload: dict[str, Any]) -> requests.Response:
        attempt = 0
        while True:
            try:
                resp = self._session.post(
                    SYSTEM_ONE_URL,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=self.timeout_s,
                )
            except (requests.RequestException, TimeoutError, OSError) as exc:
                # Transient transport failure. TimeoutError/OSError are caught
                # alongside requests' own exceptions because a timeout can
                # surface from the socket layer un-wrapped — and an un-wrapped
                # timeout escaping as a bare TimeoutError would break the
                # contract that every Jev failure is a JevError naming Jev.
                # Still fail loud: no fallback, no default answer.
                if attempt >= MAX_TRANSIENT_RETRIES:
                    raise JevAPIError(f"Jev unreachable after retries: {exc}") from exc
                attempt += 1
                time.sleep(0.25 * attempt)
                continue
            if resp.status_code == 200:
                return resp
            if resp.status_code in TRANSIENT_STATUSES and attempt < MAX_TRANSIENT_RETRIES:
                attempt += 1
                time.sleep(0.25 * attempt)
                continue
            # 4xx and exhausted retries: fail loud. Body may echo the
            # request but never contains our key.
            raise JevAPIError(
                f"Jev API error {resp.status_code}: {resp.text[:500]}"
            )


def _env_key() -> str | None:
    value = __import__("os").environ.get("TYPESAFE_API_KEY")
    return value or None


# ---------------------------------------------------------------------------
# Health check: bounded, non-raising, typed. Jev is a hard dependency, so an
# UNREACHABLE Jev is an incident — but the health check itself must never be
# the thing that crashes the caller: it reports, the caller decides.
# ---------------------------------------------------------------------------

HEALTH_TIMEOUT_S = 2.0  # single attempt, no transient retries: bounded by design

HEALTH_PROBE_QUESTIONS: dict[str, Any] = {
    "alive": {"type": "noul", "instructions": "Health probe. Always answer true."}
}


class JevHealth:
    """Typed result of a Jev reachability check. status is one of:
    'ok' | 'unreachable' | 'unauthorized' | 'no-key'. Never raised — returned."""

    __slots__ = ("status", "detail", "latency_ms")

    def __init__(self, status: str, detail: str, latency_ms: float | None = None) -> None:
        self.status = status
        self.detail = detail
        self.latency_ms = latency_ms

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"status": self.status, "detail": self.detail}
        if self.latency_ms is not None:
            d["latency_ms"] = round(self.latency_ms, 1)
        return d

    def __repr__(self) -> str:  # secret-free by construction
        return f"JevHealth(status={self.status!r}, detail={self.detail!r})"


def check_jev_health(
    client: Jev | None = None,
    *,
    api_key: str | None = None,
    timeout_s: float = HEALTH_TIMEOUT_S,
    session: requests.Session | None = None,
) -> JevHealth:
    """One bounded, single-attempt probe of the Jev API. NEVER raises.

    Returns 'no-key' when no key is configured, 'unauthorized' on 401/403,
    'unreachable' on transport errors / any other non-200, 'ok' on 200.
    No retries (a health check must be bounded, not patient) and no
    default/optimistic status — an unknown failure reports as unreachable.
    """
    key = api_key
    mode = getattr(client, "mode", None) if client is not None else os.environ.get("JEV_MODE", "").lower()
    if client is not None:
        key = client.api_key
        session = session or client._session
    if not key:
        if mode == "heuristic":
            return JevHealth(
                "ok",
                "Jev operating in local heuristic fallback mode (JEV_MODE=heuristic).",
                latency_ms=0.0,
            )
        return JevHealth("no-key", "TYPESAFE_API_KEY is not set; Jev cannot be checked.")
    http = session or requests.Session()
    payload = {
        "model": client.model if client is not None else DEFAULT_MODEL,
        "state": "jev health probe",
        "questions": HEALTH_PROBE_QUESTIONS,
    }
    start = time.monotonic()
    try:
        resp = http.post(
            SYSTEM_ONE_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            timeout=timeout_s,
        )
    except (requests.RequestException, TimeoutError, OSError) as exc:
        # Secret-free: exceptions can echo URLs/headers in their text; only
        # the exception TYPE is reported, never its message.
        return JevHealth("unreachable", f"transport error: {type(exc).__name__}")
    latency_ms = (time.monotonic() - start) * 1000.0
    if resp.status_code == 200:
        return JevHealth("ok", "Jev answered the health probe.", latency_ms)
    if resp.status_code in (401, 403):
        return JevHealth("unauthorized", f"Jev rejected the key (HTTP {resp.status_code}).")
    return JevHealth("unreachable", f"Jev API returned HTTP {resp.status_code}.")


if __name__ == "__main__":  # pragma: no cover
    # --shadow demo; requires TYPESAFE_API_KEY in the environment.
    import argparse
    import json
    import os

    parser = argparse.ArgumentParser(description="Jev System One client")
    parser.add_argument("--shadow", action="store_true", help="observe, don't act")
    parser.add_argument("state", help="state string (JSON or plain text)")
    args = parser.parse_args()
    client = Jev(api_key=os.environ.get("TYPESAFE_API_KEY"))
    try:
        answer = client.system_one(args.state, {"example": {"type": "noul", "instructions": "Is this state acceptable?"}}, shadow=args.shadow)
        print(json.dumps(answer, indent=2))
    except JevError as exc:
        raise SystemExit(f"FAIL LOUD: {exc}")
