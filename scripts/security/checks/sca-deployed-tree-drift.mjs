/**
 * Does the code on the droplet match the code this repo just audited?
 *
 * Every other check in this discipline grades a laptop. That is worth nothing
 * if the artifact serving the public is a different one, and there is a
 * specific, documented way that happens here.
 *
 * scripts/deploy-api.sh used to md5 the remote lockfile before the rsync and
 * again after it, and reinstall when they differed. `set -euo pipefail` is in
 * force, so one failed `npm ci` — a registry 503, a full disk on an 80GB box
 * that also runs MySQL, a www-data permission problem — aborted the script
 * AFTER the new lockfile had already overwritten the old one on the droplet.
 * From then on every deploy computed BEFORE == AFTER, concluded nothing had
 * changed, and never reinstalled again. Production would keep running a
 * node_modules that did not match its lockfile, indefinitely, while `npm audit`
 * on the laptop went green after the upgrade and deploys kept reporting
 * success. That is the worst failure mode SCA has.
 *
 * The script now hangs the decision off /opt/ib-api/.npm-ci-installed.md5,
 * written only after npm ci exits 0. This check verifies from the outside that
 * the fix is actually holding, because the whole point is that the deploy
 * cannot be trusted to report its own state.
 *
 * Two checks live here: the Node service, and the two static sites — where
 * react-dom actually reaches the public, across ~1,400 pages.
 *
 * PRODUCTION SAFETY: read-only. cat, ls, find, md5sum and `node -p` on a
 * package.json. No writes, no restart, no npm, nothing through Apache, nothing
 * near WordPress or MySQL. needsOptIn all the same, because it needs the
 * production SSH credential and belongs in a run someone asked for by id.
 * Nothing here echoes, logs or writes any value out of .secrets.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { readJson } from './sca-lib.mjs';

const REMOTE_API = '/opt/ib-api';
const WEB_ROOT = '/var/www/html';
const PINNED = ['next', 'react', 'react-dom', 'ioredis', 'js-sha256'];

/** Dev-only packages that must never appear in an --omit=dev tree. */
const DEV_MARKERS = ['vitest', 'typescript', 'eslint', '@playwright', '@vitejs', 'playwright'];

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/**
 * Which of the dev-marker packages found on the box are DRIFT (dev-only in the
 * lockfile, so they cannot have come from --omit=dev) and which are DEAD
 * WEIGHT (in the lockfile's production closure because a production
 * dependency declares them — next@16.3.5 declares @playwright/test). Exported
 * so the grading is testable on a fake lockfile without a droplet.
 */
export function gradeDevPackages(lock, devFound) {
  const packages = lock.packages || {};
  const names = [];
  for (const { marker, members } of devFound) {
    if (marker.startsWith('@')) for (const m of members) names.push(`${marker}/${m}`);
    else names.push(marker);
  }
  const drift = [];
  const deadWeight = [];
  for (const name of names) {
    const entry = packages[`node_modules/${name}`];
    if (!entry || entry.dev) { drift.push(name); continue; }
    const requiredBy = Object.entries(packages)
      .filter(([k, v]) => k && !v.dev && ((v.dependencies || {})[name] || (v.optionalDependencies || {})[name] || (v.peerDependencies || {})[name]))
      .map(([k]) => k.replace(/^node_modules\//, ''));
    deadWeight.push({ name, requiredBy });
  }
  return { drift, deadWeight };
}

/** Pull out one FIELD:value line from the combined remote output. */
function field(out, key) {
  const m = new RegExp(`^${key}:(.*)$`, 'm').exec(out);
  return m ? m[1].trim() : null;
}

const apiDrift = check({
  id: 'sca-deployed-tree-drift',
  discipline: 'sca',
  cadence: 'weekly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: true,
  requires: ['ssh'],
  describe: 'The node_modules ib-api actually runs matches the lockfile this repo audits — the failure that keeps a vulnerable version live while the laptop audit goes green.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const localLockPath = join(ctx.repoRoot, 'package-lock.json');
    if (!existsSync(localLockPath)) throw new ctx.Skip('no package-lock.json locally to compare against');
    const localLockMd5 = md5(readFileSync(localLockPath));
    const lock = readJson(localLockPath);

    // One ssh session, one command, all read-only. Batched because every extra
    // connection is a real login on a 2 vCPU box that also serves WordPress.
    const cmd = [
      `echo LOCK:$(md5sum ${REMOTE_API}/package-lock.json 2>/dev/null | cut -d' ' -f1)`,
      `echo MARKER:$(cat ${REMOTE_API}/.npm-ci-installed.md5 2>/dev/null | tr -d '[:space:]')`,
      `echo MODCOUNT:$(ls -1 ${REMOTE_API}/node_modules 2>/dev/null | wc -l | tr -d ' ')`,
      ...PINNED.map((p) => `echo VER_${p.replace(/-/g, '_')}:$(node -p "require('${REMOTE_API}/node_modules/${p}/package.json').version" 2>/dev/null)`),
      // A scope directory (@playwright, @vitejs) is reported with its contents,
      // and only if it has any: npm leaves an empty @vitejs/ behind after an
      // --omit=dev install, and an empty directory is not a package.
      ...DEV_MARKERS.map((d) => `[ -e ${REMOTE_API}/node_modules/${d} ] && [ -n "$(ls -A ${REMOTE_API}/node_modules/${d} 2>/dev/null)" ] && echo DEVPKG:${d}:$(ls -A ${REMOTE_API}/node_modules/${d} 2>/dev/null | tr '\\n' ',') || true`),
    ].join('; ');

    const out = ctx.ssh(cmd); // throws Skip when .secrets has no droplet login

    const remoteLock = field(out, 'LOCK');
    if (!remoteLock) {
      throw new ctx.Skip(`could not read ${REMOTE_API}/package-lock.json over ssh — output was: ${out.trim().slice(0, 200)}`);
    }

    checked += 1;
    if (remoteLock !== localLockMd5) {
      findings.push(finding({
        severity: 'high',
        title: 'The droplet is running a different lockfile from this repo',
        detail: 'Everything sca-prod-path-audit concluded was concluded about the local lockfile. The production service resolved its dependencies from a different one, so the audit result does not describe what is running.',
        evidence: `md5 ${REMOTE_API}/package-lock.json = ${remoteLock}; local package-lock.json = ${localLockMd5}`,
        remediation: 'Run scripts/deploy-api.sh. If it reports success and the hashes still differ, the rsync is not reaching that path.',
        file: 'package-lock.json',
      }));
    }

    // The reinstall gate itself. A marker that does not match the shipped
    // lockfile means the last npm ci did not complete for that lockfile —
    // which is exactly the state the old script could not see.
    const marker = field(out, 'MARKER');
    checked += 1;
    if (!marker) {
      findings.push(finding({
        severity: 'medium',
        title: 'No .npm-ci-installed.md5 marker on the droplet',
        detail: 'The deploy gate uses that file to know which lockfile was last SUCCESSFULLY installed. Without it the next deploy will reinstall (which is the safe direction), but right now nothing records what the running tree was built from.',
        evidence: `cat ${REMOTE_API}/.npm-ci-installed.md5 returned nothing`,
        remediation: 'Run scripts/deploy-api.sh once; it writes the marker after a successful npm ci.',
        file: 'scripts/deploy-api.sh',
      }));
    } else if (marker !== remoteLock) {
      findings.push(finding({
        severity: 'high',
        title: 'The droplet lockfile was never successfully installed',
        detail: 'The lockfile on the droplet and the marker recording the last successful npm ci disagree. node_modules therefore does not match the lockfile that is sitting next to it — the exact half-installed state that used to persist silently across every later deploy.',
        evidence: `${REMOTE_API}/.npm-ci-installed.md5 = ${marker}; md5 of ${REMOTE_API}/package-lock.json = ${remoteLock}`,
        remediation: 'Re-run scripts/deploy-api.sh and watch the install step. The mismatch is what makes it retry.',
        file: 'scripts/deploy-api.sh',
      }));
    }

    // Spot-check the versions that matter, so a drifting tree is caught even
    // if the lockfile and marker happen to agree.
    for (const p of PINNED) {
      const remoteVer = field(out, `VER_${p.replace(/-/g, '_')}`);
      const entry = lock.packages?.[`node_modules/${p}`];
      if (!entry) continue;
      checked += 1;
      if (!remoteVer || remoteVer === 'undefined') {
        findings.push(finding({
          severity: 'high',
          title: `${p} is not installed on the droplet`,
          detail: 'The lockfile has it in the production closure but the running tree does not, so ib-api is either failing to load it or resolving it from somewhere unexpected.',
          evidence: `node -p require('${REMOTE_API}/node_modules/${p}/package.json').version returned nothing; lockfile says ${entry.version}`,
          remediation: 'Re-run scripts/deploy-api.sh.',
          file: 'package-lock.json',
        }));
      } else if (remoteVer !== entry.version) {
        findings.push(finding({
          severity: 'high',
          title: `${p} on the droplet is ${remoteVer}, the lockfile says ${entry.version}`,
          detail: 'The production service is running a different version of this package from the one every audit in this suite grades. If the lockfile version is the one that fixed an advisory, the fix is not deployed.',
          evidence: `${REMOTE_API}/node_modules/${p}/package.json version=${remoteVer}; package-lock.json node_modules/${p} version=${entry.version}`,
          remediation: 'Re-run scripts/deploy-api.sh and confirm the install step actually runs.',
          file: 'package-lock.json',
        }));
      }
    }

    // Is it still an --omit=dev tree? The realistic way dev packages get onto
    // the production host is someone running a bare `npm install` there while
    // debugging. That silently invalidates sca-prod-path-audit's whole premise
    // for downgrading dev-only advisories to INFO: they would now be on the box.
    const devFound = [...out.matchAll(/^DEVPKG:([^:\n]+):?(.*)$/gm)].map((m) => ({ marker: m[1].trim(), members: m[2].split(',').map((x) => x.trim()).filter(Boolean) }));
    checked += DEV_MARKERS.length;
    const graded = gradeDevPackages(lock, devFound);
    if (graded.drift.length) {
      findings.push(finding({
        severity: 'medium',
        title: `Dev-only packages are installed on the production droplet: ${graded.drift.join(', ')}`,
        detail: 'scripts/deploy-api.sh installs with --omit=dev and the lockfile does not place these in the production closure, so they arrived some other way — almost certainly a bare `npm install` run on the box. Their advisories are reported as INFO by sca-prod-path-audit precisely because they are supposed to never reach production, and that premise no longer holds.',
        evidence: `present under ${REMOTE_API}/node_modules and dev-only in package-lock.json: ${graded.drift.join(', ')} (module count ${field(out, 'MODCOUNT') || '?'})`,
        remediation: `rm -rf ${REMOTE_API}/node_modules and re-run scripts/deploy-api.sh, which reinstalls with --omit=dev --ignore-scripts.`,
        file: 'scripts/deploy-api.sh',
      }));
    }
    if (graded.deadWeight.length) {
      findings.push(finding({
        severity: 'info',
        title: `Test tooling in the production closure, pulled in by a production dependency: ${graded.deadWeight.map((d) => d.name).join(', ')}`,
        detail: 'These are dev-only by any sensible reading, but package-lock.json puts them in the production closure because a production dependency declares them, so --omit=dev installs them correctly and no reinstall removes them. On 2026-09-22 this was graded as drift and the operator was told to wipe node_modules; the wipe changed nothing, because there was nothing to change. It is dead weight on the box, not a sign anyone ran npm install there. Removing it means an npm override or a Next release that stops declaring it.',
        evidence: graded.deadWeight.map((d) => `${d.name} <- ${d.requiredBy.join(', ') || '(root)'}`).join('; '),
        remediation: 'Nothing on the box. If it matters, add an `overrides` entry in package.json for the offending dependency and re-run the every-commit suite.',
        file: 'package-lock.json',
      }));
    }

    return { findings, checked };
  },
});

/**
 * The static sites — added on top of the specification, because the reviewer
 * was right that it was missing.
 *
 * scripts/deploy.sh rsyncs by far the larger public surface, and react-dom
 * genuinely reaches visitors through out/_next/static/chunks on every one of
 * those ~1,400 pages. A stale or half-finished static deploy leaves the
 * vulnerable client chunks live long after the laptop-side audit has gone
 * green: the same failure the API check exists for, on the bigger artifact.
 *
 * The anchor is version.txt, which deploy.sh writes into BOTH roots as
 * "<short sha>[+uncommitted] built <ISO8601>". out/.build-marker.json was the
 * obvious alternative and is the wrong one — deploy.sh writes it only for the
 * free tier (the page guards "know" the free site), so a check built on it
 * would report the Pro root as unmarked every single week forever with no fix
 * available to whoever read it. That is how a check gets switched off.
 *
 * The commit id is also strictly better evidence than a timestamp: it answers
 * WHICH commits the live pages are missing, by name.
 */
const staticDrift = check({
  id: 'sca-static-deploy-drift',
  discipline: 'sca',
  cadence: 'weekly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: true,
  requires: ['ssh', 'git'],
  describe: 'Both static roots are serving a build from a commit that is current — otherwise the client chunks the public loads predate the fix.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const roots = [`${WEB_ROOT}/resources`, `${WEB_ROOT}/resources-pro`];
    // Read-only, one session: two cats and two directory listings.
    const cmd = roots
      .map((r, i) => [
        `echo VERSION${i}:$(cat ${r}/version.txt 2>/dev/null | tr -d '\\n')`,
        `echo NCHUNKS${i}:$(ls -1 ${r}/_next/static/chunks 2>/dev/null | wc -l | tr -d ' ')`,
      ].join('; '))
      .join('; ');

    const out = ctx.ssh(cmd);

    const git = (args) => {
      try {
        return execFileSync('git', args, { cwd: ctx.repoRoot, encoding: 'utf-8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      } catch {
        return null;
      }
    };
    const head = git(['rev-parse', '--short', 'HEAD']);

    const deployed = [];
    for (let i = 0; i < roots.length; i += 1) {
      const raw = field(out, `VERSION${i}`);
      const nchunks = field(out, `NCHUNKS${i}`) || '0';
      checked += 1;

      if (!raw) {
        findings.push(finding({
          severity: Number(nchunks) > 0 ? 'high' : 'medium',
          title: `No version.txt under ${roots[i]}`,
          detail: Number(nchunks) > 0
            ? 'There is a built site there — it has chunks — but nothing recording which commit produced it. Nobody can tell whether the JavaScript the public is loading includes the last dependency upgrade or the last security fix.'
            : 'That root has neither a version stamp nor any chunks, so either the site is not deployed there or this check is looking at the wrong path.',
          evidence: `cat ${roots[i]}/version.txt returned nothing; ${nchunks} file(s) under ${roots[i]}/_next/static/chunks`,
          remediation: 'Run scripts/deploy.sh — it writes version.txt into out/ for both tiers before the rsync.',
          file: 'scripts/deploy.sh',
        }));
        deployed.push(null);
        continue;
      }

      const m = /^([0-9a-f]{7,40})(\+uncommitted)?\s+built\s+(\S+)/.exec(raw);
      if (!m) {
        findings.push(finding({
          severity: 'medium',
          title: `Unreadable version stamp under ${roots[i]}`,
          detail: 'The file is there but is not in the "<sha> built <timestamp>" form deploy.sh writes, so it cannot identify the live build.',
          evidence: `${roots[i]}/version.txt = ${raw.slice(0, 200)}`,
          remediation: 'Re-run scripts/deploy.sh.',
          file: 'scripts/deploy.sh',
        }));
        deployed.push(null);
        continue;
      }

      const [, sha, dirty, builtAt] = m;
      deployed.push({ sha, dirty: Boolean(dirty), builtAt, root: roots[i], nchunks });

      if (dirty) {
        findings.push(finding({
          severity: 'medium',
          title: `${roots[i]} was built from an uncommitted working tree`,
          detail: 'deploy.sh appends +uncommitted when the tree was dirty at build time. Nothing in git describes what is actually live, so no audit of this repo — including every other check in this suite — can claim to describe those pages.',
          evidence: `${roots[i]}/version.txt = ${raw}`,
          remediation: 'Commit, then redeploy so the live build is identified by a commit that exists.',
          file: 'scripts/deploy.sh',
        }));
      }

      if (!head) continue;
      checked += 1;
      if (sha === head) continue;

      const known = git(['cat-file', '-e', `${sha}^{commit}`]) !== null;
      if (!known) {
        findings.push(finding({
          severity: 'high',
          title: `${roots[i]} is serving a commit this repo does not have: ${sha}`,
          detail: 'The live build came from something not in this checkout — another clone, a rebased branch, or a deploy from a machine whose work was never pushed. Nothing here can audit what those pages contain.',
          evidence: `${roots[i]}/version.txt = ${raw}; local HEAD is ${head} and \`git cat-file -e ${sha}^{commit}\` fails.`,
          remediation: 'git fetch, and find out who deployed from where.',
          file: 'scripts/deploy.sh',
        }));
        continue;
      }

      // Only commits that changed what SHIPS matter. A README-only commit
      // being newer than the live build is not a security finding, and
      // reporting it as one every week is how this check would get ignored.
      const behind = Number(git(['rev-list', '--count', `${sha}..HEAD`, '--', 'app', 'lib', 'components', 'package-lock.json']) || '0');
      if (behind > 0) {
        const log = git(['log', '--oneline', '--no-decorate', `${sha}..HEAD`, '--', 'app', 'lib', 'components', 'package-lock.json']) || '';
        findings.push(finding({
          severity: 'high',
          title: `${roots[i]} is ${behind} shipped-code commit(s) behind HEAD`,
          detail: 'The client bundle under _next/static/chunks is where react-dom and this project\'s own code actually reach visitors, on every page under this root. Those commits changed app/, lib/, components/ or the lockfile and are not in the build the public is being served.',
          evidence: `${roots[i]}/version.txt = ${raw}; HEAD = ${head}. Missing: ${log.split('\n').slice(0, 6).join(' | ').slice(0, 500)}`,
          remediation: 'Run scripts/deploy.sh, which rebuilds and rsyncs both tiers.',
          file: 'scripts/deploy.sh',
        }));
      }
    }

    // deploy.sh ships both roots in one run from one checkout, so they must
    // carry the same commit. Different shas is a partial deploy: one tier
    // updated, the other left on older chunks.
    checked += 1;
    if (deployed[0] && deployed[1] && deployed[0].sha !== deployed[1].sha) {
      findings.push(finding({
        severity: 'high',
        title: 'The free and Pro static roots are serving different commits',
        detail: 'scripts/deploy.sh builds and rsyncs both tiers back to back from the same checkout. Two different commits means one of those rsyncs did not complete, and one tier is live on older code than the other.',
        evidence: `${roots[0]} = ${deployed[0].sha} built ${deployed[0].builtAt} (${deployed[0].nchunks} chunks); ${roots[1]} = ${deployed[1].sha} built ${deployed[1].builtAt} (${deployed[1].nchunks} chunks)`,
        remediation: 'Re-run scripts/deploy.sh and watch both site() invocations finish.',
        file: 'scripts/deploy.sh',
      }));
    }

    if (!checked) throw new ctx.Skip('nothing could be read from either static root over ssh');
    return { findings, checked };
  },
});

export default [apiDrift, staticDrift];
