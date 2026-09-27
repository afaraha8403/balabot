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
    /api/org/skills/library|pin|promote, /api/org/requests   available:false / empty
    POST /api/chat                      SSE passthrough to /p/<profile>/v1/chat/completions

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

ROOT = pathlib.Path(__file__).resolve().parent
DIST = ROOT / "dist"
ENV_FILE = pathlib.Path(r"C:/Users/ali/workspace/balabot/.env")
KEY_FILE = pathlib.Path(r"C:/Users/ali/secrets/balabot-dashboard.key")
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

API_KEY = ""
for _line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    if _line.startswith("API_SERVER_KEY="):
        API_KEY = _line.split("=", 1)[1].strip()
if not API_KEY:
    raise SystemExit("API_SERVER_KEY not found in balabot/.env — refusing to start")

DASHBOARD_USER = "ali"
DASHBOARD_PASSWORD = (KEY_FILE.read_text(encoding="utf-8").strip()
                      if KEY_FILE.exists() else "") or \
                     os.environ.get("BALABOT_DASHBOARD_PASSWORD", "")
if not DASHBOARD_PASSWORD:
    raise SystemExit("No dashboard password (secrets/balabot-dashboard.key or env)")

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


@app.get("/api/bots")
def bots():
    return {"bots": [dict(id=p, templateId="tmpl_generic", **BOT_META[p])
                     for p in PROFILES]}


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
    bots = [dict(id=p, templateId="tmpl_generic", **BOT_META[p]) for p in PROFILES]

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


# ── org surfaces: A-era concept, no B backing ────────────────────────────────
def _org_unavailable():
    return unavailable("orgs/secrets/grants were an earlier concept — the B "
                       "architecture has no org registry backing this endpoint")


@app.get("/api/orgs")
def orgs():
    return _org_unavailable()


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


@app.get("/api/org/requests")
def org_requests():
    return {"requests": []}  # keep the poller quiet; org layer is not wired


@app.api_route("/api/org/secrets", methods=["GET", "POST"])
@app.api_route("/api/org/grants", methods=["GET", "POST"])
@app.api_route("/api/org/skills/library", methods=["GET"])
@app.api_route("/api/org/skills/pin", methods=["POST"])
@app.api_route("/api/org/skills/promote", methods=["POST"])
async def org_endpoints(request: Request):
    return _org_unavailable()


# ── the chat turn: SSE passthrough to the profile's OpenAI-compatible API ────
@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    profile = body.get("bot_id") or ""
    if profile not in PROFILES:
        raise HTTPException(status_code=404, detail=f"unknown bot {profile}")
    messages = body.get("messages") or []
    url = f"{UPSTREAM}/p/{profile}/v1/chat/completions"
    payload = {"model": profile, "messages": messages, "stream": True}
    headers = {"Authorization": f"Bearer {API_KEY}",
               "Content-Type": "application/json"}

    async def stream():
        try:
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
    uvicorn.run(app, host="127.0.0.1", port=9119, log_level="warning")
