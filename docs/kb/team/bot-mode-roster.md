---
type: playbook
timestamp: 2026-09-25T22:56:39Z
title: GrokBot team on Hermes Bot Mode
description: How Steve, Jim and Oscar run as Hermes Bot Mode bots — roster, remote access, install steps, verified state, and the pitfalls that bit.
tags: [grokbot, hermes, bot-mode, team, infrastructure]
status: stable
generated: { by: susan/okf, at: 2026-09-25T21:20:00Z }
sources:
  - id: kit
    resource: https://github.com/thomasbek3/hermes-bot-kit
    title: Hermes Bot Kit (Grok Bot look for Hermes)
    last_modified: 2026-09-12
  - id: hermes-bot-mode
    resource: https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode
    title: Hermes Bot Mode docs
    last_modified: 2026-09-25
---

# GrokBot team on Hermes Bot Mode

The team runs as **Hermes profiles surfaced as Bots** — not custom plumbing. The hand-rolled
DeepSeek Harness rebuild was deleted 2026-09-25; Bot Mode is the replacement.

# The roster

| Bot | Profile | Title | Role |
|-----|---------|-------|------|
| Steve | `steve` | Chief of Staff | Runs the team, routes work, reviews, escalates founder calls to Ali |
| Jim | `jim` | Launch | Public surfaces: copy, channels, PH/HN/email, site conversion |
| Oscar | `oscar` | Research | Sourced answers, market reads, competitive scans |

Roster title/description live in `profiles/<name>/profile.yaml` under
`ui_meta['hermes-bots']` (`title`, `shape`, `color`). Channel identity = SOUL.md; the GrokBot
KB (`GrokBot/kb/`) is the team's fact source. Steve↔Jim↔Oscar message each other with
`message_agent` (injected only inside a canonical **Bot Chat** session).

# How to reach the UI

- **Mobile web (the phone client): https://bot.balacode.xyz** — the GrokBot surface: roster of
  Steve/Jim/Oscar, mobile-first PWA (installable to home screen), streaming chat. Backed by
  `workspace/grokbot-web/` — a FastAPI adapter on `:9119` that serves the PWA and proxies each
  turn as SSE to the bot's own Hermes **OpenAI-compatible API server** (`steve`:9121, `jim`:9122,
  `oscar`:9123; `API_SERVER_KEY` in each profile `.env`, enablement under
  `gateway.api_server.{enabled,host,port}`). Auth = the same dashboard basic-auth.
  The tunnel's `bot.balacode.xyz → localhost:9119` mapping is unchanged — the *app behind the
  port* changed from the dashboard to the bot surface.
- **Desktop roster**: Hermes Desktop **Bot Mode** (iMessage bubbles) — desktop-only by design.
- LAN backend: `hermes serve --host 0.0.0.0 --port 9119` → **http://192.168.86.38:9119**
- The exposed surface runs `hermes -p steve dashboard --isolated --host 0.0.0.0 --port 9119`
  (launcher: `workspace/susan/scripts/start_public_bot_dashboard.sh`), so **every call on the
  public surface burns the $50-capped OpenRouter key** held by `steve`/`jim`/`oscar` — never the
  main key. Containment is deliberate: the surface is scoped to Steve.
- Auth: username `ali` + the dashboard basic-auth password in `~/.hermes/.env`
  (`HERMES_DASHBOARD_BASIC_AUTH_*`). Gate verified end-to-end over the public internet:
  `/` → `302 /login`, unauthenticated RPC → `401`, login → `{"ok":true}`.
- Client: **Hermes Desktop** on any machine on the LAN, connected to that Remote URL.
  Bot-kit desktop plugins must be installed on the *client* machine too (they are app-level,
  `~/.hermes/desktop-plugins/`, not profile-scoped).
- Note the split: the **web dashboard is chat + ops pages**; the **iMessage-style Bot roster is
  desktop-only** (Bot Mode loads inside the desktop app, not the browser SPA).

# Install (repeatable)

```bash
# desktop plugins (Bubble Mode, Computer viewer, Bot Sections, Task Dock)
git -c core.autocrlf=false clone --depth 1 --branch v2026.09.12 \
  https://github.com/thomasbek3/hermes-bot-kit.git
TMPDIR=<native-path> bash bot-kit/install.sh
# texting-style (per-profile agent plugin)
HERMES_ROOT=<hermes home> HERMES_PYTHON=<venv python> \
  bash bot-kit/texting-style/install.sh --profiles steve,jim,oscar
```

# Verified (2026-09-25)

- Personas load: each bot answers as itself with its role and reporting line.
- Roster renders in the Desktop Bots view: **Chief of Staff / Launch / Research** under Unassigned.
- Bubble Mode **on**, Task Dock **on**; Computer pane present in the roster UI.
- Bot-to-bot handoff proven in the session stores: Steve → Oscar DM arrived in Oscar's Bot Chat,
  Oscar dispatched a reply via `message_agent`, Steve received "ACK from Oscar" and correctly did
  **not** ack-loop.

# Pitfalls (learned the hard way)

1. **The kit's installer assumes `$HOME/.hermes`.** This machine's home is
   `%LOCALAPPDATA%/hermes` — set `HERMES_HOME`/`HERMES_ROOT` or it writes to the wrong tree.
2. **`mktemp` + `node --check` breaks in MSYS.** The temp path arrives as `/tmp/...` and native
   node reads it as `C:\tmp\...`. Set `TMPDIR` to a native path (`C:/...`) before installing.
3. **`git clone` rewrites LF→CRLF and fails the sha256 manifest.** Clone with
   `-c core.autocrlf=false`, or the installer aborts on a digest mismatch.
4. **texting-style updater needs `HERMES_PYTHON`** pointing at the Hermes venv (PyYAML) — and
   `HERMES_ROOT`, not `HERMES_HOME`.
5. **Bot-to-bot messaging is gated on the session title `Bot Chat`** and on the install being
   Bot-Mode-managed. A plain CLI session never gets `message_agent`; the delivery path is
   `hermes -p <name> chat --in ~ -c "Bot Chat" --create-if-missing -Q`.
6. **Desktop UI automation on Windows needs DPI awareness.** At 150% scaling a DPI-unaware
   process's `SetCursorPos` lands 1.5× off. Set per-monitor-v2 awareness before clicking, and
   read element bounds from UI Automation (`--force-renderer-accessibility` if the AX tree is
   empty) rather than guessing pixel coordinates.
7. **A broken MCP server can wedge the app** on an OAuth prompt (bonsai did). Keep MCP servers
   healthy or disabled; the UI shows a persistent "MCP server unreachable" toast otherwise.
8. **`cloudflared tunnel login` cannot be finished from a phone.** Its callback must reach
   *the machine running cloudflared*; a phone browser's `localhost` is the phone, so the cert is
   never written and the command sits at "Waiting for login…" forever. Fix: either run the login
   on the target machine's own browser, or — better — **reuse an existing token-managed tunnel**
   by adding a Public Hostname in the Zero Trust dashboard. No cert, no token to paste, and it
   survives restarts since the config lives in Cloudflare, not on disk.

# Still open

- Visual capture of a bubble-styled Bot Chat (Bubble Mode is confirmed on; the screenshot pass
  is pending an app restart).
