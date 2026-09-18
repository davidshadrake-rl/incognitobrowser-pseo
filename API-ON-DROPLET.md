# The API on the droplet

Owner, 2026-09-18: **Vercel is being removed entirely and the account closed.**
This is the runbook that replaces it. It supersedes the old `OPS-RUNBOOK.md`
and `SECURITY-DEPLOY.md`, both of which described Vercel dashboard settings.

## Why there is a server at all

The site itself is a static export and needs no server. Seven routes do:

| Route | Used by | Breaks without it |
|---|---|---|
| `/challenge`, `/scan-url` | Cookie & Tracker Scanner, URL-scan mode | The flagship Pro tool, and the CSV gate that sits on it |
| `/ip` | What's My IP | The whole tool |
| `/dns-leak/start`, `/dns-leak/result` | DNS Leak Test | The whole tool |
| `/event` | `lib/track.ts` on every page | All measurement, silently |
| `/stats` | `scripts/funnels/stats.ts` | The stats read-out |

They are Next.js route handlers needing a Node runtime, which a static export
cannot provide. Until now they ran on Vercel, which is why the droplet's own
JavaScript called `incognitobrowser-pseo.vercel.app` — a live dependency on the
one platform this project is not supposed to use.

## The shape

One Node process on the droplet, listening on localhost only. Apache (already
serving :80/:443) reverse-proxies the seven API paths to it. Everything else
stays exactly as it is: static files, rsync'd by `scripts/deploy.sh`.

```
browser ──▶ Apache :443 ─┬─▶ /resources/*      static files on disk (unchanged)
                         ├─▶ /resources-pro/*  static files on disk (unchanged)
                         └─▶ /challenge, /scan-url, /ip, /event,
                             /dns-leak/*, /stats  ──▶ Node on 127.0.0.1:3100
```

Because the API is then on the **same origin** as the pages, two things get
simpler and safer than they were on Vercel: CORS disappears entirely, and the
CSP tightens to `connect-src 'self'` (`next.config.ts`).

**This droplet also runs MySQL and WordPress. Nothing in this runbook touches
either.** The Apache change is additive — one new `<Location>` block. Take a
copy of the vhost before editing it.

## What is already done, in the repo

- `next.config.ts` — `NEXT_PUBLIC_SCAN_API` now defaults to `""` (same-origin) in
  both modes; CSP `connect-src` is `'self'`.
- `lib/tiers.ts` — the `PRO_BASE_URL` / `FREE_BASE_URL` fallbacks point at the
  droplet, not Vercel.
- `app/ip/route.ts` — geo now reads vendor-neutral `x-geo-*` headers. Nothing
  sets them yet, so geo fields come back `null` and the UI hides them, exactly
  as it already did on localhost. The IP answer itself is unaffected.
- Deleted: `vercel.json`, `scripts/vercel-ignore.sh`, `tests/vercel-ignore.test.ts`,
  `scripts/deploy-prod-bitnami.sh` (a live WordPress/AWS deploy path),
  `CUTOVER-EC2.md`, and the `test:e2e:vercel` npm script.

## Status: done, 2026-09-18

All of the below was carried out and verified on the live droplet. Kept as the
record of what was changed, and as the procedure to repeat if the box is ever
rebuilt.

Verified working through Apache after cutover:
`/api/ip` returns the caller's real address · `/api/challenge` issues a valid
ALTCHA challenge · `/api/event` returns 202 and Redis holds the counters ·
What's My IP, and the Cookie & Tracker Scanner in URL mode, both return real
results in a browser · WordPress and both static sites still serve 200.

**The API is namespaced under `/api/`**, not proxied at the root as originally
drafted. This DocumentRoot is a WordPress install, and a root-level proxy for
`/ip`, `/event` or `/stats` would silently shadow any permalink WordPress adds
at those paths later. One rule instead of six.

## Steps on the droplet

Run as a user with sudo. Nothing here restarts MySQL or touches WordPress.

### 1. Redis

Needed for the DNS leak test to work at all (`lib/dns-leak-store.ts` returns
`'none'` without it) and for `/event` counters to survive a restart. Rate
limiting has an in-memory fallback, which is fine on a single process — the
"proven leaky under concurrent attack" warning in the old docs was about
Vercel's many parallel instances, which no longer applies.

```bash
sudo apt-get update && sudo apt-get install -y redis-server
sudo sed -i 's/^# *maxmemory .*/maxmemory 256mb/; s/^# *maxmemory-policy .*/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
sudo systemctl enable --now redis-server
redis-cli ping   # expect PONG
```

Redis binds to 127.0.0.1 by default on Ubuntu. Leave it that way.

### 2. The API service

Build the **server-mode** bundle (not the static export) and run it:

```bash
sudo install -d -o www-data -g www-data /opt/ib-api
# deploy the repo there, then as www-data:
npm ci --omit=dev
npm run build          # server mode: do NOT set BUILD_TARGET=static
```

`/etc/ib-api.env`, readable only by root and www-data:

```ini
PORT=3100
HOSTNAME=127.0.0.1
REDIS_URL=redis://127.0.0.1:6379
ALTCHA_HMAC_KEY=<generate: openssl rand -hex 32>
STATS_TOKEN=<generate: openssl rand -hex 32>
ALLOWED_ORIGINS=https://206-189-186-34.nip.io
NEXT_PUBLIC_DNSLEAK_ZONE=<the DNS zone, unchanged>
```

`ALTCHA_HMAC_KEY` and `STATS_TOKEN` are secrets: generate fresh ones, do not
reuse whatever Vercel held. `ALLOWED_ORIGINS` must list every origin the pages
are served from, or the scanner returns a CORS network error.

`/etc/systemd/system/ib-api.service`:

```ini
[Unit]
Description=Incognito Browser tools API
After=network.target redis-server.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ib-api
EnvironmentFile=/etc/ib-api.env
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3100 -H 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ib-api
curl -s -X POST localhost:3100/ip -H 'content-type: application/json' -d '{}'
```

### 3. Apache

```bash
sudo a2enmod proxy proxy_http headers
sudo cp /etc/apache2/sites-available/<the-vhost>.conf ~/vhost-backup-$(date +%F).conf
```

Inside the `:443` vhost (`000-default-le-ssl.conf`), before `</VirtualHost>`.
The trailing slashes strip the prefix, so `/api/challenge` reaches the service
as `/challenge`:

```apache
<IfModule mod_proxy.c>
  ProxyPreserveHost On
  ProxyPass        /api/  http://127.0.0.1:3100/  retry=0 timeout=30
  ProxyPassReverse /api/  http://127.0.0.1:3100/
</IfModule>
```

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

`configtest` before reload, every time. A syntax error takes WordPress down
with it.

### 4. Cut over and verify

Only after the three steps above answer correctly:

```bash
npm run deploy            # ships the same-origin build
curl -s -X POST https://206-189-186-34.nip.io/ip -H 'content-type: application/json' -d '{}'
curl -sk https://206-189-186-34.nip.io/resources/_next/static/chunks/*.js | grep -c vercel   # expect 0
```

Then in a browser, on the live site: run the Cookie & Tracker Scanner in URL
mode, run the DNS Leak Test, and load What's My IP. All three must return real
results, not a network error.

## Rolling back

`sudo systemctl stop ib-api` and remove the proxy block. The static site keeps
serving; the three server-backed tools go back to failing. There is no Vercel
to fall back to once the account is closed, so verify before cutting over.

## Outstanding: the DNS leak test's nameserver

The DNS leak test's **server routes migrated fine** — `/api/dns-leak/start`
creates its record in the new Redis, and `/api/dns-leak/result` answers. But the
test reports *"inconclusive — no DNS query reached our nameserver"*, and it will
keep doing so, because the other half has never existed in DNS:

```
$ dig +short NS  dnsleak.incognitobrowser.io   # (empty)
$ dig +short SOA dnsleak.incognitobrowser.io   # (empty)
$ dig +short NS  incognitobrowser.io           # ns-575.awsdns-07.net. …
```

The parent zone resolves; the `dnsleak` subdomain has no NS and no SOA, so no
resolver can ever reach a nameserver for it. **This is pre-existing and not
caused by the move** — it would have been inconclusive on the old platform too.

To make the test work, all three must be true at once:
1. `scripts/dnsleak-server.mjs` runs somewhere reachable on UDP 53,
2. `dnsleak.incognitobrowser.io` is delegated to it with an NS record, and
3. it writes to the *same* Redis the API reads — now `redis://127.0.0.1:6379`
   on this droplet, so it most naturally runs here too.

Step 2 means editing DNS for `incognitobrowser.io`, whose nameservers are AWS
Route 53. That is a DNS record change, not the AWS compute that is off limits —
but it is the owner's call, so nothing here touches it.

## What is deliberately not carried over

- **The Vercel WAF / firewall rules** from the old `OPS-RUNBOOK.md`. Apache has
  no equivalent configured. If rate limiting at the edge matters, that is a
  separate decision — the app's own per-IP limiter still runs.
- **Geo lookup.** Vercel injected `x-vercel-ip-*`. Nothing replaces it today, so
  What's My IP shows the address without city/region/country. To restore it,
  have Apache set `x-geo-country` / `-city` / `-region` / `-timezone` from a
  GeoIP module; the route already reads those names.
