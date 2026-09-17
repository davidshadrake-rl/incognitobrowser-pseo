/**
 * The Google Play proof under every upgrade button (lib/card-copy.ts
 * PLAY_PROOF). A rating and a download count are true only on the day
 * someone read the listing, so data/brand.json `play` carries that day and
 * this fails once it is more than 90 days old: re-read the listing, update
 * the figures and checkedOn. The proof is visible text only; an
 * aggregateRating in structured data is a brand.json never-claim.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import brand from '../data/brand.json';
import { DATA_SAFETY_URL, PLAY_PROOF } from '../lib/card-copy';

const ROOT = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(rel, out);
    } else if (/\.(tsx?|jsx?|mjs|json)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe('Google Play proof', () => {
  it('brand.json play has the rating, reviews, downloads, data safety line and the day they were read', () => {
    const { rating, reviewsLabel, downloadsLabel, dataSafety, checkedOn } = brand.play;
    expect(rating).toMatch(/^\d\.\d$/);
    expect(reviewsLabel).toMatch(/\breviews$/);
    expect(downloadsLabel).toMatch(/\bdownloads$/);
    expect(dataSafety.trim()).not.toBe('');
    expect(checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('was read from the listing in the last 90 days', () => {
    const read = Date.parse(`${brand.play.checkedOn}T00:00:00Z`);
    const age = Math.floor((new Date().getTime() - read) / DAY);
    expect(age, `brand.json play.checkedOn is ${brand.play.checkedOn}: re-read the Google Play listing`).toBeLessThanOrEqual(90);
    expect(age, 'play.checkedOn is in the future').toBeGreaterThanOrEqual(-1);
  });

  it('PLAY_PROOF is built from those figures and the month they were read, and states nothing else', () => {
    const { rating, reviewsLabel, downloadsLabel, checkedOn } = brand.play;
    const month = new Date(`${checkedOn}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    expect(PLAY_PROOF).toBe(`Google Play, ${month}: ★ ${rating} · ${reviewsLabel} · ${downloadsLabel}`);
    // Every number on the line is one of brand.json's, or the year it was read.
    const rest = [rating, reviewsLabel, downloadsLabel, month].reduce((s, v) => s.replace(v, ''), PLAY_PROOF);
    expect(rest).not.toMatch(/\d/);
  });

  it('links Google Play\'s own Data safety page instead of quoting one line of it', () => {
    expect(DATA_SAFETY_URL).toBe('https://play.google.com/store/apps/datasafety?id=com.androidbull.incognito.browser');
    expect(PLAY_PROOF.toLowerCase()).not.toContain('third parties');
    const card = fs.readFileSync(path.join(ROOT, 'components', 'tools', 'ResultCard.tsx'), 'utf-8');
    expect(card).toMatch(/href=\{DATA_SAFETY_URL\}/);
  });

  it('no aggregateRating anywhere in app/, components/ or lib/', () => {
    const offenders = ['app', 'components', 'lib'].flatMap((d) => walk(d)).filter((f) => /aggregate\s*rating/i.test(fs.readFileSync(path.join(ROOT, f), 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
