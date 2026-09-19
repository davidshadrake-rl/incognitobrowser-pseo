/**
 * /dns-leak/start and /dns-leak/result — the closest thing to an object
 * reference in this system (live).
 *
 * /dns-leak/result returns a visitor's public IP and the IP addresses of the
 * resolvers they used, keyed by nothing but a test id
 * (app/dns-leak/result/route.ts:77-83). Both routes have zero coverage in
 * scripts/security-smoke.mjs and no behavioural test anywhere.
 *
 * Enumeration is NOT the threat and this check does not hammer it: the id is
 * 12 characters of base36 (~62 bits, lib/dns-leak.ts:36-37) living 600
 * seconds behind a 100/minute bucket. Guessing one is not a path. What IS
 * worth pinning is the set of properties that keep it that way, none of which
 * anything tests:
 *
 *   - the origin gate is actually on both routes;
 *   - isValidTestId genuinely rejects — a regex loosened to `[a-z0-9]+` or a
 *     check that stopped running would turn the id into a prefix search;
 *   - an unknown-but-well-formed id returns the SAME empty shape as a real id
 *     that nobody has polled for yet. If they differed, the endpoint would be
 *     an oracle for which ids exist, and 62 bits would start to matter;
 *   - the route's own 512-byte body cap is actually in the running build. That
 *     row is here rather than only in the opt-in live-body-cap-chunked check
 *     because a 1 KB body is not volumetric, and because the first live run
 *     found the cap missing on the droplet while present in this source.
 *
 * Cost: ten requests against 20/minute (start) and 100/minute (result)
 * budgets. One test id is created, which writes one small key that expires in
 * 600 seconds. Nothing is scanned and nothing is fetched outbound.
 */
import { randomBytes } from 'node:crypto';
import { check, finding, Skip } from '../lib/harness.mjs';

const TEST_ID_RE = /^[a-z0-9]{12}$/;
const EVIL = 'https://evil.example';

/** A well-formed id that was never issued. base36, 12 chars, same shape as a real one. */
function unissuedId() {
  let s = '';
  while (s.length < 12) s += randomBytes(8).readBigUInt64BE(0).toString(36);
  return s.slice(0, 12);
}

export default check({
  id: 'live-dnsleak-contract',
  discipline: 'api',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Both /dns-leak routes gate on Origin, validate the test id, and do not distinguish an unknown id from an unpolled one.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const post = (path, body, { origin = ctx.origin } = {}) => ctx.http(`${ctx.apiBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
      timeoutMs: 15_000,
    });

    // Reachability first, so an unreachable host SKIPS rather than reporting
    // a wall of "did not return 200".
    const probe = await post('/dns-leak/result', { id: unissuedId() });
    if (!probe.ok) throw new Skip(`${ctx.apiBase}/dns-leak/result unreachable: ${probe.error}`);
    if (probe.status === 429) throw new Skip('the /dns-leak/result bucket is already at its limit; rerun rather than record a pass');

    // --- the origin gate ---------------------------------------------------
    for (const path of ['/dns-leak/start', '/dns-leak/result']) {
      const res = await post(path, { id: unissuedId() }, { origin: EVIL });
      checked += 1;
      if (!res.ok) throw new Skip(`${path} with a foreign Origin failed to complete: ${res.error}`);
      const acao = res.headers.get('access-control-allow-origin');
      if (res.status !== 403 || acao) {
        findings.push(finding({
          severity: 'medium',
          title: `${path} no longer refuses a foreign Origin`,
          detail: 'The origin gate is the first filter in front of a route that returns a visitor\'s public IP and their resolvers. Mirroring the foreign origin back in Access-Control-Allow-Origin would additionally make the response readable by the page that asked for it.',
          evidence: `POST ${ctx.apiBase}${path} with Origin: ${EVIL} => ${res.status}${acao ? `, Access-Control-Allow-Origin: ${acao}` : ', no ACAO'}`,
          remediation: 'Keep the isOriginAllowed guard at the top of both handlers.',
          file: `app${path}/route.ts`,
          line: null,
        }));
      }
    }

    // --- id validation -----------------------------------------------------
    const BAD_IDS = [
      { label: 'id absent', body: {} },
      { label: 'id = 123 (a number, three digits)', body: { id: '123' } },
      { label: 'id with uppercase', body: { id: 'ABCDEF123456' } },
      { label: 'id 13 characters long', body: { id: 'abcdef1234567' } },
      { label: 'id as a wildcard', body: { id: '*' } },
    ];
    for (const c of BAD_IDS) {
      const res = await post('/dns-leak/result', c.body);
      checked += 1;
      if (!res.ok) throw new Skip(`${c.label}: request failed (${res.error}); partial result, not a pass`);
      if (res.status === 400) continue;
      findings.push(finding({
        severity: res.status === 200 ? 'high' : 'medium',
        title: `/dns-leak/result accepted a malformed test id: ${c.label}`,
        detail:
          'isValidTestId is what keeps the id an opaque 62-bit token rather than something a caller can shape. A loosened pattern — or a check that stopped running — turns the lookup into a search, and the thing being searched for is a visitor\'s public IP and the resolvers they used.',
        evidence: `POST ${ctx.apiBase}/dns-leak/result ${JSON.stringify(c.body)} => ${res.status} ${JSON.stringify(res.json || res.text).slice(0, 200)}`,
        remediation: 'Keep `if (!isValidTestId(id)) return 400` before readDnsLeakTest, and keep TEST_ID_RE anchored at ^[a-z0-9]{12}$.',
        file: 'app/dns-leak/result/route.ts',
        line: 89,
      }));
    }

    // --- an unknown id must look exactly like an unpolled one ---------------
    {
      const res = await post('/dns-leak/result', { id: unissuedId() });
      checked += 1;
      if (!res.ok) throw new Skip(`the unknown-id request failed: ${res.error}`);
      const b = res.json || {};
      const empty = res.status === 200 && b.publicIp === null && Array.isArray(b.resolvers) && b.resolvers.length === 0 && b.observations === 0;
      if (!empty) {
        findings.push(finding({
          severity: 'medium',
          title: '/dns-leak/result distinguishes an unknown test id from a real one',
          detail:
            'A 404, an error string or a different body shape for an id that was never issued turns this route into an oracle for which ids exist. The id is only 62 bits of entropy with a 600-second life; the reason that is enough is that a wrong guess is indistinguishable from a right guess nobody has polled yet.',
          evidence: `POST ${ctx.apiBase}/dns-leak/result with a freshly generated, never-issued id => ${res.status} ${JSON.stringify(b).slice(0, 220)}`,
          remediation: 'Return the same { id, publicIp: null, resolvers: [], observations: 0, storage } shape for an unknown id as for an unpolled one.',
          file: 'app/dns-leak/result/route.ts',
          line: 94,
        }));
      }
    }

    // --- the route's own body cap, live -----------------------------------
    // One 1 KB body: twice this route's documented 512-byte limit, a thousandth
    // of Apache's 1 MB condition, and no load worth the name. It is here rather
    // than only in live-body-cap-chunked because that check is opt-in and
    // on-demand, so nothing in the scheduled run would ever notice the cap
    // going missing — and when this was first run against the droplet, it WAS
    // missing: the route buffered and parsed a 1 KB body and answered on its
    // merits, while the same source in this repository refuses it in-process.
    // That difference is a deployed build lagging the source, which is exactly
    // the class of problem a nightly probe exists to keep visible.
    {
      const res = await post('/dns-leak/result', { id: 'a'.repeat(1000) });
      checked += 1;
      if (!res.ok) throw new Skip(`the body-cap probe failed: ${res.error}`);
      if (res.status !== 413) {
        findings.push(finding({
          severity: 'medium',
          title: '/dns-leak/result buffers and parses a body well past its own 512-byte cap',
          detail:
            'app/dns-leak/result/route.ts:74-82 checks Content-Length before buffering and the buffered length after, because Content-Length can lie. Neither fired. The whole body this route needs is {"id":"<12 chars>"}. If the source in this repository does refuse it — the in-process check api-error-shape says it does — then the running build is older than the source, and every other cap added in the same round is suspect too.',
          evidence: `POST ${ctx.apiBase}/dns-leak/result with a ~1011-byte body (cap 512) => ${res.status} ${JSON.stringify(res.json || res.text).slice(0, 160)}`,
          remediation: 'Redeploy the API and confirm the build actually rebuilt (scripts/deploy-api.sh must run npm ci). Then re-run: this probe must answer 413.',
          file: 'app/dns-leak/result/route.ts',
          line: 74,
        }));
      }
    }

    // --- one real start, to confirm the id shape and the zone --------------
    {
      const res = await post('/dns-leak/start', {});
      checked += 1;
      if (!res.ok) throw new Skip(`/dns-leak/start failed: ${res.error}`);
      if (res.status === 429) throw new Skip('the /dns-leak/start bucket is at its limit; rerun rather than record a pass');
      const b = res.json || {};
      const problems = [];
      if (res.status !== 200) problems.push(`status ${res.status}`);
      if (typeof b.id !== 'string' || !TEST_ID_RE.test(b.id)) problems.push(`id ${JSON.stringify(b.id)} does not match ${TEST_ID_RE}`);
      if (!Array.isArray(b.hostnames) || !b.hostnames.length) problems.push('no hostnames returned');
      else {
        const stray = b.hostnames.filter((h) => typeof h !== 'string' || !h.endsWith(`.${b.zone}`));
        if (stray.length) problems.push(`hostname(s) outside the delegated zone ${b.zone}: ${stray.slice(0, 2).join(', ')}`);
      }
      if (problems.length) {
        findings.push(finding({
          severity: 'medium',
          title: '/dns-leak/start issued a test that does not match its own contract',
          detail:
            'The id must be 12 base36 characters, and every hostname the browser is asked to resolve must sit under the zone we are authoritative for. A hostname outside that zone sends the visitor\'s resolver — and therefore a record of the visitor — to a nameserver that is not ours.',
          evidence: `POST ${ctx.apiBase}/dns-leak/start => ${res.status}; ${problems.join('; ')}; body ${JSON.stringify(b).slice(0, 260)}`,
          remediation: 'Keep buildHostnames anchored to DNSLEAK_ZONE and generateTestId to TEST_ID_LENGTH/TEST_ID_RE in lib/dns-leak.ts.',
          file: 'app/dns-leak/start/route.ts',
          line: 85,
        }));
      }
    }

    return { findings, checked };
  },
});
