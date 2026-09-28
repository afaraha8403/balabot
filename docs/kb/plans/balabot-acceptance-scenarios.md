---
type: test-plan
title: BalaBot — real-world acceptance scenarios
description: The user-usage scenarios that prove the org layer, secrets, groups, growth loop and agent computer actually work for a human, not just in unit tests. Derived from the spec's own build-order step 8 acceptance criteria.
resource: C:/Users/ali/workspace/balabot
tags: [balabot, e2e, acceptance, scenarios, test-plan]
timestamp: 2026-09-27T07:40:00Z
---

# BalaBot — real-world acceptance scenarios

Unit tests prove functions. These prove the **product**. Each scenario is written the way a
person would actually use it, and each must be **provably able to fail** — a scenario that
passes against a broken build is worse than no scenario.

## The non-negotiable one (the spec's own words)

> a real key typed into the form → stored → the granted bot's next session picks it up →
> the value appears **nowhere** in transcripts, frames or logs (asserted explicitly).
> Plus: a non-granted bot does NOT get it; a cross-org grant DOES work.

That is scenario **S1**, and it is the one that matters most. Everything else supports it.

## S1 — The secret never leaks (THE headline scenario)

| Step | Performed as | Must be true |
|---|---|---|
| 1 | User opens a chat with the Principal | An in-chat form appears (name / value / share) |
| 2 | User types `STRIPE_SECRET_KEY` + a sentinel value | Nothing appears in the transcript |
| 3 | User chooses *Principal only* and saves | Response shows a **fingerprint**, never the value |
| 4 | Inspect transcripts, SSE frames, logs, session files | **Sentinel appears in NONE of them** |
| 5 | Start the Principal's next session | The variable is present in its environment |
| 6 | Ask the Governor for it | The Governor does **not** have it |

**Failure condition:** a single occurrence of the sentinel anywhere outside the secret store.
This is asserted by grep across every artefact, not by inspection.

## S2 — Cross-org grant

A bot in org `balacode` is granted a secret owned by org `acme`. The bot receives it; its
`list_org_secrets` shows the entry labelled with origin `acme`; revoking the grant removes
delivery without deleting the audit record.

## S3 — The bot cannot read the value

A bot calls every tool it has. None returns the value or any substring of it — only name,
description, fingerprint and origin. **The bot can use the secret and cannot read it.**

## S4 — Skill classes are visible and honest

The Skill Library shows `learned` vs `brought`. A learned skill shows usage/state and can be
pinned. Where curator state does not exist, the view says so instead of showing an empty
fake list. A third-party skill lands in quarantine, inert, until approved.

## S5 — Agent computer, from a cold start

Recreate the container. Without any manual step the displays come up, and the frame endpoint
returns a real PNG of the bot's own screen. Drive it: click, type, and see the change in the
next frame. **A blank screen is an honest answer; a fabricated frame never is.**

## S6 — Multi-agent group chat

Create a group of 3 bots, give it one prompt, and get labelled rounds back with per-member
sessions. Each bot's contribution is attributable to it.

## S7 — Bot creation with consent

An existing bot proposes a new bot. Nothing is created until a human approves. After
approval the new bot appears in the roster and can be messaged.

## S8 — The growth loop closes

Signal is detected → Jev is consulted → the Governor records it → the Principal's growth job
acts → the outcome is visible in the ledger. Every hop is inspectable; no hop is a prompt
string pretending to be a system.

## S9 — Jev is a hard dependency

With Jev unreachable: the system **fails loud**, an incident is recorded and readable, and
nothing silently degrades to a fallback. With a key present, health reports real reachability.

## S10 — Honesty sweep

Every endpoint the UI calls returns real data or an explicit `available:false` with a reason.
**No endpoint returns fabricated rows, and no control is a permanently-spinning lie.**

## Scoring

A scenario is PASS only on real command output from the real running product — never on a
subagent's summary, and never on a unit test standing in for the product path. Any scenario
that cannot be shown to fail is reported as UNPROVEN rather than PASS.
