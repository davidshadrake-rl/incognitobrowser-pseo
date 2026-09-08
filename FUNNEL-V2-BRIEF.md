# Funnel V2 — Brief

Full detail, copy matrix, and app-team spec: FUNNEL-V2.md. This is the short version.

## What's already shipped (commit 495024a)

Every tool now reports its own result (score, grade, severity) to a shared "result bus." That feeds three things automatically, on every tool page and every report card:

- **Result-moment CTA** — copy changes by how bad the result is and which privacy niche the visitor came from ("your real IP is visible" vs. "this site tracks you before you click"). Android visitors go straight to Play; desktop visitors get email-me-the-link / copy-link, since Pro is bought inside the Android app.
- **Shareable scorecard** — a PNG drawn on the visitor's own device (nothing uploaded), with native share-sheet support on Android.
- **"What to do now"** — three concrete steps pulled from the matching privacy checklist, so a visitor who ran one tool has a reason to do two more things before leaving.
- **"Check yours now"** — every one of the 1,283 non-tool pages (guides, checklists, comparisons, etc.) now links to a free tool relevant to that page's topic, so content pages aren't dead ends.
- Five new free tools that produce shareable results: Link Unwrapper, Email Pixel Detector, Screenshot Leak Checker, DNS Leak Test (works once infra below is live), Ad-Blocker Test.
- First-party event counters (`/event`), so once Redis is on, you'll see click-through rates by tool and severity.

## The verdict, one paragraph

The money is a Pro subscription sold inside an Android app that 9M people already have. The website's job is to produce proof of exposure and hand off cleanly: Android users go straight to the Play Store with an attributed link; desktop users get a hand-off (send-to-phone) because they can't buy on the spot. The free app's existing users are the cheapest possible conversion — once the app team wires a few hooks (below), they see the same check-up in-app with a direct Pro deep link, no install step at all.

## Two populations, one loop

- **Web search visitors** (mostly desktop, hypothesis): land on a page → get routed to a proof tool → see their own exposure → get the ask, sized to severity → share the result or install the app.
- **Existing free-app users** (9M): the real prize. Once the app can identify itself to the website, the same check-up runs inside the app and the ask becomes a direct in-app Pro purchase — no install friction at all.

## What the app team needs to ship (ranked)

1. Identify the app to the website (one line in the WebView user-agent or a URL param).
2. A deep link that opens the Pro purchase sheet directly, with a reason code (which check failed).
3. Post purchase and paywall-view counts back to `/event` so we can measure what's converting.
4. A "Privacy Check-up" entry point in the app's menu / new-tab page.

None of this is built yet — it's the single highest-leverage ask in the whole document.

## Not yet built (website side)

- The composite "run all 5 checks in one place" hub page.
- Pre-rendered share-landing pages (so a shared link unfurls with the right preview image everywhere).
- QR-code hand-off for desktop visitors.
- Public stats page ("we count clicks, not people," visible proof).

## What's needed before the DNS Leak Test goes live

Requires a small droplet running an authoritative nameserver plus a DNS delegation from wherever incognitobrowser.io is hosted. Until that's done, the tool honestly reports "inconclusive" rather than faking a result.

## Decisions still open

- Redis (see separate note) — needed for the event counters to actually persist.
- Whether to build the composite check-up hub next, or prioritize the app-team hooks first (the app hooks unlock the bigger population).
