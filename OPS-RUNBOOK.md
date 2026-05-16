# Operations Runbook

Dashboard-only setup steps for the security/observability layer, plus
incident-response playbooks. No code changes required — everything in this
doc is configured through Vercel's UI.

---

## 1. Enable Vercel Firewall (WAF)

Vercel Pro plan ($20/mo) includes a layer-7 firewall with WAF rules,
bot challenges, and rate limits at the edge — **before** requests hit our
function. Already-paid-for protection that's currently off.

### Setup

1. Vercel dashboard → **`incognitobrowser-pseo` project**
2. **Firewall** tab (or **Settings → Firewall** depending on UI version)
3. Toggle **Firewall** to **On**
4. Default rule set is fine. Optionally enable:
   - **Bot Fight Mode** — challenges known bot networks before they hit our function
   - **Geographic blocking** — only if you have a specific reason
   - **OWASP Core Rule Set** — adds SQL injection, XSS, etc. pattern blocks at the edge

### Verify it's working

Vercel Firewall dashboard shows a Requests-by-Action chart. Within 24 hours
you should see some traffic in the "Challenged" or "Logged" buckets — that's
bot scanning being caught before it reaches our code.

---

## 2. Configure alerting on 4xx/5xx spikes

### Setup

1. Vercel dashboard → project → **Observability** → **Logs**
2. Top right → **Drains** (or **Notifications** depending on UI version)
3. **Add log drain** → choose destination:
   - **Email** (simplest, no extra tools) — for the on-call address
   - **Slack incoming webhook** — for a #ops channel
   - **Datadog/Better Stack** — if you already use one
4. Filter the drain:
   - **Status code:** `>=400`
   - **Path:** include `/scan-url`, `/challenge`
   - **Threshold:** "more than 100/min sustained for 5 min"
5. Save

### Recommended alert thresholds

| Signal | Threshold | What it indicates |
|---|---|---|
| `429` from /scan-url | > 100/min sustained 5 min | Active abuse from many IPs (single IP would just keep hitting cap) |
| `403` from /scan-url | > 50/min sustained 5 min | Origin-bypass attempts (scripts/curl users) |
| `5xx` from /scan-url | > 10/min sustained 5 min | API is breaking — Redis down, or function crash |
| `401` from /scan-url | > 200/min sustained 10 min | Bot trying without PoW |
| Average response time | > 5s sustained 5 min | Backend slowdown — Redis lag, fetch timeouts |

---

## 3. HMAC key rotation runbook

The `ALTCHA_HMAC_KEY` env var signs every PoW token. If it leaks (logs spillage,
employee leaves, accidental commit), rotate immediately.

### Steps (5 minutes total)

1. Generate a new key locally:
   ```bash
   openssl rand -hex 32
   ```
   Copy the 64-char hex output.

2. Vercel dashboard → project → **Settings → Environment Variables**

3. Find `ALTCHA_HMAC_KEY` → **⋯ → Edit** → paste new value → **Save**

4. **Trigger redeploy:** Deployments tab → top deployment → **⋯ → Redeploy**

5. Wait ~60 seconds for the new deployment to go live.

### What users see during rotation

- Browser tabs currently solving a challenge from the old key: one failed
  scan attempt with a 401. Their next try fetches a fresh challenge signed
  with the new key — recovery is automatic, no user action needed.
- Total user impact: ~1 retry over a 30-second window. No data loss.

### Rotation schedule recommendation

Every 90 days, or immediately on any suspected leak. Set a calendar reminder.

---

## 4. Incident: "We're under attack"

If observability shows sustained `429` or `403` flood from many IPs:

### Step 1 — Activate panic-mode env vars (~2 minutes)

Vercel → Settings → Environment Variables → add or update each:

| Variable | Normal | Panic |
|---|---|---|
| `SCAN_RATE_LIMIT` | (unset, default 10) | `2` |
| `CHALLENGE_RATE_LIMIT` | (unset, default 30) | `5` |
| `POW_MAX_NUMBER` | (unset, default 100000) | `1000000` |
| `MAX_BODY_SIZE_MB` | (unset, default 5) | `1` |

Redeploy. New limits are live in ~60 seconds.

Effect:
- Each abuse request now costs the attacker ~2 seconds of CPU instead of 200ms
- Only 2 successful scans/min/IP-bucket get through
- 80% reduction in outbound bandwidth per abusive scan
- Real users see a slightly slower puzzle (~1-2s wait) but otherwise normal UX

### Step 2 — Block specific IPs at Vercel Firewall (if attack is concentrated)

Vercel → Firewall → **Add rule** → "Block" → IP/IP-range. Takes effect at edge,
before our function. Zero cost to the API.

### Step 3 — If still overwhelmed, kill switch

Vercel → Settings → **Pause Deployment**. This 503s every request until you
un-pause. Use only as a last resort — real users can't scan during this.

Better: temporarily set `ALLOWED_ORIGINS` to a single non-existent origin
(e.g., `https://maintenance.invalid`). API stops accepting all requests
without taking the entire deployment offline.

### Step 4 — After the incident

Once the attack subsides:
1. Delete the panic-mode env vars (defaults restore)
2. Remove the Firewall block rules (or convert to monitoring)
3. Restore `ALLOWED_ORIGINS` to the normal list
4. Redeploy
5. Document what you learned in this file

---

## 5. Suspected secret leak

If `ALTCHA_HMAC_KEY` or any other secret may have leaked:

1. **Rotate immediately** — don't wait for confirmation, just do it
2. **Check git history:** `git log --all --full-history --pickaxe-regex -S 'ALTCHA_HMAC_KEY'` — make sure the secret was never committed
3. **Check Vercel build logs** for the date range — has it been logged anywhere?
4. **Notify the team** in your usual channel — "rotated key X at $(date), reason: precaution"
5. **Update the rotation calendar** — bring the next rotation forward by 30 days

---

## 6. Vercel Redis is down

The rate limiter is designed to fail open: if Redis is unreachable, requests
get through (no rate limit enforced for the outage window). This is intentional
— we'd rather serve legit users than have a Redis outage take down the API.

But you want to know it happened:

### Detection

The diagnostic header we removed in `b72c6cf` no longer exposes Redis state.
To check Redis health on demand, the function logs every fallback:
```
[rate-limit] Redis unavailable, falling back to in-memory: <error>
```

This appears in Vercel function logs. Filter for `rate-limit` in the
observability dashboard.

### Response

If you see sustained Redis failures (more than a few per minute):

1. Vercel → Storage → Redis instance → **Status**. Is Vercel showing an
   outage on the Redis service?
2. If yes, wait for Vercel to restore (their issue).
3. If no, check the connection string:
   - Settings → Environment Variables → `REDIS_URL`
   - Was it rotated, removed, or changed recently?
4. Worst case, recreate the Redis instance:
   - Storage tab → delete the old → create new → Vercel auto-injects fresh `REDIS_URL` → redeploy

During the outage, rate limit is per-instance only (the leak we just fixed
reappears temporarily). The PoW still protects against scripted abuse —
the attacker still pays CPU per request — so the API isn't undefended.

---

## 7. Production cutover checklist

When ready to deploy `/resources/` to `incognitobrowser.io`:

- [ ] Set `ALLOWED_ORIGINS` on Vercel to include `https://incognitobrowser.io,https://www.incognitobrowser.io`
- [ ] Confirm `ALTCHA_HMAC_KEY` is set on Vercel (Production env)
- [ ] Confirm `REDIS_URL` is set on Vercel (Production env)
- [ ] Wire `api.incognitobrowser.io` DNS → CNAME `cname.vercel-dns.com`
- [ ] Add `api.incognitobrowser.io` as a custom domain in the Vercel project
- [ ] Wait for SSL provisioning (~5 min after DNS resolves)
- [ ] Test: `curl -sI https://api.incognitobrowser.io/challenge -H "Origin: https://incognitobrowser.io"` should return JSON
- [ ] Build static site: `npm run build:static`
- [ ] Upload `out/` to WordPress: `rsync -avz --delete out/ user@incognitobrowser.io:~/public_html/resources/`
- [ ] Add `.htaccess` routing rule (see DEPLOYMENT.md)
- [ ] Add `.htaccess` security headers (see HEADERS-WP.md)
- [ ] Visit `https://incognitobrowser.io/resources/` — should load
- [ ] Test scanner end-to-end on prod URL
- [ ] Submit `https://incognitobrowser.io/resources/sitemap.xml` to Google Search Console
- [ ] Enable Vercel Firewall (this runbook, section 1)
- [ ] Configure observability alerts (this runbook, section 2)
- [ ] Set calendar reminder: rotate HMAC key every 90 days

Estimated total time: ~45 min once DNS propagates.
