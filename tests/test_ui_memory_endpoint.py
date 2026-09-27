"""Tests for the /api/memory endpoint's honest data mapping.

Ground truth (verified by docker exec into balabot-balabot-1, read-only):
  /opt/data/profiles/principal/memory_store.db with tables
  facts, entities, fact_entities, memory_banks, facts_fts*.
There is no mem_<p>.db in the container. The endpoint must join real entity
names and never relabel category/tags as entity data.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "ui"))

import server  # noqa: E402


def test_memory_joins_real_entities(monkeypatch):
    monkeypatch.setattr(server, "container_ok", lambda: True)

    def fake_sqlite_json(path, sql):
        assert "memory_store.db" in path, path
        if "group_concat" in sql:
            return [["f1", "content", "user_pref", "a,b", 0.5, 2,
                     "2026-09-27 05:18:41", "Chief of Staff"]]
        return [[1, 0]]  # entity/bank counts

    monkeypatch.setattr(server, "sqlite_json", fake_sqlite_json)
    out = server.memory()
    assert out["available"] is True
    row = out["facts"][0]
    assert row["entity"] == "Chief of Staff"      # real joined entity name
    assert row["resolvedTo"] == "—"               # store has no such concept
    assert row["category"] == "user_pref"         # reported as itself
    assert row["tags"] == "a,b"
    assert out["entitiesCount"] == 1


def test_memory_unavailable_when_container_down(monkeypatch):
    monkeypatch.setattr(server, "container_ok", lambda: False)
    out = server.memory()
    assert out["available"] is False
    assert out["reason"]  # non-empty reason, HTTP 200 via FastAPI
