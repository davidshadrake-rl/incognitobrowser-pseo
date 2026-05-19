# Post-fix AI-SEO audit — incognitobrowser.io/resources

**Date:** 2026-05-18
**Scope:** Verify that R1/R2/R3 fixes from the launch-readiness audit actually mitigate the original risks, surface anything new.
**Method:** Google's official AI optimization guide (developers.google.com/search/docs/fundamentals/ai-optimization-guide), 5-section framework. Static build inspected directly in `out/`.

---

## TL;DR — do the original fixes hold up?

| Original risk | Fix shipped | Verdict |
|---|---|---|
| R1 — 505 LLM pages, no editorial layer | Gate + named writer + LinkedIn-verified editor | **Mitigated structurally**, but the signal Google reads (visible byline + Article schema) is not actually wired into pages. **Half-done.** |
| R2 — doorway-page network pattern | Hub-overlap audit identified 19 review pairs | **Identified, not acted on.** Pattern still present in the shipped build. |
| R3 — product-promo injection in prompt | Removed; body text scrubbed | **Done.** 0 problematic mentions remain. |

**Bottom line:** R3 is solved cleanly. R1 is half-solved — the data model and author profiles exist, but readers and Googlebot don't actually see them on article pages. R2 hasn't been acted on. **Highest-leverage next step (below) is wiring the byline + Article schema into detail page templates.** That converts R1 from "half-done" to "actually shipped."

---

## Findings

### F1 — Article JSON-LD with author/editor is NOT being emitted on detail pages
**Severity:** Blocker for the R1 fix
**What was checked:** Inspected `out/checklists/browser-privacy/browser-privacy-security-checklist/index.html`. The only JSON-LD present is BreadcrumbList. The `generateArticleSchema()` helper in `lib/seo.ts` was written but never wired into any of the 7 detail page templates. The author and editor blocks sit inside the React server-component data payload but are not surfaced as structured data.
**What this means:** Google's primary mechanism for parsing authorship is the Article schema's `author` (Person) and `editor` (Person) fields. Without them, the entire byline-and-editor accountability infrastructure we built is invisible to Googlebot at the structured-data level. The author profile pages help (they have Person schema), but Google has no per-article link from a checklist to a Person entity.
**Fix:** Wire `generateArticleSchema()` into all 7 detail page templates (`checklists`, `guides`, `comparisons`, `templates`, `calculators`, `tools`, `glossary`). Same patcher-script approach as the `noIndex` gate — one Node script touches all 7 files.
**Effort:** ~30 minutes.

### F2 — Visible byline is missing from every article page
**Severity:** Blocker for the R1 fix
**What was checked:** Searched `components/ChecklistPage.tsx`, `components/GuidePage.tsx`, etc., for any author/byline rendering. None of them render the author block. "Darkpool David" appears once in the HTML — only inside the embedded React payload, not as visible page content.
**What this means:** Google's quality raters and AI Overview citations both look for a visible byline near the top of an article. A real person's name visible at the top of every page is the single strongest E-A-T signal for content of this type. Right now a human reader sees no author on any of the 505 pages.
**Fix:** Build a single `<ArticleByline>` component that renders `By <author-link> · Edited by <editor-link with LinkedIn-verified microformat> · Reviewed <date>`. Drop it into each of the 6 page components below the H1. Match the existing site design.
**Effort:** ~45 minutes.

### F3 — `robots.txt` is missing from the build output
**Severity:** Important
**What was checked:** `out/robots.txt` does not exist. `public/robots.txt` does not exist either.
**What this means:** Without an explicit robots.txt, search engines fall back to default-allow behavior, which is fine functionally but you also miss the chance to point them at `sitemap.xml`. A missing robots.txt on a 3,000+ URL site is a small but unnecessary gap.
**Fix:** Add `public/robots.txt`:
```
User-agent: *
Allow: /

Sitemap: https://incognitobrowser.io/resources/sitemap.xml
```
**Effort:** 2 minutes.

### F4 — Doorway-network pattern (R2) was identified but not acted on
**Severity:** Important
**What was checked:** `editorial/hub-overlap.csv` lists 19 niche pairs with content-slug Jaccard ≥ 0.50 — meaning half the article slugs are structurally identical between those niche pairs. Examples flagged: `incognito-mode ↔ digital-footprint`, `incognito-mode ↔ device-fingerprinting`, `device-fingerprinting ↔ digital-footprint`, `online-shopping ↔ online-banking`. These pairs are generating the same templated articles ("X security checklist", "X privacy hardening checklist", "complete guide to X") under both niches.
**What this means:** This is the literal doorway pattern Google's Helpful Content classifier penalizes. Even with the editorial gate + scrubbed promo + named byline, a content classifier comparing `incognito-mode/incognito-mode-security-checklist.json` against `digital-footprint/digital-footprint-security-checklist.json` will see two articles that are 80%+ structurally identical, only the niche name swapped. At 505 pages with this duplication pattern, it's a measurable risk.
**Fix:** Two options:
1. **Consolidation (recommended for the 19 pairs):** For each flagged pair, decide which is the canonical niche, redirect the other's pages via 301, and merge the unique content into the canonical version. Cuts page count but raises per-page quality.
2. **Differentiation:** Force each duplicate-pattern article to embed niche-specific data the other can't have (e.g., a tool component, a niche-specific case study, a unique data point). This is the "non-commodity" lever from Google's guide.

For launch, **at minimum noindex the lower-volume side of each of the 19 pairs** until consolidation is done. That removes the doorway signal at zero engineering cost (the editorial gate already supports this — just set those files' `editorial.status` back to `'draft'`).
**Effort:** Noindex side: ~15 minutes. Real consolidation: 1–2 days of editorial work per pair.

### F5 — No first-hand experience, proprietary data, or non-commodity signal in body content
**Severity:** Important (this is the lever Google's guide identifies as the actual long-term win)
**What was checked:** Spot-checked checklists, guides, comparisons. The content is well-structured but exhibits the commodity pattern Google's guide explicitly calls out: every step is generic privacy advice that could appear in any of 100 competitor articles. No first-hand "we tested 40 sites and found X" data. No screenshots of actual settings. No specific case studies. No expert quotes.
**What this means:** Per Google's guide, AI Overviews preferentially cite content that demonstrates first-hand experience or unique expertise. With a named editor (David Shadrake, LinkedIn-verified), there's now a credible voice the site could attach first-hand reporting to — but the content layer hasn't done that yet.
**Fix:** This is the long game and cannot be done at scale by a script. The high-leverage approach is to pick the priority 10–25 pages (highest search volume), have David Shadrake write a 1-paragraph "What we found when we tested this" lead for each, and embed at least one of the site's 12 interactive tools per page (e.g., the hash-generator on the encrypted-messaging guide, the cookie scanner on the ad-tracking checklist). The tools are the unique asset — they generate user-specific data no other site can match. **Make the tools the proof of expertise the articles wrap around.**
**Effort:** ~1 day per priority page, done by the editor. Don't try to scale this — 25 deeply-improved pages outrank 500 commodity pages.

### F6 — Two H1s likely (page title duplication in `<title>`)
**Severity:** Nice-to-have
**What was checked:** Page `<title>` rendered as `Browser Privacy Security Checklist - Complete 2025 Guide | Incognito Browser | Incognito Browser`. The site name appears twice.
**What this means:** Cosmetic but visible in SERPs. Suggests `generateMetadata` is appending the site name AND the OG title path is also appending it.
**Fix:** Inspect `lib/seo.ts` `generateMetadata()` — likely the `fullTitle` constant is being passed to a Next.js Metadata field that re-appends site name. One-line fix.
**Effort:** 5 minutes.

### F7 — No `published_time` / `modified_time` Open Graph tags
**Severity:** Nice-to-have
**What was checked:** Article Open Graph tags lack `article:published_time` and `article:modified_time`. We just stamped `editorial.reviewedAt` on every file with an ISO date — that data exists, it's just not surfaced.
**What this means:** AI features and rich-result eligibility benefit from freshness signals. Not surfacing the timestamp wastes a signal we already have.
**Fix:** Extend `lib/seo.ts` `generateMetadata` to accept `publishedAt` / `modifiedAt` and emit the OG article tags. Detail pages already have the data in `editorial.reviewedAt`.
**Effort:** 15 minutes.

### F8 — Pseudonymous-writer model is sound; LinkedIn link belongs in JSON-LD `sameAs`
**Severity:** Confirmed OK (not a finding to fix — flagging it as verified)
**What was checked:** Author profile pages emit Person JSON-LD with `sameAs: ["https://www.linkedin.com/in/davidshadrake/"]` on the editor profile. The pseudonymous writer + LinkedIn-verified editor pattern is a recognized E-A-T model.
**What this means:** The accountability layer is real. When Google verifies the author profile pages, it sees a Person entity (David Shadrake) backed by a third-party identity (LinkedIn). That's stronger than most LLM-content sites.

---

## Things we did NOT add (and shouldn't, per Google's guide)

- `llms.txt` file — not needed, Google's guide explicitly says so
- AI-specific structured data markup — same
- "Chunked" content for AI retrieval — same
- AI rewrites of existing content — same
- Manufactured backlinks or "mentions" — same

These are tempting at launch and they're all in the negative-leverage column. We didn't do them.

---

## Recommended order of operations before launch

1. **F3** robots.txt — 2 min
2. **F6** title dedup — 5 min
3. **F1** wire Article JSON-LD on all 7 detail templates — 30 min
4. **F2** visible `<ArticleByline>` on all 6 content components — 45 min
5. **F7** Open Graph article timestamps — 15 min
6. **F4** noindex the 19 hub-overlap pairs' lower-volume side until consolidated — 15 min
7. **F5** Pick priority 10 pages, plan David Shadrake editor passes with first-hand content + embedded tools — separate workstream, doesn't block launch

Items 1–6 can be done in a single ~2-hour session. Item 7 is the multi-week work that determines whether the site ranks 6 months from now.

---

## Net assessment

The launch is technically ready. The R3 fix is done cleanly. R1 is structurally done but readers and search engines literally cannot see the author/editor on article pages yet — that's the biggest gap and it's a quick fix.

After F1–F6 land, the site is in a defensible position: indexable, attributable, editorially gated, with a real-name editor accountable for content. It will still be commodity content under the hood (F5) — but that's a content-strategy problem to solve over the next 3–6 months, not a launch blocker.

The riskiest path now is launching before F1/F2 land, because the audit fix advertises "we have an editorial layer" while the rendered HTML shows no such layer. That's a gap a competitor or an SEO journalist could surface in a teardown.

**Ship F1–F6, then go.**
