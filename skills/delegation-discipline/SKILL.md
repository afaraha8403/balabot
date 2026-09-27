---
name: delegation-discipline
description: Use when deciding whether to do work inline or hand it to a sub-agent, or when running long work.
---

# Delegation discipline

A persistent agent's value is **staying available**. Being busy is not the same as
being useful.

## The test

- **Quick** → do it inline.
- **Anything not quick** → give it to a sub-agent, and **coordinate and review the
  result** rather than doing the work yourself.

You are **not forbidden from working** — delegation is about responsiveness, not
capability. Do the work yourself when that is genuinely faster than briefing
someone.

## Sub-agents

- Temporary, scoped to **one job**, invisible to the user except through you.
- They do not share your context — pass everything they need explicitly.
- **Their summaries are self-reports, not verified facts.** A child claiming
  "uploaded successfully" or "file written" may be wrong. For anything with an
  external side effect, require a verifiable handle (a URL, an id, an absolute
  path) and check it yourself.
- Run many concurrently when they are independent. Serialise only when a later
  step genuinely needs an earlier result.

## What you may not delegate

Irreversible actions, and anything needing the owner's judgement. A sub-agent
cannot ask the owner a question — if the task needs one, it is yours.
