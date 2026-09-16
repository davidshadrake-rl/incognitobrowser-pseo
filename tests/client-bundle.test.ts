/**
 * The funnel plan stays off visitors' browsers.
 *
 * data/funnels.json is every page's funnel — the internal plan, about 2 MB.
 * Pages render their own piece of it on the server; the browser must never
 * receive the whole thing. A single value import of lib/funnels.ts from a
 * client component (FunnelSurfaces imported isV2 from it) bundled all of it
 * into the JavaScript of every glossary and tool page, 500 KB gzipped, readable
 * by anyone (2026-09-16). Client code imports lib/funnel-types.ts instead.
 *
 * Runs against a static export in out/; skipped when there isn't one.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'out', '_next', 'static');
const HAS_BUILD = fs.existsSync(OUT);

const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));

describe.skipIf(!HAS_BUILD)('client JavaScript', () => {
  it('carries no page funnel beyond the one a page renders itself', () => {
    const funnels = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'funnels.json'), 'utf-8')) as Record<string, { step2?: { heading: string }; stakes?: string }>;
    // Distinctive lines from many pages: if the data file is bundled, all of them are in one chunk.
    const probes = Object.values(funnels)
      .map((f) => f.step2?.heading ?? f.stakes ?? '')
      .filter((t) => t.length > 40)
      .slice(0, 25);
    expect(probes.length).toBeGreaterThan(10);
    const leaks: string[] = [];
    for (const file of walk(OUT)) {
      const js = fs.readFileSync(file, 'utf-8');
      const found = probes.filter((p) => js.includes(JSON.stringify(p).slice(1, -1)) || js.includes(p));
      if (found.length > 3) leaks.push(`${path.relative(OUT, file)} holds ${found.length} pages' funnels`);
    }
    expect(leaks).toEqual([]);
  });
});
