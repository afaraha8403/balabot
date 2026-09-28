---
type: playbook
title: Agent Computer — one Linux VM, per-agent displays and workspaces
description: Design for the GrokBot agent computer — one shared Linux environment where each agent gets its own X display, its own cursor and its own workspace, with a shared area so they can work on each other's output.
tags: [grokbot, agent-computer, linux, docker, cua-driver, design]
timestamp: 2026-09-26T16:05:00Z
status: active
---

# Agent Computer — one Linux VM, per-agent displays and workspaces

Ali's requirement: **one VM for everyone; each agent has its own workspace inside it; they must be
able to control it together** — each interacting with his own part of the desktop. Linux-based,
smallest viable. Research the original first, then build.

## What the original does (xAI, from their own docs)

- **One shared computer per account** — not a VM per bot. "Each Bot gets its own **screen on the
  shared computer**. Several Bots can therefore use browser and desktop tools **in parallel**,
  although one Bot can run only one computer-use task on its screen at a time."
- "The screens are separate work surfaces, **not separate security boundaries**."
- Browser cookies and sign-ins are **shared** across bots.
- **Lifecycle is snapshot-based:** "Reset rebuilds the computer from your last saved snapshot."
- No distro is published. The nearest open-source stack — trycua/cua, the project our `cua-driver`
  comes from (MIT) — documents **Ubuntu containers** (reference 24.04) or full VMs through
  **Docker / QEMU / Apple VZ**, and shows *two driver sessions driving LibreOffice and Inkscape on
  one Linux desktop concurrently*.

**Conclusion: one machine + per-agent screens + shared filesystem is the correct model. We match it.**

## The hard constraint (measured, not assumed)

`cua-driver` sessions are **lifecycle labels, not displays**:

- Session scope = agent cursor (theme/motion/visibility), lifecycle cleanup, and capture modality.
- **Desktop targets are bound to `display_id="primary"`** — "platforms that cannot address another
  display reject it explicitly".
- Real input (click / type_text / press_key) is **single-pointer, single-keyboard on one display**.
  Two agents driving one desktop would fight for the pointer.
- Wayland-native input is **off** in this build → **X11 only** (Xvfb/Xorg).
- AT-SPI (the accessibility tree) needs a **D-Bus session bus** — bare headless containers without
  one run degraded.

**Therefore: per-agent concurrent control requires per-agent X displays.** One driver instance
cannot span displays, so each display gets its own driver daemon (separate `--socket`).

## Design

```
ONE Linux environment  (Docker container on the existing WSL2 VM — "one VM for everyone")
├── display :1  → steve   ── own Xvfb + WM + own cua-driver daemon/socket
├── display :2  → jim     ── own Xvfb + WM + own cua-driver daemon/socket
├── display :3  → oscar   ── own Xvfb + WM + own cua-driver daemon/socket
├── /workspace/steve      ← each agent's own files
├── /workspace/jim
├── /workspace/oscar
└── /workspace/shared     ← the "control it together" surface: any agent can read/write here
```

- **Per-agent screen** = separate Xvfb display ⇒ true concurrent input, no pointer fights, and it is
  exactly Grok Bot's "own screen on the shared computer".
- **Per-agent workspace** = a directory each, plus a shared directory for collaboration.
- **Collaboration** = shared filesystem + the existing `message_agent` handoff. An agent can open
  another agent's file from `/workspace/<peer>/` and edit it.
- **Lifecycle** = `docker commit` / image tag for the "Reset to snapshot" behaviour.

## Base image — "smallest that actually works"

**`debian:bookworm-slim` (already pulled locally, 116 MB) + Xvfb + openbox + Chromium.**

Why not Alpine (the genuinely smallest): musl libc fights the prebuilt Chromium and driver binaries;
you pay for the size win in build friction. No full desktop environment (Xfce/GNOME) — Xvfb plus a
tiny WM is the minimum that gives a real display. Expect roughly **0.7–1.2 GB** total, which is the
honest floor for "X server + browser + automation driver".

## Host capacity (measured)

- AMD Ryzen 5 7640HS, 6c/12t, **28.8 GiB RAM** total — but the **Docker/WSL2 VM is capped at 14 GiB**;
  raise it before running several GUI containers.
- Docker 29.2.1 (WSL2 backend) running; `debian:bookworm-slim` and `alpine/curl` already pulled.
- WSL2 Ubuntu already running (153 GB vhdx); VirtualBox 7.2.6 with 4 existing VMs; ~512 GB free on C:.
- **No Linux cua-driver binary is installed** — only `0.29.1-x86_64-pc-windows-msvc`. The Linux
  build must be fetched into the image.

## Build steps

1. Image: debian-slim + dbus-x11 + xvfb + openbox + chromium + fonts + the Linux cua-driver binary.
2. Entrypoint: start a session D-Bus, then per agent an Xvfb display, a WM, and a driver daemon on
   its own socket; create `/workspace/<agent>` and `/workspace/shared`.
3. Backend: the GrokBot web server routes each bot's `/api/computer/*` to **its own** display/socket
   instead of the Windows primary display (fleet manifest gains display + socket per agent).
4. UI: unchanged contract — the pane still polls `/api/computer/{bot}/frame`, now showing that bot's
   own screen.
5. Verify + snapshot: two displays driven concurrently with different content; `docker commit` as the
   reset point; E2E extended to assert per-bot frames are *different* screens.

## Guardrails

- Never bake credentials into the image; secrets stay in each profile's `.env` on the host.
- The Windows desktop is no longer the agent computer — this replaces that exposure.
- Per-agent workspace dirs are the convention; the shared dir is the collaboration surface.
