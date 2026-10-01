"""Unit tests for balabot.approvals' OKF vault artifacts.

The vault artifact is the human-readable decision record for one effect key
(W5-10). These tests pin the properties the ledger rows cannot: one artifact
per key, written on a human decision, queryable by effect key (W9-6), and
idempotent on replay (W9-14).
"""

from __future__ import annotations

import pytest

from balabot import approvals


@pytest.fixture
def vault_env(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    db = tmp_path / "approvals.db"
    monkeypatch.setenv("BALABOT_VAULT_DIR", str(vault))
    monkeypatch.setenv("BALABOT_APPROVALS_DB", str(db))
    return {"vault": vault, "db": db}


def _key(tool: str = "message_agent", scope: str = "s1") -> str:
    return approvals.effect_key(tool, {"to": "bob"}, scope)


def test_vault_artifact_written_on_approve_and_queryable_by_key(vault_env, monkeypatch):
    """A refused mutation, then an owner approval, lands ONE OKF artifact that
    carries the decision, actor, tool/scope and canonical args hash.
    Fails if: approvals live only as SQLite rows and no artifact is written."""
    monkeypatch.setenv("BALABOT_APPROVALS_ENFORCE", "1")
    key = _key()
    verdict = approvals.check_mutation("message_agent", {"to": "bob"}, scope="s1")
    assert verdict["decision"] == "refused"

    approvals.approve(key, by="owner")
    art = approvals.vault_artifact(key)
    assert art is not None
    assert art["effect_key"] == key
    assert art["type"] == "decision"
    assert art["actor"] == "owner"
    assert art["action"] == "approve"
    assert art["tool"] == "message_agent"
    assert art["scope"] == "s1"
    assert art["args_hash"]
    assert art["timestamp"]


def test_vault_artifact_idempotent_on_replay(vault_env):
    """Replaying the SAME decision for one effect key never creates a second
    artifact and never rewrites the first (W9-14).
    Fails if: a replay writes a duplicate artifact or mutates the original."""
    key = _key()
    first_out = approvals.approve(key, by="owner")
    assert first_out["vault_artifact"]["created"] is True
    path = approvals.vault_artifact_path(key)
    first = path.read_bytes()

    replay_out = approvals.approve(key, by="owner")  # exact replay

    assert replay_out["vault_artifact"]["created"] is False
    assert replay_out["vault_artifact"]["updated"] is False
    assert len(list(vault_env["vault"].glob("*.md"))) == 1
    assert path.read_bytes() == first


def test_vault_artifact_supersedes_on_different_decision(vault_env):
    """A later DIFFERENT decision supersedes the single artifact, so the vault
    record never contradicts the ledger. Still exactly one file per key."""
    key = _key()
    approvals.approve(key, by="owner")
    approvals.deny(key, by="owner", note="changed my mind")

    art = approvals.vault_artifact(key)
    assert art["action"] == "deny"
    assert art["detail"] == "changed my mind"
    assert len(list(vault_env["vault"].glob("*.md"))) == 1
