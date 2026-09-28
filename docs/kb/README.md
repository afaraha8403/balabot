---
type: playbook
timestamp: 2026-08-18T19:28:52Z
title: How to use the Kalam KB
description: Operating rules for reading and writing this OKF v0.2 bundle. Required for every current and future agent.
tags: [okf, kb, agents]
status: stable
generated: { by: chief-of-staff/okf, at: 2026-08-18T19:28:00Z }
sources:
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format v0.2
    author: team:google-cloud-data
    last_modified: 2026-08-18
---

# Start here

This folder is the Kalam knowledge bundle. It follows [OKF v0.2](/references/okf-spec.md).[^okf-spec]

[[GrokBot/scratchpad/README|GrokBot/scratchpad/]] is for unratified drafts. Drive Development, Marketing, and Media are for ratified artifacts. This KB is for **facts and playbooks the team should treat as knowledge**. Drive KB (OKF) and Drive Scratchpad were retired. Do not recreate them.

# Read before you invent

1. Open [index.md](/index.md).
2. Open only the subdirectory you need (`product/`, `team/`, `launch/`, `references/`, or newer folders).
3. Read the concept's frontmatter first (`type`, `status`, `verified`, `stale_after`).
4. Unverified or `draft` concepts are usable. Do not treat them as Ali-signed.
5. `human:` in `verified` means a person confirmed it. That is the highest trust tier.
6. If `today >= stale_after`, warn and refresh from the `sources` before using the claim.

Also query Notebook LM (Startup Marketing Brain, then Sales / SEO / Balacode KB) before inventing a marketing or launch play. Oscar starts every research job there.

# Write a concept

Every non-reserved `.md` file MUST have YAML frontmatter with a non-empty `type`.

Reserved filenames (never use these as concepts): `index.md`, `log.md`.

```yaml
---
type: playbook
title: Short display name
description: One sentence.
tags: [launch]
status: draft
generated: { by: research/okf, at: 2026-08-18T00:00:00Z }
sources:
  - id: src-1
    resource: https://kalamvoice.com
    title: Kalam site
---
```

Actor convention:

- `chief-of-staff/<tool>` for Steve
- `launch-master/<tool>` for Jim
- `research/<tool>` for Oscar
- `human:ali-farahat` for Ali
- `process:<name>` for automation

`status`: `draft` | `stable` | `deprecated`. Absent means `stable`.

# Where things go

| Kind | Path |
|------|------|
| Product facts | `/product/` |
| Who does what | `/team/` |
| Launch playbooks | `/launch/` |
| External specs, mirrored sources | `/references/` |
| Unratified drafts | `GrokBot/scratchpad/`, not this bundle |

Link with bundle-relative paths: `[Kalam](/product/kalam.md)`.

Attribute claims with footnotes keyed to `sources[].id`.

# After you write

1. Update the nearest `index.md` with title, relative link, and description.
2. Append a newest-first entry to the nearest `log.md` under `## YYYY-MM-DD`.
3. Do not put launch copy, screenshots, or installer files here until they are ratified knowledge. Living drafts go in `GrokBot/scratchpad/`.
4. Do not touch the desktop app repo from launch or research work.

# Spec

Full spec: [OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Local note: [okf-spec](/references/okf-spec.md).

[^okf-spec]: Open Knowledge Format v0.2
