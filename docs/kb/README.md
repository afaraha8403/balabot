---
type: playbook
timestamp: 2026-10-23T23:30:00Z
title: How to use the BalaBot Knowledge Base
description: Operating rules for reading and writing this OKF v0.2 bundle. Required for every current and future agent.
tags: [okf, kb, agents, balabot]
status: stable
generated: { by: antigravity/okf, at: 2026-10-23T23:30:00Z }
sources:
  - id: okf-spec
    resource: references/okf-spec.md
    title: Open Knowledge Format v0.2
    author: team:google-cloud-data
    last_modified: 2026-08-18
  - id: prd-pi-durable
    resource: ../PRD-PI-DURABLE.md
    title: BalaBot Modernization PRD
---

# Start here

This folder is the **BalaBot knowledge bundle**. It follows [OKF v0.2](references/okf-spec.md).[^okf-spec]

This KB is for **facts, specifications, architecture decisions, and playbooks the team treats as ratified knowledge**.
The authoritative master architecture specification is **[PRD-PI-DURABLE.md](../PRD-PI-DURABLE.md)**.[^prd-pi-durable]

# Read before you invent

1. Open [index.md](index.md).
2. Open only the subdirectory you need:
   - `plans/`: Modern migration plans and historical records
   - `reference/`: Internal architecture specifications
   - `references/`: External specifications (e.g. OKF v0.2)
   - `product/`: Product facts, capabilities, and pricing
   - `team/`: Personas (`principal`, `governor`), operating model, roster
   - `launch/`, `strategy/`, `seo/`: GTM playbooks and strategy
3. Read the concept's frontmatter first (`type`, `status`, `verified`, `stale_after`).
4. Unverified or `draft` concepts are usable. Do not treat them as Ali-signed.
5. `human:` in `verified` means a person confirmed it. That is the highest trust tier.
6. If `today >= stale_after`, warn and refresh from the `sources` before using the claim.

# Write a concept

Every non-reserved `.md` file MUST have YAML frontmatter with a non-empty `type`.

Reserved filenames (never use these as concepts): `index.md`, `log.md`.

```yaml
---
type: playbook
title: Short display name
description: One sentence summary.
tags: [balabot, topic]
status: draft
generated: { by: research/okf, at: 2026-10-23T00:00:00Z }
sources:
  - id: src-1
    resource: https://example.com
    title: Source title
---
```

Actor convention:

- `principal/<tool>` for Principal Bot
- `governor/<tool>` for Governor Bot
- `research/<tool>` for Research Agent
- `human:ali-farahat` for Ali
- `process:<name>` for automation

`status`: `draft` | `stable` | `deprecated` | `superseded`. Absent means `stable`.

# Where things go

| Kind | Path |
|------|------|
| Modern Build Plans | `/plans/` |
| Internal Architecture & Design | `/reference/` |
| External Specifications | `/references/` |
| Product Facts & Features | `/product/` |
| Personas & Operating Model | `/team/` |
| Launch Playbooks | `/launch/` |
| Strategy & Pricing | `/strategy/` |
| Technical SEO | `/seo/` |

Link with relative paths: `[Pi Durable Architecture](reference/pi-durable-architecture.md)`.

Attribute claims with footnotes keyed to `sources[].id`.

# After you write

1. Update the nearest `index.md` with title, relative link, and description.
2. Append a newest-first entry to the nearest `log.md` under `## YYYY-MM-DD`.
3. Do not put temporary raw test scratch files here; keep them in temporary scratch directories.

# Spec

Full spec: [OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Local note: [okf-spec](references/okf-spec.md).

[^okf-spec]: Open Knowledge Format v0.2
[^prd-pi-durable]: Product Requirements Document: BalaBot Modernization
