"""Drain spool error handling — proposals MUST NOT vanish silently.

Real-world bug: `drain_spool()` unlinks the spool file in `finally:` — so when
an unexpected exception (e.g. OSError writing proposals.json) propagates, the
spool file is already deleted and the proposal is lost. The callers in
ui/server.py then swallow with `except Exception: pass`, making it invisible.

This test proves:
1. A duplicate (CreationError) is discarded AND the discard is REPORTED.
2. An unexpected error leaves the spool file IN PLACE and surfaces the error.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from balabot import bot_creation as bc


@pytest.fixture()
def env(tmp_path, monkeypatch, fake_repo):
    """Isolated data root + spool dir."""
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(root))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes_home"))
    (tmp_path / "hermes_home").mkdir()
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    return {"root": root, "repo": fake_repo, "spool": root / bc.SPOOL_SUBDIR}


def test_drain_duplicate_is_discarded_and_reported(env):
    """A duplicate (same bot_id already 'proposed') is a CreationError — the
    spool file MUST be removed, but the outcome MUST be REPORTED, not silent."""
    # Create a real proposal that will conflict
    bc.propose_bot(name="Scout", role="research", proposed_by="principal")
    # Spool a duplicate
    rec = bc.spool_proposal(name="Scout", role="research", proposed_by="user")
    spool_path = env["spool"] / f"{rec['id']}.json"
    assert spool_path.exists()
    # Drain: the duplicate is discarded (removed from spool)
    result = bc.drain_spool()
    # MUST NOT be silent: the result MUST indicate what was discarded
    # (If the function returns only the successfully drained proposals, a
    # discarded item is invisible — this is the BUG.)
    # The fix MUST return a structure that reports discarded items too.
    # For now, expect: result is a dict with 'drained' and 'discarded' lists.
    assert isinstance(result, dict), (
        "drain_spool must return a dict with drained + discarded"
    )
    assert "drained" in result, "result must have 'drained' key"
    assert "discarded" in result, "result must have 'discarded' key"
    assert len(result["drained"]) == 0, "duplicate should not be in drained list"
    assert len(result["discarded"]) == 1, "duplicate must be in discarded list"
    discarded = result["discarded"][0]
    assert discarded["bot_id"] == "scout"
    assert "reason" in discarded, "discarded item must report a reason"
    # The spool file SHOULD be removed (deliberate discard)
    assert not spool_path.exists(), "discarded spool file should be removed"


def test_drain_unexpected_error_leaves_spool_file_and_propagates(env):
    """An unexpected exception (not CreationError) MUST leave the spool file
    IN PLACE and MUST propagate the error (not swallow it)."""
    rec = bc.spool_proposal(name="Keeper", role="retention", proposed_by="user")
    spool_path = env["spool"] / f"{rec['id']}.json"
    assert spool_path.exists()
    # Mock _save to raise an OSError (e.g. disk full, permission denied)
    with patch("balabot.bot_creation._save", side_effect=OSError("disk full")):
        with pytest.raises(OSError, match="disk full"):
            bc.drain_spool()
    # The spool file MUST still exist (proposal NOT lost)
    assert spool_path.exists(), "spool file must remain after unexpected error"
    content = json.loads(spool_path.read_text(encoding="utf-8"))
    assert content["name"] == "Keeper"


def test_drain_successful_removes_spool_and_returns_drained(env):
    """A successful drain removes the spool file and returns it in 'drained'."""
    rec = bc.spool_proposal(name="Fresh", role="new bot", proposed_by="user")
    spool_path = env["spool"] / f"{rec['id']}.json"
    assert spool_path.exists()
    result = bc.drain_spool()
    assert isinstance(result, dict)
    assert len(result["drained"]) == 1
    assert len(result["discarded"]) == 0
    assert result["drained"][0]["bot_id"] == "fresh"
    assert not spool_path.exists(), "successful drain should remove spool file"
