---
type: reference
title: BalaBot project rules (agent-facing)
description: Project-specific standing rules for AI coding agents working in the BalaBot repo — the ones the repo has actually paid for in debugging cycles.
resource: docs/PROJECT-RULES.md
tags: [balabot, rules, agents, engineering]
timestamp: 2026-09-27T00:00:00Z
status: active
---

# BalaBot — project rules

> [!IMPORTANT]
> **ARCHITECTURE TRANSITION (2026-10-23):**
> BalaBot is actively transitioning from the legacy single-container Docker/Hermes stack to **Pi Durable (`@earendil-works/pi-durable`)**, **Cloudflare Agents SDK (`PiHarness`)**, and a **Native Rust Desktop Application (`src-tauri`)**.
> Docker, `docker-compose.yml`, s6-overlay, and container-bound virtual displays are **scheduled for complete retirement in Wave 7**.
> The authoritative modern master spec is **`docs/PRD-PI-DURABLE.md`**, and the active sequenced roadmap is **`docs/kb/plans/pi-durable-migration.md`**.
> Do not introduce new Docker dependencies, container process scripts, or host synthetic input injections.

These extend the Balakit base rules (`AGENTS.md` managed block) with the things this repo has
actually cost us. On conflict: secrets & safety > correctness > the rules below > Balakit base.

## 1. Runtime environment (Legacy Hermes vs Modern Pi Durable)

- **Target Architecture (Active):** Native Rust desktop shell (Tauri v2) hosting Pi Durable locally or connecting to Cloudflare Edge Workers (`PiHarness`). Storage lives in OS user data directories (`~/.balabot/data/`) or Durable Object SQLite (`this.sql`).
- **Legacy Container (Migration Only):** If testing legacy Python code during the Wave 0 test translation phase, the container is `balabot-balabot-1` with `HERMES_HOME=/opt/data`. Never fix a BalaBot bug by editing your host profile tree.
- **Zero Docker Law:** No new container virtualization, Dockerfile additions, or WSL2 dependencies are permitted.

## 2. The KB & PRD is the spec

`docs/PRD-PI-DURABLE.md` is the **authoritative master spec** for the modern architecture.
`docs/kb/` is the product knowledge bundle. Where code disagrees with the spec, the **code** changes.
The only override is a hard platform constraint. `docs/STATUS.md` is the **single source of honest status** —
never re-assert a wave is shipped without a call-site check. `docs/overall_plan.md` indexes the whole bundle.

## 3. What "shipped" means

A module that exists, passes its own tests, and is called from **nowhere** is *not* shipped.
Required: reachability from a real entry point — an HTTP route, a CLI subcommand, a bootstrap step,
a registered tool, or a call site outside the defining module and its tests.

House defect class: **"declared capability, zero effect, no error"** — a config that enables a plugin
the image never shipped does nothing and says nothing. Proof bar: **>=15 real-ability scenarios** plus
an **E2E run through the UI**, and the harness must be shown **able to fail** (mutation check).

## 4. One owner per file per wave

Parallel agents clobber each other. Never edit a file a sibling is mid-edit on; contested files get
one nominated owner. If you cannot edit the file that needs the change, **deliver the exact hook as
text** for its owner instead of touching it.

## 5. Secrets [CRITICAL — this repo has the scars]

- Values live in the environment, the container's secret store, or `C:/Users/ali/secrets/`.
  **Never** in chat, a transcript, an SSE frame, a log, a vault note, or the workspace.
- A secret is delivered by name + fingerprint: the bot receives the env var, can use it, and can
  never read it. Secret-at-rest is **base64, not encrypted** — the owner-only ACL is the control.
- A value that lands in chat anyway is **burned**: rotate it. Say so; do not hope.
- Never print a key to satisfy a request. Print presence (`SET` / `(unset)`), never the value.
- Local agent env: `.env.local` (gitignored) — `set -a; . .env.local; set +a`.

## 6. Tests

```bash
python -m pytest tests -q          # full suite; record the exact counts
```

- A green suite is **not** proof until you show it can fail. Delete the gate → confirm the test
  fails → restore. An assertion that cannot fail is worthless.
- Never regress the count. Report real command output, never a summary of it.
- Hermetic where it matters: state lives under `tmp_path`; no ambient env leakage.

## 7. Deploy reality

- The product UI is built via `npm run build` into `ui/dist` — **`npm run build` IS the UI deploy**; it updates the assets consumed by the Tauri v2 WebView and web servers alike.
- In the legacy container setup, container rebuilds did not update the site. In the modern architecture, the native Rust binary bundles `ui/dist` directly, and Cloudflare Workers serve assets via Cloudflare Pages / Workers static assets.
- In Cloudflare Remote Mode, the edge agent deploys via `wrangler deploy` to Cloudflare Workers and Durable Objects.
- Local PC server mode executes natively via the Tauri application without background Docker daemons.

## 8. Personas are the product's voice

`personas/<name>/SOUL.md` is **who the bot is** (voice, register, judgement);
`personas/<name>/AGENTS.md` is **what it may do** (domain rules). Provisioning seeds both into
`/opt/data/profiles/<name>/` at boot, so the repo copy is the source of truth.

- A greeting is **not a work order** — never answer small talk with a diagnostic sweep.
- Agents read like human colleagues: short, warm, plain. No headers or bullet audits in a chat reply.
- Tone/register plugins must be **enabled and present**, or the setting is a silent no-op.

## 9. Jev

**Jev = J-E-V, by TypeSafe AI** (not "Typeface"). It is infrastructure and a **hard dependency**:
unreachable Jev is an incident, not a warning. It classifies; it never decides. Irreversible actions
(send, spend, delete, publish) always keep a real reasoner in the loop. Gates that must fail open
fail open **with a stated reason recorded**.

## 10. Never fabricate

No invented endpoint, frame, status, metric, or "done". If something cannot be real yet, say so and
name the blocker — an explicit `available: false` with a reason beats a plausible fake. Same rule
for docs: surface an untruth rather than writing around it.

## 11. Scope walls

- **Agent Computer ("NEVER THE HOST"):** Computer automation executes exclusively inside isolated headless Chromium via Chrome DevTools Protocol (CDP) or off-screen virtual framebuffers within explicit workspace directory boundaries. Synthetic mouse or keyboard injection (`SendInput`, `CGEvent`, `uinput`) into the host desktop is **strictly prohibited**. Intervention take-overs reach only the specific quarantined display; credentials entered during intervention are never logged.
- **Orgs**: cross-org grants are explicit, named, revocable; nothing crosses orgs implicitly.
- **W4 Secret Intake:** Raw credentials never enter chat transcripts, model prompts, or thinking tokens. Ingestion occurs via direct client POST into local OS vaults or encrypted Cloudflare secrets.
- **Consent before creation**: nothing is created without explicit human approval, and a bot never approves its own proposal.

## 12. Git

- Conventional commits; **commit often, sync often** — small, landed, pushed beats one big drop.
- One branch only: the local branch is `main` and tracks the remote default `main`, so a plain
  push lands it — no branch-name mapping:

  ```bash
  git push
  ```

- Commit only your own paths — never sweep a sibling's in-flight edits into your commit.
- `docs/kb/` mirrors an external bundle; when the bundle changes, re-sync it deliberately.

## 13. OpenUI Generative UI (all agents)

When an agent needs human consent, parameters, or structured review (e.g. hiring an agent, creating a proposal, selecting configuration, or executing irreversible operations), the agent **must not monologue or execute silently**. It must emit an interactive **OpenUI Lang** card in the chat transcript.

Agents run in **Inline Mode**: normal conversation is plain markdown outside of code fences; structured UI is emitted inside a triple-backtick `openui-lang` fence:

````markdown
```openui-lang
root = HireAgentCard("Marketing & SEO Expert", "marketing-seo-expert", "Drives customer acquisition, organic search ranking, keyword research, content optimization, and performance campaigns.", "SEO, SEM, Copywriting, Web Analytics")
```
````

### Prompt Instructions for All Agents

The following instruction block is generated directly from the OpenUI component library (`@openuidev/react-lang` + `balabotLibrary.prompt({ inlineMode: true })`):

```text
You are an AI assistant that responds using openui-lang, a declarative UI language. When user input, approval, or structured presentation is required, emit openui-lang inside triple-backtick fences.

## Syntax Rules
1. Each statement is on its own line: `identifier = Expression`
2. `root` is the entry point — every program must define `root = HireAgentCard(...)` (or another allowed root component).
3. Expressions are: strings ("..."), numbers, booleans (true/false), null, arrays ([...]), objects ({...}), or component calls TypeName(arg1, arg2, ...)
4. Use references for readability: define `name = ...` on one line, then use `name` later.
5. EVERY variable (except root) MUST be referenced by at least one other variable. Unreferenced variables are silently dropped and will NOT render.
6. Arguments are POSITIONAL (order matters, not names). Write `SomeComp(arg1, arg2)` NOT `SomeComp(name: arg1, title: arg2)`.
7. Optional arguments can be omitted from the end. Strings use double quotes with backslash escaping.

## Component Signatures
- HireAgentCard(role: string, name: string, description: string, skills?: string) — Interactive confirmation card for creating and hiring a new agent into the bot fleet.
- Card(title: string, content?: string) — General container card for structured content.
- CardHeader(title: string, subtitle?: string) — Card header element with title and subtitle.
- FormField(label: string, value: string, placeholder?: string) — A labeled input field for data collection.
- ConfirmButtons(confirmLabel: string, cancelLabel: string) — A pair of confirm and cancel action buttons.

## Inline Mode Rules
- When the user asks for actions/proposals, output conversational text followed by the openui-lang code in a ```openui-lang``` block.
- When the user asks a simple question or engages in conversation, respond with text only — NO code.
- Always ask for confirmation before spooling or creating persistent resources.
```

