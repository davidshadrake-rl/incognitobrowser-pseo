# Pro vs Free — Brief

Audit of commit b7129a8. Status update: most defects below are already fixed as of commit 495024a (see note at top of the full report). This is the short version — see PRO-VS-FREE-ANALYSIS.md for evidence and file/line detail.

## Verdict

The split is mechanically sound: free builds 1,330 pages with 24 free tools and zero Pro tools; Pro builds exactly 22 Pro tools and nothing else; both link audits report zero dangling links; Pro's security posture matches free with no regression. What wasn't ready — and has since been fixed — was the seam between deployments: dead default hosts on both sides, stale copy, and a broken Play referrer on 500 report cards.

## Side-by-side snapshot

| | Free | Pro |
|---|---|---|
| Pages | 1,331 | 56 |
| Tools | 29 (8 engines, 23 published) | 22 (4 engines) |
| Report cards / guides / checklists / etc. | 502 + ~1,300 content pages | 0 (redirect to /tools) |
| Sitemap | Yes | None (noindex) |
| Crawlable | Yes | Yes, with noindex header (fixed — was blanket Disallow) |

**Duplicate shells on Pro:** 4 engines are presented as 22 near-identical pages (browser-privacy alone has 11 shells). Only title/description/niche-copy differ; the underlying tool, tips, and mistakes are byte-identical. Recommendation not yet decided: collapse to one canonical page per engine.

## Fixed (14 confirmed findings, all shipped in 495024a)

1. Dead `pro.incognitobrowser.io` / `incognitobrowser.io/resources` defaults → now point at live Vercel hosts.
2. Literal `{grade.grade}` in 500 report-card Play links → real template values.
3. Free `/tools` page described Pro-only tools → tier-aware copy.
4. What's My IP missing from the featured grid → added.
5. 6 drafted quiz duplicates listed publicly → hidden from every listing surface.
6. Pro `robots.txt` blanket-disallowed crawlers, which stopped them from ever reading the noindex → now crawlable + `X-Robots-Tag: noindex`.
7. CSP referenced a dead API host → removed.
8. Debug echo of the origin allowlist size → now opt-in only.
9. Proof-of-work tokens were replayable for their full 90s window → single-use once Redis exists.
10. Build guards ran before the static export, judging the previous build → moved to run after.
11. No mobile nav / no visible header CTA on phones → no-JS `<details>` menu + always-visible CTA added.

## Still open — needs a decision or infra

- **Redis not provisioned.** Rate limiting is per-instance in-memory on both projects; the new `/event` counters are silently discarded without `REDIS_URL`. (Checked into Vercel dashboard 2026-09-08: old free-tier Redis instance is dead/uninstalled; new instances start at $8/mo. Held pending your decision.)
- **SSRF guard is lexical only** — no DNS resolution check, so some private-IP-resolving hostnames could reach the fetch. Pre-existing, not a Pro regression.
- **`ALLOWED_ORIGINS` unset on Pro** — falls back to the default allowlist, which includes the free site's origin.
- **22 retired free tool URLs have no redirects** (404 instead of 301) if anything indexed the old paths.
- **Pro's 22 duplicate shells** — collapse to 4 canonical pages, or keep as-is for the niche-specific copy and cross-links. Your call.

## Recommendation

Ship as-is (already done) for the split itself. Next: provision Redis, decide on the Pro shell consolidation, and add redirects for the retired free URLs if traffic data shows they're still getting hits.
