# API Security Deployment Notes

This pass added three layers of defense to `/scan-url` on Vercel. You need to set
**one new env var** on Vercel before the next deploy, or every request to
`/challenge` will 503.

## What changed

1. **Strict Origin allowlist** (`lib/origin.ts`) — requests from any other Origin
   get a 403. Configurable via `ALLOWED_ORIGINS` env var.
2. **Altcha proof-of-work** (`lib/altcha.ts` + `/challenge` endpoint) — every
   `/scan-url` call now requires a fresh signed PoW token. The browser spends
   ~50–300ms computing a SHA-256 puzzle before each scan. Scripted abuse becomes
   expensive.
3. **HMAC-signed tokens** — challenge replies are signed with a server secret.
   Forging a valid token requires the secret. Tokens expire after 90 seconds.

These stack on top of what was already there: per-IP rate limiting (10/min on
`/scan-url`, 30/min on `/challenge`), SSRF protection, body/cookie/regex caps.

## Env vars to set on Vercel

Go to Vercel dashboard → your project → **Settings → Environment Variables**.

### Required

| Name | Value | Notes |
|---|---|---|
| `ALTCHA_HMAC_KEY` | Random 32+ char hex string | Generate with: `openssl rand -hex 32`. Never commit this. Without it, `/challenge` returns 503 and `/scan-url` rejects all requests. |

### Strongly recommended (production)

| Name | Value | Notes |
|---|---|---|
| `REDIS_URL` | Auto-set when you enable Vercel Redis | Without this, rate limit falls back to per-instance in-memory mode — **proven leaky under concurrent attack** (verified: 30 parallel reqs → 0 blocked). With Redis, the counter is shared across all instances → global enforcement. |
| `ALLOWED_ORIGINS` | `https://incognitobrowser.io,https://www.incognitobrowser.io,https://lightshapesallthings.info` | Comma-separated. Include test/staging domains here. If unset, falls back to incognitobrowser.io family only. |

### Enabling Vercel Redis (one-time setup)

1. Vercel dashboard → project → **Storage** tab
2. **Create Database** → pick **Redis — Official Redis for Vercel** → name it `incognitobrowser-rate-limits` (or similar)
3. Vercel auto-injects `REDIS_URL` into your project's env vars across all environments (production, preview, dev)
4. Redeploy. The rate limiter auto-detects `REDIS_URL` is available and switches modes.
5. Verify: run the parallel-attack test (30 concurrent requests from one IP). Should now block at request 11 every time, regardless of how many instances are warm.

**Cost:** Free tier covers 30k commands/day. Each rate-limit check is 1 MULTI transaction = ~4 commands. At our scale (well under 100k API calls/day), we'll never approach the limit.

**Provider portability:** The implementation uses `ioredis` which speaks the standard Redis protocol. Any Redis (Vercel-managed, Upstash, AWS ElastiCache, self-hosted) works with the same `REDIS_URL` — no code change needed if you ever migrate.

### Local development

Add to `.env.local` (already gitignored) at the project root:

```
ALTCHA_HMAC_KEY=dev-only-secret-must-be-at-least-32-characters-long-xxxxx
ALLOWED_ORIGINS=http://localhost:3000,http://incognitobrowser-test.local
NEXT_PUBLIC_SCAN_API=http://localhost:3000
```

`NEXT_PUBLIC_SCAN_API` overrides where the client hits the API (default
`https://api.incognitobrowser.io`). Use it during local dev so the cookie
scanner tool talks to your local Next dev server instead of production.

## How a client uses it

The cookie scanner tool now does:

1. `GET /challenge` → server returns `{ algorithm, salt, challenge, maxnumber, signature, expires }`
2. Client brute-forces SHA-256(salt + n) for n in [0, maxnumber] until hash matches
3. Client POSTs `/scan-url` with `Authorization: Altcha <base64-json-solution>`
4. Server verifies HMAC signature, expiry, and that the number actually solves
   the puzzle → only then runs the scan

The client code lives in `components/tools/CookieAnalyzerTool.tsx` — the
`solveAltchaChallenge()` helper is also a good template for any future
endpoints that should be POW-gated.

## What this defends against

| Attack | Defense |
|---|---|
| Anonymous curl: `curl -X POST https://api.../scan-url -d '{"url":"..."}'` | Origin check rejects (no/wrong Origin header). |
| Spoofed Origin: `curl -H "Origin: https://incognitobrowser.io" ...` | Altcha check fails (no valid token). |
| Replayed solved token from a real browser | Per-IP rate limit + 90s TTL on tokens. |
| DDoS from one IP | Per-IP rate limit (10/min on scan, 30/min on challenge). |
| Distributed DDoS (botnet) | Each request costs ~100ms of CPU for the client — at any meaningful scale the attacker burns more compute than the server. Combined with rate limit, makes amplification negative-ROI. |
| Brute-force the HMAC key | Key is 32+ chars; would take longer than the heat death of the universe. |
| SSRF via crafted scan URLs | Existing `isBlockedHostname()` check (RFC1918, link-local, cloud metadata). |

## What this does NOT defend against

- A sophisticated attacker willing to spend CPU. Altcha is a speed bump, not a
  wall. If someone really wants to abuse the endpoint, they can. The goal is
  to make casual scripted abuse not worth the effort.
- A leaked `ALTCHA_HMAC_KEY`. If the secret leaks, rotate it. Old tokens
  become invalid immediately because verification uses the new secret.

## Rotating the secret

```bash
# Generate a new key
openssl rand -hex 32

# Set in Vercel dashboard
# Redeploy — old tokens immediately stop working
```

No need for a "graceful" rotation period; existing browser tabs will see a 401
on their next scan, fetch a fresh challenge, and recover transparently.

## Testing

Run the full suite: `npm run test` — 353 tests, includes 30 new tests in
`tests/api-security.test.ts` covering challenge generation, HMAC verification,
expiry windows, header parsing, and route-level wiring.
