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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from . import __version__
from .jev import JevHealth

# Environment keys each profile .env may carry, if present in the process env.
# Never values -- the bootstrap copies what exists and says nothing about it.
PROFILE_ENV_KEYS = (
    "OPENROUTER_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TYPESAFE_API_KEY",
    # Under gateway multiplexing ONE host gateway serves every profile, and each
    # profile's api_server listener is authenticated with a PROFILE-SCOPED
    # API_SERVER_KEY. Without this the listener answers 401 to every request —
    # "no profile-scoped API_SERVER_KEY is configured" — even when the launch
    # scope has a key, which is how the product UI's chat backend silently dies.
    # Propagating the operator's single key into each profile .env keeps one
    # credential for the whole container.
    "API_SERVER_KEY",
    # Timeout ceilings. These MUST go in the profile .env, not just the process
    # env: Hermes loads its .env with override=True (hermes_cli/env_loader.py), so
    # a value in the file BEATS one set in the container's environment. The base
    # image ships TERMINAL_TIMEOUT=60 in its .env.example, which is tighter than
    # the code default of 180 and leaves an agent unable to finish a build,
    # install, or scrape. Routing them here (like API_SERVER_KEY) is what makes
    # the compose environment actually take effect.
    "TERMINAL_TIMEOUT",
    "DELEGATION_CHILD_TIMEOUT_SECONDS",
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


def _force_deltas(cfg: dict[str, Any], workspace: Path, name: str) -> None:
    """Apply the non-negotiable config deltas. These exist because two
    gateways sharing one Telegram token race on every message, because
    the rules-file lookup walks up from terminal.cwd, and because secret
    delivery must be grant-filtered per bot rather than global."""
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

    # Secret delivery — reuse Hermes' own extension point rather than inventing
    # a parallel path. The helper reads the org registry, filters by THIS bot's
    # live grants (cross-org included), and prints KEY=VALUE to stdout, which
    # Hermes injects as environment variables. The bot can use a secret and can
    # never read it. The profile name is written in literally so delivery does
    # not depend on whatever env Hermes happens to export.
    # `profile_alias` lets a secret named FOO_<PROFILE> hydrate canonical FOO
    # for this bot only — which is exactly "an org secret granted to one bot".
    cfg.setdefault("secrets", {})
    cfg["secrets"]["sources"] = ["command"]
    cfg["secrets"]["profile_alias"] = True
    cfg["secrets"]["command"] = {
        "command": f"python3 -m balabot.secret_helper --profile {name}",
        "timeout": 10,
    }


def init_org(name: str, *, repo_root: Path | None = None) -> list[str]:
    """Register the default organization and its members at first boot.

    Idempotent. Exists because the org layer is USELESS out of the box without
    one: posting a secret answers 404 'unknown org' until an operator has run
    the registry CLI by hand. A product that requires a manual CLI step before
    its first feature works is not shipped.

    The org is the tenant that owns context, skills, secrets and computer
    spaces. Today's build is org 'balacode' (see fleet/balacode.json), and both
    shipped personas are its members.
    """
    from . import orgs

    actions: list[str] = []
    if orgs.show_org(DEFAULT_ORG) is not None:
        actions.append(f"org '{DEFAULT_ORG}' exists")
    else:
        orgs.add_org(DEFAULT_ORG, DEFAULT_ORG_NAME, members=list(PERSONAS))
        actions.append(f"registered org '{DEFAULT_ORG}' with members {list(PERSONAS)}")
    return actions


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
    _force_deltas(cfg, workspace, name)
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

# The default organization. A deployment has at least one tenant, and the org
# layer 404s without it, so first boot registers this one. Today's agent
# computer IS this org's computer (see fleet/balacode.json).
DEFAULT_ORG = "balacode"
DEFAULT_ORG_NAME = "Balacode"


# The Governor's shared decision ledger. Created for BOTH personas: it is one
# shared OKF bundle tree that both write to. Core promise behind it:
# "if it is not in the ledger, it did not happen".
LEDGER_DIRNAME = "ledger"


def init_ledger(name: str, *, repo_root: Path | None = None) -> list[str]:
    """Create the shared OKF decision ledger for a persona. Idempotent.

    The ledger lives under the DATA root (<BALABOT_DATA_ROOT>/profiles/<name>/)
    so it is volume-persisted alongside the workspace, and never committed into
    the repo. Returns human-readable action strings.
    """
    data_root = _data_root()
    ledger_dir = data_root / "profiles" / name / LEDGER_DIRNAME
    actions: list[str] = []

    index = ledger_dir / "index.md"
    if index.is_file():
        actions.append(f"ledger exists: {index}")
        return actions

    ledger_dir.mkdir(parents=True, exist_ok=True)
    title = f"{name.title()} shared decision ledger"
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    frontmatter = {
        "type": "ledger",
        "title": title,
        "description": (
            "Shared OKF decision ledger. Promise: if it is not in the "
            "ledger, it did not happen."
        ),
        "timestamp": timestamp,
        "tags": ["okf", "ledger", "decisions", name],
    }
    body = (
        "\n# Shared Decision Ledger\n\n"
        "Every binding decision is recorded here as an OKF entry.\n\n"
        "**Promise:** if it is not in the ledger, it did not happen.\n"
    )
    index.write_text(
        "---\n" + yaml.safe_dump(frontmatter, sort_keys=False) + "---\n" + body,
        encoding="utf-8",
    )
    actions.append(f"initialised shared decision ledger at {index}")
    return actions


# ---------------------------------------------------------------------------
# Jev incident surfacing. Jev (TypeSafe AI) is a HARD dependency: there is no
# fallback provider, so an unreachable Jev is an incident the Principal must
# see. The incident record lives in a dedicated JSONL file under the data root
# — durable across restarts, append-only, and secret-free (statuses and
# timestamps only, never key values, never exception text that could echo a
# header). "If it is not in the ledger, it did not happen" applies equally to
# incidents: the Principal's ops loop reads them via list_jev_incidents().
# ---------------------------------------------------------------------------

INCIDENTS_DIRNAME = "incidents"
INCIDENTS_FILENAME = "jev.jsonl"
JEV_INCIDENT_SEVERITY = "critical"


def _incidents_path(name: str) -> Path:
    return _data_root() / "profiles" / name / INCIDENTS_DIRNAME / INCIDENTS_FILENAME


def record_jev_incident(name: str, health: dict[str, Any] | JevHealth, *, now: datetime | None = None) -> dict[str, Any]:
    """Append one durable, secret-free Jev incident record for persona `name`.

    Accepts a JevHealth or its to_dict(). Never prints a secret; the record
    carries only status, detail (already secret-free), and a UTC timestamp.
    Returns the record as written. Fail-loud contract: the incident channel
    itself must never swallow the problem — if writing fails, the error
    propagates as BootstrapError so the caller cannot mistake it for health.
    """
    payload = health.to_dict() if isinstance(health, JevHealth) else dict(health)
    record = {
        "type": "jev-incident",
        "severity": JEV_INCIDENT_SEVERITY,
        "persona": name,
        "status": payload.get("status"),
        "detail": payload.get("detail"),
        "timestamp": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    path = _incidents_path(name)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(yaml.safe_dump(record, sort_keys=False))
    except OSError as exc:
        raise BootstrapError(f"could not record Jev incident for '{name}': {exc}") from exc
    return record


def list_jev_incidents(name: str) -> list[dict[str, Any]]:
    """Return every recorded Jev incident for persona `name`, oldest first.

    This is the read side of the incident channel: the ops loop (and the
    Principal over HTTP) serves exactly this list. Missing file means no
    incidents — an empty list is an honest answer, not a degradation.
    """
    path = _incidents_path(name)
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for chunk in path.read_text(encoding="utf-8").split("---\n"):
        if not chunk.strip():
            continue
        try:
            rec = yaml.safe_load(chunk)
        except yaml.YAMLError:
            continue
        if isinstance(rec, dict):
            records.append(rec)
    return records


def enforce_jev_dependency(name: str = "principal", *, client: Jev | None = None) -> JevHealth:
    """Health-check Jev and fail LOUD on anything but ok.

    Hard dependency contract: 'unreachable' or 'unauthorized' is recorded as
    a durable incident the Principal can read AND raises BootstrapError —
    there is no catch-and-continue, no silent degradation. 'no-key' raises
    without recording (bootstrap already fails on missing config upstream).
    """
    from .jev import check_jev_health

    health = check_jev_health(client) if client is not None else check_jev_health()
    if health.status == "ok":
        return health
    if health.status == "no-key":
        raise BootstrapError(
            "TYPESAFE_API_KEY is not set. Jev is a hard dependency; "
            "there is no fallback provider."
        )
    record_jev_incident(name, health)
    raise BootstrapError(
        f"Jev is {health.status}: {health.detail} "
        "Jev is a hard dependency — incident recorded for the Principal."
    )


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
    # The default org exists BEFORE personas are provisioned: a persona is a
    # member of it, and the org layer 404s on every secret route without it.
    org_actions = init_org("balacode")
    for name in PERSONAS:
        report = provision_persona(name)
        report["actions"].extend(install_skills(name))
        report["actions"].extend(init_ledger(name))
        reports.append(report)
    for report in reports:
        print(f"[balabot {__version__}] persona '{report['persona']}':")
        for action in report["actions"]:
            print(f"  - {action}")
    # The org is provisioned once for the deployment, not per persona, so it is
    # reported on its own line rather than hidden inside a persona's actions.
    print(f"[balabot {__version__}] organization '{DEFAULT_ORG}':")
    for action in org_actions:
        print(f"  - {action}")
    return reports


if __name__ == "__main__":
    run_bootstrap()
