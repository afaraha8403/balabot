"""Wave 6 P4 — bot creation with human consent (balabot/bot_creation.py).

Binding contract under test:
- propose: metadata only, nothing provisioned.
- approve: ONLY the human operator; self-approval by the proposing bot is
  refused; approving a non-proposed row is refused.
- create: refuses anything not yet approved (the consent gate is checked at
  the point of creation), then provisions via balabot.bootstrap's real
  machinery and registers the bot in the org registry + fleet meta.
"""
from __future__ import annotations

import json

import pytest

from balabot import bot_creation as bc
from balabot import orgs


@pytest.fixture()
def env(tmp_path, monkeypatch, fake_repo):
    """Isolated data root + a fake repo with persona templates (same layout
    the shipped personas have, so provisioning has something to render)."""
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(root))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes_home"))
    (tmp_path / "hermes_home").mkdir()
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    return {"root": root, "repo": fake_repo}


def _proposal(**over):
    body = {"name": "Research Scout", "role": "finds market signals",
            "proposed_by": "principal"}
    body.update(over)
    return bc.propose_bot(**body)


def _approve(pid):
    return bc.approve_proposal(pid, approved_by=bc.HUMAN_APPROVER)


# ---- propose ----------------------------------------------------------------

def test_propose_is_metadata_only(env):
    p = _proposal()
    assert p["status"] == "proposed"
    assert p["bot_id"] == "research-scout"
    assert p["proposed_by"] == "principal"
    # nothing provisioned: no profile dir, no org member
    assert not (env["root"] / "profiles").exists() or \
        not list((env["root"] / "profiles").glob("*"))


def test_propose_duplicate_live_conflict(env):
    p = _proposal()
    with pytest.raises(bc.CreationError):
        _proposal()  # same name -> same bot_id, still 'proposed'


def test_propose_same_name_after_registration_is_allowed(env):
    p = _proposal()
    _approve(p["id"])
    bc.create_approved_bot(p["id"])
    # registered proposal no longer blocks a fresh proposal
    p2 = _proposal(role="second pass")
    assert p2["id"] != p["id"]


def test_propose_rejects_bad_input(env):
    with pytest.raises(bc.CreationError):
        _proposal(name="")
    with pytest.raises(bc.CreationError):
        _proposal(role="")
    with pytest.raises(bc.CreationError):
        bc.new_bot_id("///")


# ---- the consent gate --------------------------------------------------------

def test_only_the_human_may_approve(env):
    p = _proposal(proposed_by="governor")
    with pytest.raises(bc.CreationError):
        bc.approve_proposal(p["id"], approved_by="principal")
    with pytest.raises(bc.CreationError):
        bc.approve_proposal(p["id"], approved_by="governor")


def test_self_approval_by_the_proposing_bot_is_refused(env):
    # Even if a bot somehow lands in the approver seat, its own proposal
    # cannot be approved by itself.
    p = _proposal(proposed_by="principal")
    with pytest.raises(bc.CreationError):
        bc.approve_proposal(p["id"], approved_by="principal")


def test_cannot_create_from_a_merely_proposed_row(env):
    p = _proposal()
    with pytest.raises(bc.CreationError):
        bc.create_approved_bot(p["id"])


def test_cannot_create_from_a_rejected_row(env):
    p = _proposal()
    bc.reject_proposal(p["id"])
    with pytest.raises(bc.CreationError):
        bc.create_approved_bot(p["id"])


def test_state_machine_refuses_double_transitions(env):
    p = _proposal()
    _approve(p["id"])
    with pytest.raises(bc.CreationError):
        bc.reject_proposal(p["id"])  # approved is not re-decidable
    with pytest.raises(bc.CreationError):
        _approve(p["id"])


# ---- create + register --------------------------------------------------------

def test_create_provisions_and_registers_in_fleet_and_org(env):
    orgs.add_org("balacode", "Balacode", members=["principal", "governor"])
    p = _proposal(proposed_by="principal")
    _approve(p["id"])
    fleet: dict = {}
    row = bc.create_approved_bot(p["id"], fleet_bots=fleet)
    assert row["status"] == "registered"
    bot = row["bot"]
    assert bot["id"] == "research-scout"
    assert bot["name"] == "Research Scout"
    assert fleet["research-scout"]["id"] == "research-scout"
    # registered as an org member (fleet registration, real registry)
    assert "research-scout" in orgs.show_org("balacode")["members"]
    # real artifacts from bootstrap: profile config + workspace rules.
    # Profiles live under HERMES_HOME (env-provisioned), workspaces under the
    # data root.
    profile = (tmp_path_hermes := env["root"].parent / "hermes_home") / \
        "profiles" / "research-scout"
    assert (profile / "config.yaml").is_file()
    actions = row["created_result"]["actions"]
    assert any("config.yaml" in a for a in actions)


def test_create_refuses_an_id_already_in_the_fleet(env):
    orgs.add_org("balacode", "Balacode", members=["principal"])
    p = bc.propose_bot(name="principal", role="clone attempt",
                       proposed_by="governor")
    _approve(p["id"])
    with pytest.raises(bc.CreationError):
        bc.create_approved_bot(p["id"], fleet_bots={"principal": {"name": "P"}})


def test_proposal_store_is_durable_json(env):
    p = _proposal()
    raw = json.loads((env["root"] / "bot_creation" / "proposals.json")
                     .read_text(encoding="utf-8"))
    assert raw["proposals"][0]["id"] == p["id"]


def test_list_and_get(env):
    p = _proposal()
    assert [r["id"] for r in bc.list_proposals()] == [p["id"]]
    assert [r["id"] for r in bc.list_proposals("proposed")] == [p["id"]]
    assert [r for r in bc.list_proposals("registered")] == []
    assert bc.get_proposal(p["id"])["bot_id"] == "research-scout"
    with pytest.raises(bc.CreationError):
        bc.get_proposal("bp_nope")
