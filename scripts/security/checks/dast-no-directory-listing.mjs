/**
 * A directory with no index page must not list its contents.
 *
 * `Options -Indexes` lives in the managed block in
 * scripts/droplet-htaccess.conf, spliced into the web root's SHARED .htaccess,
 * which no deploy rewrites and which the team's WordPress also owns. If that
 * block is lost or the directive is dropped, Apache falls back to generating
 * an index — and this build has real index-less directories: /topics/,
 * /authors/, /funnels/ and every folder under /adtest/. On the Pro site that
 * is the entire tool inventory of a product surface that is deliberately
 * noindex, handed to anyone who asks for the folder.
 *
 * The candidate list is derived from the local build rather than hardcoded, so
 * a directory that becomes index-less in a future build is covered without
 * anyone remembering to add it. out/_next is excluded: those are hashed asset
 * folders, there are hundreds, and sampling them would spend all ten probes on
 * the least interesting directory on the site.
 *
 * A 404 counts as a pass alongside 403 — the local build is routinely a
 * different build from what is live, so a directory that does not exist there
 * is not a failure. What fails is a 200 that lists files.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { pace, httpOnce } from './dast-shared.mjs';

/** Apache's generated index says both of these; no page of ours says either. */
const LISTING_MARKERS = [/<title>Index of /i, /Parent Directory<\/a>/i];

function indexLessDirs(root, limit) {
  const found = [];
  const walk = (dir, rel) => {
    if (found.length >= limit) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (found.length >= limit) return;
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      const childRel = `${rel}${e}/`;
      // Hashed asset folders: hundreds of them, all equally uninteresting.
      if (childRel.startsWith('/_next/')) continue;
      if (!existsSync(join(full, 'index.html'))) found.push(childRel);
      walk(full, childRel);
    }
  };
  walk(root, '/');
  return found;
}

export default check({
  id: 'dast-no-directory-listing',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network', 'build-output'],
  describe: 'Directories that have no index page answer 403/404 rather than an Apache-generated file listing.',

  async run(ctx) {
    const out = join(ctx.repoRoot, 'out');
    if (!existsSync(out)) throw new Skip('no out/ build to derive index-less directories from — run npm run build first');

    const dirs = indexLessDirs(out, 8);
    if (!dirs.length) throw new Skip('out/ has no index-less directories outside _next — nothing to probe, and a hardcoded list would be guessing');

    const findings = [];
    let checked = 0;

    for (const d of dirs) {
      for (const root of ['/resources', '/resources-pro']) {
        await pace();
        checked++;
        const url = `${ctx.origin}${root}${d}`;
        const res = await httpOnce(ctx, url, { redirect: 'manual' });
        if (!res.ok) {
          findings.push(finding({
            severity: 'low',
            title: `Could not reach ${root}${d}`,
            detail: 'An unreachable probe is not a pass.',
            evidence: `GET ${url} → ${res.error}`,
            remediation: 'Re-run when the droplet is reachable.',
          }));
          continue;
        }
        const listing = LISTING_MARKERS.find((re) => re.test(res.text));
        if (listing) {
          findings.push(finding({
            severity: 'medium',
            title: `${root}${d} returns an Apache directory listing`,
            detail: 'Options -Indexes is not in force. Every file in this directory is enumerable by anyone who asks for the folder, including on the Pro site, which is a noindex product surface.',
            evidence: `GET ${url} → ${res.status}, body matches ${listing} :: ${res.text.replace(/\s+/g, ' ').slice(0, 200)}`,
            remediation: 'Re-run scripts/droplet-server-config.sh to restore the managed block (it carries Options -Indexes), then apache2ctl configtest && systemctl reload apache2.',
            file: 'scripts/droplet-htaccess.conf',
          }));
          continue;
        }
        if (res.status === 200) {
          findings.push(finding({
            severity: 'low',
            title: `${root}${d} answers 200 although the build has no index.html for it`,
            detail: 'Not a listing, but not the expected 403/404 either — something is serving content at a path the build does not have a page for.',
            evidence: `GET ${url} → 200, ${res.text.length} bytes, content-type ${res.headers.get('content-type') || '(none)'}`,
            remediation: 'Find out what is answering there.',
          }));
        }
      }
    }

    return { findings, checked };
  },
});
