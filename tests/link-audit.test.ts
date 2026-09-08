/**
 * Whole-build same-site link audit (free static export).
 *
 * Every href that starts with "/" on every built page must resolve to a page
 * in the same build. This is the generic form of the free/Pro guard: a tool
 * page that moved to the other deployment, a hub that lost all its items, a
 * typo in a generated path — all show up here as a dangling target.
 *
 * Skips when out/ is absent (Vercel runs vitest before next build). The Pro
 * build is audited by the same script in the release chain:
 *   node scripts/audit-links.mjs <pro .next/server/app> --mode server
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'out');

describe.skipIf(!fs.existsSync(OUT_DIR))('link audit — free static export', () => {
  it('has zero dangling same-site links across the whole build', () => {
    const r = spawnSync(process.execPath, ['scripts/audit-links.mjs', OUT_DIR, '--mode', 'static', '--base', '/resources'], { encoding: 'utf-8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/0 dangling targets/);
  }, 120_000);
});
