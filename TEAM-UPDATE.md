# Privacy Resources — Engineering Update

**Status:** Test environment live. Production-ready pending DNS cutover + sitemap submission.

## TL;DR

The Privacy Resources site (the 605-page programmatic SEO content layered under
`incognitobrowser.io/resources/`) is built, tested, and deployed to a staging
environment. The architecture cleanly separates the static content (servable
from WordPress, zero ongoing infrastructure cost) from a single hardened
serverless endpoint on Vercel that powers the cookie scanner. Everything is
covered by 353 automated tests. Security review feedback has been implemented.

---

## What's Live

### 1. Static content site — 605 pages

- 44 privacy "topic hubs" (niche aggregation pages)
- 264 niche-level index pages (e.g. `/checklists/ai-privacy/`, `/tools/data-breach/`)
- ~300 detail pages across 6 content types: guides, checklists, comparisons, tools, calculators, templates
- Glossary, sitemap.xml, RSS-equivalent metadata feeds
- Full hub-and-spoke internal linking: every page links to related content across content types and niches (resolves the "orphan page" problem common to large pSEO sites)

### 2. Interactive privacy tools — 12 tools, all client-side

Fully rebuilt/audited this week. All run in the user's browser; only the
cookie scanner makes a server call (for fetching the target site's headers).

| Tool | What it does |
|---|---|
| Password Strength Checker | Entropy + crack time + pattern detection |
| Secure Password Generator | CSPRNG passwords/passphrases/PINs with unbiased sampling |
| Browser Privacy Audit | 14 checks incl. WebRTC leak test, canvas/audio fingerprint hashing |
| Cookie & Tracker Scanner | Server-fetched site analysis with 40+ tracker signatures |
| Hash Generator | SHA-1/256/384/512 + HMAC, drag-drop, binary-safe |
| Text/File Encryption | AES-256-GCM, PBKDF2 600k iterations (OWASP 2023 spec) |
| URL Safety Checker | Typosquat detection, IDN homograph flagging, visual breakdown |
| Image Metadata Viewer | EXIF/GPS extraction with strip-and-download |
| User Agent Analyzer | Classic UA parse + Client Hints (Chrome's next-gen fingerprinting surface) |
| Permission Checker | Audits camera/mic/geo/clipboard permissions + revoke instructions |
| Privacy Score Quiz | Impact-ranked recommendations + shareable URL hash for results |
| Cookie Privacy Scanner | Real-time third-party flag + CSV compliance export |

### 3. Cookie Scanner API — on Vercel

The one piece that needs server-side execution. Deployed to Vercel with the
defense layers below.

---

## Security Stack (in response to security review)

Three independent gates, plus existing protections:

| Layer | What it does | Defends against |
|---|---|---|
| **Strict Origin allowlist** | Rejects requests whose `Origin` header isn't in the configured list. Env-configurable via `ALLOWED_ORIGINS`. | Casual curl abuse, third-party sites embedding our API |
| **Altcha Proof-of-Work** | Client must solve a SHA-256 puzzle (~200–500ms CPU) before each scan. New `/challenge` endpoint issues signed challenges; `/scan-url` validates them. | Scripted/automated abuse — makes amplification negative-ROI |
| **HMAC-signed tokens** | Challenges are signed with a server secret (`ALTCHA_HMAC_KEY`). Solutions are verified server-side before any scan runs. Tokens expire in 90 seconds. | Token forgery, replay attacks (TTL-bounded) |
| Per-IP rate limit | 10 req/min on `/scan-url`, 30 req/min on `/challenge` | DDoS from single IP |
| SSRF protection | Blocks RFC1918, link-local, carrier-grade NAT, cloud metadata endpoints (AWS/GCP/Azure) | API used as internal network probe |
| Body / cookie / regex caps | 5 MB response cap, 100 cookies max, 500 regex iterations max | Memory exhaustion, ReDoS, hostile servers |
| Redirect rejection | 3xx responses return 400 instead of silent empty body | SSRF-by-redirect, misleading scan results |

**Threat model coverage** (from the security review):

> "Anyone can write simple scripts in various ways to discover and abuse the API endpoints"

A scripted attacker now has to:

1. Send the correct `Origin` header (easy to spoof)
2. Burn ~200ms of CPU per request to solve a fresh PoW (not easy to skip)
3. Stay under 10 requests/minute per IP (rate limit)
4. The PoW token expires in 90s and can't be precomputed (server-side randomness in the signed challenge)

Combined cost per attempt makes amplification unprofitable. Not unbreakable —
sufficiently determined attackers can brute-force the PoW. But casual abuse
goes from "trivial" to "engineering project that costs more than the abuser
saves." For a public, no-signup tool, that's the right trade-off.

---

## Architecture

```
                ┌─────────────────────────────────────────┐
                │  incognitobrowser.io  (WordPress)       │
  Visitor ────► │  /resources/...        ← static HTML    │
                │  /wp-admin, /blog/...  ← WordPress      │
                │  (one-line .htaccess rule routes        │
                │   /resources/* directly to filesystem,  │
                │   bypassing PHP)                        │
                └────────────────┬────────────────────────┘
                                 │ Cookie Scanner only
                                 │ (other 11 tools run 100% in-browser)
                                 ▼
                ┌─────────────────────────────────────────┐
                │  api.incognitobrowser.io  (Vercel)      │
                │  POST /challenge  → PoW challenge       │
                │  POST /scan-url   → scan + return data  │
                │  Strictly origin-locked + PoW-gated     │
                └─────────────────────────────────────────┘
```

**Deployment targets supported by a single codebase:**

| Target | Build command | Purpose |
|---|---|---|
| WordPress at `/resources/` | `BUILD_TARGET=static npm run build:static` | Production. Static HTML uploaded to WP server. |
| Cloudflare Pages (root) | Same build + `BASE_PATH=""` env var | Mirror site, zero-config CDN deploy. |
| Vercel (server mode) | Default `npm run build` | The scanner API. Server routes execute; static pages also build. |
| Local dev | `npm run dev` | Localhost. `NEXT_PUBLIC_SCAN_API` lets the client point at a local dev server. |

This dual-target setup means **the production site doesn't depend on Vercel
for any page render**. If Vercel goes down, 604 of 605 pages keep working
from WordPress; only the cookie scanner degrades.

---

## Test Coverage

**353 automated tests, integrated into the build pipeline** (every `npm run build` runs them first).

| Suite | Tests | Covers |
|---|---|---|
| Template substitution | 187 | Every template's JSON file is fully fillable, orphan-token synthesis works |
| API security | 30 | Altcha challenge generation, HMAC verification, expiry windows, header parsing, origin allowlist, route-level wiring |
| Resource bounds | 13 | Response body cap, cookie array cap, script regex cap, redirect rejection |
| CORS security | 10 | Origin enforcement, no wildcard, security headers, Vary header |
| Input validation | 25 | URL length, protocol, port, redirect, file upload limits |
| XSS protection | 12 | dangerouslySetInnerHTML audit, eval/innerHTML scans, unicode escapes |
| SSRF protection | 30+ | Private IP blocking across IPv4/IPv6, cloud metadata, link-local, carrier-grade NAT |
| Error handling | 8 | No stack trace leakage, generic client messages |
| JSON-LD injection | 6 | `<` escaping prevents `</script>` injection |
| Rate limit | 10 | Enforcement, headers, per-IP isolation, window expiry |

A failing test in any category breaks the build — can't ship broken security.

---

## Test Environment

| URL | Hosts | Purpose |
|---|---|---|
| `http://206.189.186.34/` (DigitalOcean droplet) | WordPress + static `/resources/` | Realistic pre-prod environment with the actual WordPress integration |
| `https://incognitobrowser-pseo.vercel.app/` | Static pages + API | Cloudflare-style CDN deploy of the same content |
| `https://incognitobrowser-test.late-dew-d27b.workers.dev/` | Cloudflare Pages static-only | Backup mirror, tests static bundle in isolation |

The droplet ($6/mo, throwaway) was the most important validation: it confirms
that the one-line `.htaccess` rule cleanly bypasses WordPress for the
`/resources/` subdirectory, with zero impact on the rest of the WP site. That
de-risks the production deploy substantially.

---

## What's Next (Pending Production)

| Task | Owner | Effort |
|---|---|---|
| Wire `api.incognitobrowser.io` DNS → Vercel CNAME | DNS owner | 5 min |
| Add `ALLOWED_ORIGINS` in production with the live domain | Vercel admin | 2 min |
| Upload `out/` bundle to `incognitobrowser.io/resources/` | WP admin | rsync command, ~5 min |
| Add the `.htaccess` rewrite rule on prod | WP admin | 1 line, copy from droplet config |
| Submit `https://incognitobrowser.io/resources/sitemap.xml` to Google Search Console | Marketing/SEO | 5 min |
| Spot-check 5–10 pages on production after deploy | QA / Eng | 15 min |

Total deploy time once authorized: **~30 minutes of human work + DNS propagation wait**.

---

## Files for Reference (in the repo)

- `SECURITY-DEPLOY.md` — full security architecture + env var setup
- `DEPLOYMENT.md` — WP deploy walkthrough with .htaccess config
- `README.md` — project overview + content types table

Repo: `github.com/davidshadrake-rl/incognitobrowser-pseo`
Current main branch: `5663c95` (latest commit)
