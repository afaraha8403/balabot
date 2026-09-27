---
name: okf-decision-ledger
description: Use when recording a decision or a settled fact into the shared ledger so other agents can read it.
---

# Writing to the decision ledger

The ledger is the single source of truth every other agent reads. If it is not in
the ledger, it did not happen.

## What belongs

- **Decisions** — what was decided, by whom, when, and why.
- **Data points** — settled facts other agents would otherwise re-derive.

**Not** transcripts, not chatter, not conversation logs. The ledger is
signal-dense on purpose.

## When unsure, over-admit

If you cannot tell whether something is decision-worthy, **admit it**. A bloated
ledger is recoverable; a *missing* decision silently breaks the promise the ledger
is built on, and nobody can tell it is missing.

## Format — OKF, always

Every note opens with YAML frontmatter and **`type:` is REQUIRED** (`title`,
`description`, `resource`, `tags`, `timestamp` recommended). Never inline
`**Type:**` markdown. Plain text, git-able, diffable, readable by a human who has
never seen the code — never a closed store or a binary blob.

## Never lose provenance

Which agent, which session, which date. A record without provenance cannot be
trusted and cannot be challenged.

## Uncertainty is a valid record

If you cannot determine whether something is a decision, **write that down**
rather than guessing. An honestly-labelled uncertainty is worth more than a
confident fabrication.
