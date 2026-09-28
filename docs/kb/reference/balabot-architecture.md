---
type: reference
title: BalaBot — product architecture (principal, governor, persistent agents, sub-agents)
description: BalaBot is an MIT-licensed, open-source multi-agent system based on Grok Bot, shipped as a single Docker image containing Hermes plus two pre-configured agents (principal and governor). Defines the hierarchy (user, principal, governor, persistent agents, sub-agents), each tier's responsibilities, the memory choice, the Jev signal layer, and how each maps onto Hermes primitives.
tags: [balabot, grokbot, architecture, hierarchy, principal, governor, persistent-agents, subagents, holographic, jev, mit]
timestamp: 2026-09-27T06:25:00Z
status: partial  # code complete and CI-green; live Jev integration unproven
repo: https://github.com/afaraha8403/balabot
verified: 2026-09-26 — image builds and provisions both agents; 66 tests pass with PYTHONPATH unset (CI parity); 7 invariant sims + 21 user-usage scenarios green standalone; 8/8 mutations detected; Docker E2E 5/5 incl. a live model round-trip; CI green on 99cae5e4. Live TypeSafe contract tests pass 3/3 with the key in balabot/.env (untracked); a full end-to-end Jev growth-loop run against the live API is still outstanding. Telegram gateway still unexercised (no tokens).
---

# BalaBot

**BalaBot** (B-A-L-A-Bot) — MIT-licensed, open source, based on Grok Bot.
**Repo: https://github.com/afaraha8403/balabot** (public).

It ships as **ONE Docker image that contains Hermes itself**, plus **two pre-configured agents — the
principal and the governor** — provisioned on first boot. That is what a fresh install greets you with,
and it behaves that way from day one: no setup ritual, no second container, no UI required.

**Jev (TypeSafe AI) is a hard dependency** — infrastructure, not an add-on. The image validates the key
at startup and fails loudly if it is missing. There is no fallback provider.

## Shipped (2026-09-26)

**https://github.com/afaraha8403/balabot** — public, MIT, 98 tracked files (`git ls-files | wc -l`). CI **green** (`99cae5e4`, verified via `gh run list --commit 99cae5e4` → `success`).

### Verification — all of it executed, none of it asserted

| Layer | Result |
|---|---|
| Unit + integration (`pytest`) | **66 passed** — run with `PYTHONPATH` unset, i.e. the CI condition |
| Architecture simulations | **7 scenarios, 45 checks, all green** — and each runs standalone too |
| **User-usage scenarios** | **21 end-to-end journeys, all green** standalone and under pytest — the abilities below walked the way a user actually meets them |
| Mutation check | **8/8 detected** — every scenario fails when the ability it guards is broken |
| Docker E2E | **5/5** — build, no-key exit 1, both personas provisioned, config deltas, **live model round-trip `BALABOT_OK`** |
| **Cloudflare tunnel E2E** | **10/10** — dormant by default (slot DOWN, no process); the token appears in neither the log nor any process command line; a mounted-secret token works; an unreadable one is reported loudly |
| GitHub Actions | **success** on `99cae5e4` |

Simulations each protect one hard promise: fail-loud on Jev outage · the hierarchy permission
matrix (deny cells deny) · **secret non-leakage** · the decision gate failing open · session
routing (spans not merged strings, one Noul per candidate not a Choice, index-and-retrieve not
fold) · the memory ladder · the frustration pipeline measured as a **rate**.

### What verification actually caught

Almost none of these were visible by reading the code:

- **pytest silently skipped every simulation** — default pattern is `test_*.py`, so `sim_*.py`
  never ran: green CI over zero simulation coverage. `pytest.ini` now collects them.
- **CI failed with `ModuleNotFoundError: No module named 'balabot'`** while passing locally —
  a local `PYTHONPATH` export masked it. `conftest.py` now inserts the repo root itself.
- **`jev.py` let an un-wrapped `TimeoutError` escape** the `JevError` contract — a transport
  timeout could surface as a bare builtin error instead of an incident naming Jev. Hardened.
- **The frustration simulation was vacuous**: its fake Jev matched the wrong direction, and
  `record_signal` dropped the timestamp — so the growth loop's *only* metric read `0.00` both
  before and after. It asserted nothing while appearing green.
- **A source-regex check flagged the documentation of "no fallback" as a fallback path** — the
  word is not a mechanism. Replaced with an AST-based check over executable code only.
- Plus: three-way tuple unpacked as two; a method called by a name that never existed; a
  parameter shadowing a module function; self-referential walrus operators; a bare `SyntaxError`.
- In the E2E harness: `docker build` and `--env-file` both failing on MSYS `/c/...` paths
  (native `docker.exe` does not translate them), and a live step invoking a command that
  does not exist.

### The build decision that mattered

Built `FROM nousresearch/hermes-agent:v2026.9.24`, not a bare `python:slim`. Debian trixie ships
SQLite **3.46.1**, which carries the upstream WAL-reset corruption bug — and BalaBot's per-agent
memory *is* SQLite, so a from-scratch image would have shipped a silent data-loss risk in the one
subsystem we depend on. The official image supplies a patched **3.53.4 with FTS5** plus the **s6
supervision tree** the principal needs in order to restart agents. A first build on
`python:3.12-slim` was discarded for exactly this reason.

## The hierarchy (this is the load-bearing idea)

```
USER                    most privilege — approves, overrides, owns the machine
  └── PRINCIPAL BOT     runtime ops, system health, and AGENT GROWTH
        └── GOVERNOR    the shared decision ledger (OKF) every other agent reads
              └── PERSISTENT AGENTS   do the real work; user-facing; delegate the heavy lifting
                    └── SUB-AGENTS    temporary, short- or long-lived, spawned per job
```

The principal and the governor are the two agents **shipped out of the box** — every BalaBot install
has them from day one.

## Governor — the decision ledger

Ships alongside the principal. Its job is **shared, durable, portable knowledge** that other agents
can read.

- **OKF database of decisions.** Every time a persistent agent working with the user reaches a
  **decision point**, it tells the governor "this decision was taken." The governor records it in
  **Open Knowledge Format** — the same spec our vaults already use (`type` required; `title`,
  `description`, `resource`, `tags`, `timestamp` recommended).
- **Data points collected for other agents.** Beyond decisions, it gathers the facts other agents and
  sub-agents need, so nobody re-derives what someone already established.
- **Readable by persistent agents AND sub-agents.**
- **It feeds the principal's growth loop.** When the principal improves skills and grows agents, it
  consults the governor to learn what each persistent agent actually needs — the ledger is the
  evidence base, not the principal's guesses.

**Why OKF files and not a database engine:** the ledger is the thing an open-source project most
needs to be inspectable. Plain-text OKF in a git-able tree is human-readable, diffable, portable
between installs, and matches the format our vaults already speak. A closed store would make the
governor a black box in a project meant to be read.

## Memory — what ships, and why

Ali asked for a strong contender we can actually ship in the Docker image. The field, measured
against "must run locally with no external service":

| Provider | Requires | Verdict |
|---|---|---|
| **Holographic** | **Nothing** — SQLite is stdlib | ✅ **the pick** |
| ByteRover | `brv` CLI (npm/install script) | extra binary in the image; cloud sync is its real feature |
| RetainDB | account + API key, $20/mo | no — cloud, paid |
| Honcho | API key or self-hosted instance | strong for multi-agent, but adds infrastructure to ship |
| Mem0 / Supermemory / Hindsight / OpenViking | see docs; API-backed | no — external dependency |

**Recommended: Holographic**, per agent. It is a local SQLite fact store with FTS5 full-text search,
entity resolution, **trust scoring** and **HRR compositional algebra**, requiring nothing beyond the
standard library (NumPy optional). Its tool surface is exactly what a working agent needs:
`fact_store` (`add`, `search`, `probe`, `related`, `reason`, `contradict`, `update`, `remove`,
`list`) and `fact_feedback` (helpful/unhelpful ratings that train trust). `contradict` — automated
conflict detection — is the same discipline the governor needs, which is a nice alignment.

**This is not a guess:** holographic is the provider active on Ali's own default profile right now,
with ~100 facts stored and entity resolution in use. We have real operational experience with it.

**Who gets memory:** the **principal, the governor, and every persistent agent** have their own
memory. **Sub-agents do not** — they are scoped to one job and their parent carries the learning
forward. Hermes scopes memory per profile by design, which is exactly the isolation we want.

**The split that matters:** per-agent memory is *private recall* (that agent's own SQLite store);
the **governor's OKF ledger is the shared channel**. Hermes' own docs warn against pointing two
agents at one home directory and say to use a shared provider for shared memory — the governor is
that shared channel, deliberately as files.

## Agent awareness — the live roster

Every persistent agent must know **all the other persistent agents and what they are responsible
for, all the time**. Not the instruction text in an `AGENTS.md` — a live registry of who does what,
so routing works:

> User asks Agent A for something that is Agent B's remit → A answers honestly: "that's B's area —
> I've told B, and they'll take it from here."

That turns a team of agents into a team rather than a set of silos, and it is what makes the
"employees on a team" model real instead of decorative.

## Day one, not day thirty

The container ships configured so BalaBot **behaves this way from install**: the setup process
pre-populates the config (principal + governor provisioned, memory provider set, ledger initialised,
org/roster registered). No UI required for this stage — the config is the deliverable.

Hermes today has **no formal hierarchy** — spawning depth is a mechanic, not reporting lines
(`agent-team-architecture.md` §1). BalaBot therefore has to *enforce* one rather than describe it.
Any rule enforced only by prompt text will drift.

**Peer creation is allowed — the principal is NOT the only provisioner** (Ali, 2026-09-26).
These agents are employees on a team: when the **user asks** for another persistent agent, **any**
persistent agent may create it. The gate is the user's request, not a tier. This removes the
single-point-of-failure problem without weakening consent.

**The principal can make any change across the entire system** — but its remit is runtime ops,
system health and agent growth, **not** secret/grant administration.

## Tier responsibilities

### Principal bot — the default main agent

It is **not** a task-doer. It runs the system and it **leads the other agents**.

- **Liveness & recovery** — keeps tabs on every agent (working, stuck, frozen), restarts a specific
  persistent agent when it looks dead. This is the Susan pattern generalised: `gateway run --replace`,
  live process queries over `gateway status`, watchdogs.
- **Diagnosis** — reads logs, notices errors/issues, fixes what it can, and **raises what it cannot
  quickly**.
- **Growth & leadership** — runs **routine jobs** that review each agent's skills, outputs and
  working style and improve them over time: skills properly written and formatted, CLIs and
  configuration sharpened, drift corrected. It makes the other agents measurably better at being
  agents, not just unblocked.
- **System-wide change authority** — may alter anything across the entire system (config, skills,
  agents), because keeping the architecture coherent is its job.
- **Onboarding** — the first agent you talk to; helps configure the environment and create your
  first working agent.
- **Conveys the hierarchy** — every agent it touches knows who the user is and that the principal
  sits above it.
- **Reads the chats and watches for frustration** — reviews conversations across agents, and gets
  **alerted when a user is frustrated**. Frustration is a *leading indicator*: it feeds the growth
  loop (this agent is losing the user — here is why) rather than being a verdict on its own.
  **How frustration is measured is deliberately open** — see below.

**Explicitly NOT its remit:** secrets and grants. Those are the user's alone.

### The frustration sensor — System 1 in, System 2 out

The intended measuring instrument is **Jev** — and note the vendor: **Jev is by TypeSafe AI**
(founder Diogo Almeida), **not Typeface AI**. Launched around 15 Sep 2026, it is the first
"System One model": you send a **state** plus **typed questions**, and it returns **structured
decisions with calibrated probabilities** — no prose, no JSON to parse. Trained with RLCD
(Reinforcement Learning for Calibrated Decisions) for honest probabilities rather than chat
preference. Roughly 70–500 ms per call in a single forward pass, and one to three orders of
magnitude cheaper than an LLM on this class of task. Independent write-ups have already tested it on
**anger detection** — close to our exact use case.

That shape is the point, and it maps onto the tier split:

| | System 1 — the sensor | System 2 — the reviewer |
|---|---|---|
| **What** | Jev: "is this user frustrated?" → typed answer + probability | the principal |
| **Cost/latency** | cheap, fast, runs on every turn | slow, deliberate, runs on a schedule or on alert |
| **Authority** | **none** — it raises a signal | diagnoses, decides, and changes things |

Design consequences to honour when we build it:

- **Reading conversations is a different access class from changing config.** The principal holds
  system-wide *change* authority; reading the user's private exchanges is a separate grant and should
  be treated as one. It reads **for signal**, not to warehouse transcripts.
- **A sensor is not a verdict.** A false positive must not silently degrade a working agent. The
  sensor flags; the principal investigates; the principal acts. Nothing auto-punishes on a score.
- **Jev classifies, it does not reason.** It can say *that* the user is frustrated and how strongly;
  it cannot say *why*. Diagnosis stays with the principal.
- **Placement:** reviewing the chat record (after the fact) rather than gating each response in-loop —
  cheaper, and it cannot delay or distort a live reply.

### The frustration pipeline — four layers

```
1. KEYWORD DICTIONARY   local, runs on every message, high-recall net
        ↓  flag + surrounding window
2. JEV                  is this actually frustration? typed answer + probability
        ↓  signal
3. GOVERNOR             records signal + context in the OKF ledger (evidence, not verdict)
        ↓  routine job
4. PRINCIPAL            analyses the chat, finds the causa, then creates / improves /
                        updates / removes the skill — and logs the change
```

**Why the dictionary comes first:** calling a model on every turn is wasteful, and the trigger is a
cheap local string match. The dictionary should be deliberately **high-recall** (over-capture is fine)
because **Jev does the precision work** in layer 2. It has to be broad and multi-lingual — "oh my
god", "FML", "seriously?", "again?!", and their equivalents in the user's other languages.

**One caution on the dictionary:** it should hold genuine *markers*, not neutral discourse. "Anyways"
is a filler word, not a complaint — include it and the net fires on ordinary sentences, which just
buys cost and noise. Borderline terms are tolerable *only* because Jev sits behind them; that is the
argument for keeping the two stages strictly separated.

**Send the window, not the transcript.** Jev is a hosted API. Only the flagged snippet plus a little
context needs to leave the machine — not the whole conversation. Same instinct as secrets: the value
never is.

**The learning target has to be chosen, not assumed.** Frustration is evidence; it is not proof that
a *skill* is wrong. The cause can be a missing tool, missing context, a bad config, a model issue, or
simply a user in a hurry. The principal classifies the cause **before** it edits anything — otherwise
every annoyance becomes a skill edit and agents accumulate scar tissue instead of capability.

**And this closes the open question above.** "How is growth measured?" — **the frustration rate is the
metric.** Signal density before a change versus after it is a before/after measurement of whether the
agent actually improved. That is what turns the growth loop from unfalsifiable into testable, and it
is why the signal must reach the governor as a record rather than dying in a log line.

## Jev — one model, two jobs

Jev is **part of the infrastructure** and a **workhorse for the agents**. Both, simultaneously.

**Jev is a HARD dependency (Ali, 2026-09-26).** Not an accelerator with a fallback — the system
requires it. What that obliges:

- **Fail loudly, never silently degrade.** If Jev is unreachable, the affected path **stops and says
  so** rather than quietly substituting a different behaviour. This is consistent with how the system
  already operates: no masking an error with a guess.
- **Jev availability is a first-class health check the principal owns.** It is infrastructure; the
  principal runs infrastructure. Unreachable Jev is an incident the principal raises, not a warning
  in a log line.
- **Install-time requirement.** A fresh install must supply and **validate** a Jev key during setup —
  supplied through the standard secret flow, never into config or logs. BalaBot is therefore *"clone,
  add your key, run"*, and the README must say so plainly: **an MIT repo with a mandatory third-party
  hosted API is a real dependency, not a footnote.** Self-hosters will hit this on day one; better
  stated up front than discovered at first run.
- **Pin the API version.** A hard dependency whose model can change underneath us means agent
  behaviour could shift with no code change. Pin it and treat upgrades as deliberate.
- **Blast radius is wide.** Jev serves both the infrastructure signals *and* the agents' utility
  calls, so an outage stops growth loops and workhorse decisions together. Size the outage posture for
  that, not for a single feature being unavailable.

### 1. Infrastructure role — the decision layer

- **Frustration signal** (above): dictionary → Jev → governor → principal's growth job.
- **The decision gate into the OKF ledger.** Jev answers *"is this decision-worthy?"* as a typed
  question, so the governor admits **decisions**, not transcripts. Without a gate, the ledger either
  swallows everything (noise) or depends on each agent's judgement (inconsistent).
- **Memory relevance.** Hermes agents are not good at pulling up the right memories; left alone they
  either skip recall or flood the context with facts that do not apply. Two Jev decisions live here:
  1. *Should a memory lookup happen for this message?* — the **when**.
  2. *Given what came back, what actually matters?* — the **what's important**.

  **Refinement:** put Jev on the *second* question, not the first. Fetching is already local and cheap
  (holographic is SQLite + FTS5), so gating the fetch only risks answering with context the agent
  needed. The expensive failure is not looking up — it is injecting the wrong things. So recall stays
  wide open and cheap, and **Jev ranks and prunes**. Same rule as the dictionary: cheap stage wide,
  model stage for precision.

  **Where it lives:** memory providers already **prefetch in the background, non-blocking**, before
  each turn. Jev slots in there as a **relevance re-ranker** on the prefetch path — no core surgery,
  which keeps this on the right rung of the footprint ladder. Any change to what gets injected must
  still respect the byte-stable-prefix rule (per-conversation prompt caching). **Jev answers
  relevance; the store's trust scores answer reliability** — two independent axes, both useful.

  **Grounded (research 2026-09-26, `research/jev-typesafe/FINDINGS-jev-rag-and-memory.md`):**
  - **Fuse, don't replace.** An independent BEIR eval found Jev *alone* does not beat a good embedding
    ranker, but **Jev fused with it wins**. So FTS5/HRR keeps ranking and Jev re-ranks on top.
  - **One call for ~30 facts.** Holographic facts are one-liners, so they fit one state comfortably:
    30 Nouls in a single call measured equal or better quality than one call per pair, and cheaper.
    Short facts also dodge Jev's documented "large state" degradation.
  - **Scores are calibrated, so they double as sort key *and* threshold** — passages scored ≥ 0.9 were
    relevant 76% of the time, < 0.1 only 0.5%. An uncalibrated cross-encoder gives neither.
  - Reference numbers: BM25 top-1 5% → 18%, top-10 38% → 62% on CLERC; production dropped >1 chunk in
    4 for ~$0.70 per 1,000 searches.

- **Skill selection at turn time.** TypeSafe published a cookbook built on **Hermes' own 182-skill
  catalog**. It names our exact problem — Hermes truncates skill descriptions to 60 characters, so the
  skill that *edits* `.pptx` looks like the one that *authors* it, and "a list of names invites a
  guess." Measured over 488 requests: wrong-skill loads **16.8% → 7.3%**, and loading one when nothing
  fits **9.8% → 4.0%** — over half the errors removed with **two requests per turn** (skim all → re-read
  top 3, free to reject all; gate threshold 0.30).

  **It also independently confirms the cache rule above.** The suggestion ships as **one extra system
  prompt line** (`<skill_relevance>Relevant to the current request: pptx-author...</skill_relevance>`),
  leaving the roster untouched — *"the roster itself never changes, so any prefix caching over it still
  holds."* Independent confirmation of the cache-safe roster design. Note the floor: handed the correct
  skill, agents still load the wrong one 2.5% of the time.

- **NEW SECURITY REQUIREMENT — screen everything retrieved.** TypeSafe documents that Jev has **no
  default defence against adversarial content**: "text that argues for its own classification can move
  the answer." Our governor's **ledger is readable by persistent agents and sub-agents**, and memory is
  written from conversation — so **anything that can write into the ledger or memory is an injection
  vector into every agent that reads it.** Retrieved and agent-authored content must be screened
  (the passage-filter pattern: `contains_prompt_injection` tested **first**, then contradiction,
  then relevance, then evidence) before it reaches an agent's context.

- **Roll out in shadow mode.** `rag-jev` (MIT) supports `shadow=true`: return the original context
  while *reporting* what Jev would have selected. Measure, then enforce. Never switch a filter on blind.

- **Signal layer generally.** Frustration is the first signal, not the only one. Others to
  brainstorm: *is this task actually complete?*, *is this agent stuck or looping?*, *do these two
  records contradict each other?*, *does this need the user?*, *is this an escalation?*

### 2. Workhorse role — a utility the agents call

Quick decisions, computer control, web browsing and extraction, classification. The pattern is
always the same: a cheap typed question over a state, instead of a full model call.

### The gate must fail open

If Jev decides what enters the ledger, a **false negative silently loses a decision** — and the
governor's authority rests on "if it is not in the ledger, it did not happen." A lost decision breaks
that promise invisibly, which is far worse than a bloated ledger. So the gate is tuned to
**over-admit**; the governor deduplicates and consolidates afterwards. Bloat is recoverable, a
missing decision is not.

### Never hand System 1 an irreversible decision

A cheap fast classifier is right for *reversible, low-stakes* choices — which element to click, which
category a ticket belongs to, whether a page looks loaded. It must **never** be the sole authority for
anything irreversible: sending a message, spending money, deleting data, publishing. Those keep a real
reasoner in the loop. Jev proposes; the agent owns the outcome.

### The thin skill

Every agent must know **that Jev exists, what it can do, and when to call it**. That ships as a
**thin base skill in the image** — thin because it loads for everyone, so it earns its place in the
prompt by being short and trigger-shaped ("when you need a typed decision over a state, reach for
Jev"), not by lecturing.

## Jev for computer use and browsing

Same pattern, higher leverage. Screen state is a state: *"is this the element I want?", "did that
action land?", "has the page changed?", "is this a dead end?"* — cheap typed decisions that today
cost a full model call per step. Same for browsing and extraction: *"is this the data I need?", "is
this page the right one?"* The 40–200× speed claim on System One tasks is exactly the gap between a
computer-use agent that stutters and one that flows.

### Persistent agents — the workers

- Answer user requests directly and stay **available**; they must not tie themselves up.
- Anything **not quick goes to a sub-agent**, and the persistent agent **coordinates and reviews**
  the result rather than doing the work inline.
- **Not forbidden from working** — they may do the work themselves; delegation is about staying
  responsive, not about capability.
- May run **many sub-agents concurrently**, all under their watchful eye.
- May **create another persistent agent when the user asks** — no principal round-trip required.

### Sub-agents — temporary

Short- or long-lived, scoped to one job, created by a persistent agent, invisible to the user except
through the parent. Parent sees the summary; the child never sees the parent's history.

## Mapping onto Hermes (what already exists vs what must be built)

| BalaBot concept | Hermes primitive | State |
|---|---|---|
| Principal bot | a profile shipped pre-configured in the image | **built** — `bootstrap.py` provisions both on first boot; the E2E asserts it |
| Persistent agent | a named Hermes profile + its own API server/gateway | exists (steve/jim/oscar prove it) |
| Sub-agent (temporary) | `delegate_task` children — isolated context, own terminal, summary-only return | exists |
| Sub-agent (long-lived) | a profile spawned on demand | exists, no UI flow |
| Agent's own screen | org-scoped agent computer (container, per-agent X display) | **shipped** |
| Agent-to-agent messaging | `message_agent` + visible handoff frames | exists |
| Skills & craft hygiene | curator state + the Skill Library view | **shipped** (readable); principal's review loop **to build** |
| Secrets with per-agent grants | org registry + `secrets.sources` command helper | **shipped** |
| Hierarchy enforcement | the permission matrix in `balabot/tests/simulations/_user_harness.py` | **built** — the deny cells deny (`sim_hierarchy_permissions` 6/6, plus 4 of the 21 user-usage scenarios in `sim_user_scenarios.py` — day-one install, missing-key refusal, principal onboards first agent, roster routing) |
| Sub-agent visibility in the UI | — | **to build** |

## What had to be built (original scope) — status

Superseded in detail by **Delivered vs still outstanding** below; kept as the original scope with
its current state marked.

1. ~~**Hierarchy as a permission layer, not prompt advice.**~~ ✅ **Built and tested** — the principal
   may restart/stop persistent agents and provision new ones; persistent agents spawn sub-agents and
   may create peers **when the user asks**; only the user may replace the principal
   (`sim_hierarchy_permissions` 6/6).
2. **The principal's ops toolset** — health of every agent, log reads, restart, and a periodic
   skills/craft review pass that reports findings rather than silently editing. ⬜ **Outstanding.**
3. ~~A single point of failure.~~ ✅ **Resolved:** peer creation is allowed, so the principal is not
   the only provisioner. The safety gate is the user's request, not the tier.
4. **Sub-agent visibility** — the "watchful eye" has to be visible, or supervision is a claim. Live
   sub-agent rows under their parent in the UI, with status and result. ⬜ **Outstanding** (no UI).
5. ~~**Container-native Hermes**~~ ✅ **Built** — the shipped image contains Hermes *and* the principal
   and governor, provisioned on first boot inside the product's own boundary.
6. **The growth loop needs a definition of "better."** ✅ **Answered** — the frustration rate
   (signal density before vs after). The audit trail and rollback path remain ⬜ **outstanding**.

### Deployment findings (2026-09-26, first real deploy)

- **`init: true` in docker-compose.yml silently disabled the ENTIRE s6 supervision tree.** The Hermes
  entrypoint requires PID 1 (`$$ -eq 1`) to hand off to s6's `/init`; `init: true` injects
  `docker-init` as PID 1, so the check fails and the container logs
  *"container entrypoint is not PID 1; skipping s6-overlay /init … Supervised services are unavailable"*.
  That costs the dashboard, the cloudflared tunnel, **and the principal's ability to restart agents** —
  the core of what BalaBot is — while the container still looks healthy. The comment in the file
  claimed `init: true` *preserved* that contract; it is exactly backwards. s6-overlay **is** the init
  system, so it already reaps orphans. Removed.
- **The published port was wrong** — the dashboard's own default is **9119**
  (`${HERMES_DASHBOARD_PORT:-9119}`), not the 9121 that was declared. The dashboard is off unless
  `HERMES_DASHBOARD=1`, so nothing listens there out of the box anyway.
- Verified after the fix: `PID 1 = s6-svscan`; services registered = `cloudflared`, `dashboard`,
  `gateway-default` (ONE multiplexed gateway — per-profile gateways like `gateway-principal`/
  `gateway-governor` are refused with exit 78), `main-hermes`, `s6-linux-init-shutdownd`, `s6rc-fdholder`,
  `s6rc-oneshot-runner`; the tunnel slot reports `down (exitcode 0)` with no `want up` (correctly
  dormant); a live model round-trip through the **deployed** container returned `DEPLOY_OK`.
- **Loose ends at deploy time:** no real TypeSafe key existed at original deploy (placeholder used, so
  Jev-dependent paths failed loud by design), and no Cloudflare API token exists — so the domain could
  not be wired from here. The existing WSL tunnel is token-managed, keeping its ingress in the
  Cloudflare dashboard.
- **Security observation:** the WSL tunnel passes its token as `--token <value>` in **argv**, so it is
  visible in any process listing (`pgrep -a cloudflared`). The tunnel baked into BalaBot deliberately
  avoids this by passing the token through the environment instead.

### Jev / TypeSafe signal layer — live contract (2026-09-26)

The **first real call against the live API** exposed a shipped bug the whole test suite had blessed.

- **The request schema was wrong.** `memory_relevance.score_candidates` (the actual memory-relevance
  signal layer) sent `{"primitive": "noul", "question": …}`. The live API requires a **`type`
  discriminator** plus `criteria` or `instructions`:

  | request | live response |
  |---|---|
  | `{"primitive":"noul","question":…}` | `422 union_tag_not_found` (discriminator `type`) |
  | `{"type":"noul"}` | `422 "Noul question must have criteria or instructions"` |
  | `{"type":"noul","instructions":…}` | **`200 {"answers":{"…":{"type":"noul","noul":0.21}}}`** |

  The response *parsing* was already correct (`{"type":"noul","noul":…}`) — only the request was wrong.
  So every real relevance call would have failed while 66/66 tests passed.
- **Why the tests could not see it.** Three compounding causes: `conftest.py` mocks the entire HTTP
  transport ("real client code, fake transport"), so no test crossed the real contract;
  `test_correct_request_body_shape` asserted `body["questions"] == QUESTIONS` — a **tautology** that only
  proves the client passes its input through, and therefore agrees with whatever schema the fixture
  holds; and `test_memory_relevance` asserted the *wrong* key outright, enforcing the bug.
- **Fixed** in `f714ecfa`: production code, docstring, runnable demo, and the tests that encoded the bad
  shape. Added `tests/test_jev_live_contract.py` — three tests against the **real** endpoint, skipped
  unless `TYPESAFE_API_KEY` is set, asserting **both** directions (well-formed accepted, old shape
  refused). Verified: offline `66 passed, 3 skipped`; live contract `3 passed`; a real
  `score_candidates` call scored a relevant fact **0.81** and an irrelevant one **0.03**.
- **Packaging note:** `balabot/jev.py` imports `requests`, but no `requirements.txt`/`pyproject.toml`
  declares it. It works only because the base image's Hermes venv happens to provide it
  (`/opt/hermes/.venv/bin/python`, requests 2.33.0) while `/usr/bin/python3` has none. The hard
  dependency is satisfied **by accident, not by declaration** — a latent fragility.
- **Key hygiene:** the live TypeSafe key lives at `~/secrets/typesafe-jev.key` (ACL-locked). Note that a
  key pasted into chat is **burned** and should be rotated once the work is done.

### Domain cutover — bot.balacode.xyz now serves BalaBot (2026-09-26)

`bot.balacode.xyz` previously served **A** — the legacy `workspace/grokbot-web` UI (a clone of
`egavriel/hermes-bot-web`) running as `uvicorn server:app` on port 9119, kept alive by the
`GrokBot_WebAdapter` scheduled task. A was the **stepping stone**; B (the single-container BalaBot) is
the product, so the domain was cut over to B.

- **No Cloudflare change was needed.** The existing token-managed tunnel already maps
  `bot.balacode.xyz → localhost:9119`, and 9119 is exactly the port BalaBot's dashboard wants. The work
  was freeing the port, not editing ingress. (Same reason the container's earlier port publish silently
  failed: `{"9119/tcp":[]}` — A held it.)
- **Retiring A (reversible):** disabled the `GrokBot_WebAdapter` scheduled task, stopped PID 26172. Files
  left in place — `Enable-ScheduledTask -TaskName GrokBot_WebAdapter` restores it.
- **B's dashboard: NOT exposed — by design.** Compose deliberately does NOT set `HERMES_DASHBOARD=1`
  ("the Hermes dashboard is a generic admin surface, not the product UI, and it must not sit behind
  the public hostname"). The product surface is the **BalaBot SPA on :9119** (`ui/server.py`),
  which carries its own HTTP basic auth; the key lives at `C:/Users/ali/secrets/balabot-dashboard.key`.
  The Hermes dashboard must never be exposed.
- **Verified through the public domain:** `/` → `302 /login?next=%2F`; `POST /auth/password-login` with
  the provider named → `200` and a session; wrong password → `401`; `GET /api/auth/me` →
  `{"user_id":"ali","provider":"basic",…}`; `GET /` with the session → `200`; without → `302`.
- **Gotcha:** the login body requires a `provider` field —
  `{provider, username, password, next}`. Omitting it yields `422`, which reads like a bad request rather
  than a missing field. The provider name is `basic`, discoverable at `GET /api/auth/providers`.
- **Still running (not touched, separate concern):** the legacy `GrokBot_Gateway_jim/oscar/steve`
  scheduled tasks.

### Agent API — how it actually works (2026-09-26, verified against the live container)

Getting the product UI a working chat backend meant discovering that Hermes's gateway model had changed.
Each of these cost a cycle:

- **ONE gateway, not one per profile.** Starting a per-profile gateway fails with exit **78**:
  *"Profile '<x>' does not get a gateway of its own. Exactly one gateway per host is the inbound process
  for every profile."* The image already ships a `gateway-default` s6 slot which multiplexes all
  profiles — that is the one to start (`s6-svc -u /run/service/gateway-default`). It is **not** in the
  user bundle, so nothing starts it automatically.
- **ONE api_server port for every profile.** Per-profile `gateway.api_server.port` values (9121/9122) are
  **ignored** while multiplexing is on. The gateway reports the truth:

  ```
  principal/api_server -> http://127.0.0.1:8642/p/principal/v1
  governor/api_server  -> http://127.0.0.1:8642/p/governor/v1
  ```

  So publishing per-profile ports (9121/9122) publishes **nothing**. Publish 8642.
  The OpenAI `model` field is the profile name.
- **Auth is PROFILE-SCOPED.** The launch-scope key is not enough: the listener answers
  *"no profile-scoped API_SERVER_KEY is configured"* and 401s every request. `bootstrap.py` now
  propagates the operator's single `API_SERVER_KEY` into each profile `.env`.
- **`API_SERVER_HOST=0.0.0.0` is required for the published port to work.** The server defaults to
  `127.0.0.1` *inside* the container (`DEFAULT_HOST` in `gateway/platforms/api_server.py`), so Docker's
  forwarder finds nothing on `eth0` and the host gets connection-refused (`curl 000`) — while
  `docker port` happily reports the mapping. A listener that is up, healthy, and unreachable.
- **Docker Desktop quirk:** publishing as `127.0.0.1:8642:8642` binds the *WSL VM's* loopback, which the
  Windows host cannot reach. Publish without the host-IP prefix.

Verified from a clean slate (fresh volume, one operator key, no hand-patching):
`/p/principal/v1/models` → 200, `/p/governor/v1/models` → 200, unauthenticated → 401, and
`POST /p/principal/v1/chat/completions` → 200 with a real model reply — **from the Windows host**.

### Real data sources for the extra screens

Found by inspecting the container, so the UI's non-chat screens can be genuinely backed:

| Surface | Source |
|---|---|
| Memory (facts, trust scores, entities) | `/opt/data/profiles/<p>/mem_<p>.db` — tables `facts`, `entities`, `fact_entities`, `facts_fts`, `memory_banks` |
| Cost / usage | `/opt/data/state.db` — table `session_model_usage` (`input_tokens`, `output_tokens`, `estimated_*`) |
| Agent spawns | `/opt/data/spawn-ledger.json` |
| Ops / health | `s6-svstat` per service (`cloudflared`, `dashboard`, `main-hermes`, `gateway-default`) |
| Agents / config | `/opt/data/profiles/<p>/config.yaml` |

(No `sqlite3` binary in the image — query the DBs from the host with Python's `sqlite3`, after copying
them out.)

### The product UI — built, wired, and verified (2026-09-27)

**`balabot/ui`** — Astryx (`@astryxdesign/core` 0.6.3) + React 19 + Vite. Grok Bot's
messenger-style roster as the shape, plus the screens our bigger feature set needs:
**Agents** (hierarchy via `TreeList`), **Memory**, **Decisions**, **Governance**, **Ops**,
**Cost**, and the roster itself.

**`ui/server.py`** — the adapter on `:9119`: serves the SPA behind HTTP basic auth and
proxies streaming chat to `/p/<profile>/v1/chat/completions`. The upstream `API_SERVER_KEY`
lives server-side only; it never reaches the browser, a log, or a response body.

**`tests/e2e/ui_e2e.mjs`** — 8 scenarios driven through the real UI in a stealth browser,
asserting on the rendered DOM (s08 asserts a real tool call is surfaced: ChatToolCalls + orb).
**8/8 green against the public domain**
(`https://bot.balacode.xyz`), and proven able to fail: a wrong password or a dead port
drops it to 1/8.

#### Two API↔UI mismatches that each broke the product silently

Both were found by driving the real thing, and both make a *healthy* system look broken:

1. **`/api/fleet` must return `bots`.** The UI boots by calling it and reading `raw.bots`,
   falling back to `/api/bots` **only if the call throws**. A successful response without
   `bots` yields an undefined list → the roster rendered *"No bots in the roster yet."* and
   the fallback never ran. Since sending is gated on a selected bot, **chat was
   unreachable** — the UI looked alive but could not send a message.
2. **Never probe `gateway-<profile>`.** No per-profile gateway exists. The phantom entries
   rendered as `down`, implying an outage in a perfectly healthy fleet. The un-raised tunnel
   is now reported as `dormant` (it exits 0 by design), not `down`.

#### The honesty contract (how the extra screens avoid lying)

Every data endpoint returns **either** real rows **or** an explicit refusal:

```json
{"available": false, "reason": "the holographic memory store is empty — no facts have been recorded yet"}
```

The UI renders that `reason` verbatim in an empty state, via a shared `useApiData` hook with
four phases (loading / ready / unavailable / error). `src/mockData.ts` was **deleted** once
all six screens were wired — no sample data is ever substituted for live data.

Real sources in use: `/api/cost` → the agents' own `session_model_usage` rows;
`/api/memory` → the holographic `facts` table; `/api/ops` → `s6-svstat` for the four real
services. `/api/decisions` and `/api/governance` honestly report the absence of a Jev log and
an OKF ledger rather than inventing entries.

### Timeout ceilings — what actually bounds an agent (2026-09-27)

Hermes has several timeouts. Which ones matter, and the trap in fixing them:

| Knob | Where | Value | Effect |
|---|---|---|---|
| `delegation.child_timeout_seconds` | config.yaml | **0 = no cap** | >0 kills a child after N s of no progress and **discards its whole context** |
| `TERMINAL_TIMEOUT` | **profile .env** | **600** (was 60) | Max seconds for one terminal command |
| `TERMINAL_MAX_FOREGROUND_TIMEOUT` | env | 600 (code default) | Hard ceiling a foreground command cannot exceed |
| `agent.gateway_timeout` | config.yaml | 1800 | Gateway agent turn budget |
| `WAKE_TURN_TIMEOUT_SECONDS` | code | 600.0 | Wake-triggered turns |

**`delegation.child_timeout_seconds` is an INACTIVITY cap, not a wall-clock cap.** Per
`delegate_tool_config.py`, the window "restarts on every sign of progress — a completed call,
a tool change, an activity-clock tick". Upstream sets it to **0 by default** and removed the
old 600s cap deliberately:

> *"No default wall-clock cap on children: legitimate heavy work (deep reviews, research
> fan-outs, slow reasoning models) was being killed mid-task. Stuck-child detection is the
> heartbeat staleness monitor; `delegation.child_timeout_seconds` opts back in."*

`_parse_timeout`: `<= 0` disables; otherwise `max(30, value)`. Note that **the host's
`~/.hermes/config.yaml` had `child_timeout_seconds: 600`**, which killed two subagents at
exactly 600.0s mid-build. Fixed via `hermes -p default config set delegation.child_timeout_seconds 0`.

### ⚠️ THE TRAP: a container `environment:` value does NOT override the `.env` file

**Hermes loads its env file with `override=True`** (`hermes_cli/env_loader.py:434`), so a value
**in the file beats one in the process environment**. Setting `TERMINAL_TIMEOUT: "600"` in
`docker-compose.yml`'s `environment:` block looks correct and **changes nothing** — the base
image's `.env.example` ships `TERMINAL_TIMEOUT=60`, which silently won.

The fix: route such values through bootstrap's **`PROFILE_ENV_KEYS`** (the same mechanism used
for `API_SERVER_KEY`), so they land in each profile's `.env` — the file Hermes actually reads:

```
profiles/principal/.env:  TERMINAL_TIMEOUT=600  DELEGATION_CHILD_TIMEOUT_SECONDS=0
```

**Generalisable rule:** to change an env-var setting inside a Hermes container, write it to the
`.env` Hermes reads — never assume the container environment wins. Process env only reaches a
profile `.env` because bootstrap copies it there.

**Also note:** Hermes' `.env.example` sets `TERMINAL_TIMEOUT=60`, which is *tighter* than the
code default of **180** (`tools/terminal_tool.py`). Anyone using the example inherits the
stricter value — a poor default for agents doing real work.

## Open questions

- **How is "growth" measured?** *Answered 2026-09-26:* the **frustration rate** — signal density
  before a change vs after it. The principal still needs a stated audit trail and rollback path;
  anything org-wide (a skill shared across agents) still goes to the user.
- **Our dev instance vs the product.** Today our fleets run as host profiles with the container as
  their *computer*. The product puts Hermes inside the image. Decide whether the dev instance
  migrates or stays as the "edge" configuration.
- **Rebrand surface area** — repo name, `bot.balacode.xyz`, `grokbot-web`, `grokbot-computer`, the
  org registry paths, and every doc. Open-sourcing also demands: no secrets in the repo, a LICENSE,
  a README that stands alone, and an audit of the ops scripts before they are public.

## Delivered vs still outstanding (as of 2026-09-26)

Everything below was verified by execution, not assertion.

**Done:** the single-container image; day-one provisioning of principal + governor; the hierarchy as
a permission layer (built and tested); peer creation gated on the user's request; the growth loop's
measurement signal (the frustration rate); container-native Hermes; the memory determination
(holographic); the Jev signal contracts — decision gate, memory relevance, image/injection screening,
System-1 irreversibility.

**The Cloudflare tunnel — baked in, dormant by default (2026-09-26).** The image ships a pre-wired
`cloudflared` s6 service that is inert until a token is supplied, so a fresh install exposes nothing
while remote access needs no yak-shaving later. With no token the slot reports **DOWN** and no process
exists; the run script exits cleanly and the finish script returns 125 ("permanent failure, do not
restart"), mirroring the image's dashboard service so it cannot flap in a restart loop. The token
never reaches a log and never enters argv; three sources are accepted
(`CLOUDFLARE_TUNNEL_TOKEN`, `CLOUDFLARE_TUNNEL_TOKEN_FILE`, `TUNNEL_TOKEN`). The binary is pinned by
version **and** SHA256 (2026.9.3) because it is an egress path into the container.
**Two things worth knowing:** a token-managed tunnel keeps ingress in the Cloudflare *dashboard*, so
there is deliberately no local `config.yml` to pre-configure; and the s6 scripts' exec bit is now
recorded in git *and* forced by the Dockerfile, because Windows has no exec bit and a Linux clone
would otherwise have produced a non-executable run script.

**Outstanding:**

1. **Live TypeSafe call unproven at the time of the original deploy — key situation has since
   changed.** A real `TYPESAFE_API_KEY` now exists in `balabot/.env` (correctly NOT git-tracked —
   `.gitignore` and `.dockerignore` both exclude `.env`/`.env.*`, so there is no leak), and the
   live contract tests pass (`test_jev_live_contract.py` 3/3; a real `score_candidates` scored a
   relevant fact 0.81 vs an irrelevant one 0.03). A full end-to-end Jev growth-loop run against
   the live API is still outstanding. The Jev paths are wired,
   tested against a stub, and shadow-mode ready; they are not yet proven against the real API.
2. **No gateway** — Telegram tokens were never issued per persona.
3. **Sub-agent visibility in the UI** — the "watchful eye" is still a claim, not something you can see.
4. **The principal's ops toolset** — health, log reads, restart, and the periodic craft-review pass.
5. **The growth loop's audit trail and rollback path** — the metric exists; the ledger of changes
   and the ability to reverse one do not.
