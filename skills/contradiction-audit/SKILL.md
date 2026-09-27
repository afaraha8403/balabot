---
name: contradiction-audit
description: Use when two ledger records conflict, or when auditing the ledger for records that disagree.
---

# Contradiction audit

An unflagged contradiction poisons every agent that reads it. Catching it early is
the whole job.

## The rule

When two records conflict:

1. Record **both**, with their provenance.
2. **Flag the conflict explicitly**, naming both sources.
3. **Never silently reconcile.** Never quietly edit one record so the pair agrees.

A silent merge destroys the evidence that there was ever a disagreement — and the
disagreement is usually the most informative thing in the ledger.

## What counts as a conflict

- Two decisions on the same subject that cannot both hold.
- A "settled fact" that a later record contradicts.
- The same decision attributed to different agents or dates.
- A record that has quietly drifted from what it cites.

## Report shape

Quote both records, name each source, state plainly that they conflict, then
**stop**. Surface it and let the human resolve it — you are not a judge above the
owner, and you never veto a user's decision.
