/**
 * Our header block must not bleed onto the team's WordPress.
 *
 * The managed block lives in /var/www/html/.htaccess, which is the SHARED web
 * root — the same file the team's production WordPress is served from, on the
 * same Apache, under the same uid. Everything in it is scoped, by FilesMatch
 * and by <If "%{REQUEST_URI} =~ …">, to our two folders. A scoping mistake in
 * a future edit applies our rules to their PHP responses, and two of them are
 * genuinely damaging:
 *
 *  - `X-Robots-Tag: noindex, follow`, scoped to /resources-pro/ today, would
 *    deindex the team's site. That is discovered in Search Console, weeks
 *    later, by someone who has no reason to connect it to a security change.
 *  - `ErrorDocument 404 /resources/404.html` is ALREADY root-scoped, so the
 *    team's 404s could start rendering our 404 page. Today they do not
 *    (WordPress's own rewrite claims those requests first), which is luck of
 *    ordering rather than design — worth watching.
 *
 * Deliberately NOT asserted: that the WordPress pages return 200. That would
 * turn the team's own maintenance window into our nightly red, over something
 * we neither own nor can fix. The load-bearing assertions are the noindex and
 * the CSP bleed, and both are meaningful on any status.
 *
 * Read-only GETs on the site's public front door. No login path, no
 * /wp-admin/, no POST — we are guests in this web root.
 */
import { check, finding } from '../lib/harness.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseManagedHtaccess, pace, httpOnce } from './dast-shared.mjs';

/** A marker that only OUR 404 page carries. */
const OUR_404 = '404: This page could not be found.';

export default check({
  id: 'dast-wordpress-untouched',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The co-tenant WordPress at the shared web root is not receiving our noindex header, our CSP, or our 404 page.',

  async run(ctx) {
    const conf = readFileSync(join(ctx.repoRoot, 'scripts', 'droplet-htaccess.conf'), 'utf-8');
    const parsed = parseManagedHtaccess(conf);
    const ourCsp = parsed.base.get('Content-Security-Policy') || null;

    const findings = [];
    let checked = 0;

    // A path that cannot exist, so the 404 handler is what answers. Random so
    // a cached earlier answer cannot stand in for a real one.
    const missing = `/zz-security-suite-probe-${Date.now().toString(36)}/`;
    const targets = [
      { path: '/', label: 'the WordPress front page' },
      { path: '/index.php/', label: 'the WordPress permalink entry point' },
      { path: missing, label: 'a path that does not exist at the web root' },
    ];

    for (const t of targets) {
      await pace();
      const res = await httpOnce(ctx, ctx.origin + t.path, { redirect: 'manual' });
      if (!res.ok) {
        findings.push(finding({
          severity: 'low',
          title: `Could not reach ${t.path}`,
          detail: 'An unreachable probe is not a pass. Note this check deliberately does not require a 200 — the team may be doing their own maintenance.',
          evidence: `GET ${ctx.origin}${t.path} → ${res.error}`,
          remediation: 'Re-run when the box is reachable.',
        }));
        continue;
      }

      checked++;
      const robots = res.headers.get('x-robots-tag') || '';
      if (/noindex/i.test(robots)) {
        findings.push(finding({
          severity: 'high',
          title: `${t.label} is being served X-Robots-Tag: noindex`,
          detail: 'That header is ours and is scoped to /resources-pro/ — a product surface that is deliberately not an SEO surface. Applied to the team\'s site it deindexes their production pages, and it is discovered in Search Console weeks later by someone with no reason to connect it to a config change here.',
          evidence: `GET ${ctx.origin}${t.path} → ${res.status}, X-Robots-Tag: ${robots}`,
          remediation: 'Check the <If "%{REQUEST_URI} =~ m#^/resources-pro/#"> scoping in scripts/droplet-htaccess.conf, and that the managed block has not been moved or unscoped in /var/www/html/.htaccess.',
          file: 'scripts/droplet-htaccess.conf',
        }));
      }

      checked++;
      const csp = res.headers.get('content-security-policy') || '';
      if (ourCsp && csp === ourCsp) {
        findings.push(finding({
          severity: 'medium',
          title: `${t.label} is being served OUR Content-Security-Policy`,
          detail: 'Our policy is written for a static export of our own pages: `default-src \'self\'`, `frame-ancestors \'none\'`, no third-party script hosts. WordPress sites routinely load plugins, embeds and analytics from elsewhere; applying this policy to theirs breaks those silently in the browser, with no server-side symptom at all. Asserted as "not byte-identical to ours" rather than "absent", so the team setting their own policy one day is not our finding.',
          evidence: `GET ${ctx.origin}${t.path} → ${res.status}, Content-Security-Policy identical to the one in scripts/droplet-htaccess.conf:\n  ${csp}`,
          remediation: 'Our CSP belongs inside the <FilesMatch> block, which cannot match a PHP response. Check that the managed block in /var/www/html/.htaccess still has that scoping.',
          file: 'scripts/droplet-htaccess.conf',
        }));
      }

      if (t.path === missing) {
        checked++;
        if (res.text.includes(OUR_404)) {
          findings.push(finding({
            severity: 'medium',
            title: 'A missing path at the shared web root renders OUR 404 page',
            detail: '`ErrorDocument 404 /resources/404.html` in the managed block is root-scoped, so it can answer for the whole web root. Today WordPress\'s own rewrite claims those requests first — that is ordering, not scoping. If it stops, the team\'s visitors get our branding on their 404s.',
            evidence: `GET ${ctx.origin}${t.path} → ${res.status}, body contains "${OUR_404}" (${res.text.length} bytes)`,
            remediation: 'Scope the ErrorDocument to our folders, or accept it explicitly and note it in scripts/droplet-htaccess.conf.',
            file: 'scripts/droplet-htaccess.conf',
          }));
        }
      }
    }

    return { findings, checked };
  },
});
