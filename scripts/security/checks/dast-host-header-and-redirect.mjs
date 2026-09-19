/**
 * A forged Host cannot steer the http→https redirect, and the redirect exists.
 *
 * scripts/droplet-htaccess.conf sends plain http for our two folders to
 * `https://__HTTPS_HOST__%{REQUEST_URI}`, with the hostname substituted at
 * config time by scripts/droplet-server-config.sh (and identically by
 * deploy.sh when it compares the live block). The obvious-looking cleanup —
 * replacing that placeholder with `%{HTTP_HOST}`, which is what almost every
 * http→https snippet on the internet uses — turns this into an open redirect
 * served from the same origin as the team's production WordPress. That is a
 * phishing primitive under a hostname people have been told to trust, and
 * nothing else in this repo would notice. The placeholder is not a quirk to be
 * tidied away, and this is the check that says so.
 *
 * The second thing it asserts is that the redirect exists at all. If the
 * managed block is lost, both sites answer over plain http with no HSTS, and
 * the insecure-context tools (clipboard, Web Crypto) break. That is a
 * different failure from Host spoofing and the same request answers both.
 *
 * Raw sockets, not fetch: Host is a forbidden header name, so undici will not
 * let a request carry a Host that differs from the URL. A fetch-based version
 * of this check would send the real Host every night and pass forever.
 *
 * KNOWN AND ACCEPTED, recorded as info rather than a failure: isOriginAllowed
 * (lib/origin.ts) treats Origin-equals-Host as same-origin, so a scripted
 * client that sends a matching forged pair gets through the origin gate. That
 * is a scripted-client path only — a browser sets Origin itself — and it
 * grants nothing curl does not already have by naming a real allowed Origin
 * directly. It is written down here so nobody rediscovers it as a surprise.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { rawRequest, pace } from './dast-shared.mjs';

const EVIL = 'evil.example';

export default check({
  id: 'dast-host-header-and-redirect',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Plain http redirects to the configured https host, and a forged Host / X-Forwarded-Host cannot redirect a visitor somewhere else.',

  async run(ctx) {
    const url = new URL(ctx.origin);
    if (url.protocol !== 'https:') throw new Skip(`target ${ctx.origin} is not https, so there is no http→https redirect to grade`);
    const realHost = url.host;

    const findings = [];
    let checked = 0;

    const probe = async (path, headers) => {
      await pace();
      return rawRequest({
        host: url.hostname, port: 80, useTls: false,
        method: 'GET', path,
        headers: { 'User-Agent': 'security-suite/dast-host-header-and-redirect', ...headers },
      });
    };

    const cases = [
      { path: '/resources/tools/', headers: { Host: realHost }, label: 'plain http, honest Host', expectRedirect: true },
      { path: '/resources/tools/', headers: { Host: EVIL }, label: `plain http, Host: ${EVIL}` },
      { path: '/resources/tools/', headers: { Host: realHost, 'X-Forwarded-Host': EVIL, 'X-Forwarded-Proto': 'http' }, label: `plain http, X-Forwarded-Host: ${EVIL}` },
      { path: '/resources-pro/tools/', headers: { Host: realHost }, label: 'Pro, plain http, honest Host', expectRedirect: true },
      { path: '/resources-pro/tools/', headers: { Host: EVIL }, label: `Pro, plain http, Host: ${EVIL}` },
      { path: '/resources/', headers: { Host: `${EVIL}:80` }, label: `plain http, Host with a port: ${EVIL}:80` },
    ];

    for (const c of cases) {
      const res = await probe(c.path, c.headers);
      if (!res.ok) {
        findings.push(finding({
          severity: 'low',
          title: `Could not complete the ${c.label} probe`,
          detail: 'An unreachable probe is not a pass.',
          evidence: `GET http://${url.hostname}${c.path} (${JSON.stringify(c.headers)}) → ${res.error}`,
          remediation: 'Re-run when port 80 on the droplet is reachable.',
        }));
        continue;
      }
      checked++;
      const location = res.headers.location || '';
      const isRedirect = res.status >= 300 && res.status < 400;

      if (!isRedirect) {
        findings.push(finding({
          severity: c.expectRedirect ? 'high' : 'low',
          title: c.expectRedirect
            ? `Plain http ${c.path} is served directly instead of redirecting to https`
            : `Plain http ${c.path} with a forged Host answered ${res.status} rather than redirecting`,
          detail: c.expectRedirect
            ? 'The RewriteCond block in scripts/droplet-htaccess.conf is not in force. Both sites are reachable over plain http with no HSTS applied, and the insecure-context tools (clipboard, Web Crypto) break for anyone who arrives that way.'
            : 'Not a redirect, so not an open-redirect risk — but not the documented behaviour either.',
          evidence: `GET http://${url.hostname}${c.path} with ${JSON.stringify(c.headers)} → ${res.status} ${location ? `Location: ${location}` : '(no Location)'}`,
          remediation: 'Re-run scripts/droplet-server-config.sh to restore the managed block, then apache2ctl configtest && systemctl reload apache2.',
          file: 'scripts/droplet-htaccess.conf',
        }));
        continue;
      }

      let dest;
      try { dest = new URL(location, `http://${realHost}`); } catch { dest = null; }
      if (!dest || dest.host !== realHost || dest.protocol !== 'https:') {
        findings.push(finding({
          severity: 'high',
          title: `A ${c.label} request was redirected to ${dest ? dest.origin : location}`,
          detail: 'The redirect target is built from something the caller controls. This is an open redirect on the same hostname as the team\'s production WordPress: a link that looks like our domain, sends the visitor anywhere, and keeps the padlock. It is the failure mode of replacing the hardcoded __HTTPS_HOST__ placeholder with %{HTTP_HOST}.',
          evidence: `GET http://${url.hostname}${c.path} with ${JSON.stringify(c.headers)} → ${res.status} Location: ${location}  (expected https://${realHost}${c.path})`,
          remediation: 'Restore the hardcoded __HTTPS_HOST__ substitution in the RewriteRule in scripts/droplet-htaccess.conf. Never use %{HTTP_HOST} in a redirect target here.',
          file: 'scripts/droplet-htaccess.conf',
          line: 21,
        }));
      }

      // The LINK in Apache's redirect body, not the body as a whole.
      //
      // Apache's ServerSignature footer ends every generated error page with
      // "Server at <Host> Port 80", so a forged Host always appears somewhere
      // in the body. Flagging that would make this check fire on every run for
      // stock Apache behaviour that steers nothing — a browser follows a 301
      // and never renders the page — and a check that cries wolf nightly is a
      // check somebody turns off. What matters is where the link points.
      checked++;
      const href = /<a href="([^"]+)"/.exec(res.body || '');
      if (href) {
        let linked;
        try { linked = new URL(href[1], `http://${realHost}`); } catch { linked = null; }
        if (!linked || linked.host !== realHost) {
          findings.push(finding({
            severity: 'high',
            title: `The redirect body for ${c.label} links to ${linked ? linked.origin : href[1]}`,
            detail: 'The link Apache generates follows the redirect target. A foreign host here means the target itself is caller-controlled.',
            evidence: `GET http://${url.hostname}${c.path} with ${JSON.stringify(c.headers)} → ${res.status}, body link: ${href[1]}`,
            remediation: 'Restore the hardcoded __HTTPS_HOST__ substitution in scripts/droplet-htaccess.conf.',
            file: 'scripts/droplet-htaccess.conf',
          }));
        }
      }
    }

    findings.push(finding({
      severity: 'info',
      title: 'Known and accepted: a scripted client can satisfy the origin gate with a matching forged Host and Origin',
      detail: 'isOriginAllowed() returns true when the Origin\'s host equals the request\'s Host header, which is what lets the deployed site call its own API without anyone remembering to add its hostname to ALLOWED_ORIGINS. A non-browser client can send both. It grants nothing curl does not already have by naming an allowed Origin directly, and no browser can be made to do it. Recorded so it is a known property rather than a discovery.',
      evidence: 'lib/origin.ts, isOriginAllowed(): `if (new URL(origin).host === requestHost) return true;`',
      remediation: 'No action. If the API ever gains an action worth protecting from scripted callers, the proof-of-work and rate limits are the layers that do it — not the Origin header, which any non-browser client sets freely.',
      file: 'lib/origin.ts',
      line: 62,
    }));

    return { findings, checked };
  },
});
