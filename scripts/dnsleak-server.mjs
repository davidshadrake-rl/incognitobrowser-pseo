#!/usr/bin/env node
/**
 * DNS leak test — authoritative nameserver for the delegated test zone.
 *
 * WHAT IT DOES
 *   Listens on UDP/53. For every query whose name ends with DNSLEAK_ZONE it
 *   answers A queries with DNSLEAK_A (TTL 1), NS/SOA queries at the apex
 *   minimally (so delegation checks pass), everything else NOERROR/empty —
 *   and, when the name carries a test id (`<n>.<12-char id>.<zone>`), RPUSHes
 *   { resolverIp, ts, qname } onto `dnsleak:seen:<id>` (EXPIRE 600) so the
 *   Vercel route /dns-leak/result can read back which resolver asked.
 *   Queries outside the zone get REFUSED — this is not a recursive resolver.
 *   All wire-format logic comes from lib/dns-leak.ts (shared with the routes).
 *
 * RUN
 *   node scripts/dnsleak-server.mjs           (Node >= 22.18: native type stripping loads lib/dns-leak.ts)
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/dnsleak-server.mjs
 *                                             (same, without Node's "reparsing as ES module" notice —
 *                                              this package.json has no "type":"module")
 *   npx tsx scripts/dnsleak-server.mjs        (older Node; tsx is a runtime dependency of this repo)
 *   Port 53 needs root or CAP_NET_BIND_SERVICE. DNSLEAK_PORT=5354 to try it unprivileged —
 *   avoid 5353, which mDNS (Bonjour / avahi) already owns on macOS and many Linux desktops.
 *
 * ENV
 *   DNSLEAK_ZONE   dnsleak.incognitobrowser.io          (default: DNSLEAK_ZONE from lib/dns-leak.ts)
 *   DNSLEAK_A      <droplet public IPv4>                 REQUIRED — the answer for every A query in the zone
 *   DNSLEAK_NS     ns1.dnsleak.incognitobrowser.io      (default: ns1.<zone>)
 *   DNSLEAK_PORT   53
 *   DNSLEAK_BIND   0.0.0.0                              (an IPv6 literal switches the socket to udp6)
 *   DNSLEAK_TTL    1                                    TTL for A answers (0 or 1 keeps test names uncached)
 *   DNSLEAK_LOG    1 to log every query (resolver IP, qname, qtype) to stdout
 *   REDIS_URL      the SAME Redis the Vercel routes use (copy REDIS_URL from the Vercel project env)
 *
 * DELEGATION — one-time, at the DNS provider that hosts incognitobrowser.io
 *   1. Glue A record:     ns1.dnsleak.incognitobrowser.io   A    <droplet IP>
 *   2. Delegation NS:     dnsleak.incognitobrowser.io       NS   ns1.dnsleak.incognitobrowser.io
 *      (Cloudflare: both records must be "DNS only" / grey cloud — never proxied.)
 *   3. Open UDP 53 inbound: `ufw allow 53/udp` AND the DigitalOcean cloud firewall if one is attached.
 *   4. Free port 53: on Ubuntu, systemd-resolved's stub listener holds 127.0.0.53:53 —
 *      set `DNSStubListener=no` in /etc/systemd/resolved.conf and `systemctl restart systemd-resolved`.
 *   5. Verify:  node scripts/dnsleak-check.mjs <droplet IP>              (asks this server directly)
 *               node scripts/dnsleak-check.mjs 1.1.1.1                   (via the public DNS tree — proves delegation)
 *               dig +short 1.abcdefghijkl.dnsleak.incognitobrowser.io   (should print DNSLEAK_A)
 *      then check Redis: LRANGE dnsleak:seen:abcdefghijkl 0 -1
 *
 * SYSTEMD — /etc/systemd/system/dnsleak.service
 *   [Unit]
 *   Description=DNS leak test authoritative nameserver
 *   After=network-online.target
 *   Wants=network-online.target
 *
 *   [Service]
 *   WorkingDirectory=/opt/pseo                 # a checkout with `npm ci` run (needs ioredis + tsx)
 *   Environment=DNSLEAK_ZONE=dnsleak.incognitobrowser.io
 *   Environment=DNSLEAK_A=203.0.113.10         # ← droplet public IP
 *   Environment=DNSLEAK_NS=ns1.dnsleak.incognitobrowser.io
 *   Environment=REDIS_URL=rediss://default:...@....upstash.io:6379
 *   ExecStart=/usr/bin/node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/dnsleak-server.mjs
 *   # Node < 22.18 on the droplet? use: ExecStart=/usr/bin/npx tsx scripts/dnsleak-server.mjs
 *   Restart=always
 *   RestartSec=2
 *   AmbientCapabilities=CAP_NET_BIND_SERVICE
 *   NoNewPrivileges=true
 *
 *   [Install]
 *   WantedBy=multi-user.target
 *
 *   sudo systemctl daemon-reload && sudo systemctl enable --now dnsleak && journalctl -fu dnsleak
 *
 * NOTES
 *   - UDP only. Every response is well under 512 bytes, so TC is never set and TCP is not needed.
 *   - Nothing has to listen on 443: the browser's requests to https://<name>/p.gif are meant to fail.
 *     The DNS lookup they trigger is the whole point.
 *   - Redis writes are fire-and-forget; a Redis outage never delays a DNS answer.
 */

import dgram from 'node:dgram';
import Redis from 'ioredis';
import * as dnsLeakModule from '../lib/dns-leak.ts';

// Native Node (type stripping) exposes the lib's named exports directly; tsx
// transpiles the .ts file to CommonJS (no "type":"module" here) and parks them
// under `default`. Accept both so either run command works.
const dnsLeak = /** @type {typeof dnsLeakModule} */ (dnsLeakModule.default ?? dnsLeakModule);
const { DNSLEAK_ZONE, TEST_TTL_SECONDS, answerAuthoritatively, normalizeZone, parseDnsQuery, seenKey } = dnsLeak;

const zone = normalizeZone(process.env.DNSLEAK_ZONE || DNSLEAK_ZONE);
const answerIp = (process.env.DNSLEAK_A || '').trim();
const nsHost = normalizeZone(process.env.DNSLEAK_NS || `ns1.${zone}`);
const port = Number(process.env.DNSLEAK_PORT || 53);
const bind = process.env.DNSLEAK_BIND || '0.0.0.0';
const ttl = Number(process.env.DNSLEAK_TTL ?? 1);
const verbose = process.env.DNSLEAK_LOG === '1';
const redisUrl = process.env.REDIS_URL;

if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(answerIp)) {
  console.error('DNSLEAK_A must be set to the IPv4 address this server answers with.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`DNSLEAK_PORT is not a valid port: ${process.env.DNSLEAK_PORT}`);
  process.exit(1);
}

// Long-running process: keep reconnecting to Redis forever (unlike the serverless routes).
const redis = redisUrl
  ? new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    })
  : null;
redis?.on('error', (err) => console.error(`[redis] ${err.message}`));
if (!redis) console.warn('REDIS_URL not set — queries will be answered but NOT recorded.');

const MAX_LIST_LENGTH = 200; // per test id; bounds a flood against one id

function record(testId, resolverIp, qname) {
  if (!redis) return;
  const key = seenKey(testId);
  const entry = JSON.stringify({ resolverIp, ts: Date.now(), qname });
  redis
    .multi()
    .rpush(key, entry)
    .ltrim(key, -MAX_LIST_LENGTH, -1)
    .expire(key, TEST_TTL_SECONDS)
    .exec()
    .catch((err) => console.error(`[redis] record failed: ${err.message}`));
}

const socket = dgram.createSocket({ type: bind.includes(':') ? 'udp6' : 'udp4', reuseAddr: true });

socket.on('message', (msg, rinfo) => {
  if (msg.length < 12 || msg.length > 4096) return;
  const query = parseDnsQuery(msg);
  if (!query) return;

  const { response, inZone, testId } = answerAuthoritatively(query, { zone, answerIp, nsHost, ttl });
  socket.send(response, 0, response.length, rinfo.port, rinfo.address, (err) => {
    if (err) console.error(`[udp] send to ${rinfo.address}:${rinfo.port} failed: ${err.message}`);
  });

  if (inZone && testId) record(testId, rinfo.address, query.question.name);
  if (verbose) {
    console.log(
      `${new Date().toISOString()} ${rinfo.address} ${query.question.name} type=${query.question.type}` +
        (inZone ? (testId ? ` id=${testId}` : ' (apex/ns)') : ' REFUSED'),
    );
  }
});

socket.on('error', (err) => {
  console.error(`[udp] socket error: ${err.message}`);
  process.exit(1);
});

socket.on('listening', () => {
  const a = socket.address();
  console.log(`dnsleak-server: authoritative for ${zone} on ${a.address}:${a.port} → A ${answerIp} (ns ${nsHost}, ttl ${ttl}), redis ${redis ? 'on' : 'OFF'}`);
});

socket.bind(port, bind);

function shutdown() {
  console.log('dnsleak-server: shutting down');
  socket.close();
  redis?.quit().catch(() => {});
  setTimeout(() => process.exit(0), 200).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
