---
type: reference
title: BalaBot — product architecture (principal, governor, persistent agents, sub-agents)
description: BalaBot is an MIT-licensed, open-source multi-agent system based on Grok Bot, shipped as a single Docker image containing Hermes plus two pre-configured agents (principal and governor). Defines the hierarchy (user, principal, governor, persistent agents, sub-agents), each tier's responsibilities, the memory choice, the Jev signal layer, and how each maps onto Hermes primitives.
tags: [balabot, grokbot, architecture, hierarchy, principal, governor, persistent-agents, subagents, holographic, jev, mit]
timestamp: 2026-09-26T19:10:00Z
status: building
repo: https://github.com/afaraha8403/balabot
---

# BalaBot

**BalaBot** (B-A-L-A-Bot) — MIT-licensed, open source, based on Grok Bot.
**Repo: https://github.com/afaraha8403/balabot** (public).

It ships as **ONE Docker image that contains Hermes itself**, plus **two pre-configured agents — the
principal and the governor** — provisioned on first boot. That is what a fresh install greets you with,
and it behaves that way from day one: no setup ritual, no second container, no UI required.

**Jev (TypeSafe AI) is a hard dependency** — infrastructure, not an add-on. The image validates the key
at startup and fails loudly if it is missing. There is no fallback provider.

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

## Agent reasoning visibility (the "thinking" stream)

Reasoning models emit their private chain-of-thought on a **separate stream channel** —
`choices[].delta.reasoning_content` — distinct from the answer (`delta.content`). The two must never be
concatenated: reasoning is working state, not a reply.

- The API adapter buffers `reasoning_content` on its own channel and stores it on the assistant message
  as `thinking` — never merged into `content`.
- The UI renders it as a **collapsible disclosure** (muted, demoted, collapsed by default), never as an
  ordinary chat bubble, and only when the **"Show thinking"** switch in the top nav is on.
- That switch is **off by default** and its state is persisted (`balabot.showThinking.v1` in
  `localStorage`), so the choice survives reloads.
- No thinking text reaches the DOM while the switch is off — the gate is a render condition, not CSS.

Verified end-to-end through the real UI (`tests/e2e/ui_thinking_e2e.mjs`): hidden by default, persistent
toggle, collapsed-then-expandable, and a seeded-message canary that fails if the gate is removed.

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
(founder Diogo Almeida, ex-OpenAI), **not Typeface AI**. Launched around 15 Sep 2026, it is the first
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
| Principal bot | a profile shipped pre-configured in the image | **to build** |
| Persistent agent | a named Hermes profile + its own API server/gateway | exists (steve/jim/oscar prove it) |
| Sub-agent (temporary) | `delegate_task` children — isolated context, own terminal, summary-only return | exists |
| Sub-agent (long-lived) | a profile spawned on demand | exists, no UI flow |
| Agent's own screen | org-scoped agent computer (container, per-agent X display) | **shipped** |
| Agent-to-agent messaging | `message_agent` + visible handoff frames | exists |
| Skills & craft hygiene | curator state + the Skill Library view | **shipped** (readable); principal's review loop **to build** |
| Secrets with per-agent grants | org registry + `secrets.sources` command helper | **shipped** |
| Hierarchy enforcement | — | **to build** |
| Sub-agent visibility in the UI | — | **to build** |

## What must be built for this to be real

1. **Hierarchy as a permission layer, not prompt advice.** Who may restart whom, who may create
   whom, who may grant what. Concretely: the principal may restart/stop persistent agents and
   provision new ones; persistent agents may only spawn sub-agents and *request* peers; only the
   user may replace the principal.
2. **The principal's ops toolset** — health of every agent, log reads, restart, and a periodic
   skills/craft review pass that reports findings rather than silently editing.
3. ~~A single point of failure.~~ **Resolved:** peer creation is allowed, so the principal is not the
   only provisioner. The safety gate is the user's request, not the tier.
4. **Sub-agent visibility** — the "watchful eye" has to be visible, or supervision is a claim. Live
   sub-agent rows under their parent in the UI, with status and result.
5. **Container-native Hermes** — the shipped image contains Hermes *and* the principal bot, so
   provisioning happens inside the product's own boundary rather than on a host.
6. **The growth loop needs a definition of "better."** The principal is charged with making agents
   better over time, and it may change anything. Without a measurement signal, "growth" is
   unfalsifiable and the routine becomes noise. Needs: what evidence the principal reviews, what it
   may change autonomously, and how every change is logged and rolled back.

## Open questions

- **How is "growth" measured?** The principal's improvement routine needs evidence — user corrections
  and re-explanations, reworked or failed tasks, skill usage counts and staleness, recurring errors
  in logs. Recommended: the principal reviews those signals and applies changes with an audit trail
  and a rollback path; anything org-wide (a skill shared across agents) still goes to the user.
- **Our dev instance vs the product.** Today our fleets run as host profiles with the container as
  their *computer*. The product puts Hermes inside the image. Decide whether the dev instance
  migrates or stays as the "edge" configuration.
- **Rebrand surface area** — repo name, `bot.balacode.xyz`, `grokbot-web`, `grokbot-computer`, the
  org registry paths, and every doc. Open-sourcing also demands: no secrets in the repo, a LICENSE,
  a README that stands alone, and an audit of the ops scripts before they are public.
