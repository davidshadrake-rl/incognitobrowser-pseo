#!/usr/bin/env node
/**
 * Live security regression for a deployed instance (free or Pro).
 *
 *   node scripts/security-smoke.mjs https://incognitobrowser-pro.vercel.app --pro
 *   node scripts/security-smoke.mjs https://incognitobrowser-pseo.vercel.app --free
 *
 * Re-runs, against a LIVE deployment, the properties the unit suites pin in
 * source (tests/api-security, cors-security, ssrf-protection, rate-limit,
 * resource-bounds, ip-route): origin gate, proof-of-work, SSRF blocklist,
 * port/length limits, rate limit, the /ip route and the security headers.
 * It solves the PoW itself, so it exercises the real path, not a mock.
 *
 * Budget: ≤4 /challenge calls and ~20 /scan-url POSTs — inside the per-IP
 * limits (30/min, 10/min). Re-running within a minute skews the rate-limit
 * section; wait 60s between runs. Exit 1 on any FAIL.
 */
import { createHash } from 'node:crypto';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('usage: security-smoke.mjs <https://base> [--pro|--free]'); process.exit(2); }
const isPro = process.argv.includes('--pro');
const isFree = process.argv.includes('--free');
const ORIGIN = new URL(base).origin;
const EVIL = 'https://evil.example';

let fails = 0;
const ok = (cond, label, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '   [' + detail + ']' : ''}`); if (!cond) fails++; };
const info = (label, detail = '') => console.log(`INFO  ${label}${detail ? '   [' + detail + ']' : ''}`);

const req = async (path, { method = 'GET', origin, headers = {}, body, redirect = 'manual' } = {}) => {
  const h = { ...headers };
  if (origin) h['Origin'] = origin;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect });
  let json = null; let text = '';
  try { text = await res.text(); json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, json, text };
};

const solve = (salt, challenge, maxnumber) => {
  for (let n = 0; n <= maxnumber; n++) {
    if (createHash('sha256').update(salt + n).digest('hex') === challenge) return n;
  }
  return -1;
};

console.log(`security-smoke → ${base} (${isPro ? 'pro' : isFree ? 'free' : 'generic'})`);

// A. Security headers on a page
{
  const r = await fetch(base + '/tools', { redirect: 'follow' });
  const H = (k) => r.headers.get(k) || '';
  ok(r.status === 200, 'GET /tools is 200', String(r.status));
  ok(/default-src|script-src/.test(H('content-security-policy')), 'Content-Security-Policy present');
  ok(/max-age=\d{6,}/.test(H('strict-transport-security')), 'HSTS present', H('strict-transport-security'));
  ok(H('x-content-type-options') === 'nosniff', 'X-Content-Type-Options nosniff');
  ok(/DENY/i.test(H('x-frame-options')), 'X-Frame-Options DENY', H('x-frame-options'));
  ok(/strict-origin-when-cross-origin/.test(H('referrer-policy')), 'Referrer-Policy');
  ok(H('permissions-policy').length > 0, 'Permissions-Policy present');
  ok(/same-origin/.test(H('cross-origin-opener-policy')), 'Cross-Origin-Opener-Policy same-origin', H('cross-origin-opener-policy'));
}

// B. /challenge — origin gate + issuance
let token = null;
{
  const noOrigin = await req('/challenge', { method: 'POST', body: {} });
  ok(noOrigin.status === 403, '/challenge without Origin → 403', String(noOrigin.status));
  const evil = await req('/challenge', { method: 'POST', origin: EVIL, body: {} });
  ok(evil.status === 403 && !evil.headers.get('access-control-allow-origin'), '/challenge from foreign Origin → 403, no ACAO', String(evil.status));
  const pre = await req('/challenge', { method: 'OPTIONS', origin: ORIGIN });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, 'OPTIONS /challenge same-origin → 204 + ACAO mirrors origin', `${pre.status} ${pre.headers.get('access-control-allow-origin')}`);
  const same = await req('/challenge', { method: 'POST', origin: ORIGIN, body: {} });
  ok(same.status === 200 && same.json?.challenge && same.json?.salt && same.json?.signature && same.json?.expires, '/challenge same-origin → 200 with challenge/salt/signature/expires', String(same.status));
  ok(same.headers.get('access-control-allow-origin') === ORIGIN, '/challenge ACAO mirrors same origin');
  ok(same.headers.get('access-control-allow-credentials') === 'false', 'ACAC false');
  info('rate-limit headers on /challenge', ['x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit-limit', 'ratelimit-remaining'].map((k) => `${k}=${same.headers.get(k)}`).filter((s) => !s.endsWith('=null')).join(' ') || 'none exposed');
  if (same.json?.allowedOriginCount !== undefined) info('DEBUG_ORIGINS echo enabled (allowedOriginCount in /challenge body)', `count=${same.json.allowedOriginCount} — set DEBUG_ORIGINS=0 to silence`);
  if (same.status === 200) {
    const t0 = Date.now();
    const number = solve(same.json.salt, same.json.challenge, same.json.maxnumber ?? 100000);
    ok(number >= 0, `proof-of-work solvable client-side (number=${number}, ${Date.now() - t0}ms)`);
    if (number >= 0) token = 'Altcha ' + Buffer.from(JSON.stringify({ algorithm: same.json.algorithm || 'SHA-256', salt: same.json.salt, number, signature: same.json.signature, expires: same.json.expires })).toString('base64');
  }
}

// C. /scan-url — method, origin, PoW, SSRF, limits, a real scan (≤ 9 POSTs before the rate-limit burst)
{
  const get = await req('/scan-url');
  ok(get.status === 405, 'GET /scan-url → 405', String(get.status));
  const noOrigin = await req('/scan-url', { method: 'POST', body: { url: 'https://example.com' } });
  ok(noOrigin.status === 403, '/scan-url without Origin → 403', String(noOrigin.status));
  const evil = await req('/scan-url', { method: 'POST', origin: EVIL, body: { url: 'https://example.com' } });
  ok(evil.status === 403, '/scan-url from foreign Origin → 403', String(evil.status));
  const noPow = await req('/scan-url', { method: 'POST', origin: ORIGIN, body: { url: 'https://example.com' } });
  ok(noPow.status === 401 && noPow.json?.reason === 'no_solution', '/scan-url same-origin without PoW → 401 no_solution', `${noPow.status} ${noPow.json?.reason}`);
  if (token) {
    const tampered = (() => { const j = JSON.parse(Buffer.from(token.slice(7), 'base64').toString()); j.number += 1; return 'Altcha ' + Buffer.from(JSON.stringify(j)).toString('base64'); })();
    const bad = await req('/scan-url', { method: 'POST', origin: ORIGIN, headers: { Authorization: tampered }, body: { url: 'https://example.com' } });
    ok(bad.status === 401 && bad.json?.reason === 'sig_mismatch', 'tampered PoW → 401 sig_mismatch', `${bad.status} ${bad.json?.reason}`);
    const A = { Authorization: token };
    const ssrf = [
      ['http://169.254.169.254/latest/meta-data/', 'AWS metadata IP'],
      ['http://localhost:8080/', 'localhost'],
      ['http://10.0.0.1/', 'RFC1918'],
      ['https://example.com:8081/', 'non-standard port'],
      ['https://example.com/' + 'a'.repeat(2100), 'URL over 2048 chars'],
    ];
    for (const [u, label] of ssrf) {
      const r = await req('/scan-url', { method: 'POST', origin: ORIGIN, headers: A, body: { url: u } });
      ok(r.status === 400, `blocked: ${label} → 400`, `${r.status} ${r.json?.error?.slice(0, 60) || ''}`);
    }
    const real = await req('/scan-url', { method: 'POST', origin: ORIGIN, headers: A, body: { url: 'https://example.com/' } });
    ok(real.status === 200 && real.json?.summary && Array.isArray(real.json?.cookies), 'real scan of example.com with valid PoW → 200 + summary', `${real.status} ${real.json?.error || `cookies=${real.json?.summary?.totalCookies} trackers=${real.json?.summary?.totalTrackers}`}`);
    ok(real.headers.get('x-content-type-options') === 'nosniff' && /DENY/i.test(real.headers.get('x-frame-options') || ''), 'API responses carry nosniff + X-Frame-Options DENY');
    ok((real.headers.get('vary') || '').toLowerCase().includes('origin'), 'API responses Vary: Origin');
  }
  // Rate limit: the limiter runs before the PoW check, so unauthenticated POSTs are enough.
  let s429 = 0, s401 = 0, other = 0;
  for (let i = 0; i < 12; i++) {
    const r = await req('/scan-url', { method: 'POST', origin: ORIGIN, body: { url: 'https://example.com' } });
    if (r.status === 429) s429++; else if (r.status === 401) s401++; else other++;
  }
  ok(s429 >= 1, 'per-IP rate limit on /scan-url engages within 12 rapid POSTs (limit 10/min)', `429=${s429} 401=${s401} other=${other}`);
  if (s429 === 0) info('no 429 seen — an in-memory limiter behind several serverless instances cannot share counters; set REDIS_URL on this project');
}

// D. /ip
{
  const evil = await req('/ip', { method: 'POST', origin: EVIL, body: {} });
  ok(evil.status === 403, '/ip from foreign Origin → 403', String(evil.status));
  const same = await req('/ip', { method: 'POST', origin: ORIGIN, body: {} });
  ok(same.status === 200 && typeof same.json?.ip === 'string', '/ip same-origin → 200 with ip', `${same.status} ip=${same.json?.ip}`);
  ok(/no-store/.test(same.headers.get('cache-control') || ''), '/ip Cache-Control no-store', same.headers.get('cache-control') || '');
  const get = await req('/ip');
  ok(get.status === 405, 'GET /ip → 405', String(get.status));
}

// E. Deployment-specific posture
if (isPro) {
  const robots = await req('/robots.txt');
  ok(robots.status === 200 && !/Disallow:\s*\/\s*$/m.test(robots.text), 'Pro robots.txt is crawlable (noindex is enforced by meta + header, not by Disallow)', robots.text.replace(/\n/g, ' | ').slice(0, 80));
  const hdr = await fetch(base + '/tools', { redirect: 'follow' });
  ok(/noindex/.test(hdr.headers.get('x-robots-tag') || ''), 'Pro sends X-Robots-Tag: noindex', hdr.headers.get('x-robots-tag') || '(none)');
  const sm = await req('/sitemap.xml');
  ok(sm.status === 404 || !/<loc>/.test(sm.text), 'Pro exposes no sitemap URLs (404 or empty urlset)', `${sm.status} locs=${(sm.text.match(/<loc>/g) || []).length}`);
  const tool = await fetch(base + '/tools/ad-tracking/cookie-tracker-scanner', { redirect: 'follow' }).then((r) => r.text());
  ok(/<meta name="robots" content="noindex/.test(tool), 'Pro tool page is noindex');
  for (const p of ['/', '/guides', '/checklists', '/comparisons', '/templates', '/calculators', '/glossary', '/site', '/site/methodology']) {
    const r = await req(p);
    const loc = r.headers.get('location') || '';
    ok([301, 302, 307, 308].includes(r.status) && /\/tools\/?$/.test(loc), `Pro ${p} → redirect to /tools`, `${r.status} ${loc}`);
  }
  for (const p of ['/site/cnn.com', '/guides/browser-privacy/complete-guide-to-browser-privacy', '/tools/vpn-privacy/whats-my-ip', '/topics/browser-privacy']) {
    const r = await fetch(base + p, { redirect: 'follow' });
    ok(r.status === 404, `Pro ${p} (free-only content) → 404`, String(r.status));
  }
}
if (isFree) {
  const robots = await req('/robots.txt');
  ok(robots.status === 200 && /Allow:\s*\//.test(robots.text) && /Sitemap:/.test(robots.text), 'Free robots.txt allows + names the sitemap');
  const sm = await fetch(base + '/sitemap.xml', { redirect: 'follow' });
  ok(sm.status === 200, 'Free sitemap 200', String(sm.status));
  for (const p of ['/tools/ad-tracking/cookie-tracker-scanner', '/tools/browser-privacy/browser-privacy-audit', '/tools/phishing/url-safety-checker', '/tools/dating-privacy/image-metadata-checker']) {
    const r = await fetch(base + p, { redirect: 'follow' });
    ok(r.status === 404, `Free ${p} (Pro-only tool) → 404`, String(r.status));
  }
}

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
