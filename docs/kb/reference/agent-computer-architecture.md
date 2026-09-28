---
type: reference
title: Agent Computer — architecture as built
description: The live shape of the GrokBot agent computer — host layer, one shared Linux container with per-agent X displays and workspaces, the web surface path, and the two ways agents drive it.
tags: [grokbot, agent-computer, architecture, docker, cua-driver]
timestamp: 2026-09-26T19:40:00Z
status: current
---

# Agent Computer — architecture as built

## The shape in one sentence

**One Linux machine, three screens.** One Docker container is the "one VM for everyone"; inside
it each agent gets its own X display, its own automation daemon, and its own workspace — plus one
shared directory they all collaborate through.

## Layers

```
┌─ HOST: Windows 11 (Ali's PC) ──────────────────────────────────────────────┐
│  Hermes profiles:  steve  ·  jim  ·  oscar     (identity, memory, secrets)  │
│  Web adapter:      FastAPI :9119  →  fleet separation + per-bot routing      │
│  UI:               React 19 + Astryx, served at bot.balacode.xyz            │
│  Helper CLI:       workspace/scripts/agent_computer.py                      │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ docker exec  (the only crossing point)
┌───────────────▼─ DOCKER: container `grokbot-computer` ─────────────────────┐
│  base: debian:bookworm-slim + Xvfb + openbox + Chromium   (image 1.44 GB)   │
│                                                                            │
│   :1  Steve   →  Xvfb + WM + cua-driver daemon  →  /run/cua-driver/steve.sock
│   :2  Jim     →  Xvfb + WM + cua-driver daemon  →  /run/cua-driver/jim.sock │
│   :3  Oscar   →  Xvfb + WM + cua-driver daemon  →  /run/cua-driver/oscar.sock
│                                                                            │
│   /workspace/steve   /workspace/jim   /workspace/oscar   /workspace/shared │
└────────────────────────────────────────────────────────────────────────────┘
```

## Key design decisions (and the constraint behind each)

1. **One container, not one VM per agent.** Ali's requirement; also the cheapest way to give
   everyone a shared filesystem for collaboration. Isolation is per-*screen*, not per-machine.
2. **One X display per agent — forced, not preferred.** `cua-driver` sessions are lifecycle
   labels, NOT displays: desktop targets bind to `display_id="primary"` and real input is
   single-pointer/single-keyboard. Multiple sessions on one display would fight over the mouse.
   Per-agent displays are the only way to get concurrent control.
3. **One driver daemon per display.** A single daemon cannot span displays, so each display runs
   its own `cua-driver serve --socket /run/cua-driver/<agent>.sock`.
4. **`debian:bookworm-slim`, not Alpine.** Alpine is smaller but musl libc fights the prebuilt
   Chromium and driver binaries — the size win is paid for in build friction.
5. **X11, not Wayland.** This build supports Wayland natively, but the container's Xvfb/X11 path
   is the reliable one; background (focus-free) keyboard input is unavailable on X11, so input
   escalates to `delivery_mode="foreground"` inside that agent's display only.
6. **Per-agent workspace + one shared directory.** `/workspace/<agent>` is the agent's own space;
   `/workspace/shared` is the collaboration surface — that is how they "control it together".

## The two ways an agent drives its computer

| Path | Transport | Works for |
|---|---|---|
| **Helper CLI** (`agent_computer.py`) | one-shot `docker exec cua-driver call …` | screen capture, windows/tree/apps, launch/open, type, key, hotkey, verify, recording, health, raw tool calls |
| **MCP session** (recommended for GUI work) | `docker exec -i … cua-driver mcp --socket …` held open | everything above **plus pointer clicks**, element tokens, per-session agent cursor |

**Measured constraint:** each one-shot `cua-driver call` is a **fresh authenticated transport
lease**. The accessibility snapshot and capture context die with that lease, so pointer clicks via
the CLI fail with `stale_element_token` / `capture_not_found`. Element-level automation therefore
requires a persistent MCP session. Everything else works one-shot — verified.

## Lifecycle

- Container restart policy `unless-stopped`; Docker Desktop is in the host logon Run key → the
  whole chain returns by itself after a reboot.
- `docker commit` on the container is the "Reset to last saved snapshot" behaviour (xAI's model).
- Per-agent trajectory recording is available per daemon (`rec start|stop|status`) — naturally
  per-agent because each agent has its own daemon.

## Policies (Ali, 2026-09-26)

1. **New agent → new workspace.** Whenever an agent is created, its own workspace must be
   created as well. Enforced structurally: the container's entrypoint reads the fleet manifest
   (`fleet/grokbot.json`) and provisions a display, a socket and `/workspace/<agent>` per agent.
   Adding an agent to the manifest is all that is needed.
2. **Default = the agent's own computer.** All interactions happen on the agent's own screen and
   workspace. The bots' `computer_use` toolset (which targets the Windows host) was removed from
   all three GrokBot profiles so this is structural, not a promise.
3. **Host access is opt-in.** If the user explicitly asks for something on *his* computer — save
   these files here, use the GitHub CLI I have installed — the agent may use the host. It is never
   the default.

## Verification

`workspace/susan/scripts/e2e_grokbot_surface.mjs` — **20/20**, including the assertion that the
three bots' frames are **distinct** (Steve `796a50c5d7cc`, Jim `0552faf89a77`, Oscar
`3b5b36879807`) and all served by the Linux container.

## Computer spaces per org (shipped 2026-09-26)

Every **organization gets its own agent computer** — own container, own displays, own driver sockets,
own workspaces. Isolation between orgs is therefore structural; the only path between them is an
explicit cross-org grant.

```
org balacode → container grokbot-computer          → steve:1 / jim:2 / oscar:3 + workspaces
org sandbox  → container agent-computer-sandbox    → tester:1 + workspace
```

Provision with `agent-computer/provision_org.sh <org-id>` (reads `fleet/<org>.json`; balacode still
uses the legacy `fleet/grokbot.json`). Both containers verified up with separate displays, sockets and
workspaces.

## Open items

- ~~Give the bots MCP sessions to their own daemons~~ — **done**, all three profiles carry an
  `agent_computer` MCP server and report `MCP: 64 tool(s) from 1 server(s)`.
- ~~Per-agent capability manifests~~ — **done**, every daemon runs bounded mode against a generated
  allow-list; admin tools are refused with `Permission denied: tool 'kill_app' is outside the
  capability manifest`.
- **AT-SPI is not connected** (`org.a11y.Bus was not provided by any .service files`) — the
  container lacks `at-spi2-core`, so the accessibility tree is degraded. Install it and element-level
  automation becomes far more reliable.
- Raise the Docker/WSL2 memory cap from 14 GiB of the host's 28.8 GiB before scaling up.

## E2E

**22/22**, including: each agent routed to its own display (`Steve=:1 Jim=:2 Oscar=:3`), 3/3
distinct frames, container reboot-proof, and the capability ceiling refusing admin tools.
