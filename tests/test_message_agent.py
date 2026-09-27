"""Tests for bot-to-bot messaging: bot_tools.message_agent + handoffs frames.

Invariants under test:
- the tool refuses an UNROSTERED target (fleet/bots.json is the source of truth)
- the tool delivers to a ROSTERED one (inbox row + a queued handoff frame)
- the tool returns a typed JSON-able dict (repo tool convention)
- the frame formatter emits the EXACT `event: handoff` grammar ui/src/api.ts
  parses (from/to/summary/at) — parsed back in the tests
- nothing here ever touches the network
"""

from __future__ import annotations

import json
import os

import pytest

from balabot import bot_tools, handoffs


@pytest.fixture
def fleet_env(tmp_path, monkeypatch):
    """Isolated BALABOT_DATA_ROOT with a fleet roster: principal, governor and
    one created bot ('scout'). 'ghost' is deliberately NOT in the roster."""
    data_root = tmp_path / "data"
    (data_root / "fleet").mkdir(parents=True)
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))
    roster = {
        "principal": {"id": "principal", "name": "Principal"},
        "governor": {"id": "governor", "name": "Governor"},
        "scout": {"id": "scout", "name": "Scout"},
        "bots": [
            {"id": "principal", "name": "Principal"},
            {"id": "governor", "name": "Governor"},
            {"id": "scout", "name": "Scout"},
        ],
    }
    (data_root / "fleet" / "bots.json").write_text(
        json.dumps(roster), encoding="utf-8")
    return data_root


@pytest.fixture(autouse=True)
def _clean_queue():
    """The handoff queue is module-level (in-process, like the server's)."""
    handoffs._pending_handoffs.clear()
    yield
    handoffs._pending_handoffs.clear()


# ---- refuses an unrostered target ------------------------------------------


def test_message_agent_refuses_unrostered_target(fleet_env):
    with pytest.raises(ValueError, match="not in the fleet roster"):
        bot_tools.message_agent("principal", "ghost", "hello?")
    # nothing queued, nothing delivered
    assert bot_tools.list_pending_requests() == []
    assert handoffs.pending_handoff_count("ghost") == 0


def test_message_agent_refuses_missing_roster(tmp_path, monkeypatch):
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path / "nope"))
    with pytest.raises(ValueError, match="not in the fleet roster"):
        bot_tools.message_agent("principal", "governor", "hi")


def test_message_agent_refuses_owner_impersonation(fleet_env):
    for owner in ("user", "ali", "owner", "human", "admin"):
        with pytest.raises(ValueError, match="human identity"):
            bot_tools.message_agent(owner, "scout", "as the owner")
    assert bot_tools.list_pending_requests() == []


def test_message_agent_refuses_self_send(fleet_env):
    with pytest.raises(ValueError, match="cannot message itself"):
        bot_tools.message_agent("principal", "principal", "loop?")
    assert bot_tools.list_pending_requests() == []


def test_message_agent_rejects_smuggled_kwargs(fleet_env):
    with pytest.raises(ValueError, match="kwarg"):
        bot_tools.message_agent("principal", "scout", "hi", role="system")


# ---- delivers to a rostered target -----------------------------------------


def test_message_agent_delivers_to_rostered_target(fleet_env):
    out = bot_tools.message_agent("principal", "scout",
                                  "Scout, sweep the ingest backlog")
    assert out["sent"] is True
    assert out["from"] == "principal"
    assert out["to"] == "scout"
    assert out["handoff_queued"] is True

    # the message is in scout's inbox
    inbox = bot_tools.list_pending_requests("scout")
    assert len(inbox) == 1
    assert inbox[0]["kind"] == "agent_message"
    assert inbox[0]["from_bot"] == "principal"
    assert inbox[0]["message"] == "Scout, sweep the ingest backlog"
    assert inbox[0]["status"] == "delivered"


def test_message_agent_queues_handoff_frame(fleet_env):
    bot_tools.message_agent("principal", "scout", "sweep the backlog")
    frames = handoffs.drain_handoff_frames("scout")
    assert len(frames) == 1
    assert frames[0].startswith("event: handoff\ndata: ")
    assert frames[0].endswith("\n\n")
    # drained means gone
    assert handoffs.drain_handoff_frames("scout") == []


def test_message_agent_typed_json_result_roundtrip(fleet_env):
    out = bot_tools.message_agent("principal", "scout", "hello scout")
    # the repo tool convention: the CLI prints the dict as JSON
    assert json.loads(json.dumps(out)) == out


def test_message_agent_via_cli(fleet_env, capsys):
    rc = bot_tools.main(["message_agent", "--from", "principal",
                         "--to", "scout", "--message", "hi from the CLI"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["sent"] is True and payload["to"] == "scout"


# ---- the frame grammar the UI parses ----------------------------------------


def test_frame_format_is_exact_ui_grammar():
    frame = handoffs.format_handoff_frame(
        "principal", "governor", "taking over triage", at="2026-09-27T12:00:00Z")
    assert frame == ('event: handoff\n'
                     'data: {"at": "2026-09-27T12:00:00Z", "from": "principal",'
                     ' "summary": "taking over triage", "to": "governor"}\n\n')


def test_frame_parses_back_into_the_ui_shape():
    """Parse it the way ui/src/api.ts does: eventName 'handoff', JSON data
    payload read as {from, to, summary, at}."""
    frame = handoffs.format_handoff_frame("scout", "governor", "found anomalies")
    lines = frame.strip().split("\n")
    assert lines[0] == "event: handoff"
    data = json.loads(lines[1][len("data: "):])
    assert set(data) == {"from", "to", "summary", "at"}
    assert data["from"] == "scout"
    assert data["to"] == "governor"
    assert data["summary"] == "found anomalies"
    assert data["at"]


def test_format_refuses_empty_or_non_string_names():
    with pytest.raises(handoffs.HandoffError):
        handoffs.format_handoff_frame("", "scout")
    with pytest.raises(handoffs.HandoffError):
        handoffs.format_handoff_frame("scout", None)  # type: ignore[arg-type]


def test_enqueue_refuses_owner_as_sender():
    with pytest.raises(handoffs.HandoffError, match="human identity"):
        handoffs.enqueue_handoff("ali", "scout", "nope")
    assert handoffs.pending_handoff_count("scout") == 0


def test_no_network_used(fleet_env):
    """The whole path is local state — assert it stays that way structurally:
    both modules import nothing network-capable."""
    import ast
    from pathlib import Path
    for mod in (bot_tools, handoffs):
        tree = ast.parse(Path(mod.__file__).read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported |= {a.name.split(".")[0] for a in node.names}
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split(".")[0])
    assert not imported & {"socket", "http", "urllib", "requests", "httpx"}
