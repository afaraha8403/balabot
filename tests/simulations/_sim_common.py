"""Shared harness for BalaBot architecture simulations.

Each simulation proves ONE hard architectural promise. Conventions:

- Every assertion is reported as a per-check PASS/FAIL line.
- A failed check raises `SimFailure` with a message naming WHICH promise broke.
- Standalone: `python tests/simulations/<name>.py` exits non-zero on any FAIL.
- Under pytest: every scenario exposes a `test_scenario()` function.
- No network. No keys. Deterministic. Stdlib only (plus the package under test).
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

# Make the repo root (and this directory) importable regardless of how the
# simulation is launched: standalone, pytest, or from another cwd.
_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parent.parent
for _p in (str(_HERE), str(_REPO_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


class SimFailure(AssertionError):
    """One architectural promise did not hold. The message names it."""


class _Scenario:
    def __init__(self, name: str) -> None:
        self.name = name
        self.failures: list[str] = []
        self.checks = 0

    def check(self, promise: str, fn, *args, **kwargs):
        """Run one check; print PASS/FAIL naming the promise under test.

        Check functions come in two shapes in this suite: `def check_x()` and
        `def check_x(s)` where `s` is this scenario. Pass the scenario only when
        the callable actually declares a parameter, so both conventions work and
        neither fails with a confusing "missing 1 required positional argument".
        """
        self.checks += 1
        call_args = args
        if not args and not kwargs:
            try:
                import inspect

                if len(inspect.signature(fn).parameters) == 1:
                    call_args = (self,)
            except (TypeError, ValueError):  # builtins / C callables: call as-is
                pass
        try:
            fn(*call_args, **kwargs)
        except (SimFailure, AssertionError) as exc:
            self.failures.append(f"{promise}: {exc}")
            print(f"FAIL  [{self.name}] {promise}\n      -> {exc}")
        except Exception as exc:  # unexpected error is also a broken promise
            self.failures.append(f"{promise}: unexpected {type(exc).__name__}: {exc}")
            print(f"FAIL  [{self.name}] {promise}\n      -> unexpected {type(exc).__name__}: {exc}")
        else:
            print(f"PASS  [{self.name}] {promise}")


def expect(cond: bool, message: str) -> None:
    if not cond:
        raise SimFailure(message)


def finish(scenario: _Scenario) -> int:
    """Print the verdict block and return the process exit code."""
    total = scenario.checks
    failed = len(scenario.failures)
    print("-" * 72)
    if failed:
        print(f"RESULT: {scenario.name}: {total - failed}/{total} checks PASSED, "
              f"{failed} FAILED — architectural promise BROKEN")
        for f in scenario.failures:
            print(f"  BROKEN PROMISE: {f}")
        return 1
    print(f"RESULT: {scenario.name}: {total}/{total} checks PASSED — architecture holds")
    return 0


def run_main(scenario: _Scenario) -> None:
    code = finish(scenario)
    raise SystemExit(code)


def pytest_report(scenario: _Scenario) -> None:
    """Used by the `test_scenario()` wrappers: re-raise the first failure for pytest."""
    if scenario.failures:
        raise AssertionError(
            f"{scenario.name}: {len(scenario.failures)} broken promise(s):\n"
            + "\n".join(f"- {f}" for f in scenario.failures)
        )
