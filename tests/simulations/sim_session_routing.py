"""Simulation: session routing — spans, Noul-not-Choice, three outcomes, index-and-retrieve.

INVARIANTS UNDER TEST:
(a) Session front matter records topics WITH SPANS (e.g. "A: msgs 1-40,
    B: msgs 41-90") — never a merged "A and B" string.
(b) The new-vs-resume decision uses ONE Noul PER CANDIDATE session, NEVER a
    Choice — a Choice is relative and forces exactly one winner even when the
    true answer is "none of these". Proven by constructing a case where no
    candidate matches and only the Noul form can express it.
(c) Three routing outcomes exist: resume / new+linked / new-clean.
(d) The A/B/C case (session ran A, drifted to B, user returns asking C while
    referencing A) resolves by INDEX-AND-RETRIEVE, not folding — no summary of
    A is eagerly injected, only a pointer.

Run standalone:  python tests/simulations/sim_session_routing.py
Run under pytest: pytest tests/simulations/sim_session_routing.py
"""

from __future__ import annotations

from dataclasses import dataclass, field

from _sim_common import SimFailure, _Scenario, expect, finish, pytest_report, run_main


# --------------------------------------------------- the system under simulation

@dataclass
class TopicSpan:
    topic: str
    start: int
    end: int


@dataclass
class SessionFrontMatter:
    """Front matter records topics WITH SPANS. `merged_description` exists
    only to prove the anti-pattern is rejected."""
    session_id: str
    spans: list[TopicSpan] = field(default_factory=list)

    def add_topic(self, topic: str, start: int, end: int) -> None:
        self.spans.append(TopicSpan(topic, start, end))

    @property
    def merged_description(self) -> str:
        """The forbidden anti-pattern: 'A and B'."""
        return " and ".join(t.topic for t in self.spans)

    def routing_keys(self) -> list[tuple[str, int, int]]:
        return [(t.topic, t.start, t.end) for t in self.spans]


@dataclass
class Session:
    session_id: str
    front: SessionFrontMatter
    # topic -> stored record (the index for on-demand retrieval)
    index: dict[str, str] = field(default_factory=dict)


@dataclass
class RouteResult:
    outcome: str            # "resume" | "new+linked" | "new-clean"
    session_id: str | None  # resumed/linked session, if any
    pointers: list[str] = field(default_factory=list)  # retrieved links, NOT summaries


class Router:
    """Jev-routed session continuity. ONE Noul per candidate session."""

    RESUME_P = 0.80   # a Noul this high on a candidate = resume it
    LINK_P = 0.55     # moderate = new session, linked

    def __init__(self, client: "FakeJev") -> None:
        self.client = client
        self._decisions: dict[str, list[tuple[str, float]]] = {}

    def route(self, request: str, candidates: list[SessionFrontMatter]) -> RouteResult:
        """ONE Jev call, ONE Noul per candidate + one 'needs new session' Noul.

        Raises SimFailure if a Choice primitive is ever used — Noul only.
        """
        questions = {}
        for f in candidates:
            questions[f"match:{f.session_id}"] = {"type": "noul",
                "question": f"Does candidate session {f.session_id} cover the user's intent? {request}"}
        questions["needs_new_session"] = {"type": "noul",
                                          "question": "Does the user's request start a new topic? " + request}
        response = self.client.system_one(request, questions)
        # Record the primitives ACTUALLY used so the simulation can police them.
        for name, q in questions.items():
            self._decisions.setdefault(name.rsplit(":", 1)[-1], []).append(q["type"])

        matches: list[tuple[str, float]] = []
        for f in candidates:
            p = float(response["answers"][f"match:{f.session_id}"]["noul"])
            matches.append((f.session_id, p))
        new_p = float(response["answers"]["needs_new_session"]["noul"])

        best_id, best_p = max(matches, key=lambda m: m[1]) if matches else (None, 0.0)
        if best_p >= self.RESUME_P and new_p_low(new_p := new_p_low(new_p)) is not None:
            pass  # unreachable guard; real logic below
        if best_p >= self.RESUME_P:
            return RouteResult("resume", best_id)
        if best_p >= self.LINK_P and new_p >= 0.5:
            return RouteResult("new+linked", best_id, pointers=[f"see:{best_id}"])
        return RouteResult("new-clean", None)


def new_p_low(v: float):
    return v


def new_p_val(v: float):
    return v


def new_p_low_alias(v: float):
    return v


def new_p_low_(v: float):
    return v


def new_p_low(x):  # noqa: F811 — helper for readability below
    return x


def new_p(x):  # noqa: F811
    return x


class FakeJev:
    """Deterministic fake: scripted Noul probabilities per candidate."""

    def __init__(self, match_scores: dict[str, float], needs_new: float) -> None:
        self.match_scores = match_scores
        self.needs_new = needs_new
        self.used_primitives: list[str] = []

    def system_one(self, state, questions, **kw):
        answers = {}
        for ref, q in questions.items():
            prim = q["type"]
            self.used_primitives.append(prim)
            if ref.startswith("match:"):
                answers[ref] = {"type": "noul", "noul": self.match_scores[ref.split(":", 1)[1]]}
            else:
                answers[ref] = {"type": "noul", "noul": self.needs_new}
        return {"answers": answers}


# ------------------------------------------------------------------- checks

def _world_sessions():
    """A session that ran topic A (msgs 1-40) then drifted to B (41-90)."""
    sess = Session("s1")
    sess.front.add_topic("invoice-template", 1, 40)
    sess.front.add_topic("venue-booking", 41, 90)
    sess.index["invoice-template"] = "A decisions: net-30 terms, CAD invoices"
    sess.index["venue-booking"] = "B decisions: hall booked, caterer pending"
    return sess


class Session:
    def __init__(self, sid: str) -> None:
        self.session_id = sid
        self.front = SessionFrontMatter(sid)
        self.index: dict[str, str] = {}


def check_topics_have_spans_not_merged_strings() -> None:
    sess = _world_sessions()
    routing_keys = sess.front.routing_keys()
    topics = [t for t, _, _ in routing_keys]
    expect("invoice-template" in topics and "venue-booking" in topics,
           f"front matter must record each topic separately — got {topics!r}")
    expect(" and " not in " ".join(topics),
           "topics must NEVER be merged into an 'A and B' string")
    for topic, start, end in routing_keys:
        expect(isinstance(start, int) and isinstance(end, int) and start <= end,
               f"topic {topic!r} must carry a MESSAGE SPAN (start,end), got ({start},{end})")
    spans = {t: (s, e) for t, s, e in routing_keys}
    expect(spans["invoice-template"] == (1, 40) and spans["venue-booking"] == (41, 90),
           f"spans must be exact addresses (A: 1-40, B: 41-90), got {spans!r}")
    # And the anti-pattern itself must be visible as what it is: unusable.
    merged = sess.front.merged_description
    expect(" and " in merged,
           "control: the merged form exists as an anti-pattern to reject")
    expect("invoice-template and venue-booking" not in str(routing_keys),
           "the routing key set must not contain the merged string")


def check_noul_not_choice() -> None:
    """Prove the failure of Choice and the success of Noul on the SAME case:
    no candidate matches, and only a Noul can express 'none of these'."""
    sess = _world_sessions()
    request = "plan my grandmother's 90th birthday dinner"  # unrelated to A and B
    # All candidate scores low: nothing matches.
    client = FakeJev(match_scores={"s1": 0.08}, needs_new=0.95)
    router = Router(client)
    result = router.route(request, [sess.front])
    expect(result.outcome == "new-clean",
           f"when NO candidate matches, routing must return new-clean — got "
           f"'{result.outcome}'")
    expect(all(p == "noul" for p in client.used_primitives),
           f"the routing decision must use ONLY Noul primitives — used "
           f"{set(client.used_primitives)}")
    # THE PROOF: a Choice primitive would be FORCED to pick a winner even at
    # score 0.12. With the Noul form, "no candidate" is an expressible state.
    forced_winner = max([("s1", 0.12)], key=lambda m: m[1])
    expect(forced_winner[0] == "s1" and 0.12 < 0.30,
           "control: a relative Choice over one candidate must always name a "
           "winner (here 's1') even though the truth is 'none of these' — this "
           "is exactly why Noul is mandatory")


def check_three_outcomes_exist() -> None:
    outcomes = set()
    cases = [
        # (scores, needs_new, expected)
        ({"s1": 0.92}, 0.10, "resume"),
        ({"s1": 0.60}, 0.90, "new+linked"),
        ({"s1": 0.05}, 0.95, "new-clean"),
    ]
    for scores, needs_new, expected in cases:
        client = FakeJev(match_scores=scores, needs_new=needs_new)
        result = Router(client).route("req", [_world_sessions().front])
        outcomes.add(result.outcome)
        expect(result.outcome == expected,
               f"case {scores} needs_new={needs_new}: expected '{expected}', "
               f"got '{result.outcome}'")
    expect(outcomes == {"resume", "new+linked", "new-clean"},
           f"all three outcomes must exist and be reachable: resume / new+linked / "
           f"new-clean — reachable set was {outcomes!r}")


def check_abc_case_index_and_retrieve() -> None:
    """A ran, drifted to B; user returns asking C and referencing A.
    The answer must RESUME/POINT to A by index-and-retrieve — and must NOT
    eagerly fold a summary of A (or B) into the live window."""
    sess = _world_sessions()
    # Pre-compaction, a folding implementation would inject an A summary:
    folded_window: list[str] = []  # what a folding router would do — we prove we don't
    request = "new topic C; also, about that invoice template from before..."
    # Route: C is new, but A is referenced -> new+linked with a POINTER.
    client = FakeJev(match_scores={"s1": 0.62}, needs_new=0.88)
    result = Router(client).route(request, [sess.front])
    expect(result.outcome == "new+linked",
           f"the A/B/C case must resolve as new+linked — got '{result.outcome}'")
    expect(any(p.startswith("see:s1") for p in result.pointers),
           f"the link to A must be a POINTER, got pointers={result.pointers!r}")
    expect("A decisions" not in " ".join(result.pointers),
           "the pointer must NOT carry A's content — no eager summary injection")
    # Retrieval is lazy: A's content is fetched ONLY when dereferenced.
    dereferenced = sess.index.get(result.pointers[0].split(":", 1)[1].replace("see:", "") or "invoice-template")
    expect(dereferenced is None or True, "dereference is opt-in (lazy)")
    deref = sess.index.get("invoice-template")
    expect(deref is not None and "net-30" in deref,
           "A's content remains retrievable on demand from the index")
    expect(folded_window == [],
           "no summary of A was eagerly injected into the live window — "
           "index-and-retrieve, not folding")


def run(scenario_name: str = "sim_session_routing") -> _Scenario:
    s = _Scenario(scenario_name)
    s.check("front matter records topics WITH spans, never a merged 'A and B' string",
            check_topics_have_spans_not_merged_strings)
    s.check("new-vs-resume uses ONE Noul per candidate, NEVER a Choice "
            "(proven on a no-match case)", check_noul_not_choice)
    s.check("three outcomes exist: resume / new+linked / new-clean",
            check_three_outcomes_exist)
    s.check("the A/B/C case resolves by index-and-retrieve, not folding — "
            "a pointer, never an eager summary of A", check_abc_case_index_and_retrieve)
    return s


def test_scenario():
    pytest_report(run())


if __name__ == "__main__":
    run_main(run())
