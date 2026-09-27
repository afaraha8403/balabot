"""Wave 6 P3 — multi-agent group mechanics (balabot/groups.py).

Binding contract under test:
- 2–6 distinct members; out of range is refused.
- @mentions route to specific members; no mention means everyone.
- SERIAL round planning is ordered, and per-member sessions are independent.
- apply_turn_results advances each member's OWN session and the shared
  transcript, and records per-member errors as explicit honest rows.
"""
from __future__ import annotations

import pytest

from balabot import groups


@pytest.fixture(autouse=True)
def data_root(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(root))
    return root


def _make(name="ops-room", members=("principal", "governor")):
    return groups.create_group(name, list(members))


# ---- creation rules ---------------------------------------------------------

def test_create_group_happy_path():
    g = _make()
    assert g["members"] == ["principal", "governor"]
    assert g["round"] == 0
    assert g["computer_agent"] == "principal"  # defaults to first member
    assert groups.get_group(g["id"])["name"] == "ops-room"


def test_create_group_rejects_out_of_range():
    with pytest.raises(groups.GroupsError):
        groups.create_group("solo", ["principal"])
    with pytest.raises(groups.GroupsError):
        groups.create_group("crowd", [f"b{i}" for i in range(7)])


def test_create_group_rejects_duplicates_and_unknown_bots():
    with pytest.raises(groups.GroupsError):
        groups.create_group("dup", ["principal", "principal"])
    with pytest.raises(groups.GroupsError):
        groups.create_group("ghost", ["principal", "ghost-bot"],
                            known_bots=["principal", "governor"])


def test_create_group_computer_agent_must_be_member():
    with pytest.raises(groups.GroupsError):
        groups.create_group("x", ["principal", "governor"],
                            computer_agent="stranger")


# ---- mentions ---------------------------------------------------------------

def test_mention_targets_routes_to_named_members_only():
    assert groups.mention_targets("hey @governor check this",
                                  ["principal", "governor"]) == ["governor"]
    # member order, not mention order
    assert groups.mention_targets("@governor then @principal",
                                  ["principal", "governor"]) == \
        ["principal", "governor"]


def test_mention_of_non_member_is_ignored_not_fatal():
    assert groups.mention_targets("@ghostbot hello",
                                  ["principal", "governor"]) == []
    # empty -> everyone speaks (the caller's rule)


def test_turn_plan_serial_order_and_per_member_isolation():
    g = _make(members=("principal", "governor", "auditor"))
    # seed different histories so isolation is observable
    g["sessions"]["principal"]["messages"] = [
        {"role": "user", "content": "principal-only context"}]
    groups._save(g)

    plan = groups.turn_plan(g["id"], "status @governor")
    assert [p["bot"] for p in plan["plan"]] == ["governor"]
    msgs = plan["plan"][0]["messages"]
    # the targeted member speaks LAST with the new user message
    assert msgs[-1]["role"] == "user" and "status @governor" in msgs[-1]["content"]
    # ...and the OTHER member's history never leaks into the payload
    assert not any("principal-only context" in m["content"]
                   for m in plan["plan"][0]["messages"][:-1])


def test_turn_plan_without_mention_targets_everyone_in_order():
    g = _make(members=("principal", "governor"))
    plan = groups.turn_plan(g["id"], "round up")
    assert [p["bot"] for p in plan["plan"]] == ["principal", "governor"]


def test_turn_plan_unknown_group():
    with pytest.raises(groups.GroupsError):
        groups.turn_plan("g_deadbeef00", "hi")


# ---- results / persistence --------------------------------------------------

def test_apply_turn_results_advances_per_member_sessions_and_round():
    g = _make(members=("principal", "governor"))
    results = [{"bot": "principal", "text": "all good"},
               {"bot": "governor", "text": "ledger updated"}]
    out = groups.apply_turn_results(g["id"], "report in", results)
    assert out["round"] == 1
    t = out["transcript"]
    assert [(e["from"], e["kind"]) for e in t] == [
        ("principal", "message"), ("governor", "message")]
    # per-member sessions: principal's history ends with its OWN reply
    p = out["sessions"]["principal"]["messages"]
    assert p[-1] == {"role": "assistant", "content": "all good"}
    assert p[-2] == {"role": "user", "content": "report in"}
    gv = out["sessions"]["governor"]["messages"]
    assert gv[-1]["content"] == "ledger updated"
    # independent: principal's history does not contain governor's reply
    assert "ledger updated" not in [m["content"] for m in p]


def test_apply_turn_results_records_errors_honestly():
    g = _make()
    results = [{"bot": "principal", "text": "ok"},
               {"bot": "governor", "error": True, "detail": "backend 503"}]
    out = groups.apply_turn_results(g["id"], "go", results)
    kinds = [(e["from"], e["kind"]) for e in out["transcript"]]
    assert ("governor", "error") in kinds
    err = next(e for e in out["transcript"] if e["kind"] == "error")
    assert "503" in err["detail"]


def test_apply_turn_results_ignores_results_from_non_members():
    g = _make()
    out = groups.apply_turn_results(
        g["id"], "go", [{"bot": "stranger", "text": "sneak in"}])
    assert all(e["from"] in g["members"] for e in out["transcript"])


def test_round_counter_is_monotonic_across_rounds():
    g = _make()
    for i in range(3):
        out = groups.apply_turn_results(
            g["id"], f"r{i}", [{"bot": "principal", "text": "ack"}])
        assert out["round"] == i + 1
    assert groups.get_group(g["id"])["round"] == 3


def test_list_and_delete():
    assert groups.list_groups() == []
    g = _make()
    rows = groups.list_groups()
    assert len(rows) == 1 and rows[0]["id"] == g["id"]
    assert groups.delete_group(g["id"]) is True
    assert groups.delete_group(g["id"]) is False
    assert groups.list_groups() == []


def test_computer_agent_shared_pane_is_part_of_group_state():
    g = groups.create_group("pane", ["principal", "governor"],
                            computer_agent="governor")
    assert groups.get_group(g["id"])["computer_agent"] == "governor"
