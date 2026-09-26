#!/usr/bin/env bash
# E2E: the baked-in Cloudflare tunnel is DORMANT by default and never leaks its token.
#
# Runs against the REAL image through the REAL entrypoint. Do NOT swap in
# `--entrypoint sh`: that skips the s6 cont-init hooks and produces misleading
# failures unrelated to the code under test (same rule as e2e_docker.sh).
#
# Proves three things that are otherwise just claims:
#   1. With no token the tunnel is dormant — the s6 slot reports DOWN, no
#      cloudflared process exists, and nothing is exposed.
#   2. With a token the service starts, and the token value appears in NEITHER
#      the container log NOR any process command line.
#   3. A token supplied as a mounted FILE works, and an unreadable token file is
#      reported loudly instead of being mistaken for dormancy.
#
# Usage: ./verify_tunnel.sh [IMAGE_TAG]        (default: balabot:tunnel)
set -uo pipefail

IMAGE="${1:-balabot:tunnel}"
SENTINEL="SENTINEL_TUNNEL_TOKEN_DO_NOT_LEAK_9f3a1c"
IMAGE_VERSION="2026.9.3"
FAILS=0

ENV_FILE="$(mktemp)"
# A DIRECTORY containing the token file — the real Docker-secrets shape.
# Mounting a single file via -v is unreliable on Docker Desktop for Windows
# (it materialises the source path as a directory), and /run/secrets is a
# directory in every real platform anyway.
SECRET_DIR="$(mktemp -d)"
printf '%s\n' "$SENTINEL" > "$SECRET_DIR/cloudflare_token"
if command -v cygpath >/dev/null 2>&1; then
    ENV_FILE="$(cygpath -m "$ENV_FILE")"
    SECRET_DIR="$(cygpath -m "$SECRET_DIR")"
fi

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*" >&2; FAILS=$((FAILS + 1)); }

cleanup() {
    docker rm -f balabot-tunnel-dormant balabot-tunnel-token balabot-tunnel-file >/dev/null 2>&1 || true
    rm -f "$ENV_FILE"
    rm -rf "$SECRET_DIR"
}
trap cleanup EXIT
# Clear stale containers from a previous run — but do NOT call cleanup() here:
# it would delete the freshly-created secret dir before it is ever mounted, and
# the "mounted file" case would then fail for a reason that has nothing to do
# with the service.
docker rm -f balabot-tunnel-dormant balabot-tunnel-token balabot-tunnel-file >/dev/null 2>&1 || true

# start_container <name> [extra env line ...]
start_container() {
    local name="$1"; shift
    {
        echo "TYPESAFE_API_KEY=dummy-e2e-not-a-real-key"
        for line in "$@"; do echo "$line"; done
    } > "$ENV_FILE"
    docker run -d -t --name "$name" --env-file "$ENV_FILE" "$IMAGE" >/dev/null || return 1
    for _ in $(seq 1 30); do
        if docker exec "$name" test -e /run/service/cloudflared 2>/dev/null; then return 0; fi
        sleep 2
    done
    return 1
}

# count processes whose /proc/<pid>/comm equals <name> (no ps(1) needed)
proc_count() {
    docker exec "$1" sh -c 'for p in /proc/[0-9]*; do [ -r "$p/comm" ] && cat "$p/comm"; done' 2>/dev/null \
        | grep -c "^$2\$"
}

# count process command lines (argv) containing <needle>
argv_hits() {
    docker exec "$1" sh -c 'for p in /proc/[0-9]*; do [ -r "$p/cmdline" ] && tr "\0" " " < "$p/cmdline" && echo; done' 2>/dev/null \
        | grep -c "$2"
}

echo "== [1/4] Image carries the pinned cloudflared"
# --entrypoint here is deliberate and safe: this checks the BINARY, not the
# service, so skipping the Balabot entrypoint (and its Jev check) is intended.
ver="$(docker run --rm --entrypoint /usr/local/bin/cloudflared "$IMAGE" --version 2>&1 | tr -d '\r')"
case "$ver" in
    *"$IMAGE_VERSION"*) pass "cloudflared version is the pinned $IMAGE_VERSION" ;;
    *) fail "cloudflared --version did not report $IMAGE_VERSION (got: $ver)" ;;
esac

echo "== [2/4] DORMANT with no token"
if ! start_container balabot-tunnel-dormant; then
    fail "container did not start (dormant case)"
else
    logs="$(docker logs balabot-tunnel-dormant 2>&1)"
    case "$logs" in
        *DORMANT*) pass "log states the tunnel is dormant" ;;
        *) fail "log did not state dormancy" ;;
    esac

    svstat="$(docker exec balabot-tunnel-dormant /command/s6-svstat /run/service/cloudflared 2>&1 | tr -d '\r')"
    case "$svstat" in
        down*) pass "s6 slot reports DOWN ($svstat)" ;;
        *) fail "s6 slot should be down when dormant, got: $svstat" ;;
    esac

    n="$(proc_count balabot-tunnel-dormant cloudflared)"
    if [ "$n" -eq 0 ]; then pass "no cloudflared process is running"; else fail "$n cloudflared process(es) running while dormant"; fi
fi

echo "== [3/4] Token via environment — starts, and the value never leaks"
if ! start_container balabot-tunnel-token "CLOUDFLARE_TUNNEL_TOKEN=$SENTINEL"; then
    fail "container did not start (token case)"
else
    logs="$(docker logs balabot-tunnel-token 2>&1)"
    case "$logs" in
        *"token present"*) pass "log states a token is present" ;;
        *) fail "log did not report the tunnel starting" ;;
    esac

    # THE security assertion: the secret value must appear nowhere in the log.
    if printf '%s' "$logs" | grep -q "$SENTINEL"; then
        fail "TOKEN LEAKED into the container log"
    else
        pass "token value does NOT appear in the container log"
    fi

    if [ "$(argv_hits balabot-tunnel-token "$SENTINEL")" -eq 0 ]; then
        pass "token value does NOT appear in any process command line"
    else
        fail "TOKEN LEAKED into a process command line"
    fi
fi

echo "== [4/4] Token via mounted file — works, and an unreadable file is reported"
if ! start_container balabot-tunnel-file "CLOUDFLARE_TUNNEL_TOKEN_FILE=/nonexistent/token"; then
    fail "container did not start (token-file case)"
else
    logs="$(docker logs balabot-tunnel-file 2>&1)"
    case "$logs" in
        *"not readable"*)
            pass "an unreadable token file is reported loudly, not treated as dormancy" ;;
        *) fail "unreadable token file was not reported (log said dormancy instead?)" ;;
    esac
fi

# and the mounted-directory happy path (the real Docker-secrets shape)
docker rm -f balabot-tunnel-file >/dev/null 2>&1 || true
{
    echo "TYPESAFE_API_KEY=dummy-e2e-not-a-real-key"
    echo "CLOUDFLARE_TUNNEL_TOKEN_FILE=/run/secrets/cloudflare_token"
} > "$ENV_FILE"
if docker run -d -t --name balabot-tunnel-file \
        --env-file "$ENV_FILE" \
        -v "${SECRET_DIR}:/run/secrets:ro" \
        "$IMAGE" >/dev/null 2>&1; then
    for _ in $(seq 1 30); do
        docker logs balabot-tunnel-file 2>&1 | grep -q "token present" && break
        sleep 2
    done
    logs="$(docker logs balabot-tunnel-file 2>&1)"
    case "$logs" in
        *"token present"*) pass "token supplied as a mounted file starts the tunnel" ;;
        *) fail "mounted token file did not start the tunnel" ;;
    esac
    if printf '%s' "$logs" | grep -q "$SENTINEL"; then
        fail "TOKEN LEAKED into the log (file path)"
    else
        pass "mounted-file token does NOT appear in the log"
    fi
else
    fail "could not start the container with a mounted token file"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "ALL TUNNEL E2E CHECKS PASSED"
    exit 0
fi
echo "$FAILS tunnel E2E check(s) FAILED"
exit 1
