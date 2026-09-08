<!--
  STATUS (2026-09-08, maintained by the engineer). This audit was run on
  commit b7129a8 by nine review lenses + a completeness pass, with every
  high/medium finding adversarially verified by two independent agents
  (14 confirmed, 4 refuted, 89 low/info observations). Fixed in the funnel
  PR that followed: dead default hosts (lib/tiers.ts now defaults to the
  live Vercel hosts), the literal {grade.grade} in 500 Play referrers,
  tier-aware /tools copy and meta description, What's My IP featured, the 6
  drafted quiz duplicates hidden from every listing, Pro-specific Play
  attribution (utm_source=pro), CSP dead host removed, DEBUG_ORIGINS echo
  now opt-in, single-use proof-of-work tokens when Redis is configured,
  guards moved to run AFTER the static export (postbuild:static), a
  tier-aware visibility unit test, Pro robots.txt made crawlable with an
  X-Robots-Tag noindex header, a no-JS mobile menu and an always-visible
  header CTA, and the two browser-privacy shells that over-claimed DNS
  detection.
  Still open and needing the owner: provision Redis (REDIS_URL on both
  Vercel projects — rate limiting is per-instance until then, and the new
  /event counters are discarded without it); the SSRF guard is lexical
  (no DNS resolution check); ALLOWED_ORIGINS unset on Pro; the 22 retired
  free URLs have no redirects; Pro's 22 duplicate shells (collapse to one
  canonical page per engine recommended, not decided).
-->
# Pro vs Free: what we have, how it is presented and organized, and what to fix

Audit date: 2026-09-07. Repo: `/Users/davidshadrake/Documents/Radius Labs/incognitobrowser pseo2.0/pseo`, HEAD `b7129a8` (20:47, working tree clean). Everything below was measured on the free static export (`out/`, 1,331 HTML files) and the Pro server build snapshot (`scratchpad/pro-app`, 56 HTML files), both built from that commit, plus live probes of the two Vercel projects (`incognitobrowser-pseo.vercel.app`, `incognitobrowser-pro.vercel.app`), which still run the pre-split code. Nine review lenses (free IA, Pro IA, cross-links, SEO, code, security, tests, content, catalogue UX) plus a completeness pass and a refutation pass fed this document; every count was re-run against the final commit where lenses disagreed.

## 1. Verdict

The split itself is correct and mechanically sound: the free export builds 1,330 pages with 24 free tool pages and zero Pro tool pages, the Pro build serves exactly 22 Pro tool pages (4 engines) and nothing else, both link audits report 0 dangling same-site links, and the security posture of the Pro instance is byte-identical to free with no Pro-specific regression. What is not ready is the seam between the two deployments: with the env vars as they stand, all 502 free-to-Pro links bake the dead host `pro.incognitobrowser.io`, and 243 of 244 Pro-to-free links land on the WordPress homepage because `incognitobrowser.io/resources/*` 301s to `/` until the static export is cut over. Behind that sit a handful of copy regressions on the indexed free `/tools` page (it still advertises three Pro-only tools), a broken Play Store attribution string on 500 report cards, a Pro `robots.txt` that prevents crawlers from ever reading the `noindex`, and two pre-existing security gaps (in-memory rate limiter on both projects, lexical-only SSRF guard) that Pro inherits on day one. None of it is hard; all of it should land before the split is deployed to either Vercel project or rsynced to `/resources`.

## 2. Side-by-side inventory

| Dimension | Free (marketing site) | Pro (product surface) |
|---|---|---|
| Deployment | `incognitobrowser-pseo.vercel.app` (server mode, no basePath); production target `incognitobrowser.io/resources` (static export, basePath `/resources`, trailing slashes) | `incognitobrowser-pro.vercel.app` (server mode); planned `pro.incognitobrowser.io` (no DNS yet) |
| HTML files in build | 1,331 (1,330 `index.html` + `404.html`) | 56 |
| Report cards (`/site`) | 502 (index, methodology, 500 domains; grades A 295 / B 125 / C 63 / D 17 / F 0) | 0 (`/site`, `/site/methodology` are 307 shells to `/tools`) |
| Guides | 177 (index + 44 niche indexes + 132 guides) | 0 (307 shell) |
| Checklists | 134 (index + 44 + 89) | 0 (307 shell) |
| Templates | 134 (index + 44 + 89) | 0 (307 shell) |
| Comparisons | 90 (index + 44 + 45) | 0 (307 shell) |
| Calculators | 89 (index + 44 + 44) | 0 (307 shell) |
| Glossary | 107 (index + 106 terms) | 0 (307 shell) |
| Topic hubs (`/topics/<niche>`) | 44 (no `/topics/` index) | 0 |
| Authors | 2 (no `/authors/` index) | 0 |
| Tool catalogue (`/tools`) | 1 | 1 |
| Tool niche hubs (`/tools/<niche>`) | 23, each with 1 tool (password-security has 2) | 22, each with exactly 1 tool |
| Tool pages | 24 across 8 engines: privacy-quiz 9 (3 published + 6 drafts), permission-checker 4, text-encryption 4, password-strength 3, hash-generator 1, password-generator 1, useragent-analyzer 1, whats-my-ip 1. 6 pages are `editorial.status: draft` (noindex, out of sitemap) | 22 across 4 engines: browser-privacy 11, cookie-analyzer 5, url-analyzer 3, metadata-viewer 3. All published |
| Shell duplication | Near-duplicates exist (9 privacy-quiz shells, 4 permission-checker, 4 text-encryption, 3 password-strength) but no two visible titles collide | Within an engine only 7 JSON fields vary (niche, slug, title, metaDescription, keywords, toolType, description); inputs, how-it-works, 5 tips, 5 mistakes, author, editor are byte-identical across all 5/11/3/3 shells. Two catalogue entries share the title "Browser Privacy Audit" |
| Featured cards on `/tools` | 7 (whats-my-ip is missing from `FEATURED_TOOLS`); 5 of 7 open a page whose H1 differs from the card title | 4; 3 of 4 open a page whose H1 differs from the card title |
| Header nav | Logo, 8 section links (`hidden lg:flex`, no mobile menu), "Download Browser" (`hidden sm:inline-flex`) | Logo "Incognito Pro" (links `/`, which 307s to `/tools`), single "Tools" link, "Download Browser" |
| Footer | Resources (8 links), Product (Download, Blog), tagline "Free privacy resources provided by Incognito Browser" | Resources (Tools only), Product (Download, Blog), same "Free privacy resources" tagline; no link to the free site or report cards |
| Index status | Indexable; self-canonical on `https://incognitobrowser.io/resources/...`; home page has no canonical or og:url | `<meta name="robots" content="noindex, follow">` on all 45 real pages AND `robots.txt` `Disallow: /` |
| Sitemap | 1,029 URLs (was 1,051 live; the 22 Pro paths are the exact diff). Omits 245 indexable pages: 23 tool hubs, 220 category niche indexes, 2 authors. `<loc>` has no trailing slash while canonicals do | Empty |
| Canonical / og:url origin | `https://incognitobrowser.io/resources` | `https://pro.incognitobrowser.io` (no DNS) unless `NEXT_PUBLIC_PRO_URL` is set on the Pro project; live pre-fix Pro canonicals point at now-removed free URLs |
| Redirects | None in `next.config.ts`; the 22 retired tool URLs become hard 404s (static export cannot redirect) | 9 routes 307 to `/tools` (`/`, 6 category indexes, `/site`, `/site/methodology`); all 15 dynamic routes `fallback: false`, so free paths 404 |
| 404 behaviour | Next default body inside site chrome (`out/404.html`); nginx config in `HEADERS-NGINX.md:19` has no `error_page`, so the branded page is never served on the droplet/WP target | Next default body, title still "Privacy Resources", links `/` and `/tools` only; no hand-off to free |
| Links to the other deployment | 502 links, one target: `https://pro.incognitobrowser.io/tools/ad-tracking/cookie-tracker-scanner` (500 report cards + `/site` + `/site/methodology`). Dead on the static build; resolves only when built with `NEXT_PUBLIC_PRO_URL` | 244 links to 156 distinct free URLs on 44 pages (9 per tool page: "Free tools", 6 related cards, topic hub, Blog; 2 per hub). 155/155 targets exist in `out/`. Today 243 land on the WP homepage; the Pro Vercel project has no `NEXT_PUBLIC_FREE_URL` |
| Play Store attribution | Header/footer: `utm_source=resources&utm_medium=site&utm_campaign=header|footer` on all 1,330 pages. Report cards: `utm_content=grade-{grade.grade}` literal on 500 pages (also live) | Identical header/footer strings (46 each). Pro installs are indistinguishable from free-site installs; no per-tool `utm_content`; no result-moment CTA in any engine |
| API surface | `/challenge`, `/scan-url`, `/ip` | Same three routes; `/ip` has no consumer on Pro |
| Tests that run on Vercel builds | `vitest run` before `next build`: 8 tier unit tests; the 7 rendered-page split guards and the link audit skip (no `out/`) | Same; nothing Pro-specific executes on the Pro project's build |

## 3. How each deployment is presented and organized

### 3.1 Walking through the free site

Landing on `/resources/` (home): hero "Interactive checklists, tools, guides... All free", a 7-card "Browse by Type" grid from `data/taxonomy.json` (Report Cards is not one of them; the 502-page section is reachable from home only through nav and footer), then 44 topic cards. This is the only topic directory on the site: there is no `/topics/` index and Topics is absent from nav and footer, even though topic hubs are the most-linked layer (351 pages link `/topics/cookie-management/`).

Header: desktop shows 8 section links plus Download. Below 1,024px the nav disappears with no menu button; below 640px the Download button disappears too, leaving the logo alone. For an Android-browser audience this is the primary conversion surface and it is empty on phones. The footer carries the same 8 links, so every mobile visitor navigates by scrolling to the bottom.

`/tools` (`out/tools/index.html`, 84 KB, commit b7129a8 layout): H1 "Free Privacy Tools" and a two-paragraph intro; then the A-to-Z catalogue block: a search box, a 27-cell letter bar (12 active letters on free), a "Browse by topic" chip row with 23 chips linking the 23 `/tools/<niche>/` hubs; then 7 featured engine cards; then the full A-to-Z list of 24 entries (title, toolType chip, niche label, two-line description). Totals: 56 `/tools/` hrefs to 48 unique targets (24 tool pages, 23 hubs, the catalogue). Search is client-side, progressive enhancement, no dependencies; the server-rendered list and `#letter-X` anchors work without JS. This is the catalogue the owner asked for and it is already live on both Vercel deployments (`data-count="24"` free, `22` Pro).

Three things are wrong on this page. The `<meta name="description">` still reads "Free interactive privacy tools: password checker, browser fingerprint audit, text encryption, URL safety scanner, and more. All run client-side." Two of those tools are Pro-only and What's My IP is server-assisted. The intro still says "The cookie & tracker scanner is the exception: it fetches the URL you enter through our server... Server-assisted tools are labeled", but there is no scanner on this site and no "Server-assisted" badge anywhere on the page (0 occurrences outside that sentence). And What's My IP, the tool the strategy docs call the primary free funnel and the VPN-focus tool, is the only free engine not in `FEATURED_TOOLS` (the array comment says "11 unique tool engines"; there are 12).

The catalogue lists all 24 free pages including the 6 noindex privacy-quiz drafts, unmarked, so the indexed hub links 6 pages that are told not to index; each draft has 9 inbound links (catalogue, its hub, its topic hub, 6 same-niche related blocks). Five of the seven featured cards open a page whose H1 is different from the card ("Password Strength Checker" opens "Post-Breach Password Checker", "User Agent Analyzer" opens "Gaming Browser Analyzer") because `engineToLink` picks the alphabetically first niche per engine.

`/tools/<niche>/` hubs (23): breadcrumb "Home / Tools / Niche", H1, one card (two for password-security), and a "View the full niche hub" link to `/topics/<niche>/`. Each has exactly one inbound link (its topic chip on `/tools`), no JSON-LD, and is not in the sitemap. They are thin but not orphans.

Tool page (e.g. `/tools/vpn-privacy/whats-my-ip/`): a plain "Tools / VPN & Proxy" strip where only "Tools" is a link, badges, the engine, how-it-works, 6 same-niche related items (guides, checklists, comparison), "View all VPN & Proxy resources". No sibling tools, no hub link, no cross-niche links. What's My IP is described on the catalogue as "100% client-side, nothing logged" while its own page renders a "Server-assisted" badge with the cookie scanner's tooltip text.

Topic hubs (`/topics/<niche>/`): hero "N resources across M categories", sections per content type, "Related Topics" (3 siblings), related searches. For the 21 niches whose only tool was a Pro engine the Tools section is omitted entirely (cleanly, no empty heading) and the hero count drops to "5 categories", while the meta description still promises "guides, checklists, tools, comparisons, templates, and calculators". Four of those niches (device-fingerprinting, drone-surveillance, incognito-mode, online-shopping) have no guide, no checklist and no calculator either, so their hubs are now 1 comparison + 2 templates. incognito-mode is the brand's head term.

Report cards: `/site/` is 1.17 MB and lists every domain twice (A-to-Z catalogue plus per-category sections, 1,023 links for 502 targets), with no breadcrumb. Domain pages are the best-linked and best-structured page type on the site (breadcrumb, grade, deductions, cookies, third parties, headers, 6 category siblings, 6 related items, link row) and carry the only free-to-Pro CTA: "Scan any URL with Incognito Pro" beside "Get Incognito Browser". The breadcrumb reads "Resources / Resources / Report Cards / cnn.com" because `app/site/[domain]/page.tsx:77` passes a label the component already prepends. On the 10 pages that state the site loaded no trackers, the CTA still says Incognito Browser "blocks tracking cookies and ad trackers like these".

Breadcrumbs use three dialects: content pages and topics start at "Resources", niche indexes and tool hubs start at "Home", tool pages render an unlabelled div, and category indexes, `/site/`, `/site/methodology` and `/tools` have none.

Orientation rating: fair on desktop (strong category layer, A-to-Z catalogues everywhere, consistent related blocks), weak on mobile (no nav, no header CTA). A visitor who arrives for the two highest-intent tools (cookie scanner, fingerprint test) finds a stale promise on `/tools` and reaches Pro only from a report card, on a host that does not resolve in the static build.

### 3.2 Walking through Pro

Landing on `/` sends a 307 to `/tools`; so do `/guides`, `/checklists`, `/comparisons`, `/glossary`, `/templates`, `/calculators`, `/site` and `/site/methodology`. The logo also links `/`, so every logo click costs a redirect.

`/tools` (`pro-app/tools.html`, 69 KB): H1 "Pro Privacy Tools", the same two-paragraph intro as free (here the cookie-scanner sentence is true), search + letter bar (8 active letters), 22 topic chips linking 22 one-card hubs, 4 featured cards (Browser Privacy Audit, Cookie & Tracker Scanner, URL Safety Checker, Image Metadata Viewer, each badged "Pro" and "Client-side" or "Server-assisted"), then the A-to-Z list of 22 entries. 48 `/tools/` hrefs to 44 unique targets. The `<meta name="description">` is the free one verbatim ("Free interactive privacy tools: password checker... text encryption... All run client-side"), naming two engines that do not exist here.

The duplicate-shell problem, by engine, as a visitor experiences it:

| Engine | Shells | What differs between shells | What is identical |
|---|---|---|---|
| browser-privacy | 11 (ai-privacy, browser-extensions, browser-privacy, device-fingerprinting, incognito-mode, isp-tracking, private-search, public-wifi, tor-privacy, vpn-privacy, workplace-privacy) | Title, one-line description, niche label, 8 outbound free-site links (78 distinct targets across the 11) | The engine (16 checks), how-it-works, 5 tips, 5 common mistakes, inputs, author, editor |
| cookie-analyzer | 5 (ad-tracking, ccpa, cookie-management, gdpr, privacy-policies) | Same 7 metadata fields; `diff` of two shells = 11 lines, all metadata | Everything else; rendered how-it-works/tips/mistakes byte-identical |
| url-analyzer | 3 (malware-protection, online-shopping, phishing) | Same | Same |
| metadata-viewer | 3 (dating-privacy, drone-surveillance, facial-recognition) | Same | Same |

So the A-to-Z list presents 22 entries for 4 tools. Half of them (11) are the same browser audit, interleaved alphabetically with the rest. Two entries carry the exact title "Browser Privacy Audit" (browser-privacy and incognito-mode) and the featured card of the same name opens a third URL, `ai-privacy/browser-privacy-audit`, whose H1 is "AI Privacy Audit". The engines have no tier or niche awareness (`grep -rl 'IS_PRO\|tiers' components/tools/` matches nothing; `renderToolEngine(data.toolEngine)` takes no niche), so the Pro engine is functionally what the free site used to ship, minus nothing, plus nothing. The shells are not user-identical, though: each carries niche-specific copy and a niche-specific Related Resources block back to the free site, and that block is the only Pro-to-free content bridge apart from the "Free tools" back-link. That is why this document recommends presenting the shells as variants of 4 engines rather than deleting or redirecting them (see section 7), which would also unwind the owner's 22-Pro-pages decision.

Tool page chrome: brand "Incognito Pro", nav "Tools", Download. Visible breadcrumb "Tools / Niche" (niche unlinked). Badges: toolType, "Pro", "Client-side" (17 pages) or "Server-assisted" (the 5 cookie shells), and "← Free tools" (absolute link to the free catalogue). Engine, then how-it-works/tips/mistakes, then Related Resources (6 absolute free links) and "View all niche resources" (absolute). JSON-LD: BreadcrumbList rooted at "Resources" on the Pro origin (a 307 shell), Article, WebApplication with `offers.price "0"`. Footer: "Free privacy resources provided by Incognito Browser". After a scan the result area ends with "Export CSV"; there is no Play Store CTA at the result moment, no deep link, no desktop hand-off, no link back to the domain's report card. The only exits are header/footer Download (attributed as free-site installs) and links to the free site (which today 301 to the WordPress homepage).

Hubs (22): H1 "Niche Privacy Tools", one card, "View the full niche hub" (absolute free link), meta description "Free privacy tools tailored to niche. All run client-side" (false for the 5 cookie hubs, wrong branding on all 22), no JSON-LD. Each has one inbound link (its topic chip).

Orientation rating: adequate for a noindex product surface with a single entry point, but it reads as a re-skinned free resource library rather than a product: "Free" in meta descriptions, footer and hub copy; "Resources" as the breadcrumb root; 22 entries for 4 engines; no route back to report cards; no next step after a scan.

## 4. Confirmed defects

Severity scale: high = broken for users or wrong for search engines; medium = degrades UX, SEO or security posture; low = polish.

### High

1. **All 502 free-to-Pro links bake the dead host `pro.incognitobrowser.io`.** Where: `lib/tiers.ts:43` default `PRO_BASE_URL`; rendered by `app/site/[domain]/page.tsx:210`, `app/site/page.tsx:42`, `app/site/methodology/page.tsx:32`. Evidence: `grep -rho 'href="https://pro.incognitobrowser.io[^"]*"' out --include=index.html | sort | uniq -c` = 502 x `/tools/ad-tracking/cookie-tracker-scanner`; `dig +short pro.incognitobrowser.io` empty; `curl` = 000. The static export is the `incognitobrowser.io/resources` production path, so today's export ships 500 indexed pages with a dead CTA. Fix: build the static export with `NEXT_PUBLIC_PRO_URL=https://incognitobrowser-pro.vercel.app` (add it to the `build:static` script or the droplet build env), or change the `lib/tiers.ts` default to the Vercel host until DNS exists; add a guard in `tests/rendered-pages.test.ts` asserting the CTA host is in an allowlist of hosts known to resolve (the current regex `https?:\/\/[^"]+` accepts anything).

2. **243 of 244 Pro-to-free links land on the WordPress homepage.** Where: `lib/tiers.ts:47` default `FREE_BASE_URL` = `https://incognitobrowser.io/resources`; consumed by `lib/content.ts:115-142`, `app/tools/[niche]/[slug]/client.tsx:67`, `app/tools/[niche]/page.tsx:83`, `app/tools/[niche]/[slug]/page.tsx:106`. Evidence: `curl -sI https://incognitobrowser.io/resources/tools` = 301 to `https://incognitobrowser.io`; same for `/resources/`, guides, topics, `/resources/site/mozilla.org`. The live Pro project already uses this default (its pre-fix back-link is `https://incognitobrowser.io/resources/tools/...`), and `NEXT_PUBLIC_FREE_URL` appears in no `.md` file. Pre-fix these related links were same-site and worked, so deploying the split as-is turns 8 working links per Pro tool page into 8 dead ends. Fix: set `NEXT_PUBLIC_FREE_URL=https://incognitobrowser-pseo.vercel.app` on the Pro Vercel project now (build-time var, redeploy after); flip to `https://incognitobrowser.io/resources` only after a curl of a guide URL returns 200 rather than 301; document both vars in `DEPLOYMENT.md`/`SECURITY-DEPLOY.md`; extend `scripts/security-smoke.mjs --pro` to fetch one baked free link and assert the title is not the WordPress homepage.

### Medium

3. **Indexed free `/tools` meta description and intro describe Pro-only tools.** Where: `app/tools/page.tsx:10` (description), `:142-146` (intro). Evidence in section 3.1. Fix: branch both strings on `IS_PRO_DEPLOYMENT` (already imported there). Free: name the 8 free engines, say "run in your browser; What's My IP asks our API for your public IP". Pro: "Pro privacy tools: cookie & tracker scanner (server-assisted), browser privacy audit, URL safety checker, image metadata viewer." Add a rendered-pages guard that free `/tools/` does not contain "cookie & tracker scanner", "fingerprint audit" or "URL safety scanner".

4. **Report-card Play Store link carries the literal string `{grade.grade}`.** Where: `app/site/[domain]/page.tsx:209` (plain string attribute, not a template literal). Evidence: `grep -l 'grade-{grade.grade}' out/site/*/index.html | wc -l` = 500; live `incognitobrowser-pseo.vercel.app/site/mozilla.org` shows the same. Fix: `href={\`...utm_content%3Dgrade-${grade.grade}\`}`; add a test that no rendered href contains `{`.

5. **Pro `robots.txt` `Disallow: /` prevents crawlers from reading the `noindex`.** Where: `app/robots.ts:14`, `lib/seo.ts`. Evidence: live `robots.txt` = `Disallow: /`; every Pro page emits `noindex, follow`; 502 indexed free pages link the scanner URL. A URL blocked by robots.txt is never fetched, so Google can index it from inbound links alone as a title-less entry. Fix: on Pro return `Allow: /` (or `Allow: /tools`) and keep the meta noindex, optionally adding `X-Robots-Tag: noindex` in `next.config.ts` headers when `IS_PRO_DEPLOYMENT`; assert in `tests/tiers.test.ts`; add a smoke check that a Pro tool page returns 200 with the noindex meta.

6. **Per-IP rate limit is per-instance in-memory on both live projects.** Where: `lib/rate-limit.ts` (`getClient` returns null without `REDIS_URL`); Vercel env of both projects. Evidence: 10 parallel unauthenticated POSTs to `/scan-url` on Pro returned `x-ratelimit-remaining` 5,8,9,3,6,9,4,9,7,2 (three fresh counters), 0 x 429; free 8,7,9,6,9,9,9,9,5,9; `X-RateLimit-Reset` = now+60 on both, not a 60-aligned window as the Redis path emits. The smoke test passes only because it fires 12 POSTs sequentially onto one warm instance. Not a Pro regression, but a regression against `OPS-RUNBOOK.md` and `VERCEL-MIGRATION.md:204` (Redis URL is account-specific and did not survive the account move). Fix: provision Redis on the Radius Labs Vercel account, set `REDIS_URL` on both projects, change the smoke burst to `Promise.all` and require at least one 429.

7. **SSRF guard is lexical only; IPv4-mapped IPv6 literals and private-resolving hostnames reach the fetch.** Where: `lib/scanner.ts isBlockedHostname`; `app/scan-url/route.ts`. Evidence (live Pro, valid PoW): `http://[::ffff:127.0.0.1]/` = 502 (fetch attempted; blocked hosts return 400), `http://localhost./` = 502, `http://127-0-0-1.nip.io/` = 502. WHATWG URL serialises the mapped address as `[::ffff:7f00:1]`, so the v4 regexes never see it; `tests/ssrf-protection.test.ts:77` passes only because it feeds the dotted form and tests an inline copy of the function (lines 16-51) rather than the exported one. Limited impact on Vercel Lambda; real on the EC2 plans in `EC2-DEPLOY-PLAN.md` where `[::ffff:a9fe:a9fe]` reaches IMDS. Fix: expand mapped/NAT64/6to4 literals to their embedded IPv4 before range checks, strip trailing dots, add `dns.lookup(hostname, {all:true})` and reject if any address is in a blocked range; import the real function in the test and add round-trip cases.

8. **Proof-of-work token is replayable for its 90s TTL.** Where: `lib/altcha.ts` (comment: no nonce cache without Redis); `app/scan-url/route.ts`. Evidence: one solved token accepted 8 times on live Pro. Combined with defect 6, one ~100ms solve buys unlimited scans. Fix: once Redis exists, `SET pow:<salt> 1 NX EX 90` after signature verification and reject replays with 401; add a same-token-twice smoke check.

9. **No automated guard exercises the Pro deployment in the release chain, and the free guards judge the previous build.** Where: `package.json` (`"build": "vitest run && next build"`, `"build:static": "vitest run && BUILD_TARGET=static next build"`); `tests/rendered-pages.test.ts:38-45`; `tests/link-audit.test.ts:11,20`. Evidence: on Vercel there is no `out/`, so the 7 split guards and the link audit skip; the Pro link audit exists only as a comment; locally vitest evaluates `out/` before `next build` rewrites it (observed: `out/` deleted at 20:27 and rewritten at 20:28 during the audit). A scratch test proved a build-free Pro guard works: with `vi.stubEnv('NEXT_PUBLIC_TIER','pro')` + `vi.resetModules()`, `generateStaticParams()` = 22 Pro entries, `sitemap()` = [], cross links absolute; 2 tests in 561ms. Fix: move that test into `tests/tiers.test.ts`; add `"postbuild": "node scripts/audit-links.mjs .next/server/app --mode server"` (0.49s on 1,330 pages, 0.08s on 56) and `"postbuild:static": "vitest run tests/rendered-pages.test.ts tests/link-audit.test.ts"`.

10. **Six noindex draft tool pages are listed and linked as ordinary entries.** Where: `app/tools/page.tsx` (AtoZCatalogue `items` filtered by `engineVisibleInThisTier` only); hubs; topic hubs; related blocks. Evidence: `grep -rl 'href="/resources/tools/email-privacy/privacy-score-quiz/"' out --include=index.html` = 9 files; the target carries `noindex, follow`; the catalogue count line says "24 tools"; `/tools/data-brokers/` consists solely of one draft card. Fix: apply `isPublished()` on every listing surface (catalogue, chips, hub cards, topic hubs, related blocks) so the count becomes 18, or promote the 6 quizzes; a hub whose only child is a draft should not build. Owner decision either way.

11. **No mobile navigation and no header CTA on phones.** Where: `app/layout.tsx:69` (`hidden lg:flex`), `:100` (`hidden sm:inline-flex`); no `lg:hidden`, `<details>`, `<button>` or `aria-expanded` in the header. Evidence: `grep -o '<nav class="[^"]*"' out/index.html`. Fix: a no-JS `<details><summary>` menu under `lg` listing `visibleNav`, and an icon-only Play Store button below `sm` with its own `utm_campaign=header-mobile`.

12. **Featured cards open pages with a different H1 (5/7 free, 3/4 Pro); one exact title collision on Pro.** Where: `app/tools/page.tsx` `engineToLink` (first published item in alphabetical niche order); `data/tools/incognito-mode/browser-privacy-audit.json`. Fix: add a `niche` field per `FEATURED_TOOLS` entry naming the canonical shell (see section 7.2), fall back to first-published only if that shell is missing; render the destination's own title on the card; rename the incognito-mode shell to "Incognito Mode Privacy Audit"; add a guard that no two visible tools in a tier share a title.

13. **Pro copy still says "Free" everywhere except the H1.** Where: `app/tools/page.tsx:10` (meta description), `app/tools/[niche]/page.tsx:39,65` (22 hub descriptions "Free privacy tools tailored to... All run client-side"), `app/layout.tsx:140` (footer tagline on 56/56 pages), `:12/16/24` (site description feeding the 404 and redirect-shell title "Privacy Resources"), `aria-label="Privacy Resources home"`. Fix: branch on `IS_PRO_DEPLOYMENT`; derive hub descriptions from the engine's `processing` flag (also corrects the free vpn-privacy hub).

14. **Pro canonical, og:url and JSON-LD name the non-resolving host.** Where: `lib/seo.ts:13-18`, `lib/tiers.ts:42-43`. Evidence: `pro-app/tools/ad-tracking/cookie-tracker-scanner.html` canonical = `https://pro.incognitobrowser.io/...`. Low search impact (noindex) but share previews and any future analytics reference a dead host. Fix: set `NEXT_PUBLIC_PRO_URL=https://incognitobrowser-pro.vercel.app` on the Pro project too; flip both projects together when DNS lands; assert in `tests/tiers.test.ts` that on Pro the value is not the placeholder default.

15. **Play Store attribution cannot separate Pro installs from free-site installs.** Where: `app/layout.tsx:82,130` (no tier branch in the referrer). Evidence: 46 + 46 identical strings in `pro-app`. Fix: one helper (`lib/playstore.ts playStoreUrl({medium, campaign, content})`); on Pro `utm_source=pro&utm_medium=pro-tools`, and on tool pages `utm_content=<niche>-<slug>`.

16. **Funnel dead-ends after a Pro scan.** Where: `components/tools/CookieAnalyzerTool.tsx:523-537` (result area ends at "Export CSV"), `URLAnalyzerTool.tsx`, `BrowserPrivacyTool.tsx` (0 hrefs); `pro-app/site.meta` (307). Evidence: no `intent://`, `market://`, QR, `sms:` or `mailto:` anywhere in `app`/`components`/`lib`, although `FUNNEL-AND-TOOLS-STRATEGY.md:30,62` specifies an S4 hand-off; no href to `/resources/site` on Pro. Fix: a tier-agnostic ResultCTA rendered once a result exists: "Incognito Browser blocks these N trackers by default" + Play link with Pro referrer and `utm_content=<slug>-<bucket>`; client-only QR/`sms:`/`mailto:` hand-off on desktop; when the scanned host is one of the 500 report-card domains, link back to `FREE_BASE_URL/site/<domain>`. This is the missing conversion step and does not require the gate.

17. **Ops docs describe one Vercel project.** Where: `OPS-RUNBOOK.md` §3, §4, §6, §7; `SECURITY-DEPLOY.md` env table lines 29-36; `DEPLOYMENT.md`; `README.md:70-83` ("11 engines... all 44 niche tool pages render"). Evidence: `NEXT_PUBLIC_PRO_URL`, `NEXT_PUBLIC_FREE_URL`, `pro.incognitobrowser.io` appear in 0 of 25 `.md` files; `security-smoke.mjs` is not an npm script and is documented nowhere. Fix: a "Two deployments" section with a per-target env table (free Vercel, free static/droplet, Pro Vercel), "repeat on both projects" wording in the runbook, `smoke:free` / `smoke:pro` / `test:e2e:pro` npm scripts, and a release-chain paragraph (build with postbuild audit, deploy, smoke free, wait 60s, smoke pro, e2e).

18. **Strategy docs still assign the four Pro engines to the free site.** Where: `PSEO-FREE-PRO-INVENTORY.md:3,28,112,113,115,155`; `FUNNEL-AND-TOOLS-STRATEGY.md:13,15,28,40,61,83,85`; `TOOL-CATALOG-REVIEW.md:4,55-56,96,156,196,296-312,351,427` (no supersede note); `LAUNCH-READINESS-BRIEF-V2.md:11,20,92,95`. Fix: edit the rows (do not rely on the supersede note), prepend a dated status block to the catalogue review, refresh the four numbers in the launch brief.

19. **`audit-links.mjs` cannot see three link classes.** Where: `scripts/audit-links.mjs:29-49`. (a) A same-site href without the `/resources` basePath resolves against `out/` anyway: `app/authors/[slug]/page.tsx:116` ships `href="/authors/david-shadrake"`, which on `incognitobrowser.io` leaves the export, and the audit reports 0 dangling. (b) Absolute self-links are ignored: 1,327 canonicals and 1,029 sitemap `<loc>`s are unverified (all resolve today). (c) `fs.existsSync` is case-insensitive on this Mac and accepts a bare directory. Fix: in static mode treat any same-site href not under `<base>/` as dangling; parse canonicals and sitemap `<loc>`s and resolve them the same way; resolve targets against the set of walked paths rather than `existsSync`; require `isFile()` for bare paths.

20. **E2E Pro coverage is opt-in and silent.** Where: `e2e/tools.spec.ts` (5 x `test.skip(!hasProTarget())`), `e2e/helpers.ts:36-55`, `playwright.config.ts:15`. Evidence: no script sets `E2E_PRO_BASE_URL`; the reporter shows green when the 5 Pro-engine tests skip; `toolUrl()` would prepend `/resources` for `pro.incognitobrowser.io`; with no env, `baseURL` is the static droplet while `toolUrl()` strips `/resources`. Fix: `test:e2e:pro` script; unconditionally strip `/resources` for the Pro base; default `baseURL` to `localhost:3000` when the webServer block is active.

### Low

- Breadcrumb dialects (three roots; duplicate "Resources" on `/site/<domain>` from `app/site/[domain]/page.tsx:77`; no nav on category indexes, `/site/`, `/tools`; unlinked niche crumb on tool pages; hubs emit no BreadcrumbList). Route everything through `components/ui/Breadcrumbs.tsx` + `generateBreadcrumbSchema`.
- 23 free tool hubs: 1 inbound link each, not in sitemap, no JSON-LD, 22 of 23 hold one card. Either stop building hubs with fewer than 2 visible tools or noindex them; do not add one-card hubs to the sitemap. Same decision for the 22 Pro hubs (drop the niche ListItem from the Pro BreadcrumbList if they go).
- Sitemap omits 245 indexable pages (23 hubs, 220 niche indexes, 2 authors) and uses no trailing slash while canonicals do; `/site/<domain>` canonical has no slash because `.com` is treated as an extension; home page has no canonical or og:url; only the home page emits an `og:image`, and it points at `https://incognitobrowser.io/opengraph-image` (the WP homepage, 200 text/html). Centralise the slash rule in `absoluteUrl`, give `app/page.tsx` a `genMeta`, add `images` to `generateMetadata`.
- Topic hub meta description promises "tools" on the 21 niches with none (`app/topics/[niche]/page.tsx:37`); build it from the rendered sections.
- Related blocks are same-niche only; tool pages link no sibling tools or hub; content in the 21 Pro-only niches links 0 tools. Add an "Other free tools" block on tool pages and the nearest free tool from a related niche on those content pages (this also satisfies the cross-category rule in the global CLAUDE.md).
- What's My IP catalogue copy says "100% client-side, nothing logged" while the page badge says Server-assisted with the scanner's tooltip (`data/tools/vpn-privacy/whats-my-ip.json`, `components/ToolPage.tsx`).
- Two browser-privacy shells promise DNS-leak detection the engine does not perform (`data/tools/vpn-privacy/browser-leak-test.json`, `data/tools/isp-tracking/browser-leak-test.json`; the engine has 16 checks, none DNS). Reword to "WebRTC leak and fingerprint exposure test".
- Featured card claims drift: "100k iterations" vs `PBKDF2_ITERATIONS = 600_000`; "14 privacy checks" vs 16.
- `client.tsx:22-23,64-72`: dead "Pro version" branch ships in the free bundle; the "← Free tools" link is gated on the JSON `tier` field rather than `IS_PRO_DEPLOYMENT`. Replace with `IS_PRO_DEPLOYMENT && <a href={FREE_BASE_URL + '/tools'}>`.
- Pro breadcrumb JSON-LD root is "Resources" at a 307 shell; WebApplication `offers.price "0"` will be wrong once the gate ships.
- Pro-to-free hrefs omit the trailing slash the static export requires (one extra 301 per click on nginx per `HEADERS-NGINX.md:19`).
- Pro has no path back to report cards; add an absolute "Website Privacy Report Cards" entry to the Pro footer.
- No `app/not-found.tsx` on either tier; nginx config has no `error_page`, so the 22 retired URLs get nginx's bare 404 on the droplet/WP target. Add a tier-aware 404 (free: catalogues + "this tool moved to Incognito Pro" for `/tools/<pro-niche>/...`; Pro: "← Free privacy resources") and `error_page 404 /resources/404.html` in `HEADERS-NGINX.md` / `ErrorDocument` in `HEADERS-WP.md`.
- `ALLOWED_ORIGINS` unset on Pro (defaults admit `incognitobrowser.io`; free Vercel origin is rejected); `DEBUG_ORIGINS` echo enabled on both (`allowedOriginCount` 2 vs 5); CSP `connect-src` carries dead `api.incognitobrowser.io` and, on Pro, the free host; `/ip` is live on Pro with no consumer; `SECURITY-DEPLOY.md` still says the client default is `api.incognitobrowser.io`.
- `PRO_ENGINES` duplicated in `lib/tiers.ts`, `tests/rendered-pages.test.ts`, `e2e/helpers.ts`, `scripts/security-smoke.mjs` (the smoke silently ignores a fifth engine). Sitemap guard `>= 18` equals the current count exactly. Live-mode rendered-pages sample is 13 routes with no Pro flavour.
- Registry statically imports all 12 engines: every free tool page downloads the 4 Pro engines in `out/_next/static/chunks/0-ih.jz8g03jd.js` (132 KB) and vice versa. `next/dynamic` per engine, filtered by `engineVisibleInThisTier`.
- `/site/` index at 1.17 MB lists each domain twice; no breadcrumb or category anchors.
- Report-card CTA says "ad trackers like these" on the 10 pages that state none were loaded (`app/site/[domain]/page.tsx:205`).
- Home "Browse by Type" grid omits Report Cards (`data/taxonomy.json` has no `site` type); no `/topics/` index; Topics absent from nav/footer; `/authors` has no index page although author BreadcrumbLists point at it.
- `hl=en_US` pins the Play Store locale for every visitor.

### Reported but refuted

- "Pro `/tools` presents 22 near-identical shells as 22 distinct tools; redirect 18 of them to 4 canonicals." The observation holds (see the table in 3.2) but the severity was inflated (Pro is noindex, nothing is broken) and the recommendation contradicts the owner's "every Pro-engine shell is Pro, 22 pages" decision and `TOOL-CATALOG-REVIEW.md` Part 5 ("no engine gets cut"). It would also remove the 78 distinct niche-specific outbound links that are Pro's only content bridge to free. Kept as a medium presentation item, without redirects.
- "23 free `/tools/<niche>/` hubs are orphans with zero inbound links." Not reproducible on the final commit: every hub has exactly one inbound link from the "Browse by topic" chip row on `/tools` (`grep -rl 'href="/resources/tools/vpn-privacy/"' out --include=index.html` = `out/tools/index.html`), and every tool page's BreadcrumbList points at its hub. Residual (not in sitemap, no JSON-LD, unlinked crumb) is low and adding one-card hubs to the sitemap would make things worse.
- "Topic hubs for the 21 Pro-only niches should render an 'Available in Incognito Pro' card." The observation (21 hubs drop the Tools section) is verified, but the recommendation relitigates the clean-split decision ("the free site must not build, list, or link Pro tool pages"); the sanctioned exception is the report-card CTA only. On the static export it would also add 21 more dead-host links. What survives is the meta-description mismatch (low).
- "Featured cards link to pages whose H1 differs (Pro-only, caused by all shells being published)." Real, but not a Pro or split defect: the free build has the same pattern on 5 of 7 cards, the cause is alphabetical selection, and the proposed test ("H1 equals card title") cannot pass for metadata-viewer under any link choice (no shell is titled "Image Metadata Viewer"). Kept as defect 12 with a different fix.
- "Browse by Privacy Topic grid duplicates the catalogue byte-for-byte." True of the 20:18-20:29 builds several lenses measured; commit `b7129a8` (20:47) replaced it with the chip row. No longer present on either build.

## 5. Security posture of the Pro instance vs free

Bottom line: no Pro-specific regression. The split touched none of `lib/origin.ts`, `lib/rate-limit.ts`, `lib/altcha.ts`, `lib/tuning.ts`, `lib/scanner.ts`, the three route handlers or `next.config.ts` (27 files in the diff, none of them). The six security unit suites pass locally (105 tests). Pro inherits the free posture exactly, including its gaps.

Re-verified live on Pro (from `smoke-pro-before.txt` plus extra probes):

| Property | Result on Pro | Note |
|---|---|---|
| Security headers (CSP, HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy, COOP) | PASS, byte-identical to free | `connect-src 'self' https://api.incognitobrowser.io https://incognitobrowser-pseo.vercel.app`; `'self'` is what covers the Pro same-origin API |
| Origin gate 403 / ACAO mirror / ACAC false / Vary | PASS | Pro also accepts `Origin: https://incognitobrowser.io` (defaults, `ALLOWED_ORIGINS` unset); rejects the free Vercel origin; free rejects the Pro origin |
| PoW required; tampered signature; free-issued token on Pro | PASS (`no_solution`, `sig_mismatch`, `401 sig_mismatch`) | Distinct `ALTCHA_HMAC_KEY` per project confirmed |
| XFF spoofing on `/ip` | PASS | Vercel rewrites `X-Forwarded-For`; rate-limit keys are not client-controllable while on Vercel (they would be on the EC2/droplet plans, where `getClientIP` trusts the first hop) |
| SSRF blocklist for `169.254.169.254`, `localhost`, `10.0.0.1`, decimal/hex/octal IPv4 | PASS | `http://2130706433/` = 400 |
| Port allowlist, URL length | PASS | |
| Redirect handling (manual, 400, truncated Location) | PASS (extra probe) | `https://google.com/` = 400 with `redirectTo` |
| Fetch timeout 10s | PASS (extra probe) | `httpstat.us/200?sleep=13000` = 502 at 10.1s |
| `/ip` no-store, geo, 405 on GET | PASS | Live on Pro although no Pro engine calls it |
| Robots disallow, empty sitemap, noindex on tool page, 9 hub redirects, 4 free paths 404 | PASS | Pre-fix live; the fix does not change them |
| Rate limit 10/min scan, 30/min challenge | PASS sequentially, FAIL in parallel | See defect 6 |

Not covered live anywhere, on either deployment: body cap 5 MB, cookie cap 100, script-regex cap 500, third-party cap 50 (source-grep tests only); `expired` / `expires_too_far` branches; per-instance counter leakage (the sequential burst masks it); IPv6 literal forms and hostname-to-private-IP resolution; Redis health (no header or endpoint exposes the backend since commit b72c6cf).

Regressions vs pre-existing gaps: zero regressions attributable to Pro or to the split. Pre-existing gaps that Pro now carries on a second public hostname: in-memory rate limiter (defect 6), PoW replay (defect 8), lexical SSRF (defect 7), `DEBUG_ORIGINS` echo, `ALLOWED_ORIGINS` defaults, dead `api.incognitobrowser.io` CSP entry, `/ip` with no consumer, and test suites that cannot see any of this (`tests/ssrf-protection.test.ts` tests an inline copy; `tests/cors-security.test.ts` and `tests/resource-bounds.test.ts` grep source text; the smoke fires its burst sequentially). Documentation drift: `SECURITY-DEPLOY.md` still documents `api.incognitobrowser.io` as the client default and lists `REDIS_URL` as provisioned.

## 6. SEO consequences of the split, quantified

What leaves the free index: 22 URLs across 4 engines (11 browser-privacy, 5 cookie-analyzer, 3 url-analyzer, 3 metadata-viewer), all HTTP 200 and in the live sitemap today (1,051 URLs), absent from the new one (1,029; `comm` of the two sets is exactly the 22, nothing added). They retire as hard 404s: the static export cannot redirect, `next.config.ts` has no `redirects()`, and the Pro target is noindex so a 301 would not carry ranking anyway. Keyword clusters that now have no free indexed page: cookie scanner / cookie analyzer / GDPR-CCPA cookie compliance; browser fingerprint test/checker; browser leak test / WebRTC leak / DNS leak (partly covered by `vpn-privacy/whats-my-ip`); URL safety checker / phishing link checker; photo / EXIF metadata checker.

Internal link equity removed: a live crawl of 555 non-report-card pages found 160 links to the 22 pages (guides 51, checklists 34, catalogue 26, comparisons 21, topics 22), plus 1 per report card (about 502) to the cookie scanner. After the split: 0 relative links. Leaf pages with at least one tool link, before to after: checklists 70/74 to 46/73, guides 105/109 to 69/108, comparisons 43/46 to 23/45, topics 44/44 to 23/44. 21 of 44 niches now have no interactive element on free; 4 of them (device-fingerprinting, drone-surveillance, incognito-mode, online-shopping) also have 0 guides, 0 checklists, 0 calculators, so their topic hubs are 1 comparison + 2 templates. Nothing else changed: all other counts are identical before and after, free metadata is unchanged and correct, and the report cards (500 indexed pages) still carry the cookie-scanner topic with real data.

Two split-specific risks on the Pro side. First, the 502 inbound links from indexed report cards point at a Pro URL that robots.txt blocks, so Google can index it as a title-less entry without ever reading the noindex (defect 5). Second, until `NEXT_PUBLIC_PRO_URL` is baked, those 502 links are dead in the static export (defect 1), and the pre-fix live Pro canonicals still name free URLs that no longer exist.

Mitigation options (the owner's call; these are the trade-offs, not a recommendation):

- (a) Free "what this tool does" landing pages at the old 22 URLs: methodology, sample output, screenshots, CTA to Pro. Keeps the URLs, the informational intent and most of the ~160 internal links; no 404s. Risk: 22 pages from 4 templates read as doorway/thin unless each carries genuine niche content, and it partly re-lists Pro on free, which the owner rejected.
- (b) Report-card CTA only (already shipped). 500 indexed pages carry the scanner topic; covers cookie-analyzer only, none of the other 3 engines.
- (c) One free explainer per engine (4 pages, e.g. `/guides/browser-privacy/what-a-browser-fingerprint-test-shows/`), linked from the 21 affected topic hubs. Recovers most keyword coverage at low duplication risk; ranks for informational rather than tool intent.
- (d) Accept the loss and measure it: record the 22 URLs and their GSC impressions now, expect a "Not found" spike for 22 URLs, revisit in 8 weeks. Zero work; the four thin niches stay thin.
- (e) Independent of (a)-(d): on the free Vercel project add 308 redirects for the 22 paths to the Pro URLs for user continuity (server mode supports `next.config` redirects; the static export cannot), and give the 4 thin niches a free-engine shell (e.g. a useragent-analyzer or permission-checker JSON under `data/tools/incognito-mode/`) so the brand head-term niche keeps an interactive element without touching Pro engines.

## 7. Recommendations

### 7.1 Catalogue (search + A-to-Z), both tiers

The ask is already delivered and live: `components/AtoZCatalogue.tsx` backed by `lib/catalogue.ts` (18 unit tests), server-rendered list with `#letter-X` anchors, client-side search as progressive enhancement, no dependencies, and commit `b7129a8` moved search, letter bar and topic chips to the top with the A-to-Z list at the bottom. Keep the architecture. Finish it with these deltas, none of which needs a new page, route, script or dependency:

1. Filter drafts on every listing surface with the same `isPublished()` the sitemap uses (free count becomes 18), or promote the 6 quizzes; if the owner wants drafts visible, use the existing `badge` slot for a "draft" chip.
2. Tier-aware meta description and intro (defect 3); tier-aware hub descriptions (defect 13).
3. Add `whats-my-ip` to `FEATURED_TOOLS` (title "What's My IP & WebRTC Leak Test", `processing: 'server'`) and, given VPN is the product focus, place it first; fix the "11 engines" comment to 12.
4. Give each `FEATURED_TOOLS` entry a canonical `niche` and render the destination's real title on the card: password-strength to password-security, text-encryption to encrypted-messaging, privacy-quiz to digital-footprint, permission-checker to webcam-privacy or children-safety, browser-privacy to browser-privacy, cookie-analyzer to cookie-management or ad-tracking (ad-tracking is the one shell with inbound demand), url-analyzer to phishing, metadata-viewer to facial-recognition. Assert only that the target's `toolEngine` equals the card's engine.
5. Enrich search `keywords` with a small `ENGINE_ALIASES` map (metadata-viewer: exif gps photo image; browser-privacy: fingerprint webrtc canvas leak dnt; whats-my-ip: ip address vpn leak webrtc dns; password-generator: passphrase random; useragent-analyzer: user agent ua) plus the featured title. Today `keywords` is only `"<engine-id> <niche-id>"`, so "exif" and "fingerprint" match nothing unless a metaDescription happens to contain them. About 15 lines.
6. Keep the niche line under every catalogue title as the standing disambiguator; rename the incognito-mode shell title; add a build-time guard that fails when two visible tools in a tier share a title.
7. Decide the hub question once: hubs with fewer than 2 visible tools either do not build or are noindex; chips then link only real hubs (today 1 of 23 on free qualifies), otherwise chips link the topic hub on free and are dropped on Pro.
8. Mobile: `<details>` menu and icon-only Play button (defect 11). On Pro `/tools`, one sentence linking `${FREE_BASE_URL}/tools` ("Looking for the free tools?"), since the back-link exists only on tool pages today.
9. Click depth today is fine: catalogue entry to tool = 1 click, tool to another tool = 2 clicks (breadcrumb "Tools" + entry). The remaining cost is mobile, where any page to `/tools` requires scrolling to the footer.

### 7.2 Pro presentation

Present Pro as 4 engines with niche variants, not 22 tools, while keeping all 22 shells built and linkable (per the owner's decision):

1. Canonical shell per engine. Pick one shell per engine as the canonical destination for the featured card, the e2e helper and any future deep link: `browser-privacy/browser-privacy-audit` ("Browser Privacy Audit", exact title match), `ad-tracking/cookie-tracker-scanner` ("Cookie & Tracker Scanner", the only shell with 502 inbound links), `phishing/url-safety-checker` ("URL Safety Checker", exact match), and for metadata-viewer either retitle the card to "Photo Metadata Viewer" and point it at `facial-recognition/image-metadata-stripper`, or point it at `dating-privacy/image-metadata-checker` and show that page's title. Encode this as a `CANONICAL_SHELL` map next to `FEATURED_TOOLS` (it does not exist yet) and consume it in `engineToLink` and `e2e/helpers.ts`.
2. Grid by engine rather than by letter as the primary view. On Pro the A-to-Z list of 22 is dominated by 11 browser-privacy shells; a "By engine" grouping (4 headings, each with its canonical shell first and "also tuned for: AI privacy, browser extensions, device fingerprinting..." as a compact row of niche chips) tells the visitor there are 4 tools and lets them pick the flavour. Keep the A-to-Z list and search underneath; keep the topic chips only if hubs survive item 7.1.7, otherwise drop them on Pro.
3. On each shell, add a one-line "This is the <engine> tuned for <niche>. Other versions: ..." row linking sibling shells, which also gives Pro pages the sibling-tool links they currently lack (0 today).
4. Copy: "Pro" everywhere the layout currently says "Free" (meta, hub descriptions, footer tagline, aria-label, 404 title); breadcrumb root "Incognito Pro" at `/tools`; brand link straight to `/tools` (saves a 307 per logo click); Pro footer gains "Free privacy resources" and "Website Privacy Report Cards" absolute links.
5. Result-moment CTA in the four engines (defect 16) with Pro-specific Play attribution (defect 15). This is the conversion step the funnel doc specifies and the gate does not replace it.
6. Reword the two "DNS leak" shells to what the engine does; fix the "14 checks" claim to 16.

## 8. Prioritized action list

### Before deploying the split to either project (this week, in order)

1. Env: set `NEXT_PUBLIC_FREE_URL=https://incognitobrowser-pseo.vercel.app` and `NEXT_PUBLIC_PRO_URL=https://incognitobrowser-pro.vercel.app` on the Pro Vercel project; set `NEXT_PUBLIC_PRO_URL` in the static/droplet build env (or change the `lib/tiers.ts` default to the Vercel host until DNS exists). Verify: `curl -sL https://incognitobrowser-pro.vercel.app/tools/ad-tracking/cookie-tracker-scanner | grep -o 'href="https://[^"]*"' | sort -u` shows the free Vercel host; `grep -c 'incognitobrowser-pro.vercel.app' out/site/cnn.com/index.html` = 1 after a static build. (Defects 1, 2, 14.)
2. `app/robots.ts`: `Allow: /` on Pro, keep meta noindex, add `X-Robots-Tag: noindex` header. (Defect 5.)
3. `app/site/[domain]/page.tsx:209`: template literal for `grade-${grade.grade}`. (Defect 4.)
4. `app/tools/page.tsx`: tier-aware description and intro; add `whats-my-ip` to `FEATURED_TOOLS`; canonical `niche` per entry; `isPublished()` filter on catalogue entries. `app/tools/[niche]/page.tsx:39`: tier- and processing-aware description. `app/layout.tsx:140`: tier-aware footer tagline. (Defects 3, 10, 12, 13.)
5. Guards: move the build-free Pro test into `tests/tiers.test.ts`; add `postbuild` (server-mode link audit) and `postbuild:static` (rendered-pages + link-audit) scripts; make the report-card CTA guard host-aware; add `smoke:free`, `smoke:pro`, `test:e2e:pro` npm scripts. (Defects 9, 19, 20.)
6. Deploy to both Vercel projects, then run `npm run smoke:free`, wait 60s, `npm run smoke:pro`, then `npm run test:e2e:pro`; curl one Pro related-resources link and confirm it returns a Next page, not the WordPress title.
7. Docs: `DEPLOYMENT.md` "Two deployments" env table; `SECURITY-DEPLOY.md` Pro row; `OPS-RUNBOOK.md` "repeat on both projects"; edit the stale rows in `PSEO-FREE-PRO-INVENTORY.md`, `FUNNEL-AND-TOOLS-STRATEGY.md`, `TOOL-CATALOG-REVIEW.md`, `LAUNCH-READINESS-BRIEF-V2.md`, `README.md:70-83`. (Defects 17, 18.)

### Next (security hardening, both projects)

8. Provision Redis on the Radius Labs Vercel account; set `REDIS_URL` on both projects; parallel burst in the smoke with at least one 429 required. (Defect 6.)
9. Single-use PoW tokens once Redis exists; smoke check for replay. (Defect 8.)
10. `isBlockedHostname`: expand IPv4-mapped/NAT64 literals, strip trailing dots, add DNS resolution check; import the real function in `tests/ssrf-protection.test.ts`. (Defect 7.)
11. Remove the `DEBUG_ORIGINS` echo; set `ALLOWED_ORIGINS` explicitly on Pro; make `connect-src` tier/mode aware; return 404 from `/ip` on Pro.

### Decisions for the owner (not made here)

- Which mitigation for the 22 retired URLs and the 4 thin niches: (a) landing pages, (b) report-card CTA only, (c) one explainer per engine, (d) measure and accept, plus whether to add 308s on the free Vercel project and a free-engine shell to incognito-mode and device-fingerprinting.
- Drafts: publish the 6 quiz pages, hide them from every listing, or show them badged.
- Tool niche hubs: stop building one-card hubs (free and Pro), or noindex them; never add them to the sitemap as-is.
- Pro presentation: adopt the canonical-shell map and by-engine grid from 7.2, and rename the incognito-mode shell.
- Mobile chrome: approve the `<details>` menu and icon-only Play button.
- Result-moment CTA and Pro-specific Play attribution: approve the ResultCTA scope from defect 16 (this is the piece that turns Pro from a re-skinned tool list into a funnel, and it does not depend on the gate).
- Timing of `pro.incognitobrowser.io` DNS: the standing rule is to verify the CNAME resolves before any link or canonical points at it; until then both projects should bake the Vercel hosts.
- Whether `incognitobrowser.io` pages may call Pro's API cross-origin (drives the `ALLOWED_ORIGINS` value on Pro when the gate is designed).

---
Draft written to: /private/tmp/claude-501/-Users-davidshadrake-Documents-Radius-Labs-incognitobrowser-pseo2-0/c2f05386-2b36-45f7-b516-1925fad25447/scratchpad/PRO-VS-FREE-ANALYSIS.draft.md