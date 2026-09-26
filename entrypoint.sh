#!/bin/sh
# BalaBot entrypoint.
#
# Rule: FAIL LOUD, NEVER SILENTLY DEGRADE. A missing hard dependency aborts the
# container; it never produces a quietly-degraded agent.
set -eu

# ---------------------------------------------------------------------------
# (a) HARD DEPENDENCY — Jev (TypeSafe AI).
# Jev returns typed decisions with calibrated probabilities and BalaBot uses it
# as infrastructure (signals, memory relevance, the ledger gate). There is NO
# fallback provider by design. No key -> no start. No placeholder, no default.
# ---------------------------------------------------------------------------
if [ -z "${TYPESAFE_API_KEY:-}" ]; then
    echo "FATAL: TYPESAFE_API_KEY is not set." >&2
    echo "" >&2
    echo "Jev is a HARD dependency of BalaBot and there is no fallback provider." >&2
    echo "Refusing to start a silently degraded system." >&2
    echo "Put it in your .env (see .env.example) and retry." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# (b) First boot — provision the two personas.
#
# Delegated to the Python module so there is ONE source of truth for
# provisioning (a second shell implementation drifted before: it wrote only
# TYPESAFE_API_KEY and left the model provider unconfigured, and it installed
# skills flat where Hermes cannot discover them).
#
# Two Hermes behaviours this depends on, both silent when wrong:
#   1. A persona's rules file (.hermes.md / AGENTS.md) is found by walking UP
#      from the runtime cwd (terminal.cwd), NOT read from the profile dir.
#      A rules file at the profile root is SILENTLY IGNORED.
#   2. Skills are discovered as skills/<category>/<skill>/SKILL.md. Copied
#      flat, the skill simply never appears.
# ---------------------------------------------------------------------------
echo "[balabot] Provisioning personas (idempotent)..."
python3 -m balabot.bootstrap

# ---------------------------------------------------------------------------
# (c) Hand off to the official Hermes entrypoint.
#
# exec preserves PID 1, which /opt/hermes/docker/entrypoint-dispatch.sh checks
# (`$$ -eq 1`) before delegating to s6-overlay's /init. Running our own process
# supervisor here instead would cost the supervision tree AND leave PID 1
# unreaped.
# ---------------------------------------------------------------------------
exec /opt/hermes/docker/entrypoint-dispatch.sh "$@"
