/**
 * What is actually on the box, and is it the thing the guards graded.
 *
 * This repo has roughly 3,000 source-level assertions about what the pages may
 * say — no-vpn-claims.test.ts alone is 1,507 lines, and it is good. Every one
 * of them grades the working tree. None of them has ever looked at the
 * droplet. If the deployed export is an older commit, those guards are
 * describing content no visitor is reading, and they will go on passing while
 * they do it. That is the same shape as the two failures this whole suite was
 * written after: a test grading a copy of the function instead of the
 * function, and a headers guard that never opened the file that sets the
 * headers.
 *
 * Both checks here are two or three plain GETs of static files through Apache.
 * Nothing touches /api/, so the rate limiter, the in-flight scan cap and the
 * WordPress and MySQL sharing those 2 vCPU never notice.
 */
import { execFileSync } from 'node:child_process';
import { check, finding, Skip } from '../lib/harness.mjs';

const DAY = 24 * 60 * 60 * 1000;

/**
 * git, run in the repo, returning trimmed stdout — or null when it fails.
 * stderr is discarded on purpose: a failing rev-parse is an ANSWER here ("that
 * commit is not in this history"), and letting git's "fatal:" land in the
 * suite's output makes a working check look like a broken one.
 */
function git(repoRoot, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot, encoding: 'utf-8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** scripts/deploy.sh writes "<short-sha>[+uncommitted] built <iso>" to version.txt. */
function parseVersion(text) {
  const m = /^([0-9a-f]{7,40})(\+uncommitted)?\s+built\s+(\S+)/.exec(String(text || '').trim());
  if (!m) return null;
  return { sha: m[1], uncommitted: Boolean(m[2]), builtAt: m[3] };
}

const provenance = check({
  id: 'cmp-live-build-provenance',
  discipline: 'compliance',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network', 'git'],
  describe: 'The export on the droplet is a known, committed, on-main build — so the source-level content guards are describing the pages people actually read.',
  async run(ctx) {
    const head = git(ctx.repoRoot, ['rev-parse', 'HEAD']);
    if (!head) throw new Skip('git is not usable in this checkout — this check compares the live build against the history');
    // origin/main is the reference, not HEAD: a laptop mid-branch is not the
    // question. Whether the box is running something that reached main is.
    const mainRef = git(ctx.repoRoot, ['rev-parse', '--verify', 'origin/main']) ? 'origin/main'
      : git(ctx.repoRoot, ['rev-parse', '--verify', 'main']) ? 'main' : null;
    if (!mainRef) throw new Skip('neither origin/main nor main resolves — nothing to compare the live build against');

    const findings = [];
    const tiers = [['free', `${ctx.freeBase}/version.txt`], ['pro', `${ctx.proBase}/version.txt`]];
    const seen = [];
    let checked = 0;

    for (const [tier, url] of tiers) {
      const res = await ctx.http(url, { timeoutMs: 20_000 });
      checked += 1;
      if (!res.ok || res.status !== 200) {
        findings.push(finding({
          severity: 'medium',
          title: `No version marker served for the ${tier} tier`,
          detail: 'scripts/deploy.sh writes version.txt into each site on every deploy. Without it there is no way to say which commit is live, which means no content guard in this repo can claim anything about the pages being served.',
          evidence: `GET ${url} -> ${res.ok ? `HTTP ${res.status}` : `no response (${res.error})`}`,
          remediation: 'Re-run ./scripts/deploy.sh, or check that the rsync reached the right folder.',
        }));
        continue;
      }
      const v = parseVersion(res.text);
      if (!v) {
        findings.push(finding({
          severity: 'medium',
          title: `Unreadable version marker on the ${tier} tier`,
          detail: 'version.txt is not in the "<sha> built <iso>" form deploy.sh writes, so the live commit cannot be identified.',
          evidence: `GET ${url} -> 200, body: ${JSON.stringify(String(res.text).slice(0, 120))}`,
          remediation: 'Deploy again with ./scripts/deploy.sh rather than copying files by hand.',
        }));
        continue;
      }

      if (v.uncommitted) {
        findings.push(finding({
          severity: 'medium',
          title: `The ${tier} tier was built from a dirty tree`,
          detail: `The "+uncommitted" marker means the export was built from working-tree changes that are in nobody's history. What is live cannot be reproduced, reviewed or rolled back to, and no guard in this repo has graded it.`,
          evidence: `GET ${url} -> "${String(res.text).trim()}"`,
          remediation: 'Commit the change, push it, and deploy from a clean tree.',
        }));
      }
      const resolves = git(ctx.repoRoot, ['rev-parse', '--verify', `${v.sha}^{commit}`]);
      if (!resolves) {
        findings.push(finding({
          severity: 'medium',
          title: `The ${tier} tier is running a commit this repo has never seen: ${v.sha}`,
          detail: 'The live build names a commit that does not exist here. Either it was built somewhere else from a different history, or the commit was rewritten or dropped. Nothing in this repo describes what is being served.',
          evidence: `live version.txt: "${String(res.text).trim()}"\n\`git rev-parse ${v.sha}\` in ${ctx.repoRoot}: not found`,
          remediation: 'Fetch all remotes; if it still does not resolve, redeploy from a commit on main.',
        }));
        continue;
      }
      // Only a commit this repo can actually resolve goes into the staleness
      // arithmetic below; counting from an unknown sha prints a confident
      // "0 commits behind" that means nothing.
      seen.push([tier, v, url]);
      const onMain = git(ctx.repoRoot, ['merge-base', '--is-ancestor', v.sha, mainRef]) !== null;
      if (!onMain) {
        findings.push(finding({
          severity: 'medium',
          title: `The ${tier} tier is running a commit that is not on ${mainRef}: ${v.sha}`,
          detail: `The live build came from a branch or a detached commit that never reached ${mainRef}. Review, CI and every content guard run against main; a build off main has had none of them applied to it in any binding way.`,
          evidence: `live sha ${v.sha}; \`git merge-base --is-ancestor ${v.sha} ${mainRef}\` is false`,
          remediation: 'Merge the work to main and deploy from there.',
        }));
      }
    }

    // The two tiers are built in one run from one $VERSION (deploy.sh), so a
    // disagreement means a deploy died between the two rsyncs and half the
    // site is a different build. Rare, but silent when it happens.
    if (seen.length === 2 && seen[0][1].sha !== seen[1][1].sha) {
      findings.push(finding({
        severity: 'medium',
        title: 'The free and Pro tiers are serving different builds',
        detail: 'scripts/deploy.sh computes the version once and writes it into both sites in the same run, so these can only differ if a deploy failed partway. Half the site is then a build nobody intended to ship.',
        evidence: `free: ${seen[0][1].sha} (built ${seen[0][1].builtAt})\npro:  ${seen[1][1].sha} (built ${seen[1][1].builtAt})`,
        remediation: 'Re-run ./scripts/deploy.sh and watch it finish.',
      }));
    }

    // Staleness. Two questions, and they are not the same question:
    //   (a) how far behind is it, in commits and days;
    //   (b) does any of that gap CHANGE THE PAGES. Most of this repo's recent
    //       traffic is API routes, tests and docs, none of which the static
    //       export ships. Counting those as "the site is stale" would cry wolf
    //       every night and get the check muted, so the page-content question
    //       is asked separately and is the one that carries weight.
    if (seen.length) {
      const [, v] = seen[0];
      const behind = Number(git(ctx.repoRoot, ['rev-list', '--count', `${v.sha}..${mainRef}`]) || '0');
      const builtAt = Date.parse(v.builtAt);
      const ageDays = Number.isNaN(builtAt) ? null : Math.floor((Date.now() - builtAt) / DAY);
      // Paths whose contents end up in the exported HTML. app/**/route.ts is
      // excluded: those are the API, deployed separately by deploy-api.sh and
      // running as the ib-api systemd unit, not shipped with the static site.
      const changed = (git(ctx.repoRoot, ['diff', '--name-only', `${v.sha}..${mainRef}`]) || '')
        .split('\n').map((s) => s.trim()).filter(Boolean)
        .filter((f) => /^(?:data|components|public)\//.test(f) || (/^app\//.test(f) && !/\/route\.ts$/.test(f)));

      if (behind > 10 || (ageDays !== null && ageDays > 14)) {
        findings.push(finding({
          severity: 'medium',
          title: `The live export is ${behind} commit(s) and ${ageDays === null ? 'an unknown number of' : ageDays} day(s) behind ${mainRef}`,
          detail: 'Past this point the working tree and the droplet are meaningfully different systems, and every content guard in the repo is grading the one nobody is reading.',
          evidence: `live ${v.sha} built ${v.builtAt}; ${mainRef} is ${git(ctx.repoRoot, ['rev-parse', '--short', mainRef])}\n${behind} commit(s) behind, ${ageDays} day(s) old (limits: 10 commits / 14 days)\npage-content files changed in that gap: ${changed.length}`,
          remediation: 'Deploy, or decide on purpose that the box stays where it is and say so somewhere the next person will read.',
        }));
      } else if (changed.length && ageDays !== null && ageDays > 3) {
        findings.push(finding({
          severity: 'low',
          title: `${changed.length} page-content change(s) have been sitting unshipped for ${ageDays} days`,
          detail: 'These are edits to data/, components/ or app/ pages, so they change what visitors would read. They have passed the guards in the repo and have not reached the box. This is the gap where "the tests are green" and "the site is right" come apart.',
          evidence: `live ${v.sha} (built ${v.builtAt}) vs ${mainRef}\n${changed.slice(0, 15).join('\n')}${changed.length > 15 ? `\n… and ${changed.length - 15} more` : ''}`,
          remediation: 'Deploy with ./scripts/deploy.sh.',
        }));
      }
    }

    if (!seen.length && !findings.length) throw new Skip('neither tier returned a version marker and nothing was graded');
    return { findings, checked };
  },
});

/**
 * The two tiers are actually two different builds.
 *
 * This is the reviewer's catch, and it is a good one: cmp-live-build-provenance
 * asserts that both tiers report the SAME commit, and they always will, because
 * deploy.sh computes $VERSION once and writes it into both. So version.txt can
 * look perfect while /resources-pro holds a second copy of the free site —
 * NEXT_PUBLIC_TIER=pro was not set, or the same out/ was rsynced twice.
 *
 * What that would mean: the Pro surface is a product surface that is never
 * meant to be a search result (scripts/droplet-htaccess.conf sets X-Robots-Tag
 * noindex, follow for /resources-pro/), and the free build filters the
 * navigation down to /tools for the Pro deployment. A repeated free build
 * under /resources-pro is an indexable duplicate of the whole site with the
 * wrong funnel on it. Nothing in the repo or the smoke test would notice.
 *
 * Fingerprint rather than byte-diff: the Pro build filters the global nav to
 * /tools alone (app/layout.tsx IS_PRO_DEPLOYMENT), so the category links in
 * the header and footer are the cheapest honest tell.
 */
const tierDistinct = check({
  id: 'cmp-tier-surfaces-distinct',
  discipline: 'compliance',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The Pro folder holds a real Pro build, not a second copy of the free site — which version.txt cannot tell you, because both tiers are stamped from one variable.',
  async run(ctx) {
    const free = await ctx.http(`${ctx.freeBase}/tools/`, { timeoutMs: 20_000, redirect: 'follow' });
    const pro = await ctx.http(`${ctx.proBase}/tools/`, { timeoutMs: 20_000, redirect: 'follow' });
    if (!free.ok || free.status !== 200 || !pro.ok || pro.status !== 200) {
      throw new Skip(`could not read both tiers: free ${free.ok ? free.status : free.error}, pro ${pro.ok ? pro.status : pro.error}`);
    }
    const findings = [];

    // 1. The Pro copy must be told not to be a search result.
    const robots = pro.headers.get('x-robots-tag') || '';
    if (!/noindex/i.test(robots)) {
      findings.push(finding({
        severity: 'medium',
        title: 'The Pro site is not marked noindex',
        detail: 'The Pro folder is a product surface, deliberately kept out of search results by the X-Robots-Tag rule in scripts/droplet-htaccess.conf. Without it, a near-duplicate of the whole site is indexable, which is both an SEO problem and a Pro surface shown to people who do not have Pro.',
        evidence: `GET ${ctx.proBase}/tools/ -> 200, X-Robots-Tag: ${robots ? JSON.stringify(robots) : '(absent)'}`,
        remediation: 'Re-apply the managed block: ./scripts/droplet-server-config.sh',
      }));
    }

    // 2. It must be a Pro build, not the free one copied across.
    const catLinks = (html, base) => (html.match(new RegExp(`href="${base}/(guides|checklists|comparisons|templates|calculators|glossary)/"`, 'g')) || []).length;
    const freeCats = catLinks(free.text, '/resources');
    const proCats = catLinks(pro.text, '/resources-pro');
    if (free.text === pro.text) {
      findings.push(finding({
        severity: 'medium',
        title: 'The two tiers are serving byte-identical pages',
        detail: 'A Pro build differs from the free one by construction (NEXT_PUBLIC_TIER=pro changes the navigation and the Pro surfaces). Identical bytes mean the same out/ was uploaded twice, and version.txt cannot show it because deploy.sh stamps both from one variable.',
        evidence: `${ctx.freeBase}/tools/ and ${ctx.proBase}/tools/ returned identical bodies (${free.text.length} bytes)`,
        remediation: 'Re-run ./scripts/deploy.sh so each tier is built with its own env, and watch both builds happen.',
      }));
    } else if (proCats > 0) {
      findings.push(finding({
        severity: 'medium',
        title: 'The Pro site is serving the free navigation',
        detail: 'app/layout.tsx filters the global nav to /tools when NEXT_PUBLIC_TIER=pro. Category links under /resources-pro mean the export in that folder was built without the Pro flag — so it is the free site wearing the Pro URL, with the wrong funnel and the wrong Pro surfaces.',
        evidence: `${ctx.proBase}/tools/ carries ${proCats} category nav link(s) (expected 0); ${ctx.freeBase}/tools/ carries ${freeCats}`,
        remediation: 'Rebuild and redeploy the Pro tier with NEXT_PUBLIC_TIER=pro (scripts/deploy.sh does this).',
      }));
    } else if (freeCats === 0) {
      // The fingerprint has stopped meaning anything; say so instead of
      // reporting a pass built on an assertion that no longer discriminates.
      throw new Skip(`the free tier now also serves 0 category nav links, so this fingerprint no longer distinguishes the tiers — re-derive it from app/layout.tsx before trusting this check again`);
    }

    return { findings, checked: 2 };
  },
});

export default [provenance, tierDistinct];
