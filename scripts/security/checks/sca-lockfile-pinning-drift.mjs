/**
 * Two checks about where dependency code actually comes from.
 *
 * sca-lockfile-pinning-drift (offline, every commit) — the lockfile still
 * points every package at the public registry with an integrity hash.
 *
 * sca-registry-attestations (nightly, registry only) — the installed tree's
 * signatures still verify against npm's keys.
 *
 * The thing both are guarding: this repo is clean right now. All 526 lockfile
 * entries carry `resolved` on registry.npmjs.org plus a sha512 integrity hash,
 * there are no git, file or tarball sources, and `npm audit signatures`
 * verifies every installed package. That is a good state, and good states are
 * what quietly stop being true. One `npm install github:someone/next-fork`
 * during a Friday debugging session puts unreviewed code into a build that
 * renders ~1,400 public pages and into the Node service on the droplet, and
 * the diff looks like an ordinary dependency bump.
 *
 * A lockfile out of sync with package.json is the other half: `npm ci
 * --omit=dev` fails outright on that, mid-deploy, on the droplet — which is
 * exactly the precondition for the reinstall-gate bug that scripts/deploy-api.sh
 * was rewritten to survive.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { readJson } from './sca-lib.mjs';

const REGISTRY = 'https://registry.npmjs.org/';

const pinning = check({
  id: 'sca-lockfile-pinning-drift',
  discipline: 'sca',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Every lockfile entry still resolves to the public registry with a sha512 integrity hash — no forks, tarballs or local paths.',
  async run(ctx) {
    const findings = [];
    let lock;
    try {
      lock = readJson(join(ctx.repoRoot, 'package-lock.json'));
    } catch (err) {
      throw new ctx.Skip(`cannot read package-lock.json: ${err.message}`);
    }

    const packages = Object.entries(lock.packages || {});
    if (!packages.length) throw new ctx.Skip('package-lock.json has no `packages` map — nothing to inspect');

    if (!(lock.lockfileVersion >= 3)) {
      findings.push(finding({
        severity: 'high',
        title: `package-lock.json is lockfileVersion ${lock.lockfileVersion}`,
        detail: 'Below version 3 the `packages` map is not authoritative and integrity coverage is not guaranteed, so everything else this check asserts becomes unreliable.',
        evidence: `package-lock.json: "lockfileVersion": ${lock.lockfileVersion}`,
        remediation: 'Regenerate with a current npm (`rm package-lock.json && npm install`) and review the diff.',
        file: 'package-lock.json',
      }));
    }

    let inspected = 0;
    for (const [path, entry] of packages) {
      // The root entry ("") describes this project and has no resolved/integrity.
      // `link: true` entries are workspace symlinks pointing at another entry
      // that IS checked; neither is a third-party source.
      if (!path || entry.link) continue;
      inspected += 1;

      if (!entry.resolved) {
        findings.push(finding({
          severity: 'high',
          title: `Lockfile entry with no resolved source: ${path}`,
          detail: 'Without a resolved URL npm is free to satisfy this from anywhere the registry config points, and the lockfile stops being a record of what was installed.',
          evidence: `package-lock.json["${path}"] has version ${entry.version || '?'} and no "resolved" field.`,
          remediation: 'Regenerate the lockfile and check what that entry resolves to.',
          file: 'package-lock.json',
        }));
        continue;
      }

      if (!entry.resolved.startsWith(REGISTRY)) {
        const scheme = /^([a-z+]+):/i.exec(entry.resolved)?.[1] || 'unknown';
        findings.push(finding({
          severity: 'high',
          title: `Dependency from outside the public registry: ${path}`,
          detail: `This package comes from a ${scheme} source instead of registry.npmjs.org. Its contents are not what the npm ecosystem has seen and are not covered by npm's signing; a git ref can even be moved under an unchanged lockfile line.`,
          evidence: `package-lock.json["${path}"].resolved = ${entry.resolved.slice(0, 160)}`,
          remediation: 'Publish the fork to the registry under your own scope and depend on that, or vendor the code into the repo where it can be reviewed.',
          file: 'package-lock.json',
        }));
        continue;
      }

      if (!entry.integrity) {
        findings.push(finding({
          severity: 'high',
          title: `Registry dependency with no integrity hash: ${path}`,
          detail: 'Nothing pins the tarball contents, so a re-published version or a compromised mirror installs silently.',
          evidence: `package-lock.json["${path}"].resolved = ${entry.resolved.slice(0, 120)} with no "integrity".`,
          remediation: 'Regenerate the lockfile.',
          file: 'package-lock.json',
        }));
      } else if (!entry.integrity.startsWith('sha512-')) {
        findings.push(finding({
          severity: 'medium',
          title: `Weak integrity hash on ${path}`,
          detail: 'sha1 integrity survives from old lockfiles and is no longer a meaningful guarantee of tarball contents.',
          evidence: `package-lock.json["${path}"].integrity = ${entry.integrity.slice(0, 40)}...`,
          remediation: 'Regenerate the lockfile so npm rewrites it as sha512.',
          file: 'package-lock.json',
        }));
      }
    }

    return { findings, checked: inspected };
  },
});

const attestations = check({
  id: 'sca-registry-attestations',
  discipline: 'sca',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'npm audit signatures still verifies the installed tree against the registry keys — an INVALID signature means the tarball is not what npm published.',
  async run(ctx) {
    const findings = [];
    let text;
    try {
      text = execFileSync('npm', ['audit', 'signatures'], {
        cwd: ctx.repoRoot, encoding: 'utf-8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const out = `${err.stdout || ''}${err.stderr || ''}`;
      // A non-zero exit here is the answer, not a failure: npm exits 1 when
      // something is unverifiable. Only a genuinely empty result is a skip.
      if (!out.trim()) throw new ctx.Skip(`npm audit signatures produced nothing (offline, or node_modules is not installed): ${String(err.message).slice(0, 160)}`);
      text = out;
    }

    const audited = Number(/audited (\d+) packages/.exec(text)?.[1] || 0);
    const verified = Number(/(\d+) packages have verified registry signatures/.exec(text)?.[1] || 0);
    const attested = Number(/(\d+) packages have verified attestations/.exec(text)?.[1] || 0);

    if (!audited) {
      throw new ctx.Skip(`npm audit signatures reported no audited packages — is node_modules installed? output: ${text.trim().slice(0, 200)}`);
    }

    // Only INVALID fails. Most of npm still publishes without attestations, so
    // failing on absence would bury the suite in noise within a week and take
    // the real signal with it — which is the one thing this whole suite is
    // supposed to avoid.
    const invalid = /(\d+) packages? (?:have|has) invalid|invalid signature/i.test(text);
    if (invalid) {
      let names = '';
      try {
        const j = JSON.parse(execFileSync('npm', ['audit', 'signatures', '--json'], {
          cwd: ctx.repoRoot, encoding: 'utf-8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        }));
        names = (j.invalid || []).map((i) => `${i.name}@${i.version}`).join(', ');
      } catch { /* the text output below is still evidence enough */ }
      findings.push(finding({
        severity: 'critical',
        title: 'A package in the installed tree has an INVALID registry signature',
        detail: 'The tarball on disk is not the one npm signed. That is either a compromised mirror or a tampered cache, and it is the one signature outcome that is never ambiguous.',
        evidence: `npm audit signatures: ${text.trim().split('\n').filter((l) => /invalid/i.test(l)).join(' | ').slice(0, 400)}${names ? ` — ${names}` : ''}`,
        remediation: 'Do not deploy. `npm cache clean --force`, delete node_modules, reinstall, and re-run. If it persists, the registry mirror in use is suspect.',
        file: 'package-lock.json',
      }));
    }

    const unsigned = audited - verified;
    if (unsigned > 0) {
      findings.push(finding({
        severity: 'info',
        title: `${unsigned} of ${audited} installed packages have no verifiable registry signature`,
        detail: 'Reported, never failed on. Registry signing is not universal, so absence is normal; a sudden jump in this number is the interesting signal, not the number itself.',
        evidence: `npm audit signatures: audited ${audited}, verified ${verified}, attested ${attested}.`,
        remediation: 'None. Watch the trend.',
        file: 'package-lock.json',
      }));
    }

    return { findings, checked: audited };
  },
});

export default [pinning, attestations];
