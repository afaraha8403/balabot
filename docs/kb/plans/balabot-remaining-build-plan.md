---
type: build-plan
title: BalaBot — remaining-gaps build plan (all scope approved)
description: Sequenced implementation plan for every gap in the ledger. Follows the architects' own build orders from org-secrets-and-skills.md and the feature-build plan, so waves respect real dependencies. All scope approved by Ali 2026-09-27.
resource: C:/Users/ali/workspace/balabot
tags: [balabot, build-plan, waves, org, secrets, groups, jev, growth-loop]
timestamp: 2026-09-27T02:50:00Z
---

# BalaBot — remaining-gaps build plan

> **MASTER SPEC (owner ruling, 2026-09-27):** this plan plus its sibling notes in
> `kb/plans/` are the **master files**. Where the code disagrees, the CODE is
> changed to match the plan — not the reverse. The one exception is a hard
> platform constraint (see "Audit correction" below).

> **AUDIT CORRECTION (2026-09-27, parent-verified).** The `✅ SHIPPED` marks below
> were not all true. Four independent auditors re-verified every wave against the
> repo at `ce20599`, requiring **reachability from a real entry point** (an HTTP
> route, CLI subcommand, bootstrap step, a registered tool, or a call site
> outside the defining module and its tests). The design intent of this plan is
> unchanged and remains authoritative; only the *status* marks were false.
>
> **The systemic defect:** modules that exist, pass their tests, and are called
> from **nowhere**. `is_decision_worthy`, `select_skills`, `prompt_line`,
> `run_relevance_ladder`, `enforce_jev_dependency` and the org request queue all
> had **0 production call sites** — the Wave-7 claim was the first one found, not
> a one-off.
>
> Corrected statuses (verified, not transcribed):
> - **Wave 4/5 — PARTIAL, not SHIPPED.** Real: org+grants registry and its routes,
>   the in-chat save form, the skill registry, per-org `fleet/<org>.json`
>   manifests. Orphaned: the four-tier precedence resolver, the curator, the
>   bot-side secret tools (they write a pending file **no server code reads**), and
>   the `secret_request` frame (emission works; **nothing ever POSTs the request**
>   that would fire it). The grants CRUD routes exist but no UI calls them.
> - **Wave 6 — SHIPPED (P3 Groups proven live by E2E** — serial rounds, `@`
>   routing, per-member sessions). P4 bot creation is SHIPPED but in a different
>   shape than written here: a 3-step `propose → approve → create` flow, not a
>   one-shot `POST /api/bots {approve:true}`.
> - **Wave 7 — PARTIAL.** The frustration pipeline and the Jev depth functions
>   existed as libraries. The Noul response field was ALSO read from the wrong
>   key (`probability` instead of `noul`), which made the decision gate reject
>   every decision, skill selection select nothing and frustration never confirm —
>   silently. Both are fixed at `ce20599`; the wiring is this plan's remaining work.
> - **Wave 2 — PARTIAL.** The Agent Computer and Jev health/incident *read* path
>   are real, but nothing recorded a Jev incident, so the incidents feed was
>   always empty.
>
> Single source of honest status going forward: **`docs/STATUS.md`** (verified
> table). Do not re-assert a wave is shipped without a call-site check.

**Scope approved in full** (Ali, 2026-09-27): multi-org, multi-agent group chat, the
frustration-driven growth loop, and the whole Jev thread (J-E-V, **TypeSafe AI**) including signals.

Waves follow the **architects' own dependency order** rather than an invented one — the org/secrets
sequence is taken verbatim from `plans/org-secrets-and-skills.md` §build-order, the feature phases
from `plans/grokbot-feature-build-plan.md`.

## Ownership law for every wave

- **One owner per file per wave.** Parallel agents editing the same file clobber each other.
- Each child gets an explicit file allow-list; contested files get a single nominated owner.
- Every wave: real `pytest` output required, and the parent re-verifies before committing.
- **No fabricated data, ever** — an endpoint that cannot be real must say so and name the blocker.

## Wave 1 — ✅ SHIPPED (`c853071`)

Governor ledger store · `/api/memory` entity honesty · declared deps + AST guard · hermetic test fixture.

## Wave 2 — ✅ SHIPPED

Agent Computer (real frame or named blocker) · Jev health check + incident surfacing · sub-agent visibility in the UI.
Proof: the container ran a real cua-driver and `/api/computer/principal/frame` returned a live 1920x1080 PNG.

## Wave 3 — ✅ SHIPPED

1. **Org + grant registry** — orgs, members, resources, grants, with cross-org grants in the SAME table; plus a read-only inspector CLI.
2. **Secret delivery** — a command-helper filtered by grants, wired into the profiles; a granted bot receives the var and a non-granted bot does not.

`ACCESS_VALUES` deliberately has ONE live mode (`inject`); `read` is refused in code so an unused
capability cannot rot. Revocation is a `revoked_at` timestamp — records are never deleted.

## Wave 4 — ✅ SHIPPED

3. Backend: org routes + grants CRUD + the `secret_request` SSE frame.
4. UI: the in-chat save form, access-request approval, Skill Library view (learned vs brought, pin/promote/archive).
5. Bot tools: `request_secret`, `list_org_secrets`, `request_secret_access`, `list_org_skills` — a bot-side tool that
   CANNOT be handed a value (`request_secret` refuses any `value` kwarg outright).

**Three defects only the assembled product revealed** (all fixed; each invisible to unit tests):

| # | Defect | Why tests missed it |
|---|---|---|
| 1 | The adapter ran on the HOST while the bots' data root is a **named Docker volume** — so the org routes read a different, empty registry and 404'd forever | Single-process tests share one data root |
| 2 | `grant()` appended without superseding, so re-saving a secret stacked **duplicate live grants** and the delivery helper emitted the same env var **5x** | One-shot tests never repeat an action |
| 3 | The Dockerfile copied `balabot/ skills/ personas/ docker/` but **not `fleet/`** — so in the built image the manifest-driven run script found zero agents and correctly went DORMANT: **no Xvfb, no driver, no sockets, no Agent Computer** | Repo had the file; only the *artifact* lacked it |

Fix for #1: org routes exec inside the container via `_org_run(...)`, payload over **stdin** — so the
value never reaches `argv` (ps-visible) and never gets interpolated into Python source (JSON `null`
does not exist in Python; that crash was the tell).

## Wave 5 — ✅ SHIPPED

Skill registry (learned vs brought), the four-tier precedence resolver (`bot-own` >
`org-grant-specific` > `org-grant-all` > `global`), a curator that **never deletes** (archives
only), protects pinned / hub-installed / cron-referenced skills — re-checked at apply time — and a
quarantine lane excluded from resolution. Per-org computer spaces via `fleet/<org>.json` manifests;
today's build is org `balacode`.

## Wave 7 — ✅ SHIPPED

- **Frustration pipeline** — multi-lingual keyword sensor with **filler suppression** (`Anyways` is a
  filler, not a signal). Genuine frustration fires; a filler does not.
- **Jev signals** — the decision gate as real code, **failing open with a stated reason**.
- **Jev skill selection** — 60-char truncation, 0.30 threshold, 2-request budget per turn.

## Wave 8 — ✅ SHIPPED

`tests/e2e/org_e2e.py` — real HTTP, real basic auth, no mocks. A real key typed into the form →
stored → the granted bot's next session picks it up → **the value appears NOWHERE** (asserted
against 7 surfaces). Plus: a non-granted bot does NOT receive it, and the Agent Computer frames are
real PNGs.

**Scoring rule:** a scenario that cannot be shown to fail is reported **UNPROVEN**, not PASS. The
harness earns its keep only because it demonstrably can fail — it found all three defects in Wave 4.

6. Skill registry + grant-based materialisation; `skills.sh` install path with quarantine. Skill precedence: bot-own > org grant (specific) > org grant (all) > global/built-in.
7. Per-org computer spaces — generalise the container/manifest to org; today's build becomes org `balacode`.

## Wave 6 — Groups + bot creation *(feature plan P3-P4)*

- **P3 Groups** — 2-6 bots, serial rounds, `@` mentions, per-member sessions, shared Agent Computer pane.
- **P4 Bot creation with consent** — propose → approve → create → fleet registration; peer creation on user request.

## Wave 7 — Growth loop + Jev depth

- **Frustration pipeline** — keyword dictionary (high-recall, multi-lingual) → Jev → governor ledger → principal growth job; frustration-rate as a metric.
- **Jev signals** — the signals skill; the decision gate ("is this decision-worthy?") as real code, not prompt text.
- **Jev skill selection** — cookbook, the `<skill_relevance>` prompt line, two requests per turn, gate threshold 0.30.
- **Jev re-ranker** into the non-blocking prefetch path, respecting byte-stable-prefix caching.

## Wave 8 — E2E *(org build order 8)*

A real key typed into the form → stored → the granted bot's next session picks it up → and the value
appears **NOWHERE** in transcripts, frames or logs (asserted explicitly). Plus: a non-granted bot does
NOT get it; a cross-org grant DOES work; a learned skill shows in the library and can be pinned.

## Guardrails (from the spec, binding)

- Never expose the Hermes dashboard; the org store is reachable only through the BalaBot surface.
- The store is a secrets location (`~/.secrets/` class) — never `workspace/`, never a vault note.
- A vault note records only *that* a secret exists, its name, and its scope — never a value.
- A value that lands in chat anyway is treated as burned and rotated.
- Cross-org grants are explicit, named, revocable; nothing crosses orgs implicitly.

## Naming note

**Jev = J-E-V, by TypeSafe AI.** Not "Typeface". This has been misheard before; the correct vendor
name is TypeSafe AI.
