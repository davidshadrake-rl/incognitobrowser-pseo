/**
 * Malformed input produces JSON, not a stack trace.
 *
 * Every route handles JSON.parse failure explicitly today — app/event:48,
 * app/dns-leak/result:88, and so on. That is per-route, it is one `try` each,
 * and it is exactly the kind of thing the next route added forgets. If one
 * does, Next's default error surface renders on an endpoint that is open to
 * the internet with no authentication, and on this deploy it would disclose
 * /opt/ib-api, a node_modules frame with dependency versions, or the redis://
 * URL naming the store that holds every rate-limit counter and every
 * single-use proof-of-work claim.
 *
 * Four cases per route, and they are cheap on purpose:
 *   1. a body that is not JSON at all
 *   2. the literal `null` — valid JSON, but not an object, which is where a
 *      `body.foo` destructure throws rather than returning 400
 *   3. a valid JSON body with the wrong Content-Type
 *   4. a declared Content-Length of 5 MB with ~50 bytes actually sent
 *
 * Case 4 has to go over a raw socket. undici owns the framing and silently
 * rewrites Content-Length, so a fetch version of this case tests nothing and
 * passes forever. It sends a lying header, not 5 MB of data: the Apache
 * `<If "%{HTTP:Content-Length} -gt 1048576">` block and the app's own declared
 * -length cap both key off the header, so the refusal happens before any body
 * crosses the wire. Actually sending an oversized body is the one genuinely
 * volumetric probe in this discipline and it shares an uplink with the team's
 * WordPress, so it is not here at all — verify that by hand from the runbook
 * if it is ever in doubt.
 *
 * /scan-url is skipped entirely. Its budget is 10 POSTs a minute, the tightest
 * on the box, and scripts/security-smoke.mjs already spends it. Nothing here
 * should make a real visitor's scan fail.
 */
import { check, finding } from '../lib/harness.mjs';
import { findLeaks, pace, rawRequest, httpOnce } from './dast-shared.mjs';

const ROUTES = ['/challenge', '/ip', '/event', '/dns-leak/start', '/dns-leak/result', '/stats'];
const MAX_ERROR_BODY = 8 * 1024;

export default check({
  id: 'dast-error-leakage-malformed',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Garbage input to every route (bad JSON, null, wrong content-type, a lying Content-Length) returns a small JSON error, never a stack trace or a filesystem path.',

  async run(ctx) {
    const findings = [];
    let checked = 0;
    let reachable = 0;

    const grade = (label, status, contentType, body) => {
      checked++;
      const leaks = findLeaks(body);
      if (leaks.length) {
        findings.push(finding({
          severity: 'high',
          title: `${label} leaked internal detail`,
          detail: 'An unhandled throw reached the default error surface on a route that is open to the internet with no authentication.',
          evidence: `${label} → ${status}\n  ${leaks.map((l) => `${l.marker}: …${l.context}…`).join('\n  ')}`,
          remediation: 'Wrap the parse and the handler body so every failure returns a plain JSON error. The pattern already exists in app/dns-leak/result/route.ts.',
        }));
      }
      if (body && body.length > MAX_ERROR_BODY) {
        findings.push(finding({
          severity: 'medium',
          title: `${label} returned a ${body.length}-byte error body`,
          detail: 'These routes answer errors in a sentence of JSON. Kilobytes of body on a malformed request means a rendered error page, which is the shape that carries stack frames.',
          evidence: `${label} → ${status}, content-type ${contentType || '(none)'}, ${body.length} bytes: ${body.replace(/\s+/g, ' ').slice(0, 200)}`,
          remediation: 'Return JSON from the route rather than letting the framework render.',
        }));
      }
      // A refusal from Apache (the body cap) is text/html by design and is not
      // graded for content-type; a 404 with an empty body is /stats saying it
      // is not configured here, which is deliberate.
      if (status >= 500) {
        findings.push(finding({
          severity: 'medium',
          title: `${label} returned ${status}`,
          detail: 'Malformed input is a client error. A 5xx means the request reached code that did not expect it — the state in which a leak becomes possible.',
          evidence: `${label} → ${status}, ${body.length} bytes: ${body.replace(/\s+/g, ' ').slice(0, 200)}`,
          remediation: 'Validate before dereferencing, and return 400.',
        }));
      }
    };

    for (const route of ROUTES) {
      const url = `${ctx.apiBase}${route}`;
      const cases = [
        { label: 'not JSON', headers: { 'content-type': 'application/json', origin: ctx.origin }, body: '{{{not json at all' },
        { label: 'literal null', headers: { 'content-type': 'application/json', origin: ctx.origin }, body: 'null' },
        { label: 'wrong content-type', headers: { 'content-type': 'text/plain', origin: ctx.origin }, body: '{"ok":true}' },
      ];
      for (const c of cases) {
        await pace();
        const res = await httpOnce(ctx, url, { method: 'POST', headers: c.headers, body: c.body });
        const label = `POST ${route} [${c.label}]`;
        if (!res.ok) {
          findings.push(finding({
            severity: 'low',
            title: `${label} could not be completed`,
            detail: 'An unreachable probe is not a pass.',
            evidence: `${label} → ${res.error}`,
            remediation: 'Re-run when the API is reachable.',
          }));
          continue;
        }
        reachable++;
        grade(label, res.status, res.headers.get('content-type') || '', res.text);

        checked++;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const emptyBody = res.text.length === 0;
        if (!ct.includes('json') && !emptyBody && res.status < 500) {
          findings.push(finding({
            severity: 'low',
            title: `${label} answered ${res.status} as ${ct || '(no content-type)'}`,
            detail: 'corsHeadersFor() sets Content-Type: application/json on every response these routes produce. Anything else came from somewhere that is not the route.',
            evidence: `${label} → ${res.status}, content-type ${ct || '(none)'}, ${res.text.length} bytes: ${res.text.replace(/\s+/g, ' ').slice(0, 160)}`,
            remediation: 'Find what answered instead of the route — most likely Apache, before the proxy.',
          }));
        }
      }
    }

    // The lying Content-Length, on a socket we frame ourselves. One request.
    const target = new URL(ctx.apiBase);
    const apiPath = target.pathname.replace(/\/$/, '');
    const body = 'x'.repeat(50);
    const raw = await rawRequest({
      host: target.hostname,
      port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
      useTls: target.protocol === 'https:',
      method: 'POST',
      path: `${apiPath}/event`,
      headers: {
        Host: target.host,
        Origin: ctx.origin,
        'Content-Type': 'application/json',
        'Content-Length': '5000000',
        'User-Agent': 'security-suite/dast-error-leakage-malformed',
      },
      body,
      // Long enough to outlast mod_reqtimeout's body=10 deadline. Measured on
      // the live box: a declared 5 MB with 50 bytes sent is refused with 408
      // after ~10.7s, NOT with an immediate 403 from the vhost <If> block.
      // Both are refusals and both are fine; the difference is that the
      // refusal costs an Apache worker for ten seconds rather than being free.
      // API-ON-DROPLET.md's "verified 413→403 on 1.5 MB" describes the other
      // scenario, where the body is actually sent and Apache denies after
      // reading it. A timeout shorter than 10s here would report "could not
      // complete" every single night, which is how a check gets ignored.
      timeoutMs: 20_000,
    });
    if (raw.ok) {
      reachable++;
      const label = 'POST /event [Content-Length: 5000000, 50 bytes sent]';
      grade(label, raw.status, raw.headers?.['content-type'] || '', raw.body || '');
      checked++;
      // 403 is Apache's <If> body cap, 413 the app's own declared-length cap,
      // 408 mod_reqtimeout giving up on a body that never arrived. All three
      // are the request being refused. A 2xx means none of them fired.
      if (raw.status >= 200 && raw.status < 300) {
        findings.push(finding({
          severity: 'medium',
          title: 'A request declaring a 5 MB body was accepted',
          detail: 'Neither the Apache `<If "%{HTTP:Content-Length} -gt 1048576">` block nor the app\'s declared-length cap refused it. API-ON-DROPLET.md records that LimitRequestBody is silently INERT for reverse-proxied requests and that the <If> block is the form that actually works — so if that block is lost, nothing is left, and a real 5 MB POST would cross the wire to a 2-vCPU box that also runs the team\'s MySQL.',
          evidence: `${label} → ${raw.status} ${raw.statusLine}\n  body: ${(raw.body || '').replace(/\s+/g, ' ').slice(0, 200)}`,
          remediation: 'Restore the vhost <If> block from API-ON-DROPLET.md ("Abuse resistance"). Do not "restore" LimitRequestBody or a RewriteRule [R=413] in its place; both were tested and neither fires for a proxied request.',
          file: 'API-ON-DROPLET.md',
        }));
      }
    } else {
      findings.push(finding({
        severity: 'low',
        title: 'The declared-Content-Length probe did not complete',
        detail: 'A timeout here is itself interesting: it means nothing refused the request and the server sat waiting for 5 MB. Reported rather than counted as a pass.',
        evidence: `POST ${ctx.apiBase}/event with Content-Length: 5000000 → ${raw.error}`,
        remediation: 'Verify by hand: the vhost <If "%{HTTP:Content-Length} -gt 1048576"> block should refuse it immediately.',
      }));
    }

    if (!reachable) throw new ctx.Skip(`no probe reached ${ctx.apiBase} — nothing was graded`);

    return { findings, checked };
  },
});
