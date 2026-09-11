/**
 * The comparison rubric (lib/comparison-score.ts), the page that shows it
 * (components/ComparisonPage.tsx), and the rules every file in
 * data/comparisons must meet. Owner decision, 2026-09-10: "Disclose + verified
 * facts. 'We make Incognito Browser' at the top. Its rows use only verified
 * features. Drop it where it isn't comparable. Score every product on one
 * published rubric, so it can lose."
 *
 * The data rules at the end are what make the methodology page's statements
 * about Incognito Browser true: IB_BACKING (a cell only credits a documented
 * feature), NOT_A_BROWSER_CRITERION (otherwise every criterion is assessed,
 * 'no' when unbacked), IB_COMPARABLE (left out where it isn't comparable) and
 * the slug check (so the disclosure always renders).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CELL_LABEL,
  ComparisonTableError,
  METHODOLOGY_PATH,
  NOT_ASSESSED,
  OUR_PRODUCT_SLUG,
  POINTS,
  UnknownCellValueError,
  cellFor,
  checkTable,
  compareByName,
  formatRating,
  includesOurProduct,
  pointsFor,
  readCell,
  scoreProducts,
  toComparisonView,
  type ComparisonSource,
  type ProductScore,
  type RatedValue,
  type ScoreInput,
} from '@/lib/comparison-score';
import { ComparisonPage } from '@/components/ComparisonPage';

const ROOT = path.join(__dirname, '..');

// --- helpers ---------------------------------------------------------------

type Cell = string | undefined; // undefined = no cell at all

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** A table from columns: { 'Product name': [cell per criterion] }. */
function table(columns: Record<string, Cell[]>, extra: Partial<Record<string, object>> = {}): ScoreInput {
  const names = Object.keys(columns);
  const criteria = Math.max(0, ...names.map((n) => columns[n].length));
  return {
    products: names.map((name) => ({ name, slug: slugOf(name), ...(extra[name] ?? {}) })),
    features: Array.from({ length: criteria }, (_, i) => ({
      name: `Criterion ${i + 1}`,
      scores: Object.fromEntries(
        names.flatMap((n) => (columns[n][i] === undefined ? [] : [[slugOf(n), { value: columns[n][i] }]])),
      ),
    })),
  };
}

function ratingOf(data: ScoreInput, name: string): number | null {
  const s = scoreProducts(data).find((p) => p.name === name);
  if (!s) throw new Error(`no product ${name}`);
  return s.rating;
}

const order = (data: ScoreInput) => scoreProducts(data).map((s) => s.name);

/** Quarter-point → a value worth exactly that many quarters. */
const BY_QUARTERS = ['no', 'poor', 'partial', 'good', 'yes'] as const;

// --- points ----------------------------------------------------------------

describe('cell values → points', () => {
  it('uses exactly the published points', () => {
    expect(POINTS).toEqual({
      yes: 1, excellent: 1, good: 0.75, partial: 0.5, fair: 0.5, limited: 0.5, poor: 0.25, no: 0, none: 0,
    });
    for (const v of Object.keys(POINTS)) expect(CELL_LABEL[v as keyof typeof POINTS]).toBeTruthy();
  });

  it('reads values regardless of case and surrounding spaces', () => {
    expect(readCell(' Yes ')).toBe('yes');
    expect(readCell('EXCELLENT')).toBe('excellent');
    expect(readCell('Limited')).toBe('limited');
    expect(pointsFor('Good')).toBe(0.75);
    expect(pointsFor('none')).toBe(0);
  });

  it("treats '—', 'unknown', 'n/a' or no value as not assessed", () => {
    expect([...NOT_ASSESSED]).toEqual(['—', 'unknown', 'n/a']);
    for (const v of ['—', '-', '–', 'unknown', 'Unknown', 'n/a', 'N/A', undefined, null]) {
      expect(readCell(v), JSON.stringify(v)).toBeNull();
      expect(pointsFor(v), JSON.stringify(v)).toBeNull();
    }
  });

  it('throws on a value outside the rubric instead of quietly leaving it out', () => {
    for (const v of ['maybe', 'partially', 'yes!', 'strong', 5, true, {}]) {
      expect(() => readCell(v), JSON.stringify(v)).toThrow(UnknownCellValueError);
    }
    const bad = table({ Alpha: ['yes', 'sometimes'] });
    expect(() => scoreProducts(bad)).toThrow(/"sometimes".*product "alpha", criterion "Criterion 2"/);
  });

  it('throws on an empty value: a cleared cell is a mistake, and leaving it out would lift the rating', () => {
    for (const v of ['', '   ']) {
      expect(() => readCell(v), JSON.stringify(v)).toThrow(UnknownCellValueError);
      expect(() => readCell(v), JSON.stringify(v)).toThrow(/is empty/);
    }
    // Read as "not assessed", yes / '' / no would rate 5.0 instead of 3.3.
    expect(ratingOf(table({ Alpha: ['yes', '—', 'no'] }), 'Alpha')).toBe(5);
    expect(() => scoreProducts(table({ Alpha: ['yes', '', 'no'] }))).toThrow(/"" \(product "alpha", criterion "Criterion 2"\) is empty/);
  });
});

// --- the table's keys --------------------------------------------------------

describe('every cell must belong to one product on the page', () => {
  const products = [{ name: 'Alpha', slug: 'alpha' }, { name: 'Beta', slug: 'beta' }];
  const yes = { value: 'yes' };
  const no = { value: 'no' };

  it('throws on a cell under a key that is no product: a mistyped key would drop the cell and lift the rating', () => {
    const typo: ScoreInput = {
      products,
      features: [
        { name: 'A', scores: { alpha: yes, beta: yes } },
        { name: 'B', scores: { alpha: yes, beta: yes } },
        { name: 'C', scores: { alpah: no, beta: no } },
      ],
    };
    expect(() => scoreProducts(typo)).toThrow(ComparisonTableError);
    expect(() => scoreProducts(typo)).toThrow(/Criterion "C" has a cell under "alpah", which is not the slug or name of any product/);
    // Keyed correctly, Alpha rates 6.7; with the cell dropped it would be 10.
    const fixed: ScoreInput = { products, features: typo.features.map((f, i) => (i === 2 ? { name: 'C', scores: { alpha: no, beta: no } } : f)) };
    expect(ratingOf(fixed, 'Alpha')).toBe(6.7);
  });

  it('throws on a stray key even when its cell is null', () => {
    expect(() => checkTable({ products, features: [{ name: 'A', scores: { alpha: yes, beta: yes, gamma: null } }] })).toThrow(/"gamma"/);
  });

  it('throws when a product has a cell under both its slug and its name', () => {
    expect(() => checkTable({ products, features: [{ name: 'A', scores: { alpha: yes, Alpha: no, beta: yes } }] }))
      .toThrow(/Criterion "A" has two cells for "alpha"/);
    // A null under one of the two keys is not a second cell.
    expect(() => checkTable({ products, features: [{ name: 'A', scores: { alpha: null, Alpha: no, beta: yes } }] })).not.toThrow();
  });

  it('throws when two products share a slug', () => {
    expect(() => checkTable({ products: [...products, { name: 'Alpha 2', slug: 'alpha' }], features: [] })).toThrow(/share the slug "alpha"/);
  });

  it('accepts cells keyed by slug or, in older files, by name', () => {
    expect(() => checkTable({ products, features: [{ name: 'A', scores: { alpha: yes, Beta: no } }, { name: 'B' }, { name: 'C', scores: null }] })).not.toThrow();
  });

  it('toComparisonView checks the source too, so a stray key fails the page build instead of vanishing from the view', () => {
    const src = source();
    src.features[0].scores = { ...src.features[0].scores, 'incognito-browserr': { value: 'no' } };
    expect(() => toComparisonView(src)).toThrow(ComparisonTableError);
  });
});

// --- ratings ---------------------------------------------------------------

describe('rating = round(10 × mean of assessed points, 1)', () => {
  it.each([
    [['yes', 'good', 'partial'], 7.5],
    [['excellent', 'excellent'], 10],
    [['no', 'none'], 0],
    [['good', 'good', 'poor'], 5.8],
    [['yes', 'yes', 'no'], 6.7],
    [['yes', 'no', 'no'], 3.3],
    [['limited', 'fair', 'partial'], 5],
    [['good', 'no'], 3.8], // 3.75 → 3.8
    [['good', 'no', 'no', 'no'], 1.9], // 1.875 → 1.9
    [['poor', 'no', 'no', 'no'], 0.6], // 0.625 → 0.6
  ])('%j → %s', (cells, expected) => {
    expect(ratingOf(table({ Alpha: cells }), 'Alpha')).toBe(expected);
  });

  it('rounds an exact half up, with no floating-point drift', () => {
    expect(ratingOf(table({ Alpha: ['poor', 'no'] }), 'Alpha')).toBe(1.3); // 1.25
    expect(ratingOf(table({ Alpha: ['poor', ...Array(9).fill('no')] }), 'Alpha')).toBe(0.3); // 0.25
    expect(ratingOf(table({ Alpha: ['yes', 'good', ...Array(8).fill('no')] }), 'Alpha')).toBe(1.8); // 1.75
    // 5.75 exactly, which float maths can land below: 0.575 * 100 is
    // 57.49999999999999, so Math.round(mean * 100) / 10 gives 5.7.
    expect(Math.round(0.575 * 100) / 10).toBe(5.7);
    expect(ratingOf(table({ Alpha: ['yes', 'yes', 'yes', 'yes', 'yes', 'good', 'no', 'no', 'no', 'no'] }), 'Alpha')).toBe(5.8);
  });

  it('matches an independent calculation for every possible column of 1–10 criteria', () => {
    // Every multiset of quarter values, as one product's column.
    const multisets = (n: number, min = 0): number[][] =>
      n === 0 ? [[]] : Array.from({ length: 5 - min }, (_, i) => min + i).flatMap((q) => multisets(n - 1, q).map((rest) => [q, ...rest]));
    let checked = 0;
    for (let n = 1; n <= 10; n++) {
      for (const qs of multisets(n)) {
        const mean = qs.reduce((a, q) => a + q / 4, 0) / n;
        // Nearest tenth, a half up. Non-half values sit at least 1/(2n) of a
        // tenth from a boundary, so the epsilon only settles true halves.
        const expected = Math.round(10 * mean * 10 + 1e-9) / 10;
        expect(ratingOf(table({ Alpha: qs.map((q) => BY_QUARTERS[q]) }), 'Alpha'), JSON.stringify(qs)).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('leaves not-assessed cells out of the average', () => {
    expect(ratingOf(table({ Alpha: ['yes', 'yes', '—', 'no'] }), 'Alpha')).toBe(6.7); // 2 / 3
    expect(ratingOf(table({ Alpha: ['yes', 'yes', undefined, 'no'] }), 'Alpha')).toBe(6.7); // no cell = '—'
    expect(ratingOf(table({ Alpha: ['yes', 'yes', 'n/a', 'no'] }), 'Alpha')).toBe(6.7);
    expect(ratingOf(table({ Alpha: ['yes', 'yes', 'no', 'no'] }), 'Alpha')).toBe(5);
  });

  it('never reads a rating typed into the data', () => {
    const data = table(
      { Alpha: ['no', 'no', 'poor'], Beta: ['yes', 'good', 'yes'] },
      { Alpha: { rating: 10 }, Beta: { rating: 1 } },
    );
    expect(ratingOf(data, 'Alpha')).toBe(0.8);
    expect(ratingOf(data, 'Beta')).toBe(9.2);
    expect(order(data)).toEqual(['Beta', 'Alpha']);
  });
});

describe('fewer than half of the criteria assessed → "Not enough data"', () => {
  it('exactly half is enough; below half is not', () => {
    // 6 criteria: 3 assessed is half, 2 is not.
    expect(ratingOf(table({ A: ['yes', 'yes', 'yes', '—', '—', '—'] }), 'A')).toBe(10);
    expect(ratingOf(table({ A: ['yes', 'yes', '—', '—', '—', '—'] }), 'A')).toBeNull();
    // 5 criteria: 3 is enough, 2 is under half.
    expect(ratingOf(table({ A: ['good', 'good', 'good', '—', '—'] }), 'A')).toBe(7.5);
    expect(ratingOf(table({ A: ['good', 'good', '—', '—', '—'] }), 'A')).toBeNull();
    // 1 criterion.
    expect(ratingOf(table({ A: ['partial'] }), 'A')).toBe(5);
    expect(ratingOf(table({ A: ['—'] }), 'A')).toBeNull();
  });

  it('counts coverage against the page, not against the product', () => {
    // Beta has cells for only 2 of the page's 5 criteria.
    const data = table({ Alpha: ['no', 'no', 'no', 'no', 'no'], Beta: ['yes', 'yes'] });
    const beta = scoreProducts(data).find((s) => s.name === 'Beta')!;
    expect(beta).toMatchObject({ rating: null, assessed: 2, criteria: 5 });
  });

  it('a page with no criteria rates nobody', () => {
    const data: ScoreInput = { products: [{ name: 'Beta', slug: 'beta' }, { name: 'Alpha', slug: 'alpha' }], features: [] };
    expect(scoreProducts(data)).toEqual([
      { slug: 'alpha', name: 'Alpha', rating: null, rank: 1, assessed: 0, criteria: 0 },
      { slug: 'beta', name: 'Beta', rating: null, rank: 2, assessed: 0, criteria: 0 },
    ]);
  });

  it('formats as "X.X/10" or "Not enough data"', () => {
    expect(formatRating(7.5)).toBe('7.5/10');
    expect(formatRating(9)).toBe('9.0/10');
    expect(formatRating(10)).toBe('10.0/10');
    expect(formatRating(0)).toBe('0.0/10');
    expect(formatRating(null)).toBe('Not enough data');
  });
});

// --- ranking ---------------------------------------------------------------

describe('ranking', () => {
  it('orders by rating, highest first, with ranks 1..N', () => {
    const data = table({ Alpha: ['no', 'poor'], Beta: ['yes', 'yes'], Gamma: ['good', 'partial'] });
    expect(scoreProducts(data).map((s) => [s.name, s.rating, s.rank])).toEqual([
      ['Beta', 10, 1], ['Gamma', 6.3, 2], ['Alpha', 1.3, 3],
    ]);
  });

  it('breaks a tie alphabetically by name, ignoring case', () => {
    const data = table({ zeta: ['yes', 'no'], Beta: ['good', 'poor'], alpha: ['partial', 'partial'] });
    expect(order(data)).toEqual(['alpha', 'Beta', 'zeta']);
    expect(compareByName({ name: 'beta', slug: 'b' }, { name: 'Alpha', slug: 'a' })).toBeGreaterThan(0);
  });

  it('a tie is the same ROUNDED rating, so the published number decides, not hidden decimals', () => {
    // Beta: 20 quarters over 7 cells = 7.14 → 7.1. Alpha: 17 over 6 = 7.08 → 7.1.
    // Beta's unrounded mean is higher, but both show 7.1, so Alpha comes first.
    const data = table({
      Beta: ['yes', 'yes', 'yes', 'yes', 'partial', 'partial', 'no'],
      Alpha: ['yes', 'yes', 'yes', 'yes', 'poor', 'no', '—'],
    });
    expect(scoreProducts(data).map((s) => [s.name, s.rating])).toEqual([['Alpha', 7.1], ['Beta', 7.1]]);
  });

  it('puts "Not enough data" last, alphabetically among themselves, even ahead of a 0 rating', () => {
    const data = table({
      Aardvark: ['yes', '—', '—', '—'],
      Abacus: [undefined, undefined, undefined, 'yes'],
      Zero: ['no', 'no', 'no', 'no'],
      Top: ['yes', 'yes', 'yes', 'yes'],
    });
    expect(scoreProducts(data).map((s) => [s.name, s.rating, s.rank])).toEqual([
      ['Top', 10, 1], ['Zero', 0, 2], ['Aardvark', null, 3], ['Abacus', null, 4],
    ]);
  });

  it('does not depend on the order products are listed in, and does not modify its input', () => {
    const columns = { Alpha: ['good', 'no', 'yes'], Beta: ['yes', 'fair', '—'], Gamma: ['poor', 'poor', 'none'] };
    const data = table(columns);
    const snapshot = JSON.stringify(data);
    const reversed: ScoreInput = { ...data, products: [...data.products].reverse() };
    expect(scoreProducts(reversed)).toEqual(scoreProducts(data));
    expect(JSON.stringify(data)).toBe(snapshot);
  });
});

// --- Incognito Browser -----------------------------------------------------

describe("Incognito Browser gets no special treatment ('no, not blank' is a data rule)", () => {
  it('scores exactly as any other product with the same column, and loses the alphabetical tie-break to Brave', () => {
    const data = table({ 'Incognito Browser': ['yes', 'good', 'no', 'partial'], Brave: ['yes', 'good', 'no', 'partial'] });
    expect(data.products.map((p) => p.slug)).toContain(OUR_PRODUCT_SLUG);
    const [first, second] = scoreProducts(data);
    expect(first.rating).toBe(second.rating);
    expect([first.name, second.name]).toEqual(['Brave', 'Incognito Browser']);
  });

  it('can lose: a better column outranks ours', () => {
    const data = table({ 'Incognito Browser': ['yes', 'no', 'no'], Firefox: ['good', 'good', 'good'] });
    expect(order(data)).toEqual(['Firefox', 'Incognito Browser']);
  });

  it("the scorer leaves a blank out for us as for anyone, which is why an unbacked criterion must be 'no' in the data", () => {
    const blanks = table({ 'Incognito Browser': ['yes', 'yes', 'yes', '—', '—'] });
    const nos = table({ 'Incognito Browser': ['yes', 'yes', 'yes', 'no', 'no'] });
    // A blank would lift our rating from 6 to 10. The scorer does not turn it
    // into 'no' for us, so the data has to.
    expect(ratingOf(blanks, 'Incognito Browser')).toBe(10);
    expect(ratingOf(nos, 'Incognito Browser')).toBe(6);
  });

  it('renaming our product changes nothing in any table', () => {
    // Deterministic pseudo-random tables.
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const values = [...Object.keys(POINTS), '—', undefined];
    for (let t = 0; t < 200; t++) {
      const criteria = 1 + Math.floor(rand() * 7);
      const column = () => Array.from({ length: criteria }, () => values[Math.floor(rand() * values.length)]);
      const ours = column();
      const others = { Other: column(), Third: column() };
      const withUs = scoreProducts(table({ 'Incognito Browser': ours, ...others }));
      const renamed = scoreProducts(table({ 'Incognito Browserx': ours, ...others }));
      const rate = (rows: typeof withUs, name: string) => rows.find((r) => r.name === name)!.rating;
      expect(rate(renamed, 'Incognito Browserx')).toBe(rate(withUs, 'Incognito Browser'));
      expect(rate(renamed, 'Other')).toBe(rate(withUs, 'Other'));
    }
  });

  it('includesOurProduct goes by slug', () => {
    expect(includesOurProduct([{ slug: 'brave' }, { slug: OUR_PRODUCT_SLUG }])).toBe(true);
    expect(includesOurProduct([{ slug: 'brave' }, { slug: 'firefox' }])).toBe(false);
  });
});

// --- cell lookup -----------------------------------------------------------

describe('cellFor', () => {
  const product = { slug: 'brave', name: 'Brave' };
  it('reads cells keyed by slug, or by name in older files, preferring the slug', () => {
    expect(cellFor({ scores: { brave: { value: 'yes' } } }, product)?.value).toBe('yes');
    expect(cellFor({ scores: { Brave: { value: 'no' } } }, product)?.value).toBe('no');
    expect(cellFor({ scores: { brave: { value: 'yes' }, Brave: { value: 'no' } } }, product)?.value).toBe('yes');
    expect(cellFor({ scores: { brave: null, Brave: { value: 'no' } } }, product)?.value).toBe('no');
    expect(cellFor({ scores: {} }, product)).toBeUndefined();
    expect(cellFor({}, product)).toBeUndefined();
  });

  it('scores name-keyed tables the same as slug-keyed ones', () => {
    const bySlug = table({ Alpha: ['yes', 'poor'], Beta: ['good', 'good'] });
    const byName: ScoreInput = {
      products: bySlug.products,
      features: bySlug.features.map((f) => ({
        ...f,
        scores: Object.fromEntries(Object.entries(f.scores ?? {}).map(([slug, c]) => [bySlug.products.find((p) => p.slug === slug)!.name, c])),
      })),
    };
    expect(scoreProducts(byName)).toEqual(scoreProducts(bySlug));
  });
});

// --- the client view -------------------------------------------------------

function source(overrides: Partial<ComparisonSource> = {}): ComparisonSource & Record<string, unknown> {
  return {
    niche: 'browser-privacy',
    slug: 'sample-compared',
    title: 'Sample comparison',
    metaDescription: 'meta',
    keywords: ['k'],
    intro: 'Intro text.',
    products: [
      { name: 'Incognito Browser', slug: 'incognito-browser', tagline: 'Ours', pricing: 'Free', platforms: ['Android'], pros: ['p'], cons: ['c'], rating: 10, website: 'https://incognitobrowser.io' } as ComparisonSource['products'][number],
      { name: 'Brave', slug: 'brave', tagline: 'Theirs', pricing: 'Free', platforms: ' Android, iOS, desktop ', pros: [], cons: [], rating: 1, pricing_note: 'x' } as ComparisonSource['products'][number],
      { name: 'Firefox', slug: 'firefox', tagline: 'Also theirs', pros: [], cons: [], rating: 5 } as ComparisonSource['products'][number],
    ],
    features: [
      { name: 'Ad blocking', description: 'd1', scores: { 'incognito-browser': { value: 'yes', note: 'NOTE-SHOULD-NOT-SHIP' }, brave: { value: 'yes' }, firefox: { value: 'partial' } } },
      { name: 'Open source', description: 'd2', scores: { 'Incognito Browser': { value: 'no' }, Brave: { value: 'yes' }, Firefox: { value: 'yes' } } },
      { name: 'Sync', description: 'd3', scores: { 'incognito-browser': { value: 'no' }, brave: { value: 'good' } } },
    ],
    verdict: { summary: 'Summary.', bestFor: [{ useCase: 'u', product: 'Brave', reason: 'r' }] },
    faqs: [{ question: 'q', answer: 'a' }],
    pro_tips: ['tip'],
    editorial: { status: 'published', reviewedBy: 'REVIEWER-PLACEHOLDER' },
    author: { name: 'WRITER-PLACEHOLDER' },
    editor: { name: 'EDITOR-PLACEHOLDER', profileUrl: 'https://example.com/editor' },
    ...overrides,
  };
}

describe('toComparisonView: only what the page renders crosses to the client', () => {
  const view = toComparisonView(source());
  const json = JSON.stringify(view);

  it('carries no person, no typed rating, no cell notes and no unrendered fields', () => {
    expect(Object.keys(view).sort()).toEqual(['faqs', 'features', 'intro', 'niche', 'products', 'title', 'verdict']);
    for (const p of view.products) {
      for (const k of Object.keys(p)) expect(['name', 'slug', 'tagline', 'pricing', 'platforms', 'pros', 'cons']).toContain(k);
    }
    for (const f of view.features) for (const c of Object.values(f.scores)) expect(Object.keys(c)).toEqual(['value']);
    for (const s of ['PLACEHOLDER', 'example.com', 'NOTE-SHOULD-NOT-SHIP', '"rating"', 'website', 'pricing_note', 'pro_tips', 'metaDescription', 'editorial']) {
      expect(json).not.toContain(s);
    }
  });

  it('re-keys name-keyed cells by slug and keeps missing cells missing', () => {
    expect(view.features[1].scores).toEqual({ 'incognito-browser': { value: 'no' }, brave: { value: 'yes' }, firefox: { value: 'yes' } });
    expect(view.features[2].scores).toEqual({ 'incognito-browser': { value: 'no' }, brave: { value: 'good' } });
  });

  it('normalises platforms to a list, and omits them when absent', () => {
    expect(view.products[0].platforms).toEqual(['Android']);
    expect(view.products[1].platforms).toEqual(['Android, iOS, desktop']);
    expect(view.products[2]).not.toHaveProperty('platforms');
    expect(view.products[2]).not.toHaveProperty('pricing');
    const empty = toComparisonView(source({ products: [{ name: 'X', slug: 'x', tagline: 't', platforms: ['', '  ', 3] }], features: [] }));
    expect(empty.products[0]).not.toHaveProperty('platforms');
  });

  it('scores the same as the source file', () => {
    expect(scoreProducts(view)).toEqual(scoreProducts(source()));
  });
});

// --- the rendered page -----------------------------------------------------

function render(src: ComparisonSource): string {
  return renderToStaticMarkup(
    React.createElement(ComparisonPage, { data: toComparisonView(src), nicheName: 'Browser privacy', reviewed: true, proofRoute: null }),
  );
}

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('ComparisonPage', () => {
  const DISCLOSURE =
    'We make Incognito Browser, one of the products compared here. It is scored with the same rubric as every other product, from the table on this page.';

  it('discloses that we make Incognito Browser right under the hero, with the "How we score" link', () => {
    const html = render(source());
    expect(text(html)).toContain(DISCLOSURE);
    const hero = html.indexOf('</section>'); // PageHero is the first section
    const disclosure = html.indexOf('data-testid="comparison-disclosure"');
    const intro = html.indexOf('Intro text.');
    expect(hero).toBeGreaterThan(-1);
    expect(disclosure).toBeGreaterThan(hero);
    expect(disclosure).toBeLessThan(intro);
    const block = html.slice(disclosure, html.indexOf('</aside>', disclosure));
    expect(block).toContain(`href="${METHODOLOGY_PATH}"`);
    expect(block).toContain('How we score');
  });

  it('has no disclosure when Incognito Browser is not compared, but still links the rubric', () => {
    const src = source();
    src.products = src.products.filter((p) => p.slug !== OUR_PRODUCT_SLUG);
    // Its cells go too: a cell for a product not on the page throws.
    for (const f of src.features) {
      f.scores = Object.fromEntries(Object.entries(f.scores ?? {}).filter(([k]) => k !== OUR_PRODUCT_SLUG && k !== 'Incognito Browser'));
    }
    const html = render(src);
    expect(html).not.toContain('comparison-disclosure');
    expect(text(html)).not.toContain('We make Incognito Browser');
    expect(html).toContain(`href="${METHODOLOGY_PATH}"`);
  });

  it('shows ratings from the table, ordered by them, and ignores typed ratings', () => {
    const t = text(render(source()));
    // Brave: yes, yes, good = 9.2. Ours: yes, no, no = 3.3. Firefox: partial,
    // yes and no cell on 3 criteria = 7.5. The data typed 1, 10 and 5.
    expect(t).toMatch(/Brave Our rating: 9\.2\/10/);
    expect(t).toMatch(/Firefox Our rating: 7\.5\/10 2 of 3 criteria assessed/);
    expect(t).toMatch(/Incognito Browser We make this Our rating: 3\.3\/10/);
    expect(t.indexOf('Brave Our rating')).toBeLessThan(t.indexOf('Firefox Our rating'));
    expect(t.indexOf('Firefox Our rating')).toBeLessThan(t.indexOf('Incognito Browser We make this'));
    expect(t).not.toContain('10/10');
    expect(t).not.toContain('1/10');
  });

  it('shows "Not enough data" for a product with under half the criteria assessed', () => {
    const src = source();
    src.features[0].scores = { ...src.features[0].scores, firefox: { value: '—' } };
    expect(text(render(src))).toMatch(/Firefox Our rating: Not enough data 1 of 3 criteria assessed/);
  });

  it('shows platforms when the data has them and hides the row otherwise', () => {
    const t = text(render(source()));
    expect(t).toContain('Platforms: Android ');
    expect(t).toContain('Platforms: Android, iOS, desktop');
    expect((t.match(/Platforms:/g) || []).length).toBe(2);
  });

  it('keeps the legend, and explains the dash as not assessed', () => {
    const t = text(render(source()));
    expect(t).toContain('whether it has the feature');
    expect(t).toContain('how well it does it');
    expect(t).toContain('not assessed');
  });

  it("says under the table that No for Incognito Browser can mean a feature isn't documented, with the rubric link", () => {
    const NOTE = "“No” for Incognito Browser can also mean a feature isn't documented.";
    const html = render(source());
    expect(text(html)).toContain(NOTE);
    const table = html.indexOf('</table>');
    const note = html.indexOf('data-testid="comparison-ib-no-note"');
    expect(table).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(table);
    expect(note).toBeLessThan(html.indexOf('Verdict'));
    const block = html.slice(note, html.indexOf('</p>', note));
    expect(block).toContain(`href="${METHODOLOGY_PATH}"`);
    expect(block).toContain('How we score');
    // Not on a page that doesn't compare it.
    const src = source();
    src.products = src.products.filter((p) => p.slug !== OUR_PRODUCT_SLUG);
    for (const f of src.features) {
      f.scores = Object.fromEntries(Object.entries(f.scores ?? {}).filter(([k]) => k !== OUR_PRODUCT_SLUG && k !== 'Incognito Browser'));
    }
    expect(text(render(src))).not.toContain(NOTE);
  });

  it('names no person and ships no note or typed rating in its markup', () => {
    const html = render(source());
    for (const s of ['PLACEHOLDER', 'NOTE-SHOULD-NOT-SHIP', 'example.com']) expect(html).not.toContain(s);
  });
});

// --- the data rules ----------------------------------------------------------

type DataProduct = ComparisonSource['products'][number] & { website?: string; rating?: unknown };
interface ComparisonFile extends Omit<ComparisonSource, 'products'> {
  slug: string;
  metaDescription: string;
  keywords?: string[];
  pro_tips?: string[];
  products: DataProduct[];
}

const DATA_DIR = path.join(ROOT, 'data', 'comparisons');
const FILES = fs.readdirSync(DATA_DIR).sort().flatMap((niche) =>
  fs.readdirSync(path.join(DATA_DIR, niche)).filter((f) => f.endsWith('.json')).sort().map((f) => `${niche}/${f}`),
);
const load = (file: string) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as ComparisonFile;

const BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brand.json'), 'utf-8')) as {
  name: string;
  platform: string;
  playPackage: string;
  playUrl: string;
  website: string;
  sameAs: string[];
  features: Array<{ id: string }>;
  pricing?: unknown;
  dataSafety?: unknown;
};
const OUR_NAME = BRAND.name;
/** Our row's pricing, from brand.json's pricing: the app is free, Incognito Pro is optional. */
const OUR_PRICING = 'Free; optional Incognito Pro subscription';
/** Text that names our product. */
const NAMES_US = /\bIncognito\s+(?:Browser|Pro)\b/i;
/** Text that points at our product without naming it ("our own Android browser", "which we make"). */
const POINTS_AT_US = /\b(?:which|that)\s+we\s+make\b|\bwe\s+make\b|\bour\s+(?:own\s+)?(?:\w+\s+)?(?:browser|app)\b/i;

const normUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');
/**
 * Is this row our product, whatever its slug? A name starting "Incognito"
 * (not "Incognito Mode"), or a website that is ours, our Play listing (by
 * package) or one of brand.json's sameAs profiles.
 */
function looksOurs(p: { name: string; website?: string }): boolean {
  if (/^incognito\b(?!\s+mode\b)/i.test(p.name.trim())) return true;
  const site = normUrl(p.website ?? '');
  if (!site) return false;
  const ours = [BRAND.website, BRAND.playUrl, ...BRAND.sameAs].map(normUrl);
  return (
    site.includes(BRAND.playPackage.toLowerCase()) ||
    /(?:^|\/\/|\.)incognitobrowser\.io(?:[/:?#]|$)/.test(site) ||
    ours.some((u) => site === u || site.startsWith(`${u}/`) || site.startsWith(`${u}?`))
  );
}

/**
 * Pages where Incognito Browser is the same kind of product as the others
 * (browsers and their private modes, browser-level blockers, search history).
 * It is left out of every other comparison, VPNs and email included, as the
 * methodology page says. Adding a page is an owner decision.
 */
const IB_PAGE = {
  adTracking: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json',
  extensions: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json',
  browserPrivacy: 'browser-privacy/best-browser-privacy-tools-compared.json',
  privacyBrowsers: 'browser-privacy/best-privacy-browsers-compared.json',
  cookies: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json',
  fingerprinting: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json',
  incognitoMode: 'incognito-mode/best-incognito-mode-tools-compared.json',
  searchHistory: 'search-history/best-search-history-privacy-tools-compared.json',
  socialMedia: 'social-media-privacy/best-social-media-privacy-tools-compared.json',
} as const;
const IB_COMPARABLE: string[] = Object.values(IB_PAGE);

/**
 * The criteria on which an Incognito Browser cell may give it credit (a value
 * worth more than 0), each with the data/brand.json facts that back it
 * (features[].id, or the top-level platform, pricing or dataSafety) and the
 * pages it was reviewed for (`on`). Keyed by criterion name in lower case.
 * `max` caps the value where the facts cover only part of the criterion. On
 * any other criterion or page, our cell must be 'no'. Each entry is a
 * reviewed decision: add one only when brand.json backs it, and never for a
 * never-claim (fingerprinting, VPN, Tor, open source). Keying by page, and
 * NEVER_CLAIM_CRITERION on the description, mean renaming a fingerprinting row
 * "Tracking Protection" can't borrow that entry.
 *
 * Not listed, on purpose (review 2026-09-10):
 *   - 'tracker blocking': brand.json lists an ad blocker, not a tracker
 *     blocker, and the claim checks treat "blocks trackers" as unbacked;
 *   - 'user agent randomization': Agent Cloaking changes the browser and
 *     device a site sees; it is not fingerprint protection (a never-claim).
 */
const IB_BACKING: Record<string, { facts: string[]; max?: RatedValue; on: string[]; why: string }> = {
  // The Play listing documents that an ad blocker exists, not how well it blocks, so it can't
  // draw level with Brave's "excellent" (privacy-browsers had it at "yes": Wave 2c review).
  'ad blocking': { facts: ['ad-blocker'], max: 'good', on: [IB_PAGE.adTracking, IB_PAGE.extensions], why: 'built-in ad blocker' },
  'built-in ad blocking': { facts: ['ad-blocker'], max: 'good', on: [IB_PAGE.privacyBrowsers], why: 'built-in ad blocker' },
  'ad & tracker blocking': { facts: ['ad-blocker'], max: 'partial', on: [IB_PAGE.browserPrivacy], why: 'ads only; tracker blocking is not documented' },
  'ad tracking prevention': { facts: ['ad-blocker', 'wipe-on-exit'], max: 'partial', on: [IB_PAGE.searchHistory], why: 'blocks ads and wipes cookies on exit; tracker blocking is not documented' },
  'tracking protection': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [IB_PAGE.incognitoMode], why: 'cookies can be switched off and are wiped on exit; no tracker blocker is documented' },
  'cross-site tracking prevention': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [IB_PAGE.adTracking], why: 'cookies can be switched off and are wiped on exit; no tracker blocker is documented' },
  'cross-platform protection': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [IB_PAGE.socialMedia], why: 'cookie-based linking between sites stops when cookies are off or wiped' },
  'third-party cookie blocking': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [IB_PAGE.cookies], why: 'a switch turns all cookies off (no third-party-only setting); cookies are wiped on exit' },
  'default privacy settings': { facts: ['wipe-on-exit', 'no-history'], max: 'good', on: [IB_PAGE.browserPrivacy], why: 'always in private mode, keeping no history; no tracker or fingerprint blocking is documented' },
  'automatic history deletion': { facts: ['wipe-on-exit', 'no-history'], on: [IB_PAGE.searchHistory], why: 'keeps no history and wipes the session on exit' },
  'cross-device sync protection': {
    facts: ['no-history'],
    max: 'partial',
    on: [IB_PAGE.searchHistory],
    why: 'keeps no history on the device, so there is nothing local to sync; searches an engine keeps in your account (and syncs once you sign in) are not covered',
  },
  customization: { facts: ['settings'], max: 'partial', on: [IB_PAGE.extensions], why: 'switches for images, JavaScript and cookies; no custom filter rules' },
  'customization options': { facts: ['settings'], max: 'partial', on: [IB_PAGE.adTracking], why: 'switches for images, JavaScript and cookies; no custom filter rules' },
  'ease of use': { facts: ['wipe-on-exit'], on: [IB_PAGE.adTracking, IB_PAGE.extensions, IB_PAGE.incognitoMode], why: 'always in private mode, with nothing to set up' },
  'ease of setup': { facts: ['wipe-on-exit'], on: [IB_PAGE.searchHistory], why: 'always in private mode, with nothing to set up' },
  'easy setup': { facts: ['wipe-on-exit'], on: [IB_PAGE.cookies], why: 'always in private mode, with nothing to set up' },
  'search quality': { facts: ['search-engines'], on: [IB_PAGE.searchHistory], why: 'results come from the engine you choose (Google, DuckDuckGo, Bing)' },
  'mobile support': { facts: ['platform'], max: 'partial', on: [IB_PAGE.searchHistory], why: 'an Android app; there is no iOS version' },
  'data collection transparency': { facts: ['dataSafety'], max: 'partial', on: [IB_PAGE.browserPrivacy], why: "Google Play's Data safety section says what it may collect" },
};

/**
 * Criteria that don't apply to a browser at all, where our cell may be '—'
 * (not assessed) instead of 'no'. Everywhere else a criterion we can't back is
 * 'no', so it counts against us instead of being left out of the average.
 * Each entry is a reviewed decision with its reason; none is needed today.
 */
const NOT_A_BROWSER_CRITERION: Array<{ file: string; criterion: string; reason: string }> = [];

const criterionKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A criterion about one of brand.json's never-claims, or next to one, by its
 * name or description: our cell there can only be 'no'. Fingerprinting rows
 * often don't say "fingerprint" ("reading unique canvas signatures that
 * identify your device"), so their vocabulary counts too.
 */
const NEVER_CLAIM_CRITERION =
  /fingerprint|canvas|webgl|audio\s+context|installed\s+fonts|screen\s+resolution|user[- ]agent|signatures?\b|identif(?:y|ies|ying|ication)|\bVPNs?\b|\bTor\b|\bonion\b|open[- ]?source|anonym|\bIP\s+address|encrypt/i;

/**
 * Third-party labs whose published results a cell may follow: the only way a
 * speed or performance cell gets a value (sitewide policy, 2026-09-11). A page
 * that uses one names it in text it shows. Adding a source is a reviewed
 * decision.
 */
const MEASUREMENT_SOURCES = ['AV-Comparatives', 'AV-TEST', 'SE Labs'] as const;
const SOURCE_ALT = MEASUREMENT_SOURCES.map((s) => s.replace(/[-\s]/g, '[- ]')).join('|');
/** A criterion about speed, performance, latency or resource use. */
const SPEED_CRITERION = /\b(?:speed|fast(?:er|est)?|latency|performance|resources?|lightweight|overhead|slow(?:down|s)?)\b/i;

/** scripts/schemas/comparison.schema.json: what the generator is told a comparison file looks like. */
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'schemas', 'comparison.schema.json'), 'utf-8'));
const META_MAX: number = SCHEMA.properties.metaDescription.maxLength;
const INTRO_MAX: number = SCHEMA.properties.intro.maxLength;

/**
 * Claims of testing or expert review. The rubric reads published features;
 * nobody here tests them. "Tested as Norton Antivirus Plus" or "tested by
 * AV-Comparatives" reports a third-party lab and passes.
 */
const TESTING = new RegExp(
  [
    String.raw`\bwe(?:'ve|\s+have)?\s+(?:\w+\s+)?tested\b|\bwe\s+test\b`,
    String.raw`\bexpert[- ](?:tested|reviewed|reviews?|rated|ratings?|guide|picks?|analysis)\b|\bexperts?\b[^.]{0,20}\btest`,
    String.raw`\b(?:was|were|been)\s+(?:\w+\s+)?tested\b(?!\s+(?:as\b|(?:by|in)\s+(?:${SOURCE_ALT})\b))`,
    String.raw`\bin\s+(?:our\s+)?(?:tests?|testing)\b|\bour\s+(?:own\s+)?(?:tests?|testing|lab)\b`,
    String.raw`\bhands[- ]on\b|\blab[- ]tested\b|\btested\s+by\s+(?:us|our)\b`,
  ].join('|'),
  'i',
);

/** Leftovers of the product-mention scrub: "a privacy-focused browser" put where our name was. */
const SCRUB_LEFTOVER =
  /\blike a privacy-focused browser\b|[a-z,]\s+Use a privacy-focused browser\b|\bprivacy-focused browser\s*\((?:which\s+)?we\s+make\)|\bprivacy-focused browser from Google Play\b/;

/**
 * A claim to be the best or top-rated. In the verdict, bestFor, FAQs, intro
 * and meta description, one may be made only for the top-rated product(s),
 * or, limited to one criterion ("the best phishing simulation score", "scores
 * highest for voice privacy"), only for a product with the top cell on that
 * criterion. A bestFor use case starting "Best …" is one too.
 */
const SUPERLATIVE =
  /\bthe best\b(?!\s+(?:way|ways|time|approach|defen[cs]e|thing|things|practice|practices|place|bet|chance|chances|of\s+both\s+worlds)\b)|\bbest[- ](?:overall|all[- ]around|all[- ]rounder|choice|option|pick|value|in[- ]class)\b|\btop[- ](?:choice|pick|spot|score|scorer|scoring|rated|ranked|recommendation)\b|\bour\s+(?:top\s+)?(?:pick|recommendation)\b|\bwinners?\b|\brecommend(?:ed|s)?\s+(?:\S+\s+){0,4}?(?:above|over)\b|\bleads\b(?!\s+to\b)|\bleading\b|\b(?:scores?|scored|scoring|rated|rates|ranks?|ranked|comes?|came)\s+(?:the\s+)?highest\b|\bhighest[- ](?:score|scoring|scorer|rated|rating|ranked)\b|\branks?\s+(?:first|top)\b|\bnumber one\b|#1\b/i;
/** Wider, for anything said about our own product: no "best" of any kind unless the table ranks it first. */
const OUR_SUPERLATIVE = new RegExp(
  `${SUPERLATIVE.source}|\\bbest\\b|\\btop\\b|\\bultimate\\b|\\bunbeatable\\b|\\bstrongest\\b|\\bfastest\\b|\\bmost\\s+(?:private|secure|complete|comprehensive|advanced|powerful)\\b|\\bour\\s+(?:choice|favou?rite)\\b|\\brecommend(?:ed|s|ation)?\\b|\\bstandout\\b`,
  'i',
);

/** Places a sentence can claim. */
const ORDINAL: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7,
};
const ORD = '(first|second|third|fourth|fifth|sixth|seventh|1st|2nd|3rd|4th|5th|6th|7th)';
/**
 * A claimed place: "is second", "comes third", "ranks fourth overall", "a
 * close second", "tie for second", "ties Edge for second", "second-highest",
 * "in second place". Not "third-party", and not "listed first" (the
 * alphabetical tie-break).
 */
const PLACE = new RegExp(
  [
    `\\b(?:is|are|comes?|came|ranks?|ranked|places?|placed|finish(?:es|ed)?|sits?|scores?|scored)\\s+(?:an?\\s+)?(?:(?:close|distant|clear|joint|equal)\\s+)?${ORD}\\b(?![- ]part)`,
    `\\bti(?:e|es|ed|ing)\\s+(?:\\S+\\s+){0,3}?for\\s+${ORD}\\b`,
    `\\b${ORD}[- ](?:highest|best|place|ranked|rated)\\b`,
    `\\bin\\s+${ORD}\\s+place\\b`,
  ].join('|'),
  'i',
);
/** "X comes next", "X and Y tie next", "next is X", "…, followed by X, Y and Z". */
const NEXT = /\b(?:comes?|came|is|are|ranks?|ti(?:e|es|ed))\s+next\b|\bnext\s+(?:is|are|comes?)\b|\bfollowed\s+by\b/i;
/** A claim to rate lowest: "scores lowest", "ranks last", "the lowest rating". */
const LOWEST =
  /\b(?:scores?|scored|scoring|rates?|rated|ranks?|ranked|comes?|came|is|are|finish(?:es|ed)?|places?|placed|sits?)\s+(?:the\s+)?(?:lowest|last)\b|\blowest[- ](?:rated|scoring|ranked)\b|\bthe\s+lowest\s+(?:score|rating)\b|\bat\s+the\s+bottom\b/i;
/** A rating written out: "7.5/10", "9 out of 10". */
const RATING_TEXT = /\b(\d{1,2}(?:\.\d)?)\s*(?:\/\s*10|out\s+of\s+10)\b/i;
/** A statement of where a product ranks, as a bestFor naming ours must make unless it ranks first. */
const RANK_STATEMENT = new RegExp(`${PLACE.source}|${LOWEST.source}`, 'i');
/** Every match of a pattern in a string. */
const matchesOf = (re: RegExp, s: string) => [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))];

/**
 * Superlatives limited by something the table can't check ("Among tools for
 * your own browser, X scores highest"), each reviewed against the table:
 * file, the words as written, and why they are true. None is needed today
 * (cookie-management's went when Ghostery became top-rated outright); a test
 * keeps each entry's words on its page, so none goes stale.
 */
const SCOPED_SUPERLATIVE: Array<{ file: string; words: string; reason: string }> = [];

/** Words that say nothing about which criterion a superlative is limited to. */
const SCOPE_STOP = new Set([
  'these', 'this', 'that', 'page', 'criteria', 'criterion', 'table', 'here', 'overall', 'score', 'scores', 'rating',
  'ratings', 'rated', 'with', 'from', 'than', 'their', 'them', 'they', 'four', 'five', 'three', 'privacy', 'protection',
  'support', 'features', 'feature', 'tools', 'products', 'service', 'services',
]);
const scopeWords = (s: string) => (s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !SCOPE_STOP.has(w));

/**
 * The criterion a superlative is limited to, if any: "scores highest for
 * voice privacy" (for / at / on / in …) or "the best phishing simulation
 * score" names words of one of the page's criteria. "Scores highest on these
 * six criteria" names none, so it is about the whole table. With `direct`,
 * the words right after it count too ("Best malware protection").
 */
function scopeOf(d: ComparisonFile, sentence: string, m: RegExpMatchArray, direct = false) {
  const rest = sentence.slice((m.index ?? 0) + m[0].length);
  const scoped = direct || /^the best$/i.test(m[0].trim()) ? rest : (rest.match(/^\s+(?:for|at|in|on)\s+(.*)/i)?.[1] ?? '');
  const words = new Set(scopeWords(scoped.split(/[,.;:!?()]/)[0].split(/\s+/).slice(0, 6).join(' ')));
  let best: ComparisonFile['features'][number] | undefined;
  let hits = 0;
  for (const f of d.features) {
    const n = scopeWords(f.name).filter((w) => words.has(w)).length;
    if (n > hits) [best, hits] = [f, n];
  }
  return best;
}

/** Which product a superlative is about: the nearest one named before it, else the first named after it. */
function subjectOf(products: DataProduct[], sentence: string, at: number): DataProduct | undefined {
  let subject: DataProduct | undefined;
  let where = -1;
  let after: DataProduct | undefined;
  let afterAt = Infinity;
  for (const p of products) {
    for (const i of mentionsOf(sentence, p.name)) {
      if (i < at && i > where) [subject, where] = [p, i];
      if (i > at && i < afterAt) [after, afterAt] = [p, i];
    }
  }
  return subject ?? after;
}

/** Does this product have the top cell (joint top included) on this criterion? */
function hasTopCell(d: ComparisonFile, f: ComparisonFile['features'][number], product: DataProduct): boolean {
  const points = (p: DataProduct) => {
    const v = readCell(cellFor(f, p)?.value);
    return v === null ? -1 : POINTS[v];
  };
  const mine = points(product);
  return mine >= 0 && d.products.every((p) => points(p) <= mine);
}

interface PageText { where: string; text: string; ours: boolean; shown: boolean }

/**
 * Every string a comparison file publishes or keeps about its products: not
 * the editorial, author or editor blocks. `ours` marks text about Incognito
 * Browser by position (its row, its cell notes, a bestFor naming it); `shown`
 * marks text the page renders (cell notes, keywords and pro_tips are not).
 */
function textsOf(d: ComparisonFile): PageText[] {
  const out: PageText[] = [];
  const add = (where: string, text: unknown, ours = false, shown = true) => {
    if (typeof text === 'string' && text.trim()) out.push({ where, text: text.replace(/’/g, "'"), ours, shown });
  };
  add('title', d.title);
  add('metaDescription', d.metaDescription);
  (d.keywords ?? []).forEach((k, i) => add(`keywords[${i}]`, k, false, false));
  add('intro', d.intro);
  for (const p of d.products) {
    const ours = p.slug === OUR_PRODUCT_SLUG;
    add(`${p.slug}.name`, p.name, ours);
    add(`${p.slug}.tagline`, p.tagline, ours);
    add(`${p.slug}.pricing`, p.pricing, ours);
    (Array.isArray(p.platforms) ? p.platforms : [p.platforms]).forEach((s, i) => add(`${p.slug}.platforms[${i}]`, s, ours));
    (p.pros ?? []).forEach((s, i) => add(`${p.slug}.pros[${i}]`, s, ours));
    (p.cons ?? []).forEach((s, i) => add(`${p.slug}.cons[${i}]`, s, ours));
  }
  for (const f of d.features) {
    add(`criterion "${f.name}"`, f.name);
    add(`criterion "${f.name}" description`, f.description);
    for (const p of d.products) add(`criterion "${f.name}" note for ${p.slug}`, cellFor(f, p)?.note, p.slug === OUR_PRODUCT_SLUG, false);
  }
  add('verdict.summary', d.verdict.summary);
  d.verdict.bestFor.forEach((b, i) => {
    const ours = b.product === OUR_NAME;
    add(`bestFor[${i}].useCase`, b.useCase, ours);
    add(`bestFor[${i}].product`, b.product, ours);
    add(`bestFor[${i}].reason`, b.reason, ours);
  });
  (d.faqs ?? []).forEach((q, i) => {
    add(`faqs[${i}].question`, q.question);
    add(`faqs[${i}].answer`, q.answer);
  });
  (d.pro_tips ?? []).forEach((s, i) => add(`pro_tips[${i}]`, s, false, false));
  return out;
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words too common to stand for a product on their own ("Browser" in "Tor Browser", "Incognito" in "Chrome Incognito Mode"). */
const GENERIC_NAME_WORD =
  /^(?:have|free|best|apple|google|microsoft|privacy|identity|screen|sliding|canvas|incognito|browser|browsers|mode|extension|extensions|protection|security|awareness|email|mail|time|tool|tools|apps?|platform|management|services?|cameras?|sensor|router|wallet|cash|controls|view|private|browsing|search|engine|essentials|premium|plus|gold)$/i;

/**
 * Where a sentence names the product: by its full name, its name without a
 * bracketed part ("Element" for "Element (Matrix)"), or a distinctive first or
 * last word ("OneTrust" for "OneTrust Privacy Management", "Firefox" for
 * "Mozilla Firefox"). Case-sensitive.
 */
function mentionsOf(sentence: string, name: string): number[] {
  const bare = name.replace(/\s*\([^)]*\)/g, '').trim();
  const aliases = new Set([name, bare]);
  const words = bare.split(/\s+/);
  for (const w of [words[0], words[words.length - 1]]) if (w.length >= 4 && !GENERIC_NAME_WORD.test(w)) aliases.add(w);
  return [...aliases].flatMap((a) => [...sentence.matchAll(new RegExp(`(?<![\\w-])${escapeRe(a)}(?![\\w-])`, 'g'))].map((m) => m.index ?? 0));
}
const namesProduct = (sentence: string, name: string) => mentionsOf(sentence, name).length > 0;

/** The product(s) sharing the highest rating, by name; none when nobody has a rating. */
function topRated(scores: ProductScore[]): string[] {
  const top = scores[0]?.rating ?? null;
  return top === null ? [] : scores.filter((s) => s.rating === top).map((s) => s.name);
}

/** Does this product have the bottom cell (joint bottom included) on this criterion? */
function hasBottomCell(d: ComparisonFile, f: ComparisonFile['features'][number], product: DataProduct): boolean {
  const points = (p: DataProduct) => {
    const v = readCell(cellFor(f, p)?.value);
    return v === null ? Infinity : POINTS[v];
  };
  const mine = points(product);
  return mine !== Infinity && d.products.every((p) => points(p) >= mine);
}

/** The shown prose where one product is ranked against another: the verdict summary, FAQ answers, intro and meta description. */
function rankingTexts(d: ComparisonFile): Array<{ where: string; text: string }> {
  const texts = [
    { where: 'summary', text: d.verdict.summary },
    ...(d.faqs ?? []).map((q, i) => ({ where: `faqs[${i}].answer`, text: q.answer })),
    { where: 'intro', text: d.intro },
    { where: 'metaDescription', text: d.metaDescription },
  ];
  return texts.filter((t) => typeof t.text === 'string' && t.text.trim()).map((t) => ({ ...t, text: t.text.replace(/’/g, "'") }));
}

/**
 * Superlatives the table doesn't support, in the verdict summary, FAQ
 * answers, intro, meta description and bestFor. An unlimited one must be
 * about a top-rated product, and a sentence making it must name every product
 * tied for top. One limited to a criterion must be about a product with the
 * top cell there. A sentence naming no product is a general remark and passes.
 * A bestFor use case starting "Best" makes one about its product.
 */
function verdictSuperlativeProblems(d: ComparisonFile, file: string): string[] {
  const top = topRated(scoreProducts(d));
  const topLabel = top.join(' = ') || 'nobody rated';
  const allowed = SCOPED_SUPERLATIVE.filter((e) => e.file === file).map((e) => e.words);
  const problems: string[] = [];
  for (const { where, text } of rankingTexts(d)) {
    for (const sentence of sentencesOf(text)) {
      if (allowed.some((w) => sentence.includes(w))) continue;
      for (const m of matchesOf(SUPERLATIVE, sentence)) {
        const subject = subjectOf(d.products, sentence, m.index ?? 0);
        if (!subject) continue;
        const criterion = scopeOf(d, sentence, m);
        if (criterion) {
          if (!hasTopCell(d, criterion, subject)) problems.push(`${where}: "${m[0]}" for ${subject.name}, which doesn't have the top "${criterion.name}" cell: "${sentence}"`);
        } else if (!top.includes(subject.name) || top.some((name) => !namesProduct(sentence, name))) {
          problems.push(`${where}: "${m[0]}" for ${subject.name}: "${sentence}" (top-rated: ${topLabel})`);
        }
      }
    }
  }
  d.verdict.bestFor.forEach((b, i) => {
    const text = `${b.useCase}. ${b.reason}`;
    const product = d.products.find((p) => p.name === b.product);
    // A use case starting "Best" ("Best for most people", "Best malware protection") is limited to the criterion it names, if any.
    const leadingBest = matchesOf(/^\s*best\b/i, b.useCase).map((m) => ({ m, direct: true }));
    for (const { m, direct } of [...matchesOf(SUPERLATIVE, text).map((m) => ({ m, direct: false })), ...leadingBest]) {
      const criterion = scopeOf(d, text, m, direct);
      const ok = criterion && product ? hasTopCell(d, criterion, product) : top.includes(b.product);
      if (!ok) problems.push(`bestFor[${i}] ${b.product}: "${m[0].trim()}" in "${text}" (top-rated: ${topLabel})`);
    }
  });
  return problems;
}

/** Each product's standing: its group (1 = the top rating; a tie is one group) and the places its tie spans. */
function standings(d: ComparisonFile): Map<string, { rating: number | null; group: number; first: number; last: number }> {
  const scores = scoreProducts(d);
  const out = new Map<string, { rating: number | null; group: number; first: number; last: number }>();
  let group = 0;
  scores.forEach((s, i) => {
    if (i === 0 || s.rating !== scores[i - 1].rating) group++;
    const tie = scores.filter((t) => t.rating === s.rating).map((t) => t.rank);
    out.set(s.slug, { rating: s.rating, group, first: Math.min(...tie), last: Math.max(...tie) });
  });
  return out;
}

/**
 * Places, "next", "lowest" and ratings the prose states that the table
 * doesn't: "Privacy Badger is second" for the fourth, "comes next" for a
 * product that doesn't follow the one before it, "scores lowest" for one that
 * doesn't, "rates 9.5/10" for a product rated 8.5. Checked in the verdict
 * summary, FAQ answers, intro, meta description and bestFor reasons (where
 * the product is the card's).
 *
 * A place N is right for a product whose tie spans place N ("tie for
 * second" for the products listed second and third), or whose group of
 * equal ratings is the Nth ("third" after two products tie for first).
 * "Comes next" and "followed by" must name the group right after (or tied
 * with) the product they follow: either the nearest product named before, or
 * the last product the text gave a place ("Firefox and Tor tie for second.
 * Tor ties Safari for tracking. Edge comes next." follows Tor, not Safari).
 * "Scores lowest" limited to a criterion ("scores lowest on
 * fingerprinting") needs the bottom cell there.
 */
function rankingClaimProblems(d: ComparisonFile): string[] {
  const standing = standings(d);
  const of = (p: DataProduct) => standing.get(p.slug)!;
  const rated = scoreProducts(d).filter((s) => s.rating !== null);
  const bottom = rated.length ? rated[rated.length - 1].rating : null;
  const label = (p: DataProduct) => {
    const s = of(p);
    return `${p.name} is placed ${s.first}${s.last > s.first ? `–${s.last}` : ''} at ${formatRating(s.rating)}`;
  };
  const problems: string[] = [];

  const check = (where: string, text: string, card?: DataProduct) => {
    // Every product named in the text, in order, for "next" and "followed by".
    const mentions = d.products
      .flatMap((p) => mentionsOf(text, p.name).map((at) => ({ at, p })))
      .sort((a, b) => a.at - b.at);
    // The group of the product the text last gave a place to.
    let cursor: number | null = null;
    let offset = 0;
    for (const sentence of sentencesOf(text)) {
      const start = text.indexOf(sentence, offset);
      offset = start + sentence.length;
      const subjectAt = (at: number) => card ?? subjectOf(d.products, sentence, at);
      const events = [
        ...matchesOf(SUPERLATIVE, sentence).map((m) => ({ kind: 'top' as const, m })),
        ...matchesOf(PLACE, sentence).map((m) => ({ kind: 'place' as const, m })),
        ...matchesOf(LOWEST, sentence).map((m) => ({ kind: 'lowest' as const, m })),
        ...matchesOf(RATING_TEXT, sentence).map((m) => ({ kind: 'rating' as const, m })),
        ...(card ? [] : matchesOf(NEXT, sentence).map((m) => ({ kind: 'next' as const, m }))),
      ].sort((a, b) => (a.m.index ?? 0) - (b.m.index ?? 0));

      for (const { kind, m } of events) {
        const idx = m.index ?? 0;
        if (kind === 'top') {
          // Checked by verdictSuperlativeProblems; here it only moves the cursor.
          const p = subjectAt(idx);
          if (p && !scopeOf(d, sentence, m)) cursor = of(p).group;
        } else if (kind === 'place') {
          const p = subjectAt(idx);
          if (!p) continue;
          const n = ORDINAL[(m[0].match(new RegExp(ORD, 'i'))?.[1] ?? '').toLowerCase()];
          const s = of(p);
          if (!(s.group === n || (s.first <= n && n <= s.last))) problems.push(`${where}: "${m[0]}", but ${label(p)}: "${sentence}"`);
          cursor = s.group;
        } else if (kind === 'lowest') {
          const p = subjectAt(idx);
          if (!p) continue;
          const criterion = scopeOf(d, sentence, m);
          if (criterion) {
            if (!hasBottomCell(d, criterion, p)) problems.push(`${where}: "${m[0]}" for ${p.name}, which doesn't have the bottom "${criterion.name}" cell: "${sentence}"`);
          } else {
            if (!(of(p).rating === null || of(p).rating === bottom)) problems.push(`${where}: "${m[0]}", but ${label(p)}: "${sentence}"`);
            cursor = of(p).group;
          }
        } else if (kind === 'rating') {
          const p = subjectAt(idx);
          if (p && of(p).rating !== Number(m[1])) problems.push(`${where}: "${m[0]}", but ${label(p)}: "${sentence}"`);
        } else {
          const at = start + idx;
          let listed: DataProduct[];
          if (/^(?:followed|next)/i.test(m[0])) {
            // "followed by X, Y and Z", "next is X": the products named after it, in its clause.
            const rest = sentence.slice(idx + m[0].length).split(/[.;:!?()—–]/)[0];
            const end = at + m[0].length + rest.length;
            listed = [...new Set(mentions.filter((x) => x.at > at && x.at < end).map((x) => x.p))];
          } else {
            // "X comes next", "X and Y tie next": the product named before it.
            const p = subjectOf(d.products, sentence, idx);
            listed = p ? [p] : [];
          }
          if (!listed.length) continue;
          const first = of(listed[0]).group;
          // What it follows: the nearest product named before it and not tied with it, or the cursor.
          const firstAt = Math.min(...mentions.filter((x) => x.p === listed[0] && x.at >= start).map((x) => x.at));
          const near = [...mentions].reverse().find((x) => x.at < Math.min(at, firstAt) && of(x.p).group !== first);
          const refs = [near ? of(near.p).group : null, cursor].filter((g): g is number => g !== null && g !== first);
          const follows = (g: number) => first - g === 1;
          if (refs.length && !refs.some(follows)) {
            problems.push(`${where}: "${m[0]}" puts ${listed[0].name} after ${near ? near.p.name : 'the product placed before it'}, but ${label(listed[0])}${near ? ` and ${label(near.p)}` : ''}: "${sentence}"`);
          }
          // The rest of a "followed by" list, in order.
          for (let i = 1; i < listed.length; i++) {
            const step = of(listed[i]).group - of(listed[i - 1]).group;
            if (step !== 0 && step !== 1) problems.push(`${where}: "${m[0]}" lists ${listed[i].name} after ${listed[i - 1].name}, but ${label(listed[i])} and ${label(listed[i - 1])}: "${sentence}"`);
          }
          cursor = of(listed[listed.length - 1]).group;
        }
      }
    }
  };

  for (const { where, text } of rankingTexts(d)) check(where, text);
  d.verdict.bestFor.forEach((b, i) => {
    const card = d.products.find((p) => p.name === b.product);
    if (card) check(`bestFor[${i}] ${b.product}`, b.reason, card);
  });
  return problems;
}

/**
 * A bestFor card naming our product, unless it ranks first, must either
 * name a criterion on which it has the top cell ("Ad blocking" where its cell
 * ties the best), or say where it ranks ("It ranks last on this table's
 * criteria"; rankingClaimProblems checks that the place is right).
 */
function ourBestForProblems(d: ComparisonFile): string[] {
  if (topRated(scoreProducts(d)).includes(OUR_NAME)) return [];
  const ib = d.products.find((p) => p.slug === OUR_PRODUCT_SLUG);
  if (!ib) return [];
  const problems: string[] = [];
  d.verdict.bestFor.forEach((b, i) => {
    if (b.product !== OUR_NAME) return;
    const named = new Set(scopeWords(b.useCase));
    const topOnNamed = d.features.some((f) => scopeWords(f.name).some((w) => named.has(w)) && hasTopCell(d, f, ib));
    if (!topOnNamed && !RANK_STATEMENT.test(b.reason)) {
      problems.push(`bestFor[${i}] "${b.useCase}" names ${OUR_NAME}, which doesn't rank first or have the top cell on a criterion the use case names, and the reason doesn't say where it ranks: "${b.reason}"`);
    }
  });
  return problems;
}

/**
 * Anywhere in the file, "best", "top", "leading", "recommended" and the like
 * said about our product, unless the table ranks it first. It is about us when
 * we are the nearest product named before it; or, in a sentence naming no
 * product, when the text is our own row's or the sentence follows one about
 * us ("…, which we make, scores lowest. It is the best choice for Android.").
 */
function ourSuperlatives(d: ComparisonFile): string[] {
  if (topRated(scoreProducts(d)).includes(OUR_NAME)) return [];
  const others = d.products.filter((p) => p.slug !== OUR_PRODUCT_SLUG);
  const found: string[] = [];
  for (const t of textsOf(d)) {
    let aboutUs = t.ours;
    for (const sentence of sentencesOf(t.text)) {
      const us = matchesOf(NAMES_US, sentence).map((m) => m.index ?? 0);
      const them = others.flatMap((p) => mentionsOf(sentence, p.name));
      const ours = t.ours || us.length > 0 || (aboutUs && them.length === 0);
      if (ours && !sentence.trim().endsWith('?')) {
        for (const m of matchesOf(OUR_SUPERLATIVE, sentence)) {
          const subject = subjectOf(d.products, sentence, m.index ?? 0);
          if (subject ? subject.slug === OUR_PRODUCT_SLUG : true) found.push(`${t.where}: "${m[0]}": ${sentence}`);
        }
      }
      if (!t.ours && (us.length || them.length)) aboutUs = Math.max(-1, ...us) > Math.max(-1, ...them);
    }
  }
  return found;
}

// --- the methodology page ----------------------------------------------------

describe('the published methodology', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/comparisons/methodology/page.tsx'), 'utf-8');
  const prose = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/&apos;/g, "'").replace(/\s+/g, ' ');

  it('draws its points table from the code, not from copied numbers', () => {
    expect(src).toMatch(/import \{[^}]*\bPOINTS\b[^}]*\} from '@\/lib\/comparison-score'/);
    expect(src).toContain('pointsRows()');
  });

  /** The one sentence on the page that may say "verified", because it says we haven't. */
  const NOT_VERIFIED = "The cells are our reading of each product's published features, and we have not independently verified them.";

  it('claims no testing or verification, says which criteria are judgement, and keeps its limits', () => {
    expect(prose).toContain(NOT_VERIFIED);
    expect(prose).toContain("We don't run lab tests of our own; where a cell follows a third-party lab result, the page says so.");
    expect(prose).toContain('Criteria such as ease of use are our judgement, not a documented feature.');
    expect(prose).toContain('Speed and performance are scored only where the page cites a third-party measurement.');
    expect(prose).toContain("A dash means we haven't assessed that criterion for that product, or it doesn't apply to it.");
    // "verified" nowhere else: not "checked and verified by our team", not "we verified".
    expect(prose.split(NOT_VERIFIED).join(' ')).not.toMatch(/\bverified\b/i);
    expect(prose).not.toMatch(TESTING);
  });

  it('states the Incognito Browser rules that the data rules below enforce', () => {
    expect(prose).toContain('every comparison that includes it says so at the top of the page');
    expect(prose).toContain('A cell gives it credit only for a feature documented in its Google Play listing.');
    expect(prose).toContain('the cell says No rather than showing a dash');
    expect(prose).toContain('can count towards ease of use; speed gets no credit');
    expect(prose).toContain(
      // cookie-management compares it with Cookiebot, a consent tool for site owners, so "only
      // browsers and blockers" was untrue (Wave 2c review, 2026-09-11).
      'We include it only in comparisons of browsers and private-browsing modes, ad, tracker and cookie blocking, fingerprinting and search history, and leave it out of everything else, such as VPNs or email services.',
    );
    // What keeps those true: IB_BACKING, IB_COMPARABLE, and the speed and
    // lab-result rules in "catalogue rules for every comparison".
    expect(IB_BACKING['ease of use']?.facts).toEqual(['wipe-on-exit']);
    expect(Object.keys(IB_BACKING).filter((c) => SPEED_CRITERION.test(c))).toEqual([]);
    expect(IB_COMPARABLE.filter((f) => /^(?:vpn-privacy|email-privacy)\//.test(f))).toEqual([]);
  });

  it('is in the sitemap', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    expect(sitemap().map((e) => e.url)).toContain(`https://incognitobrowser.io/resources${METHODOLOGY_PATH}`);
  });
});

// --- the superlative checks themselves ---------------------------------------

describe('the superlative checks', () => {
  const cells = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }]));
  // Alpha = Beta 8.8 (tied top), Gamma Tool 5.0, ours 3.8. Gamma Tool has the top Voice Privacy cell.
  const page = (summary: string, bestFor: ComparisonFile['verdict']['bestFor'] = [], tagline = 'Private browser'): ComparisonFile => ({
    niche: 'x', slug: 'x', title: 'X', metaDescription: 'x', intro: 'x', faqs: [],
    products: [
      { name: 'Alpha', slug: 'alpha', tagline: 't' },
      { name: 'Beta', slug: 'beta', tagline: 't' },
      { name: 'Gamma Tool', slug: 'gamma', tagline: 't' },
      { name: OUR_NAME, slug: OUR_PRODUCT_SLUG, tagline },
    ],
    features: [
      { name: 'Voice Privacy', description: 'd', scores: cells({ alpha: 'good', beta: 'good', gamma: 'excellent', [OUR_PRODUCT_SLUG]: 'no' }) },
      { name: 'Ad Blocking', description: 'd', scores: cells({ alpha: 'excellent', beta: 'excellent', gamma: 'no', [OUR_PRODUCT_SLUG]: 'good' }) },
    ],
    verdict: { summary, bestFor },
  });
  const verdict = (summary: string, bestFor: ComparisonFile['verdict']['bestFor'] = []) => verdictSuperlativeProblems(page(summary, bestFor), 'x');

  it('lets the top-rated products, all of them when tied, be called the best', () => {
    expect(verdict('Alpha and Beta tie for the highest score on these criteria.')).toEqual([]);
    expect(verdict('Alpha scores highest.')).toHaveLength(1); // Beta ties it
    expect(verdict('Gamma Tool is the best choice.')).toHaveLength(1);
    expect(verdict('Beta leads, with Alpha level.')).toEqual([]);
  });

  it('lets a superlative limited to one criterion through only for the product with the top cell there', () => {
    expect(verdict('Gamma Tool scores highest for voice privacy.')).toEqual([]);
    expect(verdict('Alpha scores highest for voice privacy.')).toHaveLength(1);
    expect(verdict('x', [{ useCase: 'Voice', product: 'Gamma Tool', reason: 'The best voice privacy score here' }])).toEqual([]);
    expect(verdict('x', [{ useCase: 'Top pick', product: 'Gamma Tool', reason: 'Cheap' }])).toHaveLength(1);
  });

  it('ignores general remarks', () => {
    expect(verdict('The best way to start is with a free tool.')).toEqual([]);
    expect(verdict('The best choice depends on what you need.')).toEqual([]);
  });

  it('never lets us be called the best unless we rank first, anywhere on the page', () => {
    expect(ourSuperlatives(page('Alpha scores highest, ahead of Incognito Browser.'))).toEqual([]);
    expect(ourSuperlatives(page('Incognito Browser, which we make, is the best choice for Android.'))).toHaveLength(1);
    expect(ourSuperlatives(page('x', [], 'The top private browser'))).toHaveLength(1);
    // Each passed before the 2026-09-10 review.
    expect(ourSuperlatives(page('Incognito Browser, which we make, scores lowest. It is the best choice for Android.'))).toHaveLength(1);
    expect(ourSuperlatives(page('For Android, Incognito Browser is the clear winner.'))).not.toEqual([]);
    const pro = page('x');
    pro.products[3].pros = ['Our pick for Android users'];
    expect(ourSuperlatives(pro)).toHaveLength(1);
  });

  it('counts "winner", "top recommendation" and "recommended over" as superlatives, and a use case starting "Best"', () => {
    expect(verdict('Gamma Tool is our top recommendation.')).toHaveLength(1);
    expect(verdict('Gamma Tool is the clear winner.')).toHaveLength(1);
    expect(verdict('We recommend Gamma Tool over Alpha.')).toHaveLength(1);
    expect(verdict('x', [{ useCase: 'Best for most people', product: 'Gamma Tool', reason: 'Nothing to set up' }])).toHaveLength(1);
    expect(verdict('x', [{ useCase: 'Best for most people', product: 'Alpha', reason: 'Ties for the top score' }])).toEqual([]);
    expect(verdict('x', [{ useCase: 'Best for voice privacy', product: 'Gamma Tool', reason: 'Top cell for voice' }])).toEqual([]);
  });

  it('checks superlatives in FAQ answers, the intro and the meta description too', () => {
    const faq = page('x');
    faq.faqs = [{ question: 'Which should I pick?', answer: 'Gamma Tool is the best choice for most people.' }];
    expect(verdictSuperlativeProblems(faq, 'x')).toHaveLength(1);
    expect(verdictSuperlativeProblems({ ...page('x'), intro: 'Gamma Tool is the top-rated tool here.' }, 'x')).toHaveLength(1);
    expect(verdictSuperlativeProblems({ ...page('x'), metaDescription: 'Gamma Tool is the best ad blocker.' }, 'x')).toHaveLength(1);
  });

  it('checks places, "next", "lowest" and written ratings against the table', () => {
    const ranking = (summary: string, bestFor: ComparisonFile['verdict']['bestFor'] = []) => rankingClaimProblems(page(summary, bestFor));
    // Alpha and Beta tie at places 1–2; Gamma Tool is 3rd (the second group); ours is 4th and last.
    expect(ranking('Alpha and Beta tie for first. Gamma Tool is third. Incognito Browser, which we make, scores lowest.')).toEqual([]);
    expect(ranking('Gamma Tool is second.')).toEqual([]); // the second group
    expect(ranking('Beta is a close second.')).toEqual([]); // its tie spans place 2
    expect(ranking('Gamma Tool is fourth.')).toHaveLength(1);
    expect(ranking('Incognito Browser, which we make, is second.')).toHaveLength(1);
    expect(ranking('Gamma Tool scores lowest.')).toHaveLength(1);
    expect(ranking('Gamma Tool scores lowest for ad blocking.')).toEqual([]); // its cell is No there
    expect(ranking('Alpha scores lowest for ad blocking.')).toHaveLength(1);
    expect(ranking('Alpha rates 8.8/10.')).toEqual([]);
    expect(ranking('Alpha rates 9.5/10.')).toHaveLength(1);
    expect(ranking('Alpha and Beta tie for the top score. Gamma Tool comes next.')).toEqual([]);
    expect(ranking('Alpha and Beta tie for the top score. Incognito Browser comes next.')).toHaveLength(1);
    expect(ranking('Alpha and Beta tie for the top score, followed by Gamma Tool and Incognito Browser.')).toEqual([]);
    expect(ranking('Alpha and Beta tie for the top score, followed by Incognito Browser and Gamma Tool.')).not.toEqual([]);
    expect(ranking('x', [{ useCase: 'Voice', product: 'Gamma Tool', reason: 'Top voice cell, and it comes second overall' }])).toEqual([]);
    expect(ranking('x', [{ useCase: 'Voice', product: 'Gamma Tool', reason: 'Top voice cell, but it scores lowest here' }])).toHaveLength(1);
    // "Listed first" is the alphabetical tie-break, not a place; "third-party" is not a place either.
    expect(ranking('Alpha and Beta tie for first; Alpha is listed first alphabetically. Gamma Tool blocks third-party cookies.')).toEqual([]);
  });

  it('lets a bestFor name us only if we rank first, have the top cell on a criterion it names, or it says where we rank', () => {
    const ours = (useCase: string, reason: string) => ourBestForProblems(page('x', [{ useCase, product: OUR_NAME, reason }]));
    expect(ours('Private browsing on Android', 'Always private, and it wipes cookies on exit')).toHaveLength(1);
    expect(ours('Private browsing on Android', 'Always private. It ranks last on these criteria')).toEqual([]);
    expect(ours('Ad blocking on Android', 'Built-in ad blocker')).toHaveLength(1); // Good, not the top cell
    const top = page('x', [{ useCase: 'Ad blocking on Android', product: OUR_NAME, reason: 'Built-in ad blocker' }]);
    top.features[1].scores![OUR_PRODUCT_SLUG] = { value: 'excellent' };
    expect(ourBestForProblems(top)).toEqual([]);
  });
});

// --- the real data ---------------------------------------------------------

describe('every comparison in data/comparisons scores under the rubric', () => {
  it('finds the comparison files', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(30);
  });

  it('every reviewed scoped superlative is still on its page', () => {
    for (const e of SCOPED_SUPERLATIVE) {
      expect(FILES).toContain(e.file);
      expect(rankingTexts(load(e.file)).some((t) => t.text.includes(e.words)), `${e.file}: "${e.words}"`).toBe(true);
      expect(e.reason.trim()).not.toBe('');
    }
  });

  it.each(FILES)('%s uses only rubric values and yields a rating or "Not enough data" for every product', (file) => {
    const data = load(file);
    const scores = scoreProducts(data);
    expect(scores.map((s) => s.rank)).toEqual(data.products.map((_, i) => i + 1));
    for (const s of scores) {
      if (s.rating === null) continue;
      expect(s.rating).toBeGreaterThanOrEqual(0);
      expect(s.rating).toBeLessThanOrEqual(10);
      expect(Math.round(s.rating * 10) / 10).toBe(s.rating);
    }
    // The page renders from the view; it must score identically.
    expect(scoreProducts(toComparisonView(data))).toEqual(scores);
  });
});

describe('catalogue rules for every comparison', () => {
  it.each(FILES)('%s: no typed rating, platforms on every product, every cell keyed by a product slug', (file) => {
    const d = load(file);
    const problems: string[] = [];
    const slugs = new Set(d.products.map((p) => p.slug));
    for (const p of d.products) {
      if ('rating' in p) problems.push(`${p.slug} still has a typed products[].rating`);
      const platforms = p.platforms;
      if (!Array.isArray(platforms) || platforms.length === 0 || !platforms.every((s) => typeof s === 'string' && s.trim())) {
        problems.push(`${p.slug} has no platforms list`);
      }
    }
    for (const f of d.features) {
      for (const key of Object.keys(f.scores ?? {})) {
        if (!slugs.has(key)) problems.push(`criterion "${f.name}" has a cell keyed "${key}", not a product slug`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(FILES)('%s: no year in the title or meta description', (file) => {
    const d = load(file);
    expect([d.title, d.metaDescription].filter((s) => /\b(?:19|20)\d\d\b/.test(s ?? ''))).toEqual([]);
  });

  it.each(FILES)('%s: claims no testing or expert review', (file) => {
    const found = textsOf(load(file)).filter((t) => TESTING.test(t.text)).map((t) => `${t.where}: ${t.text}`);
    expect(found).toEqual([]);
  });

  it.each(FILES)('%s: has no product-mention scrub leftovers, shown or kept (notes, keywords, pro_tips)', (file) => {
    const found = textsOf(load(file)).filter((t) => SCRUB_LEFTOVER.test(t.text)).map((t) => `${t.where}: ${t.text}`);
    expect(found).toEqual([]);
  });

  it.each(FILES)('%s: every bestFor names a product on the page', (file) => {
    const d = load(file);
    const names = new Set(d.products.map((p) => p.name));
    expect(d.verdict.bestFor.map((b) => b.product).filter((n) => !names.has(n))).toEqual([]);
  });

  it.each(FILES)('%s: the verdict, bestFor, FAQs, intro and meta call only the top-rated product(s) the best', (file) => {
    expect(verdictSuperlativeProblems(load(file), file)).toEqual([]);
  });

  it.each(FILES)('%s: every place, "next", "lowest" and rating the prose states matches the table', (file) => {
    expect(rankingClaimProblems(load(file))).toEqual([]);
  });

  it.each(FILES)("%s: fits the schema's length limits (meta description, intro)", (file) => {
    const d = load(file);
    const over = [
      ['metaDescription', d.metaDescription, META_MAX],
      ['intro', d.intro, INTRO_MAX],
    ] as const;
    expect(over.filter(([, s, max]) => (s ?? '').length > max).map(([k, s, max]) => `${k} is ${(s ?? '').length} characters (max ${max})`)).toEqual([]);
  });

  it.each(FILES)('%s: speed and performance are scored only where a third-party measurement is cited (sitewide policy)', (file) => {
    // A speed, performance, latency or resource-use cell for anyone but us
    // must cite a measurement from MEASUREMENT_SOURCES in its note, else it is
    // '—'. A criterion left with no such cell is deleted, so ours is never the
    // only product assessed on it. (Ours is 'no': IB_BACKING has no speed entry.)
    const d = load(file);
    const problems: string[] = [];
    for (const f of d.features.filter((x) => SPEED_CRITERION.test(x.name))) {
      const assessed = d.products.filter((p) => p.slug !== OUR_PRODUCT_SLUG && readCell(cellFor(f, p)?.value) !== null);
      if (!assessed.length) problems.push(`"${f.name}" has no assessed cell but ours: delete the criterion`);
      for (const p of assessed) {
        const cell = cellFor(f, p)!;
        if (!MEASUREMENT_SOURCES.some((s) => (cell.note ?? '').includes(s))) {
          problems.push(`"${f.name}" for ${p.name} is '${cell.value}' with no third-party measurement cited (note: "${cell.note ?? ''}"): make it '—'`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(FILES)('%s: a cell that follows a third-party lab result says so where the page shows it', (file) => {
    // Cell notes aren't rendered, so the lab has to be named in text that is.
    const d = load(file);
    const shown = textsOf(d).filter((t) => t.shown).map((t) => t.text).join('\n');
    const used = MEASUREMENT_SOURCES.filter((s) => d.features.some((f) => d.products.some((p) => (cellFor(f, p)?.note ?? '').includes(s))));
    expect(used.filter((s) => !shown.includes(s))).toEqual([]);
  });
});

// --- Incognito Browser in the data -------------------------------------------

describe('Incognito Browser in data/comparisons (owner decision, 2026-09-10)', () => {
  it('the backing map and the allowlists point at real things', () => {
    const featureIds = new Set(BRAND.features.map((f) => f.id));
    const topLevel = ['platform', 'pricing', 'dataSafety'] as const;
    for (const [criterion, b] of Object.entries(IB_BACKING)) {
      expect(criterion).toBe(criterionKey(criterion));
      expect(b.facts.length, criterion).toBeGreaterThan(0);
      for (const fact of b.facts) {
        const known = featureIds.has(fact) || (topLevel.includes(fact as (typeof topLevel)[number]) && BRAND[fact as (typeof topLevel)[number]] != null);
        expect(known, `${criterion}: "${fact}" is not in data/brand.json`).toBe(true);
      }
      if (b.max) expect(POINTS[b.max], criterion).toBeGreaterThan(0);
      if (b.max) expect(POINTS[b.max], criterion).toBeLessThan(1);
      expect(b.why.trim(), criterion).not.toBe('');
      // Reviewed for pages that compare us and have that criterion.
      expect(b.on.length, criterion).toBeGreaterThan(0);
      for (const file of b.on) {
        expect(IB_COMPARABLE, `${criterion}: ${file}`).toContain(file);
        expect(load(file).features.map((f) => criterionKey(f.name)), `${criterion} is not a criterion on ${file}`).toContain(criterion);
      }
    }
    // Never a criterion on one of brand.json's never-claims.
    expect(Object.keys(IB_BACKING).filter((c) => /fingerprint|vpn|\btor\b|onion|open source|anonym|all platforms|\bios\b|desktop/.test(c) || NEVER_CLAIM_CRITERION.test(c))).toEqual([]);
    // Reviewed 2026-09-10: no tracker blocker or fingerprint protection is documented, and
    // having no history on the device doesn't stop an engine's account history syncing.
    expect(IB_BACKING).not.toHaveProperty('tracker blocking');
    expect(IB_BACKING).not.toHaveProperty('user agent randomization');
    expect(IB_BACKING['cross-device sync protection']?.max).toBe('partial');
    for (const f of IB_COMPARABLE) expect(FILES).toContain(f);
    for (const e of NOT_A_BROWSER_CRITERION) {
      expect(IB_COMPARABLE).toContain(e.file);
      expect(e.reason.trim()).not.toBe('');
      const d = load(e.file);
      const ib = d.products.find((p) => p.slug === OUR_PRODUCT_SLUG);
      const f = d.features.find((x) => x.name === e.criterion);
      expect(ib && f, `${e.file}: "${e.criterion}" is not a criterion on a page that compares us`).toBeTruthy();
      expect(readCell(cellFor(f!, ib!)?.value), `${e.file}: "${e.criterion}" is exempt, so our cell should be '—'`).toBeNull();
    }
  });

  it.each(FILES)('%s: lists our product under its own slug, and names it only if it compares it', (file) => {
    const d = load(file);
    const problems: string[] = [];
    for (const p of d.products) {
      if (looksOurs(p) && p.slug !== OUR_PRODUCT_SLUG) problems.push(`"${p.name}" (${p.website ?? 'no website'}) is our product but has the slug "${p.slug}", so the page would show no disclosure`);
      if (p.slug === OUR_PRODUCT_SLUG && p.name !== OUR_NAME) problems.push(`the ${OUR_PRODUCT_SLUG} row is named "${p.name}"`);
    }
    if (!includesOurProduct(d.products)) {
      for (const t of textsOf(d)) {
        if (NAMES_US.test(t.text) || POINTS_AT_US.test(t.text)) problems.push(`points at our product without comparing it, so there is no disclosure (${t.where}): ${t.text}`);
      }
    }
    expect(problems).toEqual([]);
  });

  // One block per page that compares it. (A loop, so no page means no block.)
  for (const file of FILES.filter((f) => includesOurProduct(load(f).products))) {
    describe(file, () => {
      const d = load(file);
      const ib = d.products.find((p) => p.slug === OUR_PRODUCT_SLUG)!;

      it('is on a page where it is the same kind of product as the others (IB_COMPARABLE)', () => {
        expect(IB_COMPARABLE).toContain(file);
      });

      it('has the name, pricing and platforms data/brand.json supports', () => {
        expect({ name: ib.name, pricing: ib.pricing, platforms: ib.platforms }).toEqual({
          name: OUR_NAME,
          pricing: OUR_PRICING,
          platforms: [BRAND.platform],
        });
      });

      it('gets credit only where a data/brand.json fact backs the criterion (IB_BACKING)', () => {
        const problems: string[] = [];
        for (const f of d.features) {
          const value = readCell(cellFor(f, ib)?.value);
          if (value === null || POINTS[value] === 0) continue;
          const backing = IB_BACKING[criterionKey(f.name)];
          if (NEVER_CLAIM_CRITERION.test(`${f.name} ${f.description}`)) {
            // Whatever it is called: a fingerprinting row renamed "Tracking Protection" still gives no credit.
            problems.push(`"${f.name}" is '${value}', but it is about one of brand.json's never-claims ("${f.description}"): it can only be 'no'`);
          } else if (!backing) {
            problems.push(`"${f.name}" is '${value}', but no data/brand.json fact backs it: make it 'no', or add a reviewed entry to IB_BACKING`);
          } else if (!backing.on.includes(file)) {
            problems.push(`"${f.name}" is '${value}', but IB_BACKING's entry was reviewed only for ${backing.on.join(', ')}: make it 'no', or review this page and add it`);
          } else if (backing.max && POINTS[value] > POINTS[backing.max]) {
            problems.push(`"${f.name}" is '${value}', but ${backing.facts.join(' + ')} support at most '${backing.max}' (${backing.why})`);
          }
        }
        expect(problems).toEqual([]);
      });

      it("is assessed on every criterion, 'no' where unbacked (bar NOT_A_BROWSER_CRITERION)", () => {
        const exempt = new Set(NOT_A_BROWSER_CRITERION.filter((e) => e.file === file).map((e) => e.criterion));
        const blank = d.features.filter((f) => readCell(cellFor(f, ib)?.value) === null && !exempt.has(f.name)).map((f) => f.name);
        expect(blank, "a criterion we can't back is 'no' for us, not '—'").toEqual([]);
      });

      it('is never the only product assessed on a criterion', () => {
        // A row only we are scored on says nothing about the others and can only
        // count against us for want of documentation: delete it instead.
        const alone = d.features.filter((f) => !d.products.some((p) => p.slug !== OUR_PRODUCT_SLUG && readCell(cellFor(f, p)?.value) !== null));
        expect(alone.map((f) => f.name)).toEqual([]);
      });

      it('is called best or top nowhere unless the table ranks it first', () => {
        expect(ourSuperlatives(d)).toEqual([]);
      });

      it('gets a bestFor card only if it ranks first, has the top cell on a criterion the card names, or the card says where it ranks', () => {
        expect(ourBestForProblems(d)).toEqual([]);
      });
    });
  }
});

// --- the generator's schema ----------------------------------------------------

describe('scripts/schemas/comparison.schema.json matches the rubric', () => {
  const product = SCHEMA.properties.products.items;
  const cell = SCHEMA.properties.features.items.properties.scores.additionalProperties;

  it('allows exactly the rubric values in a cell, not-assessed ones included', () => {
    expect([...cell.properties.value.enum].sort()).toEqual([...Object.keys(POINTS), ...NOT_ASSESSED].sort());
    expect(cell.required).toContain('value');
  });

  it('has no typed rating (ratings come from the table) and requires a platforms list', () => {
    expect(product.required).not.toContain('rating');
    expect(product.properties).not.toHaveProperty('rating');
    expect(product.not).toEqual({ required: ['rating'] });
    expect(product.required).toContain('platforms');
    expect(product.properties.platforms).toMatchObject({ type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 });
  });

  it('has the length limits the data rules enforce', () => {
    expect([META_MAX, INTRO_MAX, SCHEMA.properties.title.maxLength]).toEqual([160, 300, 70]);
  });
});
