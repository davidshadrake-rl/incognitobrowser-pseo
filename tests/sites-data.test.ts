/**
 * data/sites — the 500 report cards are files whose names become URL paths.
 * Pins: lowercase, no "www.", filename == domain field, no case-duplicates.
 * (Two cards once shipped as Princeton.EDU and WWW.garmin.com — audit 2026-09-08.)
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'data', 'sites');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('data/sites filenames and domains', () => {
  it('has the expected number of cards', () => {
    expect(files.length).toBeGreaterThanOrEqual(500);
  });
  it('every filename is lowercase, has no www. prefix, and matches its domain field', () => {
    for (const f of files) {
      expect(f, f).toMatch(/^[a-z0-9.-]+\.json$/);
      expect(f.startsWith('www.'), f).toBe(false);
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as { domain: string };
      expect(j.domain, f).toBe(f.replace(/\.json$/, ''));
    }
  });
  it('has no case-insensitive duplicate domains', () => {
    const seen = new Map<string, string>();
    for (const f of files) {
      const k = f.toLowerCase();
      expect(seen.has(k), `${f} duplicates ${seen.get(k)}`).toBe(false);
      seen.set(k, f);
    }
  });
});
