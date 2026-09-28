---
type: reference
timestamp: 2026-08-18T19:21:19Z
title: Open Knowledge Format v0.2
description: Google Cloud's vendor-neutral knowledge format. Directory of markdown plus YAML frontmatter.
resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
tags: [okf, spec]
status: stable
generated: { by: chief-of-staff/okf-init, at: 2026-08-18T19:14:05Z }
sources:
  - id: spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: okf/SPEC.md
    author: team:google-cloud-data
  - id: blog
    resource: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing
    title: How the Open Knowledge Format can improve data sharing
---

# What it is

OKF v0.2 is a directory of markdown files with YAML frontmatter.[^spec] No registry, no SDK. If you can `cat` a file, you can read it.

# What we implement

- Required `type` on every concept
- Reserved `index.md` and `log.md`
- `generated` / `verified` / `status` / `stale_after` / `sources`
- Actors: `agent/tool`, `human:name`, `process:name`
- Bundle-relative links starting with `/`
- `references/` for external material

We are not using Attested Computation yet. Add it when a number must be recomputed the same way every time.

# Spec

https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md

[^spec]: okf/SPEC.md
