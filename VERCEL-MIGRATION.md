# Vercel migration — personal → company account

Moves the production Vercel project (the scanner API serving
`api.incognitobrowser.io`) from your personal Vercel account to the
company Vercel account.

## Approach

**Create new project on company account, swap DNS, then delete old.**

Not "Transfer Project" — that requires both source and destination to
be teams you own under the same login, and the env-var copy in that
flow is finicky. Build-it-side-by-side is safer:

1. New project deploys at a Vercel preview URL
2. Verify all 391 unit tests + scanner API endpoints work on the new URL
3. Move the `api.incognitobrowser.io` domain from old → new project
4. Delete the old project once stable

Total downtime: under 60 seconds during DNS / domain swap.

---

## Pre-migration inventory

You'll be re-creating these on the company account. Pull each value
from the **current** Vercel project before starting.

### Required environment variables

From `Settings → Environment Variables` on the current project:

| Variable | Where to copy from | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console | Or generate a NEW key on the company Anthropic account and revoke the old one (recommended — separates billing) |
| `ALTCHA_HMAC_KEY` | Current Vercel env | Long random string; can be regenerated, but doing so invalidates in-flight PoW challenges (~90s blast radius) |
| `REDIS_URL` | Current Vercel env | Format: `redis://default:<password>@<host>:6379`. Came from Vercel Marketplace → Redis |
| `ALLOWED_ORIGINS` | Current Vercel env | Comma-separated: `https://incognitobrowser.io,https://206-189-186-34.nip.io` |

### Tuning knobs (only set if non-default)

These are typically left unset (defaults are tuned for normal traffic):

```
SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_MS, MAX_URL_LENGTH,
MAX_BODY_SIZE_MB, MAX_COOKIES, MAX_SCRIPT_MATCHES,
MAX_THIRD_PARTY_DOMAINS, FETCH_TIMEOUT_MS,
CHALLENGE_RATE_LIMIT, CHALLENGE_RATE_WINDOW_MS,
POW_MAX_NUMBER, POW_TTL_SECONDS, DEBUG_ORIGINS
```

If any are set in panic mode, copy them too. Otherwise skip.

### Domain attached to current project

```
api.incognitobrowser.io  →  current Vercel project
```

DNS record (in your DNS provider — Cloudflare? Route53? GoDaddy?):
- Either a CNAME pointing at `cname.vercel-dns.com`, OR
- An A/AAAA record at Vercel's IPs (rare)

Find out which by running:
```bash
dig api.incognitobrowser.io
```

---

## Migration steps

### 0. Pre-flight: get access to the company Vercel team

- Confirm you're a member of the company Vercel team (`team:incognito-browser` or whatever the slug is)
- Confirm you can create projects there
- If using a company GitHub org as the source, confirm the company Vercel team has GitHub OAuth installed and can read the repo (the repo migration in `EC2-DEPLOY-PLAN.md` is a prerequisite if you're moving GitHub at the same time)

### 1. Create the new Vercel project

In the company Vercel team:

```
+ New Project
→ Import Git Repository
→ select github.com/<org>/incognitobrowser-pseo  (or current repo if not migrated yet)
→ Framework Preset: Next.js (auto-detected)
→ Root Directory: ./  (default)
→ Build & Output Settings: leave defaults — package.json's `next build` is correct
→ Environment Variables: paste all from the inventory above
→ Deploy
```

Don't attach a custom domain yet. Let Vercel give you a preview URL like
`incognitobrowser-pseo-<hash>.vercel.app`.

### 2. Verify the new deployment standalone

From this Mac:

```bash
cd "/Users/davidshadrake/Documents/Radius Labs/incognitobrowser pseo2.0/pseo"

# Swap the e2e:vercel script's target temporarily:
E2E_BASE_URL=https://<new-vercel-preview-url> npx playwright test

# Also verify the scanner API responds:
curl -sX POST https://<new-vercel-preview-url>/challenge \
  -H "Origin: https://incognitobrowser.io" \
  -H "Content-Type: application/json" \
  -d '{}'
# Expect: JSON challenge { algorithm, challenge, salt, signature, ... }
```

If the challenge endpoint returns 200 with valid JSON, the env vars
(ALTCHA_HMAC_KEY, ALLOWED_ORIGINS, REDIS_URL) all wired correctly.

### 3. Add the custom domain

On the new project:
```
Settings → Domains → Add → api.incognitobrowser.io
```

Vercel will say "Invalid Configuration" because the domain is still
pointed at the old project. That's expected — proceed.

### 4. Detach the domain from the OLD project FIRST

This is critical: a custom domain can only be attached to ONE Vercel
project across all of Vercel. You must remove it from the old project
before the new project can claim it.

On the OLD project:
```
Settings → Domains → api.incognitobrowser.io → Remove
```

The old project still serves at its `.vercel.app` URL but loses the
custom domain.

### 5. Re-add on the NEW project

Go back to the new project's Domains tab. Click "Refresh" on
`api.incognitobrowser.io`. Vercel will now claim it. SSL cert is
re-issued in 30-60 seconds.

### 6. Update DNS (if the CNAME target changed)

In most cases the CNAME stays at `cname.vercel-dns.com` regardless of
which Vercel account owns the domain — Vercel routes by domain ownership,
not by IP. Verify:

```bash
dig api.incognitobrowser.io CNAME +short
# Expected: cname.vercel-dns.com
```

If it's an A record at Vercel IPs, those IPs are the same too. No
DNS change is usually needed. The whole swap happens at Vercel's
control plane.

### 7. Smoke-test through the public domain

```bash
curl -sX POST https://api.incognitobrowser.io/challenge \
  -H "Origin: https://incognitobrowser.io" \
  -H "Content-Type: application/json" \
  -d '{}' | head
```

Expected: 200 OK + JSON challenge.

Run the full audit:
```bash
npm run test:pages:prod
npm run test:e2e:prod
```

### 8. Monitor for 24h

- Check Vercel logs on the new project for errors
- Confirm scanner API traffic is hitting the new project (Function
  invocations dashboard)
- Make sure Redis connection is stable (Logs → look for any
  reconnect storms)

### 9. Delete the old project

After 24-48 hours of clean operation:
```
Old Vercel project → Settings → Delete Project
```

This also stops billing on the old account.

---

## Gotchas / what could go wrong

| Scenario | What happens | Fix |
|---|---|---|
| Forget to remove domain from old project first | New project shows "Invalid Configuration" forever | Go remove it from old, then refresh on new |
| Redis URL is account-specific | New project can't connect to old Redis | Provision new Redis on company Vercel Marketplace; copy data (it's just rate-limit counters, can be empty) |
| Anthropic API key still on personal billing | New project works but bills the wrong account | Generate new key on company Anthropic account, revoke old |
| ALLOWED_ORIGINS missing the prod domain | Scanner API returns 403 from incognitobrowser.io | Add `https://incognitobrowser.io` to the comma-separated list |
| GitHub repo connection lost | Pushes don't trigger deploys | Re-connect in Project → Settings → Git |

---

## Rollback plan

If something breaks after the domain swap:

1. New project's Domains tab → remove `api.incognitobrowser.io`
2. Old project's Domains tab → re-add `api.incognitobrowser.io`
3. Vercel cert re-issues in ~30s; service restored

The old project keeps its env vars and code intact until you
deliberately delete it (step 9 above). So rollback is no-data-loss.

---

## What I can do for you

- Once the new project is created and the env vars are pasted in,
  give me the preview URL and I'll run the full audit against it
  (`PAGES_TEST_BASE_URL=<url> npm run test:pages` + e2e suite)
- After domain swap, I'll re-run `test:pages:prod` + `test:e2e:prod`
  to confirm the public surface is intact
- I can help debug 4xx/5xx responses if the env-var transfer missed
  something

## What you have to do yourself

- Creating the project in the company Vercel UI
- Pasting env vars (sensitive — I can't see your current values)
- Removing/re-adding the custom domain
- Confirming billing is on the company account

Total active time: ~10-15 minutes of clicking + 24h passive monitoring.
