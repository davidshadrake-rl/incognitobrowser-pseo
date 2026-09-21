/**
 * /dns-leak/result as an OBJECT REFERENCE — can one visitor read another
 * visitor's test?
 *
 * tests/dns-leak.test.ts covers the id GENERATOR (length, alphabet, rejection
 * sampling / modulo bias). Nothing anywhere covers what an id BUYS. That
 * matters because `dnsleak:test:<id>` is not an opaque token over nothing: it
 * holds `{ createdAt, publicIp }` (lib/dns-leak-store.ts:65), and publicIp is
 * the visitor's real public address as the proxy saw it
 * (app/dns-leak/start/route.ts:72-73, via buildIpResponse). Hold the id, and
 * /dns-leak/result hands you that address plus every resolver IP our
 * nameserver recorded for it (app/dns-leak/result/route.ts:96-102).
 *
 * So the question is not "is the id random" — it is:
 *   1. how many bits is the id really worth, computed from the real generator;
 *   2. does a well-formed id that was never issued look different from one
 *      that was (an existence oracle);
 *   3. what does a caller who is not the starter actually receive;
 *   4. does the record expire;
 *   5. can the id be widened into a search — a prefix, a wildcard, a list.
 *
 * WHAT IS REAL HERE. The route handlers are the real modules, driven with a
 * real NextRequest. lib/dns-leak-store.ts and lib/rate-limit.ts are the real
 * modules. Only `ioredis` is replaced, by an in-memory fake that records every
 * command — which is the only way the TTL on the write and the command
 * sequence behind a hit vs. a miss become observable facts rather than
 * inferences from source text. Nothing here opens a socket.
 *
 * WHY SOME TESTS ARE NAMED "DOCUMENTED GAP". Two of the properties above do
 * NOT hold today. Those tests pin the behaviour that actually ships, so the
 * suite stays honest and so a future fix fails here loudly and has to be
 * acknowledged rather than silently changing what the API discloses. The
 * finding itself is raised by scripts/security/checks/api-dns-leak-idor.mjs,
 * which grades the same facts and reports them with a severity.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { TEST_ID_LENGTH, TEST_ID_RE, TEST_TTL_SECONDS, generateTestId, seenKey, testKey } from '../lib/dns-leak';

const ORIGIN = 'https://incognitobrowser.io';
const HOST = 'api.incognitobrowser.io';

/** The visitor who starts the test. The LAST x-forwarded-for hop is what the proxy observed. */
const VICTIM_IP = '198.51.100.24';
/** Somebody else entirely, on a different /24 so they do not even share a rate-limit bucket. */
const ATTACKER_IP = '203.0.113.77';
/** What the nameserver recorded as having resolved the victim's hostnames. */
const VICTIM_RESOLVER_IP = '198.51.100.53';

// ---------------------------------------------------------------------------
// The fake Redis. Everything else in this file is the real module.
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => {
  const kv = new Map<string, { value: string; expiresAt: number | null }>();
  const lists = new Map<string, string[]>();
  const counters = new Map<string, number>();
  const log: Array<{ cmd: string; key: string; args: unknown[] }> = [];

  class FakeRedis {
    on(): this {
      return this;
    }

    async set(key: string, value: string, ...rest: unknown[]): Promise<string> {
      log.push({ cmd: 'set', key, args: rest });
      const ex = rest[0] === 'EX' && typeof rest[1] === 'number' ? rest[1] : null;
      kv.set(key, { value, expiresAt: ex === null ? null : Date.now() + ex * 1000 });
      return 'OK';
    }

    async get(key: string): Promise<string | null> {
      log.push({ cmd: 'get', key, args: [] });
      const entry = kv.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
        kv.delete(key);
        return null;
      }
      return entry.value;
    }

    async lrange(key: string, start: number, stop: number): Promise<string[]> {
      log.push({ cmd: 'lrange', key, args: [start, stop] });
      const list = lists.get(key) ?? [];
      const from = start < 0 ? Math.max(0, list.length + start) : start;
      const to = stop < 0 ? list.length + stop + 1 : stop + 1;
      return list.slice(from, to);
    }

    /** lib/rate-limit.ts pipelines INCR + EXPIRE and reads results[0][1]. */
    pipeline() {
      const queued: Array<() => [Error | null, unknown]> = [];
      const p = {
        incr: (key: string) => {
          queued.push(() => {
            const n = (counters.get(key) ?? 0) + 1;
            counters.set(key, n);
            return [null, n];
          });
          return p;
        },
        expire: (_key: string, _seconds: number) => {
          queued.push(() => [null, 1]);
          return p;
        },
        exec: async () => queued.map((f) => f()),
      };
      return p;
    }
  }

  return {
    FakeRedis,
    kv,
    lists,
    counters,
    log,
    reset(): void {
      kv.clear();
      lists.clear();
      counters.clear();
      log.length = 0;
    },
    /** Commands touching the dns-leak keyspace, in order. Rate-limit traffic is filtered out. */
    dnsLeakCommands(): string[] {
      return log.filter((e) => e.key.startsWith('dnsleak:')).map((e) => `${e.cmd} ${e.key}`);
    },
  };
});

vi.mock('ioredis', () => ({ default: fake.FakeRedis, Redis: fake.FakeRedis }));

// ---------------------------------------------------------------------------
// Driving the real routes
// ---------------------------------------------------------------------------

interface StartModule {
  POST(request: NextRequest): Promise<Response>;
}
interface ResultModule {
  POST(request: NextRequest): Promise<Response>;
}

async function loadRoutes(): Promise<{ start: StartModule; result: ResultModule }> {
  vi.resetModules();
  const origin = await import('../lib/origin');
  origin._resetOriginCacheForTests();
  const start = (await import('../app/dns-leak/start/route')) as unknown as StartModule;
  const result = (await import('../app/dns-leak/result/route')) as unknown as ResultModule;
  return { start, result };
}

function req(path: string, ip: string, body: unknown = {}): NextRequest {
  return new NextRequest(`https://${HOST}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: HOST,
      origin: ORIGIN,
      // Apache APPENDS the real peer, so the last hop is what we observed.
      'x-forwarded-for': `10.0.0.1, ${ip}`,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface ResultBody {
  id?: unknown;
  publicIp?: unknown;
  resolvers?: Array<{ ip: string; network: string; count: number; firstSeen: number }>;
  observations?: unknown;
  storage?: unknown;
  error?: unknown;
}

async function json(res: Response): Promise<ResultBody> {
  return (await res.json()) as ResultBody;
}

/** One real /dns-leak/start from the victim, with an observation seeded as the nameserver would. */
async function startVictimTest(): Promise<{ id: string; storage: unknown }> {
  const { start } = await loadRoutes();
  const res = await start.POST(req('/dns-leak/start', VICTIM_IP));
  expect(res.status, 'the victim start must succeed or every read below is vacuous').toBe(200);
  const body = (await res.json()) as { id: string; storage: string };
  fake.lists.set(seenKey(body.id), [
    JSON.stringify({ resolverIp: VICTIM_RESOLVER_IP, ts: 1_700_000_000_000, qname: `1.${body.id}.dnsleak.incognitobrowser.io` }),
  ]);
  return { id: body.id, storage: body.storage };
}

/** A well-formed id that was never issued. */
function unissuedId(): string {
  return generateTestId();
}

beforeEach(() => {
  process.env.ALLOWED_ORIGINS = ORIGIN;
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  fake.reset();
});

afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.REDIS_URL;
});

// ---------------------------------------------------------------------------
// 1. How many bits is the id worth?
// ---------------------------------------------------------------------------

describe('the test id as a bearer capability — entropy measured, not assumed', () => {
  it('draws its symbols from the real generator: alphabet and length are observed, and the bit count is stated', () => {
    const SAMPLES = 20_000;
    const alphabet = new Set<string>();
    const lengths = new Set<number>();
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLES; i++) {
      const id = generateTestId();
      lengths.add(id.length);
      seen.add(id);
      for (const ch of id) alphabet.add(ch);
    }

    const alphabetSize = alphabet.size;
    const length = [...lengths][0];
    const bits = length * Math.log2(alphabetSize);
    const detail =
      `observed over ${SAMPLES} ids: alphabet ${alphabetSize} symbols ([${[...alphabet].sort().join('')}]), ` +
      `length ${[...lengths].join('/')}, entropy ${bits.toFixed(1)} bits (${alphabetSize}^${length} = ${alphabetSize ** length} ids)`;

    expect(lengths.size, `ids are not a fixed length — ${detail}`).toBe(1);
    expect(length).toBe(TEST_ID_LENGTH);
    // 20k draws from a 36-symbol alphabet must exercise all 36 or the sampler
    // is biased; this is also what makes the bit count below trustworthy.
    expect(alphabetSize, `fewer symbols appear than the alphabet holds — ${detail}`).toBe(36);
    expect(seen.size, `the generator repeated an id inside ${SAMPLES} draws — ${detail}`).toBe(SAMPLES);
    // Stated rather than hidden: if the alphabet or the length ever changes,
    // this message carries the new number into the failure output.
    expect(bits, `test-id entropy dropped below 60 bits — ${detail}`).toBeGreaterThanOrEqual(60);
  });

  it('cannot be reached by guessing inside the 600-second window the route allows', () => {
    // The budget is read out of the route rather than copied, so a loosened
    // limit changes this arithmetic instead of silently invalidating it.
    const src = readFileSync(join(__dirname, '..', 'app', 'dns-leak', 'result', 'route.ts'), 'utf-8');
    // [\d_]+, not \d+: the source writes `windowMs: 60_000`, and \d+ stops at
    // the separator, reads 60 and overstates the attacker's budget a
    // thousandfold. Wrong in the defender's favour is still wrong.
    const m = /RESULT_RATE_LIMIT_CONFIG\s*=\s*\{\s*limit:\s*([\d_]+),\s*windowMs:\s*([\d_]+)/.exec(src);
    expect(m, 'RESULT_RATE_LIMIT_CONFIG is no longer where this arithmetic reads it from').not.toBeNull();

    const limit = Number(m![1].replace(/_/g, ''));
    const windowMs = Number(m![2].replace(/_/g, ''));
    expect(windowMs, 'the window parsed as a suspiciously small number — the separator handling broke').toBeGreaterThanOrEqual(1000);
    const space = 36 ** TEST_ID_LENGTH;
    const guessesInLifetime = (limit / (windowMs / 1000)) * TEST_TTL_SECONDS;
    const probability = guessesInLifetime / space;
    const detail =
      `${limit} guesses per ${windowMs / 1000}s bucket × ${TEST_TTL_SECONDS}s record life = ` +
      `${guessesInLifetime} attempts against ${space} ids → p ≈ ${probability.toExponential(2)} per bucket`;

    expect(probability, `guessing a live test id has become plausible — ${detail}`).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------------------
// 2-3. What an id that is not yours returns
// ---------------------------------------------------------------------------

describe('POST /dns-leak/result with somebody else\'s id', () => {
  it('CONTROL: the record really reaches storage, so every read below is a real read', async () => {
    const { id, storage } = await startVictimTest();
    expect(id).toMatch(TEST_ID_RE);
    expect(storage, 'storage fell back to none — the reads below would prove nothing').toBe('redis');
    expect(fake.kv.has(testKey(id)), 'no record was written under dnsleak:test:<id>').toBe(true);
    const stored = JSON.parse(fake.kv.get(testKey(id))!.value) as { publicIp: string };
    expect(stored.publicIp, 'the record must hold the starter\'s observed public IP or this whole file tests nothing').toBe(VICTIM_IP);
  });

  it('a caller on an unrelated network gets NO public IP', async () => {
    const { id } = await startVictimTest();
    const { result } = await loadRoutes();

    const res = await result.POST(req('/dns-leak/result', ATTACKER_IP, { id }));
    const body = await json(res);

    // This test was first written to PIN THE GAP: the id was a bearer token
    // with no second factor, so presenting it returned the starter's address
    // to anyone. That was closed the same day by comparing the caller's /24
    // against the stored one, and the assertion was inverted rather than
    // deleted — the pinned-gap version is what made the fix findable.
    //
    // The id could not carry that read. It is 62 bits, so guessing is out,
    // but the mechanism works by having the VISITOR'S RESOLVER look up
    // <id>.dnsleak… — so every resolver in the chain sees it, which is exactly
    // the set of parties this tool exists to expose.
    expect(res.status).toBe(200);
    expect(body.publicIp, 'a foreign network must not learn the starter\'s address').toBeNull();
    expect(body.observations).toBe(1);
    // Resolver observations stay readable: they describe the resolvers, not
    // the visitor, and the UI needs them to tell "no queries yet" from
    // "expired". Asserted so that staying visible is a decision on the record.
    expect(body.resolvers?.map((r) => r.ip)).toEqual([VICTIM_RESOLVER_IP]);
  });

  it('the network that started the test still gets its own address back', async () => {
    // The other half, and the one that proves the fix is a boundary rather
    // than a blanket removal: without this, returning null unconditionally
    // would pass the test above and silently break the tool.
    const { id } = await startVictimTest();
    const { result } = await loadRoutes();

    const body = await json(await result.POST(req('/dns-leak/result', VICTIM_IP, { id })));
    expect(body.publicIp, 'the starter must still see its own result').toBe(VICTIM_IP);
  });

  it('answers an unknown-but-well-formed id with the SAME body shape', async () => {
    const { id } = await startVictimTest();
    const { result } = await loadRoutes();

    const hit = await json(await result.POST(req('/dns-leak/result', ATTACKER_IP, { id })));
    const miss = await json(await result.POST(req('/dns-leak/result', ATTACKER_IP, { id: unissuedId() })));

    // Shape parity is the property the route's own contract claims and it
    // holds: same keys, same status, same storage verdict, no 404.
    expect(Object.keys(miss).sort()).toEqual(Object.keys(hit).sort());
    expect(miss.storage).toBe(hit.storage);
    expect(miss.error).toBeUndefined();
  });

  it('a foreign reader can still tell a live id from an unissued one, by observations', async () => {
    const { id } = await startVictimTest();
    const { result } = await loadRoutes();

    const hit = await json(await result.POST(req('/dns-leak/result', ATTACKER_IP, { id })));
    const miss = await json(await result.POST(req('/dns-leak/result', ATTACKER_IP, { id: unissuedId() })));

    // The publicIp oracle is CLOSED: both now come back null for a foreign
    // network, so the field no longer confirms existence.
    expect(hit.publicIp).toBeNull();
    expect(miss.publicIp).toBeNull();

    // What remains is an existence oracle through `observations`, and it is
    // recorded rather than quietly tolerated. It is much weaker than the read
    // that was closed — it discloses that an id is live, not whose it is, and
    // an id is 62 bits so it cannot be swept for. Closing it would mean
    // fabricating resolver counts for ids that do not exist, which would make
    // the tool lie to its own user about whether their test had run yet.
    // That trade is the reason this stays; if it ever stops being acceptable,
    // this assertion is where the decision gets revisited.
    expect(hit.observations).toBe(1);
    expect(miss.observations).toBe(0);
  });

  it('does the same storage work for a hit and a miss, so the read itself does not time-separate them', async () => {
    const { id } = await startVictimTest();
    const { result } = await loadRoutes();

    fake.log.length = 0;
    await result.POST(req('/dns-leak/result', ATTACKER_IP, { id }));
    const hitCommands = fake.dnsLeakCommands().map((c) => c.split(' ')[0]);

    fake.log.length = 0;
    await result.POST(req('/dns-leak/result', ATTACKER_IP, { id: unissuedId() }));
    const missCommands = fake.dnsLeakCommands().map((c) => c.split(' ')[0]);

    // readDnsLeakTest issues GET + LRANGE unconditionally and in parallel
    // (lib/dns-leak-store.ts:86) — there is no early return on a missing
    // record, so the work done is identical. Asserting the command sequence is
    // a far steadier proxy for "no timing oracle" than a wall clock in CI.
    expect(hitCommands).toEqual(['get', 'lrange']);
    expect(missCommands).toEqual(hitCommands);
  });
});

// ---------------------------------------------------------------------------
// 4. The record expires
// ---------------------------------------------------------------------------

describe('the record does not outlive the test', () => {
  it('writes with EX TEST_TTL_SECONDS — the TTL is on the write itself, not a sweeper', async () => {
    const { id } = await startVictimTest();
    const write = fake.log.find((e) => e.cmd === 'set' && e.key === testKey(id));
    expect(write, 'no SET was issued for the test record').toBeTruthy();
    // ['EX', 600] — an expiring write. A SET with no EX would leave the
    // visitor's IP in Redis until something else evicted it.
    expect(write!.args, `dnsleak:test:${id} was written with ${JSON.stringify(write!.args)}`).toEqual(['EX', TEST_TTL_SECONDS]);
    expect(TEST_TTL_SECONDS).toBe(600);
    expect(TEST_TTL_SECONDS, 'the DNS leak record now lives longer than an hour').toBeLessThanOrEqual(3600);
  });

  it('reads back as absent once the TTL has passed', async () => {
    const { id } = await startVictimTest();
    const entry = fake.kv.get(testKey(id))!;
    // Wind the expiry into the past rather than the clock into the future:
    // the route and the store keep using the real Date.now, so nothing else
    // about the request changes.
    entry.expiresAt = Date.now() - 1;

    const { result } = await loadRoutes();
    const body = await json(await result.POST(req('/dns-leak/result', ATTACKER_IP, { id })));
    expect(body.publicIp).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. The id cannot be widened into a search
// ---------------------------------------------------------------------------

describe('no enumeration affordance', () => {
  const WIDENING = [
    { label: 'a prefix', body: { id: 'abcdef' } },
    { label: 'a trailing wildcard', body: { id: 'abcdefghijk*' } },
    { label: 'a Redis MATCH pattern', body: { id: 'dnsleak:test:*' } },
    { label: 'a list of ids', body: { id: ['abcdefghijkl', 'abcdefghijkm'] } },
    { label: 'an object', body: { id: { $ne: null } } },
    { label: 'a 12-char id with a newline', body: { id: 'abcdefghijk\n' } },
    { label: 'an id with a key-separator', body: { id: 'abcdef:ghijk' } },
    { label: 'a numeric id', body: { id: 123456789012 } },
  ];

  it('refuses every widening of the id with 400, before any storage read', async () => {
    const { result } = await loadRoutes();
    for (const c of WIDENING) {
      fake.log.length = 0;
      const res = await result.POST(req('/dns-leak/result', ATTACKER_IP, c.body));
      const body = await json(res);
      expect(res.status, `${c.label} was not refused: ${JSON.stringify(body).slice(0, 160)}`).toBe(400);
      expect(body.error).toBe('Invalid test id.');
      // The refusal must come BEFORE readDnsLeakTest, or a pattern reaches
      // the keyspace regardless of what the response says.
      expect(fake.dnsLeakCommands(), `${c.label} reached storage before being refused`).toEqual([]);
    }
  });

  it('exposes no GET or HEAD handler, so an id cannot ride in a URL or a log line', async () => {
    vi.resetModules();
    const mod = await import('../app/dns-leak/result/route');
    const exported = Object.keys(mod);
    for (const verb of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(exported, `/dns-leak/result exports ${verb}: [${exported.join(', ')}]`).not.toContain(verb);
    }
    expect(exported).toContain('POST');
  });
});
