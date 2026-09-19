/**
 * A preflight must never hand a foreign origin an ACAO (live).
 *
 * The six OPTIONS handlers return 204 unconditionally — none of them checks
 * the origin. That is fine, and deliberate: the protection is that
 * corsHeadersFor() OMITS Access-Control-Allow-Origin when the origin is not
 * allowed, so the browser blocks the response itself. The whole arrangement
 * rests on that one omission.
 *
 * Which makes it exactly the thing someone breaks by accident. When a tool
 * appears "CORS-broken" in dev, the obvious fix is to hardcode an ACAO into
 * the OPTIONS handler, and it works, and nothing complains. Every route then
 * becomes callable from any page in a real browser — the one bypass class on
 * this API that does NOT require a scripted client, and therefore the one that
 * reaches ordinary visitors.
 *
 * The second half pins the opposite direction: for the real site origin the
 * ACAO must MIRROR that origin exactly, never `*`. A wildcard would be the
 * same hole written differently. And Access-Control-Allow-Credentials must
 * never be 'true' — there are no cookies here, so it has nothing to enable and
 * everything to lose.
 *
 * Cost: twelve preflights. OPTIONS bypasses the rate limiters entirely (they
 * run in POST only), nothing is written, nothing is fetched.
 */
import { check, finding, Skip } from '../lib/harness.mjs';

const EVIL = 'https://evil.example';
const ROUTES = ['/challenge', '/scan-url', '/ip', '/event', '/dns-leak/start', '/dns-leak/result'];

export default check({
  id: 'live-preflight-no-leak',
  discipline: 'api',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Preflights give a foreign origin no ACAO, mirror the real origin exactly, and never allow credentials.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const preflight = (path, origin) => ctx.http(`${ctx.apiBase}${path}`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      timeoutMs: 15_000,
    });

    const reach = await preflight(ROUTES[0], ctx.origin);
    if (!reach.ok) throw new Skip(`${ctx.apiBase}${ROUTES[0]} unreachable for OPTIONS: ${reach.error}`);

    for (const path of ROUTES) {
      // --- a foreign origin gets nothing ---
      const evil = await preflight(path, EVIL);
      checked += 1;
      if (!evil.ok) throw new Skip(`OPTIONS ${path} (foreign origin) failed: ${evil.error}; partial result, not a pass`);
      const evilAcao = evil.headers.get('access-control-allow-origin');
      const evilCreds = evil.headers.get('access-control-allow-credentials');
      if (evilAcao) {
        findings.push(finding({
          severity: 'high',
          title: `OPTIONS ${path} hands a foreign origin an Access-Control-Allow-Origin`,
          detail:
            'The OPTIONS handlers answer 204 without checking the origin; the only thing stopping a cross-origin caller is that corsHeadersFor omits this header. With it present, any page a visitor loads can call this route from their browser, with their address and their network — no scripted client required. That is the single bypass class on this API that reaches ordinary users.',
          evidence: `OPTIONS ${ctx.apiBase}${path} with Origin: ${EVIL} => ${evil.status}, Access-Control-Allow-Origin: ${evilAcao}`,
          remediation: 'Build preflight headers with corsHeadersFor(origin, host) and never add a literal ACAO. If a dev tool looks CORS-broken, add its origin to ALLOWED_ORIGINS instead.',
          file: `app${path}/route.ts`,
          line: null,
        }));
      }
      if (evilCreds && evilCreds.toLowerCase() === 'true') {
        findings.push(finding({
          severity: 'medium',
          title: `OPTIONS ${path} allows credentials`,
          detail: 'This API sets no cookies and reads no ambient authority, so Access-Control-Allow-Credentials: true enables nothing it needs and weakens what a browser will refuse. corsHeadersFor pins it to the string "false" for allowed origins and omits it otherwise.',
          evidence: `OPTIONS ${ctx.apiBase}${path} with Origin: ${EVIL} => Access-Control-Allow-Credentials: ${evilCreds}`,
          remediation: 'Leave the value at "false" in lib/origin.ts corsHeadersFor.',
          file: 'lib/origin.ts',
          line: 86,
        }));
      }

      // --- the real origin gets its own origin back, never a wildcard ---
      const good = await preflight(path, ctx.origin);
      checked += 1;
      if (!good.ok) throw new Skip(`OPTIONS ${path} (site origin) failed: ${good.error}; partial result, not a pass`);
      const acao = good.headers.get('access-control-allow-origin');
      if (acao === '*') {
        findings.push(finding({
          severity: 'high',
          title: `OPTIONS ${path} answers with a wildcard Access-Control-Allow-Origin`,
          detail: 'A wildcard is the foreign-origin hole written a different way: every page on the internet is then allowed to call this route from a visitor\'s browser.',
          evidence: `OPTIONS ${ctx.apiBase}${path} with Origin: ${ctx.origin} => ${good.status}, Access-Control-Allow-Origin: *`,
          remediation: 'Mirror the request origin after checking it, which is what corsHeadersFor already does.',
          file: 'lib/origin.ts',
          line: 85,
        }));
      } else if (acao !== ctx.origin) {
        // Not a security finding on its own — but the tools on the static site
        // call this API cross-origin, so a missing mirror means they are broken
        // in a browser while curl keeps working.
        findings.push(finding({
          severity: 'low',
          title: `OPTIONS ${path} does not mirror the site's own origin`,
          detail: 'The static site calls this API cross-origin, so a browser preflights first and needs its own origin echoed back. Without it the tools fail in the browser while every curl-based check keeps passing — which is how this shipped once before, with the cookie scanner and /ip returning 403.',
          evidence: `OPTIONS ${ctx.apiBase}${path} with Origin: ${ctx.origin} => ${good.status}, Access-Control-Allow-Origin: ${JSON.stringify(acao)}`,
          remediation: 'Confirm ALLOWED_ORIGINS on the ib-api unit contains this origin (API-ON-DROPLET.md:115), then restart the service.',
          file: 'lib/origin.ts',
          line: 85,
        }));
      }
    }

    return { findings, checked };
  },
});
