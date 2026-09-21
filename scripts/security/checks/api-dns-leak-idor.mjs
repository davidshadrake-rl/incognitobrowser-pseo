/**
 * /dns-leak/result is the only endpoint in this API that returns one person's
 * data keyed by a reference another person could hold. This check grades that
 * reference.
 *
 * WHAT IS AT STAKE. `dnsleak:test:<id>` holds `{ createdAt, publicIp }`
 * (lib/dns-leak-store.ts:65), where publicIp is the visitor's real address as
 * Apache observed it (app/dns-leak/start/route.ts:72-73). `dnsleak:seen:<id>`
 * holds every resolver IP our nameserver recorded. /dns-leak/result returns
 * both to anyone who presents the id, with no second factor of any kind
 * (app/dns-leak/result/route.ts:94-102). The id is therefore a bearer
 * capability over somebody's public IP.
 *
 * WHY THE EXISTING COVERAGE IS NOT ENOUGH.
 *   - tests/dns-leak.test.ts grades the id GENERATOR — length, alphabet,
 *     rejection sampling. It never asks what an id buys.
 *   - scripts/security/checks/api-live-dnsleak-contract.mjs probes the live
 *     box, but it can only ever send ids that were NEVER ISSUED, so the one
 *     thing it cannot establish is the interesting one: what comes back for an
 *     id that IS live and belongs to somebody else. Its "unknown id looks like
 *     an unpolled id" row passes for exactly that reason — with nothing in
 *     storage, every id looks unpolled.
 *   - The shared harness (api-inproc.mjs) drives /dns-leak/result, but with no
 *     REDIS_URL, so every read there returns storage:'none' and an empty body.
 *     A check that read only those rows would report a clean sheet it had not
 *     earned.
 *
 * SO THIS CHECK BRINGS ITS OWN STORAGE. It runs the REAL route handlers, the
 * REAL lib/dns-leak-store.ts and the REAL lib/rate-limit.ts in a child
 * process, with only `ioredis` replaced by an in-memory fake that records
 * every command. That replacement is what turns three things from source
 * inferences into observations: the TTL is on the write; the same two reads
 * are issued for a hit and a miss; a malformed id never reaches the keyspace.
 * Nothing in the child opens a socket, and the connect() ledger at the foot of
 * the child proves it — which is why this is safe to run on every commit.
 *
 * It ALSO reads the shared harness. api-inproc drives /dns-leak/result through
 * a completely separate module graph, and its malformed-id and method rows are
 * used here as a cross-harness corroboration: if the two disagree about
 * whether a bad id is refused, one of the two harnesses is lying and that is
 * itself worth a finding. Nothing is re-reported from it — api-method-matrix
 * and api-error-shape own those properties.
 *
 * Findings ARE expected from this file. The route does return a foreign
 * visitor's public IP to anyone holding the id; the severity argument for that
 * is written out in the finding rather than assumed.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);

/** Below this, the 600-second guessing arithmetic in the finding stops holding. */
const MIN_ENTROPY_BITS = 60;
/** A DNS leak record holding a public IP has no business outliving the test by much. */
const MAX_TTL_SECONDS = 3600;

const VICTIM_IP = '198.51.100.24';
const ATTACKER_IP = '203.0.113.77';
const VICTIM_RESOLVER_IP = '198.51.100.53';

export default check({
  id: 'api-dns-leak-idor',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe:
    'The DNS-leak test id: enough entropy to be unguessable, an expiring record, no enumeration affordance, and an honest account of what an id that is not yours returns.',
  async run() {
    const o = await runChild();
    const findings = [];
    let checked = 0;

    // ---------------------------------------------------------------------
    // 0. Instrumentation first. Every row below is worthless if the child's
    //    fake storage did not actually take the write.
    // ---------------------------------------------------------------------
    if (o.control.storage !== 'redis' || !o.control.recordWritten) {
      throw new Skip(
        `the in-process storage did not take the write (storage=${o.control.storage}, record=${o.control.recordWritten}); ` +
        'every read below would look empty for the wrong reason',
      );
    }
    if (o.control.startStatus !== 200) {
      throw new Skip(`/dns-leak/start answered ${o.control.startStatus} in-process; nothing downstream can be graded`);
    }
    if (!o.budget.found) {
      // The guessing arithmetic in the entropy finding is quoted as evidence,
      // so a failed read of the real budget must not be papered over with a
      // remembered number.
      throw new Skip(`RESULT_RATE_LIMIT_CONFIG could not be read from app/dns-leak/result/route.ts (got ${JSON.stringify(o.budget)}); the guessing arithmetic would be invented`);
    }
    if (o.egress.offBox.length) {
      // This check claims to be every-commit-safe on the grounds that it
      // cannot reach the network. If that stops being true, say so loudly
      // rather than keep the claim.
      findings.push(finding({
        severity: 'medium',
        title: 'the in-process DNS-leak harness opened a connection off the box',
        detail:
          'This check runs inside the unit suite on the strength of one claim: the only outbound boundary is a fake. A real connection means the fake was bypassed, and the check is no longer safe to run unattended — nor is it grading what it says it grades.',
        evidence: `net.Socket.connect destinations: ${o.egress.offBox.join(', ')}`,
        remediation: 'Find what stopped resolving to the in-memory ioredis fake and restore the module hook.',
        file: 'scripts/security/checks/api-dns-leak-idor.mjs',
        line: null,
      }));
    }
    checked += 1;

    // ---------------------------------------------------------------------
    // 1. Entropy, computed from the real generator.
    // ---------------------------------------------------------------------
    {
      checked += 1;
      const e = o.entropy;
      const space = e.alphabetSize ** e.length;
      const shape =
        `${e.samples} ids from the real generateTestId: alphabet ${e.alphabetSize} symbols [${e.alphabet}], ` +
        `length ${e.lengths.join('/')}, ${e.bits.toFixed(1)} bits, ${space.toExponential(3)} possible ids, ` +
        `${e.duplicates} duplicate(s) in the sample`;

      if (e.lengths.length !== 1 || e.bits < MIN_ENTROPY_BITS || e.duplicates > 0) {
        findings.push(finding({
          severity: 'high',
          title: `the DNS-leak test id is now worth ${e.bits.toFixed(1)} bits`,
          detail:
            `Every other control on this endpoint assumes the id is unguessable. At ${e.bits.toFixed(1)} bits, ` +
            `the ${o.budget.limit}-per-${o.budget.windowMs / 1000}s bucket and the ${o.ttl.seconds}-second record life ` +
            `allow roughly ${o.guessing.attempts} attempts per network against ${space.toExponential(3)} ids, ` +
            `p ≈ ${o.guessing.probability.toExponential(2)}. The thing on the other side of a correct guess is a ` +
            'visitor\'s public IP address and the list of resolvers they use.',
          evidence: shape,
          remediation: `Restore ID_ALPHABET/TEST_ID_LENGTH in lib/dns-leak.ts to at least ${MIN_ENTROPY_BITS} bits, and keep TEST_ID_RE in step with them.`,
          file: 'lib/dns-leak.ts',
          line: 85,
        }));
      }
    }

    // ---------------------------------------------------------------------
    // 2. What a caller who is not the starter receives.
    // ---------------------------------------------------------------------
    {
      checked += 1;
      const f = o.foreign;
      if (f.publicIp === VICTIM_IP) {
        findings.push(finding({
          severity: 'medium',
          title: '/dns-leak/result hands a visitor\'s public IP to anyone holding the test id',
          detail:
            'The id is a pure bearer capability: nothing ties the read to the network, session or device that started the ' +
            'test, so a caller on an unrelated /24 receives the starter\'s public IP and every resolver IP recorded for ' +
            'them.\n\n' +
            'WHY THIS IS NOT ONLY THEORETICAL. The id is not a secret the browser keeps. The entire mechanism ' +
            'broadcasts it: the page asks the visitor\'s resolver to look up <n>.<id>.' + o.control.zone + ', so the id ' +
            'travels to the recursive resolver under test, to every forwarder above it, and into the passive-DNS and ' +
            'query-log collections those hops feed. Any of those observers can POST the id back within its 600-second ' +
            'life and learn the address of the person whose lookup they just saw.\n\n' +
            'WHY MEDIUM AND NOT HIGH. The window is 600 seconds, the record is one IP address rather than a credential ' +
            'or an account, there is no bulk path (enumeration is graded separately below and holds), and the recursive ' +
            'resolver — the most likely observer — usually knows its own client\'s address already. What the endpoint ' +
            'adds is the link for observers further up the chain who see the NAME but not the CLIENT.\n\n' +
            'WHY NOT LOW. This is the only endpoint in the API that returns a visitor-identifying value keyed by ' +
            'anything other than the caller\'s own request, and the product it sits in is sold on not leaking exactly ' +
            'this.',
          evidence:
            `in-process: POST /dns-leak/start from x-forwarded-for "…, ${VICTIM_IP}" issued id ${f.id}; ` +
            `POST /dns-leak/result from "…, ${ATTACKER_IP}" with that id => ${f.status} ` +
            `${JSON.stringify({ publicIp: f.publicIp, resolvers: f.resolverIps, observations: f.observations, storage: f.storage })}`,
          remediation:
            'Stop returning publicIp from /dns-leak/result. The browser already has its own address from POST /ip, and ' +
            'components/tools/DnsLeakTestTool.tsx can do the resolver-vs-public comparison client-side, which removes the ' +
            'cross-visitor disclosure entirely. (Binding the read to the starter\'s /24 is NOT the fix here: toggling the ' +
            'VPN mid-test changes that network, and toggling the VPN is the workflow.)',
          file: 'app/dns-leak/result/route.ts',
          line: 98,
        }));
      } else if (f.status !== 200) {
        findings.push(finding({
          severity: 'low',
          title: `/dns-leak/result answered ${f.status} for a live id from another network`,
          detail:
            'This check expected either the documented disclosure or a deliberate refusal. Something else happened, and ' +
            'until it is understood the other rows here are describing a route that no longer behaves as read.',
          evidence: `POST /dns-leak/result (id ${f.id}) from ${ATTACKER_IP} => ${f.status} ${JSON.stringify(f.body).slice(0, 220)}`,
          remediation: 'Re-read app/dns-leak/result/route.ts and update this check to grade what it now does.',
          file: 'app/dns-leak/result/route.ts',
          line: 94,
        }));
      }

      // The resolver list is a second, smaller disclosure and is reported
      // separately so a fix to publicIp alone does not silently close this
      // file with the rest still shipping.
      if (f.resolverIps.includes(VICTIM_RESOLVER_IP)) {
        findings.push(finding({
          severity: 'low',
          title: 'the same foreign read also returns the resolvers recorded for that test',
          detail:
            'Resolver addresses are shared infrastructure rather than the visitor, so this is materially weaker than the ' +
            'public IP above — but it is the visitor\'s resolver CHOICE, which is exactly the fact the tool exists to ' +
            'measure, and it is disclosed to whoever holds the id. Kept as its own row so that removing publicIp does not ' +
            'close the file with this still in the response.',
          evidence: `POST /dns-leak/result from ${ATTACKER_IP} with a foreign id returned resolvers ${JSON.stringify(f.resolverIps)}`,
          remediation: 'Consider the same client-side comparison, or accept it explicitly in the route docblock so it is a decision rather than an oversight.',
          file: 'app/dns-leak/result/route.ts',
          line: 99,
        }));
      }
    }

    // ---------------------------------------------------------------------
    // 3. Does the response distinguish an id that exists from one that does not?
    // ---------------------------------------------------------------------
    {
      checked += 1;
      const { hit, miss } = o.oracle;
      const sameShape = JSON.stringify(hit.keys) === JSON.stringify(miss.keys) && hit.status === miss.status;

      if (!sameShape) {
        findings.push(finding({
          severity: 'medium',
          title: '/dns-leak/result answers a different SHAPE for an unknown id',
          detail:
            'A 404, an error string or a different key set for an id that was never issued makes the endpoint an ' +
            'enumeration oracle in its own right, and it is the shape a caller can test cheaply and in bulk. The route\'s ' +
            'own contract (app/dns-leak/result/route.ts:4-6) promises one body shape.',
          evidence: `hit => ${hit.status} keys ${JSON.stringify(hit.keys)}; miss => ${miss.status} keys ${JSON.stringify(miss.keys)}`,
          remediation: 'Return { id, publicIp, resolvers, observations, storage } for both, as the route does today for the unpolled case.',
          file: 'app/dns-leak/result/route.ts',
          line: 96,
        }));
      } else if (hit.publicIp !== null && miss.publicIp === null) {
        findings.push(finding({
          severity: 'low',
          title: '/dns-leak/result confirms which ids exist, through the value rather than the shape',
          detail:
            'The body shape is identical, which is what the route promises and what the nightly live check grades. The ' +
            'VALUES are not: a non-null publicIp comes back only for an id that was really issued by a non-local visitor, ' +
            'so the response answers "does this id exist".\n\n' +
            'SEVERITY, ARGUED. This is strictly weaker than the disclosure above — anyone who can read the record can ' +
            'obviously also tell that it exists, so on its own it adds nothing for that caller. It is reported anyway ' +
            'because it is what would REMAIN if publicIp were reduced rather than removed (say, coarsened to a /24), and ' +
            'because it is the property the existing live check believes it is protecting while, against a box with no ' +
            'Redis reachable, it cannot observe it at all. Low, not medium: with ' +
            `${o.entropy.bits.toFixed(1)} bits and ${o.guessing.attempts} attempts per network per record lifetime, an ` +
            'oracle you cannot afford to query is not a path.',
          evidence:
            `same keys ${JSON.stringify(hit.keys)} and status ${hit.status} for both; ` +
            `hit publicIp=${JSON.stringify(hit.publicIp)} observations=${hit.observations}; ` +
            `miss publicIp=${JSON.stringify(miss.publicIp)} observations=${miss.observations}`,
          remediation:
            'Removing publicIp from the response (see above) closes this row too. If it stays, note in the route docblock that existence is observable, so nobody treats the id as a secret on that basis.',
          file: 'app/dns-leak/result/route.ts',
          line: 98,
        }));
      }
    }

    // The work done behind a hit and a miss. readDnsLeakTest issues GET and
    // LRANGE unconditionally and in parallel (lib/dns-leak-store.ts:86), so
    // there is no early return to time against. The command sequence is a far
    // steadier witness than a wall clock, and the clock is reported beside it
    // rather than asserted on.
    {
      checked += 1;
      const { hitCommands, missCommands, hitMedianMs, missMedianMs, timingSamples } = o.oracle;
      if (JSON.stringify(hitCommands) !== JSON.stringify(missCommands)) {
        findings.push(finding({
          severity: 'low',
          title: 'a hit and a miss no longer do the same storage work',
          detail:
            'readDnsLeakTest does GET + LRANGE unconditionally today, so a present and an absent record cost the same. ' +
            'An early return on a missing record — an obvious-looking optimisation — would make the difference ' +
            'measurable over the network and turn the value-level oracle above into a shape-independent one.',
          evidence:
            `hit: [${hitCommands.join(', ')}] median ${hitMedianMs.toFixed(3)}ms; ` +
            `miss: [${missCommands.join(', ')}] median ${missMedianMs.toFixed(3)}ms (${timingSamples} samples each, in-process)`,
          remediation: 'Keep the Promise.all in lib/dns-leak-store.ts readDnsLeakTest; do not add an early return when the record is absent.',
          file: 'lib/dns-leak-store.ts',
          line: 86,
        }));
      }
    }

    // ---------------------------------------------------------------------
    // 4. The record expires.
    // ---------------------------------------------------------------------
    {
      checked += 1;
      const t = o.ttl;
      // The record demonstrably reached storage (the instrumentation guard at
      // the top refuses to continue otherwise), so a missing SET in the ledger
      // is a broken recorder, not a route that forgot its TTL. Saying so is
      // the difference between this check and the version of it that reported
      // "written with no expiry" against a write of EX 600.
      if (!t.writeObserved) {
        throw new Skip('the record reached storage but no SET was recorded; the command ledger is broken, and its TTL verdict would be fabricated');
      }
      if (!t.expiring || t.seconds === null || t.seconds > MAX_TTL_SECONDS) {
        findings.push(finding({
          severity: t.expiring ? 'low' : 'medium',
          title: t.expiring
            ? `the DNS-leak record now lives ${t.seconds} seconds`
            : 'the DNS-leak record is written with no expiry',
          detail:
            'The record holds a visitor\'s public IP. The TTL is the only thing that bounds how long that address sits ' +
            'in Redis, and it is also what bounds the window in which a leaked id is worth anything. A SET without EX ' +
            'leaves it until something else evicts it — on a box where Redis is shared with the rate limiter, that could ' +
            'be a long time.',
          evidence: `lib/dns-leak-store.ts createDnsLeakTest issued: SET ${t.key} <record> ${JSON.stringify(t.args)}`,
          remediation: `Keep the 'EX', TEST_TTL_SECONDS arguments on the SET in createDnsLeakTest (lib/dns-leak-store.ts:67).`,
          file: 'lib/dns-leak-store.ts',
          line: 67,
        }));
      }

      if (!t.expiredRecordReadsAsAbsent) {
        findings.push(finding({
          severity: 'medium',
          title: 'an expired DNS-leak record still reads back',
          detail:
            'With the record\'s expiry set into the past, /dns-leak/result still returned a public IP. Either the TTL is ' +
            'not being honoured or something else is caching the record, and the 600-second bound the rest of this ' +
            'analysis rests on does not hold.',
          evidence: `after expiry, POST /dns-leak/result returned publicIp=${JSON.stringify(t.publicIpAfterExpiry)}`,
          remediation: 'Confirm nothing caches the parsed record between requests and that the write keeps its EX.',
          file: 'lib/dns-leak-store.ts',
          line: 67,
        }));
      }
    }

    // ---------------------------------------------------------------------
    // 5. No enumeration affordance: no prefix, no wildcard, no list.
    // ---------------------------------------------------------------------
    for (const w of o.widening) {
      checked += 1;
      if (w.status === 400 && w.storageCommands.length === 0) continue;
      findings.push(finding({
        severity: w.storageCommands.length ? 'high' : 'medium',
        title: `/dns-leak/result accepted a widened test id: ${w.label}`,
        detail:
          'isValidTestId is the only thing keeping the id an opaque token rather than something a caller can shape. The ' +
          'id is interpolated straight into a Redis key (lib/dns-leak.ts testKey), so a pattern, a prefix or a ' +
          'key-separator that survives validation turns a lookup into a search of the keyspace — and what is being ' +
          'searched for is visitors\' public IP addresses.' +
          (w.storageCommands.length ? ' This one reached storage before it was refused, which is the worse half.' : ''),
        evidence:
          `POST /dns-leak/result ${JSON.stringify(w.body).slice(0, 120)} => ${w.status} ` +
          `${JSON.stringify(w.responseBody).slice(0, 160)}; redis commands issued: [${w.storageCommands.join(', ')}]`,
        remediation: 'Keep `if (!isValidTestId(id)) return 400` ahead of readDnsLeakTest, and keep TEST_ID_RE anchored at ^[a-z0-9]{12}$.',
        file: 'app/dns-leak/result/route.ts',
        line: 90,
      }));
    }

    // ---------------------------------------------------------------------
    // 6. Cross-harness corroboration.
    // ---------------------------------------------------------------------
    // api-inproc drives the same route through a completely separate module
    // graph with no Redis at all. If the two harnesses disagree about whether
    // a malformed id is refused, one of them is lying — and a check that
    // grades a lying harness is worse than no check. Nothing else is
    // re-reported from it: api-method-matrix and api-error-shape own the
    // method surface and the error bodies.
    {
      let shared = null;
      let sharedError = null;
      try {
        shared = await observe();
      } catch (err) {
        sharedError = err && err.message ? err.message : String(err);
      }

      if (shared) {
        checked += 1;
        const row = shared.errors.find((e) => e.label === 'dns-leak/result: malformed id');
        const mine = o.widening.find((w) => w.label === 'uppercase id') || null;
        if (row && mine && row.status !== mine.status) {
          findings.push(finding({
            severity: 'medium',
            title: 'the two in-process harnesses disagree about /dns-leak/result id validation',
            detail:
              'scripts/security/checks/api-inproc.mjs and this check both POST a malformed id to the real route, through ' +
              'separate module graphs. They got different answers, so at least one harness is not driving the code it ' +
              'claims to drive — and every other row in both files is suspect until that is resolved.',
            evidence: `api-inproc "dns-leak/result: malformed id" => ${row.status}; this check "${mine.label}" => ${mine.status}`,
            remediation: 'Reconcile the two harnesses before trusting either one on this route.',
            file: 'scripts/security/checks/api-dns-leak-idor.mjs',
            line: null,
          }));
        }
      } else {
        // Not silently ignored: recorded in the child's own note so the report
        // says what was and was not corroborated. It does not become a pass.
        o.notes.push(`shared api-inproc harness unavailable, corroboration not performed: ${sharedError}`);
      }
    }

    return { findings, checked };
  },
});

// ---------------------------------------------------------------------------
// Parent side
// ---------------------------------------------------------------------------

function runChild() {
  const attempts = [
    ['--no-warnings', THIS_FILE, '--child'],
    // Node 22.18 strips types by default; older 22.x needs the flag. Asking
    // explicitly is the difference between a check that runs on a colleague's
    // laptop and one that mysteriously skips there.
    ['--no-warnings', '--experimental-strip-types', THIS_FILE, '--child'],
  ];
  let last = null;
  for (const args of attempts) {
    const r = spawnSync(process.execPath, args, {
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
      // A harness that inherited the developer's REDIS_URL or ALLOWED_ORIGINS
      // would be grading their shell. It gets a clean environment and sets
      // every value it depends on itself.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_OPTIONS: '' },
    });
    last = r;
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('__DNSLEAKPROBE__'));
    if (line) {
      const parsed = JSON.parse(line.slice('__DNSLEAKPROBE__'.length));
      if (parsed.fatal) throw new Skip(`the DNS-leak in-process harness could not run: ${parsed.fatal}${parsed.stack ? ` (${parsed.stack})` : ''}`);
      return parsed;
    }
  }
  const stderr = String((last && last.stderr) || '').trim().split('\n').slice(-6).join(' | ');
  throw new Skip(`the DNS-leak in-process harness produced no result (node ${process.version}): ${stderr || 'no stderr'}`);
}

// ---------------------------------------------------------------------------
// Child side — everything below runs only in the spawned process.
// ---------------------------------------------------------------------------

/**
 * The in-memory ioredis. Only the four commands lib/dns-leak-store.ts and
 * lib/rate-limit.ts actually use, and every one of them logged. Delivered as
 * module source through a load hook so that `import Redis from 'ioredis'` in
 * the REAL store resolves here without touching a line of application code.
 */
const FAKE_IOREDIS = `
const S = globalThis.__DNSLEAK_FAKE_REDIS__;
export default class Redis {
  on() { return this; }
  async set(key, value, ...rest) {
    S.log.push({ cmd: 'set', key, args: rest });
    const ex = rest[0] === 'EX' && typeof rest[1] === 'number' ? rest[1] : null;
    S.kv.set(key, { value, expiresAt: ex === null ? null : Date.now() + ex * 1000 });
    return 'OK';
  }
  async get(key) {
    S.log.push({ cmd: 'get', key, args: [] });
    const e = S.kv.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && Date.now() >= e.expiresAt) { S.kv.delete(key); return null; }
    return e.value;
  }
  async lrange(key, start, stop) {
    S.log.push({ cmd: 'lrange', key, args: [start, stop] });
    const l = S.lists.get(key) || [];
    const from = start < 0 ? Math.max(0, l.length + start) : start;
    const to = stop < 0 ? l.length + stop + 1 : stop + 1;
    return l.slice(from, to);
  }
  pipeline() {
    const q = [];
    const p = {
      incr: (k) => { q.push(() => { const n = (S.counters.get(k) || 0) + 1; S.counters.set(k, n); return [null, n]; }); return p; },
      expire: () => { q.push(() => [null, 1]); return p; },
      exec: async () => q.map((f) => f()),
    };
    return p;
  }
}
`;

if (process.argv[1] === THIS_FILE && process.argv.includes('--child')) {
  await child();
}

async function child() {
  const out = {};
  try {
    Object.assign(out, await runInProcess());
  } catch (err) {
    out.fatal = `${err && err.message ? err.message : err}`;
    out.stack = err && err.stack ? String(err.stack).split('\n').slice(1, 4).join(' | ') : null;
  }
  process.stdout.write(`__DNSLEAKPROBE__${JSON.stringify(out)}\n`);
  process.exit(0);
}

async function runInProcess() {
  const { registerHooks } = await import('node:module');
  const { pathToFileURL, fileURLToPath: toPath } = await import('node:url');
  const { existsSync, readFileSync, statSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const net = await import('node:net');

  const ROOT = join(dirname(THIS_FILE), '..', '..', '..');

  // EGRESS LEDGER, same reasoning as api-inproc.mjs: this check is allowed
  // inside the every-commit suite on the claim that it cannot reach the
  // network, and a claim that expensive is worth measuring rather than
  // asserting. Note the normalised-arguments shape — the first argument is
  // usually an ARRAY whose head is the options object.
  const egress = [];
  {
    const realConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function patchedConnect(...args) {
      let o = args[0];
      if (Array.isArray(o)) o = o[0];
      if (o && typeof o === 'object') egress.push(`${o.host || o.path || o.hostname || '?'}:${o.port ?? '?'}`);
      else if (typeof o === 'number' || typeof o === 'string') egress.push(`${args[1] ?? '?'}:${o}`);
      return realConnect.apply(this, args);
    };
  }

  const FAKE_URL = 'dnsleak-fake:ioredis';
  globalThis.__DNSLEAK_FAKE_REDIS__ = {
    kv: new Map(),
    lists: new Map(),
    counters: new Map(),
    log: [],
  };
  const S = globalThis.__DNSLEAK_FAKE_REDIS__;
  const dnsLeakCommands = () => S.log.filter((e) => String(e.key).startsWith('dnsleak:')).map((e) => e.cmd);

  // TypeScript's resolveJsonModule lets lib/*.ts import data/*.json with no
  // import attribute; plain Node demands one. Supplying it here keeps the
  // application source untouched — editing app code to suit a harness is how a
  // harness starts lying about what it graded.
  const withJson = (r) => (r && typeof r.url === 'string' && r.url.split('?')[0].endsWith('.json')
    ? { ...r, format: 'json', importAttributes: { type: 'json' } } : r);

  registerHooks({
    resolve(spec, ctx, next) {
      if (spec === 'ioredis') return { url: FAKE_URL, shortCircuit: true };
      if (spec.startsWith('@/')) {
        const base = join(ROOT, spec.slice(2));
        for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'route.ts'), join(base, 'index.ts')]) {
          if (existsSync(c) && statSync(c).isFile()) return withJson({ url: pathToFileURL(c).href, shortCircuit: true });
        }
      }
      try {
        return withJson(next(spec, ctx));
      } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND' && err.url) {
          const base = toPath(err.url);
          for (const c of [`${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
            if (existsSync(c)) return withJson({ url: pathToFileURL(c).href, shortCircuit: true });
          }
        }
        throw err;
      }
    },
    load(url, ctx, next) {
      if (url === FAKE_URL) return { format: 'module', source: FAKE_IOREDIS, shortCircuit: true };
      return next(url, ctx);
    },
  });

  const HOST = 'api.incognitobrowser.io';
  const ORIGIN = 'https://incognitobrowser.io';
  process.env.ALLOWED_ORIGINS = ORIGIN;
  // Points at nothing: the fake never connects, and the egress ledger above is
  // what proves it.
  process.env.REDIS_URL = 'redis://127.0.0.1:1/dns-leak-harness';
  delete process.env.STATS_TOKEN;
  delete process.env.DEBUG_ORIGINS;

  const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
  const { NextRequest } = await import('next/server');

  const dnsLeak = await load('lib/dns-leak.ts');
  const startRoute = await load('app/dns-leak/start/route.ts');
  const resultRoute = await load('app/dns-leak/result/route.ts');

  function mkReq(path, ip, body = {}) {
    return new NextRequest(`https://${HOST}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: HOST,
        origin: ORIGIN,
        // Apache APPENDS the real peer, so the LAST hop is what we observed.
        'x-forwarded-for': `10.0.0.1, ${ip}`,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async function readBody(res) {
    const text = await res.text().catch(() => '');
    try { return JSON.parse(text); } catch { return text ? { _raw: text.slice(0, 200) } : null; }
  }

  // INSTRUMENTATION GUARD. Every scenario below turns on x-forwarded-for
  // reaching the route. If undici dropped it, the victim's "public IP" would
  // be the loopback placeholder, the disclosure row would read as clean, and
  // this check would report a pass it had not earned.
  {
    const probe = mkReq('/dns-leak/start', VICTIM_IP);
    const seen = probe.headers.get('x-forwarded-for');
    if (!seen || !seen.endsWith(VICTIM_IP)) {
      throw new Error(`x-forwarded-for does not survive NextRequest construction (got ${JSON.stringify(seen)}); every row here would be vacuous`);
    }
  }

  const out = { notes: [] };

  // =========================================================================
  // 1. Entropy, from the real generator.
  // =========================================================================
  {
    const SAMPLES = 20_000;
    const alphabet = new Set();
    const lengths = new Set();
    const seen = new Set();
    for (let i = 0; i < SAMPLES; i++) {
      const id = dnsLeak.generateTestId();
      lengths.add(id.length);
      seen.add(id);
      for (const ch of id) alphabet.add(ch);
    }
    const length = Math.max(...lengths);
    out.entropy = {
      samples: SAMPLES,
      alphabetSize: alphabet.size,
      alphabet: [...alphabet].sort().join(''),
      lengths: [...lengths].sort((a, b) => a - b),
      length,
      duplicates: SAMPLES - seen.size,
      bits: length * Math.log2(alphabet.size),
    };
  }

  // The guessing arithmetic, with the budget read out of the route source so a
  // loosened limit changes the number instead of quietly invalidating it.
  {
    const src = readFileSync(join(ROOT, 'app/dns-leak/result/route.ts'), 'utf-8');
    // [\d_]+, not \d+: the source writes `windowMs: 60_000`, and a \d+ stops
    // at the separator, reads 60, and overstates the attacker's budget by a
    // factor of a thousand. Evidence that is wrong in the defender's favour
    // is still wrong.
    const m = /RESULT_RATE_LIMIT_CONFIG\s*=\s*\{\s*limit:\s*([\d_]+),\s*windowMs:\s*([\d_]+)/.exec(src);
    const num = (s) => Number(String(s).replace(/_/g, ''));
    const limit = m ? num(m[1]) : null;
    const windowMs = m ? num(m[2]) : null;
    // A window under a second is not a real config; it is the separator bug
    // above coming back. Treated as a failed read rather than used.
    out.budget = { limit, windowMs, found: Boolean(m) && windowMs >= 1000 && limit > 0 };
    const space = out.entropy.alphabetSize ** out.entropy.length;
    const attempts = out.budget.found ? (limit / (windowMs / 1000)) * dnsLeak.TEST_TTL_SECONDS : null;
    out.guessing = { attempts, space, probability: attempts === null ? null : attempts / space };
  }

  // =========================================================================
  // 2. A real test, started by one visitor and read by another.
  // =========================================================================
  const startRes = await startRoute.POST(mkReq('/dns-leak/start', VICTIM_IP));
  const startBody = await readBody(startRes);
  const id = startBody && startBody.id;

  // Captured HERE, not in the TTL section below. The scenarios in between
  // truncate the command log to isolate their own reads, and the first draft
  // of this file looked for the SET afterwards — finding nothing and reporting
  // "written with no expiry" against a route that writes EX 600. A harness
  // that manufactures its own finding is worse than no harness, so the write
  // is taken the moment it happens.
  const startWrite = id ? S.log.find((e) => e.cmd === 'set' && e.key === dnsLeak.testKey(id)) : null;

  out.control = {
    startStatus: startRes.status,
    storage: startBody && startBody.storage,
    zone: startBody && startBody.zone,
    id,
    recordWritten: Boolean(id && S.kv.has(dnsLeak.testKey(id))),
  };
  if (!id) return { ...out, egress: ledger(egress) };

  // The nameserver's side of the test: one observation, as
  // scripts/dnsleak-server.mjs would RPUSH it.
  S.lists.set(dnsLeak.seenKey(id), [
    JSON.stringify({ resolverIp: VICTIM_RESOLVER_IP, ts: 1_700_000_000_000, qname: `1.${id}.${out.control.zone}` }),
  ]);

  {
    const res = await resultRoute.POST(mkReq('/dns-leak/result', ATTACKER_IP, { id }));
    const body = await readBody(res);
    out.foreign = {
      id,
      status: res.status,
      publicIp: body ? body.publicIp : null,
      resolverIps: body && Array.isArray(body.resolvers) ? body.resolvers.map((r) => r.ip) : [],
      observations: body ? body.observations : null,
      storage: body ? body.storage : null,
      body,
    };
  }

  // =========================================================================
  // 3. Hit vs. miss — shape, values, work done, and the clock.
  // =========================================================================
  {
    const unissued = dnsLeak.generateTestId();

    S.log.length = 0;
    const hitRes = await resultRoute.POST(mkReq('/dns-leak/result', ATTACKER_IP, { id }));
    const hitBody = await readBody(hitRes);
    const hitCommands = dnsLeakCommands();

    S.log.length = 0;
    const missRes = await resultRoute.POST(mkReq('/dns-leak/result', ATTACKER_IP, { id: unissued }));
    const missBody = await readBody(missRes);
    const missCommands = dnsLeakCommands();

    // The clock is measured and REPORTED, never asserted on: in-process
    // timings over a Map are dominated by scheduling noise, and a check that
    // red-lined on them would be flaky by construction. The command sequence
    // above is the assertion; this is context for a human reading the report.
    const SAMPLES = 25;
    const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const timeOne = async (body) => {
      const t0 = process.hrtime.bigint();
      await resultRoute.POST(mkReq('/dns-leak/result', ATTACKER_IP, body));
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const hitTimes = [];
    const missTimes = [];
    for (let i = 0; i < SAMPLES; i++) {
      hitTimes.push(await timeOne({ id }));
      missTimes.push(await timeOne({ id: dnsLeak.generateTestId() }));
    }

    out.oracle = {
      hit: {
        status: hitRes.status,
        keys: hitBody ? Object.keys(hitBody).sort() : [],
        publicIp: hitBody ? hitBody.publicIp : null,
        observations: hitBody ? hitBody.observations : null,
      },
      miss: {
        status: missRes.status,
        keys: missBody ? Object.keys(missBody).sort() : [],
        publicIp: missBody ? missBody.publicIp : null,
        observations: missBody ? missBody.observations : null,
      },
      hitCommands,
      missCommands,
      timingSamples: SAMPLES,
      hitMedianMs: median(hitTimes),
      missMedianMs: median(missTimes),
    };
  }

  // =========================================================================
  // 4. The TTL is on the write, and an expired record really is gone.
  // =========================================================================
  {
    const write = startWrite;
    const args = write ? write.args : [];
    const expiring = args[0] === 'EX' && typeof args[1] === 'number';

    const entry = S.kv.get(dnsLeak.testKey(id));
    if (entry) entry.expiresAt = Date.now() - 1;
    const afterRes = await resultRoute.POST(mkReq('/dns-leak/result', ATTACKER_IP, { id }));
    const afterBody = await readBody(afterRes);

    out.ttl = {
      writeObserved: Boolean(write),
      key: write ? write.key : null,
      args,
      expiring,
      seconds: expiring ? args[1] : null,
      declared: dnsLeak.TEST_TTL_SECONDS,
      publicIpAfterExpiry: afterBody ? afterBody.publicIp : null,
      expiredRecordReadsAsAbsent: Boolean(afterBody) && afterBody.publicIp === null,
    };
  }

  // =========================================================================
  // 5. Widening the id into a search.
  // =========================================================================
  {
    const CASES = [
      { label: 'a prefix', body: { id: 'abcdef' } },
      { label: 'a trailing wildcard', body: { id: 'abcdefghijk*' } },
      { label: 'a Redis MATCH pattern', body: { id: 'dnsleak:test:*' } },
      { label: 'a list of ids', body: { id: ['abcdefghijkl', 'abcdefghijkm'] } },
      { label: 'an object', body: { id: { $ne: null } } },
      { label: 'a real id with a trailing newline', body: { id: `${id}\n` } },
      { label: 'a real id with a key separator appended', body: { id: `${id}:*` } },
      { label: 'uppercase id', body: { id: 'ABCDEFGHIJKL' } },
      { label: 'a numeric id', body: { id: 123456789012 } },
    ];
    out.widening = [];
    for (const c of CASES) {
      S.log.length = 0;
      const res = await resultRoute.POST(mkReq('/dns-leak/result', ATTACKER_IP, c.body));
      const body = await readBody(res);
      out.widening.push({
        label: c.label,
        body: c.body,
        status: res.status,
        responseBody: body,
        // A refusal that happens AFTER the lookup is not a refusal.
        storageCommands: dnsLeakCommands(),
      });
    }
  }

  return { ...out, egress: ledger(egress) };
}

function ledger(egress) {
  const LOOPBACK = /^(127\.0\.0\.1|::1|localhost):/;
  return { all: [...new Set(egress)], offBox: [...new Set(egress.filter((e) => !LOOPBACK.test(e)))] };
}
