---
type: product
timestamp: 2026-08-19T18:08:51Z
title: Kalam
description: Windows-first desktop voice dictation. Hold a hotkey, speak, it types in any app.
resource: https://kalamvoice.com
tags: [product, pricing, support]
status: draft
generated: { by: chief-of-staff/okf-init, at: 2026-08-18T19:14:05Z }
sources:
  - id: site
    resource: https://kalamvoice.com
    title: kalamvoice.com
    last_modified: 2026-08-18
  - id: pricing
    resource: https://kalamvoice.com/pricing
    title: Kalam pricing
    last_modified: 2026-08-19
  - id: terms
    resource: https://kalamvoice.com/terms
    title: Kalam terms
    last_modified: 2026-08-19
  - id: ali-plans
    resource: note:ali-via-steve-2026-08-19
    title: Ali via Steve — local STT and BYOK on Free/Pro/Max; Max is the no-key path
    last_modified: 2026-08-19
  - id: ali-stream
    resource: note:ali-via-steve-2026-08-18
    title: Ali via Steve — kalam.stream is the old website; live site is kalamvoice.com
    last_modified: 2026-08-18
---

# What it is

Hold a hotkey, speak, release. Words appear at the cursor in any Windows app. Local Whisper and BYOK cloud STT work on Free, Pro, and Max. Kalam-hosted STT and AI (no key) is Max only.[^site][^pricing][^ali-plans]

Windows 10+ today. Mac and Linux are coming. Do not promise dates.

Company: Balacode. Docs: https://docs.kalamvoice.com. Live site is kalamvoice.com. kalam.stream is the old website. Do not treat it as a current twin.[^ali-stream]

# Pricing

| Plan | Price | What you get |
|------|-------|----------------|
| Free | $0 forever, no account | Local STT + BYOK STT, 1 profile |
| Pro | $4.99/mo or $49/yr | App AI features on your key (Polish, unlimited profiles, context, voice editing, auto-activation, sync). 14-day no-CC trial |
| Max | $11.99/mo or $119/yr | Everything in Pro + Kalam-hosted STT (600 min/mo) and AI (2M tokens/mo). No key |

See [pricing](https://kalamvoice.com/pricing).[^pricing]

# Support

hello@kalamvoice.com. Until ~$10k/mo, route support to an inbox Ali actually reads (DMs also fine). Same-day replies.

# Do not say

- That it is open source (the shipping product is proprietary)
- That the installer is signed, until kalam#43 or #42 ships
- That BYOK is a Pro-only gate. Local STT and BYOK STT run on Free, Pro, and Max.[^ali-plans][^pricing]
- Sourced-looking proof (4.9 / 17+ apps / 200+ wpm) unless a real source is attached here
- [homepage-social-proof](homepage-social-proof.md)

[^site]: kalamvoice.com
[^pricing]: Kalam pricing

[^ali-stream]: Ali via Steve — kalam.stream is the old website; live site is kalamvoice.com
[^ali-plans]: Ali via Steve — local STT and BYOK on Free/Pro/Max; Max is the no-key path
[^terms]: Kalam terms
