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
import { PLAY_PROOF } from '../lib/card-copy';

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

  it('PLAY_PROOF is built from those figures, and states nothing else', () => {
    const { rating, reviewsLabel, downloadsLabel, dataSafety } = brand.play;
    expect(PLAY_PROOF).toContain(`★ ${rating}`);
    expect(PLAY_PROOF).toContain(reviewsLabel);
    expect(PLAY_PROOF).toContain(downloadsLabel);
    expect(PLAY_PROOF.toLowerCase()).toContain(dataSafety.toLowerCase());
    // Every number on the line is one of brand.json's.
    const rest = [rating, reviewsLabel, downloadsLabel].reduce((s, v) => s.replace(v, ''), PLAY_PROOF);
    expect(rest).not.toMatch(/\d/);
  });

  it('no aggregateRating anywhere in app/, components/ or lib/', () => {
    const offenders = ['app', 'components', 'lib'].flatMap((d) => walk(d)).filter((f) => /aggregate\s*rating/i.test(fs.readFileSync(path.join(ROOT, f), 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
