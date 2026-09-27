#!/usr/bin/env python
"""BalaBot UI adapter — serves the built SPA on :9119 and proxies to the agents.

    GET  /healthz                       (no auth)
    GET  /api/fleet, /api/bots
    GET  /api/agents                    real: profiles + gateway states + models
    GET  /api/ops                       real: s6-svstat service states + container
    GET  /api/memory                    real: holographic memory_store.db facts
    GET  /api/cost                      real: session_model_usage per profile
    GET  /api/governance                OKF ledger — available:false until one exists
    GET  /api/decisions                 Jev decision log — available:false until one exists
    GET/POST /api/computer/{bot}/frame|action   real: cua-driver screens
    /api/orgs, /api/org/secrets, /api/org/grants,
    /api/org/skills/library|pin|promote, /api/org/requests   real: container registry
    POST /api/chat                      SSE passthrough to /p/<profile>/v1/chat/completions
    GET  /api/orphans                   real: unrostered profile dirs, classified
    POST /api/orphans/{name}/adopt      real: adopt an orphan into the roster
    DELETE /api/orphans/{name}          real: purge an orphan profile + artifacts
    DELETE /api/bots/{bot_id}           real: delete a persistent user-created bot
    PATCH /api/bots/{bot_id}            real: edit a persistent bot's metadata

HONESTY RULE: where real data exists it is returned; where it does not, the
endpoint answers {"available": false, "reason": "..."} with HTTP 200 so the UI
renders an explicit unavailable state instead of fabricated data.

Auth: HTTP basic (user `ali`). Password is read from
C:/Users/ali/secrets/balabot-dashboard.key, falling back to
$BALABOT_DASHBOARD_PASSWORD. Never logged.
"""
from __future__ import annotations

import json
import os
import pathlib
import secrets
import subprocess
import time

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

ROOT = pathlib.Path(os.environ.get("BALABOT_HOME",
                                   r"C:/Users/ali/workspace/balabot"))
# Host layout: ui/ is a sibling of the repo's other dirs → ROOT/ui/dist.
# In-container: server.py is copied to /opt/balabot/ui/ and BALABOT_HOME is
# /opt/balabot → ROOT/ui/dist resolves there too. Same expression, both ways.
DIST = ROOT / "ui" / "dist"
ENV_FILE = (pathlib.Path(os.environ["BALABOT_ENV_FILE"])
            if os.environ.get("BALABOT_ENV_FILE")
            else ROOT / ".env")
UPSTREAM = "http://127.0.0.1:8642"
CONTAINER = "balabot-balabot-1"
PROFILES = ["principal", "governor"]

BOT_META = {
    "principal": {"name": "Principal", "title": "Principal bot — runtime ops & growth",
                  "icon": "🧭", "color": "blue", "order": 0,
                  "description": "Runs the system: health, recovery, agent growth."},
    "governor": {"name": "Governor", "title": "Governor — the decision ledger",
                 "icon": "⚖️", "color": "teal", "order": 1,
                 "description": "Keeps the shared OKF decision ledger every agent reads."},
}

API_KEY = os.environ.get("API_SERVER_KEY", "")
if not API_KEY and ENV_FILE.exists():
    for _line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if _line.startswith("API_SERVER_KEY="):
            API_KEY = _line.split("=", 1)[1].strip()
if not API_KEY:
    raise SystemExit(
        "API_SERVER_KEY not found — refusing to start "
        f"(tried process environment API_SERVER_KEY, then env file "
        f"{ENV_FILE})"
    )

DASHBOARD_USER = "ali"
KEY_FILE = (pathlib.Path(os.environ["BALABOT_DASHBOARD_KEY_FILE"])
            if os.environ.get("BALABOT_DASHBOARD_KEY_FILE")
            else pathlib.Path(r"C:/Users/ali/secrets/balabot-dashboard.key"))
DASHBOARD_PASSWORD = (os.environ.get("BALABOT_DASHBOARD_PASSWORD", "")
                      or (KEY_FILE.read_text(encoding="utf-8").strip()
                          if KEY_FILE.exists() else ""))
if not DASHBOARD_PASSWORD:
    raise SystemExit(
        "No dashboard password — refusing to start (tried env "
        "BALABOT_DASHBOARD_PASSWORD, then key file "
        f"{KEY_FILE})"
    )

security = HTTPBasic(auto_error=False)


def _unauth(detail: str = "auth required"):
    return HTTPException(status_code=401, detail=detail,
                         headers={"WWW-Authenticate": "Basic"})


def require_auth(creds: HTTPBasicCredentials | None = Depends(security)):
    if not creds:
        raise _unauth()
    ok = secrets.compare_digest(creds.username, DASHBOARD_USER) and \
        secrets.compare_digest(creds.password, DASHBOARD_PASSWORD)
    if not ok:
        raise _unauth("bad credentials")
    return True


app = FastAPI(title="BalaBot", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    if request.url.path == "/healthz":
        return await call_next(request)
    creds = await security(request)
    try:
        require_auth(creds)
    except HTTPException as exc:
        return JSONResponse({"detail": exc.detail}, status_code=401,
                            headers=exc.headers)
    return await call_next(request)


# ── container probes (cached a few seconds) ─────────────────────────────────
_cache: dict[str, tuple[float, object]] = {}
CACHE_TTL = 8.0


def _cached(key: str, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1], True
    val = fn()
    _cache[key] = (time.time(), val)
    return val, False


def _docker_exec(script: str, timeout: float = 15.0) -> str | None:
    """Run a shell snippet inside the container; None on any failure."""
    try:
        r = subprocess.run(
            ["docker", "exec", CONTAINER, "sh", "-c", script],
            capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            return None
        return r.stdout
    except Exception:
        return None


def unavailable(reason: str):
    return {"available": False, "reason": reason}


def container_ok() -> bool:
    try:
        r = subprocess.run(["docker", "ps", "--format", "{{.Names}}"],
                           capture_output=True, text=True, timeout=10)
        return CONTAINER in r.stdout.split()
    except Exception:
        return False


def svc_states() -> dict[str, dict]:
    """Parse s6-svstat output for the supervised services."""

    def probe():
        # Only services that actually exist. There is NO per-profile gateway:
        # Hermes runs exactly one multiplexed gateway ("gateway-default") that
        # fronts every profile, so probing "gateway-<profile>" would report
        # phantom services as down and make a healthy fleet look broken.
        out = _docker_exec(
            "for s in cloudflared dashboard main-hermes gateway-default; do "
            "echo \"$s|$(/command/s6-svstat /run/service/$s 2>&1)\"; done")
        states: dict[str, dict] = {}
        if out is None:
            return states
        for line in out.strip().splitlines():
            name, _, raw = line.partition("|")
            up = raw.startswith("up ")
            uptime = ""
            if "seconds" in raw:
                secs = raw.split("(", 1)[1].split(")")[0]
                try:
                    n = int(secs.split()[-1])
                    uptime = f"{n // 86400}d {n % 86400 // 3600}h" if n >= 3600 else f"{n // 60}m"
                except Exception:
                    uptime = ""
            detail = raw.split(", normally", 1)[0]
            states[name] = {
                "state": "running" if up else "down",
                "detail": detail,
                "uptime": uptime or "—",
            }
        return states

    return _cached("s6", probe)[0]


def models_for(profile: str) -> str | None:
    """Model id from the upstream /v1/models for one profile."""
    try:
        r = httpx.get(f"{UPSTREAM}/p/{profile}/v1/models",
                      headers={"Authorization": f"Bearer {API_KEY}"}, timeout=8)
        if r.status_code == 200:
            data = r.json().get("data") or []
            return data[0]["id"] if data else None
    except Exception:
        pass
    return None


def sqlite_json(db_path: str, sql: str) -> list | None:
    """Query a sqlite db inside the container; returns rows as dicts or None."""
    script = (
        "python3 -c \"import sqlite3,json;c=sqlite3.connect('" + db_path + "');"
        "print(json.dumps([list(map(str,r)) for r in c.execute('" + sql + "')]))\"")
    out = _docker_exec(script)
    if out is None:
        return None
    try:
        return json.loads(out.strip().splitlines()[-1])
    except Exception:
        return None


# ── health / fleet / bots ────────────────────────────────────────────────────
@app.get("/healthz")
def healthz():
    return {"ok": True, "ts": int(time.time())}


def _bot_row(p: str, meta: dict) -> dict:
    # A created bot's meta row already carries its own 'id' (it IS the dict key);
    # normalize so the key always wins instead of a duplicate-kwarg TypeError.
    row = {k: v for k, v in meta.items() if k != "id"}
    row["id"] = p
    return row


@app.get("/api/bots")
def bots():
    rows = sorted(_all_bot_meta().items(), key=lambda kv: kv[1].get("order", 999))
    return {"bots": [_bot_row(p, meta) for p, meta in rows]}


@app.get("/api/fleet")
def fleet():
    live = container_ok()
    states = svc_states() if live else {}

    # Hermes runs ONE multiplexed gateway per host ("gateway-default") that fronts
    # every profile -- there is no per-profile gateway service. Looking up
    # "gateway-<profile>" finds nothing and reports every agent "down" even when
    # the fleet is perfectly healthy, so liveness is gateway-default OR main-hermes.
    def agent_state() -> str:
        if not live:
            return "dormant"
        for svc in ("gateway-default", "main-hermes"):
            if states.get(svc, {}).get("state") == "running":
                return "live"
        return "dormant"

    agents = []
    for p in PROFILES:
        agents.append({
            "id": p, "name": BOT_META[p]["name"],
            "state": agent_state(),
            "model": models_for(p) if live else None,
        })

    # The product UI boots by calling /api/fleet and reading `bots` (falling back to
    # /api/bots only if the call THROWS). Returning a fleet shape without `bots`
    # succeeds with an undefined list, so the roster renders empty -- "No bots in
    # the roster yet." -- and the fallback never runs. Serve the full bot objects here.
    bots = [_bot_row(p, meta)
            for p, meta in sorted(_all_bot_meta().items(),
                                  key=lambda kv: kv[1].get("order", 999))]

    return {"fleet": "balabot",
            "bots": bots,
            "agents": agents,
            "excluded": [],  # nothing is excluded on this surface
            "container": {"running": live, "name": CONTAINER}}


# ── agents screen ────────────────────────────────────────────────────────────
@app.get("/api/agents")
def agents():
    if not container_ok():
        return unavailable("balabot container is not running — no agent data")
    states = svc_states()
    tree = [{
        "id": "user-ali", "name": "Ali", "tier": "user", "status": "live",
        "role": "Principal human operator",
        "children": [{
            "id": "principal", "name": "Principal", "tier": "principal",
            "status": "live" if states.get("gateway-default", {}).get("state") == "running"
                      or states.get("main-hermes", {}).get("state") == "running" else "dormant",
            "role": f"Runtime ops & agent growth — model {models_for('principal') or 'unknown'}",
            "children": [{
                "id": "governor", "name": "Governor", "tier": "governor",
                "status": "live" if states.get("gateway-default", {}).get("state") == "running"
                          or states.get("main-hermes", {}).get("state") == "running" else "dormant",
                "role": f"OKF decision ledger — model {models_for('governor') or 'unknown'}",
            }],
        }],
    }]
    return {"available": True, "tree": tree,
            "note": "Only the shipped principal and governor exist in this install; "
                    "persistent agents and sub-agents have not been provisioned yet."}


# ── ops screen ───────────────────────────────────────────────────────────────
@app.get("/api/ops")
def ops():
    if not container_ok():
        return unavailable("balabot container is not running — no service data")
    states = svc_states()
    services = []
    # Real services only. There is no per-profile gateway -- one multiplexed
    # "gateway-default" fronts every profile -- so listing them would invent
    # services and show a healthy fleet as broken.
    for name, label in [("main-hermes", "Hermes main"), ("dashboard", "Dashboard"),
                        ("gateway-default", "Gateway (default)"),
                        ("cloudflared", "Cloudflare tunnel")]:
        s = states.get(name)
        if s is None:
            services.append({"id": name, "name": label, "state": "down",
                             "detail": "service not reported", "uptime": "—"})
            continue
        # The tunnel is intentionally DOWN until the gateway scheduler raises it
        # (it exits 0, not with a fault). Report that as "dormant" -- calling it
        # "down" reads as an outage when it is the designed resting state.
        if name == "cloudflared" and s.get("state") == "down" and "exitcode 0" in s.get("detail", ""):
            services.append({"id": name, "name": label, "state": "dormant",
                             "detail": "not raised — dormant by design until the gateway schedules it",
                             "uptime": "—"})
            continue
        services.append({"id": name, "name": label, **s})
    return {"available": True, "services": services,
            "note": "cloudflared is dormant (exit 0) until the gateway scheduler raises it; "
                    "that is its designed resting state, not a fault."}


# ── memory screen ────────────────────────────────────────────────────────────
@app.get("/api/memory")
def memory():
    if not container_ok():
        return unavailable("balabot container is not running — cannot read the memory store")
    # Verified against the live container: /opt/data/profiles/principal/ holds
    # memory_store.db (tables: facts, entities, fact_entities, memory_banks,
    # facts_fts*). There is no mem_<p>.db anywhere in the container.
    # Entities are joined for real; category/tags are reported as themselves —
    # never relabelled as entity data.
    facts = sqlite_json(
        "/opt/data/profiles/principal/memory_store.db",
        "select f.fact_id, f.content, f.category, f.tags, f.trust_score, "
        "f.retrieval_count, f.updated_at, "
        "(select group_concat(e.name, ', ') from fact_entities fe "
        "join entities e on e.entity_id = fe.entity_id "
        "where fe.fact_id = f.fact_id) "
        "from facts f order by f.updated_at desc limit 200")
    if facts is None:
        return unavailable("could not read the holographic store "
                           "(memory_store.db) inside the container")
    if not facts:
        return unavailable("the holographic memory store is empty — "
                           "no facts have been recorded yet")
    rows = [{"id": f[0], "content": f[1], "entity": f[7] or "—",
             "resolvedTo": "—", "trust": float(f[4] or 0),
             "sources": int(f[5] or 0), "updatedAt": str(f[6]),
             "category": f[2] or "", "tags": f[3] or ""} for f in facts]
    counts = sqlite_json(
        "/opt/data/profiles/principal/memory_store.db",
        "select (select count(*) from entities), (select count(*) from memory_banks)")
    return {"available": True, "facts": rows, "profile": "principal",
            "entitiesCount": int(counts[0][0]) if counts else None,
            "note": "Entity names come from the real entities/fact_entities "
                    "tables; the store has no 'resolvedTo' concept, so that "
                    "column is always '—'. category/tags are shown as-is."}


# ── cost screen ──────────────────────────────────────────────────────────────
@app.get("/api/cost")
def cost():
    if not container_ok():
        return unavailable("balabot container is not running — no usage data")
    rows_out: list[dict] = []
    empty = True
    for p in PROFILES:
        rows = sqlite_json(
            f"/opt/data/profiles/{p}/state.db",
            "select model, billing_provider, sum(api_call_count), "
            "sum(input_tokens), sum(output_tokens), sum(estimated_cost_usd) "
            "from session_model_usage group by model, billing_provider")
        if rows is None:
            continue
        for model, provider, calls, tin, tout, spend in rows:
            empty = False
            rows_out.append({"id": f"{p}:{model}", "profile": p,
                             "provider": provider or "unknown", "model": model,
                             "spend": round(float(spend or 0), 6),
                             "calls": int(calls or 0),
                             "tokens": int(tin or 0) + int(tout or 0)})
    if empty:
        return unavailable("no billing API is wired and the session usage tables "
                           "are empty — nothing has been spent to report yet")
    return {"available": True, "rows": rows_out,
            "note": "Estimated cost from Hermes' own session_model_usage tables; "
                    "no external billing API is connected."}


# ── governance + decisions: honest unavailability for now ────────────────────
@app.get("/api/governance")
def governance():
    if not container_ok():
        return unavailable("balabot container is not running")
    out = _docker_exec(
        "find /opt/data -maxdepth 4 \\( -type d -iname '*ledger*' -o -type d -iname '*kb*' "
        "-o -type d -iname '*governance*' \\) 2>/dev/null | head -5")
    if out and out.strip():
        return unavailable(f"a ledger directory ({out.strip().splitlines()[0]}) exists "
                           "but no structured OKF entry reader is wired yet — "
                           "reporting unavailable rather than guessing")
    return unavailable("the governor's OKF decision ledger is empty — no ledger "
                       "directory or entries exist under /opt/data yet")


@app.get("/api/decisions")
def decisions():
    if not container_ok():
        return unavailable("balabot container is not running")
    out = _docker_exec(
        "find /opt/data -maxdepth 4 \\( -iname '*decision*' -o -iname '*.jev' "
        "-o -iname '*jev*log*' \\) 2>/dev/null | head -5")
    if out and out.strip():
        return unavailable(f"decision artifacts exist ({out.strip().splitlines()[0]}) "
                           "but no structured reader is wired yet")
    return unavailable("no Jev/TypeSafe decision log exists yet — decisions are "
                       "classified in-session and nothing is persisted to disk")


# ── Jev: hard dependency, so its health is first-class ───────────────────────
# Jev (TypeSafe AI) is a HARD dependency — no fallback provider. An unreachable
# Jev is an incident the Principal must see, so these routes are the live read
# side of balabot.bootstrap's incident store. Local imports keep the import
# order independent of the sys.path setup further down this module.
@app.get("/api/jev/health")
def jev_health():
    """Bounded, non-raising Jev reachability probe."""
    # check_jev_health lives in balabot.jev, NOT re-exported by bootstrap —
    # importing it from bootstrap raises ImportError (the route 500'd on it).
    from balabot.jev import check_jev_health  # noqa: E402
    return check_jev_health().to_dict()


@app.get("/api/jev/incidents")
def jev_incidents():
    """Recorded Jev incidents, oldest first — the Principal's incident feed."""
    from balabot.bootstrap import list_jev_incidents  # noqa: E402
    rows = list_jev_incidents("principal")
    return {"incidents": rows, "count": len(rows)}


# ── sub-agents: live rows from the container's real spawn ledger ─────────────
@app.get("/api/subagents")
def subagents_route():
    """Live sub-agent rows. An empty list is a real answer, never invented rows."""
    try:
        from subagents import read_subagents  # noqa: E402  (sits beside server.py)
    except ImportError:  # launched from the repo root rather than ui/
        from ui.subagents import read_subagents  # noqa: E402
    return read_subagents()


# ── computer use: real agent screens via the cua-driver bridge ───────────────
# balabot/computer.py runs `cua-driver call` INSIDE the container (host: docker
# exec wrapper below) against the per-agent Xvfb displays. Every response is
# real driver output or a structured unavailable/error — never a placeholder.
import sys as _sys

_sys.path.insert(0, str(ROOT.parent))
from balabot import computer as _computer  # noqa: E402


def _computer_run(snippet: str, timeout: float = 30.0) -> dict:
    """Run the computer bridge inside the container; return parsed JSON."""
    out = _docker_exec(f"python3 - <<'PY'\n{snippet}\nPY", timeout=timeout)
    if out is None:
        return {"ok": False, "state": "error",
                "reason": "could not exec in the balabot container "
                          "(is it running?)"}
    try:
        return json.loads(out.strip())
    except json.JSONDecodeError:
        return {"ok": False, "state": "error",
                "reason": f"container bridge returned non-JSON: {out[:300]}"}


@app.get("/api/computer/{bot_id}/frame")
def computer_frame(bot_id: str):
    if bot_id not in PROFILES:
        return unavailable(f"no bot named {bot_id!r} in this fleet")
    res = _computer_run(
        "import json\n"
        "from balabot import computer\n"
        f"print(json.dumps(computer.frame({bot_id!r})))")
    if not res.get("ok"):
        return {"available": False,
                "state": res.get("state", "error"),
                "reason": res.get("reason", "frame capture failed")}
    return {
        "available": True, "ok": True, "state": "ready",
        "b64": res["b64"], "width": res["width"], "height": res["height"],
        "captureId": res.get("capture_id"), "capturedAt": res["capturedAt"],
        "mime": res["mime"],
    }


@app.post("/api/computer/{bot_id}/action")
async def computer_action(bot_id: str, request: Request):
    if bot_id not in PROFILES:
        return unavailable(f"no bot named {bot_id!r} in this fleet")
    try:
        payload = await request.json()
    except Exception:
        return unavailable("request body is not valid JSON")
    spec = json.dumps(payload)  # compact, safe to embed in the heredoc
    res = _computer_run(
        "import json\n"
        "from balabot import computer\n"
        f"print(json.dumps(computer.act({bot_id!r}, json.loads({spec!r}))))",
        timeout=60.0)
    if not res.get("ok"):
        return {"available": False,
                "state": res.get("state", "error"),
                "reason": res.get("reason", "action failed")}
    return {"available": True, "ok": True, "state": res.get("state", "ready"),
            "applied": res.get("applied"), "tool": res.get("tool"),
            "frame": res.get("frame"), "note": res.get("note")}


# ── org surfaces: the real registry-backed HTTP layer ────────────────────────
# Backing store: balabot/orgs.py INSIDE the container (registry + 0600 secret
# store). The container's /opt/data is a NAMED DOCKER VOLUME (balabot_
# balabot-state), not a bind mount, so the host cannot read it — running
# balabot.orgs on the host would resolve paths to a meaningless \opt\data on
# the host disk. Every org route therefore runs its registry work inside
# balabot-balabot-1 via _org_run, the same way /api/memory and /api/computer
# do. The registry holds metadata + fingerprints only; a secret VALUE never
# appears in any response, log, or frame from this module.
# See kb/plans/org-registry-schema.md.


def _org_run(snippet: str, payload: dict | None = None,
             timeout: float = 30.0) -> dict:
    """Run an org-registry snippet INSIDE the container; return parsed JSON.

    Never raises. The snippet is executed as `python3 -` (source on stdin),
    with the container's real env and cwd (PYTHONPATH=/opt/balabot,
    BALABOT_DATA_ROOT=/opt/data, cwd /opt/balabot). When `payload` is given
    it is passed to the snippet via the dedicated environment variable
    _BALABOT_ORG_PAYLOAD (JSON) — NEVER via argv and never interpolated into
    a shell command line. (stdin cannot carry a payload: `python3 -` reads
    ALL of stdin as source.) The snippet prints exactly one JSON document on
    its last stdout line. On any failure (container down, non-zero exit,
    non-JSON, or the snippet printing {"ok": false}) a structured error dict
    is returned — the honest-unavailable contract.
    """
    argv = ["docker", "exec", "-i", "-w", "/opt/balabot",
            "-e", "PYTHONPATH=/opt/balabot", "-e", "BALABOT_DATA_ROOT=/opt/data"]
    if payload is not None:
        # Environment variable, not argv: the value never appears in a
        # process command line (which is world-readable via /proc).
        argv += ["-e", "_BALABOT_ORG_PAYLOAD=" + json.dumps(payload)]
    argv += [CONTAINER, "python3", "-"]
    try:
        r = subprocess.run(argv, input=snippet,
                           capture_output=True, text=True, timeout=timeout)
    except Exception:
        return {"ok": False, "error": "container_unreachable",
                "reason": "could not exec in the balabot container "
                          "(is it running?)"}
    if r.returncode != 0:
        return {"ok": False, "error": "container_snippet_failed",
                "reason": (r.stderr or r.stdout)[-300:]}
    try:
        parsed = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return {"ok": False, "error": "non_json_bridge",
                "reason": f"container bridge returned non-JSON: {r.stdout[-300:]}"}
    if isinstance(parsed, dict) and parsed.get("ok") is False:
        return parsed
    if isinstance(parsed, dict):
        return {"ok": True, **parsed}
    return {"ok": True, "data": parsed}


# ── container-side snippets (run via _org_run; see its contract) ─────────────
# The snippet bodies are STATIC. Data (including the secret VALUE) arrives as
# JSON via the _BALABOT_ORG_PAYLOAD environment variable and is parsed inside
# the container — never string-interpolated into the source, never argv.

def _wrap(snippet: str, with_payload: bool) -> str:
    head = "import json, sys\n"
    if with_payload:
        head += "payload = json.loads(os.environ.pop('_BALABOT_ORG_PAYLOAD'))\n"
        return head.replace("import json, sys",
                            "import json, os, sys") + snippet
    return head + snippet


_ORGS_LIST_SNIPPET = '''\
from balabot import orgs
print(json.dumps({'orgs': sorted(orgs.list_orgs(), key=lambda o: o['id'])}))
'''

_ORGS_VIEW_SNIPPET = '''\
from balabot import orgs
reg = orgs.load()
org_members = {oid: o.get('members', []) for oid, o in reg['orgs'].items()}
rows = []
for s in reg['secrets']:
    granted_to = []
    for g in reg['grants']:
        if (g['revoked_at'] is None and g['resource']['kind'] == 'secret'
                and g['resource']['name'] == s['name']
                and g['resource_org'] == s['org']):
            if g['scope'] == 'org':
                if g['subject_org'] == s['org']:
                    granted_to.extend(f"org:{s['org']}:{m}"
                                      for m in org_members.get(s['org'], []))
                else:
                    granted_to.append(f"org:{g['subject_org']}")
            else:
                granted_to.append(g['subject']['id'])
    rows.append({'name': s['name'], 'org': s['org'],
                 'description': s.get('description', ''),
                 'fingerprint': s.get('fingerprint', '…'),
                 'granted_to': sorted(set(granted_to))})
print(json.dumps({'rows': rows}))
'''

_ORGS_GRANTS_LIST_SNIPPET = '''\
from balabot import orgs
print(json.dumps({'grants': orgs.load()['grants']}))
'''

# The secret VALUE arrives in `payload` (via stdin) and is used here, inside
# the container, exactly once. Only the fingerprint and grant ids leave.
_ORGS_SAVE_SNIPPET = '''\
from balabot import orgs
reg = orgs.load()
org = payload['org']
name = payload['name']
if org not in reg['orgs']:
    print(json.dumps({'ok': False, 'error': 'unknown_org',
                      'detail': f'unknown org {org!r}', 'status': 404}))
    raise SystemExit(0)
elif payload.get('target_org') and payload['target_org'] not in reg['orgs']:
    print(json.dumps({'ok': False, 'error': 'unknown_org',
                      'detail': f"unknown target org {payload['target_org']!r}",
                      'status': 404}))
    raise SystemExit(0)
else:
    orgs.store_secret(name, org, payload['value'])
    record = orgs.register_secret(name, org,
                                  description=payload.get('description') or '')
    made = []
    resource = {'kind': 'secret', 'name': name}
    scope = payload['share_scope']
    if scope in ('one', 'choose'):
        for bot in payload['bots']:
            made.append(orgs.grant(bot, resource, subject_org=org, scope='bot'))
    elif scope == 'all':
        made.append(orgs.grant(org, resource, subject_org=org, scope='org',
                               created_by='user'))
    elif scope == 'another_org':
        if not payload.get('target_org'):
            print(json.dumps({'ok': False, 'error': 'bad_request',
                              'detail': "share_scope 'another_org' requires target_org",
                              'status': 400}))
            raise SystemExit(0)
        else:
            # A cross-org grant is not a special case: same table, the
            # receiving org is the subject.
            made.append(orgs.grant(f"org:{payload['target_org']}",
                                   {**resource, 'org': org},
                                   subject_org=payload['target_org'],
                                   scope='org', created_by='user'))
    granted_to = []
    if scope == 'all':
        members = reg['orgs'][org].get('members', [])
        granted_to = [f'org:{org}:{m}' for m in members]
    elif scope == 'another_org':
        granted_to = [f"org:{payload['target_org']}"] if payload.get('target_org') else []
    else:
        granted_to = list(payload['bots'] or [])
    print(json.dumps({'fingerprint': record.get('fingerprint'),
                      'grant_ids': [g['id'] for g in made],
                      'granted_to': granted_to}))
'''

_ORGS_GRANT_CREATE_SNIPPET = '''\
from balabot import orgs
resource = payload['resource']
try:
    g = orgs.grant(
        payload.get('subject_bot') or '',
        {'kind': resource.get('kind'), 'name': resource.get('name'),
         **({'org': resource['org']} if resource.get('org') else {})},
        subject_org=payload.get('subject_org') or '',
        scope=payload.get('scope') or 'bot',
        access=payload.get('access') or 'inject',
        created_by=payload.get('created_by') or 'user')
    print(json.dumps({'grant': g}))
except ValueError as exc:
    print(json.dumps({'ok': False, 'error': 'bad_request',
                      'detail': str(exc), 'status': 400}))
except KeyError as exc:
    print(json.dumps({'ok': False, 'error': 'unknown_org',
                      'detail': str(exc), 'status': 404}))
'''

_ORGS_GRANT_REVOKE_SNIPPET = '''\
from balabot import orgs
gid = payload['grant_id']
if not orgs.revoke(gid):
    print(json.dumps({'ok': False, 'error': 'not_found',
                      'detail': f'no grant {gid!r}', 'status': 404}))
else:
    row = next(g for g in orgs.load()['grants'] if g['id'] == gid)
    print(json.dumps({'grant': row}))
'''

ORG_KINDS = ("secret", "skill", "workspace", "display")


def _org_status_error(res: dict):
    """Raise the HTTP status the container-side snippet asked for."""
    raise HTTPException(status_code=int(res.get("status") or 503),
                        detail=res.get("detail") or res.get("reason", "container error"))


# Pending access requests, per bot profile, drained by the /api/chat SSE stream
# as `event: secret_request` / `event: secret_access_request` frames. This is
# the server-side emission path: the upstream is a plain OpenAI-compatible
# passthrough with no such event of its own, so the frames are emitted HERE
# (the same frame grammar the working `event: handoff` frames use).
_org_request_queue: dict[str, list[dict]] = {}


def enqueue_org_request(profile: str, event: dict) -> dict:
    """Queue a request frame for a profile's next /api/chat stream."""
    item = {
        "id": f"r_{int(time.time() * 1000):x}",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **event,
    }
    _org_request_queue.setdefault(profile, []).append(item)
    return item


def _drain_org_request_frames(profile: str) -> list[str]:
    """Pop queued requests for `profile` as SSE frames. Metadata only — the
    secret NAME and description travel; a value can never appear here."""
    frames: list[str] = []
    pending = _org_request_queue.pop(profile, [])
    for item in pending:
        kind = item.get("kind", "secret_request")
        payload = {"name": item.get("name", ""),
                   "description": item.get("description", ""),
                   "requestedBy": item.get("bot", ""),
                   "bot": item.get("bot", ""),
                   "request_id": item["id"]}
        if kind == "secret_access_request":
            payload["reason"] = item.get("reason", "")
        frames.append(f"event: {kind}\ndata: {json.dumps(payload)}\n\n")
    return frames


def _org_meta_only(record: dict) -> dict:
    """Whitelist the fields that may leave the backend. No value, ever."""
    return {k: record.get(k) for k in
            ("name", "org", "description", "fingerprint", "created_at",
             "rotated_at") if k in record}


@app.get("/api/orgs")
def orgs_list():
    if not container_ok():
        return unavailable("balabot container is not running — no org data")
    res = _org_run(_wrap(_ORGS_LIST_SNIPPET, False))
    if not res.get("ok"):
        return unavailable(res.get("reason", "could not read the org registry"))
    rows = res.get("orgs") or []
    if not rows:
        return unavailable("no organizations are registered yet — "
                           "register one via the registry CLI or POST /api/org/grants "
                           "after creating it (python -m balabot.orgs)")
    return {"available": True, "orgs": rows}


@app.post("/api/org/secrets")
async def org_secret_save(request: Request):
    """Store a secret VALUE and create its grant(s). The value is passed ONCE,
    via stdin into the container's store_secret, and never echoed, logged or
    returned — only the container-side metadata + fingerprint come back out."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    name = body.get("name") or ""
    value = body.get("value")
    org = body.get("org") or ""
    if not name or not isinstance(value, str) or not value or not org:
        raise HTTPException(status_code=400,
                            detail="name, value and org are required")
    share_scope = body.get("share_scope") or "one"
    if share_scope not in ("one", "all", "choose", "another_org"):
        raise HTTPException(status_code=400,
                            detail="share_scope must be one|all|choose|another_org")
    bots = [b for b in (body.get("bots") or []) if isinstance(b, str)]
    target_org = body.get("target_org")
    if share_scope in ("one", "choose") and not bots:
        raise HTTPException(status_code=400,
                            detail="share_scope one/choose requires bots")
    if not container_ok():
        return unavailable("balabot container is not running — cannot store secrets")
    # The value arrives via stdin JSON (payload), never argv and never
    # interpolated into a shell command line.
    res = _org_run(_wrap(_ORGS_SAVE_SNIPPET, True), payload={
        "name": name, "org": org, "value": value, "share_scope": share_scope,
        "bots": bots, "target_org": target_org,
        "description": body.get("description") or "",
    })
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not store the secret in the container"))
    return {"saved": True, "name": name,
            "fingerprint": res.get("fingerprint", "…"),
            "granted_to": res.get("granted_to", []),
            "share_scope": share_scope,
            "grant_ids": res.get("grant_ids", [])}


@app.get("/api/org/secrets")
def org_secrets_list():
    if not container_ok():
        return unavailable("balabot container is not running — no secret registry")
    res = _org_run(_wrap(_ORGS_VIEW_SNIPPET, False))
    if not res.get("ok"):
        return unavailable(res.get("reason", "could not read the secret registry"))
    return res.get("rows", [])


@app.get("/api/org/grants")
def org_grants_list():
    if not container_ok():
        return unavailable("balabot container is not running — no grant data")
    res = _org_run(_wrap(_ORGS_GRANTS_LIST_SNIPPET, False))
    if not res.get("ok"):
        return unavailable(res.get("reason", "could not read the grant table"))
    return {"grants": res.get("grants", [])}


@app.post("/api/org/grants")
async def org_grants_create(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    resource = body.get("resource") or {}
    if not container_ok():
        return unavailable("balabot container is not running — cannot create grants")
    res = _org_run(_wrap(_ORGS_GRANT_CREATE_SNIPPET, True), payload={
        "subject_bot": body.get("subject_bot"),
        "subject_org": body.get("subject_org"), "resource": resource,
        "scope": body.get("scope"), "access": body.get("access"),
        "created_by": body.get("created_by")})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not create the grant"))
    return {"granted": True, "grant": res.get("grant")}


@app.post("/api/org/grants/{grant_id}/revoke")
def org_grants_revoke(grant_id: str):
    if not container_ok():
        return unavailable("balabot container is not running — cannot revoke grants")
    res = _org_run(_wrap(_ORGS_GRANT_REVOKE_SNIPPET, True),
                   payload={"grant_id": grant_id})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not revoke the grant"))
    # Revocation sets revoked_at; the row is never deleted (audit trail).
    return {"revoked": True, "grant": res.get("grant")}


@app.get("/api/org/requests")
def org_requests_list():
    """The access-request queue (pending, across profiles), oldest first."""
    pending = [item for items in _org_request_queue.values() for item in items]
    pending.sort(key=lambda i: i["created_at"])
    return {"requests": pending, "count": len(pending)}


@app.post("/api/org/requests")
async def org_requests_enqueue(request: Request):
    """A bot raises a secret request / access request. Metadata only."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    bot = body.get("bot") or ""
    kind = body.get("kind") or "secret_request"
    if kind not in ("secret_request", "secret_access_request"):
        raise HTTPException(status_code=400, detail="kind must be secret_request "
                             "or secret_access_request")
    if not bot:
        raise HTTPException(status_code=400, detail="bot is required")
    name = body.get("name") or ""
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    item = enqueue_org_request(bot, {
        "kind": kind, "bot": bot, "name": name,
        "description": body.get("description") or "",
        "reason": body.get("reason") or "",
    })
    return {"queued": True, "request": item}


# Legacy skills stub: /api/skills/library (below) is the real route;
# the org-scoped pin/promote actions are still honest stubs until wave 6
# lands the skills registry.
@app.api_route("/api/org/skills/pin", methods=["POST"])
@app.api_route("/api/org/skills/promote", methods=["POST"])
async def org_skills_stubs(request: Request):
    return unavailable("org skills (pin/promote) are not wired yet — the "
                       "skills registry is build-order step 6")


def _skill_rows(profile: str) -> list[dict] | None:
    """Every SKILL.md in a profile's tree, with its real category and blurb.

    Walks the container's own filesystem rather than trusting a registry: the
    profile tree IS the truth about what an agent has. None means the read
    failed (container down, tree absent), which the caller reports honestly
    rather than rendering an empty list as "no skills".
    """
    script = (
        "python3 - <<'PY'\n"
        "import json, pathlib\n"
        "base = pathlib.Path('/opt/data/profiles/" + profile + "/skills')\n"
        "if not base.is_dir():\n"
        "    print('[]')\n"
        "    raise SystemExit\n"
        "rows = []\n"
        "for md in sorted(base.rglob('SKILL.md')):\n"
        "    rel = md.relative_to(base)\n"
        "    parts = rel.parts\n"
        "    category = parts[0] if len(parts) > 2 else ''\n"
        "    desc = ''\n"
        "    try:\n"
        "        for line in md.read_text(encoding='utf-8', errors='replace').splitlines()[:24]:\n"
        "            if line.startswith('description:'):\n"
        "                desc = line.split(':', 1)[1].strip().strip('\\\"')\n"
        "                break\n"
        "    except Exception:\n"
        "        pass\n"
        "    rows.append({'name': parts[-2], 'category': category,\n"
        "                 'description': desc, 'path': str(rel).replace(chr(92), '/'),\n"
        "                 'hasCategoryDoc': (base / category / 'DESCRIPTION.md').is_file() if category else False})\n"
        "print(json.dumps(rows))\n"
        "PY"
    )
    out = _docker_exec(script, timeout=45.0)
    if out is None:
        return None
    try:
        return json.loads(out.strip().splitlines()[-1])
    except Exception:
        return None


@app.get("/api/skills/library")
def skills_library(bot: str = ""):
    """The real skill library for one bot, or all of them.

    Everything found is reported as `brought`, the source naming whether it is
    BalaBot's own shipped set (`balabot/`) or the profile's shipped install.
    `learned` is deliberately left EMPTY: a skill's origin is not inferable from
    the filesystem, and no curator state exists yet, so attributing anything to
    the self-improvement loop would be an invented claim.
    """
    if bot and bot not in PROFILES:
        raise HTTPException(status_code=404, detail=f"unknown bot {bot}")
    if not container_ok():
        return unavailable("balabot container is not running "
                           "- cannot read the skill trees")
    targets = [bot] if bot else PROFILES
    library: dict[str, dict] = {}
    for prof in targets:
        rows = _skill_rows(prof)
        if rows is None:
            library[prof] = {"available": False,
                             "reason": f"could not read the skill tree for {prof}"}
            continue
        # Classification uses only what is CERTAIN from disk. An earlier pass
        # inferred "authored in this profile" from the absence of a category
        # DESCRIPTION.md, which silently relabelled 13 shipped Hermes skills as
        # agent-written because two categories happen not to carry that file.
        # Invented provenance is worse than none, so: the balabot/ category is
        # BalaBot's shipped set, everything else is the profile's shipped
        # install, and `learned` stays EMPTY until real curator state exists.
        brought, learned = [], []
        for r in rows:
            source = ("ships with BalaBot" if r["category"] == "balabot"
                      else "ships with this install")
            brought.append({"name": r["name"], "source": source,
                            "category": r["category"] or "(uncategorised)",
                            "description": r["description"], "state": "active"})
        library[prof] = {
            "available": True,
            "learned": learned,
            "brought": brought,
            "total": len(rows),
            "note": (f"{len(brought)} skills installed in this profile. Nothing is "
                     "attributed to the self-improvement loop: there is no curator "
                     "state yet, and a skill's origin is not inferable from disk "
                     "alone, so only installed skills are reported."),
        }
    if bot:
        return library[bot]
    return {"available": True, "bots": library}


# ── Wave 6 P3: multi-agent groups (serial rounds, @mentions, per-member
#    sessions, one shared Agent Computer pane) ────────────────────────────────
# State: <BALABOT_DATA_ROOT>/groups/ inside the container, via _org_run — the
# same container-registry pattern as the org routes. A group's turn is run
# HERE (this process), member by member, against the same upstream the single
# chat uses; the serial order is enforced by a plain for-loop, not by hope.


_GROUPS_LIST_SNIPPET = '''\
from balabot import groups
print(json.dumps({'groups': groups.list_groups()}))
'''

_GROUPS_CREATE_SNIPPET = '''\
from balabot import groups
try:
    g = groups.create_group(
        payload['name'], payload['members'],
        computer_agent=payload.get('computer_agent'),
        known_bots=payload.get('known_bots'))
    print(json.dumps({'group': {
        'id': g['id'], 'name': g['name'], 'members': g['members'],
        'computer_agent': g['computer_agent'], 'round': g['round'],
        'created_at': g['created_at']}}))
except groups.GroupsError as exc:
    print(json.dumps({'ok': False, 'error': 'bad_request',
                      'detail': str(exc), 'status': 400}))
'''

_GROUPS_GET_SNIPPET = '''\
from balabot import groups
try:
    g = groups.get_group(payload['gid'])
except groups.GroupsError as exc:
    print(json.dumps({'ok': False, 'error': 'not_found',
                      'detail': str(exc), 'status': 404}))
    raise SystemExit(0)
print(json.dumps({'group': g}))
'''

_GROUPS_DELETE_SNIPPET = '''\
from balabot import groups
gid = payload['gid']
if not groups.delete_group(gid):
    print(json.dumps({'ok': False, 'error': 'not_found',
                      'detail': f'no group {gid!r}', 'status': 404}))
else:
    print(json.dumps({'deleted': True}))
'''

_GROUPS_APPLY_SNIPPET = '''\
from balabot import groups
try:
    g = groups.apply_turn_results(payload['gid'], payload['text'],
                                  payload['results'])
except groups.GroupsError as exc:
    print(json.dumps({'ok': False, 'error': 'not_found',
                      'detail': str(exc), 'status': 404}))
    raise SystemExit(0)
print(json.dumps({'group': {
    'id': g['id'], 'round': g['round'],
    'transcript': g['transcript'][-40:],
    'sessions': {m: {'len': len(g['sessions'][m]['messages'])}
                 for m in g['members']}}}))
'''


def _fleet_bot_ids() -> list[str]:
    return list(PROFILES)


def _group_public(g: dict) -> dict:
    """Whitelist a group row for the UI. Sessions carry message counts, not
    the other member's raw history (the create snippet returns a summary
    without sessions — treat them as empty)."""
    sessions = g.get("sessions") or {}
    return {
        "id": g["id"], "name": g["name"], "members": g["members"],
        "computerAgent": g["computer_agent"], "round": g["round"],
        "transcript": g.get("transcript", []),
        "sessionLens": {m: len(sessions[m]["messages"])
                        for m in g["members"] if m in sessions},
        "createdAt": g["created_at"],
    }


@app.get("/api/groups")
def groups_list():
    if not container_ok():
        return unavailable("balabot container is not running — no group data")
    res = _org_run(_wrap(_GROUPS_LIST_SNIPPET, False))
    if not res.get("ok"):
        return unavailable(res.get("reason", "could not read the group store"))
    return {"available": True, "groups": res.get("groups", [])}


@app.post("/api/groups")
async def groups_create(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    name = body.get("name") or ""
    members = body.get("members") or []
    if not name or not isinstance(members, list):
        raise HTTPException(status_code=400, detail="name and members are required")
    if not container_ok():
        return unavailable("balabot container is not running — cannot create groups")
    res = _org_run(_wrap(_GROUPS_CREATE_SNIPPET, True), payload={
        "name": name, "members": members,
        "computer_agent": body.get("computer_agent"),
        "known_bots": _fleet_bot_ids(),
    })
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not create the group"))
    return {"created": True, "group": _group_public(res["group"])}


@app.get("/api/groups/{gid}")
def groups_get(gid: str):
    if not container_ok():
        return unavailable("balabot container is not running — no group data")
    res = _org_run(_wrap(_GROUPS_GET_SNIPPET, True), payload={"gid": gid})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not read the group"))
    return {"available": True, "group": _group_public(res["group"])}


@app.delete("/api/groups/{gid}")
def groups_delete(gid: str):
    if not container_ok():
        return unavailable("balabot container is not running — cannot delete groups")
    res = _org_run(_wrap(_GROUPS_DELETE_SNIPPET, True), payload={"gid": gid})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not delete the group"))
    return {"deleted": True}


@app.post("/api/groups/{gid}/turn")
async def groups_turn(gid: str, request: Request):
    """One SERIAL group round.

    The orchestrator: plan (@mentions -> ordered targets), run each member's
    turn against the upstream ONE AT A TIME, persist results. Serial is
    structural: the loop awaits each member before starting the next. No
    member's raw session history is sent to another member — group context
    is the short shared transcript the plan builds.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if not container_ok():
        return unavailable("balabot container is not running — no group turns")

    res = _org_run(_wrap(_GROUPS_GET_SNIPPET, True), payload={"gid": gid})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not read the group"))
    g = res["group"]
    from balabot.groups import mention_targets  # noqa: E402
    targets = mention_targets(text, g["members"]) or list(g["members"])
    tail = g["transcript"][-6:]
    context = "\n".join(f"{e['from']}: {e['text']}"
                        for e in tail if e.get("kind") != "error")

    results = []
    for bot in targets:
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in g["sessions"][bot]["messages"]
        ]
        content = ((f"[Group chat '{g['name']}' — recent transcript]\n"
                    f"{context}\n\n") if context else "") + text
        try:
            answer = await _upstream_turn(bot, history + [{"role": "user",
                                                           "content": content}])
            results.append({"bot": bot, "text": answer})
        except Exception as exc:  # noqa: BLE001 — honest per-member error row
            results.append({"bot": bot, "error": True,
                            "detail": f"{type(exc).__name__}: {exc}"})

    apply_res = _org_run(_wrap(_GROUPS_APPLY_SNIPPET, True), payload={
        "gid": gid, "text": text, "results": results})
    if not apply_res.get("ok"):
        if apply_res.get("status"):
            _org_status_error(apply_res)
        return unavailable(apply_res.get("reason", "could not record the round"))
    return {"ok": True, "results": results, "group": apply_res["group"]}


async def _upstream_turn(profile: str, messages: list[dict]) -> str:
    """Non-streaming single turn against the profile's OpenAI-compatible API."""
    url = f"{UPSTREAM}/p/{profile}/v1/chat/completions"
    headers = {"Authorization": f"Bearer {API_KEY}",
               "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
        r = await client.post(url, json={"model": profile, "messages": messages,
                                         "stream": False},
                              headers=headers)
        if r.status_code != 200:
            raise RuntimeError(f"backend {r.status_code}: {r.text[:200]}")
        data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("backend returned no choices")
    return str(choices[0].get("message", {}).get("content", ""))


# ── Wave 6 P4: bot creation with consent (propose -> human approval ->
#    create -> fleet registration) ────────────────────────────────────────────
# State: <BALABOT_DATA_ROOT>/bot_creation/proposals.json in the container,
# via _org_run. The create step runs INSIDE the container (that is where the
# persona templates, skills and registry live) and appends to the fleet meta
# file (/opt/data/fleet/bots.json) the adapter reads, so a created bot
# appears in /api/fleet + /api/bots with no host-side state.

_PROPOSALS_LIST_SNIPPET = '''\
from balabot import bot_creation
print(json.dumps({'proposals': bot_creation.list_proposals()}))
'''

_PROPOSE_SNIPPET = '''\
from balabot import bot_creation
try:
    p = bot_creation.propose_bot(
        name=payload['name'], role=payload['role'],
        proposed_by=payload.get('proposed_by') or 'user',
        model=payload.get('model') or None)
except bot_creation.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'bad_request',
                      'detail': str(exc), 'status': 400}))
    raise SystemExit(0)
print(json.dumps({'proposal': p}))
'''

_APPROVE_SNIPPET = '''\
from balabot import bot_creation
try:
    p = bot_creation.approve_proposal(payload['pid'], approved_by='user')
except bot_creation.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'bad_request',
                      'detail': str(exc), 'status': 400}))
    raise SystemExit(0)
print(json.dumps({'proposal': p}))
'''

_REJECT_SNIPPET = '''\
from balabot import bot_creation
try:
    p = bot_creation.reject_proposal(payload['pid'])
except bot_creation.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'bad_request',
                      'detail': str(exc), 'status': 400}))
    raise SystemExit(0)
print(json.dumps({'proposal': p}))
'''

_CREATE_BOT_SNIPPET = '''\
import json, os, pathlib
from balabot import bot_creation, orgs
fleet_path = pathlib.Path('/opt/data/fleet/bots.json')
fleet = {}
if fleet_path.exists():
    try:
        fleet = json.loads(fleet_path.read_text(encoding='utf-8'))
    except Exception:
        fleet = {}
try:
    row = bot_creation.create_approved_bot(payload['pid'], fleet_bots=fleet)
except bot_creation.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'bad_request',
                      'detail': str(exc), 'status': 400}))
    raise SystemExit(0)
# The snippet may run as root while the Hermes gateway runs as the 'hermes'
# user. A profile it cannot read is a silently broken bot (cron/logs init
# die with EACCES), so hand the new artifacts to the gateway's uid. No pwd
# module (Windows) or no hermes user -> nothing to hand over; skip.
try:
    import pwd as _pwd
    uid = _pwd.getpwnam('hermes').pw_uid
except Exception:
    uid = None
if uid is not None:
    hermes_home = os.environ.get('HERMES_HOME', '/opt/data')
    for sub in ('profiles/' + row['bot_id'], 'workspace/' + row['bot_id']):
        target = pathlib.Path(hermes_home) / sub
        if target.exists():
            for p in [target, *target.rglob('*')]:
                try:
                    os.chown(str(p), uid, uid)
                except OSError:
                    pass
fleet_path.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(str(fleet_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w', encoding='utf-8') as fh:
    json.dump(fleet, fh, indent=2, sort_keys=True)
members = orgs.show_org(orgs.list_orgs()[0]['id'])['members'] \\
    if orgs.list_orgs() else []
print(json.dumps({'proposal': {k: row[k] for k in
                  ('id', 'bot_id', 'name', 'role', 'proposed_by',
                   'approved_by', 'status', 'created_result')},
                  'bot': row['bot'],
                  'org_members': members}))
'''

_CREATED_BOTS_SNIPPET = """python3 - <<'PY'
import json, pathlib
p = pathlib.Path('/opt/data/fleet/bots.json')
print(json.dumps(json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}))
PY"""


def _created_bots() -> dict[str, dict]:
    """Created-bot meta from the container's fleet/bots.json ({} on any failure)."""
    out = _docker_exec(_CREATED_BOTS_SNIPPET)
    if out is None:
        return {}
    try:
        data = json.loads(out.strip().splitlines()[-1])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _all_bot_meta() -> dict[str, dict]:
    """Shipped + created bots. Created bots come from the container's own
    registry file — the single source of truth, so nothing is invented here."""
    meta = {p: dict(templateId="tmpl_generic", **BOT_META[p]) for p in PROFILES}
    for bot_id, row in _created_bots().items():
        if isinstance(row, dict) and row.get("name"):
            meta[bot_id] = dict(row, templateId="tmpl_generic")
    return meta


@app.get("/api/bot-proposals")
def bot_proposals_list():
    if not container_ok():
        return unavailable("balabot container is not running — no proposals")
    res = _org_run(_wrap(_PROPOSALS_LIST_SNIPPET, False))
    if not res.get("ok"):
        return unavailable(res.get("reason", "could not read the proposal store"))
    return {"available": True, "proposals": res.get("proposals", [])}


@app.post("/api/bot-proposals")
async def bot_proposals_create(request: Request):
    """File a proposal. `proposed_by` may be a bot (peer creation) or 'user'."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    name = body.get("name") or ""
    role = body.get("role") or ""
    if not name or not role:
        raise HTTPException(status_code=400, detail="name and role are required")
    proposed_by = body.get("proposed_by") or "user"
    if proposed_by != "user" and proposed_by not in _all_bot_meta():
        raise HTTPException(status_code=404,
                            detail=f"unknown proposing bot {proposed_by!r}")
    if not container_ok():
        return unavailable("balabot container is not running — cannot file proposals")
    res = _org_run(_wrap(_PROPOSE_SNIPPET, True), payload={
        "name": name, "role": role, "proposed_by": proposed_by,
        "model": body.get("model")})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not file the proposal"))
    return {"proposed": True, "proposal": res["proposal"]}


@app.post("/api/bot-proposals/{pid}/approve")
def bot_proposals_approve(pid: str):
    """THE HUMAN CONSENT STEP. The human operator approves by name."""
    if not container_ok():
        return unavailable("balabot container is not running — cannot approve")
    res = _org_run(_wrap(_APPROVE_SNIPPET, True), payload={"pid": pid})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not record the approval"))
    return {"approved": True, "proposal": res["proposal"]}


@app.post("/api/bot-proposals/{pid}/reject")
def bot_proposals_reject(pid: str):
    if not container_ok():
        return unavailable("balabot container is not running — cannot reject")
    res = _org_run(_wrap(_REJECT_SNIPPET, True), payload={"pid": pid})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not record the rejection"))
    return {"rejected": True, "proposal": res["proposal"]}


@app.post("/api/bot-proposals/{pid}/create")
def bot_proposals_create_bot(pid: str):
    """Create + register the approved bot. The container-side snippet refuses
    any proposal that is not in the 'approved' state — consent is checked at
    the point of creation, not just assumed from the route."""
    if not container_ok():
        return unavailable("balabot container is not running — cannot create bots")
    res = _org_run(_wrap(_CREATE_BOT_SNIPPET, True), payload={"pid": pid},
                   timeout=120.0)
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not create the bot"))
    return {"created": True, "bot": res["bot"], "proposal": res["proposal"],
            "org_members": res.get("org_members", [])}


_PROPOSAL_DELETE_SNIPPET = '''\
from balabot import bot_creation
data = bot_creation._load()
before = len(data['proposals'])
data['proposals'] = [p for p in data['proposals'] if p['id'] != payload['pid']]
if len(data['proposals']) == before:
    print(json.dumps({'ok': False, 'error': 'not_found',
                      'detail': f"no proposal {payload['pid']!r}", 'status': 404}))
else:
    bot_creation._save(data)
    print(json.dumps({'deleted': True}))
'''


@app.delete("/api/bot-proposals/{pid}")
def bot_proposals_delete(pid: str):
    """Remove a proposal row (operator cleanup). A registered bot is NOT
    touched — deleting the proposal never deletes the bot."""
    if not container_ok():
        return unavailable("balabot container is not running")
    res = _org_run(_wrap(_PROPOSAL_DELETE_SNIPPET, True), payload={"pid": pid})
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not delete the proposal"))
    return {"deleted": True}


# ── Agent lifecycle: orphan classification, adoption, purge; roster
#    delete/edit. Same container-side pattern as the create route: the
#    lifecycle module runs INSIDE the container (that is where the profiles,
#    runtime dirs and the fleet roster live), driven via _org_run. ────────────

_LIFECYCLE_LIST_SNIPPET = '''\
from balabot import lifecycle
data = lifecycle.list_orphans()
print(json.dumps(data))
'''

_LIFECYCLE_ADOPT_SNIPPET = '''\
from balabot import lifecycle
try:
    meta = lifecycle.adopt_orphan(payload['name'])
except lifecycle.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'conflict',
                      'detail': str(exc),
                      'status': getattr(exc, 'status', 409)}))
    raise SystemExit(0)
print(json.dumps({'adopted': True, 'bot': meta}))
'''

_LIFECYCLE_PURGE_SNIPPET = '''\
from balabot import lifecycle
try:
    res = lifecycle.purge_orphan(payload['name'])
except lifecycle.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'conflict',
                      'detail': str(exc),
                      'status': getattr(exc, 'status', 409)}))
    raise SystemExit(0)
print(json.dumps({'deleted': True, 'profile': res['profile'],
                  'removed': res['removed'], 'roster_row': res['roster_row']}))
'''

_LIFECYCLE_REAP_SNIPPET = '''\
from balabot import lifecycle
res = lifecycle.reap_subagent_artifacts()
print(json.dumps({'reaped': res['reaped'], 'count': res['count']}))
'''

_LIFECYCLE_DELETE_BOT_SNIPPET = '''\
from balabot import lifecycle
try:
    res = lifecycle.delete_registered_bot(payload['bot_id'])
except lifecycle.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'conflict',
                      'detail': str(exc),
                      'status': getattr(exc, 'status', 409)}))
    raise SystemExit(0)
print(json.dumps({'deleted': True, 'bot_id': res['bot_id'],
                  'removed': res['removed'], 'org_removed': res['org_removed']}))
'''

_LIFECYCLE_UPDATE_BOT_SNIPPET = '''\
from balabot import lifecycle
try:
    row = lifecycle.update_registered_bot(payload['bot_id'], fields=payload['fields'])
except lifecycle.CreationError as exc:
    print(json.dumps({'ok': False, 'error': 'bad_request',
                      'detail': str(exc),
                      'status': getattr(exc, 'status', 400)}))
    raise SystemExit(0)
print(json.dumps({'updated': True, 'bot': row}))
'''


@app.get("/api/orphans")
def orphans_list():
    """Unrostered profile dirs, honestly classified. Never invented rows —
    the container's own profiles tree is the source."""
    if not container_ok():
        return unavailable("balabot container is not running — no profile data")
    res = _org_run(_wrap(_LIFECYCLE_LIST_SNIPPET, False), timeout=60.0)
    if not res.get("ok"):
        return unavailable(res.get("reason", "could not read the profiles tree"))
    return {"available": True, **{k: v for k, v in res.items() if k != "ok"}}


@app.post("/api/orphans/{name}/adopt")
def orphans_adopt(name: str):
    if not container_ok():
        return unavailable("balabot container is not running — cannot adopt")
    res = _org_run(_wrap(_LIFECYCLE_ADOPT_SNIPPET, True), payload={"name": name},
                   timeout=60.0)
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not adopt the profile"))
    return {"adopted": True, "bot": res["bot"]}


@app.delete("/api/orphans/{name}")
def orphans_purge(name: str):
    if not container_ok():
        return unavailable("balabot container is not running — cannot purge")
    res = _org_run(_wrap(_LIFECYCLE_PURGE_SNIPPET, True), payload={"name": name},
                   timeout=60.0)
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not purge the profile"))
    return res


@app.post("/api/orphans/reap")
def orphans_reap():
    """Reap every empty-shell profile (no SOUL.md, no config.yaml) — sub-agent
    debris that got a profile-shaped footprint. Shipped + `default` are never
    touched (the module skips FORBIDDEN_NAMES). Real orphan profiles are NOT
    reaped: they are a person's work and need an explicit adopt-or-purge."""
    if not container_ok():
        return unavailable("balabot container is not running — cannot reap")
    res = _org_run(_wrap(_LIFECYCLE_REAP_SNIPPET, False), timeout=120.0)
    if not res.get("ok"):
        return unavailable(res.get("reason", "could not reap sub-agent artifacts"))
    return {"reaped": res.get("reaped", []), "count": res.get("count", 0)}


@app.delete("/api/bots/{bot_id}")
def bots_delete(bot_id: str):
    """Delete a persistent user-created bot. Refuses principal/governor."""
    if not container_ok():
        return unavailable("balabot container is not running — cannot delete bots")
    res = _org_run(_wrap(_LIFECYCLE_DELETE_BOT_SNIPPET, True),
                   payload={"bot_id": bot_id}, timeout=120.0)
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not delete the bot"))
    return res


@app.patch("/api/bots/{bot_id}")
async def bots_update(bot_id: str, request: Request):
    """Edit a persistent bot's metadata (any subset of
    name/title/description/icon/color). Refuses principal/governor."""
    try:
        fields = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="body must be JSON")
    if not isinstance(fields, dict) or not fields:
        raise HTTPException(status_code=400,
                            detail="at least one field is required")
    if not container_ok():
        return unavailable("balabot container is not running — cannot edit bots")
    res = _org_run(_wrap(_LIFECYCLE_UPDATE_BOT_SNIPPET, True),
                   payload={"bot_id": bot_id, "fields": fields}, timeout=60.0)
    if not res.get("ok"):
        if res.get("status"):
            _org_status_error(res)
        return unavailable(res.get("reason", "could not update the bot"))
    return {"updated": True, "bot": res["bot"]}


# ── the chat turn: SSE passthrough to the profile's OpenAI-compatible API ────
@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    profile = body.get("bot_id") or ""
    # Shipped profiles plus bots created through the consent flow. A created
    # bot's Hermes profile exists in the container, so its listener answers
    # the same way the shipped ones do; the upstream 404s (honestly, below)
    # if the gateway has not raised a listener for it yet.
    if profile not in _all_bot_meta():
        raise HTTPException(status_code=404, detail=f"unknown bot {profile}")
    messages = body.get("messages") or []
    url = f"{UPSTREAM}/p/{profile}/v1/chat/completions"
    payload = {"model": profile, "messages": messages, "stream": True}
    headers = {"Authorization": f"Bearer {API_KEY}",
               "Content-Type": "application/json"}

    async def stream():
        try:
            # Pending org requests for this profile are emitted FIRST, as
            # server-side SSE frames in the same grammar as `event: handoff`.
            # Metadata only (name/description/requestedBy) — a secret value can
            # never enter a frame.
            for frame in _drain_org_request_frames(profile):
                yield frame
            async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as r:
                    if r.status_code != 200:
                        detail = (await r.aread()).decode("utf-8", "replace")[:300]
                        yield (f"event: error\ndata: "
                               f"{json.dumps({'message': f'backend {r.status_code}: {detail}'})}\n\n")
                        return
                    async for chunk in r.aiter_bytes():
                        # pass the upstream bytes through untouched
                        yield chunk
        except Exception as exc:  # noqa: BLE001
            yield (f"event: error\ndata: "
                   f"{json.dumps({'message': f'{type(exc).__name__}: {exc}'})}\n\n")

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ── SPA ──────────────────────────────────────────────────────────────────────
app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{full_path:path}")
def spa(full_path: str):
    candidate = DIST / full_path
    if full_path and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app,
                host=os.environ.get("BALABOT_UI_HOST", "127.0.0.1"),
                port=int(os.environ.get("BALABOT_UI_PORT", "9119")),
                log_level="warning")
