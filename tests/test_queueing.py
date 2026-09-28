"""Tests for balabot/queueing.py — durable per-session message queue.

Covers the four guarantees this module ships: FIFO ordering, at-most-once
delivery, restart durability, and the loud-failure path on an unwritable
store. No network calls.
"""

from __future__ import annotations

import json
import sqlite3

import pytest

from balabot.queueing import (
    MessageQueue,
    QueueError,
    QueueStoreUnavailable,
    UnknownSession,
)


# ── FIFO ordering ─────────────────────────────────────────────────────────────

def test_two_messages_queued_during_one_busy_turn_arrive_in_order(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    # User sends two messages while the agent is mid-turn.
    q.enqueue("s1", "first message", message_id="m1")
    q.enqueue("s1", "second message", message_id="m2")
    assert q.pending_count("s1") == 2

    drained = q.drain("s1")
    assert [m["content"] for m in drained] == ["first message", "second message"]
    assert [m["seq"] for m in drained] == sorted(m["seq"] for m in drained)


def test_pending_state_is_ordered_for_the_ui(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    for i in range(3):
        q.enqueue("s1", f"msg-{i}", message_id=f"m{i}")
    state = q.queue_state("s1")
    assert state["busy"] is True
    assert state["pending_count"] == 3
    assert [p["content"] for p in state["pending"]] == [
        "msg-0", "msg-1", "msg-2"]


def test_message_sent_when_idle_is_delivered_immediately_in_order(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    q.enqueue("s1", "queued while busy", message_id="m1")
    q.mark_idle("s1")  # turn frees up; queue drains at top of next turn
    q.enqueue("s1", "sent when idle", message_id="m2")
    assert [m["content"] for m in q.drain("s1")] == [
        "queued while busy", "sent when idle"]


def test_empty_queue_drains_to_nothing(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    assert q.drain("s1") == []
    assert q.pending_count("s1") == 0


# ── at-most-once delivery ─────────────────────────────────────────────────────

def test_a_message_is_never_delivered_twice(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    q.enqueue("s1", "only once", message_id="m1")

    first = q.drain("s1")
    second = q.drain("s1")
    assert len(first) == 1
    assert second == []
    assert first[0]["delivered_at"] is not None


def test_duplicate_message_id_is_not_re_enqueued(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    q.enqueue("s1", "hello", message_id="m1")
    q.enqueue("s1", "hello", message_id="m1")  # re-send, same id
    assert q.pending_count("s1") == 1


def test_duplicate_message_id_for_another_session_is_refused(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    q.mark_busy("s2")
    q.enqueue("s1", "hello", message_id="m1")
    with pytest.raises(QueueError):
        q.enqueue("s2", "hello", message_id="m1")


def test_queues_are_isolated_per_session(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    q.mark_busy("s2")
    q.enqueue("s1", "for s1", message_id="a")
    q.enqueue("s2", "for s2", message_id="b")
    assert [m["content"] for m in q.drain("s1")] == ["for s1"]
    assert [m["content"] for m in q.drain("s2")] == ["for s2"]


# ── restart durability ────────────────────────────────────────────────────────

def test_queue_survives_a_process_restart(tmp_path):
    # "Process 1": queue messages mid-turn, then die.
    q1 = MessageQueue(db_path=tmp_path / "q.db")
    q1.mark_busy("s1")
    q1.enqueue("s1", "one", message_id="m1")
    q1.enqueue("s1", "two", message_id="m2")
    q1.close()

    # "Process 2": a fresh instance on the same file sees the same queue.
    q2 = MessageQueue(db_path=tmp_path / "q.db")
    assert q2.is_busy("s1") is True
    assert [m["content"] for m in q2.drain("s1")] == ["one", "two"]


def test_delivery_state_survives_a_restart(tmp_path):
    q1 = MessageQueue(db_path=tmp_path / "q.db")
    q1.mark_busy("s1")
    q1.enqueue("s1", "half-delivered", message_id="m1")
    q1.drain("s1")
    q1.close()

    q2 = MessageQueue(db_path=tmp_path / "q.db")
    assert q2.drain("s1") == []  # not delivered again after restart


def test_busy_flag_survives_a_restart_mid_turn(tmp_path):
    q1 = MessageQueue(db_path=tmp_path / "q.db")
    q1.mark_busy("s1")
    q1.close()
    q2 = MessageQueue(db_path=tmp_path / "q.db")
    assert q2.is_busy("s1") is True
    q2.mark_idle("s1")
    assert q2.is_busy("s1") is False


# ── loud failure on an unwritable store ───────────────────────────────────────

def test_enqueue_fails_loud_when_store_is_unwritable(tmp_path):
    # Windows-honoured way to make the store unwritable while it is open:
    # hold the SQLite writer lock from another connection — the enqueue's
    # write then cannot persist and must be refused LOUDLY.
    db = tmp_path / "q.db"
    q = MessageQueue(db_path=db)
    q.mark_busy("s1")
    locker = sqlite3.connect(str(db), timeout=0.05)
    try:
        locker.execute("BEGIN IMMEDIATE")  # hold the writer lock
        with pytest.raises(QueueStoreUnavailable):
            q.enqueue("s1", "must not be silently dropped", message_id="m1")
    finally:
        locker.rollback()
        locker.close()
    # The message was refused — nothing was queued, nothing silently lost.
    assert q.pending_count("s1") == 0


def test_open_fails_loud_when_directory_cannot_be_created(tmp_path):
    blocker = tmp_path / "a-file"  # a file, not a dir — mkdir under it fails
    blocker.write_text("not a directory")
    with pytest.raises(QueueStoreUnavailable):
        MessageQueue(db_path=blocker / "nested" / "q.db")


def test_empty_content_is_refused(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    with pytest.raises(QueueError):
        q.enqueue("s1", "   ")


def test_unknown_session_is_a_loud_read_failure(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    with pytest.raises(UnknownSession):
        q.require_session("no-such-session")


# ── SSE frame drain (the parent's hook grammar) ──────────────────────────────

def test_drain_sse_frames_use_the_existing_handoff_grammar(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    q.enqueue("s1", "queued question", message_id="m1")

    frames = q.drain_sse_frames("s1", from_bot="user", to_bot="bala")
    assert len(frames) == 1
    lines = frames[0].strip().split("\n")
    assert lines[0] == "event: handoff"
    payload = json.loads(lines[1][len("data: "):])
    assert payload == {"from": "user", "to": "bala",
                       "summary": "queued question", "at": payload["at"]}

    # Frame delivery is still at-most-once.
    assert q.drain_sse_frames("s1", from_bot="user", to_bot="bala") == []


def test_fifo_order_is_preserved_in_sse_frames(tmp_path):
    q = MessageQueue(db_path=tmp_path / "q.db")
    q.mark_busy("s1")
    q.enqueue("s1", "first", message_id="m1")
    q.enqueue("s1", "second", message_id="m2")

    frames = q.drain_sse_frames("s1", from_bot="user", to_bot="bala")
    summaries = [json.loads(f.split("data: ", 1)[1])["summary"] for f in frames]
    assert summaries == ["first", "second"]


def test_sqlite_store_matches_the_sessions_store_pattern(tmp_path):
    # Same technology as balabot/sessions.py: a single sqlite3 file.
    db = tmp_path / "q.db"
    MessageQueue(db_path=db).close()
    conn = sqlite3.connect(str(db))
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"queue_messages", "queue_turns"} <= tables


# ── HTTP routes integration ───────────────────────────────────────────────────

def test_queue_http_endpoints(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from ui import server

    db = tmp_path / "queue.db"
    monkeypatch.setenv("BALABOT_QUEUE_DB", str(db))
    monkeypatch.setattr(server, "DASHBOARD_PASSWORD", "pw")
    client = TestClient(server.app)
    client.headers.update({"Authorization": "Basic YWxpOnB3"})  # ali:pw

    # 1. Check empty queue
    resp = client.get("/api/queue/sess_test_1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["state"]["pending_count"] == 0
    assert data["state"]["busy"] is False

    # 2. Enqueue message via POST /api/queue/sess_test_1
    resp = client.post("/api/queue/sess_test_1", json={"content": "hello while offline"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["message"]["content"] == "hello while offline"
    assert data["queue"]["pending_count"] == 1

    # 3. Check queue state again
    resp = client.get("/api/queue/sess_test_1")
    assert resp.status_code == 200
    assert resp.json()["state"]["pending_count"] == 1
    assert resp.json()["state"]["pending"][0]["content"] == "hello while offline"

