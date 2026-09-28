---
type: playbook
title: Organizations, secrets, env vars and skills — design
description: Multi-tenant model for GrokBot — each organization owns its context, skills, secrets/env vars and computer spaces; agents can be granted cross-organization access. Covers the in-chat secret request/save interface, bot-visible listings and access requests, and the two classes of skills (learned vs brought).
tags: [grokbot, secrets, env-vars, skills, organization, multi-tenant, curator, design]
timestamp: 2026-09-26T21:40:00Z
status: draft-for-approval
---

# Organizations, secrets and skills

## The tenant model (Ali, 2026-09-26)

An **organization** is the tenant. It owns:

- its own **context** (knowledge, memory, brand)
- its own **skills**
- its own **env vars / secrets**
- its own **set of computer spaces** (its own agent computer — container, displays, workspaces)
- its **members** — one or many bots

And critically: **an agent scoped to org A can be granted access to org B.** Cross-org access is a
first-class, explicit, revocable grant — not a side effect of sharing a machine.

```
Org A                          Org B
├── context / brand            ├── context / brand
├── skills (all | selected)    ├── skills (all | selected)
├── secrets (all | selected)   ├── secrets (all | selected)
├── computer spaces            ├── computer spaces
└── bots: steve, jim           └── bots: oscar, …
          │
          └── cross-org grant ──→ Org B: {skill X, secret Y}   (explicit, revocable)
```

**One grant registry, one shape:**

```
principal (bot) → resource { org, kind: secret | skill | workspace | display } → access
```

A cross-org grant is simply a grant whose resource lives in another org. Same table, same revocation
path, same audit trail — no special case.

## Computer spaces per org

Each org gets **its own agent computer**: container `agent-computer-<org>`, its own fleet manifest
(`fleet/<org>.json`), its own displays/sockets/workspaces. The build already shipped generalises —
today's `grokbot-computer` becomes org `balacode`'s. Isolation between orgs is then structural (a
separate container), and a cross-org grant is the *only* way one org reaches another's machine.

## The tension to resolve first (and how)

The `credential-intake` skill's Rule 1 says *never ask for a secret in chat* — chat persists in
transcripts, session logs and provider logs. Ali wants the entry **interface in the chat**.

> **The interface is in the chat. The value never is.**

The form is a **client-side component that POSTs straight to the backend**. The value never becomes a
chat message, never enters the transcript, and never reaches the model's context. A bot can *trigger*
the request and *see that it was answered* — without ever seeing the secret.

Hard rules:

- No secret value ever in: transcript, SSE frames, model context, logs, vault, workspace, or argv.
- Only **fingerprints** (`…` + last 4) and metadata are ever displayed or recorded.
- The bot's tool returns `{saved: true, name, fingerprint}` — never the value.
- **Bots receive secrets as injected env vars only; a bot can never read the raw value.** (Taken as the
  default; if a task genuinely needs the literal value, that is a deliberate, audited exception — not
  ordinary access.)

## Secret injection — reuse Hermes, don't reinvent it

Hermes already has the delivery path, and the GrokBot profiles already use it:

- `secrets.sources: [command]` + `command.command` — present in all three profiles today.
- `secrets.profile_alias: true` — a vault secret named `FOO_<PROFILE>` also hydrates canonical `FOO`
  for that profile. **This is exactly "org secret granted to one bot".**
- Precedence, provenance, `preserve_existing` and conflict handling belong to the orchestrator.

**Option A — command helper (works today, recommended first).** Point `secrets.command.command` at a
script that reads the org store, filters by the calling bot's grants (including cross-org grants), and
prints `KEY=VALUE` lines. Zero new Hermes code, sanctioned extension point, `profile_alias` for free.

**Option B — a `SecretSource` plugin.** Subclass `agent.secret_sources.base.SecretSource`, implement
`fetch(cfg, home_path) -> FetchResult`, register via `ctx.register_secret_source()`. Structured
provenance + conformance kit. Worth it as the fleet and the audit requirements grow.

Ship A now, B when the shop grows.

## The in-chat interfaces

**1. Bot requests a secret** → `event: secret_request` SSE frame (same mechanism as the working
handoffs) → Astryx form:

```
🔑 Jim needs an environment variable
   Name:   [ STRIPE_SECRET_KEY        ]
   Value:  [ •••••••••••••••••••••••• ]   ← password field
   Share:  (•) Jim only   ( ) All bots   ( ) Choose bots…   ( ) Another org…
                          [ Save ]  [ Cancel ]
```

Bot tool: `request_secret(name, description?)` → `{saved, name, fingerprint, granted_to, share_scope}`.

**2. Bot lists what exists** → `list_org_secrets()` → `[{name, description, granted: true|false,
origin_org, fingerprint}]` — names and metadata only, never values. Cross-org entries are labelled
with their origin org so a bot can ask for the right thing.

**3. Bot requests access** → `request_secret_access(name, reason)` → the user approves in chat → grant
added. Nothing is revealed; the value is merely *available* at session start.

## Skills — two classes, both org-scoped

Ali's requirement: skills scoped like secrets, **and** two distinct kinds.

### Class 1 — learned (auto-generated)

Produced by the **self-improvement loop** (`skill_manage`) and maintained by the **curator**:
agent-created skills land in the skills dir; the curator tracks views/uses/patches and moves them
`active → stale → archived` (LLM consolidation is opt-in; pinned skills and any skill referenced by a
cron job are protected; it never auto-deletes, only archives).

This class needs to be **visible**, because otherwise the fleet silently accumulates and prunes
knowledge nobody can see. The surface:

- **Skill Library view** — name, origin (`learned` | `brought`), scope (bot / org / org-selected),
  usage (views, uses, patches), state (`active`/`stale`/`archived`), last used.
- Actions: **pin** (protect from the curator), **promote** (learned → org-shared, explictly by a
  human), **archive/restore**, **view**.
- Truth sources: the curator state + the skill-usage ledger; `hermes curator run --dry-run` gives a
  no-mutation preview of what a real pass would change.

### Class 2 — brought (authored or installed)

Three channels, all landing in the same org registry:

1. **Hand-written** — authored in the UI or dropped in.
2. **skills.sh** (Vercel's open ecosystem) — `npx skills add <owner/repo>`, installs from a GitHub
   repo; packs bundle several skills into one install; supports many agent runtimes.
3. **Hermes hub** (`agentskills.io`) — hub-installed skills are **always exempt** from the curator.

Third-party skills are the risk surface here: skills.sh runs routine audits but explicitly does not
guarantee safety. So the flow is **quarantine → review → promote**: an installed skill lands inert,
is shown for approval (what it does, what it touches), and only then gets a scope.

### Skill precedence for a bot

```
bot-own  >  org grant (specific bots)  >  org grant (all bots)  >  global / built-in
```

Bot-own skills stay in that bot's profile and are never shared upward automatically. Promotion is
always a human action — a skill changes behaviour for every bot that gets it.

## Build order

1. **Org + grant registry** (orgs, members, resources, grants; cross-org in the same table) with a
   read-only inspector CLI.
2. **Secret delivery** — command-helper script filtered by grants → wire into the profiles; verify a
   granted bot gets the var and a non-granted bot does not.
3. **Backend** — `POST /api/org/secrets` (client-side only), grants CRUD, and the SSE events
   (`secret_request`, `secret_access_request`, `skill_install_request`).
4. **UI** — the Astryx save form, access-request approval, and the Skill Library view (learned vs
   brought, with pin/promote/archive). Behind the existing basic auth.
5. **Bot tools** — `request_secret`, `list_org_secrets`, `request_secret_access`, `list_org_skills`.
6. **Skills** — registry + grant-based materialisation; skills.sh install path with quarantine.
7. **Per-org computer spaces** — generalise the existing container/manifest to `org` (today's build
   becomes org `balacode`'s).
8. **E2E** — a real key typed into the form → stored → the granted bot's next session picks it up →
   the value appears **nowhere** in transcripts, frames or logs (asserted explicitly). Plus: a
   non-granted bot does NOT get it; a cross-org grant DOES work; a learned skill shows in the library
   and can be pinned.

## Guardrails

- Never expose the Hermes dashboard; the org store is reachable only through the GrokBot surface.
- The store is a secrets location (`~/.secrets/` class) — never `workspace/`, never a vault note.
- Vault records only *that* a secret exists, its name, and its scope — never a value.
- A value that lands in chat anyway is treated as burned and rotated.
- Cross-org grants are explicit, named, and revocable; nothing crosses orgs implicitly.
