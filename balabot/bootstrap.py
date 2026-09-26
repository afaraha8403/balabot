"""First-boot provisioning for BalaBot personas (principal, governor).

Idempotent: safe to re-run on every container start. Provisioning matters
because of one non-obvious Hermes behaviour:

    Rules files (.hermes.md / AGENTS.md) are found by walking UP from the
    runtime cwd (terminal.cwd) -- NOT from the profile dir. A rules file at
    the profile root is SILENTLY IGNORED.

So the persona's AGENTS.md must land in its WORKSPACE dir, and
terminal.cwd must point there. SOUL.md is different: it IS read
unconditionally from HERMES_HOME, so it goes in the profile dir.

Secrets handling: the profile .env is written from the process
environment only. Key values are never hardcoded, never printed -- only
key NAMES and counts.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

import yaml

from . import __version__

# Environment keys each profile .env may carry, if present in the process env.
# Never values -- the bootstrap copies what exists and says nothing about it.
PROFILE_ENV_KEYS = (
    "OPENROUTER_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TYPESAFE_API_KEY",
)

PERSONAS = ("principal", "governor")

# Forced deltas, applied to every persona's rendered config.
FORCED_MODEL_DEFAULT = "deepseek/deepseek-v4.1-flash"
FORCED_MODEL_PROVIDER = "openrouter"
FORCED_MEMORY_PROVIDER = "holographic"


class BootstrapError(RuntimeError):
    """Raised when provisioning cannot proceed. Fail loud, never degrade."""


def _repo_root() -> Path:
    """Repo root = parent of this package (balabot/balabot/ -> balabot/)."""
    return Path(__file__).resolve().parent.parent


def _hermes_home() -> Path:
    """Resolve the Hermes home dir.

    HERMES_HOME wins when set. Otherwise default to ~/.hermes — that is what
    Hermes itself uses (get_hermes_home() is profile-aware but HOME-anchored),
    and the official nousresearch/hermes-agent image runs as root with
    HOME=/root, so the state volume mounts /root/.hermes.
    """
    home = os.environ.get("HERMES_HOME")
    if home:
        return Path(home)
    return Path.home() / ".hermes"


def _data_root() -> Path:
    """Root for persona workspaces. Overridable; defaults to /data in-container."""
    return Path(os.environ.get("BALABOT_DATA_ROOT", "/data"))


def _force_deltas(cfg: dict[str, Any], workspace: Path) -> None:
    """Apply the non-negotiable config deltas. These exist because two
    gateways sharing one Telegram token race on every message, and because
    the rules-file lookup walks up from terminal.cwd."""
    cfg.setdefault("model", {})
    cfg["model"]["default"] = FORCED_MODEL_DEFAULT
    cfg["model"]["provider"] = FORCED_MODEL_PROVIDER

    cfg.setdefault("memory", {})
    cfg["memory"]["provider"] = FORCED_MEMORY_PROVIDER

    cfg.setdefault("terminal", {})
    cfg["terminal"]["cwd"] = str(workspace)

    cfg.setdefault("telegram", {})
    # Empty, always. Never clone a sibling token into a profile.
    cfg["telegram"]["bot_token"] = ""


def provision_persona(name: str, *, repo_root: Path | None = None) -> dict[str, Any]:
    """Provision one persona profile + workspace. Idempotent.

    Returns a plain-English summary dict (no secret values).
    """
    root = repo_root if repo_root is not None else _repo_root()
    hermes_home = _hermes_home()
    data_root = _data_root()

    workspace = data_root / "workspace" / name
    profile_dir = hermes_home / "profiles" / name

    template = root / "personas" / name / "config.template.yaml"
    if not template.is_file():
        raise BootstrapError(
            f"Config template not found: {template}. "
            f"Expected personas/{name}/config.template.yaml in the repo."
        )

    actions: list[str] = []

    # 1. Workspace dir (created before config so terminal.cwd is valid).
    if not workspace.is_dir():
        workspace.mkdir(parents=True, exist_ok=True)
        actions.append(f"created workspace {workspace}")
    else:
        actions.append(f"workspace exists: {workspace}")

    # 2. AGENTS.md -> workspace (found via cwd walk-up; profile placement is ignored).
    src_agents = root / "personas" / name / "AGENTS.md"
    if src_agents.is_file():
        dst_agents = workspace / "AGENTS.md"
        shutil.copyfile(src_agents, dst_agents)
        actions.append(f"installed AGENTS.md at {dst_agents}")
    else:
        raise BootstrapError(f"AGENTS.md not found for persona '{name}': {src_agents}")

    # 3. Profile dir + config.yaml.
    profile_dir.mkdir(parents=True, exist_ok=True)
    with template.open("r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    if not isinstance(cfg, dict):
        raise BootstrapError(f"Template {template} did not parse to a mapping.")
    _force_deltas(cfg, workspace)
    cfg_path = profile_dir / "config.yaml"
    with cfg_path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(cfg, fh, sort_keys=False)
    actions.append(f"wrote {cfg_path}")

    # 4. SOUL.md -> profile dir (read unconditionally from HERMES_HOME).
    src_soul = root / "personas" / name / "SOUL.md"
    if src_soul.is_file():
        shutil.copyfile(src_soul, profile_dir / "SOUL.md")
        actions.append(f"installed SOUL.md in profile dir")
    else:
        raise BootstrapError(f"SOUL.md not found for persona '{name}': {src_soul}")

    # 5. Profile .env: only keys present in the process environment.
    env_lines = []
    used_keys: list[str] = []
    for key in PROFILE_ENV_KEYS:
        value = os.environ.get(key)
        if value:
            env_lines.append(f"{key}={value}")
            used_keys.append(key)
    env_path = profile_dir / ".env"
    if env_lines:
        env_path.write_text("\n".join(env_lines) + "\n", encoding="utf-8")
        actions.append(f"wrote {env_path.name} with {len(env_lines)} key(s): {', '.join(used_keys or [])}")
    else:
        env_path.write_text("", encoding="utf-8")
        actions.append(f"wrote empty {env_path.name} (no matching env keys present)")

    return {"persona": name, "actions": actions}


# Hermes discovers skills as skills/<category>/<skill>/SKILL.md. A skill copied
# flat (skills/<skill>/) is NOT discovered — same class of silent failure as the
# rules-file cwd walk. BalaBot's own skills ship under this category.
BALABOT_SKILL_CATEGORY = "balabot"


def install_skills(name: str, *, repo_root: Path | None = None) -> list[str]:
    """Install the repo's skills into a persona's profile skill tree.

    Preserves the <category>/<skill>/ layout Hermes requires for discovery.
    Repo layout is skills/<skill>/SKILL.md, so each top-level skill dir is
    re-homed under BALABOT_SKILL_CATEGORY.
    """
    root = repo_root if repo_root is not None else _repo_root()
    src_root = root / "skills"
    dest_root = _hermes_home() / "profiles" / name / "skills" / BALABOT_SKILL_CATEGORY
    actions: list[str] = []

    if not src_root.is_dir():
        return [f"no skills/ dir in repo ({src_root}) — nothing installed"]

    dest_root.mkdir(parents=True, exist_ok=True)
    for skill_dir in sorted(p for p in src_root.iterdir() if p.is_dir()):
        if not (skill_dir / "SKILL.md").is_file():
            actions.append(f"skipped {skill_dir.name}: no SKILL.md")
            continue
        dest = dest_root / skill_dir.name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(skill_dir, dest)
        actions.append(f"installed skill '{skill_dir.name}' -> {dest.relative_to(_hermes_home())}")
    return actions


def run_bootstrap() -> list[dict[str, Any]]:
    """Provision every persona AND install BalaBot's skills; print a secret-free report."""
    reports: list[dict[str, Any]] = []
    for name in PERSONAS:
        report = provision_persona(name)
        report["actions"].extend(install_skills(name))
        reports.append(report)
    for report in reports:
        print(f"[balabot {__version__}] persona '{report['persona']}':")
        for action in report["actions"]:
            print(f"  - {action}")
    return reports


if __name__ == "__main__":
    run_bootstrap()
