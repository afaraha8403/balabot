---
type: audit
title: BalaBot — vault-to-implementation gap ledger
description: 203 claims extracted from the BalaBot spec across the AI vault, each verified against the real repo. 90 implemented, 103 gaps split into real product gaps, superseded design, and doc hygiene. Produced by six parallel read-only subagent auditors.
resource: C:/Users/ali/workspace/balabot
tags: [balabot, audit, gap-ledger, vault, spec-drift]
timestamp: 2026-09-27T06:25:00Z
---

# BalaBot — vault-to-implementation gap ledger

Six auditors read the spec cluster in the AI vault **in full** and checked every concrete,
checkable claim against `C:/Users/ali/workspace/balabot`. Nothing was modified; every finding
carries a real file path or the literal string `not found`.

**203 claims · 90 implemented · 103 gaps** (44 missing, 45 partial, 14 contradicted).

## The headline: the vault describes more than one product

The single most important finding is not a missing feature. **The spec spans two eras**, and
roughly a third of the "gaps" are the current product having *deliberately moved past* the older
design. Implementing them would rebuild a different product, not complete this one.

| Bucket | Count | Meaning | Action |
|---|---|---|---|
| **Real product gaps** | 57 | The shipped product is genuinely incomplete or contradicts itself | Build |
| **Superseded design** | 36 | GrokBot-era / org multi-tenant layer the build unwired on purpose | Do **not** build without an explicit call |
| **Doc hygiene** | 10 | The doc asserts a status the code does not have | Correct the doc |

## A. Real product gaps

| Effort | Status | Claim | Needed |
|---|---|---|---|
| S | partial | Mutation check 8/8 detected | execute mutation_check.py to confirm the 8/8 result rather than trusting the doc |
| S | partial | Decision gate: Jev answers 'is this decision-worthy?' before the ledger admits a decision | no runtime decision-gate module exists in balabot/*.py — gate lives in simulation + persona instructions only |
| S | partial | Fail loudly, never silently degrade on Jev outage; Jev availability is a first-class health check the principal owns | no code-level health-check wiring (s6 slot or monitor) for Jev availability — only persona/skill instructions |
| S | partial | NEW security requirement: screen everything retrieved; contains_prompt_injection tested first, then contradiction, then relevance, then evidence; inje | no ordered contains_prompt_injection→contradiction→relevance→evidence pipeline exists in code — the ordering i |
| S | partial | Packaging fragility: balabot/jev.py imports requests but no requirements.txt/pyproject.toml declares it | Add a requirements.txt/pyproject.toml declaring requests. |
| S | partial | gateway-default s6 slot is not in the user bundle | Nothing in-repo; base image dependency. |
| S | partial | memory_query_rewrite is an existing auxiliary task usable as an insertion point for the memory pipeline | Verify against Hermes' _AUX_TASKS or add auxiliary config to the persona templates if the plan is to be execut |
| S | partial | Host capacity facts: Docker/WSL2 capped 14 GiB, debian:bookworm-slim pulled, only Windows cua-driver 0.29.1 installed (no Linux binary) | Fetch the Linux cua-driver binary into the image per build step 1 |
| S | partial | Policy 2: 'the bots' computer_use toolset was removed from all three GrokBot profiles' (structural, not a promise) | Delete the stale computer_use config block from steve's profile so the claim is literally true |
| S | partial | Per-agent capability manifests: every daemon runs bounded mode against a generated allow-list (gen_policy.py); admin tools refused | Persist/verify the generated policy inside the container and add a checkable artifact (path + hash) to the doc |
| S | partial | Repo's architecture mapping: 'Agent-to-agent messaging — message_agent + visible handoff frames — exists'; 'Skills & craft hygiene — curator state — s | Correct the mapping-table wording: handoffs and curator state are Hermes-level, not shipped by BalaBot itself |
| S | partial | Repo test suite green (implied by 'Built, provisioned and driven end to end' verification claims in README/TESTING.md) | Fix or quarantine the failing bootstrap env test; a red suite undercuts the 'verified' README section |
| M | missing | Sub-agent visibility in the UI is outstanding (no UI) | Live sub-agent rows under parent in AgentsScreen, backed by a spawn ledger reader. Doc is accurate. |
| M | contradicted | Memory screen backed by /opt/data/profiles/<p>/mem_<p>.db with tables facts, entities, fact_entities, facts_fts, memory_banks | Reconcile DB filename; extend reader to entities/banks if claimed. |
| M | partial | Persistent agents coordinate/review, delegate non-quick work; peer creation on user request without principal round-trip | Runtime enforcement or explicit doc note that it's prompt-level for now. |
| M | partial | Session front matter records topics WITH spans, never a merged 'A and B' description | Implement a real front-matter/purpose record writer wired to the compaction boundary; the sim alone is not the |
| M | partial | New-vs-resume routing uses ONE Noul per candidate session, never a Choice, with three outcomes (resume / new+linked / new clean) | Wire the simulated Noul routing into the real session resume path |
| M | partial | Governor holds a per-session purpose record (OKF ledger) that sessions re-anchor from | Stand up the actual ledger store and the re-anchor reader the plan depends on |
| M | missing | Principal verifies durable extraction happened before each compaction and must fail loud; compaction-churn detection | Add the Principal health-check (churn detector + extraction gate) to the ops loop |
| M | contradicted | P1 Agent Computer pane DONE: /api/computer/{bot}/frame returns a real 1920x1080 PNG and /action is wired | Wire a real computer-use driver (or the planned Linux VM) behind the frame/action routes; UI-side pane (ui/src |
| M | partial | P2 visible handoffs DONE: POST /api/chat emits event:handoff frames {from,to,summary,at} parsed from tool-call deltas | Add handoff frame generation/parsing to the server passthrough (or document that the Hermes gateway emits it a |
| M | missing | Pause has a timeout resuming with an 'unattended' note; no intervention screenshots persisted; bot is told only {resolved:true,note?} | Encode timeout/resume, screenshot-exclusion and minimal-disclosure rules when the intervention flow is built |
| M | contradicted | Per-persona skill split: principal 68 skills (10 BalaBot-shipped), governor 9 all-shipped; per-persona additions documented (principal 3, governor 3,  | Either update the doc to 9-shipped/same-set-for-both, or add per-persona skill selection to install_skills() |
| M | partial | The interface is in the chat, the value never is: client-side form POSTs straight to the backend; value never in transcript, SSE, model context, logs | Backend storage + fingerprinting + the E2E 'value appears nowhere' assertion (build order 8) |
| M | missing | Bots receive secrets as injected env vars only and can never read the raw value; delivery via secrets.sources command helper filtered by grants, reusi | Option A command helper + per-profile wiring + granted vs non-granted verification; docs/architecture.md:362 ' |
| M | partial | Skill Library view with actions: pin, promote, archive/restore, view; third-party skills flow quarantine -> review -> promote | Working pin/promote/archive backends and a quarantine lane for installed third-party skills |
| M | partial | Secret store guardrails: store is ~/.secrets-class, never workspace/vault; vault records only existence/name/scope; a leaked-in-chat value is treated  | The actual store plus rotation handling |
| M | missing | Bot-to-bot messaging (message_agent) with deliveries visible in the transcript | DM primitive for the shipped personas + transcript-visible delivery |
| M | partial | Secrets layers: per-profile .env + global .env + OS env + ~/.secrets/ with opt-in vault abstraction (secrets.sources / secrets.profile_alias) | Wire the vault source with grant filtering (same as org-secrets finding) |
| M | missing | Jev is a hard dependency; unreachable Jev is an incident the Principal raises | Key via secret flow + incident surfacing |
| M | partial | Governor keeps a shared OKF decision ledger readable by persistent agents and sub-agents | Ship the ledger initialization in bootstrap (create the OKF ledger tree) so the governor has a store on day on |
| M | partial | Jev decision gate into the ledger ("is this decision-worthy?") | Implement the gate as real code in the governor's loop, not just persona prompt text |
| M | partial | NEW SECURITY REQUIREMENT: screen everything retrieved (contains_prompt_injection filter first, then contradiction/relevance/evidence) before content r | Add the passage-filter as code (or an adapter hook) since the doc frames it as a requirement, not advice |
| M | partial | Peer creation allowed: any persistent agent may create another persistent agent when the user asks (single-point-of-failure resolved) | Expose an operator/user-gated provisioning entry point an agent can call (with consent), else the 'resolved' c |
| M | partial | Principal's ops toolset (health of every agent, log reads, restart, periodic review) and principal leadership role | Ship concrete ops tooling (health probe + restart) the principal can invoke |
| M | missing | Sub-agent visibility in the UI ('watchful eye' visible; live sub-agent rows under their parent) | As documented — build item |
| L | partial | Hierarchy is a permission layer, not prompt advice; principal may restart/stop/provision agents; peers created only on user request (sim_hierarchy_per | Wire the matrix into real enforcement (bootstrap or a permission module), not just sims. |
| L | missing | Principal's ops toolset (health, log reads, restart, craft-review pass) is outstanding | Build ops mutation endpoints + a scheduled review pass. Doc is accurate that it's absent. |
| L | missing | Growth-loop audit trail and rollback path outstanding | Build a change ledger with reversal, or keep the doc claim. Doc is accurate. |
| L | missing | Pre-compaction saliency pass classifies dropped content to ledger / holographic memory / working set before compression runs | Build the pre-compaction classifier (Jev-backed) and hook it into the compression path |
| L | missing | P4 Bot creation with consent: POST /api/bots {name,title,description,icon,cloneFrom?,approve:true} | Implement bot-creation endpoint with approval gate and persona bootstrap (balabot/bootstrap.py already has the |
| L | missing | P5 secrets store: secrets.sources + secrets.profile_alias, migrated per-profile keys, every bot still authenticates | Build the secrets store or re-spec P5 against the B architecture |
| L | missing | Intervention flow: bot calls request_intervention(reason,hint,url), UI gets SSE event:intervention, POST /api/intervention/{token}/resolve releases th | Implement the intervention tool, SSE frame, resolve endpoint, and UI badge/focus; nothing of this flow exists |
| L | partial | Hierarchy USER > principal > governor > persistent agents > sub-agents is the shipped structure | Provision persistent-agent tier and enforce hierarchy as a permission layer, not prompt advice (docs/architect |
| L | partial | Principal duties: liveness/recovery via gateway run --replace, diagnosis, growth & leadership, onboarding, Jev-as-incident | Jev key via secret flow + the growth-review loop wired to the ledger |
| L | partial | SSE secret_request frames drive the in-chat form; bot tools request_secret, list_org_secrets, request_secret_access, list_org_skills exist | Bot-side tools + server emission of the SSE events |
| L | missing | Two skill classes: learned (self-improvement loop + curator with active/stale/archived lifecycle, usage ledger, pin/promote/archive, hermes curator ru | Curator state + usage ledger + install channels; the whole learned class is unwired |
| L | missing | Bot-created bots: an existing bot proposes and creates a new bot, human approves (Grok Bot parity gap) | A consent-gated spawn flow; today only bootstrap provisioning at container start |
| L | missing | Hierarchy as a permission layer (who may restart/create/grant), enforced structurally rather than by prompt | As documented — build item, doc is honest |
| ? | partial | Paste text/links/images, attach files in composer | wire attachments through /api/chat; image paste |
| ? | partial | Bot-to-bot handoff visible in the conversation | server-side handoff emission |
| ? | partial | Agent Computer pane openable from a conversation; watch live; leave while work continues | real computer-use driver |
| ? | missing | Human take-over for sensitive steps (password/2FA/CAPTCHA handed to human) | escalation handoff step type |
| ? | partial | Mobile is a first-class client (PWA, installable to home screen) at bot.balacode.xyz | manifest.json + SW for installable PWA |
| ? | partial | Sessions/conversations: multiple chats per bot with switch/delete/new (SessionsDialog) | durable server-side conversation store |
| ? | partial | Secrets: in-chat SecretRequestCard where the interface is in the chat and the value never is | backing secrets endpoint |
| ? | partial | Learn-workflow-from-demonstration → skills (self-improvement loop surfaced in UI) | curator state / learned-skill attribution |

## B. Superseded design — do not implement without an explicit decision

These come from the **GrokBot era** (roster Steve/Jim/Oscar, per-bot ports 9121-9123, the
`grokbot-web` surface) or from the **org multi-tenant layer** that `server.py` documents as "an
earlier concept" and answers `available:false` for. Notable examples:

- Organizations as tenants owning context, skills, secrets, computer spaces and members
- Cross-org grants; per-org computer spaces (`agent-computer-<org>`, `fleet/<org>.json`)
- Skill precedence (`bot-own > org grant > global`) and org-scoped skills
- Groups (2-6 bots, serial rounds), connectors/marketplace, routines, `/` and `@` mentions
- Voice chat, reply-in-thread, reactions, editable draft cards, keyboard-first palette
- Jev skill-selection cookbook and the `<skill_relevance>` prompt line

## C. Doc hygiene — the doc is wrong, not the code

| Effort | Claim | Correct to |
|---|---|---|
| S | contradicted | Public repo is 52 files | CORRECTED: doc now states 98 tracked files (`git ls-files | wc -l`) |
| S | partial | CI green on commit 99cae5e4; GitHub Actions success | VERIFIED: `gh run list --commit 99cae5e4` → `success` ("fix: record the exec bit for s6 service scripts") |
| S | missing | Pin the Jev API version; treat model upgrades as deliberate | VERIFIED DONE: `balabot/jev.py` pins `DEFAULT_MODEL = "jev-1.13.0"` (with `jev-latest` opt-in); claim is true |
| S | contradicted | Plus 3 user-usage scenarios | CORRECTED in docs: 4 (sim_user_scenarios.py day_one_install / missing_key_refuses_to_start / principal_onboards_first_agent / roster_routes_to_the_right_agent) |
| S | contradicted | Per-profile s6 services gateway-principal / gateway-governor were registered and running | CORRECTED in docs: ONE multiplexed gateway `gateway-default`; per-profile gateway refused with exit 78 |
| S | contradicted | Dashboard: HERMES_DASHBOARD=1 + basic-auth credentials configured in compose, credentials at ~/secrets/balabot-dashboard.key | CORRECTED in docs: compose deliberately does NOT set HERMES_DASHBOARD=1 (Hermes dashboard must never be exposed); product surface is the BalaBot SPA on :9119 with HTTP basic auth, key at C:/Users/ali/secrets/balabot-dashboard.key |
| S | partial | API_SERVER_HOST=0.0.0.0 required for the published port (DEFAULT_HOST in gateway/platforms/api_server.py) | Confirm the rendered config or bootstrap actually sets the host; not present in-repo. |
| S | contradicted | tests/e2e/ui_e2e.mjs has 7 scenarios, 7/7 green | CORRECTED in docs: EIGHT scenarios (s08 asserts a real tool call is surfaced), 8/8 green |
| S | contradicted | No live TypeSafe call has ever been made — no key on this system | CORRECTED in docs: TYPESAFE_API_KEY exists in balabot/.env (untracked; .gitignore + .dockerignore exclude it — no leak); live contract tests pass |
| S | partial | kb/log.md 2026-09-26 (shipped): skill library returns '12 learned skills' from the real Hermes catalog per profile; secret values base64 at rest, not  | CORRECTED in kb/log.md: learned is EMPTY by design until curator state exists; real counts are principal 68 (10 BalaBot-shipped), governor 9. Intervention-flow still 'designed and approved but not yet built' — status is honest. |

## Corrections to the audit itself (parent-verified)

Two auditor claims were checked and **rejected**:

- *"a live TypeSafe key in the repo `.env` violates the open-source no-secrets requirement."*
  **False.** `.env` is not git-tracked and is excluded by both `.gitignore` and `.dockerignore`.
  The key lives in a proper secrets location.
- *"the repo test suite is green."* **False.** One test was genuinely failing:
  `test_env_file_empty_when_no_env_keys`. Root cause was test hermeticity, not product code —
  the `hermes_env` fixture cleared a hardcoded three-key list while `PROFILE_ENV_KEYS` had since
  gained `TERMINAL_TIMEOUT`, so an ambient value leaked into the profile `.env`. Fixed by deriving
  the clear-list from `PROFILE_ENV_KEYS`; suite now 66 passed / 3 skipped, verified hermetic under
  the exact ambient condition that broke it.

**Method note:** subagent summaries are self-reports. Every claim above was extracted from the
auditors' own evidence fields, and the two most consequential ones were independently re-verified
before being accepted.
