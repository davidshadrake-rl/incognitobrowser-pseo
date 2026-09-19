/**
 * The in-process API harness the offline `api-*` checks read their facts from.
 *
 * This file registers NO checks — its default export is an empty array. It
 * exists because seven API checks all need the same expensive thing: the REAL
 * route handlers from app/**\/route.ts, invoked for real, with every outbound
 * boundary (sockets, DNS) replaced by a recorder, so a check can assert what a
 * request DID rather than what its source file contains.
 *
 * WHY THIS LAYER EXISTS, in one paragraph. Every abuse control on this API is
 * currently pinned by a regex over the route's source text — tests/api-security.ts
 * around line 249, tests/hardening.test.ts line 53, tests/cors-security.test.ts,
 * tests/error-handling.test.ts and tests/resource-bounds.test.ts all read
 * route.ts as a STRING and assert it contains the right words. That style
 * cannot see a control that has been reordered below the thing it protects, a
 * branch that is skipped, or a guard that is present but unreachable. This repo
 * has already paid for exactly that mistake once: tests/ssrf-protection.test.ts
 * graded a hand-copied replica of isBlockedHostname and reported green straight
 * through two live SSRF bypasses. The same shape hid the replay fail-open —
 * a grep for the literal string 'replay-store-unavailable' passed while the
 * guard it names was skipped whenever getRedisClient() returned null.
 *
 * WHAT IS REAL IN HERE, and what is not:
 *   - The route modules are the real .ts files, loaded through Node's own type
 *     stripping. No replica, no re-implementation.
 *   - lib/origin.ts, lib/altcha.ts, lib/rate-limit.ts, lib/event-schema.ts are
 *     the real modules the routes import.
 *   - globalThis.fetch is a RECORDER. It never opens a socket. That is what
 *     makes "no outbound request was made" an observable fact rather than an
 *     inference, and it is the specific reason these checks can be
 *     every-commit: no scenario in this file can reach the network.
 *   - dns.lookup is stubbed through util.promisify.custom, because
 *     app/scan-url/route.ts promisifies node:dns's lookup at module load.
 *     Every call is recorded, so a scenario that expected the resolve branch
 *     and finds the stub was never called is reported as broken
 *     instrumentation rather than as a pass.
 *   - Redis is the ONE place the real library is kept: the replay scenarios
 *     point REDIS_URL at a closed loopback port and let the real ioredis fail
 *     the way it fails on the droplet when redis-server is down. A fake that
 *     "returns an error" would be grading the fake's idea of failure; the
 *     property under test is what lib/rate-limit.ts's client backoff does to
 *     app/scan-url/route.ts, and that needs the real client's error timing.
 *
 * Each scenario runs under a fresh module generation (`?apigen=N` on every
 * repo module's URL), so lib/origin.ts's cached allowlist, lib/rate-limit.ts's
 * _client/_clientFailedAt singletons and app/scan-url/route.ts's in-flight
 * counter all start clean. Without that, one scenario's sick Redis client
 * silently decides the next scenario's verdict — which is how a suite starts
 * reporting things it did not measure.
 *
 * The resolution-hook technique (the '@/' alias, extensionless 'next/server',
 * the json import attribute) is the same one scripts/security/checks/iast-probe.mjs
 * uses. It is duplicated rather than imported because that file belongs to
 * another discipline and memoises a different scenario set; sharing it would
 * couple two suites' fixtures together.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Skip } from '../lib/harness.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);

/** Registers no checks. This is the harness the api-* check files import. */
export default [];

// ---------------------------------------------------------------------------
// Parent side
// ---------------------------------------------------------------------------

let cached = null;

/**
 * Run the harness once and hand the same observations to every check that
 * asks. Seven checks share one ~1s child start rather than paying for seven.
 */
export function observe() {
  if (!cached) cached = Promise.resolve().then(runChild);
  return cached;
}

function runChild() {
  const attempts = [
    ['--no-warnings', THIS_FILE, '--child'],
    // Node 22.18 turns type stripping on by default; older 22.x needs the flag.
    // Asking explicitly is the difference between a check that runs on someone
    // else's laptop and one that mysteriously skips there.
    ['--no-warnings', '--experimental-strip-types', THIS_FILE, '--child'],
  ];
  let last = null;
  for (const args of attempts) {
    const r = spawnSync(process.execPath, args, {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
      // A harness that inherited the developer's REDIS_URL, STATS_TOKEN or
      // ALLOWED_ORIGINS would be grading their shell, not the code. It gets a
      // clean environment and sets every value it depends on itself.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: '' },
    });
    last = r;
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('__APIPROBE__'));
    if (line) {
      const parsed = JSON.parse(line.slice('__APIPROBE__'.length));
      if (parsed.fatal) throw new Skip(`in-process API harness could not run: ${parsed.fatal}${parsed.stack ? ` (${parsed.stack})` : ''}`);
      return parsed;
    }
  }
  const stderr = String((last && last.stderr) || '').trim().split('\n').slice(-6).join(' | ');
  throw new Skip(`in-process API harness produced no result (node ${process.version}): ${stderr || 'no stderr'}`);
}

// ---------------------------------------------------------------------------
// Child side — everything below runs only in the spawned process.
// ---------------------------------------------------------------------------

if (process.argv[1] === THIS_FILE && process.argv.includes('--child')) {
  await child();
}

async function child() {
  const out = {};
  try {
    Object.assign(out, await run());
  } catch (err) {
    out.fatal = `${err && err.message ? err.message : err}`;
    out.stack = err && err.stack ? String(err.stack).split('\n').slice(1, 4).join(' | ') : null;
  }
  process.stdout.write(`__APIPROBE__${JSON.stringify(out)}\n`);
  // The real ioredis scenarios leave reconnect timers behind; nothing after
  // this line matters and a hung child would look like a broken check.
  process.exit(0);
}

async function run() {
  const { registerHooks } = await import('node:module');
  const { pathToFileURL, fileURLToPath: toPath } = await import('node:url');
  const { existsSync, readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { promisify } = await import('node:util');
  const dns = (await import('node:dns')).default;
  const crypto = await import('node:crypto');
  const net = await import('node:net');

  const ROOT = join(dirname(THIS_FILE), '..', '..', '..');
  const ROOT_URL = pathToFileURL(ROOT).href;

  // EGRESS LEDGER. These checks are allowed to run on every commit — inside
  // the unit suite that gates every build — on one claim: nothing in here can
  // reach the network. That claim is worth more than a comment, so every TCP
  // connection this process opens is recorded and the destinations are
  // reported back, and api-error-shape turns a non-loopback one into a finding
  // against itself. The only legitimate entry is the closed loopback port the
  // Redis scenarios point at. undici, ioredis and node:http all end up here.
  const egress = [];
  {
    const realConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function patchedConnect(...args) {
      // Node normalises connect's arguments before it reaches here, so the
      // first argument is usually an ARRAY whose head is the options object —
      // which is what the first version of this ledger missed, recording
      // nothing at all and reporting a clean sheet it had not earned.
      let o = args[0];
      if (Array.isArray(o)) o = o[0];
      if (o && typeof o === 'object') {
        egress.push(`${o.host || o.path || o.hostname || '?'}:${o.port ?? '?'}`);
      } else if (typeof o === 'number' || typeof o === 'string') {
        egress.push(`${args[1] ?? '?'}:${o}`);
      }
      return realConnect.apply(this, args);
    };
  }

  const S = {
    gen: 0,
    fetches: [],
    dnsCalls: [],
    dnsAnswer: [{ address: '93.184.216.34', family: 4 }],
    dnsMode: 'ok', // ok | throw | empty
    fetchMode: 'html', // html | throw | abort | redirect | broken-body
  };

  const bust = (url) => (url.startsWith(ROOT_URL) && !url.includes('/node_modules/') && !url.includes('apigen=')
    ? `${url}?apigen=${S.gen}` : url);
  // TypeScript's resolveJsonModule lets lib/*.ts import data/*.json with no
  // import attribute; plain Node demands one. Supplying it here keeps the
  // application source untouched — editing app code to suit a test is how a
  // harness starts lying about what it graded.
  const withJson = (r) => (r && typeof r.url === 'string' && r.url.split('?')[0].endsWith('.json')
    ? { ...r, format: 'json', importAttributes: { type: 'json' } } : r);

  registerHooks({
    resolve(spec, ctx, next) {
      if (spec.startsWith('@/')) {
        const base = join(ROOT, spec.slice(2));
        for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'route.ts'), join(base, 'index.ts')]) {
          if (existsSync(c) && statSync(c).isFile()) return withJson({ url: bust(pathToFileURL(c).href), shortCircuit: true });
        }
      }
      try {
        const r = next(spec, ctx);
        return withJson({ ...r, url: bust(r.url) });
      } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND' && err.url) {
          const base = toPath(err.url);
          for (const c of [`${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
            if (existsSync(c)) return withJson({ url: bust(pathToFileURL(c).href), shortCircuit: true });
          }
        }
        throw err;
      }
    },
  });

  // The DNS stub. app/scan-url/route.ts does promisify(dnsLookupCb) at module
  // load, and util.promisify honours a promisify.custom property on the
  // function object ahead of everything else — so defining it here captures
  // the route's lookup no matter when the route is imported.
  dns.lookup[promisify.custom] = async (hostname, opts) => {
    S.dnsCalls.push({ hostname, all: Boolean(opts && opts.all) });
    if (S.dnsMode === 'throw') {
      const e = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      e.code = 'ENOTFOUND';
      throw e;
    }
    if (S.dnsMode === 'empty') return [];
    return S.dnsAnswer;
  };

  // The socket recorder. Nothing below this line reaches the network, which is
  // the whole reason these checks are allowed to run on every commit.
  globalThis.fetch = async (url, init = {}) => {
    S.fetches.push({ url: String(url), redirect: init.redirect ?? null });
    if (S.fetchMode === 'throw') throw new TypeError('fetch failed');
    if (S.fetchMode === 'abort') { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; }
    if (S.fetchMode === 'redirect') {
      // A plain public Location. An earlier draft used a loopback URL here and
      // the error-shape check then flagged the route's own documented
      // `redirectTo` field as leaked internal detail — a false positive
      // manufactured entirely by the fixture.
      return new Response(null, { status: 302, headers: { location: 'https://example.net/moved' } });
    }
    if (S.fetchMode === 'broken-body') {
      // A target that answers and then dies mid-body. readCappedText's reader
      // rejects, which is the 502 branch at scan-url/route.ts:332.
      const body = new ReadableStream({ pull(c) { c.error(new Error('socket hang up')); } });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('<html><head><title>t</title></head><body></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  };

  const HOST = 'api.incognitobrowser.io';
  const ORIGIN = 'https://incognitobrowser.io';
  const EVIL = 'https://evil.example';
  const SECRET = crypto.randomBytes(32).toString('hex');

  function baseEnv() {
    process.env.ALTCHA_HMAC_KEY = SECRET;
    process.env.ALLOWED_ORIGINS = ORIGIN;
    delete process.env.REDIS_URL;
    delete process.env.STATS_TOKEN;
    delete process.env.DEBUG_ORIGINS;
  }

  function nextGen() {
    S.gen += 1;
    S.fetches = [];
    S.dnsCalls = [];
    S.dnsMode = 'ok';
    S.dnsAnswer = [{ address: '93.184.216.34', family: 4 }];
    S.fetchMode = 'html';
    baseEnv();
  }

  const load = (rel) => import(`${pathToFileURL(join(ROOT, rel)).href}?apigen=${S.gen}`);
  const { NextRequest } = await import('next/server');

  const ROUTES = {
    challenge: 'app/challenge/route.ts',
    'scan-url': 'app/scan-url/route.ts',
    ip: 'app/ip/route.ts',
    event: 'app/event/route.ts',
    stats: 'app/stats/route.ts',
    'dns-leak/start': 'app/dns-leak/start/route.ts',
    'dns-leak/result': 'app/dns-leak/result/route.ts',
  };
  /** The six routes that carry an Origin gate. /stats is bearer-protected instead. */
  const ORIGIN_GATED = ['challenge', 'scan-url', 'ip', 'event', 'dns-leak/start', 'dns-leak/result'];

  function mkReq(path, { method = 'POST', body = '{}', headers = {}, host = HOST, origin = ORIGIN, ip = '203.0.113.9' } = {}) {
    const h = { 'content-type': 'application/json', host, 'x-forwarded-for': ip, ...headers };
    if (origin !== null) h.origin = origin;
    return new NextRequest(`https://${host}${path}`, {
      method,
      headers: h,
      body: method === 'POST' ? body : undefined,
    });
  }

  async function readBody(res) {
    const text = await res.text().catch(() => '');
    try { return JSON.parse(text); } catch { return text ? { _raw: text.slice(0, 200) } : null; }
  }

  function headerNames(res) {
    const out = [];
    res.headers.forEach((_v, k) => out.push(k.toLowerCase()));
    return out;
  }

  /**
   * INSTRUMENTATION GUARD. Everything in the origin group turns on the Host
   * header reaching the route. undici treats `host` as a forbidden header in
   * some modes, and if it were dropped the spoof scenarios would all come back
   * "403, all good" while having tested nothing at all. That is the precise
   * failure this suite exists to prevent, so it is checked before anything
   * else runs and is fatal rather than quiet.
   */
  {
    const probe = mkReq('/x', { host: 'evil.example' });
    const seen = probe.headers.get('host');
    if (seen !== 'evil.example') {
      throw new Error(`Host header does not survive NextRequest construction (got ${JSON.stringify(seen)}); every origin/Host scenario would be vacuous`);
    }
  }

  /** Mint and solve a real proof-of-work. maxnumber=1 keeps the search instant. */
  async function powFor(alt, { maxnumber = 1, ttl = 90 } = {}) {
    const ch = alt.createChallenge(maxnumber, ttl);
    let number = null;
    for (let n = 0; n <= ch.maxnumber; n++) {
      if (crypto.createHash('sha256').update(ch.salt + n).digest('hex') === ch.challenge) { number = n; break; }
    }
    if (number === null) throw new Error('could not solve our own challenge — altcha.createChallenge changed shape');
    const solution = { algorithm: 'SHA-256', salt: ch.salt, number, signature: ch.signature, expires: ch.expires };
    return { challenge: ch, solution, header: alt.encodeAltchaAuthHeader(solution) };
  }

  const out = {};

  // =========================================================================
  // 1. Origin gate: can a client-supplied Host satisfy it?
  // =========================================================================
  out.origin = { unit: [], routes: [] };
  {
    nextGen();
    const origin = await load('lib/origin.ts');
    const UNIT = [
      { label: 'spoofed-origin-and-host', origin: EVIL, host: 'evil.example', expect: false,
        why: 'Apache runs ProxyPreserveHost On, so the client writes this Host. If matching it is enough, ALLOWED_ORIGINS is not a gate.' },
      { label: 'spoofed-with-port', origin: 'https://evil.example:8443', host: 'evil.example:8443', expect: false,
        why: 'the comparison keeps ports, so the port form must not be a second door' },
      { label: 'foreign-origin-real-host', origin: EVIL, host: HOST, expect: false, why: 'control: the ordinary refusal must still refuse' },
      { label: 'allowlisted-origin', origin: ORIGIN, host: HOST, expect: true, why: 'control: the static site calling the API cross-origin' },
      { label: 'api-own-host-same-origin', origin: `https://${HOST}`, host: HOST, expect: true,
        why: 'BLAST RADIUS: dropping the same-origin shortcut must not 403 the API calling itself — production already shipped that outage once' },
      { label: 'no-origin', origin: null, host: HOST, expect: false, why: 'a missing Origin is not a pass' },
    ];
    for (const c of UNIT) {
      let got;
      try { got = origin.isOriginAllowed(c.origin, c.host); } catch (err) { got = `threw: ${err.message}`; }
      out.origin.unit.push({ ...c, got });
    }

    for (const name of ORIGIN_GATED) {
      nextGen();
      const mod = await load(ROUTES[name]);
      const res = await mod.POST(mkReq(`/${name}`, { origin: EVIL, host: 'evil.example' }));
      const body = await readBody(res);
      out.origin.routes.push({
        label: name, status: res.status, error: body && body.error, reason: body && body.reason,
        acao: res.headers.get('access-control-allow-origin'),
      });
    }
  }

  // =========================================================================
  // 2. Control ORDER: origin -> rate limit -> proof-of-work -> parse -> fetch
  // =========================================================================
  out.order = [];
  {
    // (a) No Origin at all: 403, and no rate-limit budget spent. If the limiter
    //     ran first, an unauthenticated caller could exhaust a victim bucket.
    for (const name of ORIGIN_GATED) {
      nextGen();
      const mod = await load(ROUTES[name]);
      const res = await mod.POST(mkReq(`/${name}`, { origin: null }));
      out.order.push({
        label: `${name}: no Origin`, status: res.status, expectStatus: 403,
        rateLimitHeader: res.headers.get('x-ratelimit-limit'), expectRateLimitHeader: null,
        why: 'the origin gate must run before the rate limiter, so a refused caller cannot spend a bucket',
      });
    }

    // (b) Good Origin, no proof-of-work, syntactically invalid JSON.
    //     401 no_solution proves the PoW check ran BEFORE request.text()/JSON.parse.
    //     A 400 'Invalid JSON body.' would mean an unauthenticated caller can
    //     make the service buffer and parse an arbitrary body.
    {
      nextGen();
      const mod = await load(ROUTES['scan-url']);
      const res = await mod.POST(mkReq('/scan-url', { body: '{not json' }));
      const body = await readBody(res);
      out.order.push({
        label: 'scan-url: no PoW + invalid JSON', status: res.status, expectStatus: 401,
        reason: body && body.reason, expectReason: 'no_solution',
        rateLimitHeader: res.headers.get('x-ratelimit-limit'), expectRateLimitHeader: 'present',
        why: 'proof-of-work must gate the body parse; the rate-limit header proves the limiter already ran',
      });
    }

    // (c) Good Origin + a REAL solved proof-of-work + a blocked target.
    //     The SSRF guard must refuse with 400 and no socket may be opened.
    {
      nextGen();
      const alt = await load('lib/altcha.ts');
      const { header } = await powFor(alt);
      const mod = await load(ROUTES['scan-url']);
      const res = await mod.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'http://169.254.169.254/' }), headers: { authorization: header },
      }));
      const body = await readBody(res);
      out.order.push({
        label: 'scan-url: valid PoW + cloud-metadata target', status: res.status, expectStatus: 400,
        error: body && body.error, fetchCount: S.fetches.length, expectFetchCount: 0,
        dnsCalls: S.dnsCalls.length, expectDnsCalls: 0,
        why: 'the SSRF guard must refuse before anything is resolved or fetched',
      });
    }

    // (c2) The scheme rewrite runs BEFORE the protocol allowlist.
    //      app/scan-url/route.ts:200 turns anything not starting with "http"
    //      into `https://<the whole string>`, so the `['http:','https:']` check
    //      four lines later never sees a foreign scheme — `file:///etc/passwd`
    //      arrives at it as an https URL whose HOSTNAME is the word "file".
    //      A single-label hostname is then handed to the resolver, which on a
    //      host with a DNS search suffix is not nothing. Recorded here because
    //      it is an ordering defect, which is what this check is for.
    {
      nextGen();
      const alt = await load('lib/altcha.ts');
      const { header } = await powFor(alt);
      const mod = await load(ROUTES['scan-url']);
      const res = await mod.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'file:///etc/passwd' }), headers: { authorization: header },
      }));
      const body = await readBody(res);
      out.order.push({
        label: 'scan-url: file:// scheme vs the protocol allowlist', status: res.status, expectStatus: 400,
        error: (body && body.error) || null,
        resolvedHostnames: S.dnsCalls.map((d) => d.hostname), expectDnsCalls: 0,
        fetchCount: S.fetches.length, expectFetchCount: 0,
        why: 'the protocol allowlist must not be reachable only by schemes that happen to start with the letters http',
      });
    }

    // (d) The control. Without a scenario that DOES reach the fetch, every
    //     "0 sockets" above could mean the harness never got that far — a
    //     reassuring green over nothing.
    {
      nextGen();
      const alt = await load('lib/altcha.ts');
      const { header } = await powFor(alt);
      const mod = await load(ROUTES['scan-url']);
      const res = await mod.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: header },
      }));
      out.order.push({
        label: 'CONTROL scan-url: valid PoW + public target reaches the fetch', status: res.status, expectStatus: 200,
        fetchCount: S.fetches.length, expectFetchCount: 1, dnsCalls: S.dnsCalls.length, expectDnsCalls: 1,
        why: 'proves the harness can drive a request all the way to the outbound call',
      });
    }
  }

  // =========================================================================
  // 3. Method matrix — module shape only (offline half)
  // =========================================================================
  out.methods = [];
  {
    const VERBS = ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
    for (const [name, rel] of Object.entries(ROUTES)) {
      nextGen();
      const mod = await load(rel);
      const exported = Object.keys(mod);
      out.methods.push({
        label: name,
        exported,
        // Reviewer correction: do NOT demand an exact export set. app/ip
        // legitimately exports buildIpResponse, which app/dns-leak/start
        // imports. The property is that no OTHER http verb is exported.
        strayVerbs: VERBS.filter((v) => exported.includes(v)),
        hasPost: exported.includes('POST'),
        hasOptions: exported.includes('OPTIONS'),
      });
    }
  }

  // =========================================================================
  // 4. Proof-of-work forgery matrix
  // =========================================================================
  // Trimmed deliberately. tests/api-security.test.ts already covers a tampered
  // signature, an in-range wrong number, an out-of-range number, expired,
  // expires_too_far, a bad algorithm and malformed input; re-asserting those
  // would be a second green file grading the same property. What is left here
  // is what nothing covers: extending `expires` on an otherwise valid token,
  // mixing two challenges, a truncated signature, and a non-integer number.
  out.pow = { unit: [], route: [] };
  {
    nextGen();
    const alt = await load('lib/altcha.ts');
    const a = await powFor(alt);
    const b = await powFor(alt);

    const CASES = [
      { label: 'CONTROL untouched solution', sol: { ...a.solution }, expectValid: true,
        why: 'without this row every "invalid" below could mean the harness never minted a working token' },
      { label: 'expires extended by 300s', sol: { ...a.solution, expires: a.solution.expires + 300 }, expectValid: false,
        why: 'expires is inside the HMAC message; a refactor that drops it would make tokens extendable at will' },
      { label: 'signature from A, salt+number from B', sol: { ...b.solution, signature: a.solution.signature }, expectValid: false,
        why: 'the signature must bind the salt it was issued with, not merely be a signature we once produced' },
      { label: 'salt swapped to B, rest from A', sol: { ...a.solution, salt: b.solution.salt }, expectValid: false,
        why: 'the other direction of the same mix: the salt is inside the signed message, so a borrowed salt must not verify' },
      { label: 'signature truncated to 63 chars', sol: { ...a.solution, signature: a.solution.signature.slice(0, 63) }, expectValid: false,
        why: 'the length guard is the only thing stopping a short-circuit compare on a prefix' },
      { label: 'number as numeric string', sol: { ...a.solution, number: String(a.solution.number) }, expectValid: false,
        why: 'string coercion in the hash would make the type check decorative' },
      { label: 'number as a float', sol: { ...a.solution, number: a.solution.number + 0.5 }, expectValid: false,
        why: 'typeof passes for a float; only the hash comparison refuses it' },
      { label: 'algorithm downgraded to SHA-1', sol: { ...a.solution, algorithm: 'SHA-1' }, expectValid: false,
        why: 'the algorithm field must be pinned, not negotiated' },
    ];
    for (const c of CASES) {
      const v = alt.verifySolution(c.sol);
      out.pow.unit.push({ label: c.label, why: c.why, expectValid: c.expectValid, valid: v.valid, reason: v.reason || null });
    }

    // The genuinely additive half: three forgeries driven through the REAL
    // route, so the gate is graded and not only the library behind it.
    const ROUTE_CASES = [
      { label: 'expires extended', sol: { ...a.solution, expires: a.solution.expires + 300 } },
      { label: 'cross-challenge signature', sol: { ...b.solution, signature: a.solution.signature } },
      { label: 'truncated signature', sol: { ...a.solution, signature: a.solution.signature.slice(0, 63) } },
    ];
    for (const c of ROUTE_CASES) {
      nextGen();
      const alt2 = await load('lib/altcha.ts');
      // The token must be minted by the SAME module generation the route uses,
      // or the shared ALTCHA_HMAC_KEY is the only thing making it verifiable.
      void alt2;
      const mod = await load(ROUTES['scan-url']);
      const res = await mod.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'https://example.com/' }),
        headers: { authorization: alt.encodeAltchaAuthHeader(c.sol) },
      }));
      const body = await readBody(res);
      out.pow.route.push({
        label: c.label, status: res.status, expectStatus: 401, reason: body && body.reason,
        fetchCount: S.fetches.length, expectFetchCount: 0,
      });
    }
  }

  // =========================================================================
  // 5. Redis-failure posture, per route
  // =========================================================================
  // A closed loopback port, and the REAL ioredis. This reproduces what the
  // droplet does when redis-server is stopped or flooded: getClient() hands
  // back a client, the first command errors, the 'error' handler stamps
  // _clientFailedAt, and getRedisClient() returns null for the next 10s while
  // getRedisStatus() says 'backoff'. The fail-open that shipped read that null
  // as "no Redis configured" and skipped the single-use claim entirely.
  out.redis = { closedPort: null, rows: [] };
  {
    // Bind and immediately close, so we know the port refuses rather than
    // guessing at one and maybe hitting somebody's dev service.
    const port = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port;
        srv.close(() => resolve(p));
      });
    });
    out.redis.closedPort = port;
    const DEAD = `redis://127.0.0.1:${port}`;

    // A NOTE ON TIME, because it is the dominant cost of the whole harness.
    // The real client takes ~600ms to give up: ECONNREFUSED, then the two
    // retryStrategy waits lib/rate-limit.ts configures (200ms, 400ms), then
    // null. That 600ms is a real production fact — it is what the first
    // request after a Redis outage costs a visitor — and paying it once per
    // module generation is the price of grading the real failure instead of a
    // fake's idea of one. So the generations are kept to two: one for the
    // replay pair, and one shared by the three fail-open routes, whose
    // requests are issued CONCURRENTLY so their client failures overlap.
    // Running them concurrently is safe only because none of these three
    // touches the fetch or DNS recorders.

    // /scan-url, twice with the SAME solved token, against a target the SSRF
    // guard refuses early — so nothing is fetched even if the request proceeds.
    // Its own generation, with a CLEAN client: that way the first attempt is
    // the one that poisons it, via rateLimit() earlier in the same request,
    // which is exactly how production enters this state.
    {
      nextGen();
      process.env.REDIS_URL = DEAD;
      const alt = await load('lib/altcha.ts');
      const { header } = await powFor(alt);
      const mod = await load(ROUTES['scan-url']);
      for (const attempt of [1, 2]) {
        const res = await mod.POST(mkReq('/scan-url', {
          body: JSON.stringify({ url: 'http://10.0.0.1/' }), headers: { authorization: header },
        }));
        const body = await readBody(res);
        const rl = await load('lib/rate-limit.ts');
        out.redis.rows.push({
          label: `scan-url replay attempt ${attempt}`, route: 'scan-url', status: res.status,
          reason: (body && body.reason) || null, error: (body && body.error) || null,
          redisStatus: rl.getRedisStatus(), fetchCount: S.fetches.length,
          why: 'a solved token must not buy a second scan just because the replay store is unreachable',
        });
      }
    }

    // The other three routes' DELIBERATELY DIFFERENT answers to the same
    // outage. They are pinned because "harmonising" them is an easy and
    // plausible refactor, and harmonising /scan-url to /event's fail-open is
    // the exact defect that shipped.
    {
      nextGen();
      process.env.REDIS_URL = DEAD;
      const TOKEN = 'x'.repeat(40);
      process.env.STATS_TOKEN = TOKEN;
      const FAIL_OPEN = [
        { route: 'event', req: () => mkReq('/event', { body: JSON.stringify({ event: 'tool_run', tool: 'whats-my-ip' }) }),
          why: 'counters fail OPEN on purpose: a page must never wait on analytics' },
        { route: 'dns-leak/start', req: () => mkReq('/dns-leak/start'),
          why: 'the id is still issued; the UI shows an honest "backend not configured" state' },
        { route: 'stats', req: () => mkReq('/stats', { headers: { authorization: `Bearer ${TOKEN}` } }),
          why: 'owner-facing counters report storage:none rather than pretending to a zero' },
      ];
      const answered = await Promise.all(FAIL_OPEN.map(async (c) => {
        const mod = await load(ROUTES[c.route]);
        const res = await mod.POST(c.req());
        const body = await readBody(res);
        return { label: c.route, route: c.route, why: c.why, status: res.status, body: body && typeof body === 'object' ? body : null };
      }));
      const rl = await load('lib/rate-limit.ts');
      for (const a of answered) out.redis.rows.push({ ...a, storage: a.body && a.body.storage, redisStatus: rl.getRedisStatus() });
    }

    // CONTROL: with REDIS_URL unset the same replay request must proceed to
    // the SSRF refusal. Without it, "everything 503s" could equally mean the
    // harness broke the route.
    {
      nextGen();
      const alt = await load('lib/altcha.ts');
      const { header } = await powFor(alt);
      const mod = await load(ROUTES['scan-url']);
      const res = await mod.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'http://10.0.0.1/' }), headers: { authorization: header },
      }));
      const body = await readBody(res);
      const rl = await load('lib/rate-limit.ts');
      out.redis.rows.push({
        label: 'CONTROL scan-url with REDIS_URL unset', route: 'scan-url-control', status: res.status,
        reason: (body && body.reason) || null, error: (body && body.error) || null,
        redisStatus: rl.getRedisStatus(), fetchCount: S.fetches.length,
        why: 'local dev degradation is documented and must still serve; proves the 503s above are the store, not the harness',
      });
    }
  }

  // =========================================================================
  // 6. /stats authorisation
  // =========================================================================
  out.stats = [];
  {
    const TOKEN = 'a'.repeat(40);
    const CASES = [
      { label: 'STATS_TOKEN unset', token: null, auth: `Bearer ${TOKEN}`, expect: 404,
        why: 'the route does not exist for anyone until it is configured' },
      { label: 'no Authorization header', token: TOKEN, auth: null, expect: 401, why: 'no bearer, no counters' },
      { label: 'wrong token, same length', token: TOKEN, auth: `Bearer ${'b'.repeat(40)}`, expect: 401,
        why: 'the equal-length path is the one timingSafeEqual exists for' },
      { label: 'wrong token, shorter', token: TOKEN, auth: 'Bearer short', expect: 401,
        why: 'timingSafeEqual THROWS on unequal lengths; the length guard must catch it first, not a 500' },
      { label: 'wrong token, longer', token: TOKEN, auth: `Bearer ${'a'.repeat(80)}`, expect: 401, why: 'as above, from the other side' },
      { label: 'lowercase bearer scheme', token: TOKEN, auth: `bearer ${TOKEN}`, expect: 401,
        why: 'the compare is over the whole header, so the scheme is part of the secret material' },
      // NOT a near-miss acceptance, and the row says so rather than red-lining
      // a non-finding: RFC 9110 field values have their surrounding whitespace
      // stripped, and undici does it before the route ever sees the header, so
      // what reaches the compare is the exact token. Kept because the first
      // draft of this check expected 401 here and would have reported the HTTP
      // layer's own normalisation as an authorisation defect.
      { label: 'token with trailing space (stripped by the HTTP layer)', token: TOKEN, auth: `Bearer ${TOKEN} `, expect: 200,
        why: 'documents where the trimming happens, so nobody "fixes" the route for it' },
      { label: 'double space after Bearer', token: TOKEN, auth: `Bearer  ${TOKEN}`, expect: 401,
        why: 'interior whitespace is NOT normalised, so this is the real near-miss row' },
      { label: 'correct token', token: TOKEN, auth: `Bearer ${TOKEN}`, expect: 200, why: 'CONTROL: the owner can still read their counters' },
      { label: 'day = *', token: TOKEN, auth: `Bearer ${TOKEN}`, body: JSON.stringify({ day: '*' }), expect: 400,
        why: 'day is interpolated into a Redis SCAN MATCH pattern; the regex is the only thing between input and the keyspace' },
      { label: 'day = 2026-01-01*', token: TOKEN, auth: `Bearer ${TOKEN}`, body: JSON.stringify({ day: '2026-01-01*' }), expect: 400,
        why: 'a prefix that passes a sloppier check would widen the MATCH' },
      { label: 'declared content-length 2 MB', token: TOKEN, auth: `Bearer ${TOKEN}`,
        headers: { 'content-length': '2000000' }, expect: 413,
        why: 'the Apache cap matches on Content-Length; the app must not buffer megabytes to read one date' },
    ];
    for (const c of CASES) {
      nextGen();
      if (c.token) process.env.STATS_TOKEN = c.token;
      const mod = await load(ROUTES.stats);
      const headers = { ...(c.headers || {}) };
      if (c.auth !== null && c.auth !== undefined) headers.authorization = c.auth;
      let res; let threw = null;
      try { res = await mod.POST(mkReq('/stats', { body: c.body || '{}', headers })); }
      catch (err) { threw = `${err && err.name}: ${err && err.message}`; }
      const body = res ? await readBody(res) : null;
      out.stats.push({
        label: c.label, why: c.why, expect: c.expect, threw,
        status: res ? res.status : 0,
        hasCounts: Boolean(body && Object.prototype.hasOwnProperty.call(body, 'counts')),
        acao: res ? res.headers.get('access-control-allow-origin') : null,
        bodyKeys: body && typeof body === 'object' ? Object.keys(body) : [],
      });
    }
  }

  // =========================================================================
  // 7. What leaves in a response body
  // =========================================================================
  // Two properties in one sweep, because both are about a response carrying
  // more than it should:
  //   (a) every error body is a fixed string — no err.message, no stack, no
  //       DNS or filesystem detail from the attacker-chosen target;
  //   (b) /ip's x-geo-* passthrough. Nothing on the droplet sets those headers
  //       and the vhost strips only the four IP ones, so in production every
  //       geo value in that response is the caller's own input, reflected.
  out.errors = [];
  out.geo = [];
  {
    const scenarios = [
      ['challenge: foreign origin', 'challenge', () => ({ origin: EVIL })],
      ['ip: foreign origin', 'ip', () => ({ origin: EVIL })],
      ['dns-leak/start: foreign origin', 'dns-leak/start', () => ({ origin: EVIL })],
      ['event: foreign origin', 'event', () => ({ origin: EVIL })],
      ['event: invalid JSON', 'event', () => ({ body: '{nope' })],
      ['event: unknown event name', 'event', () => ({ body: JSON.stringify({ event: 'not-a-real-event' }) })],
      ['event: declared 3 MB body', 'event', () => ({ headers: { 'content-length': '3000000' } })],
      ['dns-leak/result: invalid JSON', 'dns-leak/result', () => ({ body: '{nope' })],
      ['dns-leak/result: malformed id', 'dns-leak/result', () => ({ body: JSON.stringify({ id: 'NOT-VALID' }) })],
      ['dns-leak/result: declared 2 MB body', 'dns-leak/result', () => ({ headers: { 'content-length': '2000000' } })],
      ['scan-url: foreign origin', 'scan-url', () => ({ origin: EVIL })],
      ['scan-url: no proof-of-work', 'scan-url', () => ({})],
    ];
    for (const [label, name, make] of scenarios) {
      nextGen();
      const mod = await load(ROUTES[name]);
      const res = await mod.POST(mkReq(`/${name}`, make()));
      const body = await readBody(res);
      out.errors.push({ label, status: res.status, body, headers: headerNames(res) });
    }

    // The /scan-url error branches that need a solved token. Each one is
    // reached with the outbound boundary stubbed — no socket, no resolver.
    const POW_SCENARIOS = [
      ['scan-url: invalid JSON', { body: '{nope' }, {}],
      ['scan-url: declared 5 MB body', { body: '{}', headers: { 'content-length': '5000000' } }, {}],
      ['scan-url: body over the cap', { body: JSON.stringify({ url: `https://example.com/${'a'.repeat(4000)}` }) }, {}],
      ['scan-url: url missing', { body: JSON.stringify({ nope: 1 }) }, {}],
      ['scan-url: url too long', { body: JSON.stringify({ url: `https://example.com/${'a'.repeat(2100)}` }) }, {}],
      ['scan-url: unparseable url', { body: JSON.stringify({ url: 'http://[bad' }) }, {}],
      // httpx:, not file:. `file:///etc/passwd` never reaches the protocol
      // allowlist at all — see the scheme-rewrite scenario in the order group
      // for why — so using it here would grade a branch that was not taken.
      ['scan-url: non-http scheme', { body: JSON.stringify({ url: 'httpx://example.com/' }) }, {}],
      ['scan-url: private literal', { body: JSON.stringify({ url: 'http://10.0.0.1/' }) }, {}],
      ['scan-url: non-standard port', { body: JSON.stringify({ url: 'http://example.com:6379/' }) }, {}],
      ['scan-url: name resolves private', { body: JSON.stringify({ url: 'https://example.com/' }) }, { dnsAnswer: [{ address: '127.0.0.1', family: 4 }] }],
      ['scan-url: name does not resolve', { body: JSON.stringify({ url: 'https://example.com/' }) }, { dnsMode: 'throw' }],
      ['scan-url: empty resolver answer', { body: JSON.stringify({ url: 'https://example.com/' }) }, { dnsMode: 'empty' }],
      ['scan-url: outbound fetch fails', { body: JSON.stringify({ url: 'https://example.com/' }) }, { fetchMode: 'throw' }],
      ['scan-url: outbound fetch times out', { body: JSON.stringify({ url: 'https://example.com/' }) }, { fetchMode: 'abort' }],
      ['scan-url: target redirects', { body: JSON.stringify({ url: 'https://example.com/' }) }, { fetchMode: 'redirect' }],
      ['scan-url: target dies mid-body', { body: JSON.stringify({ url: 'https://example.com/' }) }, { fetchMode: 'broken-body' }],
    ];
    for (const [label, init, state] of POW_SCENARIOS) {
      nextGen();
      Object.assign(S, state);
      const alt = await load('lib/altcha.ts');
      const { header } = await powFor(alt);
      const mod = await load(ROUTES['scan-url']);
      const res = await mod.POST(mkReq('/scan-url', { ...init, headers: { authorization: header, ...(init.headers || {}) } }));
      const body = await readBody(res);
      out.errors.push({ label, status: res.status, body, headers: headerNames(res), fetchCount: S.fetches.length });
    }

    // /stats 404 and 401 bodies.
    for (const [label, token, auth] of [['stats: unconfigured', null, 'Bearer x'], ['stats: bad bearer', 'a'.repeat(40), 'Bearer b']]) {
      nextGen();
      if (token) process.env.STATS_TOKEN = token;
      const mod = await load(ROUTES.stats);
      const res = await mod.POST(mkReq('/stats', { headers: { authorization: auth } }));
      const body = await readBody(res);
      out.errors.push({ label, status: res.status, body, headers: headerNames(res) });
    }

    // (b) the /ip geo passthrough.
    const GEO = [
      { label: 'no geo headers present', headers: {},
        why: 'nothing on the droplet sets these; the honest answer is null, not an empty string' },
      { label: '4 KB x-geo-city', headers: { 'x-geo-city': 'A'.repeat(4096) },
        why: 'the value is the caller\'s own input and is reflected with no length bound' },
      { label: 'undecodable x-geo-country', headers: { 'x-geo-country': '%E0%A4%A' },
        why: 'decodeURIComponent throws on this; the catch must return the raw value, not a 500' },
    ];
    for (const g of GEO) {
      nextGen();
      const mod = await load(ROUTES.ip);
      const res = await mod.POST(mkReq('/ip', { headers: g.headers }));
      const body = await readBody(res);
      out.geo.push({
        label: g.label, why: g.why, status: res.status,
        city: body && typeof body.city === 'string' ? `len=${body.city.length}` : body && body.city,
        region: body && body.region, countryCode: body && body.countryCode,
        country: body && body.country, timezone: body && body.timezone,
      });
    }
  }

  // =========================================================================
  // 8. Dead debug export
  // =========================================================================
  // lib/rate-limit.ts exports getRedisDiagnostic, whose own comment says it is
  // "surfaced via response headers". If that ever becomes true, the API starts
  // announcing its Redis URL state and last error to anyone who asks.
  {
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(join(ROOT, 'app'));
    walk(join(ROOT, 'lib'));
    const callers = files.filter((f) => {
      const src = readFileSync(f, 'utf-8');
      // The definition itself is not a call site.
      const withoutDef = src.replace(/export function getRedisDiagnostic[\s\S]*?\n}/, '');
      return /getRedisDiagnostic\s*\(/.test(withoutDef);
    }).map((f) => f.slice(ROOT.length + 1));
    out.diagnostic = { scanned: files.length, callers };
  }

  // Everything this process connected to, deduped. Loopback is expected (the
  // closed Redis port); anything else means the boundary stubs stopped being
  // the only way out and these checks are no longer safe on every commit.
  const LOOPBACK = /^(127\.0\.0\.1|::1|localhost):/;
  out.egress = { all: [...new Set(egress)], offBox: [...new Set(egress.filter((e) => !LOOPBACK.test(e)))] };

  return out;
}
