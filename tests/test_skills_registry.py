"""Tests for balabot/skills_registry.py.

All state is isolated: BALABOT_DATA_ROOT is monkeypatched at a tmp dir.
"""

from __future__ import annotations

import json

import pytest

from balabot import orgs as orgs_mod
from balabot import skills_registry as sr


@pytest.fixture
def reg(tmp_path, monkeypatch):
    data_root = tmp_path / "data"
    data_root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    return data_root


def _write_cron(reg, jobs):
    d = reg / "cron"
    d.mkdir(parents=True, exist_ok=True)
    (d / "jobs.json").write_text(json.dumps({"jobs": jobs}), encoding="utf-8")


def _write_usage(reg, entries):
    d = reg / "skills"
    d.mkdir(parents=True, exist_ok=True)
    (d / "usage-ledger.json").write_text(json.dumps({"entries": entries}), encoding="utf-8")


# ---- two classes ------------------------------------------------------------


def test_learned_vs_brought_records(reg):
    sr.install_skill("auto-fix", origin="learned", scope="bot", bot_id="steve")
    sr.install_skill("hand-made", origin="brought", scope="org", source="authored")
    sr.install_skill("from-repo", origin="brought", scope="bot", bot_id="steve",
                     source="skills.sh")
    sr.install_skill("from-hub", origin="brought", scope="org", source="hub")
    kinds = {r["name"]: r["origin"] for r in sr._load_records()}
    assert kinds == {"auto-fix": "learned", "hand-made": "brought",
                     "from-repo": "brought", "from-hub": "brought"}


def test_invalid_origin_and_source_rejected(reg):
    with pytest.raises(ValueError):
        sr.install_skill("x", origin="alien")
    with pytest.raises(ValueError):
        sr.install_skill("x", origin="learned", source="hub")
    with pytest.raises(ValueError):
        sr.install_skill("x", origin="brought", source="npm")


def test_record_shape(reg):
    rec = sr.install_skill("auto-fix", origin="learned", scope="bot", bot_id="steve")
    assert set(rec) >= {"name", "origin", "scope", "state", "pinned", "usage",
                        "last_used", "quarantined"}
    assert rec["state"] == "active"
    assert rec["pinned"] is False
    assert rec["quarantined"] is False


# ---- precedence resolver -----------------------------------------------------


def _org_fixture(reg):
    orgs_mod.add_org("balacode", "Balacode", members=["steve", "jim"])
    return "balacode"


def test_four_tiers_win_on_collision(reg):
    _org_fixture(reg)
    # same skill name at all four tiers
    sr.install_skill("deploy", origin="learned", scope="bot", bot_id="jim",
                     source="authored")  # jim-own (not steve's)
    sr.install_skill("deploy", origin="learned", scope="bot", bot_id="steve")
    sr.install_skill("deploy", origin="brought", scope="org-selected",
                     source="authored")
    sr.install_skill("deploy", origin="brought", scope="org", source="authored")
    orgs_mod.grant("steve", {"kind": "skill", "name": "deploy"},
                   subject_org="balacode", scope="bot")  # specific grant
    orgs_mod.grant("steve", {"kind": "skill", "name": "deploy"},
                   subject_org="balacode", scope="org")  # all-bots grant

    steve = sr.resolve("steve")
    deploy = next(r for r in steve if r["name"] == "deploy")
    assert deploy["precedence_tier"] == "bot-own"
    # and the winning record is steve's bot-own record
    assert deploy["bot_id"] == "steve"


def test_grant_specific_beats_grant_all(reg):
    _org_fixture(reg)
    sr.install_skill("deploy", origin="brought", scope="org-selected",
                     source="authored")
    orgs_mod.grant("steve", {"kind": "skill", "name": "deploy"},
                   subject_org="balacode", scope="org")
    orgs_mod.grant("steve", {"kind": "skill", "name": "deploy"},
                   subject_org="balacode", scope="bot")
    deploy = next(r for r in sr.resolve("steve") if r["name"] == "deploy")
    assert deploy["precedence_tier"] == "org-grant-specific"


def test_grant_all_tier(reg):
    _org_fixture(reg)
    sr.install_skill("deploy", origin="brought", scope="org-selected",
                     source="authored")
    orgs_mod.grant("steve", {"kind": "skill", "name": "deploy"},
                   subject_org="balacode", scope="org")
    deploy = next(r for r in sr.resolve("steve") if r["name"] == "deploy")
    assert deploy["precedence_tier"] == "org-grant-all"


def test_global_tier_and_all_four_tiers_reported(reg):
    _org_fixture(reg)
    sr.install_skill("deploy", origin="brought", scope="org", source="authored")
    steve = sr.resolve("steve")
    deploy = next(r for r in steve if r["name"] == "deploy")
    assert deploy["precedence_tier"] == "global"
    assert set(sr.TIERS) == {
        "bot-own", "org-grant-specific", "org-grant-all", "global"}


def test_bot_private_skill_invisible_to_other_bot(reg):
    _org_fixture(reg)
    sr.install_skill("secret-sauce", origin="learned", scope="bot", bot_id="steve")
    assert sr.resolve("steve")
    assert sr.resolve("jim") == []


def test_org_selected_without_grant_not_visible(reg):
    _org_fixture(reg)
    sr.install_skill("deploy", origin="brought", scope="org-selected",
                     source="authored")
    assert sr.resolve("steve") == []


# ---- quarantine lane ----------------------------------------------------------


def test_quarantine_inert_then_promoted(reg):
    _org_fixture(reg)
    rec = sr.install_third_party("risky-skill", source="skills.sh")
    assert rec["quarantined"] is True
    assert rec["scope"] is None
    assert rec["state"] == "active"
    # nothing in quarantine may appear in resolve()
    assert sr.resolve("steve") == []

    promoted = sr.approve("risky-skill", scope="org")
    assert promoted["quarantined"] is False
    assert promoted["scope"] == "org"
    names = [r["name"] for r in sr.resolve("steve")]
    assert "risky-skill" in names


def test_cannot_approve_nonexistent_or_nonquarantined(reg):
    with pytest.raises(KeyError):
        sr.approve("nope", scope="org")
    sr.install_skill("normal", origin="brought", scope="org", source="authored")
    with pytest.raises(ValueError):
        sr.approve("normal", scope="org")


# ---- honest usage / empty state -------------------------------------------------


def test_no_ledger_means_no_usage_data(reg):
    sr.install_skill("s", origin="learned", scope="org", source="authored")
    out = sr.load_usage_ledger()
    assert out["exists"] is False
    assert out["note"] == "no usage data"
    assert sr.usage_for("s") == {"exists": False, "note": "no usage data"}
    resolved = sr.resolve("steve")[0]
    assert resolved["usage"] == "no usage data"


def test_real_usage_is_recorded_and_shown(reg):
    _org_fixture(reg)
    sr.install_skill("s", origin="learned", scope="org", source="authored")
    sr.record_usage("s", views=3, uses=1, patches=0)
    assert sr.usage_for("s") == {"exists": True, "views": 3, "uses": 1,
                                 "patches": 0}
    resolved = sr.resolve("steve")[0]
    assert resolved["usage"]["views"] == 3


def test_curate_reports_missing_state_files(reg):
    sr.install_skill("s", origin="learned", scope="org", source="authored")
    report = sr.curate(dry_run=True)
    assert report["usage_ledger_exists"] is False
    assert report["usage_note"] == "no usage data"
    assert report["cron_state_exists"] is False


# ---- curator protections --------------------------------------------------------


def _aged_learned(reg, name, *, pinned=False, source=None, created="2026-07-01T00:00:00Z",
                  last_used=None, state="active"):
    rec = sr.install_skill(name, origin="learned", scope="org", source=source)
    if pinned:
        sr.pin(name)
    # backdate the record so idle thresholds trip
    recs = sr._load_records()
    r = sr._find(recs, name)
    r["created_at"] = created
    r["last_used"] = last_used or created
    if state != "active":
        r["state"] = state
        r["updated_at"] = created
    sr._save_records_now(recs)
    return r


NOW = "2026-09-27T00:00:00Z"  # ~88 days after created


def test_curate_moves_active_to_stale_to_archived(reg):
    _aged_learned(reg, "old-skill")
    report = sr.curate(dry_run=True, now=NOW)
    assert report["planned_changes"] == [
        {"name": "old-skill", "from_state": "active", "to_state": "stale",
         "idle_days": report["planned_changes"][0]["idle_days"]}]
    # dry-run does NOT mutate
    assert sr.get_record("old-skill")["state"] == "active"

    applied = sr.curate(dry_run=False, now=NOW)
    assert applied["applied"] is True
    assert sr.get_record("old-skill")["state"] == "stale"

    # further 60+ days of staleness -> archive
    recs = sr._load_records()
    r = sr._find(recs, "old-skill")
    r["updated_at"] = "2026-06-01T00:00:00Z"
    sr._save_records_now(recs)
    sr.curate(dry_run=False, now=NOW)
    assert sr.get_record("old-skill")["state"] == "archived"


def test_protection_pinned(reg):
    _aged_learned(reg, "pinned-skill", pinned=True)
    report = sr.curate(dry_run=True, now=NOW)
    assert not report["planned_changes"]
    assert report["protected"] == [
        {"name": "pinned-skill", "state": "active",
         "protected_by": ["pinned"]}]
    sr.curate(dry_run=False, now=NOW)
    assert sr.get_record("pinned-skill")["state"] == "active"
    assert sr.get_record("pinned-skill")["pinned"] is True


def test_protection_hub_installed(reg):
    # hub skills are 'brought' + hub source: the registry even refuses to
    # mislabel them learned, and the curator never touches brought at all.
    with pytest.raises(ValueError):
        sr.install_skill("hub-skill", origin="learned", scope="org", source="hub")
    sr.install_skill("hub-skill", origin="brought", scope="org", source="hub")
    recs = sr._load_records()
    r = sr._find(recs, "hub-skill")
    r["created_at"] = "2026-01-01T00:00:00Z"
    r["last_used"] = "2026-01-01T00:00:00Z"
    sr._save_records_now(recs)
    report = sr.curate(dry_run=True, now=NOW)
    assert not report["planned_changes"]
    sr.curate(dry_run=False, now=NOW)
    assert sr.get_record("hub-skill")["state"] == "active"


def test_protection_cron_referenced(reg):
    _aged_learned(reg, "cron-skill")
    _write_cron(reg, [{"id": "j1", "cmd": "run cron-skill daily"}])
    report = sr.curate(dry_run=True, now=NOW)
    assert not report["planned_changes"]
    assert report["protected"] == [
        {"name": "cron-skill", "state": "active",
         "protected_by": ["cron-referenced"]}]
    sr.curate(dry_run=False, now=NOW)
    assert sr.get_record("cron-skill")["state"] == "active"


def test_never_deletes_only_archives(reg):
    _aged_learned(reg, "very-old", created="2026-01-01T00:00:00Z")
    recs = sr._load_records()
    r = sr._find(recs, "very-old")
    r["state"] = "stale"
    r["updated_at"] = "2026-01-01T00:00:00Z"
    sr._save_records_now(recs)
    report = sr.curate(dry_run=False, now=NOW)
    assert report["deleted"] == []
    assert sr.get_record("very-old") is not None  # still present, archived
    assert sr.get_record("very-old")["state"] == "archived"


def test_brought_skills_never_touched_by_curator(reg):
    sr.install_skill("hand-made", origin="brought", scope="org",
                     source="authored")
    recs = sr._load_records()
    r = sr._find(recs, "hand-made")
    r["created_at"] = "2026-01-01T00:00:00Z"
    r["last_used"] = "2026-01-01T00:00:00Z"
    sr._save_records_now(recs)
    report = sr.curate(dry_run=False, now=NOW)
    assert not report["planned_changes"]
    assert not report["protected"]
    assert sr.get_record("hand-made")["state"] == "active"


def test_cron_protection_rechecked_at_apply_time(reg):
    """A skill protected when the plan was made stays protected at apply."""
    _aged_learned(reg, "late-cron")
    # plan without cron ref
    report = sr.curate(dry_run=True, now=NOW)
    assert report["planned_changes"]
    # cron appears BEFORE apply; curate(dry_run=False) re-verifies and skips
    _write_cron(reg, [{"id": "j1", "cmd": "call late-cron"}])
    sr.curate(dry_run=False, now=NOW)
    assert sr.get_record("late-cron")["state"] == "active"


    _org_fixture(reg)
    sr.install_skill("s", origin="learned", scope="org", source="authored")
    blob = json.dumps(sr._load_records()) + json.dumps(sr.load_usage_ledger())
    assert "STRIPE" not in blob and "secret_value" not in blob


# ── HTTP endpoints integration ───────────────────────────────────────────────

def test_skills_http_pin_promote_curate(reg, monkeypatch):
    from fastapi.testclient import TestClient
    from ui import server

    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    monkeypatch.setattr(server, "container_ok", lambda: True)

    def _fake_org_run(snippet, payload=None, timeout=30.0):
        import io, contextlib, os
        if payload is not None:
            os.environ["_BALABOT_ORG_PAYLOAD"] = json.dumps(payload)
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                exec(compile(snippet, "<test>", "exec"), {})
        finally:
            os.environ.pop("_BALABOT_ORG_PAYLOAD", None)
        printed = [ln for ln in buf.getvalue().splitlines() if ln.strip()]
        return json.loads(printed[-1])

    monkeypatch.setattr(server, "_org_run", _fake_org_run)
    client = TestClient(server.app)
    client.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw

    # 1. Pin a skill
    resp = client.post("/api/org/skills/pin", json={"name": "test-skill", "pinned": True})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["record"]["name"] == "test-skill"
    assert data["record"]["pinned"] is True

    # 2. Unpin the skill
    resp = client.post("/api/org/skills/pin", json={"name": "test-skill", "pinned": False})
    assert resp.status_code == 200
    assert resp.json()["record"]["pinned"] is False

    # 3. Promote a skill
    resp = client.post("/api/org/skills/promote", json={"name": "test-quarantined", "share": "org"})
    assert resp.status_code == 200
    assert resp.json()["record"]["scope"] == "org"
    assert resp.json()["record"]["quarantined"] is False

    # 4. Curate skills
    resp = client.post("/api/org/skills/curate", json={"dry_run": True})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "applied" in resp.json()["report"]

