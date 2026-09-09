import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * Commit-attribution guard.
 *
 * Every commit in this repo must be attributed to the project owner. Git falls
 * back to a machine-wide default identity when a clone has no local override,
 * so a fresh clone on a shared or multi-project machine can silently commit
 * under whatever that default happens to be.
 *
 * This is an allowlist: it asserts commits carry a known Radius Labs identity,
 * rather than enumerating identities to exclude. `npm run build` runs vitest
 * first, so a misattributed commit cannot reach a deployment.
 *
 * If this fails, fix the identity — never the assertion:
 *   git config --local user.name  "davidshadrake-rl"
 *   git config --local user.email "david@radiuslabs.com"
 */

const ALLOWED_EMAILS = ['david@radiuslabs.com', 'davidshadrake-rl@users.noreply.github.com'];
const COMMIT_EMAIL = 'david@radiuslabs.com';

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const insideRepo = git('rev-parse --is-inside-work-tree') === 'true';

describe.runIf(insideRepo)('repo identity', () => {
  it('every commit is attributed to a known Radius Labs identity', () => {
    const entries = git('log --format=%ae%n%ce')
      .split('\n')
      .map((e) => e.trim())
      .filter(Boolean);

    const foreign = [...new Set(entries.filter((e) => !ALLOWED_EMAILS.includes(e)))];

    expect(
      foreign,
      `Commits are attributed to an identity that does not belong to this project.\n` +
        `Set the identity, then rewrite the offending commits before pushing:\n` +
        `  git config --local user.email "${COMMIT_EMAIL}"\n` +
        `Unrecognised: ${foreign.join(', ')}`,
    ).toEqual([]);
  });

  it('this clone is configured to commit as Radius Labs, when an identity is set', () => {
    // CI clones carry no user config; there is nothing to assert there.
    const email = git('config user.email');
    if (!email) return;

    expect(
      email,
      `This clone would commit as "${email}". Set the local override:\n` +
        `  git config --local user.name  "davidshadrake-rl"\n` +
        `  git config --local user.email "${COMMIT_EMAIL}"`,
    ).toBe(COMMIT_EMAIL);
  });
});
