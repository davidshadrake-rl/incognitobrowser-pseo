#!/usr/bin/env node
/**
 * Send one UDP DNS query and print the parsed answer — verifies the DNS leak
 * test zone from any machine, using the same wire-format code as the server.
 *
 * Usage:
 *   node scripts/dnsleak-check.mjs <server> [port] [name] [type]         (Node >= 22.18)
 *   npx tsx scripts/dnsleak-check.mjs <server> [port] [name] [type]      (older Node)
 *
 * Examples:
 *   node scripts/dnsleak-check.mjs 203.0.113.10                 → test.<zone> A, straight at the droplet
 *   node scripts/dnsleak-check.mjs 1.1.1.1                      → same name via a public resolver (proves delegation)
 *   node scripts/dnsleak-check.mjs 203.0.113.10 53 dnsleak.incognitobrowser.io NS
 *   node scripts/dnsleak-check.mjs 127.0.0.1 5354               → a local server started with DNSLEAK_PORT=5354
 *
 * Exit code 0 when a response arrived, 1 on timeout / malformed reply.
 * DNSLEAK_ZONE env overrides the zone used for the default name.
 */

import dgram from 'node:dgram';
import * as dnsLeakModule from '../lib/dns-leak.ts';

// Native Node exposes named exports directly; tsx parks them under `default` (CJS interop). Accept both.
const dnsLeak = /** @type {typeof dnsLeakModule} */ (dnsLeakModule.default ?? dnsLeakModule);
const { DNSLEAK_ZONE, DNS_TYPE, buildDnsQuery, normalizeZone, parseDnsResponse } = dnsLeak;

const [server, portArg, nameArg, typeArg] = process.argv.slice(2);
if (!server) {
  console.error('usage: dnsleak-check.mjs <server> [port] [name] [type]');
  process.exit(2);
}
const port = Number(portArg || 53);
const zone = normalizeZone(process.env.DNSLEAK_ZONE || DNSLEAK_ZONE);
const name = nameArg || `test.${zone}`;
const typeName = (typeArg || 'A').toUpperCase();
const type = DNS_TYPE[typeName];
if (!type) {
  console.error(`unknown type ${typeName}; use one of ${Object.keys(DNS_TYPE).join(', ')}`);
  process.exit(2);
}

const id = Math.floor(Math.random() * 0x10000);
const query = buildDnsQuery(name, type, id, true);
const socket = dgram.createSocket(server.includes(':') ? 'udp6' : 'udp4');
const started = Date.now();

const timer = setTimeout(() => {
  console.error(`timeout: no response from ${server}:${port} within 3 s`);
  socket.close();
  process.exit(1);
}, 3000);

socket.on('message', (msg, rinfo) => {
  clearTimeout(timer);
  try {
    const res = parseDnsResponse(msg);
    if (res.header.id !== id) console.warn(`warning: response id ${res.header.id} != query id ${id}`);
    const show = (r) => ({ name: r.name, type: r.type, ttl: r.ttl, data: r.data });
    console.log(
      JSON.stringify(
        {
          server: `${rinfo.address}:${rinfo.port}`,
          ms: Date.now() - started,
          question: res.questions[0],
          flags: res.flags,
          answers: res.answers.map(show),
          authority: res.authority.map(show),
          additional: res.additional.map(show),
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (err) {
    console.error(`malformed response (${msg.length} bytes): ${err.message}`);
    process.exit(1);
  } finally {
    socket.close();
  }
});

socket.on('error', (err) => {
  clearTimeout(timer);
  console.error(`socket error: ${err.message}`);
  process.exit(1);
});

socket.send(query, 0, query.length, port, server, (err) => {
  if (err) {
    clearTimeout(timer);
    console.error(`send failed: ${err.message}`);
    process.exit(1);
  }
});
