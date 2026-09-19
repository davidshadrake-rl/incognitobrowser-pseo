/**
 * A response body must carry only what it was designed to carry.
 *
 * Two properties, one sweep, because both are about a response saying more
 * than it should.
 *
 * (a) ERROR BODIES. /scan-url handles attacker-chosen targets, so a debugging
 *     `err.message` added to one of its 502s would hand the caller DNS
 *     resolution detail, internal paths, connection errors and the outbound
 *     fetch's own failure text — a side channel straight out of the box that
 *     also runs the team's WordPress and MySQL. app/scan-url/route.ts:299-303
 *     gets this right today: it logs the error and returns a fixed string.
 *     Nothing holds it there. So every reachable error branch of all seven
 *     routes is driven and its body is checked for two things: that its keys
 *     are a subset of {error, reason, redirectTo}, and that no value looks
 *     like a stack frame, a node internal, a deployment path or a syscall
 *     error code.
 *
 * (b) /ip's GEO PASSTHROUGH. app/ip/route.ts:56-62 runs decodeURIComponent
 *     over x-geo-country / -city / -region / -timezone and returns them in the
 *     body. The route's own comment says "Nothing on the droplet populates
 *     these today", and the vhost's `RequestHeader unset` list covers only the
 *     four IP headers — so in production every geo value in that response is
 *     the caller's own input, reflected. It is self-inflicted (you can only
 *     forge your own headers) and the response is no-store, which is why it is
 *     low. But the fields are unbounded in length, they flow into
 *     buildIpResponse which /dns-leak/start also calls, and countryCode is fed
 *     straight to Intl.DisplayNames.
 *
 * ON PRODUCTION SAFETY, because the adversarial reviewer flagged this check as
 * wrongly marked prod-safe. The objection was specific and correct in general:
 * the 502 fetch-failure, timeout and redirect branches of /scan-url are only
 * reachable through a real outbound fetch, so an every-commit check that drove
 * them would start doing live network egress on every build, and flaking when
 * a target was slow. That objection is answered by construction rather than by
 * assertion: scripts/security/checks/api-inproc.mjs replaces globalThis.fetch
 * with a recorder and stubs dns.lookup through promisify.custom before any
 * route module is loaded, so those three branches are reached by making the
 * RECORDER fail, and no scenario in this file can open a socket. Each row
 * carries the recorder's own count, and a row that reports an outbound request
 * where none was expected is reported here as a finding against this check.
 * If that mechanism is ever removed, this check must go needsOptIn.
 *
 * Deliberately excluded, and why: the 500 branch at scan-url/route.ts:351-355
 * is not driven. Reaching it means making analyzeScan or NextResponse.json
 * throw, which would mean stubbing application internals rather than
 * boundaries — at which point the harness is grading its own stubs. The other
 * sixteen /scan-url branches are real.
 */
import { check, finding } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

/** Keys an error body may contain. Anything else is something someone added. */
const ALLOWED_KEYS = new Set(['error', 'reason', 'redirectTo']);

/**
 * What a leaked internal looks like. Scoped tightly on purpose: this repo
 * legitimately contains 500 scanned third-party sites under data/, editorial
 * copy that names real trackers and companies, and ad-shaped bait files under
 * public/adtest/. None of that is in an API error body, and none of these
 * patterns would match it anyway — they are stack frames, node internals, the
 * deployment path and syscall codes.
 */
const LEAK = /\bat\s+\S+\s*\(|node:internal|\/opt\/ib-api|\/var\/www|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|redis:\/\/|127\.0\.0\.1:\d+/;

/** Headers that would announce internal state if anyone wired them up. */
const DIAGNOSTIC_HEADER = /^x-(redis|debug|error|internal|trace|backend)/;

export default check({
  id: 'api-error-shape',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Error bodies carry a fixed string and nothing else, and /ip reflects no unbounded caller input.',
  async run() {
    const o = await observe();
    const findings = [];
    let checked = 0;

    // FIRST, the claim this check's cadence rests on. The adversarial reviewer
    // marked this check as wrongly prod-safe because driving the /scan-url 502
    // and redirect branches would mean live network egress on every commit.
    // The answer is a ledger, not a promise: the harness records every TCP
    // connection the probe process opens. Loopback is expected — the Redis
    // scenarios point at a closed port on 127.0.0.1. Anything else means the
    // boundary stubs are no longer the only way out, and this check must be
    // set needsOptIn until they are.
    checked += 1;
    if (o.egress && o.egress.offBox.length) {
      findings.push(finding({
        severity: 'medium',
        title: 'The in-process API harness opened a connection off the box',
        detail: 'These checks run on every commit, inside the unit suite that gates every build, on the basis that nothing in them can reach the network. That is no longer true. Until the fetch recorder and the dns.lookup stub are the only paths out again, this check must not run unattended on every commit.',
        evidence: `the probe process connected to ${o.egress.offBox.join(', ')} (all destinations: ${o.egress.all.join(', ') || 'none'})`,
        remediation: 'Restore the globalThis.fetch recorder and the util.promisify.custom dns stub in scripts/security/checks/api-inproc.mjs, or set needsOptIn: true on this check.',
        file: 'scripts/security/checks/api-inproc.mjs',
        line: null,
      }));
    }

    for (const r of o.errors) {
      checked += 1;
      if (r.status < 400) continue; // success bodies are a different contract
      const body = r.body;
      if (body === null) continue; // e.g. the 404 from an unconfigured /stats, which has no body at all

      const strayKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
      if (strayKeys.length) {
        findings.push(finding({
          severity: 'medium',
          title: `An error body grew a new key: ${r.label}`,
          detail: 'Error responses on these routes are a fixed shape. A new key is how debugging detail reaches a caller who chose the input that produced it.',
          evidence: `${r.label} => ${r.status} ${JSON.stringify(body).slice(0, 300)}; unexpected key(s) ${strayKeys.join(', ')}`,
          remediation: 'Keep error bodies to { error } plus the two documented extras: reason (proof-of-work / replay) and redirectTo (the 3xx refusal).',
          file: null,
          line: null,
        }));
      }

      for (const [k, v] of Object.entries(body)) {
        // `redirectTo` is EXCLUDED from the leak scan, deliberately. It is the
        // Location header of the caller's own target, capped at 500 characters
        // and returned so the UI can say where the URL went — it is the
        // caller's data coming back, not ours. Scanning it for internal-looking
        // strings means anyone can produce a red line by pointing the scanner
        // at a site of theirs that redirects to 127.0.0.1, and a check that can
        // be triggered by an outsider on demand gets switched off.
        if (k === 'redirectTo') continue;
        if (typeof v !== 'string' || !LEAK.test(v)) continue;
        findings.push(finding({
          severity: 'high',
          title: `An error body leaked internal detail: ${r.label}`,
          detail: 'The value matches a stack frame, a node internal, a deployment path, a syscall error code or an internal address. On /scan-url the caller chose the target that produced it, which makes this a probe of the host\'s own network from the outside.',
          evidence: `${r.label} => ${r.status}, ${k} = ${JSON.stringify(v).slice(0, 220)}`,
          remediation: 'Log the error server-side and return the fixed string, the way app/scan-url/route.ts:299-303 already does.',
          file: null,
          line: null,
        }));
      }

      const diagnostic = (r.headers || []).filter((h) => DIAGNOSTIC_HEADER.test(h));
      if (diagnostic.length) {
        findings.push(finding({
          severity: 'medium',
          title: `A diagnostic header reached the caller: ${r.label}`,
          detail: 'lib/rate-limit.ts exports getRedisDiagnostic, whose comment says it is "surfaced via response headers". If that ever becomes true, the API announces whether Redis is configured and what its last error was to anyone who asks.',
          evidence: `${r.label} => ${r.status} carried header(s) ${diagnostic.join(', ')}`,
          remediation: 'Remove the header. Rate-limit state already travels in the standard X-RateLimit-* headers.',
          file: null,
          line: null,
        }));
      }
    }

    // --- the /ip geo passthrough -------------------------------------------
    for (const g of o.geo) {
      checked += 1;
      if (g.status !== 200) {
        findings.push(finding({
          severity: 'medium',
          title: `/ip failed on a header a caller can set: ${g.label}`,
          detail: `${g.why}. /ip is the first call the What's My IP tool makes; a header that can break it is a header that can break the tool for the person who sent it.`,
          evidence: `POST /ip (${g.label}) => ${g.status}`,
          remediation: 'Keep the try/catch around decodeURIComponent in app/ip/route.ts:56-62.',
          file: 'app/ip/route.ts',
          line: 56,
        }));
        continue;
      }
      if (g.label.startsWith('no geo headers')) {
        const populated = ['city', 'region', 'countryCode', 'country', 'timezone'].filter((k) => g[k] !== null && g[k] !== undefined);
        if (populated.length) {
          findings.push(finding({
            severity: 'low',
            title: '/ip populated geo fields that no header supplied',
            detail: 'The route\'s contract is that geo comes only from x-geo-* request headers and is null when they are absent. A value appearing from somewhere else means a new source was added — most likely an outbound lookup, which is the third-party call this route exists to remove.',
            evidence: `POST /ip with no geo headers => ${populated.map((k) => `${k}=${JSON.stringify(g[k])}`).join(', ')}`,
            remediation: 'Geo stays header-sourced. If Apache ever sets these from a GeoIP module, that is the only new source.',
            file: 'app/ip/route.ts',
            line: 72,
          }));
        }
        continue;
      }
      const m = /^len=(\d+)$/.exec(String(g.city || ''));
      if (m && Number(m[1]) > 128) {
        findings.push(finding({
          severity: 'low',
          title: '/ip reflects unbounded caller-supplied geo headers back in its response',
          detail:
            'app/ip/route.ts decodeHeader() returns x-geo-city / -region / -country / -timezone verbatim, with no length bound. Nothing on the droplet sets these and the vhost strips only the four IP headers, so in production every value here is the caller\'s own input coming back. It is self-inflicted and the response is no-store, so there is no victim other than the sender — but the same buildIpResponse also answers /dns-leak/start, and countryCode is handed to Intl.DisplayNames, so an unbounded string is being carried further than it needs to be.',
          evidence: `POST /ip with x-geo-city: "A"×4096 => 200 with city length ${m[1]}`,
          remediation: 'Bound each geo field to something a place name fits in (64-128 characters) inside decodeHeader, and drop values that exceed it rather than truncating into a half-name. Adding x-geo-* to the vhost\'s RequestHeader unset list would close it at the proxy too.',
          file: 'app/ip/route.ts',
          line: 56,
        }));
      }
    }

    // --- the dead debug export ---------------------------------------------
    checked += 1;
    if (o.diagnostic && o.diagnostic.callers.length === 0) {
      findings.push(finding({
        severity: 'info',
        title: 'getRedisDiagnostic is dead code whose comment invites someone to wire it up',
        detail:
          'lib/rate-limit.ts:66 exports getRedisDiagnostic() and documents it as "surfaced via response headers". It has no caller anywhere in app/ or lib/. Guarding a dead hazard with a test is the cheaper-looking option that leaves the hazard in the tree: the next person to debug a Redis problem finds an exported helper whose comment tells them to put its output in a response.',
        evidence: `scanned ${o.diagnostic.scanned} .ts/.tsx files under app/ and lib/; getRedisDiagnostic( appears at no call site`,
        remediation: 'Delete the export. getRedisStatus() covers the one thing a route legitimately needs to know.',
        file: 'lib/rate-limit.ts',
        line: 66,
      }));
    }

    return { findings, checked };
  },
});
