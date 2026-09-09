# Forensic audit — free + Pro, 2026-09-08

Trigger: a colleague on Windows could not use "Email me the link"; the owner asked for a full pass over both tiers for anything else that can fail for a real user. Six independent read-only reviews (browser/platform APIs, static-export runtime, funnel result bus, canvas/DOM layout, security, build/data integrity) over the code, the four live deployments (Vercel free, Vercel Pro, droplet free, droplet Pro) and the live APIs. Everything marked **fixed** is in the repo and verified by the release chain; **live** means verified on the deployed site after the push.

## 1. The Windows email failure (root causes, both fixed)

1. The `mailto:` body used bare `\n` line breaks. RFC 6068 §5 requires `%0D%0A`; Outlook on Windows drops the body or the link. macOS Mail is lenient, which is why it worked for the owner. `lib/handoff.ts` now builds the body with CRLF; `tests/handoff.test.ts` pins the bytes.
2. Many Windows machines have **no registered mail handler** (Gmail-in-a-browser users). A `mailto:` link then does nothing at all, and the page has no API to detect it. `components/ResultCta.tsx` now uses blur detection: a registered handler always takes focus or opens a tab; if neither happens within 1.5 s the message is revealed in a copyable box. The native link is not intercepted, so nothing changes where it works.

## 2. False results on security tools (fixed — these mattered more than layout)

| Tool | Bug | Fix |
|---|---|---|
| What's My IP — WebRTC leak test | Awaited ICE candidates **before** `setLocalDescription()`, so gathering never started: every visitor, including leaking VPN users, was told "No WebRTC leak". | Gather after the offer is applied (`WhatsMyIpTool.tsx`), as the Browser Privacy Audit already did. |
| Permission Checker | Our own sitewide `Permissions-Policy: camera=(), microphone=(), geolocation=()…` made those features query as `denied`: 7 of 11 shown as BLOCKED for everyone. | Tool routes get `self` for the queried features (`next.config.ts` `/tools/:path*`; droplet `.htaccess` `<If>` block). |
| Permission Checker on Safari/Firefox | Every query throws → all "unsupported" → severity green, CTA "You are protected" beside "Checked 0". | Reports `info` with an honest headline when nothing could be checked. |
| Cookie & Tracker Scanner (5 Pro pages) | "This Page" and "Paste" modes rendered results without reporting to the result bus: no CTA, no scorecard. The URL branch also labelled the result with whatever was typed in the box. | One effect for all three modes; host taken from the scanned URL. |
| Text Encryption (4 free pages) | File mode never reported; headline said "Encrypted" after a decrypt. | Effect keyed on the download as well as the text output. |
| Privacy Score Calculator, Text Encryption | "What to do now" silently missing where a niche's checklists are drafts. | Three-tier fallback (own niche → related niche → tips); exhaustive guard over all 23 published free tools. |

## 3. Shareable scorecard (canvas)

Canvas has no wrapping or overflow handling; every fixed-coordinate text draw is a hazard. All of these were measured, not guessed.

- Stat columns overlapped (`185.192.16.117` into `Dublin, Ireland`) — **fixed**: per-column shrink/truncate.
- Footer URL ran into "Check yours free" — **fixed**: the label's width is reserved first.
- The 120 px figure had no width check; an IPv6 address (2,745 px) or `Microsoft Edge 128.0.2739.42` (2,023 px) ran off the card — **fixed**: figure goes through the same fit routine; What's My IP, DNS Leak and User-Agent now put a short verdict first.
- A two-line title plus a two-line headline pushed the stat labels 12 px over the footer on 19 report cards with long domains (`www.nationalgeographic.com`, …) — **fixed**: the title is always one line, so the stack tops out 50 px clear by construction.
- **Product decision, made and flagged**: the What's My IP card made the visitor's real IP the largest element of an image we ask them to share. The page still shows the full address (that is the proof); the card now shows a verdict and a masked address (`185.192.16.xxx`). One line in `lib/privacy-mask.ts` reverts it.
- "Check yours free" is a real link on the live page (overlay over the drawn footer). It can only ever be a picture once the PNG is shared.

## 4. Mobile layout (DOM, 320–375 px) — fixed

Cookie rows (name + badges) overflowed their card; the scan-summary URL could not truncate (`min-w-0` missing); URL Safety Checker path/query values did not wrap (phishing URLs are exactly the long ones); breadcrumbs did not wrap, so every report-card page scrolled sideways on a phone (and rendered "Resources › Resources"); IPv6/timezone values spilled out of the What's My IP and Browser Audit cards; the CTA headline could not break an IPv6.

## 5. Platform API failures — fixed

- Bare `navigator.clipboard.writeText` in three tools threw on the HTTP droplet origin (button looked dead). Shared `lib/clipboard.ts` with an `execCommand` fallback; "Copied" is only shown when it actually copied.
- User-Agent Analyzer read `navigator.userAgent` at module load: server and client rendered different trees → hydration error, visible flash, result reported twice on every visit. Now read after mount.
- CSV export revoked its blob URL synchronously (Safari: "Failed – No file").
- PNG text chunks were inflated with no ceiling (a 24 MB chunk of zeros → tab out of memory); now read with a 4 MB budget. Email source textarea capped at 2 MB like the file path; XMP packets capped at 1 MB before the quadratic regexes.
- Query strings no longer reach the email body or share text (`?ref=CALL 0800…` would have been pasted verbatim).

Deferred (documented, not fixed): Web Share after an `await` can lose Safari's transient activation; `<a download>` of `blob:` URLs is inert inside Android WebViews (the free app itself); iOS caps canvases at ~16.7 MP so 48 MP photos re-encode blank in the metadata tools; no fetch timeouts on the scanner calls; `alert()`/`prompt()` are no-ops in some WebViews.

## 6. Droplet (staging) — fixed and now owned by the deploy script

- **Zero security headers** on both copies (Apache has none of Next's `headers()`; `mod_headers` was not even enabled). `scripts/droplet-htaccess.conf` is spliced into `.htaccess` by `scripts/deploy-droplet.sh` on every deploy: the seven headers, CSP allowing both Vercel API hosts, `X-Robots-Tag: noindex` on `/resources-pro/`, tool-page `Permissions-Policy`, bait-file noindex, immutable caching for hashed assets, `Options -Indexes`, a 404 document, http→https for our paths only, and real 302s for the Pro shells that a static export can only render as blank RSC-redirect pages.
- Cross-tier links pointed at the Vercel hosts; the staging copies now link to each other (`NEXT_PUBLIC_FREE_URL`/`PRO_URL` set at build time).
- The ad-blocker bait path resolver only knew `/resources`; it now handles `/resources-pro` too.
- Verified live: 7/7 headers, `X-Robots-Tag` on Pro, `camera=(self)` on tool pages, `/resources-pro/` → 302 → `/tools/`, `http://…/resources/` → 301 → https, WordPress untouched.

## 7. Security — new surfaces since the last baseline

Clean: `/event` allowlists events, rejects foreign origins, non-JSON, oversize, long slugs, prototype keys; X-Forwarded-For spoofing is rejected by Vercel; DNS-leak ids are 62-bit CSPRNG with no enumeration oracle; the nameserver refuses out-of-zone queries and is not a useful amplifier (≈1–2×); baits carry the right MIME on all four hosts; the only `dangerouslySetInnerHTML` escapes `<`; no secrets in the Pro static chunks.

Fixed now: `/event` accepted **any** slug as a tool id, minting Redis keys with a 400-day TTL (unbounded cardinality; `/stats` SCANs the whole day) — now an allowlist pinned to the engine registry by test. `/stats` bearer compare is constant-time and rate-limited. The nameserver only records observations for tests that `/dns-leak/start` created, with a per-source token bucket and a bounded stored name (latent until the zone is delegated; it would otherwise have let a query flood exhaust the same Redis the rate limiter depends on).

Still open (decisions): no Redis on either project, so rate limits are per serverless instance and event counters are discarded; `ALLOWED_ORIGINS` on the Pro project is unset (defaults; the droplet copies call the free API, which is allowlisted); the SSRF guard is lexical (no DNS resolution check); proof-of-work tokens are replayable for 90 s until Redis exists.

## 8. Build and data integrity

- **Live, needs your go-ahead**: the Pro Vercel project has `NEXT_PUBLIC_FREE_URL=https://incognitobrowser.io/resources`. Every cross-site link on all 22 Pro pages (related resources, "← Free tools", the checklist link) therefore lands on the WordPress home page via a 301. Unsetting that variable (the default is the live free Vercel host) fixes it; it should only be set once `/resources` is actually served there.
- Tests graded a stale `out/` — the repo lives in iCloud-synced Documents and had conflict copies (`out 2/`, `site 3/`) inside the export. Both build-output suites now require `out/.build-marker.json` to say *free / static / /resources*; the deploy script cleans before testing and writes the marker after each export. Recommendation: move the repo out of `~/Documents` or add `.nosync`.
- Two report cards were filed as `Princeton.EDU` and `WWW.garmin.com` (case-sensitive 404s, duplicate risk); renamed, scanner normalises, data test pins the rule.
- Glossary Article JSON-LD had no `headline` (items carry `term`, not `title`) — fixed on all 106.
- An unused map in the tool registry paired free niches with Pro engines; deleted before something used it.
- Five e2e assertions were satisfiable by static page copy; they now assert the funnel end state (`[data-result-cta]`), and a 404 on What's My IP fails instead of skipping.

## 9. What still needs a decision

1. Unset `NEXT_PUBLIC_FREE_URL` on the Pro Vercel project (item 8).
2. Redis ($8/mo) — rate limiting and funnel counters are not real without it.
3. Move the repo out of iCloud.
4. The masked IP on the share card (revert if you want the raw proof shared).
5. DNS delegation for the leak test zone; the code side is now hardened for it.
