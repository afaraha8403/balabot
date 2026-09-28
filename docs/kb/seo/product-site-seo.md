---
type: playbook
timestamp: 2026-08-18T20:54:50Z
title: Kalam SEO research (draft)
description: Sourced technical, on-page, EEAT, docs/comparison, and mistake notes for a downloadable Windows desktop app site. Promote to GrokBot/kb/seo/ only after review.
tags: [seo, technical, on-page, eeat, schema]
status: draft
generated: { by: oscar-research/nlm-seo, at: 2026-08-18T19:37:27Z }
sources:
  - id: nlm-seo-product
    resource: notebooklm://1c440751-a46a-4f4f-9d1c-bb78b4011243/query/ffb4b5988438
    title: Everything SEO — product/download site technical + on-page (2026-08-18)
  - id: nlm-seo-pages
    resource: notebooklm://1c440751-a46a-4f4f-9d1c-bb78b4011243/query/94c73dfba0dd
    title: Everything SEO — programmatic / docs / comparison pages
  - id: nlm-seo-eeat
    resource: notebooklm://1c440751-a46a-4f4f-9d1c-bb78b4011243/query/6533706534a9
    title: Everything SEO — EEAT / reviews / fake social proof
  - id: nlm-seo-mistakes
    resource: notebooklm://1c440751-a46a-4f4f-9d1c-bb78b4011243/query/646cc5e9d67d
    title: Everything SEO — SaaS / download / ecommerce mistakes
  - id: nlm-seo-schema
    resource: notebooklm://1c440751-a46a-4f4f-9d1c-bb78b4011243/query/be1a9e1d03b7
    title: Everything SEO — Product / Organization / pricing (no SoftwareApplication)
  - id: nlm-seo-checklist
    resource: notebooklm://1c440751-a46a-4f4f-9d1c-bb78b4011243/query/d0757a0e6030
    title: Everything SEO — title / meta / H1 / canonical / sitemap / CWV / OG
  - id: nlm-smb-seo
    resource: notebooklm://7342fbb6-8242-4c1e-b1b0-8cf1cfc9bad6/query/aeaeb9891260
    title: Startup Marketing Brain — SEO overlap (limited)
  - id: nlm-notebook
    resource: https://notebooklm.google.com/notebook/1c440751-a46a-4f4f-9d1c-bb78b4011243
    title: Everything SEO notebook (45 sources)
  - id: g-software-app
    resource: https://developers.google.com/search/docs/appearance/structured-data/software-app
    title: Software app (SoftwareApplication) structured data (Google Search Central)
    author: team:google-search-central
  - id: g-review
    resource: https://developers.google.com/search/docs/appearance/structured-data/review-snippet
    title: Review snippet (Review, AggregateRating) structured data (Google Search Central)
    author: team:google-search-central
  - id: product
    resource: /product/kalam.md
    title: Kalam product note (draft)
  - id: positioning
    resource: /launch/positioning.md
    title: Kalam positioning (draft)
  - id: proof-audit
    resource: /scratchpad/homepage-social-proof-audit.md
    title: Homepage social-proof audit (draft)
---

# How to read this

Draft research for Oscar to promote later into `GrokBot/kb/seo/`. Not Ali-signed.

**Notebook first, then web.** Primary notebook is Everything SEO (45 sources). Startup Marketing Brain (20 founder videos) was queried only for SEO overlap. Web was used only where the notebook is silent or to check official Google rules. Implications are labeled as such — they are not sourced facts.

**Do not invent keyword volumes, rankings, “most popular keywords,” or traffic numbers.** This draft does not contain Search Console data. Do not claim current rankings.[^nlm-notebook]

Do not promote homepage 4.9 / 17+ apps / 200+ wpm, or 3–4x faster than typing, until a primary source is attached.[^product][^positioning][^proof-audit]

# Known product facts (do not contradict)

- Sites: live kalamvoice.com and docs.kalamvoice.com. kalam.stream is the old website, not a current twin.
- Windows desktop voice dictation. Hold a hotkey, speak, it types in any Windows app. Free core, no account.[^product]
- Docs live on a subdomain. Do not invent a keyword strategy for “voice dictation windows” unless a source names those terms.

# 1. Product / download site — technical + on-page

These are priorities the Everything SEO sources actually state for product, SaaS, or commercial landing pages. They are not a Kalam ranking report.

## Technical (notebook)

- **Render product and download HTML on the server or as static HTML.** Client-side rendering (CSR) of price, description, or download links is treated as a liability: bots defer JS and may miss or delay indexation. Sources prefer SSG, SSR, or incremental static regeneration, with headings and download links present in the initial HTML.[^nlm-seo-product][^nlm-seo-mistakes]
- **Return a real 200 for real pages, and a real 4xx/5xx for errors.** “Invisible 500s” (React/Vue catch a server error and serve a friendly page with HTTP 200) look like thin pages to crawlers.[^nlm-seo-mistakes]
- **Do not hide primary nav from the crawler.** Mobile-first indexing: if hamburger links are not in the DOM until click, the smartphone crawler may miss the hierarchy. Desktop and mobile should expose the same content, links, and schema.[^nlm-seo-mistakes]
- **Core Web Vitals (source-stated thresholds, also official Google):** LCP ≤ 2.5s (75th percentile field data), INP ≤ 200ms, CLS ≤ 0.1. Partial hydration / island architecture is recommended so only the download/CTA island hydrates.[^nlm-seo-checklist][^nlm-seo-product]
- **robots.txt as governance, not a junk drawer.** Do not block CSS/JS/images. Block session/sort parameters that do not change content. Sources distinguish LLM *training* bots (optional block, e.g. GPTBot) from *retrieval* bots (allow OAI-SearchBot if you want ChatGPT Search citations). Bing is said to parse long/complex robots files poorly — keep them simple.[^nlm-seo-checklist][^nlm-seo-product]
- **IndexNow** is described as a Bing / ChatGPT-index push, not a Google protocol. Google’s Indexing API is restricted. Relevant if we care about Bing (Windows desktop users).[^nlm-seo-product]
- **HTTPS everywhere**, 301 HTTP→HTTPS, no mixed content, internal links already on https.[^nlm-seo-checklist]
- **Sitemap:** `/sitemap.xml` returns 200; only canonical, indexable URLs; no 404/redirect/noindex rows; `lastmod` must match real edits. Submit in Google Search Console **and** Bing Webmaster Tools. Bing sources also mention `changefreq` / `priority`.[^nlm-seo-checklist]
- **Canonicals:** every unique page self-canonicalizes. Consolidate www / protocol / trailing-slash variants. Internal links must use the canonical form (no mixed http / www).[^nlm-seo-checklist]

## On-page (notebook)

- **One unique title, one H1, one intent per URL.** Duplicate titles at scale are called out as an agency mistake. Do not skip heading levels. Headings are structure, not styling.[^nlm-seo-checklist][^nlm-seo-mistakes]
- **Title length (source-stated, not a ranking number):** keep under ~60 characters; primary phrase near the start; humans first. Formula cited: `[Topic] – [Benefit] | [Brand]`.[^nlm-seo-checklist]
- **Meta description (source-stated):** unique per page; benefit + CTA; roughly 150–165 characters. Bing sources say Bing uses the meta description for relevance more than Google does.[^nlm-seo-checklist]
- **URLs:** lowercase, hyphens not underscores, short, static. `/Product` and `/product` are treated as different URLs.[^nlm-seo-mistakes]
- **Match commercial intent, not a feature dump.** A SaaS page that ranks for a buying query but only lists features (no comparisons, pricing context, or “who this is for”) is a cited failure mode.[^nlm-seo-product][^nlm-seo-mistakes]
- **Split mega-guides by intent.** One 5,000-word page that mixes definition + comparison + pricing is said to cause “intent confusion.” Split into informational, consideration, and transactional URLs, then link them laterally so buyers can regress without leaving the domain.[^nlm-seo-pages][^nlm-seo-mistakes]
- **Do not create thin string-variant URLs** (example used in the source: separate pages for “best CRM software” and “top CRM platforms”). Cluster one entity, do not clone near-duplicates.[^nlm-seo-mistakes]
- **Open Graph + Twitter/X cards:** required OG tags are `og:title`, `og:type`, `og:image`, `og:url`. Image: absolute HTTPS URL, ~1200×630, not SVG. Dynamic OG (title baked into a template) is recommended for docs/SaaS. Twitter “app cards” are mentioned for App Store linking — that is mobile-store specific, not a Windows `.exe` fact.[^nlm-seo-product][^nlm-seo-checklist]
- **Bing vs Google (notebook, not measured for Kalam):** Google is described as mobile-first + semantic; Bing as more desktop-first + more literal (exact phrase in title / H1 / URL / meta) and more willing to treat social shares as a signal. Implication for a Windows desktop app: do not starve the desktop viewport, and register Bing Webmaster Tools. This is source doctrine, not a Kalam ranking claim.[^nlm-seo-product]

## Schema the notebook *does* name

Notebook sources **do not mention `SoftwareApplication`**. They do name:

| Type | Where sources put it | Notes |
|------|----------------------|--------|
| Organization (+ `sameAs`) | Homepage / About | name, url, logo as ImageObject, contactPoint, sameAs to verified profiles. Entity glue for Google/Bing/AI.[^nlm-seo-schema] |
| Product + Offer | Product-adjacent commercial pages | name, image, description; at least one of Review, AggregateRating, or Offer (`price` + `priceCurrency`).[^nlm-seo-schema] |
| HowTo | Step-by-step install / setup | Cited as AI-Overview-friendly.[^nlm-seo-pages] |
| Article / BlogPosting + Person | Editorial | Author as a Person entity, not a string; `sameAs` to real profiles.[^nlm-seo-eeat] |
| FAQPage, ItemList, Dataset, BreadcrumbList | FAQ / comparison / nav | Comparison sources prefer tables + ItemList/Dataset over a blob of Article text.[^nlm-seo-pages] |
| ProfilePage | Author / expert bios | Machine-readable EEAT.[^nlm-seo-eeat] |

**Schema drift:** JSON-LD that contradicts the visible page (price, stock, rating) is described as heavily penalized. Markup must match what the user sees. Hidden schema is called schema spam and can draw a manual action.[^nlm-seo-eeat][^nlm-seo-mistakes]

**Implication (not a notebook quote):** if the homepage shows unsourced 4.9 / 17+ / 200+ wpm, do not also encode those numbers in JSON-LD. That would be schema drift plus fake proof. See §3.

# 2. Programmatic pages, docs, comparison pages

No keyword list is invented here. This is how the sources say to *think* about those page types.

## Programmatic

- Defined as scaling many pages from one smart layout.[^nlm-seo-pages]
- The only concrete programmatic pattern in the notebook is a **service × city “zipper”** (plumbing-style local pages). The same source warns: be “careful and prudent”; do **not** flood the site with hundreds or thousands of near-duplicate templates — quality filters can suppress the set.[^nlm-seo-pages]
- **Implication:** a downloadable desktop app is not a local-services zipper. Do not spin hundreds of “voice dictation for {app|city|persona}” clones unless each URL has unique information gain (real workflows, screenshots, constraints). The notebook does not name those terms.

## Docs (docs.kalamvoice.com)

- Docs, troubleshooters, and API/config pages are mapped to **post-purchase / retention intent**, not to the homepage’s transactional job.[^nlm-seo-pages]
- Retention content is described as a churn moat and a way to earn links from forums/communities — as a mechanism, not a promised volume.[^nlm-seo-pages]
- Mark step-by-step install/setup with **HowTo** schema; do not leave authors anonymous if you want Person/ProfilePage EEAT.[^nlm-seo-pages]
- SMB overlap only: one founder mentions Mintlify as how a solo dev hosts docs. That is hosting trivia, not an SEO strategy.[^nlm-smb-seo]

**Gap:** sources do not discuss subdomain vs subdirectory (`docs.kalamvoice.com` vs `kalamvoice.com/docs`) or how equity flows between the live marketing site and docs. kalam.stream is the old website, not a current twin.

## Comparison / vs pages

- Queries with modifiers like “vs,” “best,” “review,” “alternative” are classified as **commercial / consideration** intent.[^nlm-seo-pages]
- Design the sources actually state: **summary table at the top** (reduce pogo-sticking); modular H2 blocks; “Who this is best for”; contextual CTA — not a feature dump.[^nlm-seo-pages][^nlm-seo-product]
- For generative/AI extraction, sources claim HTML `<table>` and `<ul>` are preferred over narrative (one source claims 82% of the time — **source-claimed, not independently verified**). ItemList / Dataset JSON-LD is suggested so rows are machine-readable.[^nlm-seo-pages]
- SMB overlap: comparison URLs should be human-readable and encode filter state in the path, not a opaque query soup.[^nlm-smb-seo]

# 3. EEAT, reviews, fake social proof

Directly relevant because the live homepage still shows unsourced **4.9 / 17+ / 200+ wpm**.[^proof-audit]

## What EEAT is (notebook)

E-E-A-T = Experience, Expertise, Authoritativeness, Trustworthiness. Sources present it as a **bundle of trust cues**, not a score you optimize. Experience was added (sources: December 2022). Especially emphasized for YMYL; still used as the “who should rank” lens for everyone.[^nlm-seo-eeat]

How sources say to *show* it:

| Cue | What sources actually list |
|-----|----------------------------|
| Experience | First-hand screenshots, real workflows, field notes, case studies, original data — proof you used the thing.[^nlm-seo-eeat] |
| Expertise | Named author, bio, credentials, Person schema, expert review of articles.[^nlm-seo-eeat] |
| Authority | Editorial citations, niche backlinks, unlinked mentions, original research. Digital PR over bought links.[^nlm-seo-eeat] |
| Trust | HTTPS, contact + privacy, editorial policy, honest sourcing, updated timestamps, no schema/page contradictions.[^nlm-seo-eeat] |

## Reviews and social proof (notebook)

- Real reviews/testimonials are treated as CRO trust signals. Place them **next to the decision CTA**, not as a disconnected footer trophy wall.[^nlm-seo-eeat]
- Review / Product schema can produce star rich results **only if** the markup matches visible, user-sourced reviews.[^nlm-seo-eeat]
- UGC is valued as fresh, long-tail language — when it is real.[^nlm-seo-eeat]
- Tools named by sources (not an endorsement, not a Kalam account): Trustpilot, Yotpo, Judge.me.[^nlm-seo-eeat]

## Fake or unsourced proof (notebook + official Google)

Notebook:

- **Fake social signals** (bought followers, empty high-follower profiles) are described as trust demotions. Example used in sources: 60,000 followers / 3 tweets / 0 retweets.[^nlm-seo-eeat]
- **Schema drift and hidden schema** = contradiction or invisible claims encoded for bots.[^nlm-seo-eeat]
- Paid / PBN / reciprocal link farms and sudden unnatural link velocity are Penguin / SpamBrain territory. Prefer earned editorial links.[^nlm-seo-mistakes]

Official Google (web fill; high confidence):

- Review markup must be **readily visible** on the same page. Do not mark up reviews the user cannot see.[^g-review]
- **Do not include fake or undisclosed incentivized reviews** on the page or in structured data. Examples: reviews not based on a genuine experience; reviews written for money/discounts/free product without prominent disclosure.[^g-review]
- **Do not aggregate reviews or ratings from other websites** into your own markup.[^g-review]
- Self-serving-review ineligibility in the review-snippet doc is scoped to **LocalBusiness / Organization** pages that control reviews of themselves. `SoftwareApplication` is a listed reviewable type. That is **not** permission to invent a 4.9. Ratings still have to be real and on-page.[^g-review][^g-software-app]

**Implication for Kalam (labeled):** keep 4.9 / 17+ / 200+ wpm off the homepage and out of JSON-LD until a primary source exists. Showing them as if they were measured reviews is the exact class of unsourced proof the sources and Google guidelines warn about. Replace with first-hand experience (screenshots of dictation in Word/Outlook/VS Code, a named author, contact, honest pricing). That is the EEAT the sources actually ask for.

# 4. Common mistakes (SaaS / software / download-adjacent)

Filtered to what is usable for a small product site. Ecommerce-catalog items are listed only so we do not cargo-cult them.

**Do (or avoid) — relevant**

- CSR on the product / pricing / download template.[^nlm-seo-mistakes]
- Schema that does not match the page; Product/Review stars without real reviews.[^nlm-seo-mistakes]
- Soft-200 error pages; hamburger nav missing from the DOM.[^nlm-seo-mistakes]
- Duplicate titles; mixed-case URLs; parameter clutter.[^nlm-seo-mistakes]
- Feature-only commercial copy; one mega-page for all intents; no off-ramp from pricing to “how it works.”[^nlm-seo-mistakes]
- Thin near-duplicate programmatic pages.[^nlm-seo-pages]
- Keyword stuffing / exact-match density games. Sources say Google moved to semantic / helpful-content; stuffing can demote.[^nlm-seo-pages]
- Bought links, PBNs, exact-match anchor spam, irrelevant referring domains, fake social graphs.[^nlm-seo-mistakes]
- Sketchy “growth-hack SEO.” SMB (Pieter Levels) says those hacks get you penalized. Treat as founder caution, not a Google doc.[^nlm-smb-seo]

**Mostly not our problem (ecommerce)**

- Faceted-nav combinatorial explosion, out-of-stock 404 vs soft-404, manufacturer-copied product descriptions, hreflang return-tag errors. Note them so nobody copies a Shopify checklist onto kalamvoice.com.[^nlm-seo-mistakes]

# 5. SoftwareApplication schema (web fill)

**Notebook gap (explicit):** Everything SEO “does not specifically mention the `SoftwareApplication` schema or software download pages.”[^nlm-seo-schema]

Official Google Search Central (fetched 2026-08-18):

- Type: `SoftwareApplication`. Desktop apps use this type plus `operatingSystem` (example values in the doc look like `Windows 7`, `OSX 10.6`). Subtypes `MobileApplication` / `WebApplication` are extra, not a replacement for a Windows desktop build.[^g-software-app]
- **Required for the software-app rich result:** `name`; `offers.price` (**`0` if free**); **and** `aggregateRating` **or** `review`.[^g-software-app]
- Recommended: `applicationCategory` from Google’s enum (closest fits for Kalam are probably `UtilitiesApplication`, `BusinessApplication`, or `DesktopEnhancementApplication` — pick one later, do not invent a new token); `operatingSystem`.[^g-software-app]
- Reviews in this markup must follow the Review snippet guidelines (visible, not fake, not scraped from other sites).[^g-software-app][^g-review]
- Google does **not** guarantee the rich result will show even with valid markup.[^g-software-app]

**Implication (labeled):** a free-core Windows app can mark `offers.price: 0` and `operatingSystem: Windows 10`. It **cannot** honestly satisfy the required rating/review field until real, on-page, user-sourced reviews exist. Do not mint a 4.6 to look like the Angry Birds sample in Google’s own doc. Ship Organization + HowTo + honest Offer first; add SoftwareApplication stars only after reviews exist.

# 6. Startup Marketing Brain — SEO overlap only

SMB is founder storytelling, not an SEO corpus. Useful fragments, all **founder-claimed**:

- Treat SEO as a long channel once something works; do not lead with blackhat hacks.[^nlm-smb-seo]
- “AEO”: put real explanations on review sites, Reddit, and video so models can cite you. That is distribution, not a keyword plan.[^nlm-smb-seo]
- One playbook builds free mini-tools around Ahrefs queries (KD and volume numbers are **that founder’s method**, not Kalam data). Do not copy the volumes.[^nlm-smb-seo]
- Docs exist; comparison URLs should be readable; OG/Twitter cards matter when you share.[^nlm-smb-seo]

Do not import SMB revenue or traffic figures into the SEO KB.

# 7. What this draft is allowed to recommend for Kalam

These are implications from the sources above, not a keyword strategy and not a ranking claim.

1. Make homepage, pricing, and download **crawlable HTML** (SSG/SSR). Register GSC + Bing Webmaster Tools. Ship sitemap + self-canonicals + HTTPS.
2. Give each URL **one job**: homepage/download = transactional; docs = how-to / retention; any future vs page = consideration table + “who it’s for.” Link them so a buyer can regress.
3. **Organization** on the homepage (`sameAs` to real profiles). **HowTo** on install docs. **No Review / AggregateRating / SoftwareApplication stars** until reviews are real and visible.
4. **Remove or source** 4.9 / 17+ / 200+ wpm. Replace with first-hand proof (screenshots, named human, contact, honest pricing).
5. Do **not** generate hundreds of programmatic location/persona pages. Do **not** buy links. Do **not** invent a “voice dictation windows” keyword set in this file.
6. Bing/desktop-first + IndexNow are worth a ticket because the product is Windows. That is rationale, not a forecast.

# Gaps

1. **No Search Console or Bing Webmaster data.** No impressions, queries, index coverage, or rich-result eligibility for kalamvoice.com / docs. kalam.stream is the old website.
2. **No keyword volumes or SERP inventory.** Notebook did not name Kalam terms. This draft correctly refuses to invent them.
3. **SoftwareApplication and desktop download pages are absent from the notebook.** Filled from Google Search Central only. No notebook guidance on `.exe` / SmartScreen / download-interstitial SEO.
4. **Cross-host architecture** (live apex vs `docs.`) is not covered by the sources. kalam.stream is the old website, not a current twin.
5. **Source quality mix.** Everything SEO includes solid checklists (Yotpo, Digital Applied, DebugBear, Google-adjacent) and weaker commercial/YouTube pieces (e.g. “50,000 clicks/month”). Percentages such as 20–30% product-schema CTR, 60% journey regression, 82% table bias, 18.57% AI Overviews are **source-claimed** and were not independently verified. Do not promote them as Kalam metrics.
6. **No competitor ranking or content gap study.** Wispr / Superwhisper / Windows Speech Recognition SERPs were not pulled.
7. **EEAT for a one-person product.** Sources assume author pages and original research. We have a founder and docs, not a publication program.
8. **Review chicken-and-egg.** Google’s software-app rich result requires a rating or review. New products cannot satisfy that honestly.

# Source index (notebook articles actually cited)

Everything SEO titles used in the six queries (not a ranking of importance): *Full Technical SEO Checklist: The 2026 Guide - Yotpo*; *Technical SEO Audit 2026: 50-Point Checklist - Digital Applied*; *The Technical SEO Audit Checklist for 2026 (Schema Edition)*; *The Complete Guide To Ecommerce SEO in 2026 - DebugBear*; *On-Page SEO Checklist to Advance Your Strategy - Swydo*; *The Ultimate Keyword Intent Mapping Blueprint That Skyrockets …*; *Conversion rate optimization (CRO) strategy for 2026 - HubSpot Blog*; *CRO and SEO: How They Work Together to Drive Growth - Convert Experiences*; *The Architecture of Modern Search Engine Optimization…*; *Google SEO Ranking Factors 2026 - ClickRank AI*; *Bing SEO* pieces (Opace, Webugol, MotaWord, Zeo); *How to Avoid a Google Penalty? - SEO Site Checkup*; *Why Google Penalises Certain Link Building Patterns - Hashmeta*; *5 Types of Google Link Penalties - SEOptimer*; *Link Building 2026 / Digital PR* pieces (Digital Applied, Outpace, Organic Media Group); *Advanced On-Page SEO* (WebTech + the Expert Techniques guide); *Mastering Open Graph Protocol SEO in 2026 - Magic Logix*; *Twitter Cards vs Open Graph*; *Twitter Cards and X Sharing - The SEO Framework*; *What is Conversion Rate Optimization (CRO)? - Landingi*; *Claude Code SEO: How I Got 50,000 Clicks Per Month* (YouTube; treat as anecdote).

SMB titles used only in §6: *I Built 4 SaaS Apps to $100K MRR*; *I Hit $1M ARR in 117 Days (Chatbase)*; *The Marketing Playbook That Grew My App to $13K/month*; *Emailing Make_…pdf* (Levels); *The Best Way To Launch Your Startup | Startup School*.

[^nlm-seo-product]: Everything SEO — product/download site technical + on-page
[^nlm-seo-pages]: Everything SEO — programmatic / docs / comparison pages
[^nlm-seo-eeat]: Everything SEO — EEAT / reviews / fake social proof
[^nlm-seo-mistakes]: Everything SEO — SaaS / download / ecommerce mistakes
[^nlm-seo-schema]: Everything SEO — Product / Organization / pricing (no SoftwareApplication)
[^nlm-seo-checklist]: Everything SEO — title / meta / H1 / canonical / sitemap / CWV / OG
[^nlm-smb-seo]: Startup Marketing Brain — SEO overlap (limited)
[^nlm-notebook]: Everything SEO notebook (45 sources)
[^g-software-app]: Software app (SoftwareApplication) structured data (Google Search Central)
[^g-review]: Review snippet structured data (Google Search Central)
[^product]: Kalam product note (draft)
[^positioning]: Kalam positioning (draft)
[^proof-audit]: Homepage social-proof audit (draft)
