"""Tests for the per-org fleet resolver (balabot.fleet)."""

from __future__ import annotations

import json
import pathlib
import sys

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from balabot import fleet as fleet_mod  # noqa: E402
from balabot.fleet import FleetError  # noqa: E402

BALACODE = "balacode"


def _manifest(org: str, entries: list[dict]) -> dict:
    return {
        "version": 1,
        "org": org,
        "container": f"agent-computer-{org}",
        "agents": entries,
    }


@pytest.fixture
def fleet_env(tmp_path, monkeypatch):
    d = tmp_path / "fleet"
    d.mkdir()
    monkeypatch.setenv("BALABOT_FLEET_DIR", str(d))
    return d


# --- shipped manifest -------------------------------------------------------


def test_shipped_balacode_manifest_parses():
    m = fleet_mod.load(BALACODE)
    assert m.org == BALACODE
    assert m.container
    assert set(m.agents) >= {"principal", "governor"}


def test_shipped_manifest_declares_one_display_per_agent():
    m = fleet_mod.load(BALACODE)
    displays = [a["display"] for a in m.agents.values()]
    sockets = [a["socket"] for a in m.agents.values()]
    assert len(set(displays)) == len(displays), "agents must not share a display"
    assert len(set(sockets)) == len(sockets), "agents must not share a socket"


# --- resolution -------------------------------------------------------------


def test_for_agent_resolves_principal_and_governor():
    principal = fleet_mod.for_agent("principal", BALACODE)
    governor = fleet_mod.for_agent("governor", BALACODE)
    assert principal["display"] == ":1"
    assert principal["socket"].endswith("/principal.sock")
    assert governor["display"] == ":2"
    assert governor["socket"].endswith("/governor.sock")


def test_for_agent_returns_copy_not_internal_state():
    entry = fleet_mod.for_agent("principal", BALACODE)
    entry["display"] = ":999"
    assert fleet_mod.for_agent("principal", BALACODE)["display"] != ":999"


def test_agents_lists_all_declared():
    got = fleet_mod.agents(BALACODE)
    ids = [a["id"] for a in got]
    assert "principal" in ids and "governor" in ids
    assert len(ids) == len(set(ids))


# --- honest failure ---------------------------------------------------------


def test_unknown_org_raises(fleet_env):
    with pytest.raises(FleetError, match="no fleet manifest for org"):
        fleet_mod.load("nonexistent")


def test_unknown_agent_raises(fleet_env):
    (fleet_env / "acme.json").write_text(
        json.dumps(_manifest("acme", [{"id": "alpha", "display": ":1", "socket": "/run/cua-driver/alpha.sock"}])),
        encoding="utf-8",
    )
    with pytest.raises(FleetError, match="not declared"):
        fleet_mod.for_agent("beta", "acme")


def test_empty_org_raises():
    with pytest.raises(FleetError):
        fleet_mod.load("")


def test_malformed_manifest_raises(fleet_env):
    (fleet_env / "broken.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(FleetError, match="invalid JSON"):
        fleet_mod.load("broken")


def test_manifest_without_agents_raises(fleet_env):
    (fleet_env / "empty.json").write_text(
        json.dumps({"version": 1, "org": "empty", "container": "c", "agents": []}),
        encoding="utf-8",
    )
    with pytest.raises(FleetError):
        fleet_mod.load("empty")


def test_manifest_org_mismatch_raises(fleet_env):
    (fleet_env / "liar.json").write_text(
        json.dumps(_manifest("acme", [{"id": "alpha", "display": ":1", "socket": "/s.sock"}])),
        encoding="utf-8",
    )
    with pytest.raises(FleetError, match="does not match filename"):
        fleet_mod.load("liar")


# --- no cross-org collisions ------------------------------------------------


def test_overlapping_agent_ids_across_orgs_do_not_collide(fleet_env):
    (fleet_env / "orga.json").write_text(
        json.dumps(_manifest("orga", [{"id": "principal", "display": ":1", "socket": "/run/cua-driver/principal.sock"}])),
        encoding="utf-8",
    )
    (fleet_env / "orgb.json").write_text(
        json.dumps(_manifest("orgb", [{"id": "principal", "display": ":7", "socket": "/run/cua-driver/principal.sock"}])),
        encoding="utf-8",
    )
    a = fleet_mod.for_agent("principal", "orga")
    b = fleet_mod.for_agent("principal", "orgb")
    assert a["display"] == ":1" and b["display"] == ":7"
    assert a is not b


def test_shared_display_within_one_org_is_refused(fleet_env):
    (fleet_env / "clash.json").write_text(
        json.dumps(
            _manifest(
                "clash",
                [
                    {"id": "alpha", "display": ":1", "socket": "/run/a.sock"},
                    {"id": "beta", "display": ":1", "socket": "/run/b.sock"},
                ],
            )
        ),
        encoding="utf-8",
    )
    with pytest.raises(FleetError, match="share display"):
        fleet_mod.load("clash")


def test_shared_socket_within_one_org_is_refused(fleet_env):
    (fleet_env / "clash2.json").write_text(
        json.dumps(
            _manifest(
                "clash2",
                [
                    {"id": "alpha", "display": ":1", "socket": "/run/same.sock"},
                    {"id": "beta", "display": ":2", "socket": "/run/same.sock"},
                ],
            )
        ),
        encoding="utf-8",
    )
    with pytest.raises(FleetError, match="share socket"):
        fleet_mod.load("clash2")


def test_invalid_display_format_refused(fleet_env):
    (fleet_env / "bad.json").write_text(
        json.dumps(_manifest("bad", [{"id": "alpha", "display": "1", "socket": "/s.sock"}])),
        encoding="utf-8",
    )
    with pytest.raises(FleetError, match="invalid display"):
        fleet_mod.load("bad")


def test_relative_socket_refused(fleet_env):
    (fleet_env / "bad2.json").write_text(
        json.dumps(_manifest("bad2", [{"id": "alpha", "display": ":1", "socket": "cua-driver/x.sock"}])),
        encoding="utf-8",
    )
    with pytest.raises(FleetError, match="invalid socket"):
        fleet_mod.load("bad2")
