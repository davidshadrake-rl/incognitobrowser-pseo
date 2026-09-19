/**
 * Every API route answers only the verbs it exports, and never leaks the box.
 *
 * scripts/security-smoke.mjs checks GET on /scan-url and /ip. That is two
 * cells of a forty-two cell table. A route added later — or a handler exported
 * by mistake, which is one keyword — answering PUT or DELETE is invisible
 * today, and these seven routes have no authentication of any kind by design.
 *
 * The second half is the one that would have caught something real. On an
 * unhandled path, Next's default error surface renders a page; on this deploy
 * that would be a chance to disclose /opt/ib-api (where the service is
 * installed), a node_modules stack frame with dependency versions, or the
 * redis:// URL that names the store holding every rate-limit counter and every
 * single-use proof-of-work claim. The droplet's layout is not public knowledge
 * and should stay that way. It also covers the paths the verb matrix never
 * reaches: /api/<unknown>, /api/_next/* and a path that would hit the
 * service's own public/ directory.
 *
 * NO POSTs, deliberately. POST is the only verb that reaches a rate limiter on
 * any of these routes, so this whole matrix consumes none of any visitor's
 * budget — 10 scans/min, 30 challenges/min, the global in-flight cap — on a
 * 2-vCPU box that also serves the team's WordPress and MySQL. TRACE is
 * included because it double-covers Apache's TraceEnable Off.
 *
 * /stats is graded loosely (404 or 405): it returns 404 when STATS_TOKEN is
 * unset, which is a deliberate "this does not exist here" and not a failure.
 */
import { check, finding } from '../lib/harness.mjs';
import { findLeaks, pace, rawRequest, httpOnce } from './dast-shared.mjs';

const ROUTES = ['/challenge', '/scan-url', '/ip', '/dns-leak/start', '/dns-leak/result', '/event', '/stats'];
const VERBS = ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'TRACE'];

/** Paths that should reach the Node service and be told no, not rendered. */
const UNKNOWN_PATHS = ['/nope-not-a-route', '/_next/static/chunks/main.js', '/public/robots.txt'];

export default check({
  id: 'dast-api-method-matrix',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'All seven API routes refuse every verb but their own, and no response body discloses the droplet\'s filesystem layout or plumbing.',

  async run(ctx) {
    const findings = [];
    let checked = 0;
    let reachable = 0;

    const target = new URL(ctx.apiBase);
    const apiPath = target.pathname.replace(/\/$/, '');

    /**
     * undici refuses to send TRACE at all ("'TRACE' HTTP method is
     * unsupported"), so a fetch-based probe reports "could not complete" every
     * night and never asks the server anything. That is precisely the
     * silent-nothing failure this suite exists to prevent, so TRACE goes over a
     * socket we write ourselves. It is also the only way to see what Apache's
     * TraceEnable Off actually answers.
     */
    const send = async (verb, path) => {
      if (verb !== 'TRACE') {
        const res = await httpOnce(ctx, `${ctx.apiBase}${path}`, { method: verb, redirect: 'manual' });
        return { ok: res.ok, status: res.status, text: res.text, error: res.error, contentType: res.ok ? (res.headers.get('content-type') || '') : '' };
      }
      const raw = await rawRequest({
        host: target.hostname,
        port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
        useTls: target.protocol === 'https:',
        method: 'TRACE',
        path: `${apiPath}${path}`,
        headers: { Host: target.host, 'User-Agent': 'security-suite/dast-api-method-matrix' },
      });
      return { ok: raw.ok, status: raw.status, text: raw.body || '', error: raw.error, contentType: raw.headers?.['content-type'] || '' };
    };

    const grade = (res, label) => {
      const leaks = findLeaks(res.text);
      if (!leaks.length) return;
      findings.push(finding({
        severity: 'high',
        title: `${label} leaked internal detail in its response body`,
        detail: 'These routes are open to the internet with no authentication. A response that names /opt/ib-api, node_modules, a stack frame or the redis:// URL hands an attacker the deployment layout and the dependency versions to look up.',
        evidence: `${label} → ${res.status}\n  ${leaks.map((l) => `${l.marker}: …${l.context}…`).join('\n  ')}`,
        remediation: 'Catch the throw in the route and return a plain JSON error. Never let Next\'s default error surface reach an internet-facing API response.',
      }));
    };

    for (const route of ROUTES) {
      for (const verb of VERBS) {
        await pace(25);
        const url = `${ctx.apiBase}${route}`;
        const res = await send(verb, route);
        if (!res.ok) {
          findings.push(finding({
            severity: 'low',
            title: `${verb} ${route} could not be completed`,
            detail: 'An unreachable probe is not a pass.',
            evidence: `${verb} ${url} → ${res.error}`,
            remediation: 'Re-run when the API is reachable.',
          }));
          continue;
        }
        reachable++;
        checked++;
        grade(res, `${verb} ${route}`);

        const acceptable = route === '/stats' ? [404, 405] : [405];
        if (acceptable.includes(res.status)) continue;
        // 400/403 from Apache is also a refusal; only a 2xx or 3xx means the
        // verb was actually handled.
        if (res.status >= 400) continue;
        findings.push(finding({
          severity: 'medium',
          title: `${verb} ${route} was handled (${res.status}) instead of refused`,
          detail: 'These routes export POST (and OPTIONS) only. A verb that is answered rather than refused means a handler was exported that nobody intended — and on this API that handler runs with no authentication in front of it.',
          evidence: `${verb} ${url} → ${res.status}, content-type ${res.contentType || '(none)'}, ${res.text.length} bytes: ${res.text.replace(/\s+/g, ' ').slice(0, 140)}`,
          remediation: `Remove the exported ${verb} handler from app${route}/route.ts, or if it is intended, add it to this check's expectations and to the docs.`,
          file: `app${route}/route.ts`,
        }));
      }
    }

    for (const path of UNKNOWN_PATHS) {
      await pace(25);
      const url = `${ctx.apiBase}${path}`;
      const res = await httpOnce(ctx, url, { redirect: 'manual' });
      if (!res.ok) continue;
      reachable++;
      checked++;
      grade(res, `GET ${path}`);
      if (res.status === 200) {
        findings.push(finding({
          severity: 'medium',
          title: `GET /api${path} returned 200`,
          detail: 'Only seven routes are meant to exist behind /api/. Anything else answering 200 is a surface nobody wrote down — most likely the service\'s own static directory being proxied through.',
          evidence: `GET ${url} → 200, content-type ${res.headers.get('content-type') || '(none)'}, ${res.text.length} bytes`,
          remediation: 'Narrow the Apache ProxyPass, or confirm the Node service refuses the path.',
          file: 'API-ON-DROPLET.md',
        }));
      }
    }

    if (!reachable) {
      throw new ctx.Skip(`no probe reached ${ctx.apiBase} — the API is unreachable from here, so nothing was graded`);
    }

    return { findings, checked };
  },
});
