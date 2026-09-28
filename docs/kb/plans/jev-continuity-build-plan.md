---
type: build-plan
title: BalaBot — Jev continuity build plan (owner-directed: implement it all)
description: Everything Jev-related from the vault, implemented as product surface — the pre-compaction saliency checkpoint, per-session purpose records with topic spans, three-outcome session routing, and the fail-closed extraction gate. Grounded in the real Hermes contract that already exists for this.
resource: C:/Users/ali/workspace/balabot
tags: [balabot, jev, sessions, compaction, context, build-plan, typesafe]
timestamp: 2026-09-27T21:05:00Z
---

# BalaBot — Jev continuity build plan

**Owner directive (Ali, 2026-09-27):** *"Everything we discussed that's related to Jev has to be
implemented and it has to be part of this product."* Scope is therefore the whole Jev thread:
saliency, the context-limit signals, the purpose records, the new-vs-resume router, and the
fail-closed verification gate — as shipped product behaviour, not as a library.

## The decisive discovery: Hermes already ships the insertion point

The plan of 2026-09-26 (`plans/session-continuity.md`) assumed the compaction boundary "exists
today" without naming it. It does, and it is better than the plan assumed:

- `agent/memory_provider.py` defines a **pre-compress checkpoint contract** with an explicit API
  version: `pre_compress_checkpoint_api_version = 2`. v2 is *opt-in and fail-closed* — the
  provider is handed host-normalised evidence (direct user/assistant messages only; tool payloads
  and derivative summaries excluded) immediately before the compressor runs.
- `compression.checkpoint_required: true` (config.yaml) turns a missing checkpoint into a hard
  error — `BLOCKED_MISSING_PREREQUISITE` — and **preserves the uncompressed transcript**. The gate
  binds every compaction authority: server-side native compaction is suppressed while armed,
  post-turn micro-compaction is forced off, and `codex_app_server` is refused at agent init.

That is precisely the plan's own requirement — *"Verify the durable extraction happened before
each compaction. This must fail loud."* The platform provides it; the product only has to implement
the provider. **No Hermes fork, no patched core.**

Constraints respected: the builtin provider is always allowed and **only ONE external provider may
be registered**. New memory providers do not land in the Hermes upstream tree (policy) — ours ships
inside the BalaBot image and is activated by `memory.provider: balabot-jev`.

**The slot is already occupied — hence wrap, don't replace.** `balabot/bootstrap.py` sets
`FORCED_MEMORY_PROVIDER = "holographic"`, and both shipped personas run `memory.provider:
holographic` (verified live; their `memory_store.db` is the store `/api/memory` reads). With only
one external slot, the Jev provider **composes** the bundled holographic provider: `balabot-jev`
is the single active provider and forwards the entire delegated surface (tools included, so
`fact_store`/`fact_feedback` keep working) to an inner holographic instance, adding the v2
checkpoint on top. Replacing holographic would silently discard the product's structured memory —
the exact failure this design exists to prevent.

**Deployment path (verified against the loader, not assumed):** user/external providers are
discovered from `$HERMES_HOME/plugins/<name>/` — *not* `plugins/memory/<name>/`, which is the
bundled-only shape (`_is_bundled()` → module name `plugins.memory.<name>`). So the plugin lands at
`/opt/data/plugins/balabot-jev/`. `/opt/data` is a named Docker volume, so a `COPY` into it at
build time would be shadowed at runtime — the plugin is seeded at container start from the image
copy, alongside the existing bootstrap provisioning (single source of truth: `balabot/bootstrap.py`).

## Waves

| # | Slice | Files | Status |
|---|---|---|---|
| 1 | **Durable session + purpose-record store** — purpose, topics **with spans** (never a merged "A and B"), decisions, resume state, compaction bookkeeping, `re_anchor()` | `balabot/sessions.py` | ✅ shipped |
| 2 | **Jev continuity layer** — saliency pass (4 destinations), context-limit signals (near-limit / drift / repetition), three-outcome routing with one Noul per candidate + confidence gate + pre-filter | `balabot/jev_continuity.py` | ✅ shipped |
| 3 | **The checkpoint provider** — MemoryProvider v2, fail-closed, idempotent, wrapping holographic | `hermes/plugins/balabot-jev/` | ✅ shipped |
| 4 | **Cache-safe skill-relevance injection** — reuse `jev_depth.select_skills`, ride a user message | `balabot/jev_prompt.py`, `docs/jev-continuity.md` | ✅ shipped |
| 5 | **Product surface** — `/api/sessions` server-backed conversations, purpose record visible, routing choice prompt, churn surfacing in ops | `ui/server.py`, `ui/src/*` | ⬜ next |
| 6 | **Activation + E2E** — deploy the plugin, flip `checkpoint_required`, prove a real compaction checkpoints and that a missing checkpoint BLOCKS | container, tests | ✅ **complete** — activation receipt + **9/9 E2E on both personas** (below) |

## ✅ Checkpoint E2E — 9/9 on both personas

`tests/e2e_jev_checkpoint_live.py` drives the provider through the **real loader** and the
**real durable store** — no fakes, no monkeypatched wire shapes — running as the
**runtime user**. Result on principal and governor:

- load → checkpoint API **v2**, tools `fact_store` + `fact_feedback`
- initialize
- **WRITE** — real Jev saliency pass → durable store (213-char extracted context)
- **READBACK** — decisions persisted and re-anchored
- **IDEMPOTENCY** — same evidence does not double-write
- **BLOCK** — with the store unwritable it **raises `CheckpointWriteUnconfirmed`**
  (`attempt to write a readonly database`); it never returns an empty string
- **RECOVERY** — store writable again → checkpoints again

### The production break building it exposed

The store resolved to `<home>/sessions/continuity.db` and was **root:root**, so the
runtime user (`hermes`, uid 10000) had `W_OK = False`. With `checkpoint_required: true`
every checkpoint write failed — and the agent then **refuses to compact**. That is a
wedged session, invisible in the log until a conversation gets long enough to compact.

Cause: provisioning runs as root, and so does any `docker exec … hermes … chat` a human
runs for a quick check. Both leave root-owned state the agent cannot write.

Fixed in `bootstrap.py`: `_normalize_store_ownership()` chowns the session store, the
memory dirs and every per-persona memory dir to the runtime user on every boot
(best-effort; skipped without that user or `pwd`). **Proven** by re-poisoning the store
to `root:root`, running provisioning, and confirming it returns `hermes` with
`W_OK = True`.

## ✅ Activation — root cause and fix (2026-09-27)

**Symptom (live).** With `memory.provider: balabot-jev`, the personas logged
`not installed and not in the plugin catalog` and the manager reported *no active
provider* — so the bots lost holographic's `fact_store`/`fact_feedback` entirely,
while compaction sat armed to fail closed with nothing able to satisfy it.

**Root cause (proven with a direct probe, not inferred).** A persona's agent resolves
providers from **its own home**; `find_provider_dir()` reads `$HERMES_HOME/plugins`,
and for `hermes -p principal` that home is `/opt/data/profiles/principal`.
The provisioning step only ever seeded the **root** home:

```
provider_present("balabot-jev", "/opt/data")                   -> True
provider_present("balabot-jev", "/opt/data/profiles/principal") -> False
provider_present("balabot-jev", "/opt/data/profiles/governor")  -> False
```

**Fix.** `install_memory_plugin()` seeds the plugin into the root home **and** every
`<root>/profiles/<name>/` containing a `config.yaml`. All three homes now resolve True.

**Second defect the receipt exposed.** After activation it logged `registered (0 tools)`
where the wrapped provider reports **2** — the host counts tools at *registration*,
before `initialize()`, so a delegate built only inside `initialize()` left
`fact_store`/`fact_feedback` off even with the provider "active". `get_tool_schemas()`
now builds the delegate on demand.

**Live receipt — both personas, same build:**

```
(Memory provider 'balabot-jev' registered (2 tools)  →  'balabot-jev' activated)
2026-09-27 21:55:01  principal
2026-09-27 21:55:17  governor
```

Every fail-closed warning in the logs predates the fix.

**The standing rule this bought:** a green unit test is not activation. Re-arm — and
call anything shipped — only on a live log line reading `balabot-jev … activated`, plus
a tool count matching the provider it wraps.

Committed as `ce20599`. Suite: 328 passed / 3 skipped.

## The bug this build exposed (found only against the live API)

The live Noul answer is `{"type": "noul", "noul": 0.73}` — the probability lives
under **`noul`**, not `probability`. The Jev depth layer read
`.get("probability", 0.0)`, which returns 0.0: indistinguishable from a confident
"no". Consequences, all silent: the **decision gate rejected every decision**,
**skill selection selected nothing**, **frustration escalation never confirmed**,
and the **pre-compaction saliency pass dropped everything**. The suite was green
throughout because the injected fakes were written in the same wrong shape as the
code — the tests agreed with the bug.

Fixed with one canonical accessor, `jev.noul_probability()` (reads `noul`,
tolerates the legacy key, raises `JevResponseError` — a `JevError` — on a
malformed body). Fakes in the suite now mirror the verbatim wire shape.

## Verified live (container, through the real loader)

`load_memory_provider("balabot-jev")` → api v2, available; delegate intact
(`fact_store`, `fact_feedback` present); a real Jev call classifies evidence to
`ledger`; `on_pre_compress(require_checkpoint=True)` returns durable context and
persists decisions with `jev-checkpoint:<hash>` provenance; `MemoryManager`
reports v2 capability and the host-side call returns the checkpoint; when the
store is made unreachable the checkpoint **raises** `CheckpointWriteUnconfirmed`
rather than returning an empty string.

## Corrections to the earlier documents (binding)

1. **`plans/balabot-remaining-build-plan.md` marks Wave 7 "✅ SHIPPED" for the Jev signals and
   skill selection. That status is untrue.** `is_decision_worthy`, `select_skills` and `prompt_line`
   are called from nowhere outside their own module and their tests — verified by grep. The code
   exists; the wiring does not. The accurate source is `plans/balabot-gap-ledger.md` (missing /
   partial). Treat the depth layer as **library, not feature** until wave 4 lands.
2. **The `<skill_relevance>` prompt line as originally specified — "one extra system-prompt line
   appended after the roster prefix" — must NOT be implemented that way.** Hermes' binding
   invariant is that the system prompt is byte-stable for the life of a conversation and the only
   sanctioned context mutation is compression; a mid-conversation system-prompt change invalidates
   the cached prefix and multiplies the owner's cost. The suggestion must ride a **user message or
   tool result** (Hermes' own precedent: skill slash commands inject as a user message). The
   *intent* of the note is preserved; the mechanism is corrected.
3. The gap ledger files the Jev skill-selection cookbook under "superseded design — do not build
   without an explicit decision". **The owner has now made that decision explicitly**, so it is in
   scope — with correction 2 applied.

## Non-negotiable properties

- **Fail loud.** A missing key, an API error, or an unreachable durable store raises. No fallback
  provider, no silent default. Where a gate must fail *open* (the decision gate; the saliency pass
  when Jev is down), it fails open **with a stated reason recorded** — bloat is recoverable, a
  silently dropped decision is not.
- **Never ask Jev to count, do arithmetic, or compare dates.** Those are documented client
  weaknesses; all counting, sequence bounds and budget math stay in code. Jev only judges.
- **Nouls, not Choices, for whether-questions.** A Choice is relative and forces exactly one
  winner, so "none of these" and "two of them" become unrepresentable.
- **Spans, not descriptions.** A session that ran A then B stores `A: 1–40`, `B: 41–90`.
- **Re-anchor from ground truth.** After compaction the session rebuilds from the purpose record +
  ledger + memory, never from the previous summary (the summary is written into the least-attended
  region of the window — the least trustworthy place in it).

## Verification bar for this build

Real `pytest` output per slice, the parent re-verifying every child claim before commit; a live
container proof that a real compaction produces a durable checkpoint, and that with
`checkpoint_required` armed and no checkpoint the compaction **blocks** rather than proceeding
silently.
