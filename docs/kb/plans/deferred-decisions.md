---
type: plan
title: GrokBot / BalaBot — decisions parked for later
description: Decisions Ali explicitly deferred, with the context needed to pick them up cold. Reviewed at each digest so nothing parked silently becomes forgotten.
tags: [grokbot, balabot, deferred, decisions, skills, resolved]
timestamp: 2026-09-27T00:00:00Z
status: open
---

# Decisions parked for later

Ali's standing instruction: surface parked items as we progress rather than deciding them
unilaterally. Nothing here is blocking; everything here is unresolved on purpose.

**Resolved:** item 1 (the skills question) — decided 2026-09-27. Kept in place with the outcome
recorded rather than deleted, so the reasoning is recoverable.

## 1. The skills question — **RESOLVED 2026-09-27**

**Ali's words (2026-09-26):** *"With regards to the skills, that's a decision we'll take later, so just
keep reminding me of it as we progress."*

**Ali's call (2026-09-27):** *"both of them should have [those skills] as well as other persistent
agents … add the skills. Obviously these skills are baked in and they ship with the product so they
can't really be removed unless we push a new version of them."*

**Decision taken: ship pre-loaded.** Of the two options noted below, Ali chose the second — personas
carry a real capability set on day one rather than growing into it. The shipped `skills/` directory
is the fleet-wide baseline (`install_skills()` copies it into every persona), so what lands there
reaches principal, governor and any future persistent agent.

**What was done:**

- Eight skills authored into `skills/`, each traceable to a documented role requirement and kept
  **thin** per `docs/architecture.md` → "The thin skill". Principal: `agent-liveness-recovery`,
  `agent-growth-review`, `owner-onboarding`. Governor: `okf-decision-ledger`, `contradiction-audit`,
  `untrusted-ingestion`. Shared: `workspace-law`, `delegation-discipline`.
- Measured afterwards: **principal 68 skills (10 BalaBot-shipped), governor 9 (was 1).**

**Two things were wrong, not one** — and only fixing both made the screen honest:

1. `skills/` held a single skill, so the governor carried almost nothing.
2. The Skill Library read `/api/org/skills/library`, which answers `{"available": false}` by design.
   The screen was structurally incapable of showing anything regardless of what agents carried.

**Consequence of the "baked in" framing:** these ship in the image, so a change reaches an installed
product only on a new image version. Editing them here does not update a running container.

### What the original note said, for the record

During the vault doc audit, two skill claims didn't survive checking:

- The architecture doc says TypeSafe's cookbook was built on *"Hermes' own 182-skill
  catalog."* Real counts today: **58 built-in + 137 optional = 195**, and **265
  installed** on the owner's profile. So 182 is a third-party figure that has since
  drifted — fine as a quotation, misleading as a description of current Hermes.
- `principal-and-governor.md` described each persona's skills as *"scoped set (56
  pruned)"* and *"(55 pruned)"*. The phrasing was ambiguous — 56 *removed*, or 56
  *remaining*? — and 2 skills looked thin for the agent whose remit is running the whole system.
  Both the row and that metric are corrected in that note.
