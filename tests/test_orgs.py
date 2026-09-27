"""Tests for balabot.orgs — the org/grant/secret registry.

All tests point BALABOT_DATA_ROOT at a tmp dir so nothing touches the real
filesystem, and assert the hard rule: no secret VALUE ever escapes any
function's output.
"""

from __future__ import annotations

import io
import json
import os
import stat
from contextlib import redirect_stdout

import pytest

from balabot import orgs

SECRET_VALUE = "sk-live-SUPERSECRET-9f2a"
FINGERPRINT = "…" + SECRET_VALUE[-4:]


@pytest.fixture
def data_root(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(root))
    return root


@pytest.fixture
def two_orgs(data_root):
    orgs.add_org("balacode", "Balacode", members=["principal", "governor"])
    orgs.add_org("acme", "Acme", members=["oscar"])
    return data_root


# ---- paths & laziness ----

def test_no_files_created_at_import(data_root):
    assert not (data_root / "orgs").exists()
    assert not (data_root / ".secrets").exists()
    assert orgs.load() == {"version": 1, "orgs": {}, "secrets": [], "grants": []}


def test_load_returns_default_shape_when_absent(data_root):
    reg = orgs.load()
    assert set(reg) == {"version", "orgs", "secrets", "grants"}


# ---- fingerprint ----

def test_fingerprint_is_last_four_only():
    assert orgs.fingerprint(SECRET_VALUE) == FINGERPRINT
    assert "SUPERSECRET" not in orgs.fingerprint(SECRET_VALUE)


# ---- orgs ----

def test_add_and_list_orgs(two_orgs):
    listed = orgs.list_orgs()
    assert [o["id"] for o in listed] == ["acme", "balacode"]
    assert listed[1]["members"] == ["principal", "governor"]
    assert all("created_at" in o for o in listed)


def test_add_org_duplicate_rejected(two_orgs):
    with pytest.raises(ValueError):
        orgs.add_org("balacode", "again")


def test_add_bot(two_orgs):
    org = orgs.add_bot("balacode", "jim")
    assert "jim" in org["members"]
    orgs.add_bot("balacode", "jim")  # idempotent
    assert orgs.add_bot("balacode", "jim")["members"].count("jim") == 1


def test_show_org_includes_live_grants_only(two_orgs):
    orgs.store_secret("STRIPE_SECRET_KEY", "balacode", SECRET_VALUE)
    g = orgs.grant("oscar", {"kind": "secret", "name": "STRIPE_SECRET_KEY",
                             "org": "balacode"}, subject_org="acme")
    shown = orgs.show_org("balacode")
    assert shown["id"] == "balacode"
    assert g["id"] in [x["id"] for x in shown["grants"]]
    orgs.revoke(g["id"])
    shown = orgs.show_org("balacode")
    assert shown["grants"] == []
    assert orgs.show_org("nope") is None


# ---- secrets ----

POSIX = os.name == "posix"  # Windows filesystems ignore POSIX mode bits

def test_store_secret_writes_0600_and_fingerprint(two_orgs):
    rec = orgs.store_secret("STRIPE_SECRET_KEY", "balacode", SECRET_VALUE)
    assert rec["fingerprint"] == FINGERPRINT
    assert "value" not in rec
    path = two_orgs / ".secrets" / "balacode" / "STRIPE_SECRET_KEY"
    assert path.read_text(encoding="utf-8") == SECRET_VALUE
    if POSIX:
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_register_secret_records_metadata_only(two_orgs):
    rec = orgs.register_secret("STRIPE_SECRET_KEY", "balacode",
                               description="stripe api key")
    assert rec["fingerprint"] == "…"  # no stored value yet
    assert rec["description"] == "stripe api key"
    # fingerprint computed from stored value once one exists
    orgs.store_secret("STRIPE_SECRET_KEY", "balacode", SECRET_VALUE)
    rec = orgs.register_secret("STRIPE_SECRET_KEY", "balacode")
    assert rec["fingerprint"] == FINGERPRINT


def test_store_secret_unknown_org_rejected(two_orgs):
    with pytest.raises(KeyError):
        orgs.store_secret("X", "ghost", "value")


# ---- validation ----

def test_grant_rejects_bad_access_and_scope(two_orgs):
    with pytest.raises(ValueError, match="access"):
        orgs.grant("principal", {"kind": "secret", "name": "X"},
                   subject_org="balacode", access="admin")
    with pytest.raises(ValueError, match="scope"):
        orgs.grant("principal", {"kind": "secret", "name": "X"},
                   subject_org="balacode", scope="world")
    with pytest.raises(ValueError, match="kind"):
        orgs.grant("principal", {"kind": "token", "name": "X"}, subject_org="balacode")


# ---- grants & cross-org ----

def test_grant_defaults_and_shape(two_orgs):
    g = orgs.grant("principal", {"kind": "secret", "name": "STRIPE"}, subject_org="balacode")
    assert g["subject_org"] == "balacode"
    assert g["resource_org"] == "balacode"
    assert g["scope"] == "bot"
    assert g["access"] == "inject"
    assert g["revoked_at"] is None


def test_cross_org_grant_through_same_path(two_orgs):
    """A bot in org A granted a secret in org B — same grant path, no special
    case, and secrets_visible_to reports the origin org."""
    orgs.store_secret("ACME_API_TOKEN", "acme", "acme-token-value-4242")
    g = orgs.grant(
        "principal",  # bot in balacode
        {"kind": "secret", "name": "ACME_API_TOKEN", "org": "acme"},
        subject_org="balacode",
    )
    assert g["subject_org"] == "balacode"
    assert g["resource_org"] == "acme"  # cross-org: subject_org != resource_org

    visible = orgs.secrets_visible_to("principal")
    match = [r for r in visible if r["name"] == "ACME_API_TOKEN"]
    assert match and match[0]["org"] == "acme"
    assert match[0]["fingerprint"] == "…" + "4242"
    assert match[0]["granted"] is True

    # and a bot with no grants sees nothing
    assert orgs.secrets_visible_to("oscar") == []


def test_grants_for_live_only_and_kind_filter(two_orgs):
    orgs.add_org("k", "K", members=[])
    orgs.store_secret("S", "balacode", SECRET_VALUE)
    g1 = orgs.grant("principal", {"kind": "secret", "name": "S"}, subject_org="balacode")
    g2 = orgs.grant("principal", {"kind": "skill", "name": "demo"}, subject_org="balacode")
    live = orgs.grants_for("principal")
    assert {g["id"] for g in live} == {g1["id"], g2["id"]}
    assert [g["id"] for g in orgs.grants_for("principal", kind="secret")] == [g1["id"]]
    orgs.revoke(g1["id"])
    assert g1["id"] not in [g["id"] for g in orgs.grants_for("principal")]


def test_org_scope_grant_covers_all_bots_in_org(two_orgs):
    g = orgs.grant("principal", {"kind": "skill", "name": "demo"},
                   subject_org="balacode", scope="org")
    ids = [x["id"] for x in orgs.grants_for("governor")]
    assert g["id"] in ids  # org-scope grant covers every bot in the org


def test_revoke_sets_revoked_at_never_deletes(two_orgs):
    g = orgs.grant("principal", {"kind": "secret", "name": "S"}, subject_org="balacode")
    assert orgs.revoke(g["id"]) is True
    reg = orgs.load()
    assert len(reg["grants"]) == 1  # record kept, not deleted
    assert reg["grants"][0]["revoked_at"] is not None
    assert orgs.revoke("g_missing") is False


# ---- atomic save & permissions ----

def test_save_is_atomic_and_0600(two_orgs):
    reg = orgs.load()
    reg["orgs"]["x"] = {"id": "x", "name": "X", "members": [], "computer": None,
                        "created_at": "now"}
    orgs.save(reg)
    path = two_orgs / "orgs" / "registry.json"
    if POSIX:
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert json.loads(path.read_text(encoding="utf-8"))["orgs"]["x"]["id"] == "x"
    leftovers = [p for p in (two_orgs / "orgs").iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []


# ---- THE hard rule: no value ever leaks ----

def _all_public_outputs(two_orgs) -> str:
    """Exercise every public read path and collect stdout/return reprs."""
    orgs.store_secret("STRIPE_SECRET_KEY", "balacode", SECRET_VALUE)
    orgs.grant("principal", {"kind": "secret", "name": "STRIPE_SECRET_KEY",
                             "org": "balacode"}, subject_org="balacode")
    chunks = []

    def call(fn, *a, **kw):
        buf = io.StringIO()
        with redirect_stdout(buf):
            result = fn(*a, **kw)
        chunks.append(buf.getvalue())
        chunks.append(repr(result))
        return result

    call(orgs.load)
    call(orgs.list_orgs)
    call(orgs.show_org, "balacode")
    call(orgs.add_org, "tmpo", "Tmp", members=[])
    call(orgs.add_bot, "balacode", "jim")
    call(orgs.register_secret, "STRIPE_SECRET_KEY", "balacode", description="d")
    call(orgs.grant, "jim", {"kind": "secret", "name": "STRIPE_SECRET_KEY"},
         subject_org="balacode")
    call(orgs.grants_for, "jim")
    call(orgs.secrets_visible_to, "jim")
    call(orgs.revoke, "g_missing")
    call(orgs.fingerprint, SECRET_VALUE)
    # CLI output too
    call(orgs.main, ["list"])
    call(orgs.main, ["grants"])
    call(orgs.main, ["show", "balacode"])
    # registry file contents (metadata store) must not carry the value either
    chunks.append((two_orgs / "orgs" / "registry.json").read_text(encoding="utf-8"))
    return "\n".join(chunks)


def test_secret_value_never_in_any_output(two_orgs):
    output = _all_public_outputs(two_orgs)
    assert SECRET_VALUE not in output
    assert "SUPERSECRET" not in output
    assert FINGERPRINT in output  # fingerprint is the sanctioned view
