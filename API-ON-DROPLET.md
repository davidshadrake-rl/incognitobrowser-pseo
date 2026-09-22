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

**The service runs as its own `ib-api` uid, NOT as www-data.** Create it first:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin ib-api
sudo chown -R root:ib-api /opt/ib-api
sudo find /opt/ib-api -type d -exec chmod 750 {} + && sudo find /opt/ib-api -type f -exec chmod 640 {} +
sudo mkdir -p /opt/ib-api/.next/cache && sudo chown -R ib-api:ib-api /opt/ib-api/.next/cache
```

This is the single most load-bearing permission on the box, and it is not
obvious. www-data is the uid Apache runs the co-hosted WordPress PHP as. While
the service shared that uid, `/etc/ib-api.env` was readable by www-data — and
that file holds `ALTCHA_HMAC_KEY`, the HMAC secret that signs every
proof-of-work challenge. Anyone who reads it can mint unlimited valid tokens,
which switches the whole abuse-resistance layer off, plus `STATS_TOKEN`.

So the chain was: any file-read or code-execution bug in WordPress → www-data →
both secrets → unlimited scanning. The tools code was never the weak link in
it; the shared uid was. Split on 2026-09-21 while preparing for an authorised
penetration test. `scripts/deploy-api.sh` chowns to `root:ib-api` and will not
put it back.

`/etc/ib-api.env`, readable only by root and the ib-api group:

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
User=ib-api
Group=ib-api
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
  # REQUIRED, not optional. The app derives the rate-limiting client IP from
  # these headers. mod_proxy_http APPENDS the real peer to X-Forwarded-For
  # rather than replacing it, so without these four lines a request carrying
  # `X-Forwarded-For: 1.2.3.4` arrives as `1.2.3.4, <real peer>` and a forged
  # value can win. Verified exploitable against this host on 2026-09-18 —
  # every per-IP limit was bypassable by rotating one header — and fixed the
  # same day, here and in lib/rate-limit.ts (which now reads the LAST hop).
  # Either control closes it alone; keep both, so restoring an old vhost
  # backup cannot silently reopen it.
  RequestHeader unset X-Forwarded-For
  RequestHeader unset CF-Connecting-IP
  RequestHeader unset X-Real-IP
  RequestHeader unset True-Client-IP

  # Body cap. NOT LimitRequestBody — see "Abuse resistance" below for why that
  # directive is inert here and this one is not.
  <If "%{HTTP:Content-Length} -gt 1048576 && %{REQUEST_URI} =~ m#^/api/#">
    Require all denied
  </If>

  ProxyPass        /api/  http://127.0.0.1:3100/  retry=0 timeout=10
  ProxyPassReverse /api/  http://127.0.0.1:3100/
</IfModule>

# API requests are logged WITHOUT the client address, to their own file. This
# is a privacy product: a combined-format log would be a standing per-visitor
# record of which sites each person scanned. Time, request line, status, bytes
# and duration are kept; the vhost's own access.log takes `env=!ib_api`.
SetEnvIf Request_URI "^/api/" ib_api
LogFormat "%{%Y-%m-%dT%H:%M:%S}t \"%r\" %>s %b %Dus" ib_api_noip
CustomLog ${APACHE_LOG_DIR}/api.log ib_api_noip env=ib_api
```

The `RequestHeader unset` lines are deliberately vhost-wide rather than scoped
to `/api/`: nothing sits in front of this Apache, so an inbound
`X-Forwarded-For` is forged by definition, for WordPress as much as for the
API. **If a CDN or load balancer is ever put in front, that block must change**
— the real client address would then arrive in exactly those headers, and
stripping them would blind every per-IP limit.

Check it after any vhost change, using the fact that `/api/ip` echoes back
whatever the app believes the client IP to be:

```bash
curl -sk -X POST https://206-189-186-34.nip.io/api/ip \
  -H 'content-type: application/json' -H 'origin: https://206-189-186-34.nip.io' \
  -H 'x-forwarded-for: 1.2.3.4' -d '{}'
# must report your real address, never 1.2.3.4
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

## Abuse resistance, 2026-09-18

The backend is open — no accounts, no API keys — so the question is not whether
it gets found but what it costs to hammer. Nothing here is a guarantee of
invulnerability; a large enough flood still saturates a $24 droplet's uplink,
and only something in front of the box could change that. What these do
guarantee is that **the tools service cannot take WordPress and MySQL down with
it**, which is what used to happen under load.

Nothing below is a WAF or a CDN. Both were considered and are the owner's call.

### On the box

| Control | What it stops |
|---|---|
| `systemd` ceilings (`/etc/systemd/system/ib-api.service.d/limits.conf`) | The API eating the whole box. `MemoryMax=768M`, `MemorySwapMax=0`, `CPUQuota=100%` (one core of two), `TasksMax=256`, `LimitNOFILE=8192`, Node heap `--max-old-space-size=448`. Without these, an overloaded tools service grows until the kernel picks a victim — and it picks MySQL, so WordPress goes down and does not come back on its own. `RestartSec=5` + `StartLimitBurst=5`/`300s` stops a crash-loop from becoming its own load. |
| ~~`ufw`~~ **not installed** | This row used to claim a default-deny inbound firewall. The nightly suite (`ufw-default-deny`) found on 2026-09-22 that `ufw` is not on the box at all — `command not found`. What keeps Redis (6379), MySQL and the Node service (3100) off the public interface is only that each binds localhost, which `dast-internal-ports-closed` confirms nightly from outside. Installing a host firewall is an owner decision (it needs 22/tcp allowed first or the session locks itself out): `apt-get install ufw && ufw allow 22/tcp && ufw allow 80,443/tcp && ufw --force enable`. |
| **Per-process egress chain** `IB_API_EGRESS` (`scripts/droplet-egress-lockdown.sh`, applied 2026-09-22) | The scanner reaching the private network. The droplet is on a DigitalOcean VPC — `eth0 10.10.0.5/16`, `eth1 10.116.0.2/20` — and every code-level SSRF guard sits upstream of a `fetch()` that resolves the name a second time. The kernel refuses packets from uid 999 (ib-api) to RFC 1918, link-local, CGNAT, multicast and the metadata address, while keeping systemd-resolved (127.0.0.53:53) and Redis (127.0.0.1:6379) open. Rule one is `-m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`: without it the API cannot answer Apache and every route is 503 — which is exactly what the first application did, for about three minutes, while `--verify` reported all clear because it probed five outbound connections and no inbound one. `--verify` now POSTs to `/api/ip` first. `rasp-egress-lockdown` asserts the live table nightly, not the saved file. |
| Apache `<If "%{HTTP:Content-Length} -gt 1048576">` | Oversized bodies, refused before proxying. |
| `ProxyPass … timeout=10` | A slow target pinning an Apache worker after the answer can no longer arrive. Workers are the real ceiling: `mpm_event` allows 150. |
| `mod_reqtimeout` (already enabled) | Slowloris. `header=20-40,minrate=500`, `body=10,minrate=500`. |
| `logrotate` `maxsize 200M` + an **hourly** timer | A flood filling the disk between nightly rotations. A full disk takes MySQL down. |
| `FETCH_TIMEOUT_MS=5000` | Halves how long one scan can hold a slot. |

**`LimitRequestBody` does not work here.** It is silently inert for
reverse-proxied requests: set to 1 MiB in both `<Location /api/>` and
`<LocationMatch>`, a 1.5 MB POST still reached Node and was answered 200 —
1.3 s versus 14 ms for a small body, so the whole body crossed the wire.
`RewriteRule … [R=413]` does not fire either, because `ProxyPass` claims the
request in `translate_name` before mod_rewrite runs. The vhost-level `<If>`
block is the form that actually works; verified 413→403 on 1.5 MB, 200 on a
normal body. Do not "restore" the tidier-looking directives.

### In the app

| Control | What it stops |
|---|---|
| Global in-flight scan cap (`MAX_IN_FLIGHT_SCANS`, default 20) | The per-IP limiter bounds one visitor and does nothing about a thousand, or a botnet with a thousand addresses. Past the cap: 503 immediately, because queueing under flood only turns a fast refusal into a slow one. |
| Deadline across the **body**, not just the headers | A target that answers instantly then dribbles bytes forever. `clearTimeout` used to run the moment headers landed, leaving the read unbounded in time — and the byte cap never fired, because the bytes never arrived. |
| Fail-**closed** proof-of-work replay check | Single-use being switched off by whoever can stop Redis answering. It used to swallow the error and carry on, so knocking Redis over bought one solved token unlimited scans for its whole 90 s life. Now 503. |
| `BLOCKED_TARGET_HOSTS` (defaults to this droplet) | Scanning ourselves: free self-amplification, one inbound request becoming two, the second skipping the rate limiter because it arrives from our own address. |
| Bounded counter keys + 35-day TTL | The `/event` keyspace. The page key carried severity and target, so pages × events × severities × targets was ~630,000 keys/day held for 400 days, against a 256 MB `allkeys-lru` Redis — a burst would have evicted real counters to make room for itself. Now ~21,000/day for 35 days, with the same read-out. |
| `/stats` key ceiling (20,000, reports `truncated`) | One call collecting a whole abnormal day into memory to answer. |
| **`readCappedRequestText`** on every POST route (`lib/request-body.ts`, 2026-09-22) | The pattern this row used to describe — check `Content-Length`, then `request.text()`, then re-check the length — was the bug. A chunked request sends no `Content-Length`, so the pre-check was *skipped*, and `request.text()` is unbounded: 300 MB went resident on the 448 MB heap from one request, no proof-of-work needed on three of the four routes, systemd restarting the service in a loop. The streaming reader stops pulling at the cap and cancels. Verified on the box: 200 MB offered straight at Node costs it 128 KB and is refused in under a second. `request.text()` / `request.json()` are banned in route handlers by `tests/request-body-cap.test.ts`; `rasp-api-body-cap-process` measures VmRSS next to the process nightly, because from outside Apache — which drains the client regardless — a buffering route and a streaming one are indistinguishable. |

Redis holds only our `evt:` keys — **WordPress does not share it** (no
`object-cache.php` drop-in, no `redis` in `wp-config.php`, checked 2026-09-18),
so the 256 MB cap and LRU eviction cannot touch WordPress.

Tests: `tests/hardening.test.ts` guards each app-side control, and each guard
was mutation-tested — break the control, the test fails.

### Two SSRF holes found and closed the same day

Both were verified against the real exported `isBlockedHostname`, not a
description of it:

1. **IPv4-mapped IPv6.** WHATWG URL rewrites `::ffff:127.0.0.1` to
   `::ffff:7f00:1`, and the old `slice(7)` then produced `7f00:1`, matching no
   IPv4 pattern. `[::ffff:7f00:1]` (loopback) and `[::ffff:a9fe:a9fe]` (cloud
   metadata) were both **allowed**. This was not only a typed-URL problem:
   `dns.lookup` returns addresses in the same form, so a hostile name
   publishing such an AAAA record walked straight past the resolve-then-judge
   step added earlier the same day.
2. **Trailing dot.** `localhost.` and `metadata.google.internal.` name the same
   hosts and were both **allowed** by the equality tests.

Also added: multicast `224/4`, reserved `240/4`, 6to4 `192.88.99/24` and
`2002::/16`, NAT64 `64:ff9b::/96`, and the TEST-NET documentation ranges.

`tests/ssrf-protection.test.ts` **used to grade a hand-copied replica** of the
function, with a comment claiming it was not exported — it was. The copy had
drifted, so the suite reported all green straight through both holes above.
It now imports the real one. Never re-inline it.

### The guard is an allowlist now (2026-09-22)

Four bypasses in a week, all the same shape — a form the regexes did not
anticipate, therefore allowed — is what a denylist produces. The resolved
addresses are now judged by `isPublicUnicastAddress()` in `lib/net-address.ts`:
integer parsing, the full IANA special-purpose registry, IPv6 global unicast
is `2000::/3` and nothing else, and anything that does not parse canonically is
**refused rather than fetched**. The differential test names what the denylist
was approving, including `::127.0.0.1` (IPv4-compatible loopback) and Teredo
`2001::/32`, which embeds an IPv4 exactly as the 6to4 prefix the denylist did
block. `::127.0.0.1` was not exploitable — WHATWG rewrites it to `[::7f00:1]`
and the *bracketed* string went to `dns.lookup`, which failed — but the control
that stopped it was a bracket. Single-label hostnames (`intranet`) are refused
before the resolver, because on a company box the search suffix decides what
they mean. `isBlockedHostname` remains for the pre-resolution name checks.

### DNS rebinding: closed at the network layer, 2026-09-22

The route resolves the hostname, judges the addresses, and then calls `fetch`,
which resolves it **again**. A name whose record flips between the two — a
public address for our check, a private one for the fetch — walked past every
code-level guard, because what was judged was not what got connected to.

It is closed by the `IB_API_EGRESS` chain above, not by code: the rebind
resolves into the VPC, `fetch()` connects, and the packet is refused on the way
out of the host. Parser bugs and the resolve-twice race stop mattering for
private targets. Two code-level alternatives were costed here before (an
`undici` dispatcher with a pinned `connect.lookup`; a `node:https` rewrite with
an agent-level `lookup`). Neither is needed for the private case now, and
neither would help the remaining one:

**What is NOT closed, and cannot be at this layer:** an internal service that
lives on a *public* address. It is public unicast, the allowlist allows it, the
kernel routes it, and pinning would pin to it. If the company runs something
sensitive on a public IP, it needs authentication or the VPC; the scanner
cannot tell it from any other website. `BLOCKED_TARGET_HOSTS` can name such
hosts explicitly (CIDR support is in progress), which is a list, not a
guarantee.

Still in place underneath: the port allowlist (80/443/8080/8443),
`redirect: 'manual'`, and `BLOCKED_TARGET_HOSTS`.

Also not done: a per-day scan counter in the `/event` keyspace. Scan volume is
visible in `api.log` meanwhile.

## What is deliberately not carried over

- **The Vercel WAF / firewall rules** from the old `OPS-RUNBOOK.md`. Apache has
  no equivalent configured. If rate limiting at the edge matters, that is a
  separate decision — the app's own per-IP limiter still runs.
- **Geo lookup.** Vercel injected `x-vercel-ip-*`. Nothing replaces it today, so
  What's My IP shows the address without city/region/country. To restore it,
  have Apache set `x-geo-country` / `-city` / `-region` / `-timezone` from a
  GeoIP module; the route already reads those names.
