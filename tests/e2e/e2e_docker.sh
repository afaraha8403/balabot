#!/usr/bin/env bash
# BalaBot Docker E2E harness.
#
# Runs against the REAL image with the REAL entrypoint. Do NOT swap in
# `--entrypoint sh` or similar: that skips the s6-overlay cont-init hooks
# (including 015-supervise-perms) and produces misleading failures like
# "Permission denied: .../profiles/<x>/cron" that have nothing to do with
# the code under test. This harness starts the container detached with a
# TTY and probes it via `docker exec`.
#
# Usage:
#   ./e2e_docker.sh [IMAGE_TAG]        (default: balabot:test)
#
# Optional environment:
#   OPENROUTER_API_KEY (or MODEL_API_KEY) — when set, a real model round-trip
#   is asserted (reply must contain BALABOT_OK). Without a key that step is a
#   clearly-labelled SKIP, never a silent pass.
#
# Never prints a key value. Safe to run repeatedly.
set -euo pipefail

IMAGE="${1:-balabot:test}"
CONTAINER="balabot-e2e-$$"
ENV_FILE="$(mktemp)"
# MSYS/git-bash: docker.exe is native and cannot read /tmp/... paths for
# --env-file (same class of issue as the build context). Normalise when we can;
# a no-op on Linux/macOS.
if command -v cygpath >/dev/null 2>&1; then ENV_FILE="$(cygpath -m "$ENV_FILE")"; fi
cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -f "$ENV_FILE"
}
trap cleanup EXIT

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
skip() { echo "SKIP: $*"; }

# ---------------------------------------------------------------------------
# (a) Build the image.
# ---------------------------------------------------------------------------
echo "== [1/5] Building image $IMAGE"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
# MSYS/git-bash: docker.exe is a native Windows binary and does NOT translate
# /c/... paths, so normalise to a Windows-style path where cygpath exists.
# On Linux/macOS this is a no-op.
build_ctx="$repo_root"
if command -v cygpath >/dev/null 2>&1; then build_ctx="$(cygpath -m "$repo_root")"; fi
docker build -t "$IMAGE" "$build_ctx"
pass "image built: $IMAGE"

# ---------------------------------------------------------------------------
# (b) Missing TYPESAFE_API_KEY must exit 1 with a loud message.
#     Jev is a HARD dependency; silent degradation is forbidden.
# ---------------------------------------------------------------------------
echo "== [2/5] Asserting hard dependency enforcement (no TYPESAFE_API_KEY)"
set +e
out="$(docker run --rm "$IMAGE" 2>&1)"
rc=$?
set -e
if [ "$rc" -ne 1 ]; then
    fail "container without TYPESAFE_API_KEY exited $rc (expected 1). Output was: $out"
fi
case "$out" in
    *HARD\ dependency*|*TYPESAFE_API_KEY*|*FATAL*) : ;;
    *) fail "missing-key run did not print a loud message about the hard dependency. Output was: $out" ;;
esac
pass "missing key exits 1 with a loud message"

# ---------------------------------------------------------------------------
# (c) Start via the REAL entrypoint, detached + TTY, and verify provisioning.
# ---------------------------------------------------------------------------
echo "== [3/5] Starting container via real entrypoint and verifying provisioning"
{
    echo "TYPESAFE_API_KEY=dummy-e2e-not-a-real-key"
    if [ -n "${OPENROUTER_API_KEY:-}" ]; then echo "OPENROUTER_API_KEY=$OPENROUTER_API_KEY"; fi
    if [ -n "${MODEL_API_KEY:-}" ]; then echo "OPENROUTER_API_KEY=$MODEL_API_KEY"; fi
} > "$ENV_FILE"

docker run -d -t --name "$CONTAINER" --env-file "$ENV_FILE" "$IMAGE" >/dev/null

# Wait for bootstrap (idempotent, runs on every start) to finish.
for _ in $(seq 1 30); do
    if docker exec "$CONTAINER" test -d /opt/data/profiles/principal 2>/dev/null; then
        break
    fi
    sleep 2
done

for persona in principal governor; do
    docker exec "$CONTAINER" test -d "/opt/data/profiles/$persona" \
        || fail "profile dir missing: /opt/data/profiles/$persona"
    for f in config.yaml SOUL.md; do
        docker exec "$CONTAINER" test -f "/opt/data/profiles/$persona/$f" \
            || fail "profile $persona missing $f"
    done
    docker exec "$CONTAINER" test -f "/opt/data/workspace/$persona/AGENTS.md" \
        || fail "persona $persona workspace missing AGENTS.md"
    docker exec "$CONTAINER" test -f \
        "/opt/data/profiles/$persona/skills/balabot/jev-signals/SKILL.md" \
        || fail "persona $persona missing installed skill skills/balabot/jev-signals/SKILL.md"
    pass "persona '$persona' provisioned correctly"
done

# ---------------------------------------------------------------------------
# (d) Principal config: holographic memory, empty telegram bot_token.
# ---------------------------------------------------------------------------
echo "== [4/5] Asserting forced config deltas on principal"
docker exec "$CONTAINER" python3 - <<'PY'
import sys, yaml
cfg = yaml.safe_load(open("/opt/data/profiles/principal/config.yaml"))
errs = []
if cfg.get("memory", {}).get("provider") != "holographic":
    errs.append(f"memory.provider={cfg.get('memory', {}).get('provider')!r}, expected 'holographic'")
if cfg.get("telegram", {}).get("bot_token") != "":
    errs.append("telegram.bot_token is not empty")
if errs:
    print("; ".join(errs)); sys.exit(1)
PY
pass "principal config: memory.provider=holographic, telegram.bot_token empty"

# ---------------------------------------------------------------------------
# (e) Optional live model round-trip (only with a real key in the env).
# ---------------------------------------------------------------------------
echo "== [5/5] Live model round-trip"
KEY="${OPENROUTER_API_KEY:-${MODEL_API_KEY:-}}"
if [ -z "$KEY" ]; then
    skip "no OPENROUTER_API_KEY/MODEL_API_KEY in environment — live round-trip not tested"
else
    # Send a prompt through the interactive CLI inside the running container.
    reply="$(docker exec -t "$CONTAINER" \
        env OPENROUTER_API_KEY="$KEY" \
        timeout 240 hermes --profile principal -z "Reply with exactly: BALABOT_OK" 2>&1 || true)"
    case "$reply" in
        *BALABOT_OK*) pass "live model replied containing BALABOT_OK" ;;
        *) fail "live round-trip did not return BALABOT_OK. Reply was: $reply" ;;
    esac
fi

echo "ALL E2E CHECKS PASSED (skips, if any, are labelled above)"
