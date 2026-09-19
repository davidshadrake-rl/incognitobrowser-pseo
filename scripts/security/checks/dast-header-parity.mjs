/**
 * The live security headers must equal, byte for byte, what the repo declares.
 *
 * Why this check and not "are the headers present": scripts/security-smoke.mjs
 * already asserts presence, and its CSP assertion is
 * `/default-src|script-src/.test(...)`. A CSP that allowed an
 * attacker-claimable third-party origin in connect-src satisfies that
 * expression perfectly, which is how the live policy went on naming two dead
 * hosting-platform domains for three weeks. Presence is not a policy.
 *
 * Why it can fail even when git is right: NOTHING re-applies
 * scripts/droplet-htaccess.conf on a deploy. `npm run deploy` ships the two
 * site folders and leaves the web root's shared .htaccess alone, because that
 * file is also the team's WordPress .htaccess. Only
 * scripts/droplet-server-config.sh writes it, and no npm script runs it. So
 * the live header set has no *enforced* relationship to the repo — deploy.sh
 * compares the block over ssh and refuses to deploy on a mismatch, which is
 * good, but it only runs when somebody deploys, it needs an ssh key, and it
 * compares the FILE rather than what Apache actually sends. This check asks
 * the only question that matters to a visitor: what came back over the wire.
 * A WordPress plugin rewriting the shared .htaccess, or mod_headers being
 * disabled, strips every header from ~1,400 pages and nothing else notices.
 *
 * Two independent declarations are graded against their own sources: the
 * static pages against the .conf (a static export runs no Next.js server, so
 * next.config.ts headers() never execute for them) and /api/ against
 * next.config.ts (the API is the server build). They have drifted before.
 *
 * Deliberately NOT graded here:
 *  - `Header set Cache-Control` in the mod_expires block. It is a caching
 *    directive that interacts with the per-site scripts/site.htaccess, and
 *    grading it would make a performance change look like a security failure.
 *  - /challenge's missing Cache-Control. Every other visitor-specific route
 *    sends `no-store, private`; /challenge sends nothing. It is not
 *    exploitable — POST responses are not cached by default, there is no CDN
 *    and no proxy cache — so it is recorded here as a known, accepted
 *    exclusion rather than a nightly finding. If a caching layer is ever put
 *    in front of this box, that exclusion stops being true.
 *
 * The parsers refuse to return a thin result: fewer than seven baseline
 * headers or fewer than seven API headers means the parser broke, and the
 * check Skips loudly instead of passing while grading nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { parseManagedHtaccess, parseNextSecurityHeaders, expectedStaticHeaders, h, pace, httpOnce } from './dast-shared.mjs';

/** CSP directives that name where content may be fetched from. */
const FETCH_DIRECTIVES = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src', 'media-src', 'worker-src', 'child-src'];
/** Everything that is not a host: keywords, schemes, hashes and nonces. */
const NON_HOST = /^('.*'|data:|blob:|https:|http:|mediastream:|filesystem:|\*)$/;

export default check({
  id: 'dast-header-parity',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Every security header the repo declares is served live, with the exact declared value, on pages, tool pages, the Pro site, a hashed asset and the API.',

  async run(ctx) {
    const conf = readFileSync(join(ctx.repoRoot, 'scripts', 'droplet-htaccess.conf'), 'utf-8');
    const nextConfig = readFileSync(join(ctx.repoRoot, 'next.config.ts'), 'utf-8');
    const parsed = parseManagedHtaccess(conf);
    const apiExpected = parseNextSecurityHeaders(nextConfig);

    if (parsed.base.size < 7) {
      throw new Skip(`parsed only ${parsed.base.size} "Header always set" directives out of scripts/droplet-htaccess.conf — the parser is broken, and a thin expectation would pass vacuously`);
    }
    if (apiExpected.size < 7) {
      throw new Skip(`parsed only ${apiExpected.size} entries out of next.config.ts SECURITY_HEADERS — the parser is broken`);
    }

    const findings = [];
    let checked = 0;

    // A hashed asset URL, read off a real page rather than off the local out/.
    // The local build is routinely a different build id from what is live, so
    // a path taken from disk 404s and proves nothing about /_next/static/.
    const toolsUri = '/resources/tools/';
    const toolsRes = await httpOnce(ctx, ctx.origin + toolsUri, { redirect: 'follow' });
    let assetUri = null;
    if (toolsRes.ok) {
      const m = /"(\/resources\/_next\/static\/[^"]+\.(?:js|css))"/.exec(toolsRes.text)
        || /(\/resources\/_next\/static\/[^"'\s>]+\.(?:js|css))/.exec(toolsRes.text);
      if (m) assetUri = m[1];
    }

    const probes = [
      { uri: '/resources/', label: 'free page' },
      { uri: toolsUri, label: 'free tool page (Permissions-Policy override)' },
      { uri: '/resources-pro/tools/', label: 'Pro tool page (noindex + Permissions-Policy overrides)' },
      ...(assetUri ? [{ uri: assetUri, label: 'hashed asset under /_next/static/' }] : []),
    ];

    for (const p of probes) {
      await pace();
      const res = p.uri === toolsUri && toolsRes.ok ? toolsRes : await httpOnce(ctx, ctx.origin + p.uri, { redirect: 'follow' });
      if (!res.ok) {
        findings.push(finding({
          severity: 'medium',
          title: `Could not reach ${p.uri} to grade its headers`,
          detail: 'A probe that cannot reach its target proves nothing about the headers. Reported rather than silently skipped.',
          evidence: `GET ${ctx.origin}${p.uri} → ${res.error}`,
          remediation: 'Confirm the droplet is up and serving, then re-run.',
        }));
        continue;
      }
      const expected = expectedStaticHeaders(p.uri, parsed);
      for (const [name, want] of expected) {
        checked++;
        const got = h(res, name);
        if (got === want) continue;
        findings.push(finding({
          severity: name === 'Content-Security-Policy' || name === 'Strict-Transport-Security' ? 'high' : 'medium',
          title: `${name} on ${p.uri} does not match scripts/droplet-htaccess.conf`,
          detail: `The static sites' only header definition is the managed block in scripts/droplet-htaccess.conf, and nothing on a deploy re-applies it. A difference here means the live block and the repo have parted company — either an edit that never reached the box, or the shared /var/www/html/.htaccess being rewritten underneath us.`,
          evidence: `GET ${ctx.origin}${p.uri} (${res.status})\n  declared: ${want}\n  served:   ${got || '(header absent)'}`,
          remediation: 'Re-run scripts/droplet-server-config.sh on the droplet (it splices the managed block into the shared web-root .htaccess), then apache2ctl configtest && systemctl reload apache2.',
          file: 'scripts/droplet-htaccess.conf',
        }));
      }
      checked += 2;
      if (h(res, 'x-powered-by')) {
        findings.push(finding({
          severity: 'low',
          title: `X-Powered-By is being advertised on ${p.uri}`,
          detail: 'It was verified absent when this check was written; this is the regression guard, not a standing finding.',
          evidence: `GET ${ctx.origin}${p.uri} → X-Powered-By: ${h(res, 'x-powered-by')}`,
          remediation: 'Set poweredByHeader: false in next.config.ts, or unset the header in Apache.',
        }));
      }
      if (h(res, 'set-cookie')) {
        findings.push(finding({
          severity: 'medium',
          title: `${p.uri} set a cookie`,
          detail: 'This is a privacy product and it sets no cookies anywhere — that claim is made in the editorial copy. The first cookie to appear is a claim breaking, and it would arrive with no flags because nothing configures any.',
          evidence: `GET ${ctx.origin}${p.uri} → Set-Cookie: ${h(res, 'set-cookie')}`,
          remediation: 'Find what introduced it. If a cookie is genuinely needed, it needs Secure, HttpOnly and SameSite, and the no-cookies copy needs revisiting.',
        }));
      }
    }

    if (!assetUri) {
      findings.push(finding({
        severity: 'low',
        title: 'No hashed /_next/static/ asset URL could be found on the live tool page',
        detail: 'The asset probe grades whether the <FilesMatch> extension list covers .js and .css, which is how a header set can be complete on HTML and absent on the bundle. Without a URL it did not run.',
        evidence: `GET ${ctx.origin}${toolsUri} → ${toolsRes.status}, no /resources/_next/static/*.js|css reference in ${toolsRes.text.length} bytes of HTML`,
        remediation: 'Check that the live page is the real build and not an error page.',
      }));
    }

    // The API is the server build, so next.config.ts headers() DO run for it.
    // POST because /ip answers 405 to GET; Origin because the gate needs one.
    await pace();
    const api = await httpOnce(ctx, `${ctx.apiBase}/ip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.origin },
      body: '{}',
    });
    if (!api.ok) {
      findings.push(finding({
        severity: 'medium',
        title: 'Could not reach POST /api/ip to grade the API header set',
        detail: 'Half this check grades a source (next.config.ts) that only applies to the API. Unreachable means ungraded.',
        evidence: `POST ${ctx.apiBase}/ip → ${api.error}`,
        remediation: 'Check systemctl status ib-api and the Apache proxy block.',
      }));
    } else {
      for (const [name, want] of apiExpected) {
        checked++;
        const got = h(api, name);
        if (got === want) continue;
        findings.push(finding({
          severity: name === 'Content-Security-Policy' || name === 'Strict-Transport-Security' ? 'high' : 'medium',
          title: `${name} on POST /api/ip does not match next.config.ts SECURITY_HEADERS`,
          detail: 'The API carries the Next server headers, not the .htaccess FilesMatch ones. It is an independent declaration of the same policy and drifts independently.',
          evidence: `POST ${ctx.apiBase}/ip (${api.status})\n  declared: ${want}\n  served:   ${got || '(header absent)'}`,
          remediation: 'Rebuild and redeploy the API (scripts/deploy-api.sh), or reconcile next.config.ts with what is deployed.',
          file: 'next.config.ts',
        }));
      }
      checked++;
      if (h(api, 'set-cookie')) {
        findings.push(finding({
          severity: 'medium',
          title: 'The API set a cookie',
          detail: 'corsHeadersFor() sets six fixed headers and no cookie. Anything setting one came from somewhere else.',
          evidence: `POST ${ctx.apiBase}/ip → Set-Cookie: ${h(api, 'set-cookie')}`,
          remediation: 'Trace what added it; this API has no session and needs none.',
        }));
      }
    }

    // Zero extra requests: the declared policy itself must not name a host in
    // any fetch directive. A hostname in connect-src is the thing that became
    // attacker-claimable when the old hosting account was closed; a keyword or
    // a scheme cannot be registered by anyone.
    for (const [source, csp] of [['scripts/droplet-htaccess.conf', parsed.base.get('Content-Security-Policy')], ['next.config.ts', apiExpected.get('Content-Security-Policy')]]) {
      if (!csp) continue;
      for (const directive of csp.split(';').map((d) => d.trim()).filter(Boolean)) {
        const [name, ...sources] = directive.split(/\s+/);
        if (!FETCH_DIRECTIVES.includes(name)) continue;
        checked++;
        const hosts = sources.filter((s) => !NON_HOST.test(s));
        if (!hosts.length) continue;
        findings.push(finding({
          severity: 'high',
          title: `CSP ${name} names a host source in ${source}`,
          detail: 'Every fetch directive in this policy is keywords and schemes only. A hostname here is a permitted destination for any future injection — and if the domain is ever given up, it is a destination anyone can register.',
          evidence: `${source}: ${name} ${sources.join(' ')}  (host sources: ${hosts.join(', ')})`,
          remediation: "Drop the host and keep the directive to 'self', or justify it in the file.",
          file: source,
        }));
      }
    }

    return { findings, checked };
  },
});
