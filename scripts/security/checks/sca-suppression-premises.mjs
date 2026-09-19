/**
 * Re-assert, on every commit, every fact that a suppression rests on.
 *
 * sca-prod-path-audit waives twenty-eight advisories. Each waiver is a claim
 * that something about this codebase makes the advisory unreachable — no proxy
 * layer, no Server Actions, no Image Optimization API, a Linux host. Those are
 * all true today and every one of them is one ordinary pull request away from
 * being false:
 *
 *   - The Origin allowlist is exactly the kind of thing someone would move into
 *     a Next proxy file, because that is the Next-native way to do it. The
 *     moment proxy.ts exists, six waived Middleware/Proxy-bypass advisories are
 *     live.
 *   - Flipping images.unoptimized to false to get responsive images across the
 *     ~1,400 pSEO pages re-arms the AVIF RCE, the two Image-Optimization DoS
 *     advisories and both sharp/libvips highs on the droplet.
 *   - One Server Action on the Pro upgrade form brings back the Server Actions
 *     SSRF, the DoS and the Server Function endpoint disclosure.
 *
 * Nothing would say so. The suppression file would keep quietly waving them
 * through, which is worse than not having suppressed them at all — it is the
 * ssrf-protection.test.ts failure again, a control that reports green while
 * grading something that no longer resembles the thing it claims to grade.
 *
 * Offline, pure file reads, every commit. It has to be cheap enough that
 * nobody is ever tempted to move it to nightly.
 */
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { evaluatePremise, readJson } from './sca-lib.mjs';

export default check({
  id: 'sca-suppression-premises',
  discipline: 'sca',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Every advisory suppression names a fact about this codebase; this re-checks each fact and names the GHSAs a broken one re-activates.',
  async run(ctx) {
    const findings = [];
    const suppFile = join(ctx.repoRoot, 'scripts/security/data/sca-suppressions.json');

    let supp;
    try {
      supp = readJson(suppFile);
    } catch (err) {
      throw new ctx.Skip(`cannot read ${suppFile}: ${err.message}`);
    }
    if (!supp.suppressions?.length) {
      throw new ctx.Skip('sca-suppressions.json holds no suppressions — nothing to assert');
    }

    const lock = readJson(join(ctx.repoRoot, 'package-lock.json'));

    // Premises are grouped, because build-time-only is per-package (postcss's
    // premise is not nanoid's) while the rest are global facts.
    const groups = new Map();
    for (const s of supp.suppressions) {
      const key = s.premise === 'build-time-only' ? `build-time-only:${s.package}` : s.premise;
      if (!groups.has(key)) groups.set(key, { premise: s.premise, pkg: s.premise === 'build-time-only' ? s.package : null, entries: [] });
      groups.get(key).entries.push(s);
    }

    for (const [key, g] of groups) {
      const { holds, evidence } = evaluatePremise(g.premise, ctx, { lock, pkg: g.pkg });
      if (holds) continue;
      const ghsas = g.entries.map((e) => e.ghsa);
      findings.push(finding({
        severity: 'high',
        title: `Broken premise "${key}" re-activates ${ghsas.length} suppressed advisor${ghsas.length === 1 ? 'y' : 'ies'}`,
        detail: `${supp.premises?.[g.premise] || '(no description in the premises map)'}\n\nThat is no longer true, so these waivers are void and the advisories they cover are reachable again: ${ghsas.join(', ')}.`,
        evidence: `premise ${key}: ${evidence}`,
        remediation: `Either undo the change, or delete those entries from scripts/security/data/sca-suppressions.json and upgrade the affected packages. Do not edit the premise description to match the new reality — the advisories are live either way.`,
        file: 'scripts/security/data/sca-suppressions.json',
      }));
    }

    // A premise key with no assertion behind it is the quiet version of the
    // same failure: it looks like a control and checks nothing.
    const defined = new Set(Object.keys(supp.premises || {}));
    for (const s of supp.suppressions) {
      if (defined.has(s.premise)) continue;
      findings.push(finding({
        severity: 'medium',
        title: `Suppression ${s.ghsa} names premise "${s.premise}", which is not defined`,
        detail: 'An undefined premise has no description and no assertion, so nothing will ever void this waiver.',
        evidence: `sca-suppressions.json: ${s.ghsa} (${s.package}) premise="${s.premise}"; defined: ${[...defined].join(', ')}`,
        remediation: 'Add the key to `premises` and a case for it in sca-lib.mjs evaluatePremise(), or reuse an existing key.',
        file: 'scripts/security/data/sca-suppressions.json',
      }));
    }

    // checked = premises actually evaluated, plus the suppressions whose
    // premise key was verified to exist. Both are real inspections.
    return { findings, checked: groups.size + supp.suppressions.length };
  },
});
