# Privacy Resources — Launch-Readiness Brief

**For:** Technical CEO review
**Status:** All must-fix items shipped. Production deploy is gated on dashboard
configuration only — no remaining code work for launch.

## Current status snapshot

| Must-fix item | Status |
|---|---|
| Distributed rate limit (Redis-backed) | ✅ **SHIPPED + VERIFIED.** Empirical test: 30 parallel requests → clean 10/20 split. |
| Subnet-bucket rate limiting (defeats VPN/CGN IP rotation) | ✅ **SHIPPED.** Rate limit keys are now /24 (IPv4) or /64 (IPv6) instead of exact IP. |
| Security headers — Vercel API + server-rendered pages | ✅ **SHIPPED.** CSP, HSTS, Permissions-Policy, COOP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy. Configured in `next.config.ts`. |
| Security headers — WordPress static deploy | ✅ **SHIPPED.** `.htaccess` config documented in `HEADERS-WP.md` for the WP admin to apply at deploy time. |
| Env-var tuning knobs + panic-mode config | ✅ **SHIPPED.** All rate limits, PoW difficulty, body caps configurable via Vercel env vars. Panic-mode values documented. |
| Observability + Vercel Firewall runbook | ✅ **DOCUMENTED.** `OPS-RUNBOOK.md` covers alert configuration, HMAC rotation, incident response, kill-switch options. |

**Remaining work to launch:** dashboard configuration only — no code changes.
Estimated ~45 min once DNS propagates. Full checklist in `OPS-RUNBOOK.md` § 7.

---

## What we're shipping

A 605-page programmatic SEO content site (`incognitobrowser.io/resources/`) plus 12 interactive privacy tools. Architecture:

- **Static HTML** served from WordPress at `/resources/` subdirectory (one-line `.htaccess` rule routes around WP).
- **One server endpoint** on Vercel (`/scan-url` + `/challenge`) powering the cookie scanner tool. Every other tool runs 100% in the browser.
- **Zero new cloud providers** — Vercel and WordPress only.

604 of 605 pages have no server dependency at all. The attack surface is the one Vercel endpoint.

---

## Current security posture (what's already in place)

| Layer | Status |
|---|---|
| Strict Origin allowlist (env-configurable) | ✅ Live, returns 403 for non-allowed origins |
| Altcha proof-of-work + HMAC-signed tokens | ✅ Every `/scan-url` call costs ~200ms CPU; tokens expire in 90s |
| SSRF protection | ✅ Blocks RFC1918, link-local, cloud metadata endpoints |
| Body / cookie / regex caps | ✅ 5MB body, 100 cookies, 500 regex iterations |
| Redirect rejection | ✅ 3xx responses return 400 (no silent SSRF-by-redirect) |
| Per-IP rate limit | ⚠️ **In-memory only — leaky on Vercel's multi-instance runtime** |
| 353 automated tests | ✅ Block deploys on regression |

We have a defensible application-layer posture. The infrastructure-layer gaps are the launch blockers.

---

## Gaps blocking a 9M-user launch

### ✅ 1. Distributed rate limit — SHIPPED + VERIFIED

**Problem (pre-fix):** in-memory `Map`-backed rate limit failed under concurrent
load. Verified empirically: 30 parallel curl requests from one IP got **0/30
rate-limited** because Vercel auto-scales fresh function instances and each
instance starts its in-memory counter at zero. Effective limit was
`10 × warm-instance-count` instead of the intended `10/min/IP`.

**Fix:** rate limiter now uses Vercel Redis with atomic `INCR` and fixed-window
keys (`rl:<ip>:<windowId>` where `windowId = floor(now / windowMs)`). The
counter is shared across all instances, so the limit is enforced globally.

**Verification:**
- Sequential test: 9/8/7/... clean linear decrement, then 429s ✅
- Concurrent test: 30 parallel requests → 10 × 401 + 20 × 429 ✅

The PoW continues to provide per-request cost defense; the rate limit now
provides per-IP pacing as a second layer.

### 🔴 2. No HTTP security headers

Currently sending no CSP, HSTS, Permissions-Policy, COOP, COEP, or X-Frame-Options on either the API or the static site. CSP alone prevents ~80% of XSS exploit chains. For a marketing site that gets attacked, this is table stakes.

**Fix:** Next.js middleware for the API + WordPress `.htaccess` headers for the static site. ~2 hours.

### 🔴 3. No abuse monitoring or alerting

If we get attacked at 2 AM, no one will know until users complain in the morning. No threshold alerts on 4xx/5xx spikes, no anomaly baselines, no log aggregation.

**Fix:** Vercel's built-in observability has email/Slack alert routing. Configure threshold alerts for 4xx spike, 5xx spike, function timeouts, latency p95. ~30 min, no new providers.

### 🔴 4. Tuning knobs are hardcoded

Under active attack we'd want to:
- Crank PoW difficulty from 100k to 1M+ (makes each request 10× more expensive for attackers, ~2s for real users — acceptable temporarily)
- Tighten rate limit from 10/min to 2/min
- Reduce body cap

All these values are hardcoded in source today. Means we'd need a code change + deploy mid-incident.

**Fix:** Move PoW difficulty, rate-limit thresholds, body caps to env vars. Document the "panic mode" config in a runbook. ~30 min.

### 🔴 5. Vercel Firewall not enabled

We're on Vercel and the WAF / Bot Fight features are included on the Pro plan ($20/mo). This catches layer-7 attacks at the edge before they hit our function. Currently disabled.

**Fix:** Toggle on in Vercel dashboard. 5 minutes. Already paid for.

---

## Should-have (not strictly launch-blocking)

| Item | Effort | Value |
|---|---|---|
| `/.well-known/security.txt` (RFC 9116) | 10 min | Researchers report vulns to us privately instead of disclosing publicly |
| GitHub Actions security scan (`npm audit`, OWASP ZAP baseline) on every push | 30 min | Catches new CVEs before they ship |
| HMAC key rotation runbook | 20 min | When (not if) the key needs rotating, the on-call person has the steps |
| IP-block flow documentation | 15 min | When abuse hits, where to click |
| Synthetic monitoring from 3rd-party probe | 30 min | Catches regressions and outages independent of our own infra |
| **External pen test** | 1–2 weeks, $3–10k | Standard for a 9M-user product. Should happen, but post-launch is acceptable. |

---

## Recommended path

**Remaining dev work: ~3 hours.** Item 1 below is shipped (commit `7dea31b`)
and just needs Vercel-dashboard enablement.

1. ✅ Vercel KV-backed rate limit — **CODE COMPLETE.** Needs:
    a. Enable KV in Vercel dashboard (Storage → Create → KV) — 2 min
    b. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
    c. Redeploy — 60 sec
    d. Verify with parallel-attack curl test → should now block at request 11
2. Security headers — API + WordPress (2 hours)
3. Env-var tuning knobs + panic-mode config (30 min)
4. Observability alerts wired up (30 min)
5. Vercel Firewall toggle (5 min, dashboard-only)

Then the should-haves (~2 hours total) and finally the production cutover sequence (DNS + WP upload + sitemap submission, ~30 min).

### Revert path for the KV swap

If the CEO wants a different approach to rate limiting, the swap is in a
single isolated commit:

```bash
git revert 7dea31b
git push origin main
# Vercel auto-redeploys to in-memory rate-limit in ~60 sec
# The KV database in Vercel can sit unused or be deleted (free tier)
```

All other security work (Altcha PoW, Origin allowlist, HMAC tokens, SSRF
guards, body caps) is unaffected by the revert.

---

## What this brief recommends

1. ✅ **Approve enabling Vercel KV** (~5 min of dashboard work, free tier covers our volume). The KV-backed code is ready; this is the deployment step. Single biggest defense improvement.
2. ✅ **Approve the remaining ~3-hour must-fix block** (security headers, tuning knobs, observability). I'll execute, write tests, and report back.
3. ✅ **Approve enabling Vercel Firewall** ($20/mo if not already on Pro).
4. 🟡 **Schedule an external pen test.** Post-launch is fine, but earmark $3–10k and start vendor selection now.
5. 🟡 **Decide on observability stack.** Vercel's built-in is sufficient for launch. Datadog/Better Stack are upgrades, not requirements.

---

## What we are NOT recommending

- **Cloudflare in front of the API.** Per direction, no new providers. Vercel's edge + Vercel Firewall covers the same threats at the cost of $20/mo we may already pay.
- **Self-hosting the API on the DigitalOcean droplet.** Vercel's reliability and zero-ops are worth far more than the cost. The droplet is a test environment only.
- **Delaying launch until pen-test results.** Test should happen, but isn't a gate — the must-fix list above closes the obvious holes; the pen test finds the non-obvious ones.

---

## Risk acknowledgment

Even with all must-fixes shipped:

- A sufficiently determined attacker with budget can still abuse a public, no-auth API endpoint. We're not building Fort Knox; we're making abuse expensive enough that it's not worth the attacker's effort.
- The HMAC secret is a single point of failure. If it leaks, we rotate (instant invalidation, real users transparently recover via fresh challenge).
- 100% of attacks won't be stopped. The goal is: cost-per-attempt × volume > value-extracted. With must-fixes in place, that math works against the attacker.

---

## What changes if the CEO disagrees

Tell me which item(s) to drop or extend. The must-fix list is opinionated but each item can be argued separately. Cost/risk tradeoffs are documented above for each.

---

**Repo:** `github.com/davidshadrake-rl/incognitobrowser-pseo`
**Latest commit:** `ca0525c`
**Test environments:** DO droplet (WP-layered) + Vercel (API) + Cloudflare Pages (mirror)
**Test count:** 353 passing
