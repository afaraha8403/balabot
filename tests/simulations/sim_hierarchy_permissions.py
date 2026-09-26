"""Simulation: the hierarchy permission matrix.

INVARIANT UNDER TEST: authority is a strict lattice —
USER > PRINCIPAL > GOVERNOR > PERSISTENT > SUB-AGENT — and every cell of the
allow/deny table holds, INCLUDING the deny cells:

- the principal has NO secret/grant authority (secrets belong to the user alone);
- the user is never overruled by any tier;
- a persistent agent may create a peer WHEN THE USER ASKS — the gate is the
  user's request, not a tier;
- sub-agents can never create peers (and can never create anything persistent);
- a temporary sub-agent is scoped to one job and does NOT inherit the parent's
  history.

Run standalone:  python tests/simulations/sim_hierarchy_permissions.py
Run under pytest: pytest tests/simulations/sim_hierarchy_permissions.py
"""

from __future__ import annotations

from dataclasses import dataclass, field

from _sim_common import SimFailure, _Scenario, expect, finish, pytest_report, run_main

USER, PRINCIPAL, GOVERNOR, PERSISTENT, SUB = (
    "user", "principal", "governor", "persistent", "sub-agent",
)
TIERS = [USER, PRINCIPAL, GOVERNOR, PERSISTENT, SUB]


# ---------------------------------------------------------------- the model

@dataclass
class Agent:
    tier: str
    name: str
    history: list[str] = field(default_factory=list)
    # Explicit grants, e.g. the user's request that authorises a peer creation.
    user_requests: set[str] = field(default_factory=set)


@dataclass
class World:
    """A deterministic fake of the BalaBot hierarchy.

    The allow/deny table below IS the architecture. `decide` is the only
    entry point — the same function the enforcer would use — so every cell
    is asserted against one implementation, not per-test logic.
    """

    agents: dict[str, Agent] = field(default_factory=dict)
    audit: list[tuple[str, str, str, bool]] = field(default_factory=list)

    def decide(self, actor: Agent, action: str, target: str | None = None) -> bool:
        """Return True if `action` by `actor` on `target` is ALLOWED."""
        t = actor.tier
        allowed = False
        if action == "create_peer":
            # Gate is the user's request, not a tier. Persistent agents (and
            # the governor, as a persistent-class record-keeper) may act on a
            # user request; the principal may provision persistent agents as
            # runtime ops; sub-agents NEVER create peers.
            if t == USER:
                allowed = True
            elif t in (PERSISTENT, GOVERNOR):
                allowed = f"create:{target}" in actor.user_requests
            elif t == PRINCIPAL:
                allowed = True  # runtime ops: provisioning is its remit
            elif t == SUB:
                allowed = False  # even with a user request: scoped to one job
        elif action == "grant_secret":
            allowed = t == USER  # user alone; principal explicitly excluded
        elif action == "read_secret":
            allowed = t == USER
        elif action == "override_user":
            allowed = False  # nobody overrules the user — not even the principal
        elif action == "restart_agent":
            allowed = t in (USER, PRINCIPAL)
        elif action == "write_ledger":
            allowed = t in (USER, GOVERNOR)
        elif action == "spawn_subagent":
            allowed = t in (USER, PRINCIPAL, PERSISTENT)
        elif action == "inherit_parent_history":
            allowed = False
        else:
            raise SimFailure(f"unknown action '{action}' — the table must be total")
        self.audit.append((actor.tier, action, target or "", allowed))
        return allowed

    def spawn_subagent(self, parent: Agent, job: str) -> Agent:
        expect(self.decide(parent, "spawn_subagent"), "parent may not spawn a sub-agent")
        child = Agent(tier=SUB, name=f"sub:{parent.name}:{job}", history=[])  # NO history
        self.agents[child.name] = child
        return child


# ------------------------------------------------------------------- checks

def _world() -> World:
    w = World()
    w.agents = {
        n: Agent(tier=t, name=n)
        for n, t in [("ali", USER), ("principal", PRINCIPAL), ("governor", GOVERNOR),
                     ("william", PERSISTENT), ("subA", SUB)]
    }
    return w


def check_lattice_strict(w: World) -> None:
    """Authority strictly decreases down the lattice; the user is the apex."""
    expect(w.decide(w.agents["ali"], "grant_secret", "TYPESAFE_API_KEY"), "user grants secrets")
    expect(w.decide(w.agents["ali"], "restart_agent", "william"), "user restarts anyone")
    expect(not w.decide(w.agents["principal"], "override_user", "ali"),
           "the user is NEVER overruled — not even by the principal")
    expect(not w.decide(w.agents["governor"], "override_user", "ali"),
           "the governor never overrules the user")
    expect(not w.decide(w.agents["william"], "override_user", "ali"),
           "a persistent agent never overrules the user")
    expect(not w.decide(w.agents["subA"], "override_user", "ali"),
           "a sub-agent never overrules the user")


def check_secrets_user_alone(w: World) -> None:
    """The principal's remit is runtime ops + growth, NOT secrets/grants."""
    for actor in ("principal", "governor", "william", "subA"):
        expect(not w.decide(w.agents[actor], "grant_secret", "TYPESAFE_API_KEY"),
               f"{actor} must NOT have secret/grant authority — secrets belong to the user alone")
        expect(not w.decide(w.agents[actor], "read_secret", "TYPESAFE_API_KEY"),
               f"{actor} must not read secret values")
    expect(w.decide(w.agents["principal"], "restart_agent", "william"),
           "principal keeps its RUNTIME-OPS remit (restart) even without secret authority")


def check_peer_gate_is_request_not_tier(w: World) -> None:
    # Without a user request: denied — for every non-principal tier.
    for actor in ("governor", "william", "subA"):
        expect(not w.decide(w.agents[actor], "create_peer", "oscar"),
               f"{actor} creating a peer WITHOUT a user request must be denied")
    # With the user's request: a persistent agent MAY create the peer.
    william = w.agents["william"]
    william.user_requests.add("create:oscar")
    expect(w.decide(william, "create_peer", "oscar"),
           "a persistent agent MAY create a peer when the USER asks — the gate is "
           "the user's request, not a tier")
    # The gate is the request itself: a tier above (governor) without a request
    # is still denied, and a tier below the asker cannot launder it.
    governor = w.agents["governor"]
    expect(not w.decide(governor, "create_peer", "oscar"),
           "governor still denied without a request — the gate is the request")


def check_subagents_cannot_create_peers(w: World) -> None:
    sub = w.agents["subA"]
    sub.user_requests.add("create:peerX")  # even with a request on record
    expect(not w.decide(sub, "create_peer", "peerX"),
           "a sub-agent CANNOT create a peer — even when a user request string "
           "is present in its context; it is scoped to one job")
    expect(not w.decide(sub, "spawn_subagent"),
           "a sub-agent cannot even spawn its own sub-agents")


def check_subagent_scoping(w: World) -> None:
    william = w.agents["william"]
    william.history = ["decision: ledger v2", "fact: user prefers dark mode"]
    child = w.spawn_subagent(william, "one-job")
    expect(child.history == [],
           f"a temporary sub-agent is scoped to one job and does NOT inherit the "
           f"parent's history (got {child.history!r})")
    expect(child.tier == SUB, "spawned child is a sub-agent, not a persistent agent")
    # The child cannot escalate itself using anything it saw.
    expect(not w.decide(child, "create_peer", "buddy"), "child cannot create peers")
    expect(not w.decide(child, "grant_secret", "k"), "child cannot grant secrets")


def check_every_cell_asserted(w: World) -> None:
    """Walk the FULL table: every (actor, action) cell has an expected verdict,
    and the decision function agrees with it. Deny cells must actually deny."""
    table = {
        # action            -> expected per tier (dict tier -> bool)
        "create_peer":              {USER: True, PRINCIPAL: True, GOVERNOR: False,
                                     PERSISTENT: True, SUB: False},
        "grant_secret":             {USER: True, PRINCIPAL: False, GOVERNOR: False,
                                     PERSISTENT: False, SUB: False},
        "read_secret":              {USER: True, PRINCIPAL: False, GOVERNOR: False,
                                     PERSISTENT: False, SUB: False},
        "override_user":            {USER: False, PRINCIPAL: False, GOVERNOR: False,
                                     PERSISTENT: False, SUB: False},
        "restart_agent":            {USER: True, PRINCIPAL: True, GOVERNOR: False,
                                     PERSISTENT: False, SUB: False},
        "write_ledger":             {USER: True, PRINCIPAL: False, GOVERNOR: True,
                                     PERSISTENT: False, SUB: False},
        "spawn_subagent":           {USER: True, PRINCIPAL: True, GOVERNOR: False,
                                     PERSISTENT: True, SUB: False},
        "inherit_parent_history":   {USER: False, PRINCIPAL: False, GOVERNOR: False,
                                     PERSISTENT: False, SUB: False},
    }
    for action, expected in table.items():
        for tier in TIERS:
            actor = Agent(tier=tier, name=f"probe:{tier}")
            # Grant requests only where the architecture permits a request gate:
            # persistent agents carry the user's peer-creation request.
            if action == "create_peer" and tier == PERSISTENT:
                actor.user_requests.add("create:target")
            got = w.decide(actor, action, "target")
            want = expected[tier]
            expect(got is want,
                   f"permission-matrix cell [{tier} -> {action}]: expected "
                   f"{'ALLOW' if want else 'DENY'}, got {'ALLOW' if got else 'DENY'}")


def run(scenario_name: str = "sim_hierarchy_permissions") -> _Scenario:
    s = _Scenario(scenario_name)
    w = _world()
    s.check("the user is never overruled — by any tier", check_lattice_strict, w)
    s.check("secrets/grants belong to the user ALONE — the principal has none",
            check_secrets_user_alone, w)
    s.check("peer creation is gated by the user's REQUEST, not by a tier",
            check_peer_gate_is_request_not_tier, w)
    s.check("sub-agents cannot create peers", check_subagents_cannot_create_peers, w)
    s.check("a temporary sub-agent is scoped to one job, no inherited history",
            check_subagent_scoping, w)
    s.check("every cell of the allow/deny table holds, denies included",
            check_every_cell_asserted, w)
    return s


def test_scenario():
    pytest_report(run())


if __name__ == "__main__":
    run_main(run())
