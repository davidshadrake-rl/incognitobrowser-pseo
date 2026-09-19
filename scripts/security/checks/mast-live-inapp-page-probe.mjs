/**
 * The boot script the droplet is serving RIGHT NOW behaves the way the
 * contract says it does — on both sites.
 *
 * Same subject as mast-boot-script-shipped-intact, different place to look,
 * and the difference is the whole point. The free and Pro sites are two
 * separate static exports rsynced into two Apache directories by two passes of
 * scripts/deploy.sh's site(). They drift: a partial rsync, a deploy that ran
 * for /resources and failed before /resources-pro, an Apache rule serving a
 * cached copy, or simply a source fix that has not been deployed yet. A local
 * artifact check cannot see any of that, and out/ is deleted before every
 * build, so on most days there is no artifact to check at all.
 *
 * The Pro site is where the three gated tools live, so a stale Pro deploy is
 * exactly the case that matters — which is why this fetches a real Pro TOOL
 * page rather than the listing, discovering it from the listing's own hrefs
 * instead of pinning a path that will rot.
 *
 * PRODUCTION SAFETY: three plain GETs of static HTML from Apache, nightly. No
 * /api/ call, no proof-of-work, no scan, nothing that can touch the 10
 * scans/min bucket, the 30 challenges/min bucket, the 20 in-flight scan cap,
 * or the WordPress and MySQL sharing the same 2 vCPU. Unreachable is a SKIP,
 * loudly: a nightly page for one transient network blip is how a suite gets
 * muted, and the thing this grades does not change hour to hour.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { extractBootScript, gradeBootBehaviour } from './mast-shared.mjs';

export default check({
  id: 'mast-live-inapp-page-probe',
  discipline: 'mast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The live free site and a live Pro tool page serve an in-app boot script that runs, strips the app\'s flags from the address bar, and refuses a bare ?pro=1.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const home = `${ctx.freeBase}/`;
    const listing = `${ctx.proBase}/tools/`;

    const first = await ctx.http(home, { timeoutMs: 20_000 });
    if (!first.ok) throw new Skip(`${home} unreachable (${first.error}) — the live box is not answering, which this check cannot tell apart from a network blip here`);
    if (first.status !== 200) throw new Skip(`${home} returned ${first.status} — nothing to grade; dast-exposed-files and the smoke test own live availability`);

    const proList = await ctx.http(listing, { timeoutMs: 20_000 });

    // Find a real Pro tool page from the listing's own links, so this does not
    // rot into a pinned path that 404s the next time a tool moves.
    let toolUrl = null;
    if (proList.ok && proList.status === 200) {
      const hrefs = [...proList.text.matchAll(/href="([^"]*\/resources-pro\/tools\/[a-z0-9-]+\/[a-z0-9-]+\/)"/g)].map((m) => m[1]);
      if (hrefs.length) toolUrl = new URL(hrefs[0], ctx.origin).href;
    }

    const targets = [{ url: home, res: first }, { url: listing, res: proList }];
    if (toolUrl) targets.push({ url: toolUrl, res: await ctx.http(toolUrl, { timeoutMs: 20_000 }) });

    for (const { url, res } of targets) {
      checked++;
      if (!res.ok || res.status !== 200) {
        findings.push(finding({
          severity: 'low',
          title: `A live in-app surface did not answer: ${url}`,
          detail: 'Not a vulnerability on its own, but this check cannot grade a page it cannot fetch, and reporting nothing about it would be the silence this suite exists to prevent.',
          evidence: `GET ${url} -> ${res.ok ? `HTTP ${res.status}` : res.error}`,
          remediation: 'Check the Apache alias and the last rsync for that site.',
        }));
        continue;
      }
      const src = extractBootScript(res.text);
      if (!src) {
        findings.push(finding({
          severity: 'medium',
          title: `The live page ${url} ships no in-app boot script`,
          detail: 'Inside the app that page shows "Get the Android app" to someone already using it, the scorecard falls back to a blob: download the app\'s download manager rejects, and the app\'s flags stay in the address bar for anyone who copies the link.',
          evidence: `GET ${url} -> HTTP 200, ${res.text.length} bytes, no inline <script> that both mentions data-inapp and calls history.replaceState`,
          remediation: 'Redeploy that site (scripts/deploy.sh) — the two builds are rsynced separately and one can be left behind.',
        }));
        continue;
      }
      const graded = gradeBootBehaviour(src, `GET ${url}`);
      findings.push(...graded.findings);
      checked += graded.checked;
    }

    if (!toolUrl) {
      // The listing exists but named no tool page, so the surface that carries
      // the three gates went ungraded. Say so rather than counting the two
      // pages we did read as full coverage.
      findings.push(finding({
        severity: 'info',
        title: 'No live Pro tool page could be discovered to grade',
        detail: 'The gated tools live on the tool pages, not on the listing. If the listing stops linking them, this check silently covers less than it claims to.',
        evidence: `GET ${listing} -> ${proList.ok ? `HTTP ${proList.status}, ${proList.text.length} bytes` : proList.error}; no href matching /resources-pro/tools/<niche>/<slug>/ found`,
        remediation: 'Check the Pro site\'s tool listing rendered; if the URL shape changed, update the pattern in this check.',
      }));
    }

    return { findings, checked };
  },
});
