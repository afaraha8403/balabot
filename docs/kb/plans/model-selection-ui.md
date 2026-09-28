---
type: plan
title: BalaBot — model & provider selection UI
description: The settings surface for choosing the LLM provider and model, plus per-mode (auxiliary) model overrides. Grounded in Hermes' real config contract.
resource: https://hermes-agent.nousresearch.com/docs
tags: [balabot, models, providers, auxiliary, settings, ui, grokbot-web]
timestamp: 2026-09-26
---

# BalaBot — model & provider selection UI

## Requirement (Ali, 2026-09-26)

The user must be able to choose the **LLM provider** and the **LLM model** from the UI.

- **Default: OpenRouter + `deepseek/deepseek-v4.1-flash`** — text *and* images.
- Users may attach **other LLMs for specific modes** — e.g. a model used only for vision — exactly as
  the owner's own setup does.
- All of it reachable **through the UI**.

## The contract this must obey

**Settings live in `config.yaml`; secrets live in `.env` — never mixed, never logged.** Provider
choice and model slugs are *settings*. API keys are *secrets* and must ride the existing secret flow
(the `SecretRequestCard` path already built: "the interface is in the chat, the value never is").
The picker must never render, echo, or log a key value.

**Profiles are independent islands by design** — there is no live config inheritance, and none should
be invented. Per-agent model choice therefore means **per-profile** config, written through
`hermes -p <profile> config set`.

**Two config locations, not one:**

| What | Where | Example |
|---|---|---|
| Main provider + model | top-level `model.*` | provider `openrouter`, model `deepseek/deepseek-v4.1-flash` |
| Per-mode overrides | `auxiliary.<task>.*` | `auxiliary.vision.provider = openrouter` |
| Subagent model | **top-level `delegation.*`** — *not* `auxiliary.delegation` | see trap below |

## The modes list — 14 entries, 13 auxiliary + 1 special

Authoritative source: `_AUX_TASKS` in `hermes_cli/main_provider_setup.py`.

| Key | Name | What it covers |
|---|---|---|
| `vision` | Vision | image/screenshot analysis |
| `compression` | Compression | context summarization |
| `approval` | Approval | smart command approval |
| `mcp` | MCP | MCP tool reasoning |
| `title_generation` | Title generation | session titles |
| `review` | Review | `/review` reviewer subagent |
| `memory_query_rewrite` | Memory query rewrite | **memory retrieval queries** |
| `tts_audio_tags` | TTS audio tags | Gemini TTS tag insertion |
| `skills_hub` | Skills hub | skills search/install |
| `triage_specifier` | Triage specifier | kanban spec fleshing |
| `kanban_decomposer` | Kanban decomposer | task decomposition |
| `profile_describer` | Profile describer | auto profile descriptions |
| `curator` | Curator | skill-usage review pass |
| `delegation` | Delegation | **subagent model** (`delegate_task`) — special-cased |

### Two implementation traps

1. **`delegation` is NOT `auxiliary.delegation`.** Routing lives at top-level `delegation.*` because
   `delegate_task` spawns real child agents (`tools/delegate_tool.py::_resolve_delegation_credentials()`)
   which read that section directly. Writing it under `auxiliary` silently does nothing.
2. **"auto" for delegation means "inherit the parent" and is stored as EMPTY STRINGS.** Never persist
   the literal `"auto"` — it would be resolved as a provider name.

3. **Plugins register additional tasks** (`PluginContext.register_auxiliary_task`), surfaced via
   `_all_aux_tasks()`. The UI must fetch the list dynamically rather than hardcoding 13 — otherwise
   plugin-provided modes are invisible.

## Design

**Surface:** a `ModelSettingsDialog.tsx`, following the existing dialog pattern in
`ui/src/` (`AgentComputerDialog`, `BotPanelDialog`, `SkillLibraryDialog`, `SessionsDialog`).

**Two tiers, one screen:**
1. **Main model** — provider select → model select. Defaults pre-filled: OpenRouter +
   `deepseek/deepseek-v4.1-flash` (text + images).
2. **Per-mode overrides** — the 14 modes above, each defaulting to *"inherit main"*. Only the modes a
   user actually pins diverge. Vision is the expected first pin (a text-only main model needs another
   model for images — the owner's own setup pins Gemini for exactly this).

**API (BalaBot backend, same `_call_registry` hard-timeout pattern as the org endpoints):**
- `GET /api/org/models?profile=` → current main + per-mode overrides, with secrets **redacted**
- `PUT /api/org/models` → write main / per-mode selections to the profile's `config.yaml`
- `GET /api/providers/<provider>/models` → live model list from the provider's `/models` endpoint

**Validate before saving.** Enumerate the provider's `/models` and confirm the slug exists *before*
persisting. This is the owner's own debugging discipline productized — if the slug isn't in the
catalog, no amount of config tweaking will help, so the UI should refuse the save rather than write a
model that will fail at first call. Show a **Test** affordance next to Save.

**Pin, don't float.** Store explicit slugs. A default that silently re-points when a provider
renames a model changes agent behaviour with no code change — the same reason the Jev API version is
pinned.

## Why this matters beyond convenience

`memory_query_rewrite` — *"memory retrieval queries"* — is an existing auxiliary task. That is a
second, official insertion point for the memory pipeline, alongside the provider-level prefetch
rerank. The Jev relevance layer can work on **both** sides: how the query is formed, and which
results survive.

## Open

- Do mode overrides apply **per org** or **per agent**? Profiles are islands, so per-profile is the
  honest default; an org-level convenience layer would be BalaBot's own addition, not a Hermes feature.
- Credentials for a newly added provider: reuse the `SecretRequestCard` flow in-chat, or a dedicated
  keys pane in the dialog? Reusing the existing card keeps one code path for "value never is".
