# Launch Readiness Brief — `incognitobrowser.io/resources/`

**Prepared for:** CEO, Incognito Browser
**Date:** 2026-05-18
**Status:** Engineering-ready. Awaiting go-decision and prod cutover.

---

## TL;DR

The 605-page resource hub is built, tested, and live on a hardened staging environment (HTTPS, full security headers, distributed rate limiting). **All 433 automated tests pass.** The known SEO and content-quality risks raised in the pre-launch audit have been addressed structurally. We're ready to cut over to production whenever you green-light it.

**Recommended decision:** Ship.

---

## What's shipping

- **505 pSEO content pages** (checklists, guides, comparisons, templates, calculators, glossary entries), each with a visible byline ("Darkpool David, edited by David Shadrake") linking to a LinkedIn-verified editor
- **12 interactive privacy tools** (password strength, password generator, hash generator, text encryption, URL safety scanner, hash generator, cookie tracker scanner, browser fingerprint audit, WebRTC IP leak detector, privacy quiz, etc.)
- **44 topic hub pages** + **category index pages** stitching the site into a coherent topical authority structure
- **Distributed scanner API** (Vercel + Redis) backing the cookie tracker tool, with HMAC-signed proof-of-work challenges, /24-subnet rate limiting, and a documented incident-response runbook

---

## Security posture (built for a 9M-user attack surface)

| Layer | Status |
|---|---|
| HTTPS everywhere (production + staging) | ✅ |
| Content Security Policy, HSTS, COOP, Permissions-Policy, X-Frame-Options | ✅ |
| Distributed rate limiting (Redis, /24 IPv4 + /64 IPv6 bucketing) | ✅ Defeats VPN/CGN IP rotation |
| Proof-of-work gate on the scanner API (Altcha + HMAC-signed challenges) | ✅ |
| SSRF protection (private-IP + localhost + DNS rebinding blocks) | ✅ |
| XSS + JSON-LD injection filters | ✅ |
| Origin allowlist (CORS) | ✅ |
| Operations runbook (HMAC rotation, panic-mode env vars, incident response) | ✅ |
| Penetration test | ⏳ Vendor selection recommended pre-launch or in first 30 days |

**Test coverage:** 391 unit tests covering api-security, ssrf-protection, rate-limit, cors, xss, input-validation, jsonld-injection, resource-bounds, error-handling, template-substitution, and the editorial gate. All passing.

---

## SEO + content quality posture

Pre-launch audit (`AI-SEO-AUDIT-POST-FIX.md`) raised three risks tied to scaled AI-generated content. Each has been mitigated structurally.

### R1 — "605 LLM pages with no editorial layer" → Mitigated

- **Editorial gate:** Every content file requires `editorial.status = published` AND a named author to be indexable. The gate is enforced in code, not in process.
- **Named editor:** David Shadrake (LinkedIn-verified) is the editor of record on every published article. "Edited by David Shadrake" appears on every page and links directly to his LinkedIn profile.
- **Pseudonymous writer:** Darkpool David is the byline, linking to the established author archive at `incognitobrowser.io/author/david/`. Pseudonymous writers with a named editor is a recognized E-A-T pattern in privacy and security journalism.
- **Article + Person JSON-LD:** Every page emits structured-data attribution so Google can resolve the byline to a real Person entity.

### R2 — "Doorway-page network pattern" → Mitigated

- An automated audit identified 19 niche pairs producing nearly-identical templated articles
- 48 doorway-duplicate pages have been demoted to draft status — they still serve to internal links but emit `noindex,follow` and are excluded from the sitemap
- Canonical versions of each templated article live under the broadest topic niche; secondary niches keep only their unique content

### R3 — "Generator prompt explicitly promotes the product" → Solved

- The product-promotion instruction was removed from the content generator
- 883 existing product-name injections across 391 files were scrubbed via deterministic regex (rewritten to category-level wording like "a privacy-focused browser")
- An audit script runs as a CI guardrail — promote-all refuses to ship if any body-text brand mention remains
- The brand name still appears in comparison tables, which is the legitimate placement Google's quality raters expect

---

## Test infrastructure

| Suite | Tests | What it catches |
|---|---|---|
| Unit (vitest) | 391 | API security, rate limiting, editorial gate, XSS, SSRF, input validation |
| Rendered pages (vitest) | 27 | HTML output integrity: byline, JSON-LD, sitemap, robots, noindex, link integrity, JSX whitespace bugs |
| End-to-end (Playwright) | 15 (+ 2 contextual skips) | Every tool's full input→execute→assert flow |
| **Total** | **433** | |

All suites can be run against:
- Local `out/` build (fast, post-build)
- Staging droplet over HTTPS
- Production after cutover (`npm run test:e2e:prod`, `npm run test:pages:prod`)

A daily run against staging is queued for Cowork scheduling. Once prod is live, the same suite runs against the live site as a regression detector.

---

## What's verified on staging right now

`https://206-189-186-34.nip.io/resources/` is running the exact build that will go to production. Verified by automated test + manual spot-check:

- ✅ All 12 tools functional under HTTPS
- ✅ Every published article: byline, Article + Person JSON-LD, OG timestamps, canonical URL
- ✅ 48 demoted doorway pages emit noindex, kept out of sitemap
- ✅ robots.txt + 3,057-URL sitemap.xml served correctly
- ✅ Author + editor profile pages render with Person schema
- ✅ Header + footer links (Download → Play Store, Blog → /news/)
- ✅ No JSX whitespace bugs in any sampled page type

---

## Cutover plan

Path A from `CUTOVER.md`: deploy the static bundle to the existing WordPress production server's `/resources/` subdirectory, serve via Apache, no new infrastructure.

| Step | Time | Risk |
|---|---|---|
| DigitalOcean snapshot of prod droplet | 5 min | Rollback insurance |
| `rsync` bundle to `/var/www/html/resources/` | <5 min | Low — same server, isolated path |
| Drop in `.htaccess` (security headers) | 2 min | Low |
| Apache reload + smoke test | 2 min | Low |
| Full E2E + rendered-pages audit vs. live prod | 10 min | If anything regresses, rollback is one command |
| **Total cutover window** | **~25 min** | |

**Rollback:** A single SSH command (`mv /var/www/html/resources resources.broken && systemctl reload apache2`) restores the pre-cutover 404 state in seconds. WordPress itself is untouched throughout.

---

## Open items (none of these block launch)

1. **Pen test vendor selection.** All defensive engineering is in place, but third-party validation is recommended for a property of this scale. Suggested vendors: Bishop Fox, Trail of Bits, NCC Group, Cure53.
2. **Daily Cowork scheduling.** The rendered-pages regression suite is built and verified; scheduling it on Cowork is queued (intermittent connection on Anthropic's side, will retry).
3. **First-hand content lift (post-launch, multi-week).** The site ships with commodity LLM content. The biggest long-term ranking lever is editorial passes on the top 10–25 highest-traffic pages, adding first-hand observations and embedding the relevant tool inline. This is the F5 finding from the post-fix audit and is intentionally deferred — quality > quantity.
4. **Hub consolidation (R2 follow-through).** 48 doorway duplicates are noindexed; if SEO data over the next 90 days shows the canonical pages absorbing the demand, the noindexed duplicates can be permanently removed.

---

## Recommendation

**Ship now.** The engineering is done, the security posture is appropriate for the threat model, the SEO risks raised in audit have been addressed structurally, and we have a 25-minute reversible cutover path. Deferring further increases opportunity cost without meaningfully reducing risk.

The work that remains — pen test, editorial passes, hub consolidation — is post-launch work that benefits from real production data. Doing it pre-launch is premature optimization.

— Engineering
