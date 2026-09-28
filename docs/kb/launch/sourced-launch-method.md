---
type: playbook
timestamp: 2026-08-19T18:08:51Z
title: Sourced launch method (PH, HN, email, first-run)
description: Notebook-first then web-backed method for a Windows-first free-core desktop launch. Extends gate-0.md and positioning.md; does not replace them.
tags: [launch]
status: draft
generated: { by: oscar-research/nlm-launch, at: 2026-08-18T19:34:59Z }
sources:
  - id: make-book
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#Emailing Make_626995a8-a3c3-4c65-b221-1ac3c9135bb7.pdf
    title: MAKE / Bootstrapper's Handbook (Pieter Levels) — Startup Marketing Brain
  - id: anish-reddit
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#How I Used Reddit To Build a $25K/Month Business
    title: How I Used Reddit To Build a $25K/Month Business (Anish / Save Wise)
  - id: thomas-uneed
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#How I Finally Built a $10K/Month SaaS (30 Failures)
    title: How I Finally Built a $10K/Month SaaS (Thomas / Uneed)
  - id: tibo-4saas
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#I Built 4 SaaS Apps to $100K MRR
    title: I Built 4 SaaS Apps to $100K MRR (Tibo)
  - id: letterly
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#How he makes $250K per month from a simple app (Letterly Breakdown)
    title: Letterly breakdown (Anton)
  - id: blitzscaling
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#You will be executing immediately in 20 minutes | Blitzscaling Director's Cut
    title: Blitzscaling Director's Cut (Chris Yeh)
  - id: yc-launch
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#The Best Way To Launch Your Startup | Startup School
    title: The Best Way To Launch Your Startup (YC Startup School)
  - id: dan-ai
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#How to Start a 1-Person AI Business (With Zero Code)
    title: How to Start a 1-Person AI Business (Dan Martell)
  - id: vibe-waitlist
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#Stop Vibe Coding! Do This First to 10x Your Chances of Success
    title: Stop Vibe Coding (waitlist / prototype video)
  - id: bhanu-tools
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#The Marketing Playbook That Grew My App to $13K/month
    title: Free-tools marketing playbook (Bhanu / SiteGPT)
  - id: one-video
    resource: notebook:7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6#If You Only Watch One Business Video, Make It This
    title: If You Only Watch One Business Video (value follow-up / breakup email)
  - id: sales-lighthouse
    resource: notebook:0727999c-77a9-4209-a23a-1e90c17f5d71#How I Get Clients Without Selling (They Come to Me)
    title: How I Get Clients Without Selling (Adam Erhart)
  - id: sales-brutal
    resource: notebook:0727999c-77a9-4209-a23a-1e90c17f5d71#Brutally Honest Advice About Running a Service Business
    title: Brutally Honest Advice About Running a Service Business (Will Barron)
  - id: sales-1000
    resource: notebook:0727999c-77a9-4209-a23a-1e90c17f5d71#Coaching Over 1000 Business Owners Taught Me This
    title: Coaching Over 1000 Business Owners Taught Me This (Will Barron)
  - id: sales-system
    resource: notebook:0727999c-77a9-4209-a23a-1e90c17f5d71#The Only Sales System Small Businesses Need (Under $5M/Year)
    title: The Only Sales System Small Businesses Need (Will Barron)
  - id: sales-losing
    resource: notebook:0727999c-77a9-4209-a23a-1e90c17f5d71#The #1 Reason Your Small Business Keeps Losing Deals
    title: The #1 Reason Your Small Business Keeps Losing Deals (Will Barron)
  - id: ms-smartscreen
    resource: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
    title: SmartScreen reputation for Windows app developers (Microsoft Learn, updated 2026-08-17)
  - id: showhn
    resource: https://news.ycombinator.com/showhn.html
    title: Show HN Guidelines (official)
  - id: ph-launch
    resource: https://www.producthunt.com/launch
    title: Product Hunt Launch Guide (official; page fetch timed out; wording from search snippets)
  - id: ph-prep
    resource: https://www.producthunt.com/launch/preparing-for-launch
    title: Prepare for your Product Hunt launch (official; page fetch timed out; wording from search snippets)
  - id: digicert-ev
    resource: https://knowledge.digicert.com/alerts/ev-signed-application-showing-microsoft-defender-smartscreen-warnings
    title: DigiCert — EV-signed apps can still show SmartScreen warnings
---

# How to use this note

This is **sourced launch method**, not a second Gate 0 list and not positioning copy. Existing drafts stay canonical for blockers and the one-sentence:

- `launch/gate-0.md` — nothing public until a stranger can download, install, dictate.
- `launch/positioning.md` — allowed claims.

**Product facts this note must not contradict:** Kalam is Windows-first voice dictation (live site kalamvoice.com; docs.kalamvoice.com; hello@kalamvoice.com). kalam.stream is the old website, not a current twin. Free core forever, no account. Local STT and BYOK cloud STT on Free, Pro, and Max. Pro $4.99/mo or $49/yr (app AI features on your key, 14-day no-CC trial). Max $11.99/mo or $119/yr (Kalam-hosted STT 600 min + AI 2M tokens, no key). Do not say BYOK = Pro. macOS/Linux coming, no dates. Public build 2026-08-18 is v0.1.0-beta.26, **unsigned**. Shipping product is proprietary — do not call it open source. Do not say signed or Store until those ship.

Sections below are labeled **From notebook** or **From web (confidence)**. If a source does not say it, it is omitted. Author estimates in MAKE are labeled as author estimates, not facts.

---

# 1. First-run quality (method behind Gate 0)

Gate 0 already names the Kalam blockers. This section is only what sources say about *why* first-run quality is the launch, plus what Microsoft actually says about unsigned Windows binaries.

## From notebook

Notebook sources **do not mention** Windows SmartScreen, Authenticode, unsigned `.exe`, or a named "Gate 0." They do describe first-run judgment and friction.

- If one thing fails, users judge it bad. If **two things** fail, they dismiss the whole app. Hate is expected; do not fight strangers. Fix launch-day bugs, do not build new features mid-launch. Native apps are harder because you must redeploy — tell people a fix is coming.[^make-book]
- A first prototype must **function**. Side bugs are fine; core must work; it should look at least OK. "Minimum needs to be minimum good." Final check: can a new user immediately see what it is and start using it? Walk the new-user path many times, including emails that fire after signup. Get a few other people to check — you will miss things.[^make-book]
- "Every point of friction kills your revenue." UX is a multiplier for onboarding, retention, and conversion (Letterly / Anton).[^letterly]
- Adoption friction sets growth speed. Freemium is cited as a way to remove signup hesitation (Yeh / Blitzscaling). Kalam already ships a no-account free core — that matches the friction point, not a new pricing change.[^blitzscaling]

Kalam mapping (facts only, not from the notebook): unsigned installer + a broken download page is two first-run failures. That is why Gate 0 exists. Do not go public to manufacture "two things."

## From web (confidence: high — Microsoft Learn)

Microsoft Defender SmartScreen scores **publisher reputation** (signed? known publisher?) and **file-hash reputation** (has this exact file been downloaded without malice?).[^ms-smartscreen]

| Certificate | First-download behavior (Microsoft) |
| --- | --- |
| Microsoft Store | No SmartScreen download warning. Store re-signs. |
| Valid OV/EV | Warning until reputation accumulates; **verified publisher name is shown**. |
| No signature | "Windows protected your PC"; user must **Run anyway**. Enterprise policy can block continuation entirely. |
| Self-signed | Same as no signature. |

Further Microsoft facts, not folklore:

- **Unsigned files start at zero reputation on every new version.** Reputation does not carry across versions unless both were signed with the same publisher identity.[^ms-smartscreen]
- **Signing does not clear the warning on day one.** A newly created signed binary can still warn until hash or publisher evidence builds. Microsoft publishes **no exact threshold**. Learn says it "can take several weeks and hundreds of clean installs from a wide audience."[^ms-smartscreen]
- **EV no longer bypasses SmartScreen.** Paying extra for EV solely to skip the prompt is "no longer justified." DigiCert says the same: Microsoft controls reputation; EV is not an automatic pass.[^ms-smartscreen][^digicert-ev]
- Microsoft's recommended non-Store path is **Artifact Signing** (formerly Trusted Signing). Learn lists it from **$9.99/month**, identity validation required, no hardware token. Reputation still accumulates over time. Azure's public pricing table hides dollar amounts behind `$-`; do not invent a current invoice number from that page.[^ms-smartscreen]
- On Windows 11, **Smart App Control can supersede SmartScreen** and **block unsigned files** unless the file already has positive reputation. That is a first-run killer for an unsigned beta, not a copy problem.[^ms-smartscreen]
- Microsoft's own mitigation for new apps: **tell early adopters they may see the prompt**, and that they should proceed only after verifying publisher and download source. There is no consumer-endpoint "submit for reputation" shortcut; reputation builds from download volume.[^ms-smartscreen]

What this does **not** authorize in public copy:

- Do not say "signed," "trusted publisher," or "available on the Microsoft Store" while the shipping build is unsigned and not in Store.
- Do not promise "no SmartScreen" after Azure signing — Learn says the warning can persist.
- SHA256 on the download page is a Kalam Gate 0 trust practice, not a Microsoft-mandated SmartScreen step. SmartScreen hashes the file internally; publishing the hash is for the stranger, not for SmartScreen.

---

# 2. Channel order (free-core + paid upgrade)

## From notebook

Sources do not publish a single "correct" calendar. They do converge on **small and honest before broad and paid**.

1. **Confirm pain, then a tryable thing.** Talk to people with the pain before treating it as a vitamin. One playbook (Dan Martell) even starts as a manual done-for-you service. That is a validation method, not a Kalam scope change.[^dan-ai]
2. **Silent surface + waitlist before a big day.** YC: domain, one-sentence description, contact, CTA. Friends-and-family next — watch them use it — but **do not stay there**; they are not your users.[^yc-launch] Prototype video + waitlist page is another notebook pattern.[^vibe-waitlist]
3. **Users, not builders, if PH/HN bounce.** Anish launched Save Wise on Product Hunt, Hacker News, and Indie Hackers, got a traffic spike, then a **95–96% bounce** and no useful feedback. Recovery was Reddit + Facebook groups of *users* (travel / credit-card points), not r/SaaS or Indie Hackers. Method: keywords → lurk → comment in weekly threads → moderator OK → then a top-level post. Influencer mail (300–400 messages, one reply) failed because the product was "not ready / still looking for feedback."[^anish-reddit]
4. **Directories then PH then HN, as an ongoing event, not one shot.** MAKE: launch is continuous; pick a day to make an event. **BetaList** first for early adopters (MAKE-era: ~500–1,000 visitors; ~$129 to skip a ~2-month wait — **verify current BetaList pricing before acting**). Then Product Hunt. Then a personal Show HN. Author estimates if you *top* those boards are in §3–4; they are not forecasts for Kalam.[^make-book]
5. **Stickiness before going broad or buying ads.** Tibo: do not pour acquisition into low retention. Organic PH + talking about the product on social is what he does **until ~$10k revenue** (his playbook, not a target). MAKE: organic first so you can tell if the product works; paid after you already have traction. Letterly-scale ad spend is a later-stage story, not a launch week plan.[^tibo-4saas][^make-book][^letterly]
6. **Free-core monetization in MAKE:** ship the full UI, learn what people click, keep paid buttons visible, upgrade modal, then a fast payment window. After pay, enable immediately.[^make-book] That is compatible with Kalam's already-priced Pro/Max. It is **not** a license to invent a lifetime SKU or a launch discount.

Do **not** apply these notebook items without an explicit product decision (they contradict current Kalam pricing or Gate 0):

- Dan Martell's "founding 50" at **50% off annual prepaid**.[^dan-ai]
- Anish: consumers in *his* app preferred a **lifetime** at about two years of subscription; he says that became ~97% of *his* revenue. MAKE also describes lifetime ≈ predicted LTV. Kalam already has monthly/yearly Pro and Max. Do not add lifetime or "founding price" in launch copy.[^anish-reddit][^make-book]
- Bhanu's "dozens of free SEO mini-tools" is a post-launch traffic machine, not a launch-week checklist.[^bhanu-tools]

## From web

No additional channel-order source was required. Official PH/HN pages constrain *how* those two days work (§3–4), not the order above.

## Sequencing that fits Kalam facts

Use notebook order, constrained by Gate 0:

1. Gate 0 green (stranger path). Soft / niche users (not builder subs).
2. Email people who already asked — download first, PH second, no "please upvote."
3. Product Hunt as an event (schedule; founder in comments).
4. Show HN only when a stranger can **try the Windows app** without emailing us (official HN rule, §4).
5. Paid ads and "go broad" only after retention is visible. No notebook source says to buy PH/HN traffic.

---

# 3. Product Hunt

## From notebook (mostly MAKE)

Concrete steps MAKE actually writes:

1. **Before the day:** email capture on the landing page (not "subscribe to my newsletter" — offer a useful reason). Feedback widget so strangers can report breaks. Walk the new-user path until it works.[^make-book]
2. **Time:** submit at **00:00:01 Pacific**. Ranking resets at midnight Pacific. Late-day submit is a disadvantage. You only get one serious first shot for a long time.[^make-book]
3. **Name / tagline:** first launch = product name. Tagline **≤ 60 characters**, simple words, no jargon. Example of a bad tagline in MAKE: "An algorithmic application for machine learning applied to photos."[^make-book]
4. **Media:** animated GIF thumbnail (a few MB). **8–16** high-res screenshots of core functions (zoom so they stay readable when scaled down). Optional muted autoplay video **≤ 30 seconds**.[^make-book]
5. **Maker comment immediately:** who you are, why you built it, what is next. Stay in comments. Be polite and humble. PH is "more positive" than HN and therefore **less honest** — take praise with salt.[^make-book]
6. **Tell people you are live. Do not ask for upvotes.** Email list, Twitter, Facebook: announcement, not a vote beg. A few friends for a head start is distinguished in MAKE from publicly asking everyone.[^make-book]

Pitfalls MAKE names:

- PH traffic is curious early adopters who "take a peek." MAKE says it **converts to paid worse than search**.[^make-book]
- Public upvote begging looks unprofessional and burns relationships.[^make-book]
- Buying fake upvotes/followers "doesn't stick."[^make-book]
- Bragging in comments looks "sleazy." You are hosting guests, not selling.[^make-book]

Sourced examples (only as the notebook cites them):

- **Hoodmaps** — Levels posted a personal pain/solution comment (MAKE).[^make-book]
- **Save Wise** — PH + HN + IH spike, then 95–96% bounce (Anish).[^anish-reddit]
- **Uneed** — Thomas timed a PH-alternative directory to indie complaints that PH featured only big/VC products. That is a *timing* story for a directory, not a Kalam tactic.[^thomas-uneed]
- **Tibo** — PH + build-in-public as the free acquisition pair until ~$10k (his words).[^tibo-4saas]

MAKE author estimates **if you are on top of PH** (not a Kalam forecast; not independently verified here): ~10,000 site visits, ~300 concurrent, some signups. Press in the following days is described as the real extra. Treat as one author's memory of *his* tops, not a KPI.[^make-book]

## From web (confidence: medium — official URLs; live fetch timed out)

Search snippets of Product Hunt's own launch guide (2026):

- Official time rule of thumb: **12:01am Pacific** so you get the full 24-hour homepage cycle. PH says the homepage runs on a 24-hour **Pacific Standard Time** cycle. You can **schedule up to 1 month** ahead.[^ph-launch][^ph-prep]
- Official "best day" line: **the day you are most prepared.** Not a Tuesday-or-bust rule on the official page snippets.[^ph-launch]
- Anyone can submit their own product. Official guide tells makers **not to pay a hunter**.[^ph-prep]

Third-party 2026 blogs invent upvote targets ("300–500 for top 5", "50+ in six hours"). **Omitted.** No official page in hand states those numbers.

Kalam constraints on the PH listing (product facts, not notebook):

- Tagline = outcome (hold hotkey, speak, it types). No "signed." No Store. No Mac date. No "open source." No 4.9 / 17+ / 200+ wpm unless sourced. No terminal showcase while #51 is open (already in gate-0).
- Screenshots must match the shipping UI (stale shots are already a Gate 0 blocker). GIF must not open on a SmartScreen scare as frame one if we are still unsigned — show the dictate path.

---

# 4. Hacker News (Show HN)

## From notebook (MAKE + YC)

MAKE steps:

- Title is personal, not a slogan. Bad: `Petsy.com - The best food delivery for pets`. Better: `I made a site that lets you subscribe to food delivery for your pet`. Better still: `Show HN: I made a site that lets you subscribe to pet food delivery`.[^make-book]
- Stay in comments. Humble. Read hate for the fixable part. Ship tiny bugfixes during the thread; do not add features. Do not fight strangers ("fastest way to failure").[^make-book]
- **Controversy filter:** more comments than upvotes → auto-flag, drop off front page.[^make-book]
- **Vote-ring discount:** forwarding to friends to upvote can cause HN to discount votes and bury the post.[^make-book]
- If it dies: MAKE says you can try again in a week with a different title/time/landing page; if it fails twice it may simply not be an HN product.[^make-book]
- MAKE author estimate **if it hits the front page** (not a forecast): ~50k–100k visitors, ~1,000 concurrent — "5x to 10x" PH — so the site must hold.[^make-book]

YC examples as cited: Robinhood Friday-night waitlist page was posted to HN by someone else and YC says 10,000 signups day one / 50,000 in a week (YC's telling). Stripe "perpetual launch" — founders come back to HN on each product. Dropbox was dismissed on first post (the curlftpfs comment) and still became a large company. Those are historical illustrations, not Kalam analogs.[^yc-launch][^make-book]

**MAKE tactic that now conflicts with official HN rules:** MAKE tells you to get **about 5 upvotes spread over the first hour** on `/newest`, then stop. Official Show HN (below) says do not ask friends to upvote or comment. **Follow the official rule.** Treat MAKE's "5 over an hour" as a 2010s author tactic, not something to operationalize.

## From web (confidence: high — official Show HN page)

Official rules that matter for Kalam:[^showhn]

- Show HN is for something people can **play with**. On topic: things they can run on a computer. Off topic: blog posts, **sign-up pages**, newsletters, lists, landing pages, fundraisers.
- **If it is not ready for users to try, do not Show HN.** Come back when it is.
- Make it easy to try, **ideally without signups or emails.**
- You personally made it and you are around to discuss it.
- Title begins with `Show HN`.
- Point-release notes (`Foo 1.3.1 is out`) are generally not Show HNs.
- **Please don't ask friends to upvote or comment. That's not ok on HN.**

Kalam fit: a no-account Windows download that actually installs and dictates *is* a valid Show HN object. A marketing page, a waitlist, or an installer that dies on SmartScreen with no honest instructions is not. Do not link HN at a "preparing your download" page.

Third-party 2026 posts about "8–10am ET" or "need supporters in the first 30 minutes" are community folklore. **Omitted** (not on the official page).

---

# 5. Email

## From notebook

Launch-list mechanics (MAKE + YC + waitlist video):

- Capture email **before** the spike. After launch week, traffic collapses; the list is how some of those people return.[^make-book]
- CTA must be useful to *them*. MAKE's anti-pattern is "Subscribe to my newsletter." Example that is useful: "Get a daily email of all new PHP jobs" on a jobs board.[^make-book]
- Buffer (2011, as MAKE tells it): "Plans and Pricing" clicked through to "You caught us before we're ready" + email reminder. That is a **validation** story. Kalam already sells; do not fake a missing product.[^make-book]
- YC: do not sit on a waitlist. The longer you wait to onboard, the harder the list is to convert. Superhuman / Robinhood are cited as waitlist *launches*, not as a reason to delay a working download.[^yc-launch]
- Anish: cold-emailing 300–400 influencers while the product still needed feedback produced one reply. Do not spend launch week on creator outreach.[^anish-reddit]
- Value follow-up vs "just checking in." Breakup email pattern when a lead goes silent: `[Name], is [product] not a good fit at the moment?` (one-video source). That is **sales-cycle** email, not a launch-day blast.[^one-video]

Launch-day email (MAKE): tell the list you are live / on PH. **Do not make upvote-the-primary-ask.**[^make-book] For Kalam, product-fact order is download first, PH second.

## Sales notebook (transferable only)

Sales sources are **B2B service** videos. They do **not** cover Product Hunt, Hacker News, Windows installers, SaaS trials, or launch discounts. Transferable warnings:

- Do not volunteer a discount or a smaller scope before the buyer objects. State price, stop talking. Hedging signals you do not believe the number.[^sales-brutal][^sales-lighthouse]
- Pitch the **outcome gap**, not credentials, years, or process. Vague phrases ("excellent customer service," "tailored solutions") collapse the buyer onto price.[^sales-brutal][^sales-losing]
- Keep a **visible** pipeline (one view, real stages). A fake-full pipeline is worse than a small true one. 30 minutes/day on next-stage tasks. Do not end with "I'll follow up next week" without a booked next step.[^sales-system][^sales-1000]

For Kalam that means: keep published prices ($4.99 / $49, $11.99 / $119). No "launch week 20% off." Track trial starts the way Barron tracks deals — who started, who is cold — without inventing a CRM process the Sales notebook never specified for SaaS.

---

# 6. What not to claim at launch

## From notebook

| Do not | Why the source says so |
| --- | --- |
| Ask the public to upvote / share / like | MAKE: unprofessional, against platform spirit, burns the network. Official HN independently forbids asking friends to vote.[^make-book][^showhn] |
| Buy upvotes, likes, followers | MAKE: fake virality does not stick; real humans discount it.[^make-book] |
| Brag, pose, or "market yourself" in PH/HN comments | MAKE: looks sleazy. Host, listen, fix.[^make-book] |
| Fight critics | MAKE: fastest way to failure. Read for the fixable bug.[^make-book] |
| Treat PH compliments as truth | MAKE: PH is nicer and less honest than HN.[^make-book] |
| Email influencers while still "looking for feedback" | Anish: ~300–400 messages, one reply.[^anish-reddit] |
| Sit on a waitlist | YC: conversion dies the longer you wait to onboard.[^yc-launch] |
| Volunteer discounts / hedge price | Sales: looks like you do not buy your own number. Sources do not discuss a "launch discount" SKU — they discuss not offering concessions first.[^sales-brutal] |
| Pitch credentials or generic category | Sales: buyers buy the bridge from current pain to a named outcome.[^sales-brutal][^sales-losing] |
| Ship a core path that does not work | MAKE: two broken things ⇒ "the entire app sucks."[^make-book] |

Notebook sources **do not mention** the words "signed," "SmartScreen," or "200 wpm." Those bans come from product facts and Microsoft, not from Marketing Brain.

## Product-fact bans (already in gate-0 / positioning; restated so launch copy cannot "remember" them)

Do not claim:

- **Signed**, Authenticode, trusted publisher, or Microsoft Store.
- **Open source** (shipping product is proprietary).
- Homepage **4.9 / 17+ apps / 200+ wpm** unless a source is on the page.
- **3–4x faster than typing** on PH without a measurement source (positioning already flags this).
- **"Most popular"** plan.
- **macOS / Linux dates.**
- Named testimonials or ratings you do not have.
- That SmartScreen will be gone after signing (Microsoft says otherwise).

---

# 7. Gaps

1. **Marketing Brain has zero Windows distribution content.** SmartScreen, Smart App Control, Artifact Signing, and Store re-signing are web-only (Microsoft Learn). Notebook "Gate 0" language is a Kalam KB term mapped onto MAKE's "two things fail" line.
2. **Sales notebook is the wrong genre** (local-service / agency). No SaaS trial-to-paid, no desktop installer, no PH/HN. Outcome-CTA and "no volunteer discount" are analogical, not product-launch doctrine.
3. **MAKE traffic numbers are one author's estimates** of *top-of-board* days, from an older book. Not independently checked. Not Kalam forecasts.
4. **Official Product Hunt HTML could not be fetched** in this run (timeout). Timing/schedule lines are from search snippets of producthunt.com/launch and /preparing-for-launch. Re-fetch before promoting this to `GrokBot/kb/launch/`.
5. **BetaList price and wait** are MAKE-era. Confirm on betalist.com before paying or promising a date.
6. **No notebook case study of a Windows-first unsigned desktop dictation app.** Letterly is a voice app but the cited material is UX-friction and later-stage ads, not a Windows installer launch.
7. **Dedicated "what not to claim" Marketing Brain query did not return** (async query stayed `in_progress`). Claims section is assembled from the other completed queries plus official PH/HN/Microsoft. Re-run that query before ratification if Oscar wants a cleaner citation trail.
8. **No source in either notebook measures Kalam speed, ratings, or install success.** Do not backfill.

---

# See also

- `launch/gate-0.md` — blockers and the 5-stranger exit.
- `launch/positioning.md` — one sentence and allowed vs Wispr Flow / Superwhisper.

[^make-book]: MAKE / Bootstrapper's Handbook (Pieter Levels) — Startup Marketing Brain
[^anish-reddit]: How I Used Reddit To Build a $25K/Month Business (Anish / Save Wise)
[^thomas-uneed]: How I Finally Built a $10K/Month SaaS (Thomas / Uneed)
[^tibo-4saas]: I Built 4 SaaS Apps to $100K MRR (Tibo)
[^letterly]: Letterly breakdown (Anton)
[^blitzscaling]: Blitzscaling Director's Cut (Chris Yeh)
[^yc-launch]: The Best Way To Launch Your Startup (YC Startup School)
[^dan-ai]: How to Start a 1-Person AI Business (Dan Martell)
[^vibe-waitlist]: Stop Vibe Coding (waitlist / prototype video)
[^bhanu-tools]: Free-tools marketing playbook (Bhanu / SiteGPT)
[^one-video]: If You Only Watch One Business Video (value follow-up / breakup email)
[^sales-lighthouse]: How I Get Clients Without Selling (Adam Erhart)
[^sales-brutal]: Brutally Honest Advice About Running a Service Business (Will Barron)
[^sales-1000]: Coaching Over 1000 Business Owners Taught Me This (Will Barron)
[^sales-system]: The Only Sales System Small Businesses Need (Will Barron)
[^sales-losing]: The #1 Reason Your Small Business Keeps Losing Deals (Will Barron)
[^ms-smartscreen]: SmartScreen reputation for Windows app developers (Microsoft Learn, updated 2026-08-17)
[^showhn]: Show HN Guidelines (official)
[^ph-launch]: Product Hunt Launch Guide (official; page fetch timed out; wording from search snippets)
[^ph-prep]: Prepare for your Product Hunt launch (official; page fetch timed out; wording from search snippets)
[^digicert-ev]: DigiCert — EV-signed apps can still show SmartScreen warnings
