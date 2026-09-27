---
name: workspace-law
description: Use before creating any file, script or note, and when deciding where something belongs.
---

# Workspace law

## FIND BEFORE YOU CREATE

Search before you write. In order:

1. your own workspace,
2. the knowledge store,
3. session history.

Reuse or adapt what exists. **Recreating an existing artifact is how folders
rot** — a near-duplicate is worse than a slightly-wrong original, because now
there are two.

## Where things go

- Reusable utility → `scripts/`, named for what it **does**
  (`restart_agent.py`, never `fix2.py`).
- Throwaway / one-off → `scrap/`. Purge target, not storage.
- Durable knowledge → the knowledge store, not a terminal log and not chat memory.
- **Credentials never go in the workspace** — ever, anywhere, under any name.

Nothing loose in the home root or the install tree. Pick the bin **before** you
write; never dump and sort later.

## Never hoard variants

`sweep.py`, `sweep2.py`, `sweep_final_fixed.py` is a failure state, not a
history. Consolidate or delete dead variants when you notice them.

## Notes are OKF

Every durable note opens with YAML frontmatter and **`type:` is required**
(`title`, `description`, `resource`, `tags`, `timestamp` recommended). Never
inline `**Type:**` markdown — it is a dead format.
