# BalaBot UI adapter (`server.py`)

Serves the built product UI on **:9119** and fronts the agents' OpenAI-compatible API.

```
node ui_e2e.mjs / browser ──▶ :9119 (server.py, HTTP basic auth)
                                  ├─ static: ui/dist  (SPA, falls back to index.html)
                                  └─ /api/chat ──▶ http://127.0.0.1:8642/p/<profile>/v1/chat/completions
```

## Run

```bash
"$HERMES_VENV/Scripts/python.exe" server.py      # binds 127.0.0.1:9119
```

Requires, and refuses to start without:

| Input | Where it is read from |
|---|---|
| `API_SERVER_KEY` | `../.env` (the repo root `.env`) |
| Dashboard password | `~/secrets/balabot-dashboard.key` (or env) |

The upstream key is used **server-side only** — it is never sent to the browser,
never logged, and never placed in a response body.

## Why one upstream port

Hermes runs **one multiplexed gateway per host** (`gateway-default`) that fronts
every profile. Each profile's OpenAI-compatible API is a path on that one
listener, not its own port:

```
principal → http://127.0.0.1:8642/p/principal/v1
governor  → http://127.0.0.1:8642/p/governor/v1
```

The OpenAI `model` field is the **profile name**. Auth is the **profile-scoped**
`API_SERVER_KEY`. Per-profile `gateway.api_server.port` values are ignored while
multiplexing is on.

## Endpoints

| Endpoint | Backing source | Honest when absent? |
|---|---|---|
| `GET /healthz` | liveness | — |
| `GET /api/fleet` | container state + upstream `/v1/models` + `bots` for the UI's boot path | — |
| `GET /api/bots` | the shipped bot roster | — |
| `GET /api/agents` | `/opt/data/profiles/*/config.yaml` + s6 service states | — |
| `GET /api/ops` | `s6-svstat` for the **four real services** | reports `dormant` for the un-raised tunnel |
| `GET /api/memory` | `/opt/data/profiles/<p>/memory_store.db` (`facts` table) | `available:false` + reason |
| `GET /api/cost` | `/opt/data/profiles/<p>/state.db` (`session_model_usage`) | `available:false` + reason |
| `GET /api/decisions` | no Jev decision log exists yet | `available:false` + reason |
| `GET /api/governance` | no OKF ledger directory under `/opt/data` yet | `available:false` + reason |
| `POST /api/chat` | SSE passthrough to `/p/<profile>/v1/chat/completions` | — |
| `GET /api/computer/{id}/frame`, `POST …/action` | agent computer | `available:false` + reason |

### The honesty contract

Every data endpoint returns **either** real rows **or** an explicit refusal:

```json
{"available": false, "reason": "the holographic memory store is empty — no facts have been recorded yet"}
```

The UI renders that `reason` verbatim in an empty state. Sample data is never
substituted for live data; `src/mockData.ts` has been removed entirely now that
every screen is wired. This matters because a screen that shows invented numbers
is worse than a screen that says "nothing here yet".

### Two traps this adapter avoids, both of which make a healthy system look broken

1. **`/api/fleet` must include `bots`.** The UI boots by calling it and reading
   `raw.bots`, falling back to `/api/bots` only if the call *throws*. Returning a
   fleet shape without `bots` succeeds with an undefined list, so the roster
   renders "No bots in the roster yet." and the fallback never fires.
2. **Never probe `gateway-<profile>`.** There is no per-profile gateway service;
   doing so invents services and reports them `down`.

## Verification

`tests/e2e/ui_e2e.mjs` drives the real UI in a stealth browser and asserts on the
rendered DOM (7 scenarios). It is proven able to fail: a wrong password or a dead
port drops it to 1/7.

```bash
PASSWORD=... BASE=http://127.0.0.1:9119 node ../tests/e2e/ui_e2e.mjs
```
