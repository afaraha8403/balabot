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
# Compaction: newest user turn survives, bounded, recorded (W2-6 / W2-7)
# ---------------------------------------------------------------------------

def test_compact_keeps_newest_user_turn_even_outside_tail(db):
    """W2-6 — the newest USER turn survives compaction even when the tail
    window holds only a newer assistant message and would otherwise drop it.
    Fails if: the user's latest message vanishes after compact() — the live
    thread would be severed mid-turn."""
    db.create_session("s_compact", "governor", "thread")
    # u1, a1, u2, a2, u3, a3 — the newest user turn (u3) is followed by a
    # newer ASSISTANT turn (a3), so a tail window of 1 holds only a3 and the
    # protection must work to keep u3.
    for i in range(1, 4):
        db.record_message("s_compact", "user", f"user msg {i}")
        db.record_message("s_compact", "assistant", f"reply {i}")

    # window = first 1 + last 1 = {u1, a3}; the newest user turn is u3 (seq 5).
    out = db.compact("s_compact", protect_first_n=1, protect_last_n=1)
    surviving = [m["content"] for m in db.messages("s_compact")]
    assert "user msg 3" in surviving, surviving
    assert out["pruned"] == 3  # a1, u2, a2 dropped; u3 protected
    assert out["remaining"] == 3  # u1 + u3 + a3
    assert out["compaction_count"] == 1
    assert out["last_compaction_at"]


def test_compact_is_bounded_and_recorded(db):
    """W2-7 — compaction keeps exactly first_n + last_n, never prunes below
    the floor, is idempotent at the floor, and records compaction_count /
    last_compaction_at.
    Fails if: pruning breaches the first+last window or the store does not
    record the compaction."""
    db.create_session("s_bounded", "governor", "thread")
    for i in range(1, 11):
        role = "user" if i % 2 else "assistant"
        db.record_message("s_bounded", role, f"bulk msg {i}")

    out = db.compact("s_bounded", protect_first_n=3, protect_last_n=5)
    assert out["remaining"] == 8  # 3 + 5, the exact window
    assert out["pruned"] == 2  # 10 - 8
    assert out["compaction_count"] == 1
    assert out["last_compaction_at"]

    again = db.compact("s_bounded", protect_first_n=3, protect_last_n=5)
    assert again["pruned"] == 0  # already at the floor — idempotent
    assert again["remaining"] == 8
    assert again["compaction_count"] == 2

    surviving = [m["content"] for m in db.messages("s_bounded")]
    assert "bulk msg 9" in surviving  # newest user turn still present


def test_compact_unknown_session_raises(db):
    """Compaction on an unknown id fails loud — never auto-creates."""
    with pytest.raises(UnknownSession):
        db.compact("nope", protect_first_n=3, protect_last_n=5)


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


def test_messages_since_seq_filtering(db):
    """Messages can be filtered with since_seq cursor for catch-up replay."""
    db.create_session("s_seq", "principal", "test sequence cursor")
    m1 = db.record_message("s_seq", "user", "msg1")
    m2 = db.record_message("s_seq", "assistant", "msg2")
    m3 = db.record_message("s_seq", "user", "msg3")
    assert [m1["seq"], m2["seq"], m3["seq"]] == [1, 2, 3]

    after_1 = db.messages("s_seq", since_seq=1)
    assert len(after_1) == 2
    assert [m["seq"] for m in after_1] == [2, 3]

    after_2 = db.messages("s_seq", since_seq=2)
    assert len(after_2) == 1
    assert [m["seq"] for m in after_2] == [3]

    after_3 = db.messages("s_seq", since_seq=3)
    assert len(after_3) == 0


def test_record_message_idempotent_deduplication(db):
    """Recording a message with an existing message_id returns the existing record without duplicating."""
    db.create_session("s_dedup", "principal", "test dedup")
    m1 = db.record_message("s_dedup", "user", "first attempt", message_id="msg_fixed_id")
    assert m1["seq"] == 1
    assert m1["content"] == "first attempt"

    # Replay same message_id
    m2 = db.record_message("s_dedup", "user", "first attempt", message_id="msg_fixed_id")
    assert m2["message_id"] == "msg_fixed_id"
    assert m2["seq"] == 1

    msgs = db.messages("s_dedup")
    assert len(msgs) == 1


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


def test_boot_wal_sweep_covers_all_product_stores(tmp_path, monkeypatch):
    """Gap 4b: Boot sweep must cover all product-owned stores and enforce WAL at rest."""
    import sqlite3
    from balabot.sessions import get_product_store_paths, sweep_wal_mode
    from balabot import bootstrap

    monkeypatch.setenv("BALABOT_DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    # 1. Single source of truth must include all 7 required product store paths
    stores = get_product_store_paths(data_root=tmp_path, hermes_home=tmp_path)
    store_str_paths = [str(p) for p in stores]

    required_relative_paths = [
        "sessions/continuity.db",
        "sessions/queue.db",
        "handoffs/handoffs.db",
        "interventions/interventions.db",
        "memory/balabot-jev/continuity.db",
        "profiles/principal/memory/balabot-jev/continuity.db",
        "profiles/governor/memory/balabot-jev/continuity.db",
    ]
    for rel in required_relative_paths:
        expected = tmp_path / rel
        assert any(p.resolve() == expected.resolve() for p in stores), (
            f"get_product_store_paths() must cover {rel}; found: {store_str_paths}"
        )

    # 2. Populate each product store with standard SQLite databases in 'delete' mode (not WAL)
    for p in stores:
        p.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(p)) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS probe (x INT)")
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
            assert mode == "delete", f"Expected initial delete mode for {p}, got {mode}"

    # 3. Verify sweep converts all existing stores to 'wal'
    actions = sweep_wal_mode(data_root=tmp_path, hermes_home=tmp_path)
    assert len(actions) == len(stores)
    for p in stores:
        with sqlite3.connect(str(p)) as conn:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0].lower()
            assert mode == "wal", f"Store {p} was not converted to WAL by sweep; got {mode}"

    # 4. Idempotency: running a second sweep reports 'already wal'
    actions2 = sweep_wal_mode(data_root=tmp_path, hermes_home=tmp_path)
    for act in actions2:
        assert "already wal" in act, f"Subsequent sweep should report already wal, got: {act}"

    # 5. Fault tolerance: missing files, locked files, and non-DB files must not raise
    missing_path = tmp_path / "sessions" / "nonexistent.db"
    corrupt_path = tmp_path / "sessions" / "corrupt.db"
    corrupt_path.write_text("NOT A SQLITE DATABASE", encoding="utf-8")
    fault_actions = sweep_wal_mode(store_paths=[missing_path, corrupt_path])
    assert any("absent" in act or "missing" in act for act in fault_actions)
    assert any("invalid" in act or "error" in act for act in fault_actions)

    # 6. Prove boot sequence actually calls the sweep: monkeypatch sweep to track calls
    called = []

    def fake_sweep(*args, **kwargs):
        called.append(True)
        return ["fake_action"]

    monkeypatch.setattr(bootstrap, "sweep_wal_mode", fake_sweep)
    monkeypatch.setattr(bootstrap, "install_memory_plugin", lambda *a, **k: [])
    monkeypatch.setattr(bootstrap, "install_agent_plugins", lambda *a, **k: [])
    monkeypatch.setattr(bootstrap, "_normalize_store_ownership", lambda *a, **k: [])
    monkeypatch.setattr(bootstrap, "init_org", lambda *a, **k: [])
    monkeypatch.setattr(bootstrap, "provision_persona", lambda name, *a, **k: {"persona": name, "actions": []})
    monkeypatch.setattr(bootstrap, "install_skills", lambda *a, **k: [])
    monkeypatch.setattr(bootstrap, "init_ledger", lambda *a, **k: [])
    monkeypatch.setattr(bootstrap, "_run_jev_boot_health", lambda *a, **k: None)

    bootstrap.run_bootstrap()
    assert len(called) > 0, "run_bootstrap() must invoke sweep_wal_mode() at boot!"


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