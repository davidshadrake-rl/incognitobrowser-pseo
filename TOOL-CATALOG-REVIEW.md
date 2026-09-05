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
| Pro extension | 5 | **Real-time link scanner**: check every link before navigation, using Safe Browsing API + our heuristics + reputation feed |

**Verdict:** ⚠️ **KEEP + UPGRADE.** Free version needs a real reputation lookup (Google Safe Browsing Lookup API is free for non-commercial; or PhishTank feed) to be credible.
**Free:** heuristics + Safe Browsing lookup.
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

**Verdict:** ⚠️ **KEEP + ADD BREACH CHECK.** Add HaveIBeenPwned range API (k-anonymity, no password leaves the browser). That's the one feature that separates it from the 500 others.
**Free:** strength + breach check.
**Pro:** vault audit (requires the browser's password manager).

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
| SEO | 2 | "what is my user agent" has some demand but it's a dev query |
| Brand fit | 2 | Tangential |
| Article synergy | 2 | Only fits fingerprinting articles, and browser-privacy already covers that |
| Uniqueness | 1 | Fully commodity |
| Quality | 3 | 288 LOC, fine |
| Conversion | 1 | None |
| Pro extension | 2 | UA spoofing is a browser setting, not a tool |

**Verdict:** ❌ **CUT.** Fold the useful part (UA uniqueness score) into browser-privacy as one more check. Retire the standalone.

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

**What it does:** SHA-1/256/384/512 + HMAC of text or files.

| Lens | Score | Note |
|---|---|---|
| SEO | 2 | "sha256 generator" — dev demand only |
| Brand fit | 1 | Not a consumer privacy tool at all |
| Article synergy | 1 | Only fits the crypto-privacy niche |
| Uniqueness | 1 | Hundreds exist |
| Quality | 4 | 281 LOC, correct |
| Conversion | 1 | None |
| Pro extension | 1 | None |

**Verdict:** ❌ **CUT.** Wrong audience. A crypto-privacy article can link to an external hash tool. Keep the code (it's small and correct) but retire the page.

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
| password-strength | 4 | 3 | 4 | 1 | 3 | 2 | 4 | **21** | ⚠️ Merge + breach check |
| text-encryption | 2 | 3 | 3 | 2 | 4 | 2 | 4 | **20** | ⚠️ Keep as niche |
| password-generator | 4 | 2 | 3 | 1 | 4 | 1 | 3 | **18** | ⚠️ Merge |
| privacy-quiz | 2 | 3 | 3 | 1 | 3 | 2 | 2 | **16** | ⚠️ Consolidate 9→3 |
| useragent-analyzer | 2 | 2 | 2 | 1 | 3 | 1 | 2 | **13** | ❌ Cut (fold in) |
| hash-generator | 2 | 1 | 1 | 1 | 4 | 1 | 1 | **11** | ❌ Cut |

---

## Part 4 — The Free / Pro split

### FREE (marketing site — `incognitobrowser.io/resources/tools/`)

Everything below stays genuinely useful as a one-shot. No crippling.

| Tool | Free scope | The upgrade hook shown on the page |
|---|---|---|
| **Browser Privacy Audit** | Full fingerprint audit, one-shot | "See how Incognito Browser scores on the same test" side-by-side |
| **Cookie Tracker Scanner** | Scan one URL at a time | "Incognito Browser shows this for every site you visit, live" |
| **What's My IP + Leak Test** | IP + WebRTC + DNS leak, self-hosted | "Incognito Browser monitors this continuously and alerts on leaks" |
| **URL Safety Checker** | Heuristics + Safe Browsing lookup | "Incognito Browser checks every link before you click" |
| **Permission Checker** | Enhanced one-shot with per-permission explanations | "Incognito Browser audits every site's permissions" |
| **Image Metadata Stripper** | Full EXIF view + strip, client-only | "Incognito Browser strips this automatically on every upload" |
| **Password Tool** (merged) | Strength + breach check + generator | "Incognito Browser audits your saved passwords" (once vault exists) |
| **Text Encryption** | Full encrypt/decrypt | "Incognito Browser has an encrypted notepad built in" |
| **Privacy Quiz** (3 versions) | Full quiz | "Download Incognito Browser to fix the gaps" |

### PRO (in the Incognito Browser app)

These are the "continuous" versions. Each maps to a free tool so the upgrade story is coherent.

| Pro feature | Extends | Why only the browser can do it |
|---|---|---|
| **Fingerprint Watch** | browser-privacy | Needs to observe every site's probes across sessions |
| **Tracker Live** | cookie-analyzer | Needs real-time per-tab cookie/script interception |
| **Leak Monitor** | whats-my-ip | Needs to run background checks on a schedule |
| **Link Guard** | url-analyzer | Needs pre-navigation hook on every click |
| **Permission Audit** | permission-checker | Needs cross-site permission storage access |
| **Auto-Strip Uploads** | metadata-viewer | Needs to intercept file uploads before they leave |
| **Vault Audit** | password tool | Needs the browser's password manager |
| **Encrypted Notes** | text-encryption | Needs persistent local encrypted storage + sync |

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

| Tool | Action | Reason |
|---|---|---|
| **hash-generator** | Retire page, keep code | Dev audience, zero brand fit, zero conversion |
| **useragent-analyzer** | Fold into browser-privacy as one check, retire standalone | Redundant with the fingerprint audit |
| **privacy-quiz** (6 of 9) | Draft the 6 weakest niche variants, keep 3 | Commodity; 9 copies of one quiz engine reads as thin |
| **password-generator** | Merge into password-strength → "Password Tool" | Two commodity pages become one stronger one |

**Net effect:** 46 tool pages → ~36. Fewer, stronger pages. Aligns with the doorway-pattern fix (R2) — fewer near-duplicate tool shells.

---

## Part 6 — Build list (new tools worth adding)

Ranked by (SEO demand × brand fit × Pro extension). Each has a free version that's a strong search-capture page AND a pro version that justifies the install.

### Tier 1 — build these first

**1. Email Breach Checker**
- Free: enter email → HaveIBeenPwned API → list of breaches, what leaked, when
- Pro: monitor all your emails, alert on new breaches
- SEO: "has my email been hacked" / "was I in a data breach" — very high demand, emotionally charged
- Brand fit: 5. Data-breach niche is already a hub.
- Note: HIBP API requires a key ($3.50/mo). Trivial cost.

**2. Data Broker Opt-Out Generator**
- Free: enter name + state → generates opt-out request letters for the top 20 data brokers (Spokeo, Whitepages, BeenVerified, etc.), pre-filled per each broker's required format
- Pro: auto-submits and tracks status, re-submits when brokers re-list you
- SEO: "remove my info from data brokers" / "opt out of spokeo" — high intent, underserved by good free tools (DeleteMe / Incogni are paid)
- Brand fit: 5. This is the killer app for a privacy brand — it directly reduces the user's exposure.
- Uniqueness: 5. Almost nobody does this well for free.

**3. Ad Blocker / Tracker Blocker Test**
- Free: loads a set of known tracker beacons, reports which got through → "your blocker missed 14 of 50"
- Pro: continuous — shows the block-rate on every page
- SEO: "test my ad blocker" / "is my ad blocker working" — solid demand
- Brand fit: 5. If Incognito Browser blocks trackers, this is the proof.

**4. Website Privacy Grade**
- Free: enter any URL → grade A–F on trackers, cookies, third-party scripts, privacy policy presence, HTTPS, security headers. Essentially cookie-analyzer + security-headers scan + policy detection, unified.
- Pro: shows the grade in the address bar for every site
- SEO: "is [site] safe" / "[site] privacy" — long-tail goldmine, one page per popular site could be a pSEO expansion in itself
- Uniqueness: 4. Blacklight (The Markup) does this well but it's a journalism project, not a product.

### Tier 2 — strong but secondary

**5. DNS Leak Test** — fold into whats-my-ip rather than standalone.

**6. Privacy Policy Grader** — paste a privacy policy URL → readability score, red-flag clauses (data sale, arbitration, indefinite retention), summary. Pro: auto-summarize every site's policy in a sidebar. Uses Claude API. Cost per scan is non-trivial; rate-limit hard.

**7. Phone Number Exposure Check** — is your phone in public records / breach dumps. Adjacent to email breach checker. Needs a data source (HIBP doesn't do phones; would need Dehashed or similar).

**8. Password Manager Exporter Audit** — upload your 1Password / LastPass / Chrome export → audit for reuse / weakness / breach, client-side only. Bridges to the Pro vault audit.

### Tier 3 — nice to have

**9. Referrer Leak Checker** — shows what referrer info each site gets from you
**10. Font / Canvas Fingerprint Deep Dive** — already partially in browser-privacy; make it its own pSEO page for the fingerprinting niche
**11. Cookie Consent Banner Grader** — does this site's cookie banner actually respect your choice? (Requires headless fetch + interaction; complex.)
**12. Social Media Privacy Settings Checker** — you're logged into X/Facebook/Instagram in another tab; check your visible-to-public settings. (Needs OAuth; heavy.)

---

## Part 7 — Recommended sequence

**Phase 1 (pre-launch, this week):** Cut list + merge. 46 → 36 pages. Add "See this in Incognito Browser →" panel to every free tool. Ship.

**Phase 2 (first 30 days):** Upgrade the three tools that need it — self-host IP lookup, add HIBP breach check to password tool, add Safe Browsing lookup to URL checker. These are 1–2 day tasks each.

**Phase 3 (30–90 days):** Build Tier 1 new tools in order: Email Breach Checker → Data Broker Opt-Out → Ad Blocker Test → Website Privacy Grade. Each is a 3–5 day build plus pSEO content wrapping.

**Phase 4 (browser team, parallel):** Spec the 8 Pro features against the free tools. The marketing site's upgrade panels should reflect what's actually shipped in the browser, so this needs coordination.

---

## Part 8 — Open decisions for you

1. **Does Incognito Browser have (or plan) a password manager?** Changes whether Password Tool → Vault Audit is a real Pro path or vaporware.
2. **Which of the 8 Pro features exist in the browser today?** The upgrade panels on the free tools must not promise things that don't exist.
3. **HIBP API key ($3.50/mo) + Google Safe Browsing API** — OK to add these external dependencies? Both are privacy-respecting (HIBP uses k-anonymity; Safe Browsing lookup is hashed prefixes).
4. **Data Broker Opt-Out** is the biggest build and the biggest opportunity. Green-light for Phase 3?
5. **Cut hash-generator + useragent-analyzer now, or wait for Search Console data?** My recommendation: cut now — they were never going to rank and they dilute the catalog.
