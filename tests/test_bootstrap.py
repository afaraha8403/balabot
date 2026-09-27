"""Bootstrap contracts: forced deltas, file placement, secrets, idempotency."""

from __future__ import annotations

import io
from contextlib import redirect_stdout

import pytest
import yaml

from balabot import bootstrap as bootstrap_mod
from balabot.bootstrap import (
    BootstrapError,
    init_ledger,
    install_skills,
    provision_persona,
    run_bootstrap,
)


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
    assert (dest / "workspace-law" / "SKILL.md").is_file()
    # Not flat: no skills/<skill>/ directly under skills/.
    assert not (hermes_env["hermes_home"] / "profiles" / "principal" / "skills" / "workspace-law").exists()


def test_install_skills_idempotent(hermes_env, fake_repo):
    install_skills("principal", repo_root=fake_repo)
    dest = hermes_env["hermes_home"] / "profiles" / "principal" / "skills" / "balabot" / "workspace-law"
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


def test_ledger_index_exists_after_provisioning(hermes_env, fake_repo):
    init_ledger("governor")
    index = hermes_env["data_root"] / "profiles" / "governor" / "ledger" / "index.md"
    assert index.is_file()


def test_ledger_index_frontmatter_has_type(hermes_env, fake_repo):
    init_ledger("principal")
    index = hermes_env["data_root"] / "profiles" / "principal" / "ledger" / "index.md"
    text = index.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    fm = yaml.safe_load(text.split("---\n")[1])
    assert fm["type"]
    assert "ledger" in fm["description"]


def test_init_ledger_idempotent(hermes_env, fake_repo):
    first = init_ledger("governor")
    index = hermes_env["data_root"] / "profiles" / "governor" / "ledger" / "index.md"
    content = index.read_text(encoding="utf-8")
    second = init_ledger("governor")
    assert index.read_text(encoding="utf-8") == content
    assert "initialised" in first[0]
    assert "exists" in second[0]


def test_bootstrap_report_includes_ledger_actions(hermes_env, fake_repo, monkeypatch):
    monkeypatch.setattr(bootstrap_mod, "_repo_root", lambda: fake_repo)
    reports = run_bootstrap()
    for report in reports:
        assert any("ledger" in a for a in report["actions"])


# ---------------------------------------------------------------------------
# Skill scoping contracts (persona-scoped installs, not the whole skills/ dump).
# ---------------------------------------------------------------------------

def _installed(hermes_env, name):
    dest = hermes_env["hermes_home"] / "profiles" / name / "skills" / "balabot"
    return sorted(p.name for p in dest.iterdir() if p.is_dir()) if dest.is_dir() else []


def test_principal_scope_has_operator_skills(hermes_env, fake_repo):
    install_skills("principal", repo_root=fake_repo)
    installed = _installed(hermes_env, "principal")
    for required in ("platform-awareness", "owner-onboarding",
                     "agent-liveness-recovery", "agent-growth-review",
                     "delegation-discipline", "okf-decision-ledger"):
        assert required in installed, f"principal missing {required}"
    assert set(installed) == set(bootstrap_mod.PERSONA_SKILLS["principal"])


def test_governor_scope_excludes_operator_skills(hermes_env, fake_repo):
    install_skills("governor", repo_root=fake_repo)
    installed = _installed(hermes_env, "governor")
    for forbidden in ("owner-onboarding", "agent-liveness-recovery",
                      "agent-growth-review"):
        assert forbidden not in installed, f"governor must NOT get {forbidden}"
    assert "contradiction-audit" in installed
    assert "platform-awareness" in installed
    assert set(installed) == set(bootstrap_mod.PERSONA_SKILLS["governor"])


def test_worker_scope_excludes_operator_skills(hermes_env, fake_repo):
    install_skills("scout", repo_root=fake_repo)  # unknown persona -> worker default
    installed = _installed(hermes_env, "scout")
    for forbidden in ("agent-growth-review", "agent-liveness-recovery",
                      "owner-onboarding", "contradiction-audit"):
        assert forbidden not in installed, f"worker must NOT get {forbidden}"
    assert "platform-awareness" in installed
    assert set(installed) == set(bootstrap_mod.DEFAULT_WORKER_SKILLS)


def test_explicit_skill_list_is_respected(hermes_env, fake_repo):
    install_skills("principal", repo_root=fake_repo, skills=("workspace-law",))
    assert _installed(hermes_env, "principal") == ["workspace-law"]


def test_unknown_skill_reported_not_fatal(hermes_env, fake_repo):
    actions = install_skills("principal", repo_root=fake_repo,
                             skills=("no-such-skill",))
    assert any("no such skill" in a for a in actions)
    assert _installed(hermes_env, "principal") == []


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
