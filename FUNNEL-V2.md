<!--
  STATUS (2026-09-08, maintained by the engineer): this is the synthesized
  funnel design (five independent designs, three judges, one synthesis) with
  the owner's decisions applied on top. Where the two differ, the owner wins:
    - Report-card visitors who click "Scan any URL with Incognito Pro" go to
      the PRO WEB APP (owner, 2026-09-08). The document's alternative
      (routing them through /resources/check/) is kept as an option for the
      2026-10-06 review.
    - The VPN is messaged as live ("deploy this as if the VPN is up"), so the
      VPN_LIVE flag described below is ON by default.
    - Desktop sells the install + hand-off; Pro is named in the benefit cards,
      never as a desktop purchase button (implemented in ResultCta).
  Built in the first funnel PR: result-moment CTA (severity × niche copy),
  scorecard PNG, post-result checklist, "Check yours now" on every content
  page, /event counters with utm_term page-type attribution, Play links by
  tier, and the new tools (Link Unwrapper, Email Pixel Detector, Screenshot
  Leak Checker, DNS Leak Test, Ad-Blocker Test, "Cracked in…").
  Not yet built: /resources/check/ composite spine, share landings with
  pre-rendered OG images, QR hand-off, owner badge, changes feed, public
  counters page, app-team hooks (§7).
-->
# FUNNEL V2: free tools + free app → Pro subscription

**Date:** 2026-09-08. **Status:** replaces §1, §3, §5 and §6 of `FUNNEL-AND-TOOLS-STRATEGY.md`. §2 (instrumentation: `POST /event`, Redis day counters, Play install referrer) and §4 (new tools) stand as written and are referenced, not rewritten; this document adds dimensions and events to §2 and assigns each §4 tool a funnel job.
**Owner feedback incorporated (2026-09-08):** referrer param kept; three conversion surfaces (result-moment CTA, hand-off, niche copy) kept; the shareable scorecard is the centrepiece; the conversion being sold is free tools + free Android app → paid Pro subscription in the app (tools + VPN + pro ad blocking + more); staying on site and with the brand matters; the four new tools are in; DNS Leak Test ships as if the VPN exists.
**Grounding:** `out/` static export (1,331 pages: 502 report cards, 48 tool pages across 24 niches, 134 checklists, 177 guides, 89 calculators, 90 comparisons, 134 templates, 107 glossary, 44 topic hubs, and the rest); `lib/play.ts`, `lib/tiers.ts`, `app/site/[domain]/page.tsx`, `data/taxonomy.json`. Two verified defects are carried into week 1.

---

## 1. Verdict

The money is an in-app purchase inside an Android app that 9 million people already have, so the funnel is designed backwards from that paywall and Population B (free-app users) is primary: for them the website is the app's "Privacy Check-up" screen and the paywall's reason code, one tap from purchase, no install, no hand-off. Population A (web search) is the feeder: 1,331 pages are doors but only 48 produce a proof moment today and the other 1,283 link to nothing more specific than the tools index, so every door gets wired to a zero-input proof tool, every proof produces one shareable scorecard with its own landing page, and the ask on desktop is always the install, never Pro, because a desktop visitor cannot buy. Pro is sold on one demonstrated fact rather than a slogan: the composite check is built so the free app passes part of it (trackers blocked) and fails at least two rows it cannot fix (real IP, ISP DNS resolver, tier-2 ad bait), so "Free stops the trackers, Pro adds the VPN and blocks what got through" is on screen before the CTA appears. Everything runs first-party, cookieless and account-free, and the whole loop (proof → scorecard → share landing → proof) closes without a server storing anything about anyone.

---

## 2. Two populations, two funnels

**Platform rule (used by every table below).** `platform` ∈ {`desktop`, `android-web`, `app-free`, `app-pro`}. `app-*` is detected from the UA token `IncognitoBrowser/<ver>` (app hook 1) or, until that ships, from `?src=app` on any URL the app opens; `app-pro` from `?tier=pro` or `window.IncognitoApp.tier`. Detection only changes copy and the CTA target; spoofing it gains nothing.

### 2a. Population A: web search visitors (desktop-heavy hypothesis, measure in week 1)

| Stage | Surface (exact) | Copy angle | Event |
|---|---|---|---|
| A0 Door | any of the 1,283 non-tool pages: `/resources/checklists/<niche>/<slug>/`, `/guides/`, `/calculators/`, `/comparisons/`, `/templates/`, `/glossary/`, `/topics/<niche>/`, `/site/<domain>/` | the page answers the query honestly | `page_view{type,niche,platform}` |
| A1 Route to proof | new **"Check yours now" block** on every non-tool page, above the related cards, routed by `lib/proof-map.ts` (niche → tool). The 20 tool-less niches route to zero-input auto-run tools: `dns-leak`, `ip-leak` (whats-my-ip), `ad-blocker`, `useragent-analyzer`, `permission-checker`, or to `/resources/check/` | "This checklist says disable WebRTC. See whether your browser is leaking right now. 10 seconds, nothing to type." | `proof_route_click{from_type,to_tool}` |
| A2 Proof | tool result panel on `/resources/tools/<niche>/<slug>/`; report card `/resources/site/<domain>/` counts as proof (it is their site) | their number, severity-coloured: "DNS answered by Comcast", "14 of 50 beacons loaded", "cnn.com: D" | `result_shown{tool,sev,platform}` |
| A3 Artifact | scorecard PNG + share link `/resources/r/<tool>/<grade>/?s=<code>` (§6) | "Post your grade. Dare a friend." | `share_click{channel,tool,grade}` |
| A4 Ask | result-moment CTA (engineer, in flight) with severity × platform copy (§4) and the niche fear clause | desktop and android-web: **install**. Red: "This is the leak the app closes." Green: "Keep it that way on your phone." | `cta_view`, `cta_click{target: play\|qr\|send\|pro}` |
| A5 Hand-off (desktop only) | QR (encoder bundled in-repo, no CDN) to short link `/go/<tool>-<sev>?s=<code>` → Play with referrer; `sms:` and `mailto:` prefilled client-side (nothing captured) | "Send this check to your phone. It re-runs there and shows what the app fixed." | `handoff_qr`, `handoff_send` |
| A6 Install | Play link from `lib/play.ts`: `utm_source=resources&utm_medium=<surface>&utm_campaign=<tool>&utm_content=<niche>-<sev>&utm_term=<from_type>` | (store listing) | Play Console installs by referrer |
| A7 Continuity | app first run reads the referrer and opens `/resources/check/?src=app&first=1&from=<tool>&s=<code>`; page renders "on the web" (decoded from `s`) beside "in the app" (re-run) | "On the web you leaked 3 of 5. In the free app: 2 of 5. Pro closes the last two." | `result_shown{platform=app-free,first=1}` |
| A8 | joins Population B at B3 | | |

`utm_term=<from_type>` is new: it tells us which *page type* (checklist, guide, calculator, report card, comparison) earns installs, which the content machine cannot learn any other way.

### 2b. Population B: the 9M free-app users (Android, inside our browser, no install step)

| Stage | Surface (exact) | Copy angle | Event |
|---|---|---|---|
| B0 Entry | app menu item + new-tab tile "Privacy Check-up" (app hook 4) → `/resources/check/?src=app` | "Is this browser leaking right now? 60-second check." | `landing{platform=app-free,ref=app}` |
| B1 Proof | `/resources/check/` composite: 5 rows run in sequence, client-side: (1) `ip-leak` real IP + WebRTC, (2) `dns-leak` resolver owner, (3) `ad-blocker` tiered first-party bait, (4) `permission-checker`, (5) `useragent-analyzer` exposure. One letter grade. **Built so the free app always fails rows 1 and 2 and partially passes row 3.** | "Your browser: C. Free Incognito stopped 31 of 50 trackers. Your IP and your DNS are still visible." | `result_shown{tool=check,sev,platform=app-free}` |
| B2 Row tags | every row carries a tag: **Pro fixes** (`ip-leak`, `dns-leak` → VPN; `ads-t2` → pro ad blocking), **You fix** (permissions, UA settings → the matching `/resources/checklists/…/` item), **Info** (nothing on a phone fixes it; explained). You-fix rows route to the checklist *before* the Pro ask. | "2 rows are Pro's job. 1 is yours (30 seconds). 2 passed." | `row_shown{row,tag,state}` |
| B3 Ask | CTA becomes **Unlock Pro** → `incognito://pro?reason=<row>&from=check&sev=<sev>` (hook 2); fallback: Play listing IAP link with `utm_medium=app-check`. Price-anchored against a standalone VPN, Android only (§3 line 5). | benefit card for the first Pro-fixes row; "A VPN alone is $3 to $13 a month. Pro is the VPN, the blocking and every tool here, for [Pro price]." | `cta_click{target=pro,reason}` |
| B4 Paywall | in-app Play Billing sheet, header repeats the failed rows | (app) | app posts `paywall_view{from,reason}` and `purchase{from}` counts to `/event` (hook 6); Play Console |
| B5 After | app reopens `/resources/check/?src=app&tier=pro` → rows 1, 2, 3 green → before/after card + share prompt | "Before: C. Now: A. Share it." | `result_shown{platform=app-pro}`, `share_click{grade=pro}` |
| B6 Return | local history delta on `/check/`, last-result card on the new tab (hook 7), `.ics` "re-check in 30 days", monthly `/resources/site/changes/` | "Since Aug 30: WebRTC started leaking." | `landing{ref=app,return=1}` |

Until hooks 1 and 4 ship, Population B does not exist for us; measure `landing{ref=app}` in week 3 and treat zero as a blocker, not a result.

### 2c. Where the Pro web deployment fits

`incognitobrowser-pro.vercel.app` (22 Pro tool pages: cookie scanner, fingerprint audit, URL checker, metadata stripper, per niche) stops being a website and becomes **the app's Pro tab**: a WebView reachable only from the Pro build, so the app build is the gate and no accounts are needed. Website side: add app-mode chrome (hide "← Free tools", add "Back to browser"), keep noindex, and route the report cards' "Scan any URL with Incognito Pro" through `/resources/check/` on the static export instead of the dead `pro.incognitobrowser.io` default in `lib/tiers.ts`. From free pages it is linked in exactly one place: the `app-free` result panel, as "This is what Pro sees →" (preview). Desktop visitors never see it. **Dated decision rule:** on 2026-10-06, if preview clicks are under 1% of `app-free` `result_shown`, unlink it entirely and keep it as the Pro tab only.

---

## 3. The Pro value story the website tells

Pro = these tools built in + VPN + pro ad blocking + more. Each proof moment names exactly one benefit; the CTA shows one card, never a feature list.

| Proof moment (free tool) | What the free app shows | Pro benefit named | Row tag / reason code |
|---|---|---|---|
| `ip-leak` (What's My IP + WebRTC): real IP printed | still visible | **VPN** | `ip-leak` |
| `dns-leak` (DNS Leak Test): resolver belongs to the ISP | still visible | **VPN** | `dns-leak` |
| `ad-blocker` (Ad-Blocker Test): tier-1 bait blocked, tier-2 bait loaded | mixed: "31 of 50 blocked" | **Pro ad blocking** | `ads-t2` |
| `/site/<domain>/` report card: 47 trackers, 6 pre-consent cookies | knowing is free | **Pro ad blocking**: "Pro blocks N of 47" computed at build time from the app's blocklist (only if the list is checked into the repo; otherwise "blocks these on every site") | `site-trackers` |
| Link Unwrapper, Email Pixel Detector: "this link carried 7 trackers" | one link at a time | **Link Guard** (the "more"): strips tracking from every link before it loads | `link` |
| Screenshot Leak Checker, metadata: GPS in the photo | one file at a time | **Auto-strip uploads** (the "more") | `upload` |
| Fingerprint audit, cookie scanner, URL checker, metadata stripper (the 4 Pro engines, 22 pages) | not on the free site | **Tools built into Pro**, the Pro tab | `tools` |
| Green result | clean today | retention: Pro keeps it that way on every site | `clean` |

**The six lines (used verbatim on the CTA, the scorecard footer and the share landing):**

1. Universal: **"The free app hides your history. Pro hides you."**
2. Universal sub-line: "Pro = the VPN, pro ad blocking, and every tool on this site, built into the browser you already use. One subscription."
3. Red, leak (`ip-leak`, `dns-leak`): "You just watched it leak. Pro's VPN sends your DNS and your traffic through our tunnel, on every site, on every network."
4. Amber, mixed (`ads-t2`): "Free Incognito stopped 31 of 50 trackers. Pro blocks the 19 that got through, in every tab, not just this test."
5. Price anchor, Android and app only: "A VPN alone costs $3 to $13 a month. Pro is the VPN, the blocking and the tools for [Pro price from the Play IAP, stated per month]."
6. Green: "Nothing leaked today. Pro keeps it that way on café Wi-Fi and on the sites you haven't checked."

Scorecard footer (line 7, image only): "Graded by Incognito Browser. Check yours: incognitobrowser.io/resources/check/"

**Honesty rails.** The DNS Leak Test is honest (it really shows resolvers); only the remedy line references the VPN. All VPN copy sits behind a `VPN_LIVE` build flag: written now, rendered as "Pro's VPN" when the flag is on, and as "the VPN coming with Pro" when off. Flip it the day the Play listing shows the VPN. The "Pro blocks N of M" number renders only when the blocklist is in-repo; there is no estimated number.

---

## 4. Surfaces to build, the CTA copy matrix, the niche rule

### 4a. Surfaces (website side; "engineer" = already in flight)

| # | Surface | Path / file | Job in the funnel |
|---|---|---|---|
| 1 | Proof map + "Check yours now" block | `lib/proof-map.ts`; block in `ChecklistPage`, `GuidePage`, `CalculatorPage`, `ComparisonPage`, `TemplatePage`, `GlossaryPage`, topic hubs, report cards (1,283 pages) | A1 |
| 2 | Result-moment CTA (engineer) | one component fed by tool result + platform + niche | A4, B3 |
| 3 | Desktop hand-off | QR + `sms:` + `mailto:`; `/go/<tool>-<sev>` short links; in-repo QR encoder | A5 |
| 4 | Privacy Check-up hub | `/resources/check/` (indexable), app mode via `?src=app`, `?tier=pro` before/after, `?first=1&s=` continuity | B1, A7 |
| 5 | Scorecard PNG (engineer) | client canvas, two sizes, Web Share API with files | A3, B5 |
| 6 | Share landings | `/resources/r/<tool>/<grade>/` static, 42 pages, pre-rendered OG images | §6 |
| 7 | Report-card OG scorecards | build-time image for all 502 `/site/` pages | §6 |
| 8 | Owner badge | static SVG per domain, links to `/site/<domain>/` and `/site/methodology/` | §6 |
| 9 | Post-result checklist (engineer) | links `/resources/checklists/<slug>/`; local tick state | §5 |
| 10 | Changes page + feed | `/resources/site/changes/` and `/resources/site/changes.xml` | §5 |
| 11 | Public counters | `/resources/stats/` and `/resources/how-we-count/` | trust, press |
| 12 | Flags and chrome | `VPN_LIVE`; app-mode chrome on both deployments | §3, §2c |
| 13 | Two fixes | `app/site/[domain]/page.tsx` line 209: `utm_content=grade-{grade.grade}` is a literal string inside a plain `href` attribute, so every report-card install is attributed to one bucket today; build it with `playUrl()`. `lib/tiers.ts` `PRO_BASE_URL` falls back to the dead `pro.incognitobrowser.io` on the static export; route through `/resources/check/`. | week 1 |

### 4b. CTA copy matrix (severity × population). One headline, one target per cell.

| Severity | `desktop` | `android-web` | `app-free` | `app-pro` |
|---|---|---|---|---|
| **Red** (Pro-fixes row failed) | "This is the leak Incognito Browser closes. Send this check to your phone." → QR / send | "This is the leak Incognito Browser closes. Get the app, it re-runs this check." → Play, referrer | "This is the leak Pro's VPN closes. Unlock Pro." + price anchor → `incognito://pro?reason=<row>` | no upsell; "Fixed by Pro" chip, share the green card |
| **Amber** (mixed, or You-fix row) | "Free Incognito blocks the trackers. Your IP is still yours to fix: 30 seconds." → checklist first, then QR | same, → checklist first, then Play | "Free stopped 31 of 50. Pro blocks the rest. Fix the setting row first (30 s), then unlock Pro." → checklist, then paywall | "One setting is yours: fix it." → checklist |
| **Green** (all pass) | "Clean today. Keep it that way on your phone." → QR / send | "Clean today. Keep it that way in the app." → Play | "Clean today. Pro keeps it that way on every network." → paywall, benefit `clean` | "Still clean. Share it." → share |

Rules: desktop never shows a Pro price or a Pro button; `app-pro` never shows an upsell (hook 3 makes this reliable); amber always routes the free fix before the Pro ask, so a privacy purist sees the free answer first.

### 4c. The niche-copy rule

One severity × benefit table (4b) for the whole site; niches swap **only the fear clause**, drawn from a new `fear` field on each niche in `data/taxonomy.json` (seeded from `context.pain_points`, then hand-edited, 44 strings, under 60 characters each). The clause is inserted into the red and amber headlines after the leak noun. Examples: healthcare → "your patient portal login"; gaming → "your real IP on voice chat"; journalist → "your sources"; online-banking → "your bank's login page"; children-safety → "your kid's tablet"; data-brokers → "the profile brokers sell". Niches without a clause fall back to the universal line. No niche gets its own table; if a niche needs different *targets* rather than different fear, that is a proof-map change, not a copy change.

---

## 5. Engagement loop (stay on site and with the brand, no accounts)

All state is `localStorage`, labelled on the page: "saved on this device only; we cannot see it."

1. **Check-up spine.** Every tool page shows the strip "Check 2 of 5 done, next: Ad-Blocker Test" from `/resources/check/` progress. A visitor who came for one tool leaves having run three or four. Completing all five unlocks the composite scorecard, the most shareable artifact because it invites comparison ("I leaked 3 of 5. You?").
2. **Deltas as the return reason.** Each run is stored (date, grade, 5-row vector, tool version). Return visits open with the diff: "Since Aug 30: WebRTC started leaking; ad-blocker 31 → 38 blocked." A delta card ("C → A") is a second share artifact.
3. **Tool memory.** Every tool keeps its last result locally and prints "Last time: 14 of 50" beside the new one.
4. **Post-result checklist** (engineer) links the same-niche `/resources/checklists/<slug>/`; ticks persist locally; the tool shows "4 of 12 done, finish the list" on return; the checklist's own "Check yours now" block links back to the next unrun check. Closed circuit.
5. **Report cards as return content.** Any `/site/<domain>/` viewed joins a local watchlist; `/resources/site/changes/` (monthly re-scan diff: "31 sites changed grade") and `/resources/site/changes.xml` (RSS, a subscription with zero email) are linked from every card and from the check-up; the watchlist renders "3 of your sites got worse". Add category lists (`/site/news/`, `/site/banks/`, `/site/health/`, using `lib/site-categories.ts`) linked from the matching niche hubs.
6. **No-notification return hooks.** PWA manifest for `/resources/` (add to home screen on Android, so the check-up sits next to the app icon for people who never installed) and a `.ics` "re-check in 30 days" download from the result panel. In the app: last-result card on the new tab (hook 7).
7. **Public counters.** `/resources/stats/` shows yesterday's counts per tool and severity with `/resources/how-we-count/` beside it. A reason for the privacy crowd to come back, a press asset, and the visible form of "we count clicks, not people".

Measured by `tool_run` per `page_view` (pages-per-visit proxy, cookieless), `check_complete`, and `landing{return=1}`.

---

## 6. Sharing loop (the scorecard)

**What is on the image.** Grade letter (A to F) large; headline number ("DNS answered by Comcast", "14 of 50 beacons loaded", "cnn.com: D", "cracked in 0.4 s"); up to five row chips (pass/fail, row name); the tool name and niche; date; brand mark; footer URL `incognitobrowser.io/resources/check/`. **Never on the image:** the IP address, resolver hostname beyond the owner name, fingerprint hash, timezone, fonts. The user previews before generating. Report cards: domain, grade, tracker count, "Privacy Grade D, verified by Incognito Browser".

**Sizes.** 1200 × 630 (X, Reddit, Discord, Telegram link cards) and 1080 × 1080 (WhatsApp, Instagram stories, Telegram image). Client canvas, `toBlob`, no server. WhatsApp is the dominant channel for the Android base; X and `r/privacy`, `r/VPN`, `r/degoogle` are the desktop targets.

**Where the share button goes.** `android-web` and `app-*`: `navigator.share({files:[png], url})` → the Android share sheet. `desktop`: Copy link, Download PNG, prefilled X and Reddit intents, and "Send to phone" (the A5 hand-off with the same link). In the app: same sheet, `?src=share`; a Pro user's green before/after card is the best ad we can make.

**The link.** `/resources/r/<tool>/<grade>/?s=<code>`: 7 tools (`check`, `dns-leak`, `ip-leak`, `ad-blocker`, `link-unwrapper`, `email-pixel`, `cracked-in`) × 6 states (A, B, C, D, F, `improved` for the delta card) = **42 static pages**, each with its own pre-rendered OG image, so a pasted link unfurls as the grade on the static export without a server. `s` is base64url of `{v, tool, grade, rows:[0|1 × 5], n}` (about 40 characters), decoded client-side for the compare banner; nothing is stored. Report cards share their canonical `/resources/site/<domain>/`, whose OG image (surface 7) is the scorecard itself: the link preview is the share. Screenshot Leak results are not shareable (they contain the user's own PII).

**How a share becomes a landing.** The landing page reads: "Someone scored C on the DNS leak test. Beat it: 20 seconds, nothing to type." The mapped tool runs inline, the visitor gets their own scorecard, then the same result-moment CTA (§4b) fires. Presence of `s` counts `landing{ref=share,tool,grade}`; no referrer sniffing. A share landing is an A2 visit and re-enters the loop.

**Owner badge → backlinks.** Each of the 502 report-card pages offers site owners an embeddable static SVG ("Privacy Grade B, verified by Incognito Browser", no scripts) linking to `/resources/site/<domain>/`, with `/site/methodology/` linked from the badge page. Every embed is a link from a domain we do not own. Disputed grades are a feature (press); the methodology link is what makes disputes survivable.

---

## 7. App-team asks, ranked (minimal; 1 to 4 are URL-level)

1. **Identify the app to the web.** Append `IncognitoBrowser/<ver> (tier=free|pro)` to the WebView UA, or always add `?src=app&tier=<tier>` to URLs the app opens on our domain. One line; unlocks all of Population B and the platform split.
2. **Paywall deep link.** `incognito://pro?reason=<row>&from=<tool>&sev=<sev>` opens the Play Billing sheet with the matching benefit panel first (`dns-leak`, `ip-leak` → VPN; `ads-t2`, `site-trackers` → ad blocking; `link`, `upload`, `tools` → tools). On success, return to the originating URL with `?tier=pro`.
3. **JS bridge** `window.IncognitoApp = {tier, version, openPaywall(reason)}` injected on `incognitobrowser.io` only, so Pro users never see an upsell and the deep link has a fallback.
4. **"Privacy Check-up" entry point** in the menu and on the new-tab page (free build) → `/resources/check/?src=app`. A link, not a feature.
5. **Install Referrer continuity.** Read the Play referrer on first launch; if `utm_source=resources`, after onboarding open `/resources/check/?src=app&first=1&from=<utm_campaign>&s=<code>`. Fires once per install, so this serves A only.
6. **App-reported counts** to `POST /event`: `paywall_view{from,reason}` and `purchase{from}`, counts only, no device id. This is the only way web → IAP closes by source.
7. **Pro tab** = WebView of the Pro deployment (Pro build only); `navigator.share` with files and canvas `toBlob` enabled in the WebView; last-result card on the new tab; post-purchase auto reopen of `/check/?tier=pro`.
8. Later: confirm the free and Pro blocklists and check them into the repo (unlocks "Pro blocks N of M"); make sure the tier-2 bait paths are on the Pro list and not the free list (§10).

---

## 8. The five numbers to measure first (all first-party, `/event` + Play Console)

1. **`result_shown` by platform** (`desktop` / `android-web` / `app-free` / `app-pro`). Decides A-vs-B effort and whether the hand-off work matters. Read in week 1.
2. **`proof_route_click ÷ page_view` by page type** on the 1,283 non-tool pages. The content machine's conversion; target ≥ 5% on checklists and guides, ≥ 2% on glossary.
3. **`cta_click ÷ result_shown` by severity and tool.** Red must be ≥ 3 × green or the copy is not landing; `app-free` `cta_click{target=pro}` ÷ `result_shown{tool=check}` is the number that predicts revenue.
4. **Share loop:** `share_click ÷ result_shown` per tool (target ≥ 3%) and `landing{ref=share}` per 100 `share_click` (target ≥ 40, the K-factor proxy). Tools under 1% share rate after two weeks lose their share button.
5. **Money:** attributed installs per 1,000 `result_shown` by `utm_campaign` and `utm_term` (Play Console), and once hook 6 ships, `paywall_view → purchase` by `from` and `reason`.

Two-dimension additions to §2 needed for these: `platform`, `from_type`, `reason`, `ref`, `first`, `return`; new events `page_view`, `proof_route_click`, `row_shown`, `check_complete`, `landing`, and the two app-posted events.

---

## 9. Four-week website build sequence

**Week 1: fix, measure, wire the doors.** Fix the two defects (§4a #13). `/event` gains `platform`, `from_type`, `page_view`, `proof_route_click`, `landing`. App-mode detection (`?src=app`, UA token) flips the CTA target to the Pro deep link with the Play IAP fallback. `lib/proof-map.ts` and the "Check yours now" block on all 8 non-tool templates; `utm_term=<page type>` on every Play link via `playUrl()`. Result-moment CTA with the 4b matrix and the niche fear clause (engineer, in flight). `VPN_LIVE` flag. Send hooks 1 to 4 to the app team as a one-page URL spec. **Verify:** `grep -c 'proof-route' out/checklists/*/*/index.html` ≥ 1 on every page type; `grep -c 'utm_term' out/site/cnn.com/index.html` ≥ 1; the report-card referrer decodes to a real grade.

**Week 2: the spine and the artifact.** `/resources/check/` composite check with the five rows, row tags, local history and delta; scorecard PNG in both sizes with Web Share API, copy link, X and Reddit intents (engineer, in flight); the 42 `/resources/r/<tool>/<grade>/` static landings with pre-rendered OG images and `?s=` decoding; desktop hand-off (QR in-repo, `sms:`, `mailto:`, `/go/` short links). Link Unwrapper and "Cracked in…" wired into the scorecard.

**Week 3: the VPN proof and report cards as content.** DNS Leak Test and Ad-Blocker Test with tiered first-party bait feeding rows 2 and 3 of the check and the VPN and ad-blocking benefit cards; build-time OG scorecards for the 502 `/site/` pages; owner badge with methodology link; `/resources/site/changes/`, `changes.xml`, the local watchlist and category lists; Email Pixel Detector. Measure `landing{ref=app}`; if it is zero, escalate hooks 1 and 4.

**Week 4: distribution, trust, cut.** Screenshot Leak Checker; `/resources/stats/` and `/resources/how-we-count/`; PWA manifest and `.ics` re-check; app-mode chrome on both deployments and the Pro web preview link in `app-free` mode only; one anchor guide plus one checklist per new tool (12 pages) with inline prose links to the tool. Read the five numbers: drop "Check yours now" placements under 1%, double the ones over 5%, remove share buttons from tools under 1% share rate, and apply the 2026-10-06 rule to the Pro web deployment.

---

## 10. What we deliberately do not do

- **Sell Pro on desktop.** A desktop visitor cannot buy; desktop sells the install and the hand-off. No Pro price, no Pro button, on `desktop`.
- **Accounts, email capture, phone capture, third-party analytics, LLM at runtime, push from the web.** The hand-off is QR, `sms:` and `mailto:` prefilled on the visitor's own device; nothing is submitted to us.
- **Put the IP, resolver hostname, fingerprint hash or any PII on a scorecard or in a share URL.** Pass/fail rows and a grade only; the user previews first.
- **Promise a VPN the store does not list.** `VPN_LIVE` gates the wording; the paywall and the Play listing must say the same thing.
- **Publish "Pro blocks N of M" as an estimate.** It renders only from a blocklist checked into the repo.
- **Let the free app score 50/50 on the Ad-Blocker Test.** Tier-1 bait uses paths generic EasyList rules match (`/ads/banner.js`, `/analytics.js`) so the free app visibly works; tier-2 bait uses tracker-like paths on our own hostnames that only the Pro list matches. If the free list ever matches tier 2, the Pro ad-blocking line disappears, so the app team owns the split (hook 8).
- **Build 20 new tool shells for the tool-less niches.** That recreates the doorway problem; the proof map routes them to the five zero-input tools and the check-up instead.
- **Move Pro engines back to the free site.** The fingerprint audit, cookie scanner, URL checker and metadata stripper stay Pro (owner decision 2026-09-07); on the free site they are the "tools built into Pro" line, and in the app they are the Pro tab.
- **Index or market the Pro web deployment.** It is the app's Pro tab; noindex stays; the 2026-10-06 rule decides whether it keeps its one preview link.
- **Fake the DNS Leak Test.** It shows real resolvers; only the remedy line mentions the VPN.
- **Join journeys.** Redis counters give rates by dimension, not people. That is the point, and `/resources/how-we-count/` says so.
