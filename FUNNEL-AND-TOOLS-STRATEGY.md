 # Funnel rethink + tool roadmap — free tools → Incognito Browser Pro subscribers

**Date:** 2026-09-07
**Grounding:** the live site as of today (`incognitobrowser-pseo.vercel.app`, `incognitobrowser-pro.vercel.app`), the code, and the Play Store listing. Where I state a number I don't have, it's marked as a hypothesis to measure.
**Constraints honored:** no external dependencies; VPN is the active app build; Pro gate deferred; the terminal conversion is an **In-App Purchase inside the Android app** (the listing already sells IAP).

---

## 0. The three facts that change the plan

| Fact | Consequence |
|---|---|
| **There is no instrumentation.** Not one event is tracked on ~600 pages. | Every funnel opinion — mine included — is faith. Instrumentation is step one, and it can be done first-party and cookieless (we already run an API + Redis). |
| **Two CTAs total, both "Download Browser" in the header, no referrer param.** | The site never asks at the moment of insight, and installs can't be attributed to the tool that earned them. Fixing the param is a 10-minute change with outsized value. |
| **The product is an Android app; the tools' search intent is largely desktop.** *(Hypothesis: >60% desktop for "fingerprint test"/"cookie scanner"-type queries. Measure it.)* | A desktop visitor *cannot* convert on the spot. The funnel needs a **hand-off** step (QR / send-to-phone), or most of the best traffic evaporates at the CTA regardless of copy. |

---

## 1. What the funnel is today vs. what it should be

**Today:** Search → page → (nothing happens) → maybe header button → Play Store (unattributed) → install → ??? → IAP. Seven stages, zero measured, one CTA, no loop.

**Rebuilt around the one asset these tools uniquely produce — proof of the visitor's own exposure:**

| Stage | What happens | Where it lives | Measured by |
|---|---|---|---|
| **S1 Intent** | A fear or question: "am I being tracked", "is my VPN leaking" | Search → pSEO page | landing counts per page/niche |
| **S2 Proof** | The tool shows *their* number: "1 in 2.3M unique", "WebRTC leaking 47.159.121.56", "this site sets 47 trackers" | tool result panel | `result_shown` |
| **S3 Remedy** | In the same viewport, the specific fix: *"Incognito Browser stops exactly this"* — with the specific check named, not a generic button | **result-moment CTA** (doesn't exist today) | `cta_view`, `cta_click` |
| **S4 Hand-off** | Mobile: deep link to Play with referrer. Desktop: QR code + "text me the link" + "email myself" | CTA component | `handoff_qr`, `handoff_send` |
| **S5 Attributed install** | Play Install Referrer carries `utm_source=resources&utm_campaign=<engine>` into the app | Play Store → app | app reads referrer (app-team, first-party to Play) |
| **S6 Continuity** | The app opens on the **same check** and shows before/after: *"On the web you were leaking. Here you're not."* | app first-run | app event |
| **S7 Pro moment** | The free app can't fix everything (real IP without the VPN, cross-site history). The upsell lands at the failure it can't solve: *"Pro's VPN closes this one."* | in-app paywall | IAP |
| **S8 Loop** | The result is shareable: a scorecard image, a site report card, a leak proof. Shares bring new S1 visitors. | web + app | `share_click`, referral landings |

S6 is the single highest-leverage idea in this document and it's app-team work: **the app should know which tool sent the user and re-run it.** Everything the website does before that is to earn the install; everything after is the app's. Without S6, the install is a cold start and the Pro pitch has no story.

### Where the Pro web deployment fits (honest assessment)

As shipped today, `incognitobrowser-pro.vercel.app` is the same four tools with different branding and no gate. It has no reason to exist yet and, left alone, it splits attention. It earns its keep only when it holds things the free page can't: the **deep versions** (site-wide crawl, history/diff, bulk) and the **shareable report artifacts**, and when it's the page that explains and links to the in-app Pro. Until those land, the free site should link to it sparingly (the "Pro version →" badge is fine; don't push harder).

---

## 2. Instrumentation — first-party, cookieless, on infra we already have

**Endpoint:** `POST /event` on the existing Vercel API (same origin, same rate-limiter, same allowlist). Body: `{ event, tool, niche, tier, platform, ref }`. **No IP is persisted, no cookie is set, no user id.** Counters live in Redis (already provisioned) as `evt:<day>:<event>:<tool>:<platform>`. A tiny `/stats` route returns the day's counts. That's the whole system — ~150 lines, and it's *true* to the brand: we can literally print "we count clicks, not people" next to it.

**Events (v1):** `tool_run`, `result_shown` (+ a coarse severity bucket: green/amber/red), `cta_view`, `cta_click` (+ target: play / qr / send / pro), `share_click`, `handoff_qr`, `handoff_send`.

**Install attribution:** append to every Play link `&referrer=utm_source%3Dresources%26utm_medium%3Dtool%26utm_campaign%3D<engine>%26utm_content%3D<niche>`. The Play Install Referrer API hands this to the app on first launch. Zero third parties. This is the bridge from web events to IAP.

**Two numbers to know within a week of shipping this:** desktop vs mobile share of `result_shown`, and `result_shown → cta_click` rate per tool. Those two decide where the next month of effort goes.

---

## 3. Conversion surfaces to build on the free site (ordered by leverage ÷ effort)

| # | Surface | Why it works | Effort |
|---|---|---|---|
| 1 | **Referrer param on every Play link** | Makes installs attributable. Nothing else in this doc is measurable without it. | 10 min |
| 2 | **Result-moment CTA** — one component, fed by the tool's own result | The ask arrives when the visitor has just seen *their* exposure. Copy is per-check: "Incognito Browser blocks canvas fingerprinting" beats "Download Browser". Severity-aware: red result → strong ask; green → "keep it that way". | ½ day |
| 3 | **Desktop hand-off** — QR + "text me the link" (`sms:` URL, client-side, no service) + "email myself" (`mailto:`) | Converts the desktop majority instead of losing them at the CTA. No backend. | ½ day |
| 4 | **Shareable scorecard image** — client-side canvas → PNG: score, "1 in X", the site URL | The viral artifact. Every share is an S1 landing you didn't pay for. Wraps existing tools. | 1 day |
| 5 | **Niche-specific CTA copy** — the healthcare page's ask ≠ the gaming page's | Each pSEO page is a different door; the pitch should match the fear that opened it. Data-driven from the niche JSON. | ½ day |
| 6 | **Post-result "what to do now" checklist** linking the relevant self-verifying checklist page | Keeps the visitor moving instead of bouncing; feeds the content funnel. | ½ day |
| 7 | **"Powered by Incognito Browser" embeddable exposure widget** | Other sites embed a live "what you're leaking" badge → distribution and backlinks from pages we don't own. Classic infra-badge growth play. | 2 days |

Items 1–3 are one PR. I can ship them next.

---

## 4. New tools — built for spread, not just coverage

Every existing list optimized for keyword coverage. This one optimizes for **the artifact a tool produces and whether a human would post it.** All client-side or on our own API; no external deps.

### Free — each one produces something people share

| Tool | What it does | Why it spreads | Notes |
|---|---|---|---|
| **Link Unwrapper: "what does this link know about you?"** | Paste any link from an email/SMS/ad → decodes `utm_*`, `fbclid`, `gclid`, `mc_eid`, `_hsenc`, `vero_id`, etc.; names the vendor; explains what each reveals; one click to the clean URL | "Look what was hiding in that newsletter link" is a screenshot people post. High-intent query ("remove tracking from url"). Nobody does the *explain* part well. | Client-side. Also the foundation of the Pro bulk cleaner. |
| **Email Tracking-Pixel Detector** | Paste raw email source / drop an `.eml` → finds 1×1 pixels, open-tracking beacons, link-wrapping; names the ESP (Mailchimp, HubSpot, SendGrid…) | Gotcha factor; replaces the weak email-privacy quiz with a real tool in a niche that already exists | Client-side parse. |
| **Site Privacy Report Card** ⭐ | `/site/<domain>` — A–F grade for the top ~500 sites from our own scanner: trackers, cookies, third parties, HTTPS/headers, with "what they collect" in plain English | **The biggest SEO + share vector in this document.** Each page is a door ("does cnn.com track me"), each is linkable and arguable, and journalists/site owners share and dispute them. Blacklight proved the demand; nobody productized and *indexed* it. | Batch job on our API + a curated domain list. Re-scan monthly → "changed since last month" is itself news. |
| **Scorecard for the Fingerprint Audit** | Shareable PNG of the audit result | Wrapper on the best tool we have | See §3 #4 |
| **"Cracked in…" password theatre** | Existing strength math, presented as a visceral countdown: "cracked in 0.4s on a $200 GPU" | Shareable, visceral, teaches | Wrapper. |
| **Screenshot Leak Checker** | Drop a screenshot → finds EXIF, embedded thumbnails, hidden layers, and flags visible PII regions (emails/phones/addresses via regex on OCR-free text layers where present) | Extends the metadata tool into the thing people actually paste online | Client-side. |
| **DNS Leak Test** (from the tool review) | Our own resolver-detection endpoints | The VPN funnel's proof step | Already planned; ship with the VPN. |
| **Ad-Blocker Test** (from the tool review) | Which of 50 known beacons got through | Proof the browser blocks what it claims | Already planned. |

### Pro web — deep, persistent, batch (justifies the subdomain)

| Tool | What it adds over free | Persistence without accounts |
|---|---|---|
| **Site-wide tracker crawl + monthly diff** | Whole site, not one URL; "you added 3 trackers since last scan"; exportable report | Results cached server-side per domain (public data), history keyed by domain — no user record needed |
| **Exposure Dashboard** | All checks in one place with history | **Local-first:** IndexedDB in the browser, export/import JSON. No accounts, no DB, fully on-brand. |
| **Bulk Link Cleaner** | Paste a list / a whole newsletter → all links unwrapped and cleaned | Client-side batch |
| **Fingerprint drift log** | Re-run on a schedule, alert on change | Local-first |

### In-app Pro (the subscription the website sells)

Unchanged from the tool review, but now with the *website's job* stated: Leak Monitor (ships with VPN — the one specific promise), Tracker Live, Fingerprint Watch, Auto-Strip Uploads, Link Guard. **The website's S2–S4 exist to make people want these; S6–S7 in the app close the sale.**

### Explicitly not building

Anything needing HIBP / Safe Browsing / Dehashed / LLM-at-runtime (constraint), and anything that needs accounts or a database while the gate is deferred. Local-first persistence covers the Pro web cases above without either.

---

## 5. The growth loops, named

1. **Proof → share → search.** Scorecards and site report cards get posted; each post is a landing page for someone else's S1.
2. **Report cards → press.** "Which news sites track you most" is a story every quarter; the pages are the source.
3. **Embed → backlinks.** The exposure widget puts our brand and a link on other people's pages.
4. **Install referrer → in-app continuity → Pro.** Not viral, but it's the loop that turns the other three into revenue, and it's the only one that needs the app team.

---

## 6. Sequence

| Week | Ship | Proves |
|---|---|---|
| 1 | §2 instrumentation + §3 #1–3 (referrer, result-moment CTA, desktop hand-off) | desktop/mobile split; `result_shown → cta_click` per tool; first attributed installs |
| 2 | Shareable scorecard (#4) + Link Unwrapper | first organic share landings |
| 3–4 | Site Privacy Report Card pilot: top 100 domains | search + share traction of the biggest bet |
| App team, parallel | Read the install referrer; open on the originating check; Leak Monitor with the VPN | S6/S7 — the story that sells Pro |
| Later | Email pixel detector, screenshot checker, embed widget, Pro web deep versions (local-first) | |

**Decision for you:** the Site Privacy Report Card is a real product bet (curation + a batch job + hundreds of new indexed pages). Everything else in weeks 1–2 is small and I'd just ship it. Green-light the report card, or hold it until week-1 data says the funnel converts at all?
