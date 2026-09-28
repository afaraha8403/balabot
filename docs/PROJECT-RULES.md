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

These extend the Balakit base rules (`AGENTS.md` managed block) with the things this repo has
actually cost us. On conflict: secrets & safety > correctness > the rules below > Balakit base.

## 1. Which Hermes you are touching

This repo drives the **BalaBot container** (`balabot-balabot-1`, `HERMES_HOME=/opt/data`).
Your own agent's Hermes home (`~/AppData/Local/hermes` on this machine) is **a different instance** —
never fix a BalaBot bug by editing your own profile tree. Run
`bash workspace/susan/scripts/which-hermes.sh` before writing to any Hermes path.

- `/opt/balabot/**` is **image-baked** (not a mount). To test a python change without an image
  rebuild: `docker cp` the file in, then import it in-container.
- `/opt/data` is the **only** volume: profiles, per-agent memory, ledger, workspace, rules.

## 2. The KB is the spec

`docs/kb/` is a verbatim mirror of the product knowledge bundle and is the **master spec**: where the
code disagrees with a plan, the **code** changes. The only override is a hard platform constraint.
`docs/STATUS.md` is the **single source of honest status** — never re-assert a wave is shipped
without a call-site check. `docs/overall_plan.md` indexes the whole bundle.

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

- The product UI on `:9119` is served by a **HOST process** reading `ui/dist` from disk —
  **`npm run build` IS the deploy**; no restart needed. A **container rebuild does NOT update the
  site**.
- Persona/plugin behaviour changes need the **gateway restarted** (plugin code loads at process
  start): `kill <pid>; setsid hermes gateway run --replace` — ask the owner first; it drops every
  bot briefly.
- The Cloudflare tunnel is **shared**: add hostnames, never create a second tunnel.

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

- **Agent Computer**: a take-over reaches exactly the bot that asked — never another agent's display,
  never `/workspace/shared`, never the host desktop. No intervention screenshots in logs (captchas
  are where credentials appear).
- **Orgs**: cross-org grants are explicit, named, revocable; nothing crosses orgs implicitly.
- The **Hermes dashboard is never exposed**; the product surface is the only public app.
- **Consent before creation**: nothing is created without explicit human approval, and a bot never
  approves its own proposal.

## 12. Git

- Conventional commits; **commit often, sync often** — small, landed, pushed beats one big drop.
- This clone's local branch is `master` while the remote default is `main`, and it tracks it:

  ```bash
  git push origin master:main
  ```

- Commit only your own paths — never sweep a sibling's in-flight edits into your commit.
- `docs/kb/` mirrors an external bundle; when the bundle changes, re-sync it deliberately.
