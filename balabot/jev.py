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

import time
from typing import Any

import requests

SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-1.13.0"
DEFAULT_TIMEOUT_S = 5.0  # observed latency 70-500ms; 5s is generous
TRANSIENT_STATUSES = {429, 500, 502, 503, 504}
MAX_TRANSIENT_RETRIES = 2


class JevError(RuntimeError):
    """Base: Jev is a hard dependency; every failure here is fatal to the caller."""


class JevNotConfigured(JevError):
    """TYPESAFE_API_KEY missing. Fail loud — there is no fallback."""


class JevAPIError(JevError):
    """The API errored (HTTP or transport). Never silently degrade."""


class Jev:
    """Thin, faithful HTTP client for the System One endpoint."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = DEFAULT_MODEL,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        session: requests.Session | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else _env_key()
        if not self.api_key:
            raise JevNotConfigured(
                "TYPESAFE_API_KEY is not set. Jev is a hard dependency; "
                "there is no fallback provider."
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
        payload = {"model": self.model, "state": state, "questions": questions}
        response = self._post_with_transient_retry(payload)
        result: dict[str, Any] = response.json()
        if shadow:
            result["shadow"] = True
        return result

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
