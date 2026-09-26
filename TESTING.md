# Testing

BalaBot ships with three layers of verification. The simulations are part of the
test suite by design — they encode the architecture's hard promises as executable
scenarios, not prose.

```bash
pip install -r requirements-dev.txt
pytest -q                       # unit tests + all simulations
```

## 1. Unit + integration tests (`tests/`)

| File | Covers |
|---|---|
| `test_bootstrap.py` | first-boot provisioning: forced config deltas, `bot_token` exactly empty, rules file in the **workspace** (not the profile dir), `SOUL.md` in the profile, skills under `skills/<category>/<skill>/`, idempotency, and that no secret value is ever printed |
| `test_jev.py` | the hard dependency: missing key raises, **no fallback path**, 4xx never retried, transient retried then fails loud, real documented response shapes |
| `test_memory_relevance.py` | the ladder: one Noul per candidate, threshold keep, re-look on empty, explicit "no relevant memory", shadow mode, malformed answers raise |

No network. No API keys. Deterministic.

## 2. Architecture simulations (`tests/simulations/`)

Each file proves **one** hard promise and is runnable both under pytest and standalone
(`python tests/simulations/<name>.py`) — it prints a PASS/FAIL line per assertion,
names which promise broke, and exits non-zero on any failure.

| Simulation | The promise it protects |
|---|---|
| `sim_jev_outage.py` | **Fail loud, never silently degrade.** Jev unreachable → an incident is raised, never a quiet fallback. Also: no fallback path exists, 4xx is not retried, the error names Jev. |
| `sim_hierarchy_permissions.py` | The permission matrix — including that the **deny** cells deny. The principal has no secret/grant authority; the user is never overruled; a persistent agent may create a peer when the user asks; sub-agents cannot. |
| `sim_secret_nonleakage.py` | *The interface is in the chat, the value never is.* A secret VALUE never appears in stdout/stderr, generated config, ledger records, or a return payload — only a fingerprint and the grant list. |
| `sim_decision_gate_failopen.py` | The ledger gate is tuned to **over-admit**: a bloated ledger is recoverable, a missing decision is not. Contradictions are flagged, never silently reconciled. |
| `sim_session_routing.py` | Front matter records topics **with spans**, never a merged string; new-vs-resume uses **one Noul per candidate, never a Choice** (a Choice forces a winner when the answer is "none"); the A/B/C case resolves by **index-and-retrieve, not folding**. |
| `sim_memory_ladder.py` | Recall is never gated; ONE Jev call with one Noul per candidate; thresholds are per question shape; nothing clears → the re-look ladder runs; still nothing → an explicit "no relevant memory" rather than weak facts injected as if they mattered. |
| `sim_frustration_pipeline.py` | dictionary → Jev → governor → principal. The net over-captures freely, Jev does the precision, the signal is **evidence not a verdict** (never auto-punishes), and the metric is the **frustration rate** measured before/after. |

## 3. Docker end-to-end (`tests/e2e/`)

Drives the **real image** through the **real entrypoint**:

```bash
bash tests/e2e/e2e_docker.sh balabot:test
```

Asserts: the image builds; **no Jev key → exit 1** with a loud message; both personas
provision with config, `SOUL.md`, workspace rules and installed skills; the principal's
config carries `memory.provider=holographic` and an **empty** telegram token; and — when
a key is present — a live model round-trip returns `BALABOT_OK`.

> **Pitfall worth knowing:** overriding the entrypoint with `--entrypoint sh` skips the
> image's `cont-init` hooks, which fix directory ownership before Hermes (a privilege-drop
> shim) runs. That produces a misleading `Permission denied: .../profiles/<x>/cron` which
> the real startup path never hits. Smoke-test through the real entrypoint.

Without a key the live step reports **SKIP**, never a pass.
