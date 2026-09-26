"""Mutation check: prove the user-usage scenarios can actually FAIL.

    python tests/simulations/mutation_check.py

A green suite proves nothing until you show it goes RED when the behaviour it
claims to protect is broken. This breaks one documented BalaBot ability at a
time and asserts that the scenario guarding it fails.

If a mutation is NOT detected, that scenario is decorative — it passes
regardless of whether the product works, which is worse than having no test.

Deliberately NOT named test_*.py or sim_*.py: this file breaks the system on
purpose, so pytest must never collect it.
"""

from __future__ import annotations

import pathlib
import sys

_SIM_DIR = pathlib.Path(__file__).resolve().parent
_REPO_ROOT = _SIM_DIR.parent.parent
for _path in (str(_REPO_ROOT), str(_SIM_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import _user_harness as H  # noqa: E402
import sim_user_scenarios as S  # noqa: E402


def scenario(name: str):
    for candidate, _desc, fn in S.SCENARIOS:
        if candidate == name:
            return fn
    raise KeyError(f"no scenario named {name}")


def detected(name: str, mutate, restore) -> tuple[bool, str]:
    """Apply a mutation; the guarding scenario MUST fail. Then restore."""
    fn = scenario(name)
    mutate()
    try:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            return True, f"{type(exc).__name__}: {str(exc)[:90]}"
        return False, "scenario still passed — it does not test this"
    finally:
        restore()


results: list[tuple[str, bool, str]] = []

# --- 1. The decision gate fails CLOSED instead of open (a lost decision).
_orig_consider = H.Governor.consider


def _closed(self, decision, *, score=None):
    if score is None:
        try:
            self.jev.decide("is_decision_worthy", decision)
        except H.JevUnreachable:
            return False                      # MUTATION
    return _orig_consider(self, decision, score=score)


results.append(("gate fails closed instead of open", *detected(
    "decision_gate_fails_open",
    lambda: setattr(H.Governor, "consider", _closed),
    lambda: setattr(H.Governor, "consider", _orig_consider),
)))

# --- 2/3. The permission layer stops enforcing tiers entirely.
_orig_may = H.may

results.append(("permissions stop enforcing the hierarchy", *detected(
    "peer_creation_without_user_request_refused",
    lambda: setattr(H, "may", lambda actor, action, asked_by_user=False: None),
    lambda: setattr(H, "may", _orig_may),
)))

results.append(("principal allowed to read secrets", *detected(
    "principal_cannot_touch_secrets",
    lambda: setattr(H, "may", lambda actor, action, asked_by_user=False: None),
    lambda: setattr(H, "may", _orig_may),
)))

# --- 4. The roster stops routing (agents become silos).
_orig_resolve = H.Roster.resolve

results.append(("roster stops routing requests", *detected(
    "roster_routes_to_the_right_agent",
    lambda: setattr(H.Roster, "resolve", lambda self, request: None),
    lambda: setattr(H.Roster, "resolve", _orig_resolve),
)))

# --- 5. A skill is edited with no cause classification (scar tissue).
_orig_grow = H.Principal.grow


def _grow_nocause(self, signal, *, skill, change):
    self.skill_edits.append((skill, change))   # MUTATION: no cause gate
    return f"{skill}: {change}"


results.append(("skill edited without classifying the cause", *detected(
    "frustration_pipeline_end_to_end",
    lambda: setattr(H.Principal, "grow", _grow_nocause),
    lambda: setattr(H.Principal, "grow", _orig_grow),
)))

# --- 6. Injection screening disabled (retrieved content passes straight in).
_orig_injection = S.contains_prompt_injection

results.append(("prompt-injection screening disabled", *detected(
    "memory_poisoning_is_screened",
    lambda: setattr(S, "contains_prompt_injection", lambda text: False),
    lambda: setattr(S, "contains_prompt_injection", _orig_injection),
)))

# --- 7. Jev silently degrades on outage instead of failing loud.
_orig_decide = H.JevStub.decide


def _silent(self, question, state=None):
    try:
        return _orig_decide(self, question, state)
    except H.JevUnreachable:
        return H.Decision("unknown", 0.0)      # MUTATION: mask the outage


results.append(("Jev silently degrades on outage", *detected(
    "jev_outage_stops_the_growth_loop_loudly",
    lambda: setattr(H.JevStub, "decide", _silent),
    lambda: setattr(H.JevStub, "decide", _orig_decide),
)))

# --- 8. Sub-agents lose ledger access (the shared channel closes).
_orig_read = H.Governor.read


def _read_sub_locked(self, actor):
    if actor.tier == H.SUB:
        raise H.PermissionDenied("sub-agents may not read the ledger")
    return _orig_read(self, actor)


results.append(("sub-agents locked out of the ledger", *detected(
    "ledger_is_okf_and_shared_with_subagents",
    lambda: setattr(H.Governor, "read", _read_sub_locked),
    lambda: setattr(H.Governor, "read", _orig_read),
)))


def main() -> int:
    print("=" * 72)
    print("BalaBot — mutation check: can the user-usage scenarios fail?")
    print("=" * 72)
    for label, ok, detail in results:
        print(f"{'DETECTED' if ok else 'MISSED  '}  {label}")
        print(f"            {detail}")

    missed = [entry for entry in results if not entry[1]]
    print()
    if missed:
        print(f"RESULT: {len(results) - len(missed)}/{len(results)} mutations detected — "
              f"{len(missed)} scenario(s) are DECORATIVE, fix them")
        return 1
    print(f"RESULT: {len(results)}/{len(results)} mutations detected — "
          "every scenario genuinely fails when its ability breaks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
