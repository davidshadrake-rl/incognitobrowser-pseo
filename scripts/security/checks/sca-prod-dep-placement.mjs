/**
 * Nothing in `dependencies` that only the build uses.
 *
 * This is not tidiness. scripts/deploy-api.sh installs with `npm ci
 * --omit=dev`, so package.json's `dependencies` block is the literal
 * definition of what lands on the production droplet. Anything parked there by
 * habit gets installed next to a service that fetches attacker-supplied URLs.
 *
 * The live instance, which is why this check exists: @anthropic-ai/sdk and tsx
 * are both in `dependencies`, and neither is imported by anything that ships.
 * They exist for scripts/generate-content.ts, which runs on a laptop. The cost
 * is not abstract — tsx drags esbuild onto the droplet, esbuild is a compiler
 * with a binary-downloading postinstall, and its advisory then shows up in
 * `npm audit --omit=dev` and dilutes the output that sca-prod-path-audit is
 * trying to keep readable.
 *
 * What is deliberately NOT flagged: react, react-dom, next and
 * @fontsource/ibm-plex-mono. The first three are the framework itself and the
 * font is consumed through `@import` in app/globals.css rather than a JS
 * import, so a JS-only matcher would call it dead and be wrong. The allowlist
 * is small and each line says why.
 */
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { importedFrom, readJson, RUNTIME_DIRS } from './sca-lib.mjs';

/**
 * Runtime-but-not-directly-imported. Each of these was checked by hand, and
 * the reason is recorded so the next person does not have to redo it.
 */
const ALLOWED = {
  next: 'the framework — ib-api is `next start`, and the static sites are its export',
  react: 'the framework — every component in components/ is a React component',
  'react-dom': 'the framework — hydration for the client bundle that ships to ~1,400 pages',
  '@fontsource/ibm-plex-mono': 'consumed via @import in app/globals.css, and its woff2 files are emitted into out/_next/static/media',
};

export default check({
  id: 'sca-prod-dep-placement',
  discipline: 'sca',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: '`dependencies` is what npm ci --omit=dev puts on the droplet; anything there that only the build uses inflates the production attack surface.',
  async run(ctx) {
    const findings = [];
    let manifest;
    try {
      manifest = readJson(join(ctx.repoRoot, 'package.json'));
    } catch (err) {
      throw new ctx.Skip(`cannot read package.json: ${err.message}`);
    }

    const deps = Object.keys(manifest.dependencies || {});
    if (!deps.length) throw new ctx.Skip('package.json declares no dependencies');

    for (const name of deps) {
      if (ALLOWED[name]) continue;
      const hits = importedFrom(ctx.repoRoot, name, RUNTIME_DIRS);
      if (hits.length) continue;

      // Where IS it used? Naming the real call site is what makes this
      // actionable rather than an assertion the reader has to go verify.
      const elsewhere = importedFrom(ctx.repoRoot, name, ['scripts', 'tests', 'e2e']);
      const scriptHits = Object.entries(manifest.scripts || {})
        .filter(([, cmd]) => new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(cmd))
        .map(([k]) => `npm run ${k}`);

      findings.push(finding({
        severity: 'medium',
        title: `${name} is in dependencies but nothing that ships imports it`,
        detail: 'scripts/deploy-api.sh runs `npm ci --omit=dev`, so this package and its whole subtree are installed on the production droplet — next to a service that fetches attacker-supplied URLs — to support code that only ever runs on a laptop.',
        evidence: `package.json dependencies["${name}"] = "${manifest.dependencies[name]}". No import, require, dynamic import or CSS @import of it under ${RUNTIME_DIRS.join('/, ')}/. Referenced instead at: ${[...elsewhere, ...scriptHits].join(', ') || '(nowhere this check looked — scripts/, tests/, e2e/ and the npm scripts)'}.`,
        remediation: `Move ${name} to devDependencies. That shrinks the production closure and takes its transitive install-script surface off the droplet with it.`,
        file: 'package.json',
      }));
    }

    // A stale allowlist entry is the quiet way this check stops checking: the
    // package leaves, the exemption stays, and the name is pre-approved if it
    // ever comes back as something else.
    for (const [name, why] of Object.entries(ALLOWED)) {
      if (deps.includes(name)) continue;
      findings.push(finding({
        severity: 'low',
        title: `Stale exemption in sca-prod-dep-placement: ${name}`,
        detail: `The allowlist still exempts ${name} ("${why}") but it is no longer in package.json dependencies.`,
        evidence: `package.json dependencies: ${deps.join(', ')} — no ${name}.`,
        remediation: 'Remove the entry from ALLOWED in scripts/security/checks/sca-prod-dep-placement.mjs.',
        file: 'scripts/security/checks/sca-prod-dep-placement.mjs',
      }));
    }

    return { findings, checked: deps.length };
  },
});
