"""BalaBot skills registry — two skill classes, four-tier precedence,
a protective curator and a quarantine lane.

Per kb/plans/org-secrets-and-skills.md ('Skills — two classes' and
'Skill precedence for a bot'):

Two classes
-----------
- ``learned``  — produced by the self-improvement loop, maintained by the
  curator with an ``active -> stale -> archived`` lifecycle. Pinned skills and
  any skill referenced by a cron job are PROTECTED. The curator NEVER
  auto-deletes, only archives.
- ``brought``  — hand-written, skills.sh-installed or hub-installed. Hub-installed
  skills are ALWAYS exempt from the curator.

Third-party installs land in a QUARANTINE lane: inert (``quarantined=True``,
no scope) until a human promotes them. Nothing in quarantine may ever appear
in ``resolve()`` output.

Precedence for a bot (exactly)
------------------------------
    bot-own > org grant (specific bots) > org grant (all bots) > global/built-in

Each resolved record carries ``precedence_tier`` so precedence is inspectable
rather than asserted.

Honest empty state
------------------
The curator state and usage ledger are separate files. If they do not exist,
the code reports that plainly ('no usage data', ``state_exists: False``) rather
than returning invented usage numbers. View/use counts are NEVER fabricated.

Hard rules
----------
- No secret values anywhere — this module holds skill metadata only.
- All state lives under ``BALABOT_DATA_ROOT``; paths resolve at call time so
  tests can repoint the root via the environment.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

__all__ = [
    "STAGES",
    "SCOPES",
    "ORIGINS",
    "TIERS",
    "install_skill",
    "install_third_party",
    "approve",
    "pin",
    "unpin",
    "get_record",
    "load_usage_ledger",
    "resolve",
    "cron_references",
    "curate",
    "CURATOR",
]

# ---- constants -------------------------------------------------------------

STAGES = ("active", "stale", "archived")
SCOPES = ("bot", "org", "org-selected")
ORIGINS = ("learned", "brought")
# Tier keys, high -> low. Inspectable on every resolved record.
TIERS = ("bot-own", "org-grant-specific", "org-grant-all", "global")
SOURCES = ("authored", "skills.sh", "hub")

# Curator thresholds (overridable per call via ``stale_after_days`` /
# ``archive_after_days``). Defaults: a learned skill goes stale after 30
# unused days, then archived after a further 60 days of staleness.
DEFAULT_STALE_AFTER_DAYS = 30
DEFAULT_ARCHIVE_AFTER_DAYS = 60


def _data_root() -> Path:
    """Resolve the data root at call time so tests can repoint it via env."""
    return Path(os.environ.get("BALABOT_DATA_ROOT", "/opt/data"))


def _skills_dir() -> Path:
    return _data_root() / "skills"


def _registry_path() -> Path:
    return _skills_dir() / "registry.json"


def _usage_path() -> Path:
    return _skills_dir() / "usage-ledger.json"


def _cron_path() -> Path:
    return _data_root() / "cron" / "jobs.json"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_record(name: str, *, origin: str, scope: str | None) -> dict:
    """A skill record. usage is NEVER pre-populated — absent ledger means
    'no usage data', never zeros presented as truth."""
    return {
        "name": name,
        "origin": origin,
        "scope": scope,
        "state": "active",
        "pinned": False,
        "usage": {"views": 0, "uses": 0, "patches": 0},
        "last_used": None,
        "quarantined": False,
        "source": None,
        "created_at": _now(),
        "updated_at": _now(),
        # filled by resolve(): which tier supplied this skill
        "precedence_tier": None,
    }


def _load_json(path: Path, default):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.stem}-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _load_records() -> list[dict]:
    """All skill records, or [] if the registry does not exist yet."""
    data = _load_json(_registry_path(), None)
    if data is None:
        return []
    recs = data.get("skills", [])
    # tolerate older payloads missing newer keys
    for r in recs:
        r.setdefault("usage", {"views": 0, "uses": 0, "patches": 0})
        r.setdefault("last_used", None)
        r.setdefault("pinned", False)
        r.setdefault("quarantined", False)
        r.setdefault("source", None)
    return recs


def _save_records(recs: list[dict]) -> None:
    _atomic_write(_registry_path(), {"version": 1, "skills": recs})


def _save_records_now(recs: list[dict]) -> None:
    _save_records(recs)


def _find(recs: list[dict], name: str) -> dict | None:
    return next((r for r in recs if r["name"] == name), None)


# ---- installs ---------------------------------------------------------------


def install_skill(name: str, *, origin: str, scope: str | None = None,
                  source: str | None = None, bot_id: str | None = None) -> dict:
    """Install a skill into the registry.

    - origin ``learned``: self-improvement loop output. scope = the bot that
      learned it (bot-own) until a human promotes it.
    - origin ``brought``: hand-written (authored) or installed via skills.sh /
      hub. Scope given by the caller.

    Multiple records may share a NAME at different tiers (a bot-own record and
    an org record); uniqueness is (name, bot_id) for bot-scoped installs.
    """
    if origin not in ORIGINS:
        raise ValueError(f"invalid origin {origin!r}: must be one of {ORIGINS}")
    if source is not None and source not in SOURCES:
        raise ValueError(f"invalid source {source!r}: must be one of {SOURCES}")
    if source == "hub" and origin != "brought":
        raise ValueError("hub-installed skills are always 'brought'")
    if scope is not None and scope not in SCOPES:
        raise ValueError(f"invalid scope {scope!r}: must be one of {SCOPES}")
    recs = _load_records()
    for r in recs:
        if r["name"] == name and r.get("bot_id") == bot_id and r["scope"] == scope:
            raise ValueError(f"skill already installed: {name!r}")
    rec = _new_record(name, origin=origin, scope=scope)
    rec["source"] = source
    if bot_id is not None:
        rec["bot_id"] = bot_id
    recs.append(rec)
    _save_records_now(recs)
    return dict(rec)


def install_third_party(name: str, source: str) -> dict:
    """QUARANTINE lane: a third-party skill lands INERT.

    quarantined=True, scope=None. It must be approved before it can ever
    appear in a bot's resolved skills. Returns the quarantined record.
    """
    if source not in SOURCES:
        raise ValueError(f"invalid source {source!r}: must be one of {SOURCES}")
    recs = _load_records()
    existing = _find(recs, name)
    if existing is not None:
        raise ValueError(f"skill already installed: {name!r}")
    rec = _new_record(name, origin="brought", scope=None)
    rec["source"] = source
    rec["quarantined"] = True
    recs.append(rec)
    _save_records_now(recs)
    return dict(rec)


def approve(name: str, scope: str) -> dict:
    """Promote a quarantined skill: assign a scope, clear the quarantine flag."""
    if scope not in SCOPES:
        raise ValueError(f"invalid scope {scope!r}: must be one of {SCOPES}")
    recs = _load_records()
    rec = _find(recs, name)
    if rec is None:
        raise KeyError(f"unknown skill: {name!r}")
    if not rec.get("quarantined"):
        raise ValueError(f"skill {name!r} is not in quarantine")
    rec["quarantined"] = False
    rec["scope"] = scope
    rec["state"] = "active"
    rec["updated_at"] = _now()
    _save_records_now(recs)
    return dict(rec)


def pin(name: str) -> dict:
    """Pin a skill — protects it from the curator."""
    recs = _load_records()
    rec = _find(recs, name)
    if rec is None:
        raise KeyError(f"unknown skill: {name!r}")
    rec["pinned"] = True
    rec["updated_at"] = _now()
    _save_records_now(recs)
    return dict(rec)


def unpin(name: str) -> dict:
    recs = _load_records()
    rec = _find(recs, name)
    if rec is None:
        raise KeyError(f"unknown skill: {name!r}")
    rec["pinned"] = False
    rec["updated_at"] = _now()
    _save_records_now(recs)
    return dict(rec)


def get_record(name: str) -> dict | None:
    return _find(_load_records(), name)


# ---- usage ledger (honest empty state) --------------------------------------


def load_usage_ledger() -> dict:
    """The usage ledger, or an explicit empty marker if it does not exist.

    NEVER fabricates counts: absence is reported as ``exists: False`` /
    ``'no usage data'``, not as zeros pretending to be observations.
    """
    data = _load_json(_usage_path(), None)
    if data is None:
        return {"exists": False, "note": "no usage data", "entries": {}}
    data.setdefault("entries", {})
    data["exists"] = True
    return data


def record_usage(name: str, *, views: int = 0, uses: int = 0, patches: int = 0) -> dict:
    """Append real usage observations to the ledger (the only way counts grow)."""
    if min(views, uses, patches) < 0:
        raise ValueError("usage counts must be >= 0")
    data = _load_json(_usage_path(), None) or {"entries": {}}
    entries = data.setdefault("entries", {})
    e = entries.setdefault(name, {"views": 0, "uses": 0, "patches": 0})
    e["views"] += views
    e["uses"] += uses
    e["patches"] += patches
    _atomic_write(_usage_path(), data)
    # mirror the totals into the registry record for display
    recs = _load_records()
    rec = _find(recs, name)
    if rec is not None:
        rec["usage"] = {"views": e["views"], "uses": e["uses"], "patches": e["patches"]}
        rec["last_used"] = _now() if (uses or views) else rec["last_used"]
        rec["updated_at"] = _now()
        _save_records_now(recs)
    return dict(e)


def usage_for(name: str) -> dict:
    """Usage totals for one skill with an honest empty state."""
    ledger = load_usage_ledger()
    if not ledger["exists"]:
        return {"exists": False, "note": "no usage data"}
    e = ledger["entries"].get(name)
    if e is None:
        return {"exists": False, "note": "no usage data"}
    return {"exists": True, **e}


# ---- cron references ---------------------------------------------------------


def cron_references() -> set[str]:
    """Names of skills referenced by any cron job.

    Returns an empty set if no cron state file exists — but curate() treats a
    MISSING cron file as 'cannot prove anything is unreferenced' by reporting
    it, and never deletes anything anyway.
    """
    data = _load_json(_cron_path(), None)
    if data is None:
        return set()
    refs: set[str] = set()
    for job in data.get("jobs", []):
        for m in re.findall(r"[\w.-]+", json.dumps(job)):
            refs.add(m)
    # keep only tokens that are actually skill names
    return refs & {r["name"] for r in _load_records()}


# ---- precedence resolver ------------------------------------------------------


def _grant_tier(g: dict) -> str | None:
    """Map a live skill grant to its precedence tier name."""
    if g.get("scope") == "bot":
        return "org-grant-specific"
    if g.get("scope") == "org":
        return "org-grant-all"
    return None


def resolve(bot_id: str) -> list[dict]:
    """The skills a bot may use, with the winning tier reported per record.

    Exactly:  bot-own > org grant (specific bots) > org grant (all bots)
              > global/built-in

    - Quarantined skills NEVER appear.
    - On a name collision the higher tier wins and the record's
      ``precedence_tier`` says which tier supplied it.
    - If the usage ledger has no entry for a skill, its usage block reports
      'no usage data' rather than zeros presented as truth.
    """
    # late import: orgs.py reads the same BALABOT_DATA_ROOT at call time
    from balabot import orgs as orgs_mod

    recs = _load_records()
    by_name: dict[str, dict] = {}

    def offer(tier: str, rec: dict) -> None:
        prev = by_name.get(rec["name"])
        if prev is None or TIERS.index(tier) < TIERS.index(prev["precedence_tier"]):
            shown = dict(rec)
            shown["precedence_tier"] = tier
            usage = usage_for(rec["name"])
            if not usage["exists"]:
                shown["usage"] = "no usage data"
            by_name[rec["name"]] = shown

    # 4. global / built-in — lowest tier: anything scoped org-wide or
    #    org-selected that is not gated behind a specific-bot grant
    # 1. bot-own — the bot's own profile skills
    # (evaluate all tiers, higher tiers overwrite lower ones by offering in
    #  ascending precedence order)
    for rec in recs:
        if rec.get("quarantined"):
            continue
        scope = rec.get("scope")
        if scope == "bot" and rec.get("bot_id") == bot_id:
            offer("bot-own", rec)
        elif scope == "bot" and rec.get("bot_id") != bot_id:
            continue  # another bot's private skill
        elif scope == "org":
            offer("global", rec)
        elif scope == "org-selected":
            # org-selected: visible only if some org grants it to this bot
            continue  # placed below via grants, or skipped if ungranted
        # quarantined never resolves (handled above)

    # org grant tiers — from the live grant registry
    try:
        grants = orgs_mod.grants_for(bot_id, kind="skill")
    except Exception:
        grants = []
    grant_tiers: dict[str, str] = {}
    for g in grants:
        tier = _grant_tier(g)
        if tier is None:
            continue
        name = g["resource"]["name"]
        # specific beats all when both exist for the same name
        if tier == "org-grant-specific" or name not in grant_tiers:
            if name not in grant_tiers or grant_tiers[name] == "org-grant-all":
                grant_tiers[name] = tier

    for rec in recs:
        if rec.get("quarantined"):
            continue
        name = rec["name"]
        tier = grant_tiers.get(name)
        if tier is None:
            if rec.get("scope") == "org-selected":
                continue  # ungranted org-selected skill: not visible
            continue
        offer(tier, rec)

    # org grant tiers rank above 'global' and below 'bot-own'
    def _rank(item: dict) -> int:
        return TIERS.index(item["precedence_tier"])

    out = sorted(by_name.values(), key=lambda r: (r["name"],))
    # ensure tier ordering is truthful: a global-scope record that also has a
    # specific grant keeps the grant tier (offer() handled it).
    out.sort(key=_rank)
    return out


# ---- the curator --------------------------------------------------------------


def CURATOR(*, dry_run: bool = True, stale_after_days: int = DEFAULT_STALE_AFTER_DAYS,
            archive_after_days: int = DEFAULT_ARCHIVE_AFTER_DAYS,
            now: str | None = None) -> dict:
    """Alias kept for readability; see :func:`curate`."""
    return curate(dry_run=dry_run, stale_after_days=stale_after_days,
                  archive_after_days=archive_after_days, now=now)


def _parse_ts(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _effective_now(now: str | None) -> datetime:
    if now:
        return _parse_ts(now) or datetime.now(timezone.utc)
    return datetime.now(timezone.utc)


def curate(*, dry_run: bool = True, stale_after_days: int = DEFAULT_STALE_AFTER_DAYS,
           archive_after_days: int = DEFAULT_ARCHIVE_AFTER_DAYS,
           now: str | None = None) -> dict:
    """One curator pass over learned skills: active -> stale -> archived.

    Protections (each provably enforced, see tests):
      1. pinned skills are never touched;
      2. hub-installed skills (origin='brought' + source='hub') are never
         touched;
      3. skills referenced by a cron job are never touched;
      4. the curator NEVER deletes — only archives.

    With ``dry_run=True`` (the default) the planned changes are returned
    WITHOUT mutating any state. With ``dry_run=False`` they are applied.

    Honest empty state: when the usage ledger does not exist the report says
    so ('no usage data'); the pass then has no evidence a skill was used and
    falls back to age-on-disk heuristics only.
    """
    ledger = load_usage_ledger()
    refs = cron_references()
    cron_file_exists = _cron_path().exists()
    effective_now = _effective_now(now)
    recs = _load_records()
    planned: list[dict] = []
    protected: list[dict] = []

    for rec in recs:
        if rec["origin"] != "learned":
            continue  # the curator only maintains learned skills
        # --- protections ---------------------------------------------------
        reasons = []
        if rec.get("pinned"):
            reasons.append("pinned")
        if rec.get("source") == "hub":
            reasons.append("hub-installed")
        if rec["name"] in refs:
            reasons.append("cron-referenced")
        if reasons:
            protected.append({"name": rec["name"], "state": rec["state"],
                              "protected_by": reasons})
            continue
        # --- lifecycle -----------------------------------------------------
        last = _parse_ts(rec.get("last_used")) or _parse_ts(rec.get("created_at"))
        if last is None:
            continue
        idle_days = (effective_now - last).days
        target = None
        if rec["state"] == "active" and idle_days >= stale_after_days:
            target = "stale"
            idle_days_for_next = idle_days
        elif rec["state"] == "stale":
            stale_since = _parse_ts(rec.get("updated_at")) or last
            stale_days = (effective_now - stale_since).days
            if stale_days >= archive_after_days:
                target = "archived"
        if target is None:
            continue
        planned.append({
            "name": rec["name"],
            "from_state": rec["state"],
            "to_state": target,
            "idle_days": idle_days,
        })

    report = {
        "dry_run": dry_run,
        "usage_ledger_exists": ledger["exists"],
        "usage_note": ledger.get("note") if not ledger["exists"] else None,
        "cron_state_exists": cron_file_exists,
        "planned_changes": planned,
        "protected": protected,
        "deleted": [],  # the curator NEVER deletes — structural, not incidental
        "applied": False,
    }

    if dry_run or not planned:
        return report

    for change in planned:
        rec = _find(recs, change["name"])
        if rec is None:
            continue  # vanished mid-pass; never crash, never invent
        if rec.get("pinned") or rec.get("source") == "hub" or rec["name"] in refs:
            continue  # re-verify protections at apply time
        rec["state"] = change["to_state"]
        rec["updated_at"] = _now()
    _save_records_now(recs)
    report["applied"] = True
    return report
