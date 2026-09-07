# Tool Catalog Review — Free vs Pro Split

**Date:** 2026-05-20
**Scope:** All 12 tool engines (46 deployed pSEO tool pages), evaluated through 7 lenses, then assigned to Free (marketing site) or Pro (in-browser) tiers. Includes a cut list and a build list.

---

## Part 1 — The framework

### The Free/Pro dividing line

The split isn't "basic vs advanced." It's **what a webpage can do vs what only the browser can do.**

| Free (marketing site) | Pro (Incognito Browser app) |
|---|---|
| One-shot, stateless | Persistent, monitored, cross-session |
| Runs on the current page only | Runs on every page you visit |
| You paste a URL / password / image | It sees your actual browsing context |
| Zero account required | Uses the browser as your trust anchor |
| Demonstrates the problem | Solves the problem continuously |
| Drives the download | Justifies the install |

**Rule of thumb:** if the free version is *sufficient* for a one-time need, the Pro version should be *continuous* for an ongoing need. Free shows you're being tracked right now. Pro stops it on every site forever.

**What must NOT happen:** free tools crippled to force upgrade. The free tier's job is to be genuinely good — that's what gets cited by AI Overviews and shared on Reddit. Users hate crippleware and Google penalizes thin content. Free tools are marketing; treat them as ad spend, not as a paywall.

### The 7 lenses (scored 1–5 per tool)

1. **SEO** — search demand for the tool's core query + odds of outranking incumbents
2. **Brand fit** — does it reinforce "Incognito Browser = my privacy layer"?
3. **Article synergy** — can it be embedded inline in guides as proof-of-expertise (the F5 lever)?
4. **Uniqueness** — commodity (100 copies exist) vs. differentiated (few good ones exist)
5. **Quality** — current implementation depth, mobile UX, edge-case handling
6. **Conversion** — does using it make someone want the browser?
7. **Pro extension** — is there a natural in-browser "continuous" version?

---

## Part 2 — Per-tool evaluation

### 1. browser-privacy (Browser Privacy Audit) — 11 pages

**What it does:** Fingerprint audit — canvas hash, WebGL renderer, fonts, timezone, screen, hardware concurrency, memory, touch points, do-not-track, cookies enabled, etc. Produces a risk score + per-check explanations.

| Lens | Score | Note |
|---|---|---|
| SEO | 4 | "browser fingerprint test" / "am I being tracked" — real demand, EFF's CoverYourTracks is the incumbent but ranks poorly on long-tail |
| Brand fit | 5 | This IS the product's core pitch |
| Article synergy | 5 | Embeds naturally into every fingerprinting / tracking / incognito guide |
| Uniqueness | 3 | Several exist (CoverYourTracks, AmIUnique, BrowserLeaks). Ours is friendlier but not deeper |
| Quality | 4 | 450 LOC, solid coverage. Missing: audio fingerprint, WebRTC (that's in whats-my-ip), battery API, storage quota |
| Conversion | 5 | "Your browser is 1-in-2.3M unique. Incognito Browser makes you 1-in-50k." Direct path to download |
| Pro extension | 5 | **Continuous fingerprint monitoring**: track how your fingerprint changes across sites, alert when a site tries an aggressive probe, show which sites fingerprinted you this week |

**Verdict:** ✅ **KEEP — flagship free tool.** Highest-value asset in the catalog.
**Free:** the one-shot audit as-is, with a "How Incognito Browser scores" comparison panel added.
**Pro:** "Fingerprint Watch" — per-site fingerprint attempt log, weekly digest, block-on-detect toggle.

---

### 2. privacy-quiz (Privacy Score Quiz) — 9 pages

**What it does:** 10–15 multiple-choice questions on habits, outputs a score + recommendations.

| Lens | Score | Note |
|---|---|---|
| SEO | 2 | "privacy quiz" has weak demand. Mostly an engagement tool, not a search-capture tool |
| Brand fit | 3 | Generic; nothing about it is browser-specific |
| Article synergy | 3 | Can sit at the end of any guide as a "test yourself" block — decent |
| Uniqueness | 1 | Fully commodity. Every privacy site has one |
| Quality | 3 | 346 LOC, works, but question bank is generic and non-adaptive |
| Conversion | 2 | Score → "download browser" is a weak link |
| Pro extension | 2 | No natural continuous version |

**Verdict:** ⚠️ **CONSOLIDATE.** 9 niche-specific quizzes is too many for one commodity engine. Keep 2–3 (general privacy score, GDPR/CCPA compliance for the legal niches, student/kids for the safety niches). Retire the rest to draft.
**Free:** yes, as an article-end engagement device.
**Pro:** none.

---

### 3. cookie-analyzer (Cookie Tracker Scanner) — 5 pages

**What it does:** User pastes a URL, backend fetches it, lists cookies + third-party domains + known tracker scripts. Uses the hardened Vercel API (PoW + rate limit + SSRF protection).

| Lens | Score | Note |
|---|---|---|
| SEO | 4 | "what cookies does [site] use" / "cookie scanner" — decent demand, incumbents (CookieServe, Cookiebot's scanner) are B2B-oriented |
| Brand fit | 5 | Directly demonstrates the tracking problem the browser solves |
| Article synergy | 5 | Embed in any cookie/ad-tracking/GDPR article: "scan a site right now" |
| Uniqueness | 4 | Few consumer-friendly ones exist. Most are compliance tools for site owners, not for visitors |
| Quality | 4 | 741 LOC, the most-engineered tool. Handles a lot. Weak on: cookie purpose classification, no historical diff |
| Conversion | 4 | "This site sets 47 cookies from 12 trackers" → "Incognito Browser blocks all of these" |
| Pro extension | 5 | **Live cookie/tracker dashboard**: in-browser panel showing what every tab is setting, real-time, with one-click block. This is a whole product feature |

**Verdict:** ✅ **KEEP — second flagship.** Already the most-invested tool.
**Free:** one-URL-at-a-time scan, as-is. Add a "vs. Incognito Browser" panel.
**Pro:** "Tracker Live" — per-tab real-time tracker panel with block controls and 30-day history.

---

### 4. text-encryption (Text Encryption Tool) — 4 pages

**What it does:** AES-GCM encrypt/decrypt text or files with a passphrase, client-side via Web Crypto. Just got improved error messages.

| Lens | Score | Note |
|---|---|---|
| SEO | 2 | "encrypt text online" has demand but it's a dev/nerd audience and dozens of tools exist |
| Brand fit | 3 | Privacy-adjacent, not browser-specific |
| Article synergy | 3 | Fits encrypted-messaging / journalist / healthcare niches. Not broadly embeddable |
| Uniqueness | 2 | Commodity. Ours is better (proper AES-GCM, good UX) but not different |
| Quality | 4 | 346 LOC, correct crypto, good errors now |
| Conversion | 2 | Weak link to browser download |
| Pro extension | 4 | **Encrypted notes / clipboard**: in-browser encrypted scratchpad that persists across sessions, syncs, and can encrypt form fields |

**Verdict:** ⚠️ **KEEP AS NICHE.** Fine for the 4 niches it lives in; don't expand.
**Free:** as-is.
**Pro:** encrypted notes + clipboard is a real Pro feature.

---

### 5. permission-checker (Permission Checker) — 4 pages

**What it does:** Queries navigator.permissions for camera, mic, geolocation, notifications, clipboard. Shows granted/denied/prompt.

| Lens | Score | Note |
|---|---|---|
| SEO | 2 | Low demand. People don't search "check browser permissions" |
| Brand fit | 4 | Privacy-relevant and browser-specific |
| Article synergy | 4 | Fits webcam / smart-home / children / location niches well |
| Uniqueness | 3 | Few exist, but it's also a 3-click browser settings page |
| Quality | 3 | 241 LOC, shallow. Just shows status; doesn't explain what each site could do with each permission |
| Conversion | 3 | Moderate |
| Pro extension | 5 | **Per-site permission audit**: which sites have which permissions, when granted, revoke-all button, alert when a new site requests camera |

**Verdict:** ⚠️ **KEEP + DEEPEN.** Free version is too thin; add "what this permission lets a site do" + "how to revoke" guidance per row.
**Free:** enhanced one-shot check.
**Pro:** per-site permission audit — a strong browser feature.

---

### 6. url-analyzer (URL Safety Checker) — 3 pages

**What it does:** Typosquat detection (Levenshtein vs. top domains), suspicious-TLD heuristics, IP-address-in-URL, punycode, length. Client-side.

| Lens | Score | Note |
|---|---|---|
| SEO | 4 | "is this link safe" / "check URL safe" — strong demand, but Google Safe Browsing / VirusTotal are giants |
| Brand fit | 4 | Phishing protection is a browser feature story |
| Article synergy | 4 | Embeds in phishing / online-shopping / malware niches |
| Uniqueness | 2 | Heuristic-only. VirusTotal / URLVoid do real reputation lookups |
| Quality | 3 | 420 LOC of heuristics. No reputation data, no live fetch, no screenshot |
| Conversion | 3 | "This URL looks suspicious" → "Incognito Browser warns you before you click" |
| Pro extension | 4 | **Real-time link scanner**: run the structural heuristics on every link before navigation, in-browser, no network call |

**Verdict:** ⚠️ **KEEP, heuristics-only.** A reputation lookup (Safe Browsing / PhishTank) would make it far more credible, but that's an external dep and is ruled out. Instead: deepen the heuristics we own — homograph/confusable-character detection, brand-name-in-subdomain patterns (`paypal.com.evil.tld`), URL-shortener unwrapping via our own scanner, and a clear "this checks structure, not reputation" disclaimer so it's honest about what it can and can't tell you.
**Free:** structural heuristics, clearly scoped.
**Pro:** in-browser pre-navigation scanner.

---

### 7. password-strength (Password Strength Checker) — 3 pages

**What it does:** Entropy calc, common-password list check, pattern detection, crack-time estimate.

| Lens | Score | Note |
|---|---|---|
| SEO | 4 | "password strength checker" — huge demand. Incumbents: Bitwarden, NordPass, security.org. Hard to outrank but long-tail is winnable |
| Brand fit | 3 | Password security is adjacent to browser privacy |
| Article synergy | 4 | Embeds in every password / data-breach / banking article |
| Uniqueness | 1 | Fully commodity |
| Quality | 3 | 345 LOC. Fine. Missing: HaveIBeenPwned k-anonymity breach check (the single feature that makes it non-commodity) |
| Conversion | 2 | Weak link to browser unless browser has a password manager |
| Pro extension | 4 | **Password vault audit**: audit saved browser passwords for weakness / reuse / breach-exposure |

**Verdict:** ⚠️ **KEEP + MERGE with password-generator.** A breach check (HIBP) would be the differentiator, but it's an external dep and is ruled out. Without it this stays commodity — so combine it with the generator into one "Password Tool" page rather than maintaining two thin ones. Ship a larger in-repo common-password list (top 100k, not top 10k) to at least make the "is this password common" check stronger than the incumbents'.
**Free:** strength + generator, one page.
**Pro:** none — no password manager on the roadmap.

---

### 8. metadata-viewer (Image Metadata Checker / Stripper) — 3 pages

**What it does:** Upload an image, view EXIF (GPS, camera, timestamp), strip and re-download.

| Lens | Score | Note |
|---|---|---|
| SEO | 3 | "remove EXIF data" / "check photo metadata" — moderate, steady demand |
| Brand fit | 3 | Privacy-adjacent, not browser-specific |
| Article synergy | 4 | Dating / drone / facial-recognition / social-media niches all use it well |
| Uniqueness | 3 | Several exist but many are sketchy (upload to unknown server). Ours is client-only — that's a real differentiator worth emphasizing |
| Quality | 4 | 461 LOC, works well |
| Conversion | 2 | Weak |
| Pro extension | 4 | **Auto-strip on upload**: the browser strips EXIF from every image before it's uploaded to any site |

**Verdict:** ✅ **KEEP.** Emphasize "nothing leaves your device" — that's the pitch.
**Free:** as-is, with stronger privacy messaging.
**Pro:** auto-strip on upload — a genuinely valuable browser feature.

---

### 9. whats-my-ip (What's My IP) — 1 page

**What it does:** Public IP via ipify + ipapi, WebRTC ICE probe for leak detection, hosting/VPN heuristic.

| Lens | Score | Note |
|---|---|---|
| SEO | 5 | "what is my ip" is one of the highest-volume queries on the internet. Incumbents are entrenched (whatismyip.com, ipchicken) but "webrtc leak test" long-tail is winnable |
| Brand fit | 5 | VPN + leak detection is core privacy |
| Article synergy | 5 | Embeds in VPN / ISP / Tor / public-wifi guides |
| Uniqueness | 3 | Commodity for IP; less so for WebRTC leak (BrowserLeaks is the main one) |
| Quality | 3 | 311 LOC, good start. Depends on 2 third-party APIs (ipify/ipapi) — a reliability + privacy concern for a privacy site |
| Conversion | 4 | "Your real IP leaks via WebRTC even with VPN on" → "Incognito Browser blocks WebRTC leaks" |
| Pro extension | 4 | **Leak monitor**: continuously verify VPN is working, alert on IP change / DNS leak |

**Verdict:** ✅ **KEEP + SELF-HOST THE IP LOOKUP.** Proxy the IP lookup through our Vercel API so we're not sending user IPs to ipify/ipapi from a privacy tool. Add DNS leak test. Expand to 3–4 niche pages (vpn, isp, tor, public-wifi).
**Free:** IP + WebRTC + DNS leak, self-hosted.
**Pro:** continuous leak monitor.

---

### 10. useragent-analyzer (User Agent Analyzer) — 1 page

**What it does:** Parse the UA string, show browser/OS/version, flag identifying bits.

| Lens | Score | Note |
|---|---|---|
| SEO | 3 | "what is my user agent" is a real, steady query from security-aware users diagnosing what their browser leaks |
| Brand fit | 4 | The UA string is the first thing every site reads about you. A privacy browser that randomizes or minimizes it has a direct story here |
| Article synergy | 3 | Fingerprinting, gaming-privacy (where it lives now), workplace-privacy (what your employer's proxy sees), browser-extensions |
| Uniqueness | 2 | Many exist, but most just echo the string. Ours flags identifying bits + uniqueness — that's the useful part |
| Quality | 3 | 288 LOC, fine. Could add Client Hints (`Sec-CH-UA-*`) which are replacing UA strings in Chromium and are less understood |
| Conversion | 3 | "Your UA reveals OS + exact version + device class" → "Incognito Browser sends a minimal UA" (if the browser does this) |
| Pro extension | 4 | **UA Randomizer / Minimizer**: per-site UA policy, rotate on schedule, show what each site received |

**Verdict:** ✅ **KEEP.** Add Client Hints detection (the thing replacing UA strings — most tools miss it). Keep as standalone: it ranks for a distinct query and has a distinct Pro path.

---

### 11. password-generator (Secure Password Generator) — 1 page

**What it does:** Random password with length / charset / passphrase controls, entropy display.

| Lens | Score | Note |
|---|---|---|
| SEO | 4 | "password generator" — enormous demand. Incumbents: 1Password, LastPass, Bitwarden. Hard to win head-on |
| Brand fit | 2 | Only if the browser has a password manager |
| Article synergy | 3 | Pairs with password-strength in password articles |
| Uniqueness | 1 | Fully commodity |
| Quality | 4 | 367 LOC, well-built (passphrase mode is nice) |
| Conversion | 1 | None without a password manager to save to |
| Pro extension | 3 | Only if browser gets a password manager |

**Verdict:** ⚠️ **KEEP BUT MERGE.** Combine password-strength + password-generator into one "Password Tool" page (check OR generate). Halves the maintenance, doubles the page's keyword coverage. Don't expand.

---

### 12. hash-generator (Hash Generator) — 1 page

**What it does:** SHA-1/256/384/512 + HMAC of text or files, client-side via Web Crypto.

| Lens | Score | Note |
|---|---|---|
| SEO | 3 | "sha256 checksum" / "verify file hash" / "sha256 generator" — steady demand from security-aware users; the "verify download" long-tail is underserved by tools that are actually client-side |
| Brand fit | 4 | Integrity verification is a core security practice for exactly the audience a privacy browser attracts. Two direct on-brand uses: (a) verifying the Incognito Browser APK download against a published SHA-256, (b) the Web3/crypto audience the brand is courting uses hashes daily |
| Article synergy | 4 | crypto-privacy, data-breach (hashed-credential explanations), encrypted-messaging (integrity), malware-protection (verifying downloads), tor-privacy (verifying Tor Browser signatures) |
| Uniqueness | 3 | Many exist, but most are server-side (your file goes to their server). Ours is Web-Crypto client-only — the file never leaves the device. That's the differentiator for a privacy brand and should be the headline |
| Quality | 4 | 281 LOC, correct, handles files up to 50 MB, HMAC mode |
| Conversion | 3 | "Verify your Incognito Browser download" CTA on the download page → hash tool → trust reinforcement. Also: HMAC is the same primitive our own scanner API uses for signed challenges, which can be explained inline as proof of engineering seriousness |
| Pro extension | 3 | **Download Verifier**: auto-hash every downloaded file and compare against a known-good list (browser-published hashes for its own updates, plus community hash databases) |

**Verdict:** ✅ **KEEP + REPOSITION.** The page should lead with "client-side, nothing uploaded" and add a "Verify your Incognito Browser download" section with the current APK hash. Expand to 2–3 more niches (malware-protection, tor-privacy, data-breach).

---

## Part 3 — Scorecard

| Tool | SEO | Brand | Synergy | Unique | Quality | Conv | Pro | **Total** | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| browser-privacy | 4 | 5 | 5 | 3 | 4 | 5 | 5 | **31** | ✅ Flagship |
| cookie-analyzer | 4 | 5 | 5 | 4 | 4 | 4 | 5 | **31** | ✅ Flagship |
| whats-my-ip | 5 | 5 | 5 | 3 | 3 | 4 | 4 | **29** | ✅ Keep + self-host |
| url-analyzer | 4 | 4 | 4 | 2 | 3 | 3 | 5 | **25** | ⚠️ Keep + upgrade |
| permission-checker | 2 | 4 | 4 | 3 | 3 | 3 | 5 | **24** | ⚠️ Keep + deepen |
| metadata-viewer | 3 | 3 | 4 | 3 | 4 | 2 | 4 | **23** | ✅ Keep |
| password-strength | 4 | 3 | 4 | 1 | 3 | 2 | 1 | **18** | ⚠️ Merge with generator |
| text-encryption | 2 | 3 | 3 | 2 | 4 | 2 | 4 | **20** | ⚠️ Keep as niche |
| hash-generator | 3 | 4 | 4 | 3 | 4 | 3 | 3 | **24** | ✅ Keep + reposition |
| useragent-analyzer | 3 | 4 | 3 | 2 | 3 | 3 | 4 | **22** | ✅ Keep + Client Hints |
| password-generator | 4 | 2 | 3 | 1 | 4 | 1 | 3 | **18** | ⚠️ Merge |
| privacy-quiz | 2 | 3 | 3 | 1 | 3 | 2 | 2 | **16** | ⚠️ Consolidate 9→3 |

---

## Part 4 — The Free / Pro split

### FREE (marketing site — `incognitobrowser.io/resources/tools/`)

Everything below stays genuinely useful as a one-shot. No crippling.

| Tool | Free scope | The upgrade hook shown on the page |
|---|---|---|
| **Browser Privacy Audit** | Full fingerprint audit, one-shot | "See how Incognito Browser scores on the same test" side-by-side |
| **Cookie Tracker Scanner** | Scan one URL at a time | "Incognito Browser shows this for every site you visit, live" |
| **What's My IP + Leak Test** ⭐ | IP + WebRTC + DNS leak, self-hosted (no ipify/ipapi) | "Incognito Browser's built-in VPN closes these leaks" — **the primary funnel to the VPN feature** |
| **URL Safety Checker** | Heuristics only (typosquat, punycode, suspicious TLDs, IP-in-URL). No reputation API | "Incognito Browser checks every link before you click" |
| **Permission Checker** | Enhanced one-shot with per-permission explanations | "Incognito Browser audits every site's permissions" |
| **Image Metadata Stripper** | Full EXIF view + strip, client-only | "Incognito Browser strips this automatically on every upload" |
| **Password Tool** (merged) | Strength (entropy + pattern + common-list) + generator. No breach lookup | Generic download CTA until the browser has a vault |
| **Hash Generator** | SHA-1/256/384/512 + HMAC, client-only, files up to 50 MB | "Verify your Incognito Browser download" — publish the APK hash on the download page |
| **User Agent Analyzer** | UA parse + identifying-bits flags + Client Hints | "Incognito Browser sends a minimal UA" (if/when the browser does this) |
| **Text Encryption** | Full encrypt/decrypt | "Incognito Browser has an encrypted notepad built in" (if/when shipped) |
| **Privacy Quiz** (3 versions) | Full quiz | "Download Incognito Browser to fix the gaps" |

### PRO (in the Incognito Browser app)

These are the "continuous" versions. Each maps to a free tool so the upgrade story is coherent.

**Current browser roadmap: VPN is the active build.** That makes **Leak Monitor** the Pro feature to lead with — it's the one the free What's My IP tool funnels into, and it ships alongside the VPN. Everything else below is a candidate for later; don't promise it on the free pages until it exists.

| Pro feature | Extends | Why only the browser can do it | Status |
|---|---|---|---|
| **Leak Monitor** ⭐ | whats-my-ip | Background checks that the VPN tunnel is holding; alert on IP/DNS/WebRTC leak | **Ships with VPN** — lead with this |
| **Fingerprint Watch** | browser-privacy | Observe every site's probes across sessions | Candidate |
| **Tracker Live** | cookie-analyzer | Real-time per-tab cookie/script interception | Candidate |
| **Link Guard** | url-analyzer | Pre-navigation hook on every click | Candidate |
| **Permission Audit** | permission-checker | Cross-site permission storage access | Candidate |
| **Auto-Strip Uploads** | metadata-viewer | Intercept file uploads before they leave | Candidate |
| **Download Verifier** | hash-generator | Auto-hash downloads, compare to the browser's own published update hashes | Candidate — small, and tightly on-brand |
| **UA Minimizer** | useragent-analyzer | Per-site UA policy | Candidate |
| **Encrypted Notes** | text-encryption | Persistent local encrypted storage | Candidate |
| ~~Vault Audit~~ | password tool | Would need a password manager | **Not on roadmap** — removed |

### The upgrade path visualized

```
Marketing site (free)              Incognito Browser (pro)
──────────────────────────────     ──────────────────────────────
"Am I being tracked?"        →     "Stop tracking on every site"
   one-shot audit                     continuous protection

"Does this site track me?"   →     "See every tracker, live"
   paste one URL                       per-tab dashboard

"Is my VPN leaking?"         →     "Alert me if it ever leaks"
   check once                          background monitor

"Is this link safe?"         →     "Warn me before every click"
   paste one URL                       pre-navigation scan
```

Each free tool page gets a consistent "See this in Incognito Browser →" panel at the bottom showing the Pro equivalent. That's the conversion surface.

---

## Part 5 — Cut list

No engine gets cut. Two consolidations only:

| Tool | Action | Reason |
|---|---|---|
| **privacy-quiz** (6 of 9) | Draft the 6 weakest niche variants, keep 3 | Commodity; 9 copies of one quiz engine reads as thin |
| **password-generator** | Merge into password-strength → "Password Tool" | Two commodity pages become one stronger one |

**Net effect:** 46 tool pages → ~39. Aligns with the doorway-pattern fix (R2) — fewer near-duplicate tool shells, no loss of capability.

---

## Part 6 — Build list (new tools worth adding)

**Constraint: no external dependencies.** Every tool below runs entirely client-side or against our own Vercel API. No third-party data APIs (no HIBP, no Safe Browsing, no Dehashed, no LLM calls at scan time). This rules out some high-demand tools — they're listed at the bottom so the reasoning is visible.

Ranked by (SEO demand × brand fit × Pro extension × VPN-adjacency).

### Tier 1 — build these first

**1. DNS Leak Test** (fold into What's My IP) ⭐ **VPN-adjacent**
- Free: fires DNS lookups against our own resolver-detection endpoints, reports which DNS servers answered → "your VPN is on but DNS is going to your ISP"
- Pro: Leak Monitor runs this continuously behind the VPN
- SEO: "dns leak test" — strong, VPN-buyer intent
- Brand fit: 5. This is the single most relevant tool to the VPN launch.
- Deps: none. We host the detection endpoints on Vercel.

**2. Ad Blocker / Tracker Blocker Test** ⭐
- Free: page loads a set of known tracker beacon URLs (from a list we maintain in-repo — EasyList-derived, no runtime fetch of the list), reports which got through → "your blocker missed 14 of 50"
- Pro: continuous — shows the block-rate on every page
- SEO: "test my ad blocker" / "is my ad blocker working" — solid demand
- Brand fit: 5. If Incognito Browser blocks trackers, this is the proof.
- Deps: none.

**3. Data Broker Opt-Out Generator**
- Free: user enters name / city / state → tool generates pre-filled opt-out request letters for the top ~20 US data brokers (Spokeo, Whitepages, BeenVerified, Radaris, MyLife, etc.), one per broker, in each broker's required format, with the correct mailing/email address and the right legal citation (CCPA §1798.120, or the broker's own opt-out procedure). User copies/downloads and sends them.
- Pro: none for now — auto-submission would require integrating with each broker, which is an external dep.
- SEO: "remove my info from data brokers" / "opt out of spokeo" / "delete me from whitepages" — high intent; DeleteMe and Incogni charge $100+/yr, so a good free generator is genuinely differentiated
- Brand fit: 5. Directly reduces the user's exposure; the most tangible "we're on your side" tool in the catalog.
- Deps: none. The broker list + templates live in a JSON file we maintain. Nothing leaves the browser — the letters are generated client-side. **This is a build-time content project (broker research + templates) plus a small React form, not an API integration.**

**4. Website Privacy Grade**
- Free: enter any URL → grade A–F on trackers, cookies, third-party scripts, HTTPS, security headers. Essentially cookie-analyzer + security-headers scan, unified. Runs through our existing hardened Vercel scanner.
- Pro: shows the grade in the address bar for every site
- SEO: "is [site] safe" / "[site] privacy" — long-tail goldmine; one page per popular site is a pSEO expansion vector
- Deps: none beyond our existing scanner API.

### Tier 2 — strong but secondary

**5. Referrer Leak Checker** — shows exactly what `Referer` / `Origin` headers each site receives from you, with a live demo. Client-side. Fits the browser-privacy cluster.

**6. Font / Canvas Fingerprint Deep Dive** — already partially in browser-privacy; make it its own pSEO page for the fingerprinting niche with the canvas image rendered visibly so the user sees what's being hashed.

**7. WebRTC Deep Dive** — the WebRTC leak check exists inside What's My IP; split into a dedicated page with an explainer of ICE candidates and per-browser mitigation. Strong VPN-adjacent query ("webrtc leak").

### Blocked by the no-external-deps constraint

Listed so the reasoning is on record. Revisit if the constraint changes.

- **Email Breach Checker** — needs HaveIBeenPwned's API. Very high demand ("was I in a data breach"), but no way to answer it without a breach corpus.
- **Password breach check** (the upgrade to Password Tool) — same HIBP dependency.
- **URL reputation lookup** (the upgrade to URL Safety Checker) — needs Google Safe Browsing or PhishTank.
- **Phone Number Exposure Check** — needs Dehashed or equivalent.
- **Privacy Policy Grader** — needs an LLM call at scan time.
- **Cookie Consent Banner Grader** — needs headless browser + interaction; heavy infra.
- **Social Media Privacy Settings Checker** — needs OAuth into each platform.

---

## Part 7 — Recommended sequence

**Phase 1 (pre-launch):** Consolidate (quiz 9→3, merge password tools). 46 → 39 pages. Reposition hash-generator around download verification. Add the "See this in Incognito Browser →" panel to every free tool — but **only the VPN/Leak Monitor panel makes a concrete promise**; the rest use a generic download CTA until their Pro feature ships.

**Phase 2 (first 30 days — VPN-aligned):** Self-host the IP lookup (removes ipify/ipapi — a privacy tool shouldn't leak user IPs to third parties). Add DNS leak test to What's My IP. Add Client Hints to UA analyzer. These are 1–2 day tasks and make the free tool that funnels into the VPN as strong as possible before the VPN launches.

**Phase 3 (30–90 days):** Build Tier 1 in order: Ad Blocker Test → Data Broker Opt-Out → Website Privacy Grade. Each is 3–5 days of build plus pSEO content wrapping. Data Broker Opt-Out is the largest (broker research is the bulk of the work).

**Phase 4 (browser team, parallel):** Ship Leak Monitor with the VPN. Then pick the next Pro feature from the candidate list — Download Verifier is the smallest and most on-brand follow-up.

---

## Part 8 — Decisions

### Settled

| Decision | Answer | Effect on this doc |
|---|---|---|
| Password manager in the browser? | **No, not on roadmap** | Vault Audit removed from Pro list. Password Tool keeps a generic download CTA. |
| Current browser build focus? | **VPN** | Leak Monitor promoted to the lead Pro feature. What's My IP + DNS leak test become the primary free funnel. Phase 2 re-sequenced around VPN launch. |
| External dependencies? | **None** | HIBP, Safe Browsing, Dehashed, LLM-at-scan-time all ruled out. Email Breach Checker and two tool upgrades moved to the "blocked" list. |
| Cut hash-generator / useragent-analyzer? | **No** | Both kept. Hash-generator repositioned around download verification + the Web3 audience. UA analyzer gets Client Hints. |

### Still open

1. **Which Pro features beyond Leak Monitor are realistically on the 6-month roadmap?** Until one is confirmed, its free-tool upgrade panel stays as a generic "Download Incognito Browser" CTA — no specific promises.
2. **Data Broker Opt-Out — proceed?** This is a content-research project (compiling ~20 brokers' opt-out procedures, addresses, and legal citations into a JSON file) plus a small form. No API integration, no external deps, nothing leaves the browser. It's the biggest differentiator available under the current constraints. Estimate: 3–4 days research + 1–2 days build.
3. **Publish the APK SHA-256 on the download page?** Needed for the hash-generator repositioning to work. Requires a hash to be generated per release and posted — a release-process change on the browser side, not a website change.
