# SPEC — Bot authoring: how a persistent agent writes a new persistent agent

Status: **agreed with Ali (2026-09-30). Ready for implementation.**
Scope: `bot_creation.py`, `bootstrap.py`, `personas/`, the skills bundling, and a new authoring skill.

## The model (authoritative — from Ali)

1. **Any persistent agent may create another persistent agent** when the owner asks — not only the
   Principal. Whoever creates the bot **writes that bot's files**.
2. **The Governor is never involved in creation.** It has no role in this flow.
3. **`principal` and `governor` ship with their own markdown files (SOUL.md, AGENTS.md,
   config.template.yaml) pinned in the image. Those two are LOCKED — never generated, never edited, never
   overwritten at runtime.** (Already enforced: `lifecycle.py` refuses `EDITABLE_FIELDS` updates on shipped
   personas.)
4. **A creating agent must have an explicit skill it taps into** to author the new bot's files properly.
   The skill defines *how to write them*. **Every persistent agent gets that same skill**, so any of them
   can create a well-formed bot — not just the Principal.

## The defect this fixes

`bot_creation.py:326–331` provisions every created bot by copying **`PERSONAS[0]` = `principal`**:

```python
template_persona = bootstrap_mod.PERSONAS[0] if bootstrap_mod.PERSONAS else None
actions.extend(bootstrap_mod.provision_persona(bot_id, template_persona=template_persona)["actions"])
```

Verified live: `principal`, `beacon` and `qa-scout` have **byte-identical** `SOUL.md`
(md5 `62b144d9af345385bb10eb803e072478`). So a bot hired as *"Marketing & SEO"* believes it is the
**Principal System Operator**. Its role title, mission and domain skills are stored as roster display
metadata and are never given to the agent as its identity.

## The persona file set (what "the files" means)

Exactly three per persona, and each has a defined destination (`bootstrap.provision_persona`):

| File | Lands in | Purpose |
|---|---|---|
| `SOUL.md` | the profile dir | **Who the bot is** — voice, register, judgement |
| `AGENTS.md` | the bot's **workspace** dir (found by cwd walk-up) | **What it may do** — domain rules, scope walls |
| `config.template.yaml` | rendered into the profile's `config.yaml` | model, provider, forced deltas |

Plus: **which skills the new bot receives** (`bootstrap.install_skills`, currently
`DEFAULT_WORKER_SKILLS`).

## Required change

### 1. New skill: bot authoring
Ship a skill (working name **`bot-authoring`**) that teaches a creating agent how to author a new
persistent agent's files. It must specify:

- **The three files and their destinations**, so the author knows what lands where and why `AGENTS.md`
  goes to the workspace while `SOUL.md` goes to the profile.
- **SOUL.md = identity, not job description.** Voice, register, judgement, how it holds itself. It must
  *not* duplicate the roster description verbatim.
- **AGENTS.md = domain + boundaries.** What this bot may do, what it must refuse, what it escalates, where
  its scope ends. This is where the proposal's *mission* and *domain skills* become binding rules.
- **config.template.yaml** — the model/provider contract, including the forced deltas
  (`FORCED_MODEL_DEFAULT`, `FORCED_MODEL_PROVIDER`) that every persona must carry.
- **The skill set** the new bot receives, and why.
- **The hard rules:** never copy `principal`'s or `governor`'s content into a new bot; never write a
  runtime-created bot's files into the shipped `personas/` tree; the roster description is the *contract*
  the other bots route on, and the authored files are the *identity*.

### 2. Creation flow
Replace the `PERSONAS[0]` copy with: the **creating agent authors the three files** for the approved
bot (guided by the skill), then the provisioning path installs them exactly as it installs a shipped
persona's. The existing provisioner stays the mechanism — only the *source* of the files changes.

### 3. Skill distribution
Add the authoring skill to the set installed for **every persistent agent** (`DEFAULT_WORKER_SKILLS`
path), so any of them can create a bot. The shipped `principal` gets it too; `governor` does not
(no creation role).

### 4. Roster sharing (separate gap, same initiative)
Bots route to each other (`message_agent` enforces the roster) but **nothing gives a bot the roster with
titles and descriptions**, so "they know what each bot is for" is not yet true. The creating flow must
also make the roster's *name + title + description* legible to every persistent agent.

## Acceptance

1. Hire a bot ("marketing and SEO expert") and prove its `SOUL.md`/`AGENTS.md` are **about that bot**, and
   are **not** byte-identical to the Principal's.
2. Prove `principal` and `governor` files are **unchanged** after any creation (locked).
3. Prove a **non-Principal** persistent agent can create a bot with the same quality of authored files.
4. Prove a bot can see the roster (name/title/description of its peers).

## Related

- **Recursive Self-Improvement** — the improvement lifecycle (today the growth loop: frustration signal →
  governor ledger → `growth_job()` proposing one concrete change, audited and reversible, never
  auto-applied) is the mechanism that **keeps tuning these files after creation**. The Principal owns that
  cycle and must run it regularly. Naming: **"Recursive Self-Improvement"**.
