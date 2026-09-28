"""CALL-SITE tests: the /api/chat send path in ui/server.py must route the
conversation through the durable session store and inject Jev skill-relevance
as a USER-message carrier.

These are NOT module tests — every test drives the REAL chat() request path
and asserts on the emitted SSE frames. Removing the call sites (the
_jev_prepare / _prepare_chat_session / _chat_append_session_state /
select_and_render / route_session invocations inside chat()) makes these
tests FAIL.

Faked at exactly ONE boundary: the container bridge (_org_run) and the HTTP
transport. balabot.sessions semantics, balabot.jev_depth, balabot.jev_prompt,
balabot.jev_continuity and the server's own wiring all run for REAL.

Call order on the real path (drives every scripted response below):
    1. routing (route_session) — only when the bot has server sessions
    2. the decision gate (is_decision_worthy)
    3. skill selection (select_skills: skim + re-read)
    4. context signals (drift / repetition)
"""

from __future__ import annotations

import asyncio
import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "ui"))

import server  # noqa: E402

# Live wire shapes (documented in balabot/jev.py): noul probability under
# "noul", choice scores under "answers"."candidates".
SKIM = {"answers": {"candidates": {"pdf": 0.9}}, "confidence": 1.0}
RE_READ = {"answers": {"pdf": {"type": "noul", "noul": 0.85}}, "confidence": 1.0}
GATE_YES = {"answers": {"decision_worthy": {"type": "noul", "noul": 0.9}},
            "confidence": 1.0}
GATE_NO = {"answers": {"decision_worthy": {"type": "noul", "noul": 0.1}},
           "confidence": 1.0}
DRIFT_LOW = {"answers": {"drifted": {"type": "noul", "noul": 0.1}},
             "confidence": 1.0}
RESUME_ROUTE = {
    "answers": {"needs_new_session": {"type": "noul", "noul": 0.1},
                "same_purpose_s_old": {"type": "noul", "noul": 0.9}},
    "confidence": 1.0,
}


class ScriptedJev:
    """Returns each scripted response VERBATIM (live wire shape, no re-wrap)."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple] = []

    def system_one(self, state, questions, *, shadow=False):
        self.calls.append((state, dict(questions)))
        if not self.responses:
            return {"answers": {}, "confidence": 1.0}
        return self.responses.pop(0)


def _sse_frames(chunks: list[bytes]) -> dict[str, list[dict]]:
    """Parse the emitted SSE text into {event: [payload, ...]} (in order)."""
    text = b"".join(chunks).decode("utf-8", "replace")
    out: dict[str, list[dict]] = {}
    for block in text.split("\n\n"):
        event = None
        data_lines = []
        for line in block.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
        if event and data_lines:
            try:
                payload = json.loads("\n".join(data_lines))
            except json.JSONDecodeError:
                payload = {"raw": "\n".join(data_lines)}
            out.setdefault(event, []).append(payload)
    return out


class _FakeResponse:
    def __init__(self) -> None:
        self.status_code = 200

    async def aread(self) -> bytes:
        return b""

    async def aiter_bytes(self):
        yield b'event: final\ndata: {"content": "ok"}\n\n'


class _FakeStream:
    async def __aenter__(self):
        return _FakeResponse()

    async def __aexit__(self, *exc):
        return False


class _FakeAsyncClient:
    def __init__(self, *a, **kw) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, method: str, url: str, json=None, headers=None):
        return _FakeStream()


class _RecordedStore:
    """Stands in for the container-bridged durable session store. Records the
    snippet payloads so tests can assert REAL store calls happened."""

    def __init__(self, listing: list[dict], detail: dict | None = None):
        self.listing = listing
        self.detail = detail or {}
        self.appends: list[dict] = []
        self.lists = 0
        self.gets = 0

    def run(self, snippet: str, payload: dict | None = None) -> dict:
        # NOTE: the GET snippet ALSO calls list_sessions internally, so the
        # re_anchor check must come FIRST.
        if "re_anchor" in snippet:
            self.gets += 1
            return {"ok": True, "session": self.detail}
        if "list_sessions" in snippet:
            self.lists += 1
            return {"ok": True, "sessions": self.listing}
        if "record_decision" in snippet or "record_topic" in snippet:
            self.appends.append(payload)
            return {"ok": True, "session_id": (payload or {}).get("session_id")}
        return {"ok": False, "error": "unrecognized", "reason": snippet[:80]}


def _request(monkeypatch, *, session_id: str, turn: str,
             jev, store: _RecordedStore,
             catalog: dict[str, str] | None = None) -> dict[str, list[dict]]:
    """Drive the REAL chat() route and return the parsed SSE frames."""
    if catalog is not None:
        monkeypatch.setattr(server.skills_registry, "resolve",
                            lambda bot_id: [{"name": n, "description": d}
                                            for n, d in catalog.items()])
    monkeypatch.setattr(server, "_org_run", store.run)
    monkeypatch.setattr(server, "_jev_chat_client", lambda: jev)
    monkeypatch.setattr(server, "_JEV_CHAT_CLIENT", jev)
    monkeypatch.setattr(server, "_JEV_CHAT_REASON", "" if jev is not None else "Jev client unavailable")
    monkeypatch.setattr(server.httpx, "AsyncClient", _FakeAsyncClient)

    body = {"bot_id": "principal",
            "messages": [{"role": "user", "content": turn, "at": 1}],
            "session_id": session_id}

    async def fake_json():
        return body

    req = type("R", (), {"json": staticmethod(fake_json)})()
    resp = asyncio.run(server.chat(req))

    chunks: list[bytes] = []

    async def drain():
        async for chunk in resp.body_iterator:
            chunks.append(chunk if isinstance(chunk, bytes)
                          else str(chunk).encode("utf-8"))

    asyncio.run(drain())
    return _sse_frames(chunks)


# ---------------------------------------------------------------------------
# Call site 1: the chat path injects the skill-relevance carrier
# ---------------------------------------------------------------------------

CATALOG = {"pdf": "PDF files: create, read, merge, fill, OCR, edit text."}


def test_chat_emits_skill_relevance_carrier_with_exact_keys(monkeypatch):
    """THE call-site proof for jev_prompt.select_and_render + inject: drive the
    real /api/chat route and assert the emitted user-message carrier has
    EXACTLY the keys {carrier, content, session_id}. Fails if the chat path
    stops calling select_and_render."""
    # Routing first (the listing has s1; its purpose shares no tokens with the
    # turn, so route_session asks only needs_new_session), then gate,
    # selection, signals.
    jev = ScriptedJev([
        {"answers": {"needs_new_session": {"type": "noul", "noul": 0.1}},
         "confidence": 1.0},
        GATE_NO, SKIM, RE_READ, DRIFT_LOW,
    ])
    store = _RecordedStore(
        listing=[{"session_id": "s1", "purpose": "ship it", "next_seq": 3,
                  "compaction_count": 0, "last_compaction_at": None}],
        detail={"purpose": "ship it", "topic_spans": [], "decisions": [],
                "resume_state": {}})
    frames = _request(monkeypatch, session_id="s1",
                      turn="merge a PDF for the launch",
                      jev=jev, store=store, catalog=CATALOG)
    carriers = frames.get("jev_carrier") or []
    assert carriers, ("chat path emitted no jev_carrier — the "
                      "select_and_render/inject call site was removed")
    skill_carriers = [c for c in carriers if "<skill_relevance>" in c.get("content", "")]
    assert skill_carriers, "skill-relevance line never rode a user message"
    carrier = skill_carriers[0]
    assert set(carrier) == {"carrier", "content", "session_id"}
    assert carrier["carrier"] == "user_message"
    assert carrier["session_id"] == "s1"
    assert "pdf" in carrier["content"]
    assert carrier["content"].startswith("<skill_relevance>")
    assert carrier["content"].endswith("</skill_relevance>")


def test_chat_carrier_is_user_message_never_system_prompt(monkeypatch):
    """The HARD INVARIANT, proven against the call site: the ONLY thing the
    chat path emits toward the conversation is a user_message carrier. No
    frame in the stream targets the system prompt, in any shape."""
    jev = ScriptedJev([GATE_NO, SKIM, RE_READ, DRIFT_LOW])  # no candidates
    store = _RecordedStore(listing=[], detail=None)
    frames = _request(monkeypatch, session_id="s2", turn="merge a PDF",
                      jev=jev, store=store, catalog={"pdf": "PDF tooling."})
    carriers = frames.get("jev_carrier") or []
    assert carriers, "skill-relevance carrier missing from the real chat path"
    for carrier in carriers:
        assert set(carrier) == {"carrier", "content", "session_id"}
        assert carrier["carrier"] == "user_message"
    raw = json.dumps(frames)
    assert "system_prompt" not in raw
    assert '"carrier": "system' not in raw


# ---------------------------------------------------------------------------
# Honest degrade: absent / malformed / broken Jev never breaks the turn
# ---------------------------------------------------------------------------

def _assert_turn_completed_and_degrade_stated(frames):
    assert frames.get("final", [{}])[0].get("content") == "ok", \
        "the turn itself must complete"
    events = frames.get("jev") or []
    assert events, "the degrade must be STATED as an event: jev frame"
    assert events[0].get("degraded") is True
    assert events[0].get("reason")


def test_chat_without_jev_states_the_degrade_instead_of_silent_empty(monkeypatch):
    """With NO Jev client the turn still streams and the absence of the signal
    is stated — never a silent empty success."""
    store = _RecordedStore(listing=[], detail=None)
    frames = _request(monkeypatch, session_id="s3", turn="hello",
                      jev=None, store=store, catalog={"pdf": "pdf tooling"})
    _assert_turn_completed_and_degrade_stated(frames)


def test_chat_with_malformed_jev_response_degrades_and_the_turn_survives(monkeypatch):
    """A malformed Jev body (no numeric probability under 'noul') must not
    break the turn: degrade stated, stream completes, no carrier invented."""

    class MalformedJev:
        def system_one(self, state, questions, *, shadow=False):
            # A 200 response whose answer is not the documented shape.
            return {"answers": {"decision_worthy": {"noul": "not-a-number"}}}

    store = _RecordedStore(listing=[], detail=None)
    frames = _request(monkeypatch, session_id="s4", turn="decide something",
                      jev=MalformedJev(), store=store, catalog={"pdf": "pdf"})
    _assert_turn_completed_and_degrade_stated(frames)
    assert not (frames.get("jev_carrier") or []), \
        "a malformed response must never produce a guessed carrier"


def test_chat_with_jev_outage_degrades_without_breaking_the_turn(monkeypatch):
    """Jev raising on every call: no carrier, stated degrade, turn completes."""

    class OutJev:
        def system_one(self, state, questions, *, shadow=False):
            from balabot.jev import JevAPIError
            raise JevAPIError("connection refused")

    store = _RecordedStore(listing=[], detail=None)
    frames = _request(monkeypatch, session_id="s5", turn="anything",
                      jev=OutJev(), store=store, catalog={"pdf": "pdf"})
    _assert_turn_completed_and_degrade_stated(frames)
    assert not (frames.get("jev_carrier") or [])


# ---------------------------------------------------------------------------
# Call site 2: the chat path routes through the durable session store
# ---------------------------------------------------------------------------

def test_chat_records_decision_and_resume_state_into_the_durable_store(monkeypatch):
    """THE call-site proof for the durable store: the chat path must make a
    REAL store append carrying the gate-admitted decision and the resume
    state. Fails if _chat_append_session_state is removed from chat()."""
    jev = ScriptedJev([GATE_YES, SKIM, RE_READ, DRIFT_LOW])  # empty listing
    store = _RecordedStore(listing=[], detail=None)
    frames = _request(monkeypatch, session_id="s6", turn="we will ship Friday",
                      jev=jev, store=store, catalog={"pdf": "pdf"})
    assert frames.get("final", [{}])[0].get("content") == "ok"
    assert store.appends, "chat path never wrote to the durable session store"
    appended = store.appends[0]
    assert appended["session_id"] == "s6"
    assert appended["decisions"], "a gate-worthy decision was silently dropped"
    assert appended["decisions"][0]["text"] == "we will ship Friday"
    assert appended["resume_state"]["last_turn"] == "we will ship Friday"


def test_chat_store_failure_is_stated_never_silent(monkeypatch):
    """An unreachable store is a stated degrade, not a silent success and not
    a broken turn."""
    jev = ScriptedJev([GATE_YES, SKIM, RE_READ, DRIFT_LOW])
    store = _RecordedStore(listing=[], detail=None)

    def failing_append(snippet, payload=None):
        if "record_decision" in snippet:
            return {"ok": False, "error": "container_unreachable",
                    "reason": "container down"}
        return store.run(snippet, payload)

    monkeypatch.setattr(server, "_org_run", failing_append)
    monkeypatch.setattr(server, "_JEV_CHAT_CLIENT", jev)
    monkeypatch.setattr(server, "_JEV_CHAT_REASON", "")
    monkeypatch.setattr(server.httpx, "AsyncClient", _FakeAsyncClient)

    async def fake_json():
        return {"bot_id": "principal",
                "messages": [{"role": "user", "content": "ship it", "at": 1}],
                "session_id": "s7"}

    req = type("R", (), {"json": staticmethod(fake_json)})()
    resp = asyncio.run(server.chat(req))
    chunks: list[bytes] = []

    async def drain():
        async for chunk in resp.body_iterator:
            chunks.append(chunk if isinstance(chunk, bytes)
                          else str(chunk).encode("utf-8"))

    asyncio.run(drain())
    _assert_turn_completed_and_degrade_stated(_sse_frames(chunks))


# ---------------------------------------------------------------------------
# Call site 3: routing + continuity resume ride the real path
# ---------------------------------------------------------------------------

def test_chat_resume_route_reanchors_the_old_session(monkeypatch):
    """THE call-site proof for jev_continuity.route_session + the durable
    resume: Jev routes this turn to 'resume' over a REAL candidate list from
    the store, and the resumed session's re_anchor bundle rides the user
    message (ground truth from the store, not a summary). Fails if
    route_session / _resume_carrier are removed from the chat path."""
    jev = ScriptedJev([RESUME_ROUTE, GATE_NO, SKIM, RE_READ, DRIFT_LOW])
    store = _RecordedStore(
        # candidate purpose shares tokens with the turn so the pre-filter
        # KEEPS it (lexical floor — code, not Jev).
        listing=[{"session_id": "s_old", "purpose": "schema migration",
                  "next_seq": 40, "compaction_count": 0,
                  "last_compaction_at": None}],
        detail={"purpose": "migrate the database",
                "topic_spans": [{"topic": "schema", "start_seq": 1,
                                 "end_seq": 12}],
                "decisions": [{"text": "cut over Saturday",
                               "provenance": "governor",
                               "created_at": "2026-09-27T10:00:00Z"}],
                "resume_state": {"phase": 2}})
    frames = _request(monkeypatch, session_id="s_new",
                      turn="continue the schema migration",
                      jev=jev, store=store, catalog={"pdf": "pdf"})
    carriers = frames.get("jev_carrier") or []
    assert carriers, "no carrier rode the turn — resume call site removed?"
    for carrier in carriers:
        assert set(carrier) == {"carrier", "content", "session_id"}
        assert carrier["carrier"] == "user_message"
    # The RESUMED session's re-anchored mandate (from the durable store's
    # re_anchor, NOT a summary) reached the stream.
    blob = json.dumps(frames)
    assert "cut over Saturday" in blob, \
        "re_anchor decisions from the durable store never reached the stream"
    assert "schema: msgs 1-12" in blob, "topic spans never reached the stream"
    # The routing call really asked one Noul PER CANDIDATE + needs_new.
    routing_state, routing_questions = jev.calls[0]
    assert "same_purpose_s_old" in routing_questions
    assert "needs_new_session" in routing_questions
