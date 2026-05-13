# Privacy Resources — Launch-Readiness Brief

**For:** Technical CEO review
**Status:** Test environment validated. Not yet launch-ready for a 9M-user product under active threat. ~4 hours of focused work + Vercel Firewall toggle gets us there.
**Decision needed:** Approve the must-fix list below, or push back on specific items.

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

### 🔴 1. In-memory rate limit doesn't actually rate-limit

Verified empirically. 12 sequential curl requests, counter bounces 9 → 8 → 9 → 8 (different Vercel instances, each starting fresh).

**Real-world impact:** an attacker with a script gets `10 × (warm-instance-count)` requests/min/IP, easily 50–100/min. Add a botnet with rotating IPs and the rate limit is theatre.

**Fix:** swap `Map`-backed counter for Vercel KV. Provider-native, free tier covers 30k req/day. ~1 hour. Code already isolates the rate-limit module; swap is mechanical.

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

**Total dev work to close the launch-blockers: ~4 hours.** Order of execution doesn't matter much; each ships independently.

1. Vercel KV-backed rate limit (1 hour)
2. Security headers — API + WordPress (2 hours)
3. Env-var tuning knobs + panic-mode config (30 min)
4. Observability alerts wired up (30 min)
5. Vercel Firewall toggle (5 min, dashboard-only)

Then the should-haves (~2 hours total) and finally the production cutover sequence (DNS + WP upload + sitemap submission, ~30 min).

---

## What this brief recommends

1. ✅ **Approve the 4-hour must-fix block.** I'll execute, write tests for each, and report back when done.
2. ✅ **Approve enabling Vercel Firewall** ($20/mo if not already on Pro).
3. 🟡 **Schedule an external pen test.** Post-launch is fine, but earmark $3–10k and start vendor selection now.
4. 🟡 **Decide on observability stack.** Vercel's built-in is sufficient for launch. Datadog/Better Stack are upgrades, not requirements.

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
