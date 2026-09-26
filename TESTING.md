# Testing

BalaBot ships with four layers of verification. The simulations are part of the
test suite by design — they encode the architecture's hard promises as executable
scenarios, not prose.

```bash
pip install -r requirements-dev.txt
pytest -q                       # unit tests + all simulations + all user scenarios
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

## 3. User-usage scenarios (`tests/simulations/sim_user_scenarios.py`)

Where the simulations above protect a single *invariant*, these are **end-to-end
user journeys** — a person talks to the agents and gets an outcome, exercising the
abilities in `docs/architecture.md`. 21 top-level scenarios, each its own pytest
test, each also runnable standalone:

```bash
python tests/simulations/sim_user_scenarios.py
```

| Scenario | The user-visible ability it exercises |
|---|---|
| `day_one_install` | principal + governor present before you say anything |
| `missing_key_refuses_to_start` | no Jev key → refuses, naming the dependency |
| `principal_onboards_first_agent` | the first agent you talk to creates your first worker |
| `roster_routes_to_the_right_agent` | "that's B's area — I've told them" |
| `delegate_keeps_agent_available_and_reviews` | parent stays responsive, then reviews the child |
| `subagent_never_sees_parent_history` | sub-agent isolation and invisibility |
| `peer_creation_on_user_request` | any persistent agent may create a peer, because you asked |
| `peer_creation_without_user_request_refused` | …and may not when you didn't |
| `principal_restarts_a_frozen_agent` | live process query beats a lying status |
| `principal_cannot_touch_secrets` | secrets and grants are the user's alone |
| `user_overrules_the_principal` | only the user may replace the principal |
| `frustration_pipeline_end_to_end` | all four layers, measured as a **rate** before/after |
| `false_positive_does_not_punish` | a sensor is not a verdict — nothing auto-punishes |
| `jev_outage_stops_the_growth_loop_loudly` | fail loud, never silently degrade |
| `decision_gate_fails_open` | bloat is recoverable; a lost decision is not |
| `ledger_is_okf_and_shared_with_subagents` | OKF-shaped, readable by sub-agents too |
| `memory_recall_is_wide_and_jev_prunes` | recall never gated; Jev prunes the injection risk |
| `memory_poisoning_is_screened` | injection screened FIRST, before relevance |
| `irreversible_action_never_left_to_system_one` | send/spend/delete/publish keep a reasoner |
| `per_mode_model_selection` | per-mode overrides leave the default intact |
| `session_new_vs_resume_after_topic_shift` | spans, one verdict per candidate, index-and-retrieve |

### Proving the scenarios can fail

A green suite is worthless if it cannot go red. `mutation_check.py` breaks one
documented ability at a time and asserts the guarding scenario **fails**:

```bash
python tests/simulations/mutation_check.py
# RESULT: 8/8 mutations detected — every scenario genuinely fails when its ability breaks
```

Mutations covered: gate fails closed · permissions stop enforcing · principal
allowed to read secrets · roster stops routing · skill edited without classifying
the cause · injection screening disabled · Jev silently degrades · sub-agents
locked out of the ledger. A MISSED mutation means that scenario is decorative.

The file is deliberately not named `test_*.py`/`sim_*.py` so pytest never
collects it — it breaks the system on purpose.

## 4. Docker end-to-end (`tests/e2e/`)

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
