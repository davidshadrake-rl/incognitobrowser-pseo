/**
 * lib/adblock-bait — the Ad-Blocker Test must stay honest:
 *
 *   - exactly 50 first-party network baits, every one under /adtest/ with the
 *     generic filter rule it mirrors, so the UI can say WHY a request should
 *     have been blocked
 *   - the generated bait files in public/ exist and carry the right bytes —
 *     a 404 reads as "blocked" and would silently inflate everyone's score
 *   - the score thresholds match the result bus (green ≥ 90 %, amber 50–89 %,
 *     red < 50 %)
 *   - the base-path resolver picks /resources only for the static export
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  NETWORK_BAITS,
  COSMETIC_BAITS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  GIF_1X1_BYTES,
  GIF_1X1_BASE64,
  BAIT_ROOT,
  basePathFrom,
  baitUrl,
  baitScriptSource,
  blockedPercent,
  severityForPercent,
  scoreAdBlocking,
  headlineFor,
  verdictFor,
  summarizeByCategory,
} from '../lib/adblock-bait';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

describe('network bait catalogue', () => {
  it('has exactly 50 baits', () => {
    expect(NETWORK_BAITS).toHaveLength(50);
  });

  it('has unique paths and unique ids', () => {
    expect(new Set(NETWORK_BAITS.map((b) => b.path)).size).toBe(50);
    expect(new Set(NETWORK_BAITS.map((b) => b.id)).size).toBe(50);
  });

  it('keeps every path under /adtest/ with no query, hash or traversal', () => {
    expect(BAIT_ROOT).toBe('/adtest');
    for (const b of NETWORK_BAITS) {
      expect(b.path, b.id).toMatch(/^\/adtest\/[A-Za-z0-9_./-]+$/);
      expect(b.path, b.id).not.toMatch(/\/\.\.?\//);
      expect(b.path, b.id).not.toContain('//');
    }
  });

  it('gives every bait a non-empty rule and label', () => {
    for (const b of NETWORK_BAITS) {
      expect(typeof b.rule, b.id).toBe('string');
      expect(b.rule.trim().length, b.id).toBeGreaterThan(0);
      expect(b.rule, b.id).toMatch(/^\//); // generic path rule, never a ||host anchor
      expect(b.label.trim().length, b.id).toBeGreaterThan(0);
    }
  });

  it('marks every bait as script or image, matching its file extension', () => {
    for (const b of NETWORK_BAITS) {
      expect(['script', 'image'], b.id).toContain(b.kind);
      if (b.kind === 'script') expect(b.path, b.id).toMatch(/\.js$/);
      else expect(b.path, b.id).toMatch(/\.gif$/); // every image is a GIF89a
    }
    expect(NETWORK_BAITS.filter((b) => b.kind === 'script').length).toBeGreaterThanOrEqual(25);
    expect(NETWORK_BAITS.filter((b) => b.kind === 'image').length).toBeGreaterThanOrEqual(10);
  });

  it('files every bait under one of the four categories, each with at least five baits', () => {
    expect(CATEGORY_ORDER).toEqual(['ads', 'analytics', 'social', 'beacons']);
    for (const b of NETWORK_BAITS) expect(CATEGORY_ORDER, b.id).toContain(b.category);
    for (const c of CATEGORY_ORDER) {
      expect(NETWORK_BAITS.filter((b) => b.category === c).length, c).toBeGreaterThanOrEqual(5);
      expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0);
    }
  });

  it('uses ids that are safe inside the marker script', () => {
    for (const b of NETWORK_BAITS) expect(b.id).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('cosmetic bait catalogue', () => {
  it('has at least 10 unique class names, each with its generic hiding rule', () => {
    expect(COSMETIC_BAITS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(COSMETIC_BAITS.map((c) => c.className)).size).toBe(COSMETIC_BAITS.length);
    for (const c of COSMETIC_BAITS) {
      expect(c.className).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(c.rule).toBe(`##.${c.className}`);
      expect(c.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('scoring', () => {
  it('rounds the blocked percentage and never produces NaN', () => {
    expect(blockedPercent(50, 50)).toBe(100);
    expect(blockedPercent(47, 50)).toBe(94);
    expect(blockedPercent(1, 3)).toBe(33);
    expect(blockedPercent(0, 50)).toBe(0);
    expect(blockedPercent(3, 0)).toBe(0);
    expect(blockedPercent(60, 50)).toBe(100); // clamped
  });

  it('maps percentages to the site-wide severities: green ≥ 90, amber 50–89, red < 50', () => {
    expect(severityForPercent(100)).toBe('green');
    expect(severityForPercent(90)).toBe('green');
    expect(severityForPercent(89)).toBe('amber');
    expect(severityForPercent(50)).toBe('amber');
    expect(severityForPercent(49)).toBe('red');
    expect(severityForPercent(0)).toBe('red');
  });

  it('scores several blocked counts out of 50 at the thresholds', () => {
    expect(scoreAdBlocking(50, 50)).toEqual({ blocked: 50, allowed: 0, total: 50, percent: 100, severity: 'green' });
    expect(scoreAdBlocking(45, 50)).toEqual({ blocked: 45, allowed: 5, total: 50, percent: 90, severity: 'green' });
    expect(scoreAdBlocking(44, 50)).toEqual({ blocked: 44, allowed: 6, total: 50, percent: 88, severity: 'amber' });
    expect(scoreAdBlocking(25, 50)).toEqual({ blocked: 25, allowed: 25, total: 50, percent: 50, severity: 'amber' });
    expect(scoreAdBlocking(24, 50)).toEqual({ blocked: 24, allowed: 26, total: 50, percent: 48, severity: 'red' });
    expect(scoreAdBlocking(0, 50)).toEqual({ blocked: 0, allowed: 50, total: 50, percent: 0, severity: 'red' });
    expect(scoreAdBlocking(0, 0)).toEqual({ blocked: 0, allowed: 0, total: 0, percent: 0, severity: 'red' });
  });

  it('writes the headline as the visitor’s own number', () => {
    expect(headlineFor(scoreAdBlocking(19, 50))).toBe('Your browser let 31 of 50 ad and tracker requests through');
    expect(headlineFor(scoreAdBlocking(50, 50))).toBe('Your browser blocked all 50 ad and tracker requests');
    expect(headlineFor(scoreAdBlocking(0, 50))).toBe('Your browser let 50 of 50 ad and tracker requests through');
  });

  it('gives a distinct verdict for perfect, strong, partial, weak and absent blocking', () => {
    const perfect = verdictFor(scoreAdBlocking(50, 50), 12, 12);
    const strong = verdictFor(scoreAdBlocking(47, 50), 9, 12);
    const partial = verdictFor(scoreAdBlocking(30, 50), 0, 12);
    const weak = verdictFor(scoreAdBlocking(5, 50), 0, 12);
    const none = verdictFor(scoreAdBlocking(0, 50), 0, 12);
    expect(perfect).toMatch(/every one of the 50/);
    expect(strong).toMatch(/47 of 50/);
    expect(strong).toMatch(/9 of 12/);
    expect(partial).toMatch(/20 of 50 .* got through/);
    expect(partial).toMatch(/EasyPrivacy/);
    expect(weak).toMatch(/45 of 50/);
    expect(none).toMatch(/No ad blocking detected/);
    expect(none).toMatch(/DNS-level/);
    expect(new Set([perfect, strong, partial, weak, none]).size).toBe(5);
    expect(verdictFor(scoreAdBlocking(0, 0), 0, 0)).toMatch(/No requests/);
  });

  it('summarises blocked counts per category in display order, totalling 50', () => {
    const ads = NETWORK_BAITS.filter((b) => b.category === 'ads').map((b) => b.id);
    const summary = summarizeByCategory([...ads, 'gtm', 'pixel-gif', 'not-a-bait']);
    expect(summary.map((s) => s.category)).toEqual(['ads', 'analytics', 'social', 'beacons']);
    expect(summary.reduce((n, s) => n + s.total, 0)).toBe(50);
    expect(summary[0]).toEqual({ category: 'ads', label: CATEGORY_LABELS.ads, blocked: ads.length, total: ads.length });
    expect(summary[1].blocked).toBe(1);
    expect(summary[2].blocked).toBe(0);
    expect(summary[3].blocked).toBe(1);
    expect(summarizeByCategory([]).every((s) => s.blocked === 0)).toBe(true);
  });
});

describe('basePathFrom', () => {
  it('uses no prefix on server-mode routes', () => {
    expect(basePathFrom('/tools/x/y')).toBe('');
    expect(basePathFrom('/tools/x/y/')).toBe('');
    expect(basePathFrom('/')).toBe('');
    expect(basePathFrom('')).toBe('');
  });

  it('uses /resources for the static export, including the bare hub', () => {
    expect(basePathFrom('/resources/tools/x/y/')).toBe('/resources');
    expect(basePathFrom('/resources/tools/x/y')).toBe('/resources');
    expect(basePathFrom('/resources')).toBe('/resources');
    expect(basePathFrom('/resources/')).toBe('/resources');
  });

  it('does not mistake a look-alike prefix for the base path', () => {
    expect(basePathFrom('/resourcesx/tools')).toBe('');
    expect(basePathFrom('/tools/resources/y')).toBe('');
  });
});

describe('probe URLs and script payload', () => {
  it('builds base + path + cache-buster', () => {
    expect(baitUrl('', { path: '/adtest/gtm.js' }, 123)).toBe('/adtest/gtm.js?v=123');
    expect(baitUrl('/resources', { path: '/adtest/pixel.gif' }, 'abc')).toBe('/resources/adtest/pixel.gif?v=abc');
  });

  it('marks the window with the bait id and nothing else', () => {
    expect(baitScriptSource('gtm')).toBe("window.__adtest=(window.__adtest||{});window.__adtest['gtm']=1;");
    expect(baitScriptSource('gtm')).not.toMatch(/fetch|XMLHttpRequest|document\.|location/);
  });
});

describe('generated bait files in public/adtest', () => {
  const gif = Buffer.from(GIF_1X1_BYTES);

  it('defines the canonical 43-byte GIF89a', () => {
    expect(gif).toHaveLength(43);
    expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(gif[42]).toBe(0x3b);
    expect(Buffer.from(GIF_1X1_BASE64, 'base64').equals(gif)).toBe(true);
  });

  for (const b of NETWORK_BAITS) {
    it(`${b.path} exists and is a ${b.kind === 'script' ? 'marker script' : '1×1 GIF'}`, () => {
      const file = path.join(PUBLIC_DIR, b.path);
      expect(fs.existsSync(file), `${b.path} is missing — run: npx tsx scripts/gen-adtest-bait.mjs`).toBe(true);
      if (b.kind === 'script') {
        expect(fs.readFileSync(file, 'utf8').trim()).toBe(baitScriptSource(b.id));
      } else {
        expect(fs.readFileSync(file).equals(gif)).toBe(true);
      }
    });
  }

  it('contains no files that are not in the catalogue', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push('/' + path.relative(PUBLIC_DIR, full).split(path.sep).join('/'));
      }
      return out;
    };
    const onDisk = walk(path.join(PUBLIC_DIR, 'adtest')).sort();
    expect(onDisk).toEqual([...NETWORK_BAITS.map((b) => b.path)].sort());
  });
});
