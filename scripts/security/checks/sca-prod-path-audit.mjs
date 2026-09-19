/**
 * The audit gate for the code that actually runs in production.
 *
 * Why not just `npm audit`: because its raw output here is misleading in both
 * directions. It reports 15 vulnerable packages for the full tree, but the
 * deploy installs with `npm ci --omit=dev` (scripts/deploy-api.sh), so eight of
 * those never leave a laptop. And of the seven that do reach the droplet, the
 * two entries it calls CRITICAL are an RCE that only fires on Windows and an
 * RCE in an Image Optimization API this app does not mount. A two-person team
 * that opens that output, works out for the third month running that the
 * criticals are irrelevant, and closes it again, has been trained to stop
 * reading it. That is the failure this check is built against — not a missing
 * scanner.
 *
 * So: audit the production closure only, reconcile it against
 * scripts/security/data/sca-suppressions.json, and report four separate things,
 * each of which is a real way this can go wrong.
 *
 *   1. An advisory on production code with no justification at all.
 *   2. A justification that has expired — nothing gets buried forever.
 *   3. A justification that matches no live advisory — a stale waiver that
 *      would silently cover the same GHSA if it came back.
 *   4. A justification whose premise key nothing can assert.
 *
 * Dev-only advisories are reported too, as one INFO line. Visible, never
 * blocking: they are a laptop risk and pretending otherwise is how the signal
 * gets buried again.
 */
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { flattenAudit, mapSeverity, npmJson, readJson } from './sca-lib.mjs';

const DAY = 86_400_000;

export default check({
  id: 'sca-prod-path-audit',
  discipline: 'sca',
  cadence: 'nightly',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Advisories against the --omit=dev closure that ib-api actually runs, minus expiring, premise-backed justifications.',
  async run(ctx) {
    const findings = [];
    const suppFile = join(ctx.repoRoot, 'scripts/security/data/sca-suppressions.json');

    let supp;
    try {
      supp = readJson(suppFile);
    } catch (err) {
      throw new ctx.Skip(`cannot read ${suppFile}: ${err.message}`);
    }

    // npm audit talks to the registry. No droplet, no rate limit of ours, and
    // the box that serves WordPress never hears about it.
    let prodAudit;
    let fullAudit;
    try {
      prodAudit = npmJson(['audit', '--omit=dev', '--json'], { cwd: ctx.repoRoot });
      fullAudit = npmJson(['audit', '--json'], { cwd: ctx.repoRoot });
    } catch (err) {
      throw new ctx.Skip(`npm audit could not run (offline, or no node_modules): ${err.message}`);
    }

    const prodRows = flattenAudit(prodAudit);
    const prodGhsa = new Set(prodRows.map((r) => r.ghsa));
    const devOnly = flattenAudit(fullAudit).filter((r) => !prodGhsa.has(r.ghsa));

    if (!prodRows.length && !devOnly.length && !(prodAudit.metadata?.dependencies?.prod > 0)) {
      throw new ctx.Skip('npm audit returned no dependency metadata at all — the tree is probably not installed');
    }

    const byGhsa = new Map(supp.suppressions.map((s) => [s.ghsa, s]));
    const known = new Set(Object.keys(supp.premises || {}));
    const now = Date.now();
    const used = new Set();

    for (const row of prodRows) {
      const s = byGhsa.get(row.ghsa);
      const fix = row.fixAvailable && typeof row.fixAvailable === 'object'
        ? `${row.fixAvailable.name}@${row.fixAvailable.version}${row.fixAvailable.isSemVerMajor ? ' (semver-major)' : ''}`
        : row.fixAvailable === true ? 'available via npm audit fix' : 'none published';

      if (!s) {
        // The whole point of the gate. Unjustified advisory on code that runs
        // on the droplet, graded at the ADVISORY's severity rather than the
        // package's — "next" is one package carrying 25 advisories across five
        // severities, and collapsing them loses the only useful distinction.
        findings.push(finding({
          severity: mapSeverity(row.severity),
          title: `Unjustified ${row.severity} advisory on production code: ${row.package} ${row.ghsa}`,
          detail: `${row.title}. ${row.package} is in the --omit=dev closure, so scripts/deploy-api.sh installs it on the droplet and ib-api can load it. No entry in sca-suppressions.json claims it is unreachable.`,
          evidence: `npm audit --omit=dev --json: ${row.ghsa} (${row.severity}) on ${row.package}${row.range ? ` ${row.range}` : ''} — ${row.url}. Fix: ${fix}.`,
          remediation: `Upgrade (${fix}), or add a scripts/security/data/sca-suppressions.json entry with a premise this suite can assert and an expiry date.`,
          file: 'package-lock.json',
        }));
        continue;
      }

      used.add(row.ghsa);

      if (!known.has(s.premise)) {
        findings.push(finding({
          severity: 'high',
          title: `Suppression for ${row.ghsa} rests on an unassertable premise`,
          detail: `The waiver names premise "${s.premise}", which is not defined in the premises map and is therefore checked by nothing. An unchecked premise is an opinion with an expiry date attached, not a control.`,
          evidence: `sca-suppressions.json entry for ${row.ghsa} (${row.package}) has premise="${s.premise}"; defined premises are: ${[...known].join(', ')}.`,
          remediation: 'Either reuse an existing premise key or add the key to `premises` and an assertion for it in sca-lib.mjs evaluatePremise().',
          file: 'scripts/security/data/sca-suppressions.json',
        }));
      }

      const expiry = Date.parse(`${s.expires}T00:00:00Z`);
      if (Number.isNaN(expiry)) {
        findings.push(finding({
          severity: 'medium',
          title: `Suppression for ${row.ghsa} has an unparseable expiry`,
          detail: 'Without a real date this waiver never comes up for re-review, which is the same as permanent.',
          evidence: `sca-suppressions.json: ${row.ghsa} expires="${s.expires}"`,
          remediation: 'Use YYYY-MM-DD.',
          file: 'scripts/security/data/sca-suppressions.json',
        }));
      } else if (expiry < now) {
        const days = Math.round((now - expiry) / DAY);
        findings.push(finding({
          severity: mapSeverity(row.severity),
          title: `Expired justification for ${row.package} ${row.ghsa} (${days} day${days === 1 ? '' : 's'} past)`,
          detail: `The waiver said: ${s.reason} That was signed off for a fixed period so someone would re-read it while the reasoning was still fresh. It is due.`,
          evidence: `sca-suppressions.json: ${row.ghsa} expires=${s.expires}, today is ${new Date(now).toISOString().slice(0, 10)}. Advisory still live at ${row.severity}: ${row.url}. Fix: ${fix}.`,
          remediation: 'Re-confirm the premise still holds and push the expiry out, or upgrade and delete the entry.',
          file: 'scripts/security/data/sca-suppressions.json',
        }));
      }
    }

    // A waiver matching nothing. Harmless today, and precisely the thing that
    // silently absorbs the advisory when it comes back on a later version.
    for (const s of supp.suppressions) {
      if (used.has(s.ghsa)) continue;
      findings.push(finding({
        severity: 'low',
        title: `Stale suppression: ${s.ghsa} (${s.package}) matches no live advisory`,
        detail: 'Nothing in the production closure reports this any more, so the waiver is dead weight — and dead weight that would pre-approve the same GHSA if a future version reintroduced it.',
        evidence: `sca-suppressions.json lists ${s.ghsa} for ${s.package}; npm audit --omit=dev reports ${prodRows.length} advisories and none of them is ${s.ghsa}.`,
        remediation: 'Delete the entry.',
        file: 'scripts/security/data/sca-suppressions.json',
      }));
    }

    if (devOnly.length) {
      const worst = devOnly.map((r) => r.severity);
      findings.push(finding({
        severity: 'info',
        title: `${devOnly.length} advisories in dev-only packages (laptop risk, never deployed)`,
        detail: 'These are in the tree `npm ci --omit=dev` leaves behind, so they do not reach the droplet. Listed because "not production" is not the same as "not real" — they run on the machine that holds the deploy key.',
        evidence: devOnly.map((r) => `${r.ghsa} ${r.severity} ${r.package}: ${r.title}`).join(' | ').slice(0, 1500),
        remediation: `npm audit fix on a branch when convenient. Severities present: ${[...new Set(worst)].join(', ')}.`,
        file: 'package.json',
      }));
    }

    // checked = every advisory reconciled plus every waiver examined. Not the
    // package count: this check inspects advisories, and saying otherwise
    // would inflate the number the runner prints.
    return { findings, checked: prodRows.length + devOnly.length + supp.suppressions.length };
  },
});
