"""Tests for balabot.bot_tools — bot-facing org tools.

The security invariant under test: a bot can never obtain a secret VALUE
through any tool, for any input.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

from balabot import bot_tools, orgs

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture
def org_env(tmp_path, monkeypatch):
    """Isolated BALABOT_DATA_ROOT + a small registry with two orgs and one
    secret whose real value we hold ONLY in this test process."""
    data_root = tmp_path / "data"
    data_root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))

    SECRET_VALUE = "sk-live-DoNotLeak-9f2a!xYz"
    orgs.add_org("balacode", "Balacode", members=["steve", "jim"])
    orgs.add_org("acme", "Acme", members=["oscar"])
    orgs.store_secret("STRIPE_SECRET_KEY", "balacode", SECRET_VALUE)
    orgs.register_secret("AWS_KEY", "balacode", description="aws key")
    orgs.grant("steve", {"kind": "secret", "name": "STRIPE_SECRET_KEY"},
               subject_org="balacode")
    orgs.grant("jim", {"kind": "secret", "name": "AWS_KEY", "org": "balacode"},
               subject_org="acme")  # cross-org grant
    return {"data_root": data_root, "secret_value": SECRET_VALUE}


# ---- request_secret --------------------------------------------------------


def test_request_secret_records_pending(org_env):
    out = bot_tools.request_secret("SLACK_TOKEN", "bot posts to slack",
                                   bot_id="steve")
    assert out == {"requested": True, "name": "SLACK_TOKEN",
                   "description": "bot posts to slack",
                   "status": "awaiting_user"}
    pending = bot_tools.list_pending_requests("steve")
    assert len(pending) == 1
    assert pending[0]["kind"] == "secret_request"
    assert pending[0]["status"] == "awaiting_user"


def test_request_secret_rejects_value_kwarg(org_env):
    with pytest.raises(ValueError, match="value"):
        bot_tools.request_secret("SLACK_TOKEN", value="super-secret")
    # nothing recorded
    assert bot_tools.list_pending_requests() == []


def test_request_secret_requires_name(org_env):
    with pytest.raises(ValueError):
        bot_tools.request_secret("")


# ---- list_org_secrets ------------------------------------------------------


def test_list_org_secrets_metadata_only(org_env):
    rows = bot_tools.list_org_secrets("steve")
    assert any(r["name"] == "STRIPE_SECRET_KEY" and r["granted"]
               and r["origin_org"] == "balacode" for r in rows)
    assert any(r["name"] == "AWS_KEY" and not r["granted"] for r in rows)
    # fingerprint shape only: '…' + last 4
    stripe = next(r for r in rows if r["name"] == "STRIPE_SECRET_KEY")
    assert stripe["fingerprint"] == "…" + org_env["secret_value"][-4:]


def test_list_org_secrets_cross_org_labelled(org_env):
    rows = bot_tools.list_org_secrets("jim")
    aws = next(r for r in rows if r["name"] == "AWS_KEY")
    assert aws["granted"] is True
    assert aws["origin_org"] == "balacode"  # jim is in acme


# ---- request_secret_access -------------------------------------------------


def test_request_secret_access_records_no_grant(org_env):
    before = len(orgs.grants_for("oscar", kind="secret"))
    out = bot_tools.request_secret_access("oscar", "STRIPE_SECRET_KEY",
                                          "needs payments")
    assert out["requested"] is True
    assert out["status"] == "awaiting_user"
    assert len(orgs.grants_for("oscar", kind="secret")) == before  # no grant
    pending = bot_tools.list_pending_requests("oscar")
    assert pending[0]["kind"] == "secret_access_request"
    assert pending[0]["reason"] == "needs payments"


# ---- list_org_skills -------------------------------------------------------


def test_list_org_skills_no_registry_is_honest(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    data_root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    out = bot_tools.list_org_skills("steve")
    assert out["skills"] == []
    assert "not found" in out["reason"] or "not set up" in out["reason"]


def test_list_org_skills_from_grants(org_env, tmp_path):
    orgs.grant("steve", {"kind": "skill", "name": "demo-skill"},
               subject_org="balacode")
    out = bot_tools.list_org_skills("steve")
    assert out == [{"name": "demo-skill", "scope": "bot", "origin": "balacode"}]


# ---- THE security invariant -----------------------------------------------


def _all_json_strings(obj) -> list[str]:
    out = []
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            out.append(str(k))
            out.extend(_all_json_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_all_json_strings(v))
    return out


def test_no_tool_ever_returns_secret_value(org_env):
    """For every tool and a battery of inputs, the literal secret value and a
    distinctive substring of it must appear NOWHERE in any return."""
    SECRET = org_env["secret_value"]
    substring = "DoNotLeak"

    results = []
    results.append(bot_tools.request_secret("NEW_NAME", "desc", bot_id="steve"))
    results.append(bot_tools.request_secret("NEW_NAME2"))
    results.append(bot_tools.request_secret_access("steve", "STRIPE_SECRET_KEY", "r"))
    results.append(bot_tools.request_secret_access("jim", "AWS_KEY", "r"))
    results.append(bot_tools.list_org_secrets("steve"))
    results.append(bot_tools.list_org_secrets("jim"))
    results.append(bot_tools.list_org_secrets("oscar"))
    results.append(bot_tools.list_org_skills("steve"))
    results.append(bot_tools.list_org_skills("nobody"))
    results.append(bot_tools.list_pending_requests())
    results.append(bot_tools.list_pending_requests("steve"))

    # NOTE: deliberately NOT testing request_secret(name=SECRET_VALUE) here —
    # echoing back data the caller itself chose to send is not obtaining a
    # stored secret; the invariant is that no tool can retrieve a stored value.

    for i, res in enumerate(results):
        strings = _all_json_strings(res)
        assert SECRET not in strings, f"leak in result #{i}: {res}"
        for s in strings:
            assert substring not in s, f"substring leak in result #{i}: {s!r}"
        blob = json.dumps(res)
        assert substring not in blob, f"substring leak in json of result #{i}"


def test_cli_json_stdout(org_env, tmp_path, capsys):
    from balabot import bot_tools as bt
    assert bt.main(["list_org_secrets", "--bot", "steve"]) == 0
    rows = json.loads(capsys.readouterr().out)
    assert isinstance(rows, list) and rows

    assert bt.main(["request_secret", "--name", "FOO_TOKEN",
                    "--bot", "steve"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["requested"] is True and out["status"] == "awaiting_user"

    assert bt.main(["request_secret_access", "--bot", "oscar",
                    "--name", "STRIPE_SECRET_KEY",
                    "--reason", "payments"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["requested"] is True

    assert bt.main(["list_org_skills", "--bot", "steve"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert "skills" in out

    assert bt.main(["list_pending_requests", "--bot", "steve"]) == 0
    assert json.loads(capsys.readouterr().out)

    # CLI: a --value flag must be rejected, not silently ignored
    import subprocess
    env = {**os.environ, "BALABOT_DATA_ROOT": str(tmp_path / "data")}
    r = subprocess.run(
        [sys.executable, "-m", "balabot.bot_tools", "request_secret",
         "--name", "X", "--value", "leaky"],
        capture_output=True, text=True, env=env, cwd=REPO_ROOT)
    assert r.returncode == 1
    assert "leaky" not in r.stdout and "value" in r.stderr
