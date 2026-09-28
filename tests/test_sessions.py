"""Tests for balabot.sessions — the durable server-side session store.

Every test proves a BEHAVIOUR from the plan, not the shape of the source:
persistence across reopen, span splitting/extending, re_anchor content,
churn reporting, fail-loud on unknown ids, and the anti-merge guarantee.
"""

from __future__ import annotations

import json

import pytest

from balabot.sessions import SessionStore, UnknownSession


@pytest.fixture
def db(tmp_path):
    store = SessionStore(tmp_path / "continuity.db")
    yield store
    store.close()


def _make(store: SessionStore, sid: str = "s1", bot_id: str = "principal") -> None:
    store.create_session(sid, bot_id, "help the user ship a product")


# ---------------------------------------------------------------------------
# Persistence across close/reopen
# ---------------------------------------------------------------------------

def test_purpose_and_topics_persist_across_reopen(tmp_path):
    """Purpose + topic spans survive a full close/reopen of the store —
    durability is the entire reason this module exists."""
    path = tmp_path / "continuity.db"
    store = SessionStore(path)
    store.create_session("s1", "principal", "plan the launch")
    store.record_topic("s1", "pricing")
    store.record_topic("s1", "rollout")
    store.close()

    reopened = SessionStore(path)
    spans = reopened.topic_spans("s1")
    assert [s["topic"] for s in spans] == ["pricing", "rollout"]
    assert reopened.list_sessions("principal")[0]["purpose"] == "plan the launch"
    reopened.close()


# ---------------------------------------------------------------------------
# Spans: split on topic change, extend on repeat
# ---------------------------------------------------------------------------

def test_two_topics_produce_two_non_overlapping_spans(db):
    """Topic A over 1-2 then topic B over 3-4 must be TWO distinct spans
    with correct, non-overlapping sequence bounds. THE POINT OF THIS TEST:
    it fails if the implementation merges the topics into one description —
    a merged 'pricing and rollout' string is useless as a routing key (it
    matches everything and nothing), whereas spans stay addressable."""
    db.create_session("s1", "principal", "ship it")
    db.record_topic("s1", "pricing")    # seqs 1, 2
    db.record_topic("s1", "pricing")
    db.record_topic("s1", "rollout")    # seqs 3, 4
    db.record_topic("s1", "rollout")

    spans = db.topic_spans("s1")
    assert len(spans) == 2, f"merged or duplicated spans: {spans}"
    assert spans[0] == {"topic": "pricing", "start_seq": 1, "end_seq": 2}
    assert spans[1] == {"topic": "rollout", "start_seq": 3, "end_seq": 4}
    # Explicit non-overlap: end of span 1 < start of span 2.
    assert spans[0]["end_seq"] < spans[1]["start_seq"]


def test_repeated_topic_extends_the_open_span(db):
    """Appending a topic equal to the open span EXTENDS it — one span with
    a moved end_seq, never a duplicate span for the same topic."""
    db.create_session("s1", "principal", "ship it")
    db.record_topic("s1", "pricing")
    db.record_topic("s1", "pricing")
    db.record_topic("s1", "pricing")

    spans = db.topic_spans("s1")
    assert len(spans) == 1
    assert spans[0] == {"topic": "pricing", "start_seq": 1, "end_seq": 3}


def test_returning_to_earlier_topic_opens_a_new_span(db):
    """A -> B -> A: the second A is a NEW span (B closed A's), so three
    spans total, in order."""
    db.create_session("s1", "principal", "ship it")
    db.record_topic("s1", "A")
    db.record_topic("s1", "B")
    db.record_topic("s1", "A")

    spans = db.topic_spans("s1")
    assert [(s["topic"], s["start_seq"], s["end_seq"]) for s in spans] == [
        ("A", 1, 1),
        ("B", 2, 2),
        ("A", 3, 3),
    ]


# ---------------------------------------------------------------------------
# re_anchor
# ---------------------------------------------------------------------------

def test_re_anchor_returns_spans_in_order_with_purpose_decisions_resume(db):
    """re_anchor is the rebuild bundle: purpose + ordered spans + decisions +
    resume_state, deterministic and JSON-able."""
    db.create_session("s1", "principal", "plan the migration")
    db.record_topic("s1", "schema")
    db.record_topic("s1", "cutover")
    db.set_resume_state("s1", {"mandate": "zero-downtime", "phase": 2})
    db.record_decision("s1", "cut over Saturday", "governor", at="2026-09-27T10:00:00Z")
    db.record_decision("s1", "freeze deploys Friday", "principal", at="2026-09-27T11:00:00Z")

    bundle = db.re_anchor("s1")
    # JSON-able, round-trips exactly (deterministic).
    assert json.loads(json.dumps(bundle)) == bundle
    assert bundle["purpose"] == "plan the migration"
    assert bundle["resume_state"] == {"mandate": "zero-downtime", "phase": 2}
    assert [s["topic"] for s in bundle["topic_spans"]] == ["schema", "cutover"]
    assert [d["text"] for d in bundle["decisions"]] == [
        "cut over Saturday",
        "freeze deploys Friday",
    ]
    assert bundle["decisions"][0]["provenance"] == "governor"
    assert bundle["recent_window"] == "last-20-messages"


# ---------------------------------------------------------------------------
# Churn report
# ---------------------------------------------------------------------------

def test_churn_report_flags_thrashing_after_n_compactions(db):
    """A session compacted N times is flagged; a healthy one is NOT."""
    db.create_session("thrashing", "principal", "x")
    db.create_session("healthy", "principal", "y")
    for _ in range(3):
        db.record_compaction("thrashing", at="2026-09-27T10:00:00Z")
    db.record_compaction("healthy", at="2026-09-27T10:00:00Z")

    report = db.churn_report(min_compactions=3)
    assert [r["session_id"] for r in report] == ["thrashing"]
    assert report[0]["compaction_count"] == 3
    assert report[0]["last_compaction_at"] == "2026-09-27T10:00:00Z"
    # A lower threshold still keeps the healthy session out (it has 1).
    assert [r["session_id"] for r in db.churn_report(min_compactions=2)] == [
        "thrashing"
    ]


# ---------------------------------------------------------------------------
# Fail loud on unknown session ids
# ---------------------------------------------------------------------------

def test_unknown_session_raises_on_every_read_path(db):
    """Never auto-create on a read path; every reader raises the typed error."""
    with pytest.raises(UnknownSession):
        db.topic_spans("nope")
    with pytest.raises(UnknownSession):
        db.re_anchor("nope")
    with pytest.raises(UnknownSession):
        db.decisions("nope")
    with pytest.raises(UnknownSession):
        db.resume_state("nope")
    with pytest.raises(UnknownSession):
        db.set_resume_state("nope", {})
    # Typed hierarchy: UnknownSession is a SessionError.
    from balabot.sessions import SessionError

    assert issubclass(UnknownSession, SessionError)


def test_resume_state_replaces_and_roundtrips_arbitrary_payload(db):
    """resume_state is free-form — whatever the mandate needs, JSON round-trip."""
    db.create_session("s1", "governor", "audit spend")
    payload = {"mandate": "audit", "budgets": {"openrouter": 40}, "flags": [1, 2, 3]}
    db.set_resume_state("s1", payload)
    assert db.resume_state("s1") == payload


def test_list_sessions_filters_by_bot(db):
    """list_sessions(bot_id) is the product surface — filtered by bot."""
    db.create_session("a1", "principal", "p1")
    db.create_session("a2", "principal", "p2")
    db.create_session("g1", "governor", "p3")

    principal = db.list_sessions("principal")
    assert sorted(s["session_id"] for s in principal) == ["a1", "a2"]
    assert [s["purpose"] for s in sorted(principal, key=lambda s: s["session_id"])] == [
        "p1",
        "p2",
    ]
    assert [s["session_id"] for s in db.list_sessions("governor")] == ["g1"]


def test_create_session_fails_loud_on_duplicate_id(db):
    """Silently overwriting a session would destroy the history this module
    keeps — a duplicate id is a hard error."""
    db.create_session("s1", "principal", "first")
    from balabot.sessions import SessionError

    with pytest.raises(SessionError):
        db.create_session("s1", "principal", "second")
    # The original purpose survives the failed overwrite.
    assert db.re_anchor("s1")["purpose"] == "first"


# ---------------------------------------------------------------------------
# P1-2: Message persistence in SQLite
# ---------------------------------------------------------------------------

def test_messages_persist_across_reopen(tmp_path):
    """P1-2: User and assistant messages persist to SQLite and survive store reopen."""
    path = tmp_path / "continuity.db"
    store = SessionStore(path)
    store.create_session("s_msgs", "principal", "test chat transcript")
    m1 = store.record_message("s_msgs", "user", "What is the capital of France?")
    m2 = store.record_message("s_msgs", "assistant", "Paris.")
    assert m1["role"] == "user"
    assert m1["content"] == "What is the capital of France?"
    assert m1["seq"] == 1
    assert m2["role"] == "assistant"
    assert m2["content"] == "Paris."
    assert m2["seq"] == 2
    store.close()

    reopened = SessionStore(path)
    msgs = reopened.messages("s_msgs")
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "What is the capital of France?"
    assert msgs[0]["seq"] == 1
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == "Paris."
    assert msgs[1]["seq"] == 2
    reopened.close()


def test_messages_fail_loud_on_unknown_session(db):
    """P1-2: Attempting to record messages for a nonexistent session raises UnknownSession."""
    with pytest.raises(UnknownSession):
        db.record_message("nonexistent_session", "user", "hello")


def test_all_product_durable_stores_report_wal_journal_mode(tmp_path, monkeypatch):
    """Gap 4: Every SQLite database created and owned by the product must be in WAL journal mode."""
    import sqlite3
    import importlib.util
    from pathlib import Path
    from balabot.sessions import SessionStore
    from balabot.queueing import MessageQueue
    from balabot import handoffs, intervention

    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))

    # 1. Continuity store (transcripts, purpose, spans)
    cont_path = tmp_path / "sessions" / "continuity.db"
    store = SessionStore(cont_path)
    store.close()
    with sqlite3.connect(str(cont_path)) as conn:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
        assert mode == "wal", f"SessionStore at {cont_path} journal_mode must be wal, got {mode}"

    # 2. Per-session message queue store
    queue_path = tmp_path / "queue" / "queue.db"
    q_store = MessageQueue(queue_path)
    q_store.close()
    with sqlite3.connect(str(queue_path)) as conn:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
        assert mode == "wal", f"QueueStore at {queue_path} journal_mode must be wal, got {mode}"

    # 3. Inter-bot handoffs store
    handoffs_db = tmp_path / "handoffs" / "handoffs.db"
    handoffs.enqueue_handoff("bot_a", "bot_b", "summary")
    with sqlite3.connect(str(handoffs_db)) as conn:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
        assert mode == "wal", f"Handoffs store at {handoffs_db} journal_mode must be wal, got {mode}"

    # 4. Human intervention pause/resolve store
    iv_db = tmp_path / "interventions" / "interventions.db"
    monkeypatch.setenv("BALABOT_INTERVENTIONS_DB", str(iv_db))
    intervention.request_intervention("worker_wal", "need help")
    with sqlite3.connect(str(iv_db)) as conn:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
        assert mode == "wal", f"Interventions store at {iv_db} journal_mode must be wal, got {mode}"

    # 5. Balabot-Jev memory plugin store (continuity.db scoped under hermes_home)
    plugin_checkpoint = Path(__file__).resolve().parent.parent / "hermes" / "plugins" / "balabot-jev" / "checkpoint.py"
    spec = importlib.util.spec_from_file_location("balabot_jev_checkpoint_wal_test", str(plugin_checkpoint))
    plugin_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin_mod)
    jev_home = tmp_path / "profiles" / "principal"
    jev_adapter = plugin_mod.load_sessions_store(str(jev_home))
    jev_adapter.raw.close()
    jev_db = jev_home / "memory" / "balabot-jev" / "continuity.db"
    assert jev_db.exists()
    with sqlite3.connect(str(jev_db)) as conn:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
        assert mode == "wal", f"balabot-jev store at {jev_db} journal_mode must be wal, got {mode}"


def test_durable_stores_backup_and_integrity_check(tmp_path, monkeypatch):
    """Gap 4: Every durable store must support online backup and integrity check."""
    import sqlite3
    from balabot.sessions import SessionStore, backup_sessions_db, verify_sessions_integrity
    from balabot.queueing import MessageQueue, backup_queue_db, verify_queue_integrity
    from balabot.handoffs import enqueue_handoff, backup_handoffs_db, verify_handoffs_integrity
    from balabot.intervention import request_intervention, backup_interventions_db, verify_interventions_integrity

    data_root = tmp_path / "data"
    monkeypatch.setenv("BALABOT_DATA_ROOT", str(data_root))

    # 1. Sessions store
    cont_db = data_root / "sessions" / "continuity.db"
    monkeypatch.setenv("BALABOT_CONTINUITY_DB", str(cont_db))
    with SessionStore(cont_db) as store:
        store.create_session("sess_1", "bot_1", "testing backups")
        store.record_message("sess_1", "user", "hello backup")
        assert store.integrity_check() is True

    backup_cont = tmp_path / "cont_backup.db"
    backup_sessions_db(backup_cont)
    assert backup_cont.exists()
    assert verify_sessions_integrity() is True
    with sqlite3.connect(str(backup_cont)) as conn:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        assert rows == [("ok",)]
        msg_count = conn.execute("SELECT count(*) FROM messages").fetchone()[0]
        assert msg_count == 1

    # 2. Queue store
    q_db = data_root / "sessions" / "queue.db"
    monkeypatch.setenv("BALABOT_QUEUE_DB", str(q_db))
    q = MessageQueue(q_db)
    q.enqueue("sess_1", "queued message")
    assert q.integrity_check() is True
    q.close()

    backup_q = tmp_path / "q_backup.db"
    backup_queue_db(backup_q)
    assert backup_q.exists()
    assert verify_queue_integrity() is True
    with sqlite3.connect(str(backup_q)) as conn:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        assert rows == [("ok",)]
        q_count = conn.execute("SELECT count(*) FROM queue_messages").fetchone()[0]
        assert q_count == 1

    # 3. Handoffs store
    h_db = data_root / "handoffs" / "handoffs.db"
    monkeypatch.setenv("BALABOT_HANDOFFS_DB", str(h_db))
    enqueue_handoff("bot_a", "bot_b", "summary")
    assert verify_handoffs_integrity() is True

    backup_h = tmp_path / "h_backup.db"
    backup_handoffs_db(backup_h)
    assert backup_h.exists()
    with sqlite3.connect(str(backup_h)) as conn:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        assert rows == [("ok",)]

    # 4. Interventions store
    iv_db = data_root / "interventions" / "interventions.db"
    monkeypatch.setenv("BALABOT_INTERVENTIONS_DB", str(iv_db))
    request_intervention("worker_b", "intervention backup test")
    assert verify_interventions_integrity() is True

    backup_iv = tmp_path / "iv_backup.db"
    backup_interventions_db(backup_iv)
    assert backup_iv.exists()
    with sqlite3.connect(str(backup_iv)) as conn:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        assert rows == [("ok",)]