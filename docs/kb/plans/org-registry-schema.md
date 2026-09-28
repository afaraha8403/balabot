---
type: design
title: BalaBot — org, grant and secret registry schema
description: The one registry shape behind orgs, cross-org grants, secret delivery and org-scoped skills. Design for sign-off before Wave 4 builds on it. Derived from the org-secrets-and-skills spec, not invented.
resource: C:/Users/ali/workspace/balabot
tags: [balabot, org, grants, secrets, schema, design, wave3]
timestamp: 2026-09-27T07:15:00Z
---

# Org, grant and secret registry — schema

Wave 3 is the foundation for waves 4-7 (secret delivery, skill scoping, per-org computers).
Everything above it is mechanical; this shape is not. It follows the spec's own rule:
**one grant registry, one shape.**

```
principal (bot) → resource { org, kind: secret | skill | workspace | display } → access
```

A **cross-org grant is not a special case** — it is simply a grant whose resource lives in a
different org. Same table, same revocation path, same audit trail.

## 1. Two stores, deliberately separated

| Store | Path | Holds | Never holds |
|---|---|---|---|
| **Registry** | `/opt/data/orgs/registry.json` | orgs, members, resources, grants, fingerprints | any secret value |
| **Secret store** | `/opt/data/.secrets/<org>/<NAME>` (0600) | the raw values | anything else |

Why split: the registry is safe to read, log, diff, display and back up. The secret store is not.
Keeping them in one file would mean every grant listing risked carrying a value with it.

`/opt/data` is the persistent volume, and `.secrets/` is a secrets location — satisfying the rule
*never `workspace/`, never a vault note*. The vault records only **that** a secret exists, its name
and its scope.

## 2. Registry shape

```json
{
  "version": 1,
  "orgs": {
    "balacode": {
      "id": "balacode",
      "name": "Balacode",
      "members": ["principal", "governor"],
      "computer": { "container": "agent-computer-balacode", "manifest": "fleet/balacode.json" },
      "created_at": "2026-09-27T00:00:00Z"
    }
  },
  "secrets": [
    { "name": "STRIPE_SECRET_KEY", "org": "balacode", "description": "...",
      "fingerprint": "…4f2a", "created_at": "...", "rotated_at": null }
  ],
  "grants": [
    {
      "id": "g_01J...",
      "subject":    { "kind": "bot", "id": "principal" },
      "subject_org": "balacode",
      "resource":   { "kind": "secret", "name": "STRIPE_SECRET_KEY" },
      "resource_org": "balacode",
      "scope": "bot",
      "access": "inject",
      "created_at": "...", "created_by": "user",
      "revoked_at": null
    }
  ]
}
```

**Field notes**

- `resource.kind` ∈ `secret | skill | workspace | display` — the spec's four kinds.
- `scope` ∈ `bot | org` — `bot` = named bots only, `org` = every bot in `subject_org`.
  This is exactly skill precedence `org grant (specific) > org grant (all)`.
- `access` ∈ `inject | read`. **`inject` is the default and the only ordinary one** — the value is
  delivered as an injected env var and the bot can never read it. `read` is a deliberate, audited
  exception, not routine.
- `subject_org != resource_org` ⟹ **cross-org grant**. No extra field, no extra table.
- **Revocation = set `revoked_at`**, never delete. The audit trail is the point.

## 3. Secret delivery — Option A (the spec's recommendation)

Point `secrets.command.command` at a helper that reads the registry, filters by the calling profile's
live grants (cross-org included), and prints `KEY=VALUE` lines. Zero new Hermes code, and
`secrets.profile_alias: true` gives "org secret granted to one bot" for free.

Option B (a `SecretSource` plugin) is deferred until the fleet grows, per the spec.

## 4. Hard rules (binding, from the spec)

- No secret value ever in: transcript, SSE frame, model context, logs, vault, workspace, or **argv**.
- Only fingerprints (`…` + last 4) and metadata are displayed or recorded.
- Bot tools return `{saved, name, fingerprint}` — never the value.
- A value that lands in chat anyway is **burned and rotated**, not merely deleted.
- The secret store is never reachable from the SPA except through the approved path.

## 5. Open decisions for Ali

1. **First org id** — the spec suggests today's build becomes org `balacode`. Confirm the id.
2. **Secret store granularity** — one file per secret (chosen: simple, auditable, diffable) versus a
   single sealed bundle. The per-file choice leaks the *names* to anyone with volume access, never
   the values. Acceptable?
3. **`read` access** — keep it in the schema but refuse it in code until a real need appears?
   Recommended: yes, refuse by default.

## 6. What Wave 3 builds

1. The registry + a read-only inspector CLI (`python -m balabot.orgs list|grants|show <org>`).
2. The secret-delivery helper, wired into the profiles as `secrets.command.command`.
3. Proof: a granted bot receives the var; a non-granted bot does not.
