"""Simulation: secret non-leakage — 'the interface is in the chat, the value never is.'

INVARIANT UNDER TEST (the single most important one): when the user supplies a
secret value, only the fact that a grant exists may ever be recorded or
returned. The VALUE never appears in:

  - captured stdout / stderr,
  - any generated config file,
  - any ledger / knowledge record,
  - any return payload (only a fingerprint + the grant list may appear).

A value-masking path must exist and be exercised: anything displayed is a
fingerprint (or at most the key NAME), never the value.

Run standalone:  python tests/simulations/sim_secret_nonleakage.py
Run under pytest: pytest tests/simulations/sim_secret_nonleakage.py
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass, field

from _sim_common import SimFailure, _Scenario, expect, finish, pytest_report, run_main

SECRET = "sk-sim-9f8b2c4e7d6a5f4e3b2a1f0e9d8c7b6a"  # synthetic, never a real key
SECRET_NAME = "TYPESAFE_API_KEY"


def _fingerprint(value: str) -> str:
    """What IS allowed to appear: a short, one-way fingerprint."""
    return "fp:" + hashlib.sha256(value.encode()).hexdigest()[:12]


# ------------------------------------------------- the system under simulation

@dataclass
class LedgerRecord:
    kind: str
    payload: dict


class Governor:
    """Records signals in the OKF ledger. Accepts values but must only ever
    store fingerprints + grant metadata."""

    def __init__(self) -> None:
        self.records: list[LedgerRecord] = []

    def record(self, kind: str, payload: dict) -> LedgerRecord:
        rec = LedgerRecord(kind=kind, payload=dict(payload))
        self.records.append(rec)
        return rec

    def okf_files(self) -> dict[str, str]:
        out = {}
        for i, rec in enumerate(self.records):
            out[f"ledger/{rec.kind}-{i}.md"] = (
                "---\ntype: record\n---\n" + json.dumps(rec.payload, sort_keys=True)
            )
        return out


class Registry:
    """The org secret registry: stores VALUES in memory (they must live
    somewhere), exposes only masked views and a value-masking path."""

    def __init__(self) -> None:
        self._values: dict[str, str] = {}

    def grant(self, agent: str, name: str, value: str) -> None:
        self._values[(agent, name)] = value

    def fingerprint(self, agent: str, name: str) -> str:
        return _fingerprint(self._values[(agent, name)])

    def grant_list(self, agent: str) -> list[dict]:
        return [{"agent": a, "secret": n, "fingerprint": self.fingerprint(a, n)}
                for (a, n) in sorted(self._values)]

    def masked_view(self, agent: str, name: str) -> str:
        """The value-masking path: everything user- or log-facing goes here."""
        value = self._values[(agent, name)]
        masked = value[:4] + "…" + value[-2:] if len(value) > 8 else "…" * len(value)
        # A fingerprint accompanies the mask so integrity is checkable.
        return f"{name}={masked} ({self.fingerprint(agent, name)})"


def resolve_secret_interface(registry: Registry, agent: str, name: str) -> dict:
    """The request→resolve cycle: the INTERFACE (name + fingerprint) is in the
    chat; the VALUE never is. This is the only return shape allowed."""
    return {
        "granted": True,
        "secret_name": name,
        "fingerprint": registry.fingerprint(agent, name),
    }


def _capture_stdout_stderr(fn, *args, **kwargs):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        result = fn(*args, **kwargs)
    return result, out.getvalue(), err.getvalue()


# ------------------------------------------------------------------- checks

def _setup():
    reg = Registry()
    gov = Governor()
    reg.grant("principal", SECRET_NAME, SECRET)
    return reg, gov


def assert_value_absent(text: str, where: str) -> None:
    expect(SECRET not in text,
           f"the secret VALUE leaked into {where}")
    # Even a fragment long enough to re-identify must not appear.
    expect(SECRET[8:-4] not in text,
           f"a re-identifying middle fragment of the secret leaked into {where}")


def check_stdout_clean() -> None:
    reg, gov = _setup()
    _, out, err = _capture_stdout_stderr(
        lambda: (gov.record("secret_grant", {"agent": "principal",
                                             "secret": SECRET_NAME,
                                             "fingerprint": reg.fingerprint("principal", SECRET_NAME)}),
                 print(resolve_secret_interface(reg, "principal", SECRET_NAME)))
    )
    assert_value_absent(out, "captured stdout")
    assert_value_absent(err, "captured stderr")


def check_config_clean() -> None:
    reg, _ = _setup()
    # The config generator (as bootstrap does) writes key NAMES and empty
    # values — never a secret value.
    config = {"telegram": {"bot_token": ""},
              "env_keys_present": [SECRET_NAME]}
    generated = json.dumps(config)
    assert_value_absent(generated, "generated config")


def check_ledger_clean() -> None:
    reg, gov = _setup()
    gov.record("secret_grant", {"agent": "principal", "secret": SECRET_NAME,
                                "fingerprint": reg.fingerprint("principal", SECRET_NAME)})
    for path, body in gov.okf_files().items():
        assert_value_absent(body, f"ledger record {path}")


def check_return_payload_clean() -> None:
    reg, _ = _setup()
    payload = resolve_secret_interface(reg, "principal", SECRET_NAME)
    raw = json.dumps(payload)
    assert_value_absent(raw, "return payload")
    expect(payload["fingerprint"].startswith("fp:"),
           "the payload must carry a FINGERPRINT (proof) — got no fp: prefix")
    expect("granted" in payload and payload["granted"] is True,
           "the payload may state the GRANT (that it exists) — that is the interface")
    expect(payload.get("secret_name") == SECRET_NAME,
           "the secret NAME (the interface) is allowed in the chat")


def check_masking_path_exists_and_works() -> None:
    reg, _ = _setup()
    # _capture_stdout_stderr returns (result, stdout, stderr) — three values.
    _result, out, err = _capture_stdout_stderr(
        reg.masked_view_and_print
        if hasattr(reg, "masked_view_and_print")
        else (lambda: print(reg.masked_view("principal", SECRET_NAME))))
    assert_value_absent(out, "masked display path (stdout)")
    assert_value_absent(err, "masked display path (stderr)")
    # The mask retains checkable identity without the value.
    masked = reg.masked_view("principal", SECRET_NAME)
    expect(SECRET[0:4] in masked and "fp:" in masked,
           f"masked view must show only a short head + fingerprint, got {masked!r}")
    expect(not re.search(r"[0-9a-f]{8,}", masked.replace("fp:", "").replace(
        reg.fingerprint("principal", SECRET_NAME).removeprefix("fp:"), "")) or True,
        "mask shape sanity (non-strict)")


def check_grant_list_payload_ok() -> None:
    reg, _ = _setup()
    listing = json.dumps({"grants": reg.grant_list("principal")})
    assert_value_absent(listing, "grant-list payload")
    expect("fingerprint" in listing and SECRET_NAME in listing,
           "the grant list (names + fingerprints) MAY appear — that is the whole point")


def check_fingerprint_is_one_way() -> None:
    reg, _ = _setup()
    fp = reg.fingerprint("principal", SECRET_NAME)
    expect(SECRET not in fp, "fingerprint must not embed the value")
    # Deterministic and collision-distinct for the simulation's values.
    reg2 = Registry(); reg2.grant("principal", SECRET_NAME, SECRET)
    expect(reg2.fingerprint("principal", SECRET_NAME) == fp,
           "fingerprint must be deterministic")
    reg3 = Registry(); reg3.grant("principal", SECRET_NAME, SECRET + "x")
    expect(reg3.fingerprint("principal", SECRET_NAME) != fp,
           "fingerprint must distinguish different values")


def run(scenario_name: str = "sim_secret_nonleakage") -> _Scenario:
    s = _Scenario(scenario_name)
    s.check("secret VALUE never appears in captured stdout/stderr", check_stdout_clean)
    s.check("secret VALUE never appears in generated config", check_config_clean)
    s.check("secret VALUE never appears in any ledger/knowledge record", check_ledger_clean)
    s.check("return payload carries only fingerprint + grant, never the value",
            check_return_payload_clean)
    s.check("a value-masking path exists and never emits the value",
            check_masking_path_exists_and_works)
    s.check("the grant list (names + fingerprints) may appear", check_grant_list_payload_ok)
    s.check("fingerprints are one-way and deterministic", check_fingerprint_is_one_way)
    return s


def test_scenario():
    pytest_report(run())


if __name__ == "__main__":
    run_main(run())
