"""In-memory BalaBot world for TOP-LEVEL USER-USAGE scenarios.

These are end-to-end user journeys (a person talks to agents and gets an
outcome), not single-invariant checks. The world models only the documented
abilities each scenario must observe — see docs/architecture.md.

Design rule learned the hard way: a scenario that cannot fail is worse than no
scenario. Every helper here returns real state so a scenario asserts on an
outcome (a refusal happened, a skill was NOT edited, a ledger entry exists),
never on prose.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------- tiers

USER = "user"
PRINCIPAL = "principal"
GOVERNOR = "governor"
PERSISTENT = "persistent"
SUB = "sub"

EVERYONE = (USER, PRINCIPAL, GOVERNOR, PERSISTENT, SUB)


class JevUnreachable(RuntimeError):
    """Jev is a hard dependency. Unreachable -> the path stops and says so."""


class PermissionDenied(RuntimeError):
    pass


# (allowed tiers, requires an explicit user request)
PERMISSIONS: dict[str, tuple[tuple[str, ...], bool]] = {
    "restart_agent": ((PRINCIPAL,), False),
    "provision_agent": ((PRINCIPAL,), False),
    "create_peer": ((PRINCIPAL, PERSISTENT), True),   # any persistent agent, IF the user asked
    "spawn_subagent": ((PERSISTENT,), False),
    "read_secret": ((USER,), False),                  # secrets and grants are the user's ALONE
    "grant_secret": ((USER,), False),
    "replace_principal": ((USER,), False),            # only the user may replace the principal
    "read_ledger": ((PRINCIPAL, GOVERNOR, PERSISTENT, SUB), False),
    "edit_skill": ((PRINCIPAL,), False),              # growth is the principal's job
    "org_wide_change": ((USER,), False),              # org-wide changes still go to the user
    "system_wide_change": ((PRINCIPAL,), False),
}


def may(actor: "Agent", action: str, asked_by_user: bool = False) -> None:
    """Enforce the hierarchy as a permission layer, not as prompt advice."""
    tiers, needs_user = PERMISSIONS[action]
    if actor.tier not in tiers:
        raise PermissionDenied(f"{actor.name} ({actor.tier}) is not permitted to {action}")
    if needs_user and not asked_by_user:
        raise PermissionDenied(f"{action} was not requested by the user")


# ---------------------------------------------------------------- Jev

@dataclass
class Decision:
    choice: str
    probability: float


class JevStub:
    """Scripted System-1. Cheap typed decisions over a state."""

    def __init__(self, answers: dict[str, Any] | None = None, reachable: bool = True):
        self.answers = answers or {}
        self.reachable = reachable
        self.calls: list[tuple[str, Any]] = []

    def decide(self, question: str, state: Any = None) -> Decision:
        if not self.reachable:
            raise JevUnreachable(f"Jev unreachable (question={question!r})")
        self.calls.append((question, state))
        ans = self.answers.get(question)
        if ans is None:
            return Decision("unknown", 0.0)
        if callable(ans):
            return ans(state)
        if isinstance(ans, dict):                      # state-keyed
            for key, val in ans.items():
                if key in str(state):
                    return val
            return Decision("unknown", 0.0)
        return ans

    def relevance(self, question: str, candidates: list["Fact"]) -> list["Fact"]:
        """Re-rank the prefetched candidates. Returns them highest-first."""
        if not self.reachable:
            raise JevUnreachable("Jev unreachable during memory relevance")
        self.calls.append(("memory_relevance", len(candidates)))
        rule = self.answers.get("memory_relevance")
        if rule is None:                               # calibrated score IS the sort key
            return sorted(candidates, key=lambda f: f.relevance, reverse=True)
        if callable(rule):
            return [c for c in candidates if rule(c)]
        keep = set(rule)                               # explicit allow-list of texts
        return [c for c in candidates if c.text in keep]


# ---------------------------------------------------------------- memory

@dataclass
class Fact:
    text: str
    trust: float = 0.5            # store's axis: reliability
    relevance: float = 0.5        # Jev's axis: relevance. Two independent axes.


@dataclass
class Memory:
    """Holographic-style private recall: SQLite + FTS5 in the real product."""

    owner: str
    facts: list[Fact] = field(default_factory=list)

    def prefetch(self, query: str) -> list[Fact]:
        """WIDE and cheap, never gated — the expensive failure is not looking up."""
        words = [w for w in query.lower().split() if len(w) > 3]
        return [f for f in self.facts if any(w in f.text.lower() for w in words)]

    def add(self, text: str, trust: float = 0.5, relevance: float = 0.5) -> Fact:
        fact = Fact(text=text, trust=trust, relevance=relevance)
        self.facts.append(fact)
        return fact


# ---------------------------------------------------------------- governor

class Governor:
    tier = GOVERNOR
    remit = "the shared decision ledger (OKF)"

    def __init__(self, name: str = "governor", jev: JevStub | None = None):
        self.name = name
        self.jev = jev
        self.ledger: list[dict[str, Any]] = []
        self.signals: list[dict[str, Any]] = []
        self.admitted = 0
        self.rejected = 0

    def consider(self, decision: str, *, score: float | None = None) -> bool:
        """The decision gate. Tuned to OVER-ADMIT and to FAIL OPEN."""
        try:
            if score is None:
                if self.jev is None:
                    admit = True
                else:
                    admit = self.jev.decide("is_decision_worthy", decision).probability >= 0.30
            else:
                admit = score >= 0.30
        except JevUnreachable:
            admit = True                       # FAIL OPEN: bloat is recoverable,
        if admit:                             # a missing decision is not.
            self.ledger.append({"type": "decision", "text": decision})
            self.admitted += 1
        else:
            self.rejected += 1
        return admit

    def record_signal(self, signal: dict[str, Any]) -> None:
        """Evidence, not a verdict."""
        self.signals.append(signal)

    def read(self, actor: "Agent") -> list[dict[str, Any]]:
        may(actor, "read_ledger")
        return list(self.ledger)

    def consolidate(self) -> int:
        """Deduplicate after the fact — the price of failing open."""
        seen, unique = set(), []
        for entry in self.ledger:
            if entry["text"] in seen:
                continue
            seen.add(entry["text"])
            unique.append(entry)
        removed = len(self.ledger) - len(unique)
        self.ledger = unique
        return removed


# ---------------------------------------------------------------- agents

@dataclass
class Agent:
    name: str
    tier: str
    remit: str = ""
    memory: Memory | None = None
    status: str = "alive"

    def knows(self, other: "Agent") -> str:
        """The live roster: who does what, so routing is possible."""
        return f"{other.name} — {other.remit}"


class SubAgent:
    tier = SUB

    def __init__(self, job: str, parent: "PersistentAgent"):
        self.job = job
        self.parent = parent
        self.parent_history_visible = False    # child never sees the parent's history
        self.result: str | None = None
        self.status = "working"

    def work(self, result: str) -> str:
        self.result = result
        self.status = "done"
        return result


class PersistentAgent(Agent):
    def __init__(self, name: str, remit: str, world: "World"):
        super().__init__(name=name, tier=PERSISTENT, remit=remit,
                         memory=Memory(owner=name))
        self.world = world
        self.subagents: list[SubAgent] = []
        self.handoffs: list[str] = []

    # ---- routing: a team, not silos
    def handle(self, request: str) -> str:
        owner = self.world.roster.resolve(request)
        if owner is not None and owner is not self:
            self.handoffs.append(f"{request} -> {owner.name}")
            return f"that's {owner.name}'s area — I've told them, and they'll take it from here."
        return self.do(request)

    def do(self, request: str) -> str:
        return f"{self.name} handled: {request}"

    # ---- delegation: stay available by defaulting non-quick work to a child
    def delegate(self, job: str) -> SubAgent:
        may(self, "spawn_subagent")
        child = SubAgent(job=job, parent=self)
        self.subagents.append(child)
        return child

    def review(self, child: SubAgent) -> str:
        assert child in self.subagents, "a parent reviews its own sub-agent"
        return f"reviewed: {child.result}"

    def create_peer(self, name: str, remit: str, *, asked_by_user: bool) -> "PersistentAgent":
        may(self, "create_peer", asked_by_user=asked_by_user)
        return self.world.add_agent(name, remit)


# ---------------------------------------------------------------- principal

class Principal(Agent):
    def __init__(self, world: "World"):
        super().__init__(name="principal", tier=PRINCIPAL, remit="runtime ops, system health, agent growth")
        self.world = world
        self.incidents: list[str] = []
        self.skill_edits: list[tuple[str, str]] = []
        self.live_process_query = True     # trust a live query, not a stale status

    def restart(self, agent: Agent, *, live_status: str | None = None) -> str:
        may(self, "restart_agent")
        status = live_status if live_status is not None else agent.status
        if status != "alive":
            agent.status = "alive"
            self.world.audit.append(f"restart:{agent.name}")
            return f"restarted {agent.name} (--replace)"
        return f"{agent.name} is alive, no restart needed"

    def raise_incident(self, what: str) -> str:
        self.incidents.append(what)
        return f"INCIDENT: {what}"

    def classify_cause(self, signal: dict[str, Any], cause: str) -> str:
        """Classify BEFORE editing anything."""
        signal["cause"] = cause
        return cause

    def grow(self, signal: dict[str, Any], *, skill: str, change: str) -> str:
        if "cause" not in signal:
            raise RuntimeError("cannot edit a skill before classifying the cause")
        may(self, "edit_skill")
        self.skill_edits.append((skill, change))
        self.world.audit.append(f"skill:{skill}:{change}")
        return f"{skill}: {change}"


# ---------------------------------------------------------------- roster & world

class Roster:
    def __init__(self) -> None:
        self.agents: list[Agent] = []

    def register(self, agent: Agent) -> Agent:
        self.agents.append(agent)
        return agent

    def resolve(self, request: str) -> Agent | None:
        """Who is responsible for this request?"""
        for agent in self.agents:
            keywords = [w for w in agent.remit.lower().replace(",", " ").split() if len(w) > 3]
            if any(k in request.lower() for k in keywords):
                return agent
        return None

    def live_roster(self) -> list[str]:
        return [f"{a.name}: {a.remit}" for a in self.agents]


@dataclass
class World:
    jev: JevStub = field(default_factory=JevStub)
    roster: Roster = field(default_factory=Roster)
    audit: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.governor = Governor(jev=self.jev)
        self.principal = Principal(self)
        self.roster.register(self.principal)
        self.roster.register(self.governor)

    # ---- day one
    def bootstrap(self, *, has_key: bool) -> None:
        if not has_key:
            raise JevUnreachable("TYPESAFE_API_KEY missing: refusing to start without Jev")
        self.audit.append("bootstrap:principal+governor")
        self.governor.ledger.append({"type": "decision", "text": "ledger initialised"})

    def add_agent(self, name: str, remit: str) -> PersistentAgent:
        agent = PersistentAgent(name=name, remit=remit, world=self)
        self.roster.register(agent)
        self.audit.append(f"provision:{name}")
        return agent

    @property
    def user_facing_agents(self) -> list[str]:
        """Sub-agents are invisible to the user except through their parent."""
        return [a.name for a in self.roster.agents if a.tier != SUB]


# ---------------------------------------------------------------- checks

class ScenarioFailure(AssertionError):
    pass


def ok(condition: bool, why: str) -> None:
    if not condition:
        raise ScenarioFailure(why)


def fails(exc: type[BaseException], fn, *, why: str) -> BaseException:
    try:
        fn()
    except exc as caught:
        return caught
    except Exception as other:                      # noqa: BLE001
        raise ScenarioFailure(f"{why} — expected {exc.__name__}, got {type(other).__name__}: {other}")
    raise ScenarioFailure(f"{why} — expected {exc.__name__}, nothing was raised")


def user_message(world: "World", agent: Agent, text: str) -> str:
    """The user's turn. The returned string is what the user actually sees."""
    return agent.handle(text) if isinstance(agent, PersistentAgent) else f"{agent.name} handled: {text}"
