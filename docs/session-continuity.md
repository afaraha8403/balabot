---
type: plan
title: BalaBot — session continuity & compaction
description: One continuous thread instead of session-per-conversation, without the transcript degrading — a pre-compaction saliency pass, re-anchoring from durable state, and the Jev/principal/governor roles.
tags: [balabot, sessions, compaction, context, jev, principal, governor]
timestamp: 2026-09-26
---

# BalaBot — session continuity & compaction

## The requirement (Ali, 2026-09-26)

GrokBot's virtue is that you **don't create one session after another** — it's one continuous
relationship. BalaBot should behave the same way. But the owner knows the realism in it: *"every
session is kind of responsible for something… so having this long, very uninterrupted session goes
through compaction."*

## What actually degrades (measured against the owner's real config)

```yaml
compression:
  enabled: true
  threshold: 0.5          # compact when context hits 50%
  target_ratio: 0.2       # compress down to ~20%
  protect_last_n: 20      # last 20 messages always survive
  protect_first_n: 3      # first 3 messages are IMMORTAL
  hygiene_hard_message_limit: 400
  abort_on_summary_failure: false
```

So an immortal session converges on: **the original 3 messages + a stack of summaries + the last 20.**
The middle is repeatedly re-summarized — a summary of a summary of a summary. The degradation is not
the *thread*; it is the **middle**, and it compounds with every compaction.

Two consequences worth naming:

- **The protected first 3 messages become stale.** They are preserved forever by design, but in a
  session that has run for weeks they are the *least* relevant content in the window — and they cannot
  be evicted.
- **`abort_on_summary_failure: false` fails open.** If summarization fails, compaction proceeds anyway.
  In a normal short session that is a minor loss. In an immortal session it is **silent, compounding
  context loss** — the exact failure this whole design exists to prevent.

## The core idea: make compaction lossless

Compaction is lossy by construction. The fix is not to avoid it — it is to make sure **nothing that
matters lives only in the transcript.**

**Pre-compaction saliency pass.** Before the compressor runs, classify what is about to be dropped:

| Category | Destination |
|---|---|
| A decision was taken | → **governor's OKF ledger** |
| A durable fact about a person/project | → **holographic memory** |
| Live task state ("we're mid-way through X") | → the working set |
| Noise | → dropped, deliberately |

Jev is the natural classifier — closed answer set, judged at volume, cheap. This is the same
two-stage shape as everything else: cheap pass first, model for precision.

**Then compact freely.** Once the durable content has been extracted, the transcript really is
disposable, and compression stops being a lossy event and becomes housekeeping.

## Re-anchor; don't just compress

The single most important rule: **after compaction, rebuild context from state — not from the
previous summary.**

Relying on summary-of-summary is what makes immortal sessions rot. Rebuilding from the governor's
ledger + holographic facts + the session's purpose record restores the session from **ground truth**,
and the degradation curve flattens instead of compounding. The transcript's job is to hold recent
work; the stores hold what must not be lost.

## Who does what

**Jev — the selection layer.**
- Saliency at compaction: what must survive, and where does it go?
- The **context-limit signal**: *"this session is near its limit"*, *"this conversation has drifted
  off its stated purpose"*, *"this is the same question as four compactions ago"*.
- Note `memory_query_rewrite` is already an existing auxiliary task — a second, official insertion
  point.

**Governor — the purpose record.**
"Every session is kind of responsible for something." Hermes today has a session **title** but no
**purpose**. The governor should hold, per session: what this thread is for, its decisions, and the
state needed to resume it. A compacted or resumed session then recovers its **mandate**, not just its
topic.

**Principal — session health.**
- Detect **compaction churn**: a session that compacts repeatedly is thrashing, and that is a symptom
  (drifting purpose, a looping agent, a task that should have been delegated).
- **Verify the durable extraction happened before each compaction.** This must *fail loud*. Silent
  context loss is precisely the thing the Principal exists to catch — and with
  `abort_on_summary_failure: false` in the config, nothing else will catch it.

## The user-facing model

**One thread per purpose, not per conversation.** The human experiences a single continuous
relationship. Sessions become an **implementation detail** — when a topic genuinely changes, BalaBot
spawns a sibling session under the same thread and the governor records the new purpose. The owner
never "creates a session"; they just talk.

That is how to get GrokBot's feel without GrokBot's degradation. Continuity lives in **identity +
memory + ledger**, not in one ever-growing transcript.

## Session front matter & Jev routing — Ali's proposal, pressure-tested

Ali's model: a session gets **front matter** describing it, created **after the initial few prompts**
(right — a session's purpose is unknowable at message 1), updated with a **final pass when it goes
stale**. When the user returns, **Jev decides**: brand-new session, or resume? The hard case: a session
that ran topic A then drifted to B; the user returns asking for C *and referencing A*.

**Where this is right:** front matter *is* the purpose record this design needs, and deferring its
creation past the opening prompts is better than my at-creation assumption. Jev as the router is the
correct shape — a closed decision over a state.

### Corrections (research + Hermes' own mechanics)

1. **Don't merge topics into one description — record topics *with spans*.** A session that ran A then
   B, described as "A and B", is useless as a routing key: by the time it's stale it matches everything
   and nothing. Store `A: msgs 1–40`, `B: 41–90`. Then "reference topic A" resolves to an **addressable
   span** instead of a vibe.

2. **Don't fold the old session in — index it and retrieve on demand.** Folding is *eager, lossy and
   context-polluting*: it puts a summary of A into the live window, where it distracts from everything
   else and (see density, below) actively makes the window worse. Retrieval is *lazy and lossless* and
   costs nothing when A is never mentioned. Ali's own phrasing — "reference it whenever they need to
   into more detail" — **is the retrieval model**; the folding instinct contradicts it. The literature
   lists this as a named mitigation: *"context isolation relocates information outside the active
   window, leaving only pointers or outcomes inline"* (arXiv 2606.29718).

3. **New-vs-resume is not a binary.** Minimum three outcomes: **resume** (same purpose continues),
   **new + linked** (new topic, old one reachable — the common case), **new, clean** (unrelated). A
   binary forces a bad choice at the boundary.

4. **Use one Noul per candidate session — never a Choice.** A `Choice` is *relative* and forces exactly
   one winner even when the correct answer is "**none of these**" or "two of them." A `Noul` is
   *absolute* — it can be low for every candidate, which is exactly the state we need to detect. Pair it
   with a separate Noul for "does this need a new session?" (TypeSafe's own docs state the distinction:
   the Choice settles *which*, the Nouls decide *whether*.)

5. **"Stale" is undefined, and time-based staleness is wrong.** Idle five minutes ≠ idle a week. Anchor
   the front-matter update to **events that already fire**: the **compaction boundary** (which exists
   today) and **session close**. Don't invent a timer.

6. **Pre-filter before Jev sees anything.** Routing must not hand Jev the metadata of 500 sessions.
   Cheap stage first (same agent, recent, lexical/embedding match) → Jev on a small candidate set. Same
   two-stage shape as every other signal here.

7. **Add a confidence gate that asks the user.** TypeSafe's intent-routing pattern escalates to a human
   when the classifier's confidence is low. Same move here: when Jev can't tell whether to resume,
   **ask** rather than guess. The owner gets zero session management in the common case, and is
   consulted only at genuine ambiguity.

## The context budget — right instinct, unsafe number

Ali's rule: **never use the maximum context window; keep to 40–70%, lower is better for accuracy.**
Directionally correct, and the research backs the *principle* hard:

- **Maximum Effective Context Window (MECW) ≠ advertised window.** One study found MECW can fall
  **>99% below** the advertised figure, that it **shifts by problem type**, and that some models
  degraded with as few as ~100 tokens in context (arXiv 2509.21361).
- **Context rot**: models **"give up or provide uncertain incorrect answers long before exhausting the
  context window"** — a behaviour the authors call *premature termination*, whose rate is **positively
  correlated with context length** (arXiv 2606.29718).
- **The middle is the least-attended region** (Lost in the Middle). Sanity check: 20 retrieved docs
  (~4k tokens) moved accuracy from ~70–75% down to ~55–60%.
- **Density is a third, separate axis.** "Dense Contexts Are Hard Contexts" (arXiv 2606.06203) shows
  lexical density shrinks the effective window at *fixed* length and position — a −27% drop on a task as
  simple as matching a lemma against a list, purely from density.

**Why the 40–70% number is unsafe as written:** 40–70% *of a 1M advertised window* is 400k–700k tokens —
almost certainly far past the effective limit, because the percentage is being taken of a marketing
figure. Two corrections:

1. **Cap by measured *effective* context, not a percentage of advertised.** The percentage should apply
   to MECW for that model and task type.
2. **Agent transcripts are the densest possible text** — tool output, code, structured data. Density
   shrinks the usable window independently of length, so the operational budget for an *agent session*
   should sit **well below** 40%, not at 70%. For a dense session, "lower is better" is not a
   preference, it is the mechanism.

**And this is another argument for re-anchoring from state:** the compaction summary is written into the
**middle** of the window — the least reliably attended region — which is precisely where we should trust
it least. Rebuild from the ledger and memory; treat the summary as a convenience, not a source of truth.

## Open

- **Queueing and interrupting messages** — raised separately by the owner; not designed here.
- **Compaction is the ONE sanctioned cache break** in Hermes. Fewer, more meaningful compactions is a
  cost goal in itself, which argues for the re-anchoring approach over frequent summarization.
- Whether `abort_on_summary_failure` should be forced to `true` for BalaBot, or handled as a
  Principal-raised incident.
