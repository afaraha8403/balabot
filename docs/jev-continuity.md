---
title: Jev skill-selection continuity
description: What is implemented for Jev skill selection, the cache-safe injection carrier, the checkpoint contract, and the Hermes source files this build depends on.
type: architecture-note
timestamp: 2026-09-27
tags: [balabot, jev, skills, cache-safety, injection, compaction]
---

# Jev skill-selection continuity

Status as of **2026-09-27**. Everything below describes code that exists and
tests that pass (`python -m pytest tests/test_jev_prompt.py -q`). Nothing here
is aspirational.

## What is wired

- `balabot/jev_depth.py` implements the decision machinery: `select_skills()`
  (60-char description truncation, 0.30 gate threshold, MAX 2 requests per
  turn — skim all → re-read top 3, free to reject all) and `prompt_line()`
  (one `<skill_relevance>...</skill_relevance>` line, or `''` when nothing is
  selected — never an empty tag pair). Before this build those functions were
  called nowhere.
- `balabot/jev_prompt.py` closes that gap: `select_and_render(turn_text,
  catalog, jev=None, session_id='')` runs one selection per turn and returns a
  typed `SkillInjection` (selected names, rendered line, requests used,
  degraded flag + reason). `inject(result)` wraps the line as a cache-safe
  carrier.

## Checkpoint contract (compaction)

Compaction is bound to the checkpoint API version in
`balabot/memory_provider.py`: `pre_compress_checkpoint_api_version = 2`.
Pre-compress checkpoints are **fail-closed** via
`compression.checkpoint_required` — if the checkpoint cannot be produced or
its version does not match, compaction does not proceed. This is the only
sanctioned context mutation; see below for why injection is not allowed to
share that channel.

## The three routing outcomes

Per `docs/session-continuity.md` (Ali's proposal, pressure-tested), new-vs-
resume is not a binary. Jev routing produces one of exactly three outcomes:

1. **resume** — same purpose continues; the live session is the right one.
2. **new + linked** — a new topic spawns a new session; the old one stays
   reachable (indexed with topic spans, retrieved on demand — never folded in).
3. **new, clean** — unrelated; no link is created.

Jev is consulted with one Noul per candidate session (never a Choice, which
forces a winner even when the answer is "none"); a confidence gate escalates
to the user at genuine ambiguity rather than guessing.

## Cache-safety rule for injection

**The original mechanism — shipping the suggestion as ONE extra system-prompt
line appended after the roster prefix — is REJECTED.** Reason: the system
prompt must be BYTE-STABLE for the life of a conversation, and the only
sanctioned context mutation is compression. A mid-conversation system-prompt
edit invalidates the cached prefix and multiplies the owner's token cost on
every subsequent request of that conversation.

The supported path: mid-conversation content rides a **USER MESSAGE**.
Hermes' own precedents:

- skill slash commands inject as a user message — Hermes `agent/skill_commands.py`;
- subdirectory `AGENTS.md` hints append to the tool result.

`balabot/jev_prompt.inject()` therefore returns an `InjectionCarrier` whose
`carrier` key is pinned to `'user_message'`. The dataclass has no field that
could describe a system-prompt mutation, `__post_init__` rejects any carrier
value outside `SUPPORTED_CARRIERS`, and the test suite asserts the carrier
contains no system-prompt field (`tests/test_jev_prompt.py::
test_carrier_is_user_message_ride_and_has_no_system_prompt_field`,
`test_system_carrier_is_structurally_forbidden`). Nothing to inject →
`inject()` returns `None` and the caller does nothing.

## Budget and degrade behaviour

- Budget: never more than 2 Jev requests per turn, enforced inside
  `jev_depth.select_skills` by `jev_depth._Budget` (constant
  `MAX_REQUESTS_PER_TURN = 2`) and re-asserted locally in
  `jev_prompt.select_and_render`. Tests assert the fake Jev saw ≤ 2 calls.
- Degrade: Jev unavailable (no injected client, empty catalog, any
  `JevError`) → empty line, empty selection, `degraded=True` with a stated
  reason. No skill is ever guessed; no exception reaches the caller's turn
  loop.
- Empty state: nothing selected → `''` and `selected == []` — never an empty
  tag pair.

## Hermes source files this build depends on

- Hermes `agent/skill_commands.py` — precedent that mid-conversation skill
  content injects as a user message (the carrier this module produces).
- Hermes subdirectory `AGENTS.md` hint mechanism — precedent for appending
  context to a tool result (the alternative sanctioned carrier; not used here).
- Hermes binding-architecture invariant: system prompt byte-stable for the
  life of a conversation; compression is the only sanctioned mutation.

These are referenced as provenance for the design constraint; no Hermes code
is imported by `balabot/jev_prompt.py`.

## BalaBot files involved

- `balabot/jev_depth.py` — reused unmodified (select_skills, prompt_line,
  constants).
- `balabot/jev.py` — `Jev` protocol, `JevError` / `JevNotConfigured` /
  `JevAPIError` (imported; unmodified).
- `balabot/jev_prompt.py` — NEW: selection wrapper + cache-safe carrier.
- `tests/test_jev_prompt.py` — NEW: fake-Jev tests, no network, no API key.
- `balabot/skills_registry.py` — the catalog shape (resolve() → name/description
  mapping); read-only dependency for callers building `catalog`.
