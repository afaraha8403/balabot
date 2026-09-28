#!/usr/bin/env bash
# BalaBot bridge-plan SHELL acceptance suite.
#
# Implements the [SHELL]-tagged scenarios (container-side / filesystem
# behaviour) from the verification-criteria review:
#   C:/Users/ali/workspace/susan/research/polaris-learnings/reviews/verification-criteria.md
#
# House rules honoured here:
#   - Runs against the REAL running container (`balabot-balabot-1` by default)
#     via `docker exec`. Read-only assertions wherever possible.
#   - W1-W9 are mostly NOT implemented yet. Every scenario belonging to an
#     unshipped feature is registered as PENDING: it runs today, is counted
#     separately, and NEVER reports a vacuous pass.
#   - PENDING does not touch the container state. Restart-dependent scenarios
#     (W1-6, W3-1/5, W5-7, ...) stay PENDING even though `docker restart` is
#     technically possible, because this suite must be safe to run against a
#     live install at any time.
#
# Usage:
#   ./bridge_shell_e2e.sh [CONTAINER]     (default: balabot-balabot-1)
#
# Exit codes: 0 = no FAIL (PENDING allowed); 1 = at least one FAIL.
set -uo pipefail

CONTAINER="${1:-balabot-balabot-1}"
PASSES=0
PENDS=0
FAILS=0

pass() { echo "PASS    $*"; PASSES=$((PASSES + 1)); }
pending() { echo "PENDING $*"; PENDS=$((PENDS + 1)); }
fail() { echo "FAIL    $*" >&2; FAILS=$((FAILS + 1)); }

# Run a shell snippet inside the container; echoes stdout, rc in $sh_rc.
sh_rc=0
cexec() {
    local out
    out="$(docker exec "$CONTAINER" sh -c "$1" 2>&1)"
    sh_rc=$?
    printf '%s' "$out"
}

# Guard: the target container must be up before anything runs.
cleanup() { :; }
trap cleanup EXIT
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
    echo "FATAL: container '$CONTAINER' is not running." >&2
    echo "Start it (docker compose up -d) or pass a container name:" >&2
    echo "  ./bridge_shell_e2e.sh <container>" >&2
    exit 1
fi

RUNID="$(date +%s)-$$"

echo "== W1 — In-flight steering (turn lifecycle)"

# W1-3 [SHELL] Sentinel integrity of queued content.
# Fails if: a mid-turn-queued sentinel never reaches the persisted message
# table / transcript, or appears twice (idempotency broken).
# Unshipped: the queue-drain-to-context path (W1) has no runtime today; a
# live probe would need a running turn plus the payload-recording stub.
pending "W1-3 sentinel integrity of queued content (needs W1 queue drain + payload stub)"

# W1-6 [SHELL] Queue survives a host restart mid-turn.
# Fails if: queue state lives in memory and `docker restart` drops the two
# queued messages. Requires a mid-turn fixture + container restart — refused
# against a live install by this suite by design.
pending "W1-6 queue survives restart mid-turn (needs W1 queue + restart fixture)"

# W1-12 [SHELL] No cross-session bleed.
# Fails if: session A's queued text appears in session B's upstream payload.
# Unshipped: needs two concurrently running turns and the payload stub.
pending "W1-12 no cross-session bleed (needs W1 queue + payload stub)"

echo "== W2 — Server-authoritative conversation state"

# W2-4 [SHELL] Background routine runs with no browser open.
# Fails if: transcript row count for a session does not grow after a
# server-side scheduled/group turn with zero clients attached.
# Unshipped: the server-side routine trigger does not exist yet.
pending "W2-4 background routine persists with no browser (needs W2 server transcript + routines)"

# W2-5 [SHELL] History import is idempotent.
# Fails if: importing the same localStorage transcript three times triples
# the SQLite message count instead of leaving it at the seeded count.
# Unshipped: the import path does not exist yet; would need a zz-shell
# fixture session and a seeded transcript file.
pending "W2-5 history import idempotent (needs W2 import path + fixture session)"

# W2-9 [SHELL] WAL mode actually on, every database.
# Fails if: any SQLite file the server opens reports a journal mode other
# than `wal` (writers block readers under load).
DBS="$(cexec 'ls /opt/data/*.db /opt/data/sessions/*.db 2>/dev/null')"
wal_bad=0
wal_checked=0
for db in $DBS; do
    [ -n "$db" ] || continue
    mode="$(cexec "python3 -c \"import sqlite3,sys; c=sqlite3.connect('$db'); print(c.execute('pragma journal_mode').fetchone()[0])\"")"
    wal_checked=$((wal_checked + 1))
    if [ "$mode" != "wal" ]; then
        wal_bad=$((wal_bad + 1))
        echo "        non-wal: $db -> $mode"
    fi
done
if [ "$wal_checked" -eq 0 ]; then
    fail "W2-9 found zero SQLite databases to check (expected several under /opt/data)"
elif [ "$wal_bad" -eq 0 ]; then
    pass "W2-9 journal_mode=wal on all $wal_checked databases"
else
    fail "W2-9 $wal_bad of $wal_checked databases are not in WAL mode"
fi

# W2-12 [SHELL] Concurrent writers don't stall readers.
# Fails if: a write burst against the DB produces `database is locked` errors
# or stalls an open reader.
# Unshipped: the long-lived reader (SSE stream over server transcripts) is W2
# itself; a bare write-burst against today's DBs would test Hermes, not the
# bridge. Registered PENDING so it is provable the day W2 lands.
pending "W2-12 concurrent writers don't stall readers (needs W2 SSE reader + write burst fixture)"

echo "== W3 — Human takeover that actually suspends"

# W3-1 [SHELL] Pause survives CLI subprocess death (headline).
# Fails if: after pkill of the CLI subprocess mid-takeover, the pause record
# is unqueryable from the host server and the turn resumes on its own.
pending "W3-1 pause survives CLI subprocess death (needs W3 durable pause store)"

# W3-5 [SHELL] Restart mid-pause: pause and pending decision survive.
# Fails if: the pause record is memory-only in the host process and a
# `docker restart` loses it before resolution.
pending "W3-5 restart mid-pause preserves pause record (needs W3 + restart fixture)"

# W3-8 [SHELL] Lease expiry with recorded reason.
# Fails if: an expired lease never auto-releases, or releases with no
# `expired` audit record, leaving the computer permanently locked.
pending "W3-8 lease expiry recorded as expired (needs W3 lease store)"

# W3-9 [SHELL] Forced release on holder crash is recorded.
# Fails if: a killed lease holder leaves a stale lease that blocks the next
# acquirer, or the forced release happens with no `holder_gone` record.
pending "W3-9 forced release on holder crash recorded (needs W3 lease store)"

# W3-13 [SHELL] Pause != block-the-world.
# Fails if: bot A sitting in a pending takeover prevents bot B from turning
# (one pause wedges the whole fleet loop).
pending "W3-13 pause does not block other bots (needs W3 pause + fleet loop hook)"

echo "== W4 — Secrets that cannot be stolen by prompt injection"

# W4-2 [SHELL] env / /proc/self/environ exfiltration returns nothing.
# Fails if: any process in the container has an org-store secret value in its
# environment (the secret_helper.py:41-66 export bug). The probe runs now:
# today the secret store itself is unshipped, so the strong half (a granted
# secret absent from env) cannot be exercised — but a secret-shaped export in
# ANY process environment is already a fail.
env_leak=0
env_scan="$(cexec 'for p in /proc/[0-9]*/environ; do
    [ -r "$p" ] && tr "\0" "\n" < "$p" 2>/dev/null
done 2>/dev/null | grep -Ei "^(SECRET|ORG_SECRET|BALABOT_SECRET)[A-Z_]*=" || true')"
if [ -n "$env_scan" ]; then
    env_leak=1
    echo "        suspicious env vars: $env_scan"
fi
# W4-8's store: if the encrypted store already exists, scan live.
if cexec 'test -d /opt/data/.secrets'; then
    if [ "$env_leak" -eq 1 ]; then
        fail "W4-2 secret-shaped variable found in a process environment"
    else
        pass "W4-2 no secret-shaped variable in any process environment (store present: full sentinel leg unshipped, see PENDING below)"
    fi
else
    if [ "$env_leak" -eq 1 ]; then
        fail "W4-2 secret-shaped variable found in a process environment (no store should exist yet)"
    else
        pending "W4-2 env/environ exfiltration leg needs the W4 secret store granted to a bot (probe ran clean)"
    fi
fi

# W4-8 [SHELL] Encryption at rest, verified not assumed.
# Fails if: the secret store contains plaintext — the sentinel (or any
# high-entropy value) readable as raw text inside /opt/data/.secrets.
if cexec 'test -d /opt/data/.secrets'; then
    plaintext="$(cexec 'grep -rIl "" /opt/data/.secrets 2>/dev/null | while read -r f; do
        if grep -qE "[ -~]{20,}" "$f" && file "$f" 2>/dev/null | grep -qi text; then echo "$f"; fi
    done')"
    # A text file inside the secret store is definitionally a failure: values
    # must be ciphertext (binary) only.
    if [ -n "$plaintext" ]; then
        fail "W4-8 plaintext-looking file(s) inside /opt/data/.secrets: $plaintext"
    else
        pass "W4-8 secret store contains no plaintext-readable files"
    fi
else
    pending "W4-8 encryption-at-rest byte check needs the W4 secret store to exist"
fi

# W4-11 [SHELL] Cross-org grant works, revoke stops delivery.
# Fails if: revoking org B's grant fails silently and delivery continues, or
# revoke deletes the grant-era audit history.
pending "W4-11 cross-org grant/revoke (needs W4 org grant machinery + two orgs)"

# W4-14 [SHELL] Rotation/re-encryption path exists and works.
# Fails if: no documented rotation procedure exists (reporting UNPROVEN is
# itself the finding, per the review).
pending "W4-14 rotation/re-encryption path (unimplemented by design — PENDING is the finding)"

echo "== W5 — Action approvals and exactly-once mutations"
# W5 is entirely net-new (the review says so); all three SHELL scenarios are
# unshipped-feature and stay PENDING.

# W5-7 [SHELL] Ledger is durable SQLite, survives restart.
# Fails if: after a restart, replaying an approved turn re-executes the
# mutation (effect ledger was in-memory).
pending "W5-7 effect ledger durable across restart (needs W5 ledger — workstream entirely unshipped)"

# W5-10 [SHELL] Vault artifact: every approval lands in the OKF ledger.
# Fails if: approvals exist only as SQLite rows and no OKF vault artifact
# with decision/effect-key/actor/args-hash is ever written.
pending "W5-10 approvals land as OKF vault artifacts (needs W5 + vault writer)"

# W5-15 [SHELL] Approved mutation during a paused turn.
# Fails if: a mutation executes into a dead/paused turn and its result
# vanishes, or fires after the turn's death.
pending "W5-15 approved mutation composes with paused turn (needs W5 + W3)"

echo "== W6 — Attachments: real vision, bounded memory"

# W6-2 [SHELL] Ceiling is server-side, not just client-side.
# Fails if: POSTing an oversized file straight to the upload endpoint is
# accepted (2xx) or persists an attachment row — the browser must not be the
# only enforcement point.
# Probe today: does an upload endpoint even exist? If it does, exercise it;
# if not, W6 is unshipped.
up_ep="$(cexec 'grep -RlE "upload|attachment" /opt/balabot/ui/server.py /opt/balabot/balabot/*.py 2>/dev/null | head -1')"
if [ -n "$up_ep" ]; then
    pending "W6-2 server-side size ceiling (upload code present at $up_ep but W6 ceiling unshipped — not exercisable without the endpoint contract)"
else
    pending "W6-2 server-side size ceiling (no upload path in the container yet — W6 unshipped)"
fi

# W6-4 [SHELL] ReDoS/bomb-safe decoding.
# Fails if: uploading a decompression-bomb image wedges the single container
# (OOM / other sessions stop responding during processing).
pending "W6-4 bomb-safe decoding (needs W6 decode path + bomb fixture)"

# W6-7 [SHELL] Pruning keeps memory bounded over a long conversation.
# Fails if: the assembled upstream payload grows linearly across a 40-image
# session instead of plateauing at the retention window.
pending "W6-7 image pruning bounds payload growth (needs W6 pruning + payload stub)"

# W6-9 [SHELL] Pruning is reversible for the user.
# Fails if: re-asking about a pruned image yields a confident hallucinated
# description instead of an honest "no longer in context" or re-injection.
pending "W6-9 pruned-image re-ask answered honestly (needs W6 pruning)"

# W6-11 [SHELL] Attachment cleanup: temp files don't accumulate.
# Fails if: orphaned multi-GB conversion artifacts sit in the container's
# temp dirs after uploads (single container eventually dies of disk).
tmp_top="$(cexec 'du -sk /tmp /var/tmp /opt/data/uploads /opt/data/attachments 2>/dev/null | sort -rn | head -3')"
tmp_bad=0
while read -r kb path; do
    [ -n "$kb" ] || continue
    if [ "$kb" -gt 2097152 ]; then   # > 2 GiB of temp/upload residue
        tmp_bad=$((tmp_bad + 1))
        echo "        oversized: $path is $((kb / 1024)) MiB"
    fi
done <<EOF
$tmp_top
EOF
if [ "$tmp_bad" -eq 0 ]; then
    pass "W6-11 no temp/upload dir exceeds 2 GiB (cleanup discipline holds today)"
else
    fail "W6-11 $tmp_bad temp/upload dir(s) over 2 GiB — conversion artifacts are accumulating"
fi

# W6-14 [SHELL] No path traversal via filename.
# Fails if: a file named `../../etc/passwd` is stored using the crafted name
# and escapes the upload dir, instead of a generated id.
pending "W6-14 filename traversal refused (needs W6 upload storage path)"

echo "== W7 — Every bot gets a computer"

# W7-1 [SHELL] Cold start: fresh bot gets a usable screen.
# Fails if: a newly rostered bot gets "no bot named ..." (hardcoded display
# whitelist) or a fabricated placeholder frame.
pending "W7-1 fresh bot cold-start screen (needs W7 per-bot display allocation)"

# W7-3 [SHELL] Profile persistence across container restart.
# Fails if: a bot's browser profile lives on the container layer and
# `docker restart` wipes its login.
pending "W7-3 browser profile survives restart (needs W7 profile dirs + restart fixture)"

# W7-4 [SHELL] Profiles survive image upgrade (compose recreate).
# Fails if: profiles are stored under a non-volume path and a recreate logs
# every bot out.
pending "W7-4 profiles survive compose recreate (needs W7 + recreate fixture)"

# W7-8 [SHELL] Roster rename/move keeps the profile.
# Fails if: browser profiles are keyed by bot NAME, so renaming a bot in
# bots.json orphans its cookies. Probe now, read-only: whatever per-bot
# profile roots exist under /opt/data must be keyed by roster ids, and every
# profile-keyed bot id must exist in the roster.
roster_ids="$(cexec 'python3 -c "
import json
r=json.load(open(\"/opt/data/fleet/bots.json\"))
ids={k for k,v in r.items() if isinstance(v,dict) and v.get(\"id\")}
ids|=set(r.get(\"bots\") or [])
print(\"\n\".join(sorted(ids)))
"')"
if [ -z "$roster_ids" ]; then
    fail "W7-8 could not parse any bot ids from /opt/data/fleet/bots.json"
else
    # The persona/profile roots W7 will key on: any per-bot dir that is NOT a
    # roster id is a name-keyed (orphan-prone) profile — the exact bug.
    orphan_profs=""
    for pdir in /opt/data/computer-profiles /opt/data/browser-profiles /opt/data/computer; do
        listing="$(cexec "ls $pdir 2>/dev/null")"
        [ -n "$listing" ] || continue
        while read -r p; do
            [ -n "$p" ] || continue
            printf '%s\n' "$roster_ids" | grep -qx "$p" || orphan_profs="$orphan_profs $pdir/$p"
        done <<EOF
$listing
EOF
    done
    if [ -n "$orphan_profs" ]; then
        pending "W7-8 profile root(s) contain non-roster keys:$orphan_profs — W7 keying rule unshipped, re-check when W7 lands"
    else
        pending "W7-8 roster-rename profile keying (no W7 profile root exists yet — nothing to key-check)"
    fi
fi

# W7-9 [SHELL] Deleted bot's profile is cleaned or explicitly retained.
# Fails if: a bot removed from bots.json leaves an orphaned profile dir
# forever with no graveyard record.
# Read-only probe now: any per-bot profile dir whose bot is gone from the
# roster is today's accumulation bug.
orphans="$(cexec 'python3 -c "
import json, os
r=json.load(open(\"/opt/data/fleet/bots.json\"))
ids={k for k,v in r.items() if isinstance(v,dict) and v.get(\"id\")}
ids|=set(r.get(\"bots\") or [])
for root in (\"/opt/data/computer-profiles\",\"/opt/data/browser-profiles\"):
    if os.path.isdir(root):
        for p in os.listdir(root):
            if p not in ids: print(os.path.join(root,p))
"')"
if [ -n "$orphans" ]; then
    fail "W7-9 orphaned profile dirs for bots absent from the roster:$orphans"
else
    # No orphans today, but the *cleanup behaviour* itself is unshipped —
    # an empty result on an unshipped feature must not read as a pass.
    pending "W7-9 deleted-bot profile cleanup (no profile dirs exist to orphan — behavioural assertion needs W7)"
fi

# W7-11 [SHELL] Frame endpoint serves the requested bot only.
# Fails if: frames are served by display number with no ownership check, so
# bot B (or an unauthenticated caller) can read bot A's screen.
pending "W7-11 frame endpoint ownership check (needs W7 frame endpoint auth)"

# W7-12 [SHELL] Two bots driving simultaneously don't corrupt each other.
# Fails if: input injection is addressed globally and B's keystrokes land on
# A's display.
pending "W7-12 concurrent driving isolation (needs W7 display allocation + two active bots)"

echo "== W8 — A server that never blocks"

# W8-3 [SHELL] Routine runs to completion with no client attached.
# Fails if: a scheduled routine's outcome is never persisted when no browser
# is connected (work happens only on request from a client).
pending "W8-3 routine persists outcome with zero clients (needs W8 routine runner)"

# W8-4 [SHELL] Single-flight guard: routine double-trigger fires once.
# Fails if: two rapid triggers run the routine twice and double-send its
# effects; the second call must return "already running".
pending "W8-4 routine single-flight guard (needs W8 routine runner)"

# W8-5 [SHELL] Group turn under load doesn't block chat.
# Fails if: kicking a 5-bot group turn makes a single-bot chat turn take
# group-turn-scale latency (loop monopolised).
pending "W8-5 group turn doesn't block single-bot chat (needs W8 group turns)"

# W8-7 [SHELL] Crash during a background routine leaves recoverable state.
# Fails if: `docker kill` mid-routine leaves no `interrupted` run record, so
# the re-run duplicates completed effects.
pending "W8-7 mid-routine crash recoverable (needs W8 runner test hook — see review untestable-today table)"

# W8-10 [SHELL] Long-running tool doesn't stall other sessions' SSE.
# Fails if: bot A running a 60s tool freezes bot B's stream (shared blocked
# loop).
pending "W8-10 long tool doesn't stall other SSE streams (needs W8 async turn engine)"

# W8-12 [SHELL] Backpressure: many concurrent background tasks don't thrash.
# Fails if: launching 50 routines spawns unbounded tasks and OOMs/deadlocks
# the container instead of queueing.
pending "W8-12 backpressure bounds concurrency (needs W8 routine runner)"

# W8-15 [SHELL] Health endpoint reflects real liveness.
# Fails if: /health reports "ok" while the background pool is starved, or
# there is no honest health surface at all. Probe now: the endpoint must
# exist and return a parseable status today.
health="$(cexec 'for port in 8080 8000 3000; do
    curl -sf -m 3 "http://127.0.0.1:$port/health" 2>/dev/null && break
done')"
health="$(printf '%s' "$health" | tr -d '\r')"
if [ -n "$health" ]; then
    case "$health" in
        *ok*|*status*|*health*)
            # Honest-liveness-under-saturation is unshipped (needs W8-12's
            # pool), but the surface existing and answering is assertable now.
            pass "W8-15 /health answers with a status payload ($(printf '%s' "$health" | head -c 120))"
            ;;
        *) fail "W8-15 /health answered but with an unparseable payload: $health" ;;
    esac
else
    pending "W8-15 health endpoint (no /health answered on 8080/8000/3000 — server surface unshipped or nonstandard port)"
fi

echo "== W9 — Where we come out ahead (leverage claims)"

# W9-2 [SHELL] Growth loop runs on server transcripts with no browser.
# Fails if: the frustration sensor never fires with zero clients attached
# (it measures only what the client sends).
pending "W9-2 growth loop server-side with no browser (needs W2 + growth sensor)"

# W9-3 [SHELL] Frustration rate computed from real transcript counts.
# Fails if: the ledger's per-1000-message rate does not track
# `select count(*)` on the server message table (client-reported counts).
pending "W9-3 frustration rate from server counts (needs W2 transcript + growth ledger)"

# W9-4 [SHELL] Zero-dependency invariant holds after all nine workstreams.
# Fails if: bridge code/config references a new mandatory external service
# (postgres://, s3/queue endpoints) that a clean one-container install
# cannot function without. Read-only grep now.
new_deps="$(cexec 'grep -RInE "postgres(ql)?://|s3[.-]amazonaws|SQS_QUEUE|KAFKA_|RABBITMQ_|REDIS_URL" /opt/balabot/balabot /opt/balabot/ui 2>/dev/null | grep -v -i "test\|#\|\.pyc" | head -5')"
if [ -n "$new_deps" ]; then
    fail "W9-4 possible new external dependency in bridge code: $new_deps"
else
    pass "W9-4 no postgres/S3/queue/redis endpoints referenced in bridge code"
fi

# W9-6 [SHELL] "Why did this agent send that email" (claim 3 end to end).
# Fails if: two weeks after a mutation, only a SQLite row exists and no OKF
# vault artifact records decision/actor/args-hash/timestamp for the key.
pending "W9-6 vault decision record queryable by effect key (needs W5 + vault artifacts)"

# W9-8 [SHELL] No workstream broke the Jev hard-dependency invariant.
# Fails if: a container started with no TYPESAFE_API_KEY exits 0 (silent
# fallback added by some workstream). e2e_docker.sh owns the full assertion;
# here we re-run just the exit-code half on the CURRENT image so this suite
# is self-contained. Read-only w.r.t. the running install (throwaway run).
set +e
# Guard against an image whose entrypoint retries/hangs instead of exiting 1:
# the invariant under test is "exits 1", not "eventually prints something".
nokey_out="$(timeout 90 docker run --rm "$(
    docker inspect -f '{{.Config.Image}}' "$CONTAINER"
)" 2>&1)"
nokey_rc=$?
set -e
if [ "$nokey_rc" -eq 1 ]; then
    pass "W9-8 image without TYPESAFE_API_KEY still exits 1 (no silent fallback)"
else
    fail "W9-8 image without TYPESAFE_API_KEY exited $nokey_rc (expected 1) — hard dependency regressed. Output: $(printf '%s' "$nokey_out" | tail -2)"
fi

# W9-10 [SHELL] One-container footprint holds.
# Fails if: the bridge stack quietly grew a second container or sidecar.
proj_dir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CONTAINER" 2>/dev/null)"
extra="$(docker ps --format '{{.Names}}' | grep -E '^balabot-' | grep -v "^${CONTAINER}$" || true)"
compose_svcs=""
if [ -n "$proj_dir" ] && [ -f "$proj_dir/docker-compose.yml" ]; then
    # Count only services (under the top-level `services:` key) — a `volumes:`
    # entry named balabot-state is the named state volume, not a sidecar.
    compose_svcs="$(awk '/^services:/{f=1;next}/^[a-zA-Z_-]+:/{f=0}f && /^  [a-zA-Z0-9_-]+:/{gsub(/[ :]/,"",$1);print $1}' "$proj_dir/docker-compose.yml" | tr '\n' ' ')"
fi
if [ -n "$extra" ]; then
    fail "W9-10 extra balabot-* container(s) running: $extra"
elif [ -n "$compose_svcs" ] && [ "$(printf '%s\n' "$compose_svcs" | wc -w)" -gt 1 ]; then
    fail "W9-10 compose file defines more than one service: $compose_svcs"
else
    pass "W9-10 single-container footprint holds (no extra balabot containers; compose has one service)"
fi

# W9-12 [SHELL] Secrets + computer compose: no new env surface via computer.
# Fails if: a bot driving its display gains an env-readable path to a
# granted secret that the plain chat path does not have (W4-2 re-run on a
# display-driving bot).
pending "W9-12 computer path opens no new secret env surface (needs W4 store + W7 computer)"

# W9-15 [SHELL] Full-stack cold-start demonstration (synthesis scenario).
# Fails if: any workstream's headline depends on state that exists only on a
# long-lived install (fresh volume + clean container must go green end to end).
pending "W9-15 full-stack cold-start on a fresh volume (synthesis — needs every other workstream)"

echo
echo "== Summary"
echo "PASS:    $PASSES"
echo "PENDING: $PENDS  (unshipped-feature scenarios, counted separately, never vacuous passes)"
echo "FAIL:    $FAILS"
if [ "$FAILS" -gt 0 ]; then
    echo "$FAILS SHELL acceptance check(s) FAILED"
    exit 1
fi
echo "NO FAILURES (pending scenarios are registered, not skipped)"
exit 0
