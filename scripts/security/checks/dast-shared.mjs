/**
 * Shared machinery for the DAST checks. Exports no check of its own — the
 * runner's `if (d && d.id)` filter drops the empty default export.
 *
 * Two things live here because several checks need them and a second copy is a
 * second thing to forget:
 *
 *   1. The parsers for the two files that DECLARE our security headers
 *      (scripts/droplet-htaccess.conf for the static sites, next.config.ts for
 *      the API). Header parity is the whole point of dast-header-parity, and a
 *      parser that quietly returns nothing would make that check pass while
 *      grading zero headers — the exact failure this suite was written after.
 *      So every parser here refuses to return a suspiciously small result; the
 *      caller turns that into a Skip rather than a green tick.
 *
 *   2. A raw-socket HTTP client. `fetch` cannot set Host or a lying
 *      Content-Length — both are forbidden header names, and undici owns the
 *      framing — so the Host-spoofing and declared-length probes are physically
 *      impossible through it. A check written on fetch for those would report
 *      PASS every night while testing nothing at all.
 */
import net from 'node:net';
import tls from 'node:tls';

export default [];

/**
 * Strings that must never appear in a response body from the internet-facing
 * API. These are the droplet's own layout and plumbing: /opt/ib-api is where
 * the service is installed, and redis:// would name the store that holds every
 * rate-limit counter and every single-use proof-of-work claim.
 *
 * Deliberately NOT in this list: "vercel", any tracker or ad-network name, and
 * any company name. The repo legitimately contains 500 scanned third-party
 * sites under data/ (vercel.com among them), editorial copy that names
 * trackers and attack techniques, and ad-shaped bait files under
 * public/adtest/. Those are the false-positive magnets that get a check
 * switched off. This list only contains things that are ours and private.
 */
export const LEAK_MARKERS = [
  '/opt/ib-api',
  'node_modules',
  'at Object.',
  'ECONNREFUSED',
  'redis://',
  '/var/www/html',
];

/** Which leak markers a body contains, with a little surrounding context. */
export function findLeaks(text) {
  if (!text) return [];
  const hits = [];
  for (const m of LEAK_MARKERS) {
    const i = text.indexOf(m);
    if (i === -1) continue;
    // A `.ts:` line reference is only interesting next to a path, so it is not
    // its own marker — "foo.ts:12" appears in ordinary prose on these sites.
    hits.push({ marker: m, context: text.slice(Math.max(0, i - 60), i + 80).replace(/\s+/g, ' ') });
  }
  return hits;
}

/**
 * One HTTP request over a socket we control, so the request line and every
 * header are exactly what we wrote.
 *
 * Returns a plain object and never throws, matching ctx.http's contract: one
 * unreachable probe must not abort a whole check.
 */
export function rawRequest({
  host, port, useTls = false, servername, method = 'GET', path = '/',
  headers = {}, body = '', timeoutMs = 12_000,
}) {
  return new Promise((resolve) => {
    let settled = false;
    let chunks = '';
    const done = (result) => { if (!settled) { settled = true; try { socket.destroy(); } catch { /* already gone */ } resolve(result); } };

    const lines = [`${method} ${path} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    lines.push('Connection: close', '', body);
    const wire = lines.join('\r\n');

    const onReady = () => { try { socket.write(wire); } catch (e) { done({ ok: false, error: String(e.message || e) }); } };
    const socket = useTls
      ? tls.connect({ host, port, servername: servername || host, rejectUnauthorized: false }, onReady)
      : net.connect({ host, port }, onReady);

    socket.setTimeout(timeoutMs, () => done({ ok: false, error: `timeout after ${timeoutMs}ms`, status: 0, headers: {}, body: chunks }));
    socket.on('data', (d) => {
      chunks += d.toString('latin1');
      // 256 KB is far more than any of our error pages; stop reading a flood.
      if (chunks.length > 262_144) done(parseRaw(chunks));
    });
    socket.on('error', (e) => done({ ok: false, error: String(e.message || e), status: 0, headers: {}, body: chunks }));
    socket.on('end', () => done(parseRaw(chunks)));
    socket.on('close', () => done(parseRaw(chunks)));
  });
}

function parseRaw(raw) {
  const split = raw.indexOf('\r\n\r\n');
  if (split === -1) return { ok: false, error: 'no complete response head', status: 0, headers: {}, body: raw, raw };
  const head = raw.slice(0, split);
  const body = raw.slice(split + 4);
  const [statusLine, ...headerLines] = head.split('\r\n');
  const headers = {};
  for (const l of headerLines) {
    const i = l.indexOf(':');
    if (i === -1) continue;
    const k = l.slice(0, i).trim().toLowerCase();
    // Repeated headers are joined, so a duplicated Set-Cookie still shows up.
    headers[k] = headers[k] ? `${headers[k]}, ${l.slice(i + 1).trim()}` : l.slice(i + 1).trim();
  }
  const m = /^HTTP\/[\d.]+\s+(\d{3})/.exec(statusLine || '');
  return { ok: true, status: m ? Number(m[1]) : 0, statusLine, headers, body, raw };
}

// ---------------------------------------------------------------------------
// What the repo DECLARES
// ---------------------------------------------------------------------------

/**
 * Parse the managed block in scripts/droplet-htaccess.conf.
 *
 * That file is the only definition of the static sites' security headers — a
 * static export runs no Next.js server, so next.config.ts headers() never
 * execute for those ~1,400 pages. It is spliced into the web root's SHARED
 * .htaccess by scripts/droplet-server-config.sh, which no npm script runs.
 *
 * Returns the `Header always set` directives in the <FilesMatch> block as the
 * baseline, plus the <If> blocks as ordered overrides (later wins, which is
 * what Apache's `Header set` does). `Header set` without `always` — the
 * Cache-Control line in the mod_expires block — is deliberately NOT collected:
 * it is a caching directive, it interacts with the per-site
 * scripts/site.htaccess, and grading it here would be a performance assertion
 * wearing a security check's clothes.
 */
export function parseManagedHtaccess(text) {
  const base = new Map();
  const overrides = [];
  let filesExtensions = null;
  let inFilesMatch = false;
  let current = null; // the <If> we are inside, if any

  const HEADER = /^\s*Header\s+always\s+set\s+([A-Za-z0-9-]+)\s+"((?:[^"\\]|\\.)*)"/;

  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue;

    const fm = /^\s*<FilesMatch\s+"\\\.\(([^)]+)\)\$">/.exec(line);
    if (fm) { inFilesMatch = true; filesExtensions = fm[1].split('|').map((s) => s.trim()); continue; }
    if (/^\s*<\/FilesMatch>/.test(line)) { inFilesMatch = false; continue; }

    const iff = /^\s*<If\s+"%\{REQUEST_URI\}\s*=~\s*m#(.+)#"\s*>/.exec(line);
    if (iff) { current = { source: iff[1], re: safeRegExp(iff[1]), headers: new Map() }; continue; }
    if (/^\s*<\/If>/.test(line)) { if (current && current.headers.size) overrides.push(current); current = null; continue; }

    const h = HEADER.exec(line);
    if (!h) continue;
    const [, name, value] = h;
    if (current) current.headers.set(name, value);
    else if (inFilesMatch) base.set(name, value);
  }

  return { base, overrides, filesExtensions };
}

function safeRegExp(source) {
  try { return new RegExp(source); } catch { return null; }
}

/**
 * The header set a given request URI should carry, per the parsed .conf:
 * the <FilesMatch> baseline when the resolved file's extension is covered,
 * then every matching <If> applied in file order.
 *
 * A directory URI resolves to index.html, which is how /resources/tools/ picks
 * up the baseline live.
 */
export function expectedStaticHeaders(uri, parsed) {
  const ext = uri.endsWith('/') ? 'html' : (uri.split('?')[0].split('.').pop() || '').toLowerCase();
  const covered = !parsed.filesExtensions || parsed.filesExtensions.includes(ext);
  const out = new Map(covered ? parsed.base : []);
  for (const o of parsed.overrides) {
    if (!o.re || !o.re.test(uri)) continue;
    for (const [k, v] of o.headers) out.set(k, v);
  }
  return out;
}

/**
 * Parse SECURITY_HEADERS out of next.config.ts.
 *
 * These are the headers the API service actually sends — it is the server
 * build, so headers() runs. They are a SECOND, independent declaration of the
 * same policy as the .conf, maintained by hand, and the two have already
 * drifted apart once. Grading each surface against its own source is the point.
 *
 * X-Robots-Tag is skipped: it is spread in conditionally on
 * NEXT_PUBLIC_TIER=pro, which the API service is not, so asserting it would
 * fire on every run.
 */
export function parseNextSecurityHeaders(text) {
  const start = text.indexOf('const SECURITY_HEADERS = [');
  if (start === -1) return new Map();
  const end = text.indexOf('\n];', start);
  if (end === -1) return new Map();
  const body = text.slice(start, end).replace(/^\s*\/\/.*$/gm, '');

  const out = new Map();
  const keyRe = /key:\s*"([^"]+)"/g;
  let m;
  while ((m = keyRe.exec(body))) {
    const name = m[1];
    const rest = body.slice(m.index + m[0].length);
    const vi = rest.indexOf('value:');
    if (vi === -1) continue;
    const value = readValue(rest.slice(vi + 'value:'.length));
    if (value === null) continue;
    if (name === 'X-Robots-Tag') continue;
    out.set(name, value);
  }
  return out;
}

/** A string literal, or an array of them followed by .join("sep"). */
function readValue(src) {
  const s = src.replace(/^\s+/, '');
  if (s.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(s);
    return m ? m[1] : null;
  }
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close === -1) return null;
    const parts = [...s.slice(1, close).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
    const join = /^\s*\.join\(\s*"((?:[^"\\]|\\.)*)"\s*\)/.exec(s.slice(close + 1));
    if (!parts.length || !join) return null;
    return parts.join(join[1]);
  }
  return null;
}

/** Fetch-style header read that tolerates both Headers and a plain object. */
export function h(res, name) {
  const key = name.toLowerCase();
  if (res.headers && typeof res.headers.get === 'function') return res.headers.get(key) || '';
  return (res.headers && res.headers[key]) || '';
}

/** Space out live probes so a nightly run never looks like a burst. */
export const pace = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/**
 * ctx.http with exactly one retry on a transport failure.
 *
 * Not a retry loop and not a retry on a status — a 403 or a 500 is an answer
 * and is graded as one. This only covers the single dropped connection that a
 * 2-vCPU box sharing an uplink with the team's WordPress produces now and
 * then. Without it, one transient "fetch failed" a week turns into a finding,
 * and a suite that reports a finding for the network being the network is one
 * people learn to scroll past. If both attempts fail, the caller still reports
 * it: an unreachable probe is never a pass.
 */
export async function httpOnce(ctx, url, init = {}) {
  const first = await ctx.http(url, init);
  if (first.ok) return first;
  await pace(600);
  const second = await ctx.http(url, init);
  if (second.ok) return second;
  return { ...second, error: `${first.error} (retried: ${second.error})` };
}
