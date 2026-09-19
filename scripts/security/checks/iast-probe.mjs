/**
 * The instrumented in-process harness the IAST checks observe.
 *
 * This file registers NO checks (its default export is an empty array). It
 * exists because the four `iast-*` checks all need the same thing: the REAL
 * route handlers, running for real, with every side-effect boundary replaced
 * by a recorder — so a check can ask "did this request open a socket?" rather
 * than "does the source contain the string that would have stopped it?".
 *
 * Why this layer exists at all. The abuse-resistance controls on this API are
 * pinned almost entirely by source greps. tests/hardening.test.ts says so in
 * its own header; tests/resource-bounds.test.ts asserts the literal string
 * `readCappedText(response, MAX_BODY_SIZE)`; tests/ssrf-resolve.test.ts
 * asserts the route source contains `dnsLookup(parsedUrl.hostname`. None of
 * them observes what the route DOES. On the other side, scripts/security-smoke.mjs
 * is black-box over the network — it sees a status code and cannot see whether
 * an outbound socket was opened, which address it went to, or whether a Redis
 * write happened. Everything that went wrong on 2026-09-18 lived in that gap:
 * a replay check that failed OPEN on a null Redis client while a grep for the
 * string `replay-store-unavailable` reported green, and SSRF bypasses that a
 * status-code probe could only catch one shape of.
 *
 * How it works, and what is real in it:
 *   - The route modules are the real .ts files, imported through node's own
 *     type stripping. No hand-copied replica. tests/ssrf-protection.test.ts
 *     graded a copy of isBlockedHostname for months and stayed green through
 *     two live bypasses; that mistake is not repeated here.
 *   - globalThis.fetch is a RECORDER. It never opens a socket, and it is what
 *     lets a check assert the absence of an outbound request.
 *   - dns.lookup is stubbed through `util.promisify.custom` on the shared
 *     function object — which is what app/scan-url/route.ts promisifies at
 *     module load — so the stub takes effect no matter when the route is
 *     imported. Every scenario records whether the stub was actually called;
 *     a dead stub would otherwise turn these into live-DNS tests that still
 *     pass, which is exactly the silent-green failure this suite exists for.
 *   - `ioredis` is replaced by a fake client with real SET-NX semantics. The
 *     rest of lib/rate-limit.ts — the 10s client backoff, the in-memory
 *     fallback, getRedisStatus() — is the REAL code, driven by making the fake
 *     client sick in the ways a loaded box makes the real one sick.
 *
 * Consequences: zero network calls, zero DNS queries, nothing touches the
 * droplet, and the whole thing runs in a few hundred milliseconds. That is why
 * these checks are every-commit and unconditionally safe against production.
 *
 * Module isolation: each scenario imports the route under a fresh `?iastgen=N`
 * query so module-level state (the cached Redis client, the in-flight counter,
 * the origin allowlist cache) starts clean. Without it, one scenario's sick
 * Redis client would silently decide the next scenario's verdict.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Skip } from '../lib/harness.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);

/** Registers no checks — this is the harness the iast-* check files import. */
export default [];

// ---------------------------------------------------------------------------
// Parent side: spawn the child once per suite run and hand the same
// observations to every check that asks for them.
// ---------------------------------------------------------------------------

let cached = null;

/**
 * Run the instrumented probe and return its observations.
 *
 * Memoised: four checks share one child process, so the whole IAST discipline
 * costs a single ~400ms node start rather than four.
 */
export function observe() {
  if (!cached) cached = Promise.resolve().then(runChild);
  return cached;
}

function runChild() {
  const attempts = [
    ['--no-warnings', THIS_FILE, '--child'],
    // Node 22.18 turns type stripping on by default; older 22.x needs the flag.
    // Asking for it explicitly is the difference between a working check and a
    // check that mysteriously skips on someone else's laptop.
    ['--no-warnings', '--experimental-strip-types', THIS_FILE, '--child'],
  ];
  let last = null;
  for (const args of attempts) {
    const r = spawnSync(process.execPath, args, {
      encoding: 'utf-8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      // A probe that inherited the developer's REDIS_URL or STATS_TOKEN would
      // be testing their environment, not the code. It gets a clean one.
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_OPTIONS: '',
      },
    });
    last = r;
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('__IAST_JSON__'));
    if (line) {
      const parsed = JSON.parse(line.slice('__IAST_JSON__'.length));
      if (parsed.fatal) throw new Skip(`instrumented probe could not run: ${parsed.fatal}`);
      return parsed;
    }
  }
  const stderr = String((last && last.stderr) || '').trim().split('\n').slice(-6).join(' | ');
  throw new Skip(`instrumented probe produced no result (node ${process.version}): ${stderr || 'no stderr'}`);
}

// ---------------------------------------------------------------------------
// Child side. Everything below runs only in the spawned process.
// ---------------------------------------------------------------------------

if (process.argv[1] === THIS_FILE && process.argv.includes('--child')) {
  await child();
}

async function child() {
  const out = {};
  try {
    const { runAll } = await buildHarness();
    Object.assign(out, await runAll());
  } catch (err) {
    out.fatal = `${err && err.message ? err.message : err}`;
    out.stack = err && err.stack ? String(err.stack).split('\n').slice(0, 5).join(' | ') : null;
  }
  process.stdout.write(`__IAST_JSON__${JSON.stringify(out)}\n`);
}

async function buildHarness() {
  const { registerHooks } = await import('node:module');
  const { pathToFileURL, fileURLToPath: toPath } = await import('node:url');
  const { existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { promisify } = await import('node:util');
  const dns = (await import('node:dns')).default;
  const crypto = await import('node:crypto');

  const ROOT = join(dirname(THIS_FILE), '..', '..', '..');
  const ROOT_URL = pathToFileURL(ROOT).href;

  // Shared recorder state. The fake ioredis module below is loaded as a data:
  // URL and reaches this object through globalThis, which is the same object
  // in that module graph.
  const S = {
    gen: 0,
    fetches: [],
    dnsCalls: [],
    dnsAnswer: [{ address: '93.184.216.34', family: 4 }],
    dnsThrow: false,
    fetchResponse: () => new Response('<html><head><title>t</title></head><body></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    redis: { mode: 'ok', calls: [], store: new Map(), counters: new Map(), constructed: 0 },
  };
  globalThis.__IAST = S;

  // A fake ioredis with real SET-NX semantics: `set(k,v,'EX',n,'NX')` returns
  // 'OK' the first time and null after, which is what makes the replay case a
  // real replay rather than an assertion about a mock. The `mode` switch is how
  // a scenario makes the client sick in the ways a loaded box does: an 'error'
  // event (what puts lib/rate-limit.ts into its 10s null-client backoff) and a
  // throwing command.
  const FAKE_IOREDIS = 'data:text/javascript,' + encodeURIComponent(`
    import { EventEmitter } from 'node:events';
    class FakeRedis extends EventEmitter {
      constructor(url) {
        super();
        const R = globalThis.__IAST.redis;
        R.constructed++;
        R.calls.push(['construct', url]);
        if (R.mode === 'error-event') {
          setImmediate(() => this.emit('error', new Error('READONLY connection reset by peer')));
        }
      }
      async set(key, value, ...rest) {
        const R = globalThis.__IAST.redis;
        R.calls.push(['set', key, value, ...rest]);
        if (R.mode === 'set-throws') throw new Error('Connection is closed.');
        if (rest.includes('NX') && R.store.has(key)) return null;
        R.store.set(key, value);
        return 'OK';
      }
      pipeline() {
        const R = globalThis.__IAST.redis;
        const ops = [];
        const api = {
          incr(k) { ops.push(['incr', k]); return api; },
          expire(k, s) { ops.push(['expire', k, s]); return api; },
          async exec() {
            R.calls.push(['pipeline', ...ops.map((o) => o.join(':'))]);
            if (R.mode === 'pipeline-throws') throw new Error('Connection is closed.');
            return ops.map(([op, k]) => {
              if (op !== 'incr') return [null, 1];
              const n = (R.counters.get(k) || 0) + 1;
              R.counters.set(k, n);
              return [null, n];
            });
          },
        };
        return api;
      }
      async scan() { return ['0', []]; }
      async mget() { return []; }
    }
    export default FakeRedis;
    export { FakeRedis as Redis };
  `);

  // Resolution hooks. Three jobs: the '@/…' alias vitest gets from its config,
  // extensionless 'next/server' (next ships no exports map, so node needs the
  // .js), and swapping ioredis for the recorder. The ?iastgen query gives each
  // scenario a fresh copy of every repo module.
  // Appending the generation twice would produce a THIRD distinct module URL
  // and therefore a third copy of lib/rate-limit.ts — which is exactly what
  // happened first time round: the probe read getRedisStatus() from a module
  // instance the route had never used, and reported a healthy store for a
  // request that had just been refused by a sick one. Bust once, or not at all.
  const bust = (url) => (url.startsWith(ROOT_URL) && !url.includes('/node_modules/') && !url.includes('iastgen=')
    ? `${url}?iastgen=${S.gen}` : url);
  // TypeScript's resolveJsonModule lets lib/*.ts import data/*.json with no
  // import attribute; plain node requires one. Supplying it here keeps the
  // route source untouched — the alternative is editing app code to suit the
  // test, which is how a harness starts lying about what it graded.
  const withJson = (r) => (r && typeof r.url === 'string' && r.url.split('?')[0].endsWith('.json')
    ? { ...r, format: 'json', importAttributes: { type: 'json' } } : r);
  registerHooks({
    resolve(spec, ctx, next) {
      if (spec === 'ioredis') return { url: FAKE_IOREDIS, shortCircuit: true, format: 'module' };
      if (spec.startsWith('@/')) {
        const base = join(ROOT, spec.slice(2));
        for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'route.ts'), join(base, 'index.ts')]) {
          if (existsSync(c)) return withJson({ url: bust(pathToFileURL(c).href), shortCircuit: true });
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

  // The DNS stub. app/scan-url/route.ts does `promisify(dnsLookupCb)` at module
  // load, and util.promisify honours a `promisify.custom` property on the
  // function object ahead of everything else — so defining it here captures the
  // route's lookup whenever the route happens to be imported. Every call is
  // recorded; a scenario that expected the resolve branch and sees no recorded
  // call is reported as instrumentation failure, not as a pass.
  dns.lookup[promisify.custom] = async (hostname, opts) => {
    S.dnsCalls.push({ hostname, all: Boolean(opts && opts.all) });
    if (S.dnsThrow) {
      const e = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
      e.code = 'ENOTFOUND';
      throw e;
    }
    return S.dnsAnswer;
  };

  // The socket recorder. Nothing here reaches the network; this is what makes
  // "no outbound request was made for a blocked target" an observable fact.
  globalThis.fetch = async (url, init = {}) => {
    S.fetches.push({ url: String(url), redirect: init.redirect ?? null, headers: init.headers || null });
    return S.fetchResponse(String(url));
  };

  process.env.ALTCHA_HMAC_KEY = crypto.randomBytes(32).toString('hex');
  process.env.ALLOWED_ORIGINS = 'https://incognitobrowser.io';
  delete process.env.REDIS_URL;

  const ORIGIN = 'https://incognitobrowser.io';
  const HOST = 'api.incognitobrowser.io';

  /** Load a module under a fresh generation, so its module state is clean. */
  async function load(rel) {
    return import(`${pathToFileURL(join(ROOT, rel)).href}?iastgen=${S.gen}`);
  }
  function nextGen() {
    S.gen += 1;
    S.fetches = [];
    S.dnsCalls = [];
    S.dnsThrow = false;
    S.dnsAnswer = [{ address: '93.184.216.34', family: 4 }];
    S.redis = { mode: 'ok', calls: [], store: new Map(), counters: new Map(), constructed: 0 };
    S.fetchResponse = () => new Response('<html><head><title>t</title></head><body></body></html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    });
    globalThis.__IAST = S;
  }

  const { NextRequest } = await import('next/server');

  /**
   * Mint and solve a proof-of-work for real. maxnumber=1 keeps the search
   * instant — the point here is that the PoW gate is genuinely satisfied, not
   * that solving it is expensive.
   */
  async function powHeader() {
    const alt = await load('lib/altcha.ts');
    const ch = alt.createChallenge(1, 90);
    let number = null;
    for (let n = 0; n <= ch.maxnumber; n++) {
      if (crypto.createHash('sha256').update(ch.salt + n).digest('hex') === ch.challenge) { number = n; break; }
    }
    if (number === null) throw new Error('could not solve own challenge');
    const sol = { algorithm: 'SHA-256', salt: ch.salt, number, signature: ch.signature, expires: ch.expires };
    return { header: alt.encodeAltchaAuthHeader(sol), signature: ch.signature };
  }

  function mkReq(path, { body = '{}', headers = {}, ip = '203.0.113.9' } = {}) {
    return new NextRequest(`https://${HOST}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, host: HOST, 'x-forwarded-for': ip, ...headers },
      body,
    });
  }

  async function readBody(res) {
    const text = await res.text().catch(() => '');
    try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 200) }; }
  }

  // -------------------------------------------------------------------------
  // Scenario groups
  // -------------------------------------------------------------------------

  /**
   * The SSRF corpus. Deliberately NOT the literal-address bypass list —
   * tests/ssrf-protection.test.ts already unit-tests isBlockedHostname across
   * those (including ::ffff:7f00:1 and the trailing dot) and
   * scripts/security-smoke.mjs drives them over the wire. What nothing covers
   * is the resolve-then-judge branch at app/scan-url/route.ts:240-263, because
   * it needs DNS: a name that is harmless as TEXT and lands somewhere private.
   * One literal case is kept as a control, to prove the string check still
   * fires BEFORE any resolution — that ordering is the property, not the list.
   */
  const SSRF_CASES = [
    { label: 'literal-metadata-ip', url: 'http://169.254.169.254/', answer: null, expect: 'blocked', resolves: false,
      why: 'string check must refuse before dns.lookup is called at all' },
    { label: 'nip-io-loopback', url: 'http://127-0-0-1.nip.io/', answer: [['127.0.0.1', 4]], expect: 'blocked', resolves: true,
      why: 'reaches this droplet\'s own localhost, and WordPress answers on 80' },
    { label: 'nip-io-metadata', url: 'http://169-254-169-254.nip.io/', answer: [['169.254.169.254', 4]], expect: 'blocked', resolves: true,
      why: 'cloud metadata service, reachable on port 80' },
    { label: 'public-name-private-answer', url: 'https://example.com/', answer: [['10.0.0.5', 4]], expect: 'blocked', resolves: true,
      why: 'a public name whose A record points into RFC1918' },
    { label: 'one-public-one-private-answer', url: 'https://example.com/', answer: [['93.184.216.34', 4], ['127.0.0.1', 4]], expect: 'blocked', resolves: true,
      why: 'ANY blocked address in the answer set must block — fetch picks its own' },
    { label: 'ipv6-loopback-answer', url: 'https://example.com/', answer: [['::1', 6]], expect: 'blocked', resolves: true,
      why: 'AAAA loopback; the IPv4-mapped shape of this was a live bypass on 2026-09-18' },
    { label: 'ipv6-mapped-metadata-answer', url: 'https://example.com/', answer: [['::ffff:a9fe:a9fe', 6]], expect: 'blocked', resolves: true,
      why: 'dns.lookup returns mapped addresses in exactly this form' },
    { label: 'ipv6-ula-answer', url: 'https://example.com/', answer: [['fd00::1', 6]], expect: 'blocked', resolves: true,
      why: 'unique-local address space' },
    { label: 'droplet-itself-answer', url: 'https://example.com/', answer: [['206.189.186.34', 4]], expect: 'blocked', resolves: true,
      why: 'BLOCKED_TARGET_HOSTS: scanning ourselves is free self-amplification' },
    { label: 'empty-answer', url: 'https://example.com/', answer: [], expect: 'no-fetch', resolves: true,
      why: 'nothing to judge means nothing to fetch' },
    { label: 'lookup-throws', url: 'https://example.com/', answer: 'throw', expect: 'no-fetch', resolves: true,
      why: 'a name that does not resolve cannot be scanned either' },
    // The control. Without a case that DOES reach the fetch, every "0 sockets"
    // above could mean the harness never got that far, and the check would be
    // reassuring nonsense.
    { label: 'allowed-public-control', url: 'https://example.com/', answer: [['93.184.216.34', 4]], expect: 'fetched', resolves: true,
      why: 'control: proves the harness can reach the outbound fetch at all' },
  ];

  async function runSsrf() {
    const results = [];
    for (const c of SSRF_CASES) {
      nextGen();
      if (c.answer === 'throw') S.dnsThrow = true;
      else if (c.answer) S.dnsAnswer = c.answer.map(([address, family]) => ({ address, family }));
      const route = await load('app/scan-url/route.ts');
      const { header } = await powHeader();
      const res = await route.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: c.url }), headers: { authorization: header },
      }));
      const body = await readBody(res);
      results.push({
        label: c.label, url: c.url, expect: c.expect, why: c.why,
        status: res.status,
        error: body.error || null,
        fetchCount: S.fetches.length,
        fetchUrls: S.fetches.map((f) => f.url),
        dnsCalls: S.dnsCalls.map((d) => d.hostname),
        answer: c.answer === 'throw' ? 'ENOTFOUND' : (c.answer || []).map(([a]) => a),
      });
    }
    return results;
  }

  /** The allowed path, recorded in full: what was fetched and under what policy. */
  async function runFetchPolicy() {
    const out = {};

    nextGen();
    {
      const route = await load('app/scan-url/route.ts');
      const { header } = await powHeader();
      const res = await route.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'https://example.com/some/page?q=1' }), headers: { authorization: header },
      }));
      const body = await readBody(res);
      out.allowed = {
        status: res.status,
        fetchCount: S.fetches.length,
        fetchUrl: S.fetches[0] ? S.fetches[0].url : null,
        redirectPolicy: S.fetches[0] ? S.fetches[0].redirect : null,
        judgedHostname: S.dnsCalls[0] ? S.dnsCalls[0].hostname : null,
        judgedAddresses: S.dnsAnswer.map((a) => a.address),
        resultKeys: Object.keys(body).slice(0, 12),
      };
    }

    nextGen();
    {
      // A 302 to the metadata service. With redirect:'manual' the route must
      // refuse and must not have followed it — a flip to 'follow' would make
      // the Location header an SSRF vector that no status-code test notices.
      S.fetchResponse = () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
      const route = await load('app/scan-url/route.ts');
      const { header } = await powHeader();
      const res = await route.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: header },
      }));
      const body = await readBody(res);
      out.redirect = {
        status: res.status,
        fetchCount: S.fetches.length,
        fetchUrls: S.fetches.map((f) => f.url),
        redirectTo: body.redirectTo || null,
        error: body.error || null,
      };
    }

    return out;
  }

  /** The proof-of-work single-use claim, and what happens when the store is sick. */
  async function runRedis() {
    const out = {};

    // 1. Healthy store: the claim must actually be written, and written BEFORE
    //    the socket is opened. This is the assertion no grep can make.
    nextGen();
    {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      const route = await load('app/scan-url/route.ts');
      const { header, signature } = await powHeader();
      const res = await route.POST(mkReq('/scan-url', {
        body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: header },
      }));
      const setCalls = S.redis.calls.filter((c) => c[0] === 'set');
      out.healthy = {
        status: res.status,
        setCalls: setCalls.map((c) => c.slice(1)),
        claimedKeyMatchesSignature: setCalls.some((c) => c[1] === `pow:${signature}`),
        fetchCount: S.fetches.length,
        claimBeforeFetch: setCalls.length > 0,
      };
    }

    // 2. Replay: the same solved token, twice. Real SET NX semantics in the
    //    fake, so the second call is refused by the same code path production
    //    uses — and must not open a socket.
    nextGen();
    {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      const route = await load('app/scan-url/route.ts');
      const { header } = await powHeader();
      const first = await route.POST(mkReq('/scan-url', { body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: header } }));
      const fetchesAfterFirst = S.fetches.length;
      const second = await route.POST(mkReq('/scan-url', { body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: header } }));
      const body = await readBody(second);
      out.replay = {
        firstStatus: first.status,
        secondStatus: second.status,
        secondReason: body.reason || null,
        fetchesAfterFirst,
        fetchesAfterSecond: S.fetches.length,
      };
    }

    // 3. The store throws. Fail closed: 503, no scan.
    nextGen();
    {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      S.redis.mode = 'set-throws';
      const route = await load('app/scan-url/route.ts');
      const { header } = await powHeader();
      const res = await route.POST(mkReq('/scan-url', { body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: header } }));
      const body = await readBody(res);
      out.storeThrows = { status: res.status, reason: body.reason || null, fetchCount: S.fetches.length };
    }

    // 4. The one that mattered. An ioredis 'error' event puts lib/rate-limit.ts
    //    into a 10s window where getRedisClient() RETURNS NULL — it does not
    //    throw. The old guard `if (redis && solution)` then skipped the claim
    //    entirely: no error, no 503, scan served, and a grep for the string
    //    'replay-store-unavailable' still reported green. This drives the real
    //    backoff through the real module and reads the real answer.
    nextGen();
    {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      S.redis.mode = 'error-event';
      const route = await load('app/scan-url/route.ts');
      const rl = await load('lib/rate-limit.ts');
      const warm = await powHeader();
      const firstRes = await route.POST(mkReq('/scan-url', { body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: warm.header } }));
      const { header } = await powHeader();
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); // let the 'error' event land
      const fetchesBefore = S.fetches.length;
      const setsBefore = S.redis.calls.filter((c) => c[0] === 'set').length;
      const res = await route.POST(mkReq('/scan-url', { body: JSON.stringify({ url: 'https://example.com/' }), headers: { authorization: header } }));
      const body = await readBody(res);
      out.backoff = {
        firstStatus: firstRes.status,
        // Read AFTER the request, not before. The 'error' event lands on an
        // immediate tick, which in practice falls inside the second request's
        // own await chain — measuring beforehand reported a healthy client for
        // a request that was about to see a sick one.
        redisStatusAfter: rl.getRedisStatus(),
        redisClientIsNullAfter: rl.getRedisClient() === null,
        status: res.status,
        reason: body.reason || null,
        fetchesDuringSecond: S.fetches.length - fetchesBefore,
        // Zero `set` calls plus a 503 is the decisive evidence: the route
        // refused because the CLIENT was null, not because a command threw.
        // That is the exact shape of the fail-open that shipped.
        setCallsDuringSecond: S.redis.calls.filter((c) => c[0] === 'set').length - setsBefore,
        diag: rl.getRedisDiagnostic(),
        constructed: S.redis.constructed,
        redisCalls: S.redis.calls.map((c) => c[0]),
      };
    }

    // 5. The compensating control the finding above leans on: when Redis dies,
    //    does the rate limiter go to in-memory counting, or does it go away?
    //    tests/rate-limit.test.ts only ever runs with REDIS_URL unset, so the
    //    transition itself is unpinned. Driven through /ip (60/min, no PoW) to
    //    keep it cheap.
    nextGen();
    {
      process.env.REDIS_URL = 'redis://127.0.0.1:6379';
      S.redis.mode = 'pipeline-throws';
      const route = await load('app/ip/route.ts');
      const statuses = [];
      for (let i = 0; i < 66; i++) {
        const res = await route.POST(mkReq('/ip', { ip: '198.51.100.7' }));
        statuses.push(res.status);
      }
      out.degradedRateLimit = {
        calls: statuses.length,
        allowed: statuses.filter((s) => s === 200).length,
        denied: statuses.filter((s) => s === 429).length,
        firstDeniedAt: statuses.indexOf(429),
      };
    }

    delete process.env.REDIS_URL;
    return out;
  }

  /**
   * Body bounds, observed as ORDER rather than as heap deltas (which flake on
   * a shared runner). The request body is a stream that counts the bytes the
   * route actually pulled, so "was the cap checked before or after the body was
   * buffered" becomes a number instead of an opinion.
   */
  function countingBody(totalBytes, counter) {
    const CHUNK = 64 * 1024;
    let sent = 0;
    return new ReadableStream({
      pull(controller) {
        if (sent >= totalBytes) { controller.close(); return; }
        const n = Math.min(CHUNK, totalBytes - sent);
        sent += n;
        counter.pulled += n;
        controller.enqueue(new Uint8Array(n).fill(0x20));
      },
    });
  }

  const BODY_ROUTES = [
    { route: '/event', file: 'app/event/route.ts', cap: 2048, gate: 'origin + 120/min' },
    { route: '/dns-leak/result', file: 'app/dns-leak/result/route.ts', cap: 512, gate: 'origin + 100/min — the cheapest unauthenticated allocation path in the service' },
    { route: '/dns-leak/start', file: 'app/dns-leak/start/route.ts', cap: null, gate: 'origin + 20/min — reads no body at all' },
    { route: '/scan-url', file: 'app/scan-url/route.ts', cap: 3072, gate: 'origin + proof-of-work + 10/min' },
    { route: '/stats', file: 'app/stats/route.ts', cap: 512, gate: 'bearer STATS_TOKEN, checked before the body' },
  ];

  async function runBodyBounds() {
    const BIG = 2 * 1024 * 1024; // 2 MiB is already >1000x every cap here
    const results = [];
    for (const r of BODY_ROUTES) {
      for (const mode of ['declared', 'chunked']) {
        nextGen();
        if (r.route === '/stats') process.env.STATS_TOKEN = 'iast-probe-token';
        const mod = await load(r.file);
        const headers = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
        if (r.route === '/stats') headers.authorization = 'Bearer iast-probe-token';
        if (r.route === '/scan-url') headers.authorization = (await powHeader()).header;

        // BOTH modes send the same counting stream. The first version sent a
        // two-byte string in 'declared' mode, which made its "0 bytes pulled"
        // assertion unfalsifiable — a string body pulls nothing no matter what
        // the route does. An assertion that cannot fail is the exact thing
        // this suite was built to stop shipping.
        const counter = { pulled: 0 };
        // 'declared' says 2 MiB in the header a caller could equally omit;
        // 'chunked' omits it, which is what the Apache
        // `<If "%{HTTP:Content-Length} -gt 1048576">` block cannot match on.
        if (mode === 'declared') headers['content-length'] = String(BIG);
        const req = new NextRequest(`https://${HOST}${r.route}`, {
          method: 'POST', headers, body: countingBody(BIG, counter), duplex: 'half',
        });
        let status = null; let err = null;
        try {
          const res = await mod.POST(req);
          status = res.status;
        } catch (e) {
          err = `${e && e.message ? e.message : e}`;
        }
        results.push({ route: r.route, gate: r.gate, cap: r.cap, mode, status, error: err, bytesPulled: counter.pulled, sent: BIG });
        delete process.env.STATS_TOKEN;
      }
    }
    return results;
  }

  /**
   * The origin gate, exercised rather than read. lib/origin.ts:58-68 allows any
   * request whose Origin host equals its own Host header, and API-ON-DROPLET.md
   * sets `ProxyPreserveHost On`, so the CLIENT supplies that Host. A caller who
   * sets both headers to the same made-up name is therefore inside the gate on
   * every route, without knowing a single allowlisted origin.
   */
  async function runOriginGate() {
    const FORGED = 'evil.example.test';
    const routes = [
      ['/challenge', 'app/challenge/route.ts'],
      ['/scan-url', 'app/scan-url/route.ts'],
      ['/ip', 'app/ip/route.ts'],
      ['/dns-leak/start', 'app/dns-leak/start/route.ts'],
      ['/dns-leak/result', 'app/dns-leak/result/route.ts'],
      ['/event', 'app/event/route.ts'],
    ];
    const out = [];
    for (const [path, file] of routes) {
      nextGen();
      const mod = await load(file);
      const mk = (headers) => new NextRequest(`https://${FORGED}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
        body: '{}',
      });
      const forged = await mod.POST(mk({ origin: `https://${FORGED}`, host: FORGED }));
      const foreign = await mod.POST(mk({ origin: 'https://not-allowed.example', host: HOST }));
      out.push({
        route: path,
        forgedPairStatus: forged.status,
        forgedPairPassedGate: forged.status !== 403,
        foreignOriginStatus: foreign.status,
        foreignOriginBlocked: foreign.status === 403,
      });
    }
    return out;
  }

  async function runAll() {
    const started = Date.now();

    // Prove the instrumentation is live BEFORE driving anything. If the stub
    // is not installed, the SSRF corpus would resolve for real — 127-0-0-1.nip.io
    // and friends answer from any machine with a resolver — and the checks
    // would quietly become live-DNS tests that still pass. Failing here costs
    // one lookup of a name that cannot resolve; failing later costs the truth.
    const selfTest = promisify(dns.lookup);
    const before = S.dnsCalls.length;
    let stubAnswer = null;
    try { stubAnswer = await selfTest('iast-instrumentation-self-test.invalid', { all: true }); } catch { /* reported below */ }
    if (S.dnsCalls.length === before || !Array.isArray(stubAnswer)) {
      throw new Error('the dns.lookup stub is not installed — refusing to run a corpus that would resolve for real');
    }
    S.dnsCalls.length = before;

    const ssrf = await runSsrf();
    const fetchPolicy = await runFetchPolicy();
    const redis = await runRedis();
    const body = await runBodyBounds();
    const origin = await runOriginGate();
    return {
      meta: {
        node: process.version,
        ms: Date.now() - started,
        // If this is false nothing below can be trusted: the stub never ran, so
        // the route used real DNS and "blocked" may mean "the name did not
        // resolve on this machine".
        dnsStubLive: ssrf.some((r) => r.dnsCalls.length > 0),
        fetchRecorderLive: ssrf.some((r) => r.fetchCount > 0),
        redisFakeLive: Object.keys(redis).length > 0,
      },
      ssrf, fetchPolicy, redis, body, origin,
    };
  }

  return { runAll };
}
