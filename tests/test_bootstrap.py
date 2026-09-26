"""Bootstrap contracts: forced deltas, file placement, secrets, idempotency."""

from __future__ import annotations

import io
from contextlib import redirect_stdout

import pytest
import yaml

from balabot import bootstrap as bootstrap_mod
from balabot.bootstrap import BootstrapError, install_skills, provision_persona, run_bootstrap


def test_provisions_both_personas(hermes_env, fake_repo, monkeypatch):
    monkeypatch.setattr(bootstrap_mod, "_repo_root", lambda: fake_repo)
    reports = run_bootstrap()
    assert [r["persona"] for r in reports] == list(bootstrap_mod.PERSONAS)


def test_forced_deltas_applied(hermes_env, fake_repo):
    provision_persona("principal", repo_root=fake_repo)
    cfg = yaml.safe_load(
        (hermes_env["hermes_home"] / "profiles" / "principal" / "config.yaml").read_text()
    )
    workspace = hermes_env["data_root"] / "workspace" / "principal"
    assert cfg["model"]["default"] == bootstrap_mod.FORCED_MODEL_DEFAULT
    assert cfg["model"]["provider"] == bootstrap_mod.FORCED_MODEL_PROVIDER
    assert cfg["memory"]["provider"] == bootstrap_mod.FORCED_MEMORY_PROVIDER
    assert cfg["terminal"]["cwd"] == str(workspace)
    # Contract: the template's token is overridden to exactly an empty string.
    assert cfg["telegram"]["bot_token"] == ""
    assert cfg["telegram"]["bot_token"] is not None


def test_agents_md_in_workspace_not_profile(hermes_env, fake_repo):
    provision_persona("principal", repo_root=fake_repo)
    workspace = hermes_env["data_root"] / "workspace" / "principal"
    profile = hermes_env["hermes_home"] / "profiles" / "principal"
    # AGENTS.md must live in the workspace (found via cwd walk-up)...
    assert (workspace / "AGENTS.md").is_file()
    # ...and must NOT have been placed in the profile dir (silently ignored there).
    assert not (profile / "AGENTS.md").exists()
    # Contract: terminal.cwd points at the dir holding the rules file.
    cfg = yaml.safe_load((profile / "config.yaml").read_text())
    assert cfg["terminal"]["cwd"] == str((workspace / "AGENTS.md").parent)


def test_soul_md_in_profile_dir(hermes_env, fake_repo):
    provision_persona("principal", repo_root=fake_repo)
    profile = hermes_env["hermes_home"] / "profiles" / "principal"
    assert (profile / "SOUL.md").is_file()


def test_skills_landed_under_category_dir(hermes_env, fake_repo):
    install_skills("principal", repo_root=fake_repo)
    dest = hermes_env["hermes_home"] / "profiles" / "principal" / "skills" / "balabot"
    # Required shape: <profile>/skills/balabot/<skill>/SKILL.md
    assert (dest / "demo-skill" / "SKILL.md").is_file()
    # Not flat: no skills/<skill>/ directly under skills/.
    assert not (hermes_env["hermes_home"] / "profiles" / "principal" / "skills" / "demo-skill").exists()


def test_install_skills_idempotent(hermes_env, fake_repo):
    install_skills("principal", repo_root=fake_repo)
    dest = hermes_env["hermes_home"] / "profiles" / "principal" / "skills" / "balabot" / "demo-skill"
    before = (dest / "SKILL.md").read_text()
    install_skills("principal", repo_root=fake_repo)
    assert (dest / "SKILL.md").read_text() == before


def test_provision_idempotent(hermes_env, fake_repo):
    provision_persona("governor", repo_root=fake_repo)
    cfg_first = (
        (hermes_env["hermes_home"] / "profiles" / "governor" / "config.yaml").read_text()
    )
    provision_persona("governor", repo_root=fake_repo)  # run twice: no crash
    cfg_second = (
        (hermes_env["hermes_home"] / "profiles" / "governor" / "config.yaml").read_text()
    )
    assert cfg_first == cfg_second  # same result


def test_missing_template_raises(hermes_env, tmp_path):
    empty_root = tmp_path / "empty_repo"
    empty_root.mkdir()
    with pytest.raises(BootstrapError):
        provision_persona("principal", repo_root=empty_root)


def test_missing_agents_md_raises(hermes_env, tmp_path):
    root = tmp_path / "no_agents"
    (root / "personas" / "principal").mkdir(parents=True)
    (root / "personas" / "principal" / "config.template.yaml").write_text("model: {}\n")
    with pytest.raises(BootstrapError):
        provision_persona("principal", repo_root=root)


def test_missing_soul_md_raises(hermes_env, tmp_path):
    root = tmp_path / "no_soul"
    (root / "personas" / "principal").mkdir(parents=True)
    (root / "personas" / "principal" / "config.template.yaml").write_text("model: {}\n")
    (root / "personas" / "principal" / "AGENTS.md").write_text("# rules\n")
    with pytest.raises(BootstrapError):
        provision_persona("principal", repo_root=root)


def test_env_file_contains_only_env_present_keys(hermes_env, fake_repo, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-openrouter-xyz")
    # TYPESAFE_API_KEY and TELEGRAM_BOT_TOKEN deliberately NOT in the env.
    provision_persona("principal", repo_root=fake_repo)
    env_text = (hermes_env["hermes_home"] / "profiles" / "principal" / ".env").read_text()
    assert "OPENROUTER_API_KEY=sk-openrouter-xyz" in env_text
    assert "TYPESAFE_API_KEY" not in env_text
    assert "TELEGRAM_BOT_TOKEN" not in env_text


def test_env_file_empty_when_no_env_keys(hermes_env, fake_repo):
    provision_persona("principal", repo_root=fake_repo)
    assert (hermes_env["hermes_home"] / "profiles" / "principal" / ".env").read_text() == ""


def test_no_secret_value_ever_printed(hermes_env, fake_repo, monkeypatch):
    """Neither the bootstrap report nor stdout may contain a secret VALUE."""
    secret = "sk-super-secret-value-42"
    monkeypatch.setenv("OPENROUTER_API_KEY", secret)
    monkeypatch.setattr(bootstrap_mod, "_repo_root", lambda: fake_repo)
    buf = io.StringIO()
    with redirect_stdout(buf):
        run_bootstrap()
    out = buf.getvalue()
    assert secret not in out
    assert "sk-super-secret-value-42" not in out
