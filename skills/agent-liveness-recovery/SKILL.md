---
name: agent-liveness-recovery
description: Use when you need to know whether an agent is working, idle, stuck or frozen, or to restart one that looks dead.
---

# Agent liveness and recovery

You are the system operator. "Is this agent alive?" is a question you answer from
a **live check**, never from a status file.

## Liveness

- **`gateway status` can lie after a crash** — it reports what was recorded, not
  what is running. Trust a **live process query** (is the process there, does it
  hold its port, does it answer).
- Distinguish four states, and say which one you found:
  - **working** — actively processing.
  - **idle** — up, no work. This is healthy, not a fault.
  - **stuck** — up, holding a turn that will not finish.
  - **frozen** — process gone or not answering.
- A bot that is *quiet* is not a bot that is *down*. Check before alarming the
  owner — a false alarm costs more trust than a late one.

## Recovery

- `gateway run --replace` is the **safe recovery primitive** — it stomps stale
  locks and pid files. Reach for it before inventing a kill sequence.
- Restart **one** specific agent, not the fleet. A fleet-wide bounce to fix one
  agent takes down every other agent's in-flight work.
- Report an intentionally stopped or unconfigured agent as **dormant**, not
  **down**. `down` reads as an outage when it is the designed resting state.

## Reporting

State, then action, then ask. Never narrate an intention as though it were a
result — "restarting" is not "restarted". Confirm the process is back before you
say it is.
