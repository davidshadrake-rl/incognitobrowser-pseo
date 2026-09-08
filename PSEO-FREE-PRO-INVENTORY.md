# pSEO Material Inventory — Free (funnel) vs Pro (browser, paid)

**Scope:** every piece of pSEO material in this repo — not just the 12 tool engines. 7 content types, 551 files, 44 topic hubs, ~595 pages.
**Grounding:** classifications below are from reading the actual JSON structures (placeholders, formulas, step actions, product tables), not from titles.
**Constraints honored:** no password manager; VPN is the active browser build; **no external dependencies** — every Pro feature below reads the browser's own state or local data only.

---

## The rule (same one that governs the tools)

| Free — marketing site | Pro — inside Incognito Browser |
|---|---|
| Read it, fill it in once, copy it out | The browser **does it for you, keeps doing it, and can verify it** |
| Self-reported ("I think I block cookies") | **Measured** ("you block 0 of 3 cookie categories") |
| State evaporates on reload | Persistent, cross-session |
| Captures the search query | Justifies the install |

**What Pro is NOT:** the same page behind a login. If the free version can't be genuinely useful on its own, it won't rank, won't get cited by AI Overviews, and won't funnel anyone. Free content is the ad; Pro is the product.

The one thing the browser can do that a webpage never can: **read its own settings and observe the sites you visit.** Every Pro feature below is built on exactly that.

---

## Inventory by content type

| Type | Files | Published | What it actually is (from the JSON) | Tier |
|---|---|---|---|---|
| **Tools** | 46 pages / 12 engines | n/a | Interactive React tools | Free + Pro extensions (see `TOOL-CATALOG-REVIEW.md`) |
| **Checklists** | 89 | 73 | `sections[].items[]` of `task / why / howTo / priority`; checkbox state is local & ephemeral | **Free + Pro** ⭐ strongest content Pro |
| **Guides** | 132 | 108 | `steps[]` with `actions[]`, `proTip`, `warning`; `prerequisites`, `faqs` | Free + Pro (subset) |
| **Calculators** | 44 | 36 | `inputs[]` (self-reported selects) → JS `formula` → `outputFields` (score / grade / %) | **Free + Pro** ⭐ |
| **Templates — request letters** | 45 | 45 | `sections[].content` with `[PLACEHOLDER]` tokens + `placeholders[]` field defs. DSAR / deletion / opt-out letters | **Free + Pro** ⭐ |
| **Templates — policies** | 44 | 44 | Privacy-policy boilerplate for **site owners** (`{{COMPANY_NAME}}`) | Free only (B2B, SEO capture) |
| **Comparisons** | 45 | 45 | `products[]` + `features[].scores` + `verdict` — the product is a row in every one | **Free only — this IS the funnel** |
| **Glossary** | 106 | 106 | Term / definition / examples / related terms | Free only |
| **Topic hubs** | 44 | — | Navigation + intro per niche | Free only |

**Totals:** ~239 pages are free-only (pure capture + funnel); ~356 pages have a real Pro extension.

---

## Per-type verdicts

### Checklists (89) — the best content→Pro conversion in the catalog

**What's there:** every item is a concrete instruction like *"Disable third-party cookies"* with a `howTo`. Users tick boxes; the state is lost on reload.

**Free:** read + tick, as-is. (Ephemeral state is fine for a one-time walkthrough.)

**Pro — "Self-Verifying Checklist":** the browser reads its own settings and **ticks the items it can prove**. *Disable third-party cookies* → the browser checks its cookie policy and marks it done, or marks it red and offers a one-click fix. Persists across sessions; re-verifies when settings change. A privacy checklist that grades itself is a product feature no webpage can copy.

**Which checklists:** the ~60% whose items are browser-verifiable (browser-privacy, incognito-mode, cookie-management, device-fingerprinting, ad-tracking, browser-extensions, public-wifi, webcam, location). Legal/organizational ones (gdpr, ccpa, workplace, healthcare) stay free — nothing to auto-verify.

**No external deps:** reads `browser.privacy.*`, permissions, extension list, cookie settings. All local.

### Calculators (44) — swap the survey for telemetry

**What's there:** a working scoring `formula` fed by **self-reported** selects (*"Number of installed extensions?"*, *"Cookie management: blocked / limited / allowed"*). Output is a 0–100 score + grade + improvement %.

**Free:** the survey, as-is. Honest about what it is: an estimate.

**Pro — "True Privacy Score":** same formula, but the inputs come from **measurement** — actual extension count, actual cookie policy, actual tracker exposure over the last 7 days, actual permission grants. The score becomes real, live, and re-computes as you browse. The improvement % becomes a to-do list that links to the self-verifying checklist.

**Bonus:** the free survey score vs the Pro measured score is itself a conversion hook: *"You estimated 72. Incognito Browser measured 41."*

**Which:** the ~30 with browser-observable inputs. Legal-jurisdiction and habit calculators (dating, student, workplace) stay survey-only.

### Templates — request letters (45) — the Data Broker Opt-Out foundation

**What's there:** real DSAR / deletion / opt-out letter bodies with `[YOUR_NAME]`, `[COMPANY_NAME]`, `[DATE]` placeholders and a `placeholders[]` schema for each. This is 90% of the Data Broker Opt-Out Generator from the tool review, already written.

**Free:** fill placeholders in a form → rendered letter → copy / download. Genuinely useful; strong for *"how to request my data from X"* queries.

**Pro — "Request Sender":** identity fields pre-filled once (stored locally, encrypted), letter generated per target, `mailto:` / clipboard hand-off, and a **local tracker** of what you sent, to whom, when, and the statutory deadline (30 days GDPR, 45 days CCPA) with a reminder. No auto-submission — that would need broker integrations (external dep). The tracker alone is the value: people lose track of a dozen requests.

### Guides (132) — "Apply this guide"

**What's there:** numbered `steps` each with an `actions[]` list — many are literal browser-settings instructions (*"Open Settings → Privacy → Block third-party cookies"*).

**Free:** read. It's a guide.

**Pro — one-click apply:** for steps whose `actions` map to a browser setting, the step gets an **Apply** button that sets it, and a status pill showing whether it's already applied. Turns a 7-step guide into a 7-click configuration. Only meaningful for the ~40 browser-configuration guides; the rest (legal, conceptual, platform-specific like "Facebook privacy settings") stay read-only.

**Deprioritize vs. checklists:** the self-verifying checklist delivers the same "browser applies it" value with less UI work, since checklist items are already atomic. Build checklists first; guides inherit the same apply/verify primitives later.

### Comparisons (45) — free only, and the most important free pages on the site

**What's there:** every comparison has **Incognito Browser as a product row** with feature scores and a `verdict`. *(These were broken until this session — the R3 scrub had erased the product from its own comparison tables. Restored; guards added so it can't recur.)*

**Why free-only:** a comparison is a purchase-decision page. Its entire job is to end in a download click. There is no Pro version of "which browser should I use."

**Do:** make sure the verdict + product row are honest and specific (feature scores that the product actually earns). These pages will get the *"X vs Y"* and *"best privacy browser"* queries, which are the highest-intent traffic in the whole catalog.

### Templates — policies (44), Glossary (106), Topic hubs (44) — free only

- **Policy templates** target site owners writing a privacy policy. Wrong persona for the browser, but solid SEO capture (*"privacy policy template GDPR"*). Keep; no Pro.
- **Glossary** is reference. Keep; no Pro. (An in-browser tooltip glossary is conceivable but low value — skip.)
- **Hubs** are navigation. Free by definition.

---

## The consolidated Pro feature set

Content-derived (this doc) + tool-derived (`TOOL-CATALOG-REVIEW.md`), ordered by build value under current constraints.

| # | Pro feature | Derived from | Free funnel page | Why only the browser | Deps |
|---|---|---|---|---|---|
| 1 | **Leak Monitor** ⭐ ships with VPN | whats-my-ip tool | What's My IP + DNS leak | Background checks the tunnel holds | none |
| 2 | **Self-Verifying Checklists** ⭐ | 89 checklists (~55 applicable) | every checklist page | Reads its own settings, ticks what it can prove, fixes with one click | none |
| 3 | **True Privacy Score** ⭐ | 44 calculators (~30 applicable) | every calculator page | Replaces self-report with measurement | none |
| 4 | **Request Sender + Tracker** | 45 request-letter templates | every template page | Local identity vault, deadline tracking | none (no auto-submit) |
| 5 | **Tracker Live** | cookie-analyzer tool | Cookie & Tracker Scanner | Per-tab live interception | none |
| 6 | **Fingerprint Watch** | browser-privacy tool | Browser Privacy Audit | Observes probes across sessions | none |
| 7 | **One-Click Apply** | ~40 config guides | those guide pages | Inherits #2's primitives | none |
| 8 | Link Guard, Permission Audit, Auto-Strip Uploads, Download Verifier, UA Minimizer, Encrypted Notes | tools | respective tool pages | see tool review | none |

**Removed / not on roadmap:** Vault Audit (no password manager), anything needing HIBP / Safe Browsing / LLM-at-runtime.

**Why #2 and #3 outrank most tool features:** they convert **~230 existing pages** (checklists + calculators) into Pro funnels with two features, versus one page per tool feature. They also share primitives — "read a browser setting, compare to a target, show status, offer fix" — so #2, #3, and #7 are one engineering investment.

---

## What this means for the marketing site (free tier), concretely

Every page in a Free+Pro category gets the **same conversion panel**, populated from a tiny per-page field:

```json
"pro": { "feature": "self-verifying-checklist", "hook": "Incognito Browser checks these 12 items against your actual settings and fixes the failures in one click." }
```

- **Checklist page:** after the tick-boxes → *"Tired of checking manually? Incognito Browser verifies this list against your real settings."*
- **Calculator page:** under the score → *"This is your estimate. Incognito Browser measures the real number."*
- **Template page:** after the rendered letter → *"Incognito Browser tracks every request you send and the deadline for each."*
- **Comparison page:** the verdict IS the CTA — no panel needed.

Until a Pro feature actually ships, its panel shows a generic download CTA. **Only Leak Monitor may make a specific promise today** (it ships with the VPN). Everything else is a candidate — no vaporware on the marketing site.

---

## Build order

1. **Now (site):** add the `pro` field + panel to the 4 Free+Pro page templates. Wire only Leak Monitor's copy as specific; the rest generic. Half a day.
2. **Browser team, with the VPN:** Leak Monitor (#1).
3. **Browser team, next:** the read-setting/verify/fix primitive → Self-Verifying Checklists (#2) → True Privacy Score (#3) → One-Click Apply (#7). One investment, three features, ~270 pages of funnel.
4. **Then:** Request Sender (#4) — reuses the template placeholder schema as-is.
5. **Then:** the per-tool Pro features by the order in the tool review.

---

## Decisions taken 2026-09-07 (supersede the tables above where they differ)

| Decision | Call | Where it lives |
|---|---|---|
| Pro **tools** | cookie-analyzer, browser-privacy, url-analyzer, metadata-viewer | `lib/tiers.ts` PRO_ENGINES; `tier` on each tool JSON |
| Pro **shape** | separate deployment, same repo, second Vercel project, `NEXT_PUBLIC_TIER=pro` | `lib/tiers.ts`; Pro build renders only the 22 Pro tool pages, noindex sitewide, no sitemap, robots disallow |
| Free site | keeps every tool incl. the one-shot of Pro engines (they are the flagship funnels); Pro-engine pages link "Pro version →" | `app/tools/[niche]/[slug]/client.tsx` |
| Gate | **later** — "for now we are simply dividing the tools up" | n/a |
| Pro promises on free pages | specific only for Leak Monitor (ships with VPN); generic elsewhere | copy, not yet encoded |
| Privacy quiz | 9 → 3 (digital-footprint general, us-state-privacy compliance, student-privacy); 6 drafted | `data/tools/*/…quiz*.json` editorial.status |
| Content-type Pro extensions (checklists, calculators, request letters, guides) | no preference given → recommendation stands as the working default; **not encoded** in JSON yet | this doc |

## State of the material as of this session

Fixed today, all committed:
- Vercel builds were failing since May 18 (my rendered-pages test threw on a clean checkout) — fixed, deploys flowing again.
- Every tool recommended Brave (competitor) — 39 instances removed.
- Cookie scanner falsely labeled "100% client-side" — now honest, data-driven badge.
- **Scrub regression:** product erased from 30 of its own comparison tables + 3 calculator dropdowns — restored; scrub + audit hardened with `PRESERVE_PATH` so it can't recur.

Still open:
- Cookie scanner returns CORS "Network error" until `ALLOWED_ORIGINS` on the Vercel project includes the calling domains (dashboard: Settings → Environment Variables, then redeploy).
- 48 doorway-duplicate pages remain drafted (intentional, R2). 16 checklists / 24 guides / 8 calculators in that set.
