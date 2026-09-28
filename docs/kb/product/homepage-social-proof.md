---
type: research
timestamp: 2026-08-18T20:55:03Z
title: Homepage social-proof audit
description: Source-or-disprove live homepage claims 4.9 / 17+ / 200+ wpm and the draft 3–4x faster-than-typing line. Unverified. Recommended action — source or remove.
tags: [launch, claims, gate-0]
status: draft
generated: { by: oscar-research/gate0-claims, at: 2026-08-18T19:33:18Z }
sources:
  - id: site
    resource: https://kalamvoice.com
    title: kalamvoice.com homepage (claim exists, not evidence)
    last_modified: 2026-08-18
  - id: stream
    resource: https://kalam.stream
    title: kalam.stream old website homepage (fetched 2026-08-18; same four-stat strip still present). Not a current twin of kalamvoice.com
    last_modified: 2026-08-18
  - id: docs
    resource: https://docs.kalamvoice.com
    title: Kalam docs
    last_modified: 2026-08-18
  - id: pricing
    resource: https://kalamvoice.com/pricing
    title: Kalam pricing
    last_modified: 2026-08-18
  - id: download
    resource: https://kalamvoice.com/download
    title: Kalam download
    last_modified: 2026-08-18
  - id: nlm-smb
    resource: notebooklm://7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6/query/a2071a103555
    title: Startup Marketing Brain query a2071a103555
  - id: nlm-seo
    resource: notebooklm://1c440751-a46a-4f4f-9d1c-bb78b4011243/query/56e9bc6b5bed
    title: Everything SEO query 56e9bc6b5bed
  - id: nlm-sales
    resource: notebooklm://0727999c-77a9-4209-a23a-1e90c17f5d71/query/c6857bb628d1
    title: Sales query c6857bb628d1
  - id: nlm-balacode
    resource: notebooklm://balacode-io-kb/query/569a201911c2
    title: Balacode.io KB query 569a201911c2 (prior; not a Kalam product wiki)
  - id: gh-readme
    resource: https://github.com/afaraha8403/kalam
    title: afaraha8403/kalam README (first-party unsourced 4x line; raw fetch 404)
  - id: gh-org
    resource: https://github.com/balacodeio
    title: Balacode.io GitHub org (no public kalam repo)
  - id: ruan-2016
    resource: https://hci.stanford.edu/research/speech/paper/speech_paper.pdf
    title: "Speech Is 3x Faster than Typing… on Mobile Devices" (Ruan et al., 2016)
    author: Sherry Ruan, Jacob O. Wobbrock, Kenny Liou, Andrew Ng, James Landay
  - id: stanford-news
    resource: https://news.stanford.edu/stories/2016/08/stanford-study-speech-recognition-faster-texting
    title: Stanford Report on Ruan et al. 2016
  - id: wispr-ph
    resource: https://www.producthunt.com/posts/wispr-flow-for-windows
    title: Wispr Flow for Windows Product Hunt (competitor 3x claim)
  - id: gate-0
    resource: /launch/gate-0.md
    title: Gate 0 (draft)
  - id: product
    resource: /product/kalam.md
    title: Kalam product note (draft)
  - id: positioning
    resource: /launch/positioning.md
    title: Kalam positioning (draft)
---
Working copy: [[GrokBot/scratchpad/homepage-social-proof-audit]]


# Verdict

All four claims are **unsourced**. Live homepage still shows 4.9 / 17+ / 200+ wpm. The homepage is **not** evidence of those numbers.[^site]

**Recommended action:** source or remove. Status stays `draft` / unverified. Jim must not use 4.9, 17+ apps, 200+ wpm, or 3–4x in copy (including Product Hunt) until a primary source is attached.

Do not change the site from this note.

# Claims

| Claim | Found? | Live 2026-08-18 | Primary source | Confidence |
|-------|--------|-----------------|----------------|------------|
| 4.9/5 User rating | **not found** | Yes on live kalamvoice.com; same strip still on old site kalam.stream | none | high |
| 17+ Apps integrated | **not found** | Yes | none | high |
| 200+ Words / min | **not found** (no Kalam measurement) | Yes | none | high |
| 3–4x faster than typing | **not found** (no Kalam measurement) | Not on homepage; first-party GitHub README only | none | high |

## 4.9/5 User rating

- **Claim exists:** homepage stat strip: "4.9/5 User rating".[^site] Same strip was still on kalam.stream (old website, not a current twin).[^stream]
- **No primary source.** No Product Hunt product for Kalam Voice (hits are unrelated: Kalam Labs, KalamTime). No G2, Capterra, Microsoft Store, or Reddit thread. Trustpilot fetch for kalamvoice.com timed out; no indexed Trustpilot listing. Play Store "Kalam" (com.saviomartin.alif, ~4.8) is an Arabic-learning app, not this product. Trustpilot 2.3 for kalam.cx is a different company.
- Docs and pricing do not mention a rating.[^docs] [^pricing]
- **Do not treat** Balacode.io Trustpilot 4.2 (balaheadache.com, agency) or SEO-tool 4.9s as Kalam ratings.

## 17+ Apps integrated

- **Claim exists:** homepage "17+ Apps integrated".[^site]
- **No primary source.** docs.kalamvoice.com has no integrations page (404 on /integrations). Product copy is system-wide injection ("any app"), not a named list of 17 integrations.[^docs] [^site]
- No third-party catalog lists 17 Kalam integrations.

## 200+ Words / min

- **Claim exists:** homepage "200+ Words / min".[^site]
- **No Kalam benchmark, telemetry, or cited study.**
- Literature context only (do **not** attribute to Kalam): conversational English is typically ~150 WPM; Ruan et al. 2016 measured **161.20 WPM** speech vs **53.46 WPM** on an iPhone keyboard (English). That paper cites Rosenbaum that humans can speak "as fast as 200 WPM" — a general motor-control figure, not a Kalam result.[^ruan-2016]
- 200+ is the high/fast-speaker tail, not a demonstrated Kalam throughput.

## 3–4x faster than typing

- **Not on the live homepage** (2026-08-18 fetch). Allowed only in positioning draft "if we keep this honest; do not put it on PH without a source".[^positioning]
- First-party unsourced line: web-indexed README for afaraha8403/kalam lists "4× faster than typing". Raw GitHub fetch 404'd the same day. That is marketing copy, not a measurement.[^gh-readme]
- Literature (not a Kalam source): Ruan et al. 2016 — speech **3.0×** faster than smartphone QWERTY in English (161.20 vs 53.46 WPM), **2.8×** in Mandarin. Mobile, short phrases, lab, Baidu Deep Speech 2 — not Windows desktop, not Kalam.[^ruan-2016] [^stanford-news]
- Competitor marketing: Wispr Flow PH uses "3x faster than typing".[^wispr-ph]
- Using Stanford or Wispr numbers as if they were Kalam's would be false attribution.

# Notebook LM

Balacode.io KB is **not** a Kalam product wiki. Prior query 569a201911c2: zero Kalam / Wispr / Superwhisper / these claims; `sources_used: []`.[^nlm-balacode]

## Startup Marketing Brain — a2071a103555 — COMPLETED

Question: what the notebook says about Kalam and these claims.

**Kalam / kalamvoice / 4.9 / 17+ / 200+ wpm / 3–4x: not in this notebook.**

Mentions of *other* STT tools only:[^nlm-smb]

- Letterly — voice-to-text, $250k/mo (source: "How he makes $250K per month from a simple app (Letterly Breakdown)")
- Superwhisper — recommended as transcription software (source: "Claude Code & MCPs built my $145K marketing machine")
- Wispr Flow / "Whisper Flow" — named as an Atoio CRM customer, not a Kalam comparison (source: Chatbase / Yasser Elsaid playbook)
- Twilio STT/TTS APIs (source: emailed PDF)

`sources_used`: four IDs above. None are Kalam.

## Everything SEO — 56e9bc6b5bed — COMPLETED

- **Kalam / kalamvoice: not present**
- **4.9 rating: present, unrelated** — Capterra/Software Advice scores for SEOTesting, Screaming Frog, Sitebulb Cloud, AccuRanker, Surfer, MarketMuse; SEO Sherpa Google reviews 4.9/5. Not Kalam.[^nlm-seo]
- **17+ apps: not present** (17% annual discount on Ahrefs/Semrush only)
- **200+ wpm: not present**
- **3–4x faster than typing: not present**

## Sales — c6857bb628d1 — COMPLETED

**No.** Five general sales videos; `sources_used: []`. No Kalam, no metrics.[^nlm-sales]

# Also checked (negative)

- docs.kalamvoice.com — install only; no rating, app count, or WPM.[^docs]
- kalamvoice.com/pricing, /download, /terms — no social-proof numbers.[^pricing] [^download]
- github.com/balacodeio — no public `kalam` or `kalam-website` repo (org is snippets/Vapi/Bubble plugins).[^gh-org]
- Product Hunt, G2, Capterra, Microsoft Store, Reddit: no Kalam Voice listing.

# For Jim

Do not ship 4.9, 17+, 200+ wpm, or 3–4x until a primary source is attached here or in `/product/kalam.md`. Gate 0 already says "source or remove".[^gate-0] [^product]

Honest alternatives that do not need invented proof: "any Windows app", "offline / BYOK / Cloud", "$0 core forever".

# Next check

Ask Ali whether 4.9 / 17+ / 200+ are leftover placeholder copy; if a real in-app rating, integration count, or timed WPM bench exists, attach the artifact — otherwise remove the three homepage stats before any public launch.

[^site]: kalamvoice.com homepage (claim exists, not evidence)
[^stream]: kalam.stream old website homepage (fetched 2026-08-18). Not a current twin of kalamvoice.com
[^docs]: Kalam docs
[^pricing]: Kalam pricing
[^download]: Kalam download
[^nlm-smb]: Startup Marketing Brain query a2071a103555
[^nlm-seo]: Everything SEO query 56e9bc6b5bed
[^nlm-sales]: Sales query c6857bb628d1
[^nlm-balacode]: Balacode.io KB query 569a201911c2 (prior; not a Kalam product wiki)
[^gh-readme]: afaraha8403/kalam README (first-party unsourced 4x line; raw fetch 404)
[^gh-org]: Balacode.io GitHub org (no public kalam repo)
[^ruan-2016]: "Speech Is 3x Faster than Typing… on Mobile Devices" (Ruan et al., 2016)
[^stanford-news]: Stanford Report on Ruan et al. 2016
[^wispr-ph]: Wispr Flow for Windows Product Hunt (competitor 3x claim)
[^gate-0]: Gate 0 (draft)
[^product]: Kalam product note (draft)
[^positioning]: Kalam positioning (draft)
