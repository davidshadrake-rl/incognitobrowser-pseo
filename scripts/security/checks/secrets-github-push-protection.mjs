/**
 * The only backstop in this discipline that cannot be walked past.
 *
 * Added because review was right that it was missing, and right about why it
 * matters more than everything local. Every other guard here runs on someone's
 * laptop: the pre-commit hook lives in .git/hooks, which is untracked and
 * machine-local (scripts/install-git-hooks.sh says so), and `git commit
 * --no-verify` skips it. The unit suite only runs when someone runs it. GitHub
 * push protection runs on GitHub, on every push, from every clone, for everyone
 * — and on a public repository it is free and on by default.
 *
 * "On by default" is exactly why it deserves a check rather than an assumption.
 * It is also off by one click in the repository settings, and nobody would
 * notice until the day it mattered.
 *
 * Read-only: one GET against the GitHub API for this repository's own settings.
 * No canary commit — publishing a real-looking credential to a public repo to
 * test somebody else's control is never an acceptable trade.
 */
import { execFileSync } from 'node:child_process';
import { check, finding, Skip } from '../lib/harness.mjs';

/** Owner/name from the origin remote, for https and ssh remotes alike. */
function repoSlug(repoRoot) {
  let url;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    throw new Skip('no git remote named origin');
  }
  const m = /github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Skip(`origin is not a github.com remote: ${url}`);
  return `${m[1]}/${m[2]}`;
}

export default check({
  id: 'secret-github-push-protection',
  discipline: 'secrets',
  cadence: 'weekly',
  severity: 'high',
  safeAgainstProd: true,
  // Nothing to do with the droplet: this talks to api.github.com, not to the
  // 2-vCPU box, so it puts no load anywhere that matters.
  needsOptIn: false,
  requires: ['network', 'git'],
  describe: 'GitHub secret scanning and push protection are still enabled on this public repository.',
  async run(ctx) {
    let gh;
    try {
      gh = execFileSync('gh', ['--version'], { encoding: 'utf-8' }).split('\n')[0];
    } catch {
      throw new Skip('gh not installed: brew install gh (then `gh auth login`)');
    }

    const slug = repoSlug(ctx.repoRoot);
    let raw;
    try {
      raw = execFileSync('gh', ['api', `repos/${slug}`], { encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      const msg = `${err.stderr || err.stdout || err.message}`.trim().slice(0, 200);
      throw new Skip(`gh api repos/${slug} failed (${gh}): ${msg}`);
    }

    let repo;
    try { repo = JSON.parse(raw); } catch { throw new Skip('gh api returned something that is not JSON'); }

    const sec = repo.security_and_analysis || {};
    const findings = [];
    let checked = 0;

    // On a PRIVATE repo these features are a paid add-on and being off is a
    // billing fact, not a security lapse. Say so and stop, rather than filing a
    // finding nobody can act on.
    if (repo.private) {
      return {
        checked: 1,
        findings: [finding({
          severity: 'info',
          title: `${slug} is private — GitHub secret scanning is a paid feature here`,
          detail:
            'This check grades the free, on-by-default protections that public repositories get. The repository is private, so those do not apply '
            + 'and the local guards in this discipline are the whole story.',
          evidence: `gh api repos/${slug} → private: true, security_and_analysis: ${JSON.stringify(sec)}`,
          remediation: 'None, unless GitHub Advanced Security is on the plan — in which case enable secret scanning and push protection and update this check.',
        })],
      };
    }

    const GRADED = [
      {
        key: 'secret_scanning_push_protection',
        severity: 'high',
        title: 'GitHub push protection is not enabled',
        detail:
          'Push protection is what refuses the push that carries a credential, at the server, from any clone, whether or not the local hook ran and whether or not someone used --no-verify. '
          + 'This repository is public: without it, the first push containing a key publishes it, and rotation is the only remedy.',
        remediation: `Settings → Code security → Push protection, or: gh api -X PATCH repos/${slug} -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'`,
      },
      {
        key: 'secret_scanning',
        severity: 'high',
        title: 'GitHub secret scanning is not enabled',
        detail:
          'Secret scanning is the retrospective half: it sweeps history and alerts on what is already committed. Push protection blocks the new; this finds the old. '
          + 'Both are free on a public repository.',
        remediation: `Settings → Code security → Secret scanning, or: gh api -X PATCH repos/${slug} -f 'security_and_analysis[secret_scanning][status]=enabled'`,
      },
      {
        key: 'secret_scanning_non_provider_patterns',
        severity: 'low',
        title: 'GitHub scanning for non-provider patterns is off',
        detail:
          'Provider patterns only match credentials with a recognisable prefix — sk-ant-, ghp_, AKIA. Two of the three secrets that actually gate this system have no prefix at all: '
          + 'ALTCHA_HMAC_KEY and STATS_TOKEN are generated with `openssl rand -hex 32` (API-ON-DROPLET.md), so they look like any other hex blob. '
          + 'Non-provider patterns are the setting that would notice one of those being committed. Low rather than high because it is noisier and this repo has other hex in it, '
          + 'but it is the difference between catching the two secrets that matter most and catching neither.',
        remediation: `Settings → Code security → Secret scanning → "Non-provider patterns", or: gh api -X PATCH repos/${slug} -f 'security_and_analysis[secret_scanning_non_provider_patterns][status]=enabled'`,
      },
    ];

    for (const g of GRADED) {
      checked += 1;
      const status = sec[g.key] ? sec[g.key].status : '(absent from the API response)';
      if (status === 'enabled') continue;
      findings.push(finding({
        severity: g.severity,
        title: g.title,
        detail: g.detail,
        evidence: `gh api repos/${slug} → private: false, security_and_analysis.${g.key}.status = ${status}`,
        remediation: g.remediation,
      }));
    }

    return { checked, findings };
  },
});
