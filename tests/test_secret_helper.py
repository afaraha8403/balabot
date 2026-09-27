"""Tests for balabot.secret_helper: granted-only injection, no leaks."""

from __future__ import annotations

import os

import pytest

from balabot import orgs, secret_helper

SECRET_VALUE = "sk-super-secret-value-42"


@pytest.fixture
def registry(tmp_path, monkeypatch):
    """Data root at tmp_path: one org, two secrets, grants set up."""
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    orgs.add_org("acme", "Acme")
    orgs.add_bot("acme", "bot-granted")
    orgs.add_bot("acme", "bot-plain")
    orgs.store_secret("API_KEY", "acme", SECRET_VALUE)
    orgs.store_secret("OTHER_KEY", "acme", "other-value-9999")
    orgs.grant("bot-granted", {"kind": "secret", "name": "API_KEY"},
               subject_org="acme", scope="bot", access="inject")
    # a 'read' grant must NOT auto-deliver
    orgs.grant("bot-plain", {"kind": "secret", "name": "API_KEY"},
               subject_org="acme", scope="bot", access="read")
    return tmp_path


def _capsys_no_value(capsys):
    captured = capsys.readouterr()
    assert SECRET_VALUE not in captured.out
    assert SECRET_VALUE not in captured.err


def test_granted_bot_gets_var(registry, capsys):
    lines = secret_helper.secret_lines_for("bot-granted")
    assert lines == [f"API_KEY={SECRET_VALUE}"]
    env = secret_helper.env_for("bot-granted")
    assert env == {"API_KEY": SECRET_VALUE}
    _capsys_no_value(capsys)


def test_non_granted_bot_gets_nothing(registry, capsys):
    # bot-plain exists in the org but holds only a 'read' grant
    assert secret_helper.secret_lines_for("bot-plain") == []
    assert secret_helper.env_for("bot-plain") == {}
    # a bot with no grants at all
    assert secret_helper.secret_lines_for("bot-nowhere") == []
    _capsys_no_value(capsys)


def test_revoked_grant_delivers_nothing(registry, capsys):
    reg = orgs.load()
    gid = next(g["id"] for g in reg["grants"]
               if g["access"] == "inject")
    orgs.revoke(gid)
    assert secret_helper.secret_lines_for("bot-granted") == []
    _capsys_no_value(capsys)


def test_cli_prints_lines_exit_zero(registry, capsys):
    rc = secret_helper.main(["--profile", "bot-granted"])
    assert rc == 0
    captured = capsys.readouterr()
    assert captured.out == f"API_KEY={SECRET_VALUE}\n"
    assert captured.err == ""


def test_cli_no_grants_no_registry(registry, capsys):
    import shutil
    shutil.rmtree(registry / "orgs")
    rc = secret_helper.main(["--profile", "bot-granted"])
    assert rc == 0
    captured = capsys.readouterr()
    assert captured.out == ""
    assert SECRET_VALUE not in captured.err


def test_missing_value_file_skipped(registry, capsys, monkeypatch):
    os.remove(registry / ".secrets" / "acme" / "API_KEY")
    assert secret_helper.secret_lines_for("bot-granted") == []
    _capsys_no_value(capsys)


def test_undecodable_value_file_skipped(registry, capsys):
    path = registry / ".secrets" / "acme" / "API_KEY"
    path.write_bytes(b"\xff\xfe\xfa\xfb not utf8 " + SECRET_VALUE.encode())
    assert secret_helper.secret_lines_for("bot-granted") == []
    _capsys_no_value(capsys)


def test_error_path_never_contains_value(registry, capsys, monkeypatch):
    """With the value file unreadable, nothing about the value escapes."""
    os.remove(registry / ".secrets" / "acme" / "API_KEY")
    try:
        secret_helper.secret_lines_for("bot-granted")
        secret_helper.main(["--profile", "bot-granted"])
    except Exception as exc:  # pragma: no cover — must not raise, but belt+braces
        assert SECRET_VALUE not in str(exc)
        raise
    captured = capsys.readouterr()
    assert SECRET_VALUE not in captured.err
    assert SECRET_VALUE not in captured.out


def test_org_scope_grant_delivers(registry, capsys):
    orgs.grant("bot-plain", {"kind": "secret", "name": "OTHER_KEY"},
               subject_org="acme", scope="org", access="inject")
    assert secret_helper.env_for("bot-plain") == {"OTHER_KEY": "other-value-9999"}
    _capsys_no_value(capsys)
