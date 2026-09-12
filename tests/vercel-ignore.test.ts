/**
 * scripts/vercel-ignore.sh — the Vercel "Ignored Build Step".
 *
 * Both Vercel projects build from this repo, and every kept build counts
 * toward Deployment Storage (the free team hit its 10 GB on 2026-09-11). The
 * Pro deployment renders only Pro tool pages, so a commit that touches only
 * free-site content must not rebuild it. Getting this wrong either wastes
 * storage (never skipping) or ships a stale Pro site (skipping too much), so
 * the exit codes are pinned here: 0 = skip, 1 = build.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(process.cwd(), 'scripts', 'vercel-ignore.sh');
let repo: string;

const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
const commit = (files: Record<string, string>, message: string) => {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  git(['add', '-A']);
  git(['-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
};
/** The exit code Vercel would see: 0 skip, 1 build. */
function run(tier?: string): number {
  try {
    execFileSync('bash', [SCRIPT], { cwd: repo, env: { ...process.env, NEXT_PUBLIC_TIER: tier ?? '' }, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-step-'));
  git(['init', '-q', '-b', 'main']);
  commit({ 'lib/x.ts': 'export const a = 1;\n', 'data/guides/n/g.json': '{"a":1}\n' }, 'first');
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('the Pro build is skipped only when nothing it renders changed', () => {
  it('skips Pro when a commit touches only free-site content', () => {
    commit({ 'data/guides/n/g.json': '{"a":2}\n' }, 'content only');
    expect(run('pro')).toBe(0);
  });

  it('builds the free project for that same commit', () => {
    expect(run(undefined)).toBe(1);
    expect(run('free')).toBe(1);
  });

  it('builds Pro when code changes', () => {
    commit({ 'lib/x.ts': 'export const a = 2;\n' }, 'code');
    expect(run('pro')).toBe(1);
  });

  it('builds Pro when tool data, taxonomy or a public asset changes', () => {
    commit({ 'data/tools/n/t.json': '{"t":1}\n' }, 'tool data');
    expect(run('pro')).toBe(1);
    commit({ 'data/taxonomy.json': '{"t":2}\n' }, 'taxonomy');
    expect(run('pro')).toBe(1);
    commit({ 'public/adtest/x.js': '// x\n' }, 'public asset');
    expect(run('pro')).toBe(1);
  });

  it('builds Pro when content changes alongside code', () => {
    commit({ 'data/guides/n/g.json': '{"a":3}\n', 'lib/x.ts': 'export const a = 3;\n' }, 'both');
    expect(run('pro')).toBe(1);
  });

  it('builds Pro when there is no parent commit to compare with', () => {
    const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-step-root-'));
    const prev = repo;
    repo = shallow;
    git(['init', '-q', '-b', 'main']);
    commit({ 'data/guides/n/g.json': '{"a":1}\n' }, 'root');
    expect(run('pro')).toBe(1);
    fs.rmSync(shallow, { recursive: true, force: true });
    repo = prev;
  });
});
