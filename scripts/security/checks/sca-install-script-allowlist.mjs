/**
 * A new install script must be noticed by a human before it runs.
 *
 * scripts/deploy-api.sh installs the production closure on the droplet as
 * www-data, on the same host as the team's WordPress and MySQL. Any package in
 * that closure that gains a postinstall gets arbitrary code execution as the
 * web user on that box. It does not have to be a package anyone here chose —
 * a compromised patch release three levels down does it, and the change would
 * appear in the diff as one `"hasInstallScript": true` inside 280KB of
 * lockfile JSON. Nobody catches that by reading.
 *
 * So the five known ones are written down in
 * scripts/security/data/sca-install-script-allowlist.json with a reason each,
 * and anything else is a finding.
 *
 * The check also asserts the two mitigations that currently make the known
 * five harmless — ignore-scripts=true in .npmrc, and the explicit
 * --ignore-scripts on the remote npm ci. Those are defence in depth on purpose
 * (the .npmrc is rsync'd, so a partial upload would otherwise silently drop
 * it), and this allowlist is all that is left if someone removes them.
 *
 * Offline: it parses package-lock.json and reads two files. No install, no
 * network, no registry lookup.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { readJson } from './sca-lib.mjs';

export default check({
  id: 'sca-install-script-allowlist',
  discipline: 'sca',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A package gaining a postinstall runs as www-data on the WordPress box; every install script in the lockfile must be on the reviewed list.',
  async run(ctx) {
    const findings = [];
    const listFile = join(ctx.repoRoot, 'scripts/security/data/sca-install-script-allowlist.json');
    const lockFile = join(ctx.repoRoot, 'package-lock.json');

    let allow;
    let lock;
    try {
      allow = readJson(listFile);
      lock = readJson(lockFile);
    } catch (err) {
      throw new ctx.Skip(`cannot read the lockfile or the allowlist: ${err.message}`);
    }

    const entries = Object.entries(lock.packages || {}).filter(([p, v]) => p && v.hasInstallScript);
    if (!entries.length && !Object.keys(lock.packages || {}).length) {
      throw new ctx.Skip('package-lock.json has no `packages` map — nothing to inspect');
    }

    const byPath = new Map(allow.allowed.map((a) => [a.path, a]));
    const seen = new Set();

    for (const [path, entry] of entries) {
      const inProd = !entry.dev && !entry.devOptional;
      const known = byPath.get(path);
      seen.add(path);

      if (!known) {
        findings.push(finding({
          severity: inProd ? 'high' : 'medium',
          title: `Unreviewed install script: ${path}`,
          detail: inProd
            ? 'This package is in the --omit=dev closure, so scripts/deploy-api.sh installs it on the droplet. Its install script is code that would run as www-data on the host that also serves the team\'s WordPress and MySQL.'
            : 'Dev-only, so it does not reach the droplet — but it runs on the machine that holds the deploy SSH key.',
          evidence: `package-lock.json: "${path}" has hasInstallScript: true, version ${entry.version || '?'}, resolved ${String(entry.resolved || '(none)').slice(0, 90)}. It is not in sca-install-script-allowlist.json (reviewed ${allow.reviewed}).`,
          remediation: `Read the package's install script. If it is legitimate, add it to scripts/security/data/sca-install-script-allowlist.json with the reason and set inProdClosure: ${inProd}. If it is not, pin around it.`,
          file: 'package-lock.json',
        }));
        continue;
      }

      if (known.inProdClosure !== inProd) {
        findings.push(finding({
          severity: inProd ? 'medium' : 'low',
          title: `${known.name} moved ${inProd ? 'into' : 'out of'} the production closure and still has an install script`,
          detail: inProd
            ? 'It was reviewed as dev-only. It now installs on the droplet, which changes who runs its install script and on which machine — from a laptop to www-data on the WordPress host.'
            : 'It was reviewed as a production package and is now dev-only. Lower risk, but the allowlist is out of date and the next real move would be harder to spot.',
          evidence: `package-lock.json: "${path}" dev=${Boolean(entry.dev)} devOptional=${Boolean(entry.devOptional)} → inProdClosure=${inProd}; the allowlist records inProdClosure=${known.inProdClosure}.`,
          remediation: 'Re-read the reason in the allowlist against the new placement, then update the entry.',
          file: 'package-lock.json',
        }));
      }
    }

    // A stale allowlist line is not dangerous by itself, but it is a standing
    // pre-approval for a package that is no longer here.
    for (const a of allow.allowed) {
      if (seen.has(a.path)) continue;
      findings.push(finding({
        severity: 'low',
        title: `Allowlisted install script no longer in the lockfile: ${a.path}`,
        detail: 'The package is gone or no longer declares an install script, so this line is a standing approval for something that is not here.',
        evidence: `sca-install-script-allowlist.json lists ${a.path}; package-lock.json has ${entries.length} hasInstallScript entries and none at that path.`,
        remediation: 'Delete the entry.',
        file: 'scripts/security/data/sca-install-script-allowlist.json',
      }));
    }

    // The two guards. Without these the five known scripts start executing
    // again on the next deploy, which is what the allowlist assumes they do not.
    const npmrcPath = join(ctx.repoRoot, '.npmrc');
    const npmrc = existsSync(npmrcPath) ? readFileSync(npmrcPath, 'utf-8') : null;
    if (npmrc === null || !/^\s*ignore-scripts\s*=\s*true\s*$/m.test(npmrc)) {
      findings.push(finding({
        severity: 'high',
        title: 'ignore-scripts=true is no longer set in .npmrc',
        detail: 'That file is rsync\'d to /opt/ib-api so a `npm ci` run by hand on the droplet also gets it. Without it, every install script in the production closure executes as www-data on the WordPress host.',
        evidence: npmrc === null ? '.npmrc does not exist at the repo root' : `.npmrc exists (${npmrc.length} bytes) but contains no "ignore-scripts=true" line`,
        remediation: 'Restore `ignore-scripts=true` in .npmrc. If one package genuinely needs its script, rebuild that one package explicitly instead.',
        file: '.npmrc',
      }));
    }

    const deployPath = join(ctx.repoRoot, 'scripts/deploy-api.sh');
    const deploy = existsSync(deployPath) ? readFileSync(deployPath, 'utf-8') : null;
    if (deploy === null) {
      findings.push(finding({
        severity: 'medium',
        title: 'scripts/deploy-api.sh is missing, so the install-script guard on the droplet cannot be verified',
        detail: 'This check asserts that the remote npm ci passes --ignore-scripts. With the script gone it can assert nothing about how the production install runs.',
        evidence: `no file at ${deployPath}`,
        remediation: 'Point this check at wherever the API deploy lives now.',
        file: 'scripts/deploy-api.sh',
      }));
    } else if (!/npm ci[^\n]*--ignore-scripts/.test(deploy)) {
      const line = deploy.split('\n').findIndex((l) => /npm ci/.test(l)) + 1;
      findings.push(finding({
        severity: 'high',
        title: 'The droplet npm ci no longer passes --ignore-scripts',
        detail: 'The flag is there so the protection does not depend on .npmrc having been rsync\'d intact. Losing it means a partial upload silently re-enables install scripts on the production host.',
        evidence: `scripts/deploy-api.sh${line ? `:${line}` : ''}: the npm ci invocation is "${(deploy.split('\n').find((l) => /npm ci/.test(l)) || '(no npm ci line found)').trim().slice(0, 160)}"`,
        remediation: 'Put --ignore-scripts back on the remote npm ci.',
        file: 'scripts/deploy-api.sh',
        line: line || null,
      }));
    }

    // checked = install-script entries inspected + allowlist lines reconciled
    // + the two deploy-time guards. Every one of those was really looked at.
    return { findings, checked: entries.length + allow.allowed.length + 2 };
  },
});
