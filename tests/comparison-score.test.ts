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
 * the slug check (so the disclosure always renders). Every real comparison is
 * also rendered, to check that the disclosure, the "We make this" badge and
 * the note under the table appear exactly on the pages that compare it.
 *
 * The prose checks hold the page to its own table: superlatives ("tops the
 * table", "wins", "the strongest fingerprinting protection", an editor's
 * choice), places ("second", "number two", "in last place"), ties ("share
 * third place", "score the same", "level with"), one product ranked against
 * another either way round ("X beats Y", "X is outscored by Y"), ratings
 * written out ("earns a 9.5"), and the same product scored the same on the
 * same criterion on every page — under a reviewed alias map, so renaming a
 * row ("Brave Browser", "DeleteMe (Abine)", "Usability") doesn't hide a
 * crossed cell.
 */
import { describe, expect, it, vi } from 'vitest';
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

/**
 * A sample source. Its rating order (Vivaldi 9.2, Firefox 7.5, ours 3.3) is
 * not its alphabetical order (Firefox, Incognito Browser, Vivaldi), so a page
 * that sorted by name, or by the order the data lists them in, would fail.
 */
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
      { name: 'Vivaldi', slug: 'vivaldi', tagline: 'Theirs', pricing: 'Free', platforms: ' Android, iOS, desktop ', pros: [], cons: [], rating: 1, pricing_note: 'x' } as ComparisonSource['products'][number],
      { name: 'Firefox', slug: 'firefox', tagline: 'Also theirs', pros: [], cons: [], rating: 5 } as ComparisonSource['products'][number],
    ],
    features: [
      { name: 'Ad blocking', description: 'd1', scores: { 'incognito-browser': { value: 'yes', note: 'NOTE-SHOULD-NOT-SHIP' }, vivaldi: { value: 'yes' }, firefox: { value: 'partial' } } },
      { name: 'Open source', description: 'd2', scores: { 'Incognito Browser': { value: 'no' }, Vivaldi: { value: 'yes' }, Firefox: { value: 'yes' } } },
      { name: 'Sync', description: 'd3', scores: { 'incognito-browser': { value: 'no' }, vivaldi: { value: 'good' } } },
    ],
    verdict: { summary: 'Summary.', bestFor: [{ useCase: 'u', product: 'Vivaldi', reason: 'r' }] },
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
    expect(view.features[1].scores).toEqual({ 'incognito-browser': { value: 'no' }, vivaldi: { value: 'yes' }, firefox: { value: 'yes' } });
    expect(view.features[2].scores).toEqual({ 'incognito-browser': { value: 'no' }, vivaldi: { value: 'good' } });
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
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/** What the page says, word for word, on a page that compares Incognito Browser. */
const DISCLOSURE =
  'We make Incognito Browser, one of the products compared here. It is scored with the same rubric as every other product, from the table on this page.';
const IB_NO_NOTE = "“No” for Incognito Browser can also mean a feature isn't documented.";
const WE_MAKE_THIS = 'We make this';
/** The dash's legend, on a table with a gap. */
const DASH_LEGEND = "not assessed or doesn't apply, and not counted in the rating";

/** The product cards' names, in the order the page shows them. */
const cardNames = (html: string) => [...html.matchAll(/<h3 class="font-semibold text-t1">([^<]*)<\/h3>/g)].map((m) => text(m[1]).trim());
/** The table's column headings, in the order the page shows them. */
const columnNames = (html: string) => [...html.matchAll(/<th scope="col" class="text-center[^"]*">([^<]*)<span/g)].map((m) => text(m[1]).trim());
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * Is the element carrying this testid hidden from the reader? Its own tag
 * saying `hidden`, `aria-hidden="true"`, a class that hides it or an inline
 * display:none, or a `<details>` still open around it. The disclosure and the
 * "No" note are only a disclosure if someone can see them (Wave 3 verifier,
 * 2026-09-11: `hidden` on the aside, or `sr-only` on the note, passed).
 */
/** Tags that hold nothing, so they are never an ancestor. */
const VOID_TAG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
/** The tags still open at `at`, outermost first: the element's ancestors. */
function ancestorsOf(html: string, at: number): string[] {
  const open: string[] = [];
  for (const m of html.slice(0, at).matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const name = m[2].toLowerCase();
    if (m[1]) {
      const i = open.map((t) => (/^<\/?([a-zA-Z][\w-]*)/.exec(t)?.[1] ?? '').toLowerCase()).lastIndexOf(name);
      if (i >= 0) open.splice(i);
    } else if (!VOID_TAG.test(name) && !/\/\s*$/.test(m[3])) {
      open.push(m[0]);
    }
  }
  return open;
}
function hiddenAt(html: string, testid: string): string[] {
  const at = html.indexOf(`data-testid="${testid}"`);
  if (at < 0) return [`no element with data-testid="${testid}"`];
  const start = html.lastIndexOf('<', at);
  const tag = html.slice(start, html.indexOf('>', at) + 1);
  const problems: string[] = [];
  const check = (t: string, where: string) => {
    const className = /class(?:Name)?="([^"]*)"/.exec(t)?.[1] ?? '';
    const style = /style="([^"]*)"/.exec(t)?.[1] ?? '';
    if (/\shidden(?:[\s/>=])/.test(t)) problems.push(`${testid} is hidden${where}`);
    if (/aria-hidden="true"/.test(t)) problems.push(`${testid} is aria-hidden${where}`);
    for (const c of ['sr-only', 'invisible', 'hidden', 'opacity-0']) {
      if (className.split(/\s+/).includes(c)) problems.push(`${testid} has the class "${c}"${where}`);
    }
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) problems.push(`${testid} is styled out of sight${where}`);
  };
  check(tag, '');
  // Every tag it sits inside, too: a disclosure in a <div hidden> or an
  // sr-only wrapper is as invisible as one hidden itself, and the element's
  // own tag said nothing about it (Wave 4 verifier, 2026-09-11).
  for (const ancestor of ancestorsOf(html, start)) {
    check(ancestor, ` inside ${/^<[a-zA-Z][\w-]*/.exec(ancestor)?.[0] ?? '<?'}>`);
  }
  const before = html.slice(0, at);
  if (countOf(before, '<details') > countOf(before, '</details>')) problems.push(`${testid} is inside a <details>, so it starts folded away`);
  return problems;
}

describe('ComparisonPage', () => {
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
    // Visible: not hidden, aria-hidden, sr-only or folded into a <details>.
    expect(hiddenAt(html, 'comparison-disclosure')).toEqual([]);
  });

  it('hiddenAt catches the ways a disclosure can be there without being seen', () => {
    const html = render(source());
    expect(hiddenAt(html, 'comparison-disclosure')).toEqual([]);
    expect(hiddenAt(html.replace('<aside', '<aside hidden'), 'comparison-disclosure')).not.toEqual([]);
    expect(hiddenAt(html.replace('<aside', '<aside aria-hidden="true"'), 'comparison-disclosure')).not.toEqual([]);
    expect(hiddenAt(html.replace('<aside', '<aside style="display:none"'), 'comparison-disclosure')).not.toEqual([]);
    expect(hiddenAt(html.replace('<p class="text-meta text-t3 mt-3"', '<p class="sr-only"'), 'comparison-ib-no-note')).not.toEqual([]);
    expect(hiddenAt(`<details>${html}</details>`, 'comparison-ib-no-note')).not.toEqual([]);
    expect(hiddenAt(html, 'comparison-nothing-like-this')).not.toEqual([]);
    // A parent that hides it hides it too (Wave 4 verifier, 2026-09-11).
    const wrap = (open: string) => html.replace('<aside', `${open}<aside`).replace('</aside>', '</aside></div>');
    expect(hiddenAt(wrap('<div hidden>'), 'comparison-disclosure')).not.toEqual([]);
    expect(hiddenAt(wrap('<div class="sr-only">'), 'comparison-disclosure')).not.toEqual([]);
    expect(hiddenAt(wrap('<div aria-hidden="true">'), 'comparison-disclosure')).not.toEqual([]);
    expect(hiddenAt(wrap('<div style="display:none">'), 'comparison-disclosure')).not.toEqual([]);
    expect(hiddenAt(wrap('<div class="opacity-0">'), 'comparison-disclosure')).not.toEqual([]);
    // A parent that hides something else does not.
    expect(hiddenAt(`<div hidden>a</div>${html}`, 'comparison-disclosure')).toEqual([]);
  });

  it('discloses wherever the data lists Incognito Browser, not only when it is listed first', () => {
    // Four of the nine pages that compare it list it second to fifth.
    const src = source();
    src.products = [...src.products.slice(1), src.products[0]];
    const html = render(src);
    expect(countOf(html, 'data-testid="comparison-disclosure"')).toBe(1);
    expect(countOf(text(html), DISCLOSURE)).toBe(1);
    expect(countOf(text(html), WE_MAKE_THIS)).toBe(1);
    expect(countOf(text(html), IB_NO_NOTE)).toBe(1);
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
    const html = render(source());
    const t = text(html);
    // Vivaldi: yes, yes, good = 9.2. Ours: yes, no, no = 3.3. Firefox: partial,
    // yes and no cell on 3 criteria = 7.5. The data typed 1, 10 and 5.
    expect(t).toMatch(/Vivaldi Our rating: 9\.2\/10/);
    expect(t).toMatch(/Firefox Our rating: 7\.5\/10 2 of 3 criteria assessed/);
    expect(t).toMatch(/Incognito Browser We make this Our rating: 3\.3\/10/);
    // Highest rated first: not the data's order (ours, Vivaldi, Firefox), not A–Z (Firefox, ours, Vivaldi).
    expect(cardNames(html)).toEqual(['Vivaldi', 'Firefox', 'Incognito Browser']);
    expect(columnNames(html)).toEqual(['Vivaldi', 'Firefox', 'Incognito Browser']);
    expect(cardNames(html)).toEqual(scoreProducts(source()).map((s) => s.name));
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

  it('keeps the legend, and explains the dash as not assessed and not counted', () => {
    const t = text(render(source()));
    expect(t).toContain('whether it has the feature');
    expect(t).toContain('how well it does it');
    // The whole sentence: "…, and scored as zero" would contradict the rubric.
    expect(t).toContain(`— = A dash means ${DASH_LEGEND}`);
  });

  it("says under the table that No for Incognito Browser can mean a feature isn't documented, with the rubric link", () => {
    const html = render(source());
    expect(text(html)).toContain(IB_NO_NOTE);
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
    expect(text(render(src))).not.toContain(IB_NO_NOTE);
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
/** Text that names our product ("the Incognito app for Android" does too). */
const NAMES_US = /\bIncognito\s+(?:Browser|Pro|app)\b|\bIncognito\s+browser\s+app\b/i;
/**
 * Text that points at our product without naming it ("our own Android
 * browser", "our free Android browser", "which we make", "the browser we
 * develop").
 */
const POINTS_AT_US =
  /\b(?:which|that)\s+we\s+make\b|\bwe\s+(?:make|build|built|develop(?:ed|s)?|publish(?:ed)?|created?)\b|\bour\s+(?:own\s+)?(?:[\w'-]+\s+){0,3}(?:browser|app|product)s?\b/i;
/**
 * On a page that compares us, "Incognito" on its own is our product
 * ("Incognito, which we make, is the best choice"). Not a private window
 * ("Incognito Mode", "an Incognito tab"), and not Chrome's.
 */
const BARE_INCOGNITO = /(?<!\bChrome\s)\bIncognito\b(?!\s+(?:mode|window|tab)s?\b)/i;
/**
 * A bare "Ours", which is our product only where the sentence it answers says
 * what it is a product of: an FAQ answer to a question asking which to pick
 * ("Which browser do you recommend for Android?" / "Ours, hands down.").
 */
const BARE_OURS = /\bours\b/i;
/** Where a sentence points at our product, by name or otherwise, on a page that compares us. */
const ourSpans = (sentence: string) =>
  [NAMES_US, BARE_INCOGNITO, POINTS_AT_US].flatMap((re) => matchesOf(re, sentence).map((m) => m.index ?? 0));

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
 * pages it was reviewed for, with the words each page describes the criterion
 * in (`on`). The description is part of the review: re-describing "Automatic
 * History Deletion" as "Keeps your internet provider from seeing which sites
 * you visit" would keep the credit for a VPN-type feature otherwise (Wave 3
 * verifier, 2026-09-11). Keyed by criterion name in lower case.
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
const IB_BACKING: Record<string, { facts: string[]; max?: RatedValue; on: Array<{ file: string; description: string }>; why: string }> = {
  // The Play listing documents that an ad blocker exists, not how well it blocks, so it can't
  // draw level with Brave's "excellent" (privacy-browsers had it at "yes": Wave 2c review).
  'ad blocking': { facts: ['ad-blocker'], max: 'good', on: [{ file: IB_PAGE.adTracking, description: 'Blocks display ads, video ads, and sponsored content' }, { file: IB_PAGE.extensions, description: 'Blocks display ads, pop-ups, and video ads' }], why: 'built-in ad blocker' },
  'built-in ad blocking': { facts: ['ad-blocker'], max: 'good', on: [{ file: IB_PAGE.privacyBrowsers, description: 'Native ad blocking without extensions' }], why: 'built-in ad blocker' },
  'ad & tracker blocking': { facts: ['ad-blocker'], max: 'partial', on: [{ file: IB_PAGE.browserPrivacy, description: 'Built-in ability to block advertisements and tracking scripts' }], why: 'ads only; tracker blocking is not documented' },
  'ad tracking prevention': { facts: ['ad-blocker', 'wipe-on-exit'], max: 'partial', on: [{ file: IB_PAGE.searchHistory, description: 'Blocks advertisers from using search data for targeted ads' }], why: 'blocks ads and wipes cookies on exit; tracker blocking is not documented' },
  'tracking protection': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [{ file: IB_PAGE.incognitoMode, description: 'Blocks advertisers and websites from following your browsing activity across different sites' }], why: 'cookies can be switched off and are wiped on exit; no tracker blocker is documented' },
  'cross-site tracking prevention': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [{ file: IB_PAGE.adTracking, description: 'Stops advertisers from tracking you across different websites' }], why: 'cookies can be switched off and are wiped on exit; no tracker blocker is documented' },
  'cross-platform protection': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [{ file: IB_PAGE.socialMedia, description: 'Prevents data sharing between different social media platforms and third parties' }], why: 'cookie-based linking between sites stops when cookies are off or wiped' },
  'third-party cookie blocking': { facts: ['settings', 'wipe-on-exit'], max: 'partial', on: [{ file: IB_PAGE.cookies, description: 'Automatically blocks cookies from advertisers and trackers' }], why: 'a switch turns all cookies off (no third-party-only setting); cookies are wiped on exit' },
  'default privacy settings': { facts: ['wipe-on-exit', 'no-history'], max: 'good', on: [{ file: IB_PAGE.browserPrivacy, description: 'How well the browser protects privacy without manual configuration' }], why: 'always in private mode, keeping no history; no tracker or fingerprint blocking is documented' },
  'automatic history deletion': { facts: ['wipe-on-exit', 'no-history'], on: [{ file: IB_PAGE.searchHistory, description: 'Automatically removes search history without manual intervention' }], why: 'keeps no history and wipes the session on exit' },
  'cross-device sync protection': {
    facts: ['no-history'],
    max: 'partial',
    on: [{ file: IB_PAGE.searchHistory, description: 'Prevents search history from syncing across multiple devices' }],
    why: 'keeps no history on the device, so there is nothing local to sync; searches an engine keeps in your account (and syncs once you sign in) are not covered',
  },
  customization: { facts: ['settings'], max: 'partial', on: [{ file: IB_PAGE.extensions, description: 'Ability to customize blocking rules and settings' }], why: 'switches for images, JavaScript and cookies; no custom filter rules' },
  'customization options': { facts: ['settings'], max: 'partial', on: [{ file: IB_PAGE.adTracking, description: 'Ability to customize blocking rules and whitelist trusted sites' }], why: 'switches for images, JavaScript and cookies; no custom filter rules' },
  'ease of use': { facts: ['wipe-on-exit'], on: [{ file: IB_PAGE.adTracking, description: 'How simple it is to install and configure for optimal protection' }, { file: IB_PAGE.extensions, description: 'User interface and setup simplicity' }, { file: IB_PAGE.incognitoMode, description: 'How simple it is for average users to access and use the private browsing mode' }], why: 'always in private mode, with nothing to set up' },
  'ease of setup': { facts: ['wipe-on-exit'], on: [{ file: IB_PAGE.searchHistory, description: 'How simple it is to start protecting your search history' }], why: 'always in private mode, with nothing to set up' },
  'easy setup': { facts: ['wipe-on-exit'], on: [{ file: IB_PAGE.cookies, description: 'How simple it is to get started with cookie protection' }], why: 'always in private mode, with nothing to set up' },
  'search quality': { facts: ['search-engines'], on: [{ file: IB_PAGE.searchHistory, description: 'Quality and relevance of search results' }], why: 'results come from the engine you choose (Google, DuckDuckGo, Bing)' },
  'mobile support': { facts: ['platform'], max: 'partial', on: [{ file: IB_PAGE.searchHistory, description: 'Availability and functionality on mobile devices' }], why: 'an Android app; there is no iOS version' },
  'data collection transparency': { facts: ['dataSafety'], max: 'partial', on: [{ file: IB_PAGE.browserPrivacy, description: "Clear disclosure of what data is collected and how it's used" }], why: "Google Play's Data safety section says what it may collect" },
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
 * identify your device", "stops sites recognising your phone"), so their
 * vocabulary counts too.
 */
const NEVER_CLAIM_CRITERION =
  /fingerprint|canvas|webgl|audio\s+context|installed\s+fonts|screen\s+resolution|user[- ]agent|signatures?\b|identif(?:y|ies|ying|ication)|recogni[sz](?:e|es|ed|ing)|tell(?:s|ing)?\s+(?:you|your\s+(?:device|phone|browser))\s+apart|\bVPNs?\b|\bTor\b|\bonion\b|open[- ]?source|anonym|\bIP\s+address|encrypt/i;

/**
 * Third-party labs whose published results a cell may follow: the only way a
 * speed or performance cell gets a value (sitewide policy, 2026-09-11). A page
 * that uses one names it in text it shows. Adding a source is a reviewed
 * decision.
 */
const MEASUREMENT_SOURCES = ['AV-Comparatives', 'AV-TEST', 'SE Labs'] as const;
const SOURCE_ALT = MEASUREMENT_SOURCES.map((s) => s.replace(/[-\s]/g, '[- ]')).join('|');
/**
 * A criterion about speed, performance, latency or resource use, by its name
 * or its description ("Page Load Time", "Memory Usage", "How much battery the
 * app uses"). Not "Cost Efficiency", responsive web design or a support
 * team's responsiveness.
 */
const SPEED_CRITERION = new RegExp(
  [
    String.raw`\b(?:speed|speeds|fast(?:er|est)?|quick(?:er|est|ly)?|latency|performance|resources?|lightweight|overhead|slow(?:down|s)?)\b`,
    String.raw`\b(?:load(?:ing)?\s+times?|page\s+loads?|load\s+pages?)\b`,
    String.raw`\bmemory\s+(?:use|usage|footprint|consumption)\b|\b(?:less|little|more|much)\s+memory\b|\bCPU\b|\bRAM\b(?![- ]only)`,
    String.raw`\bbattery\s+(?:life|drain|use|usage|impact|consumption)\b|\b(?:less|little|more|much)\s+battery\b|\b(?:resource|system|bandwidth|CPU|RAM)\s+usage\b`,
    // Wave 3 verifier, 2026-09-11: a speed row under another name.
    String.raw`\bthroughput\b|\bbandwidth\b|\bpings?\b|\bdata\s+usage\b`,
    String.raw`\b(?:start[- ]?up|launch|boot|connection|connect)\s+times?\b|\b(?:download|upload)\s+(?:and\s+upload\s+)?(?:rates?|speeds?)\b`,
    String.raw`(?<!\b(?:cost|price|pricing|value)[- ])\befficien(?:t|cy|cies|tly)\b`,
    String.raw`\bresponsive(?:ness)?\b(?!\s+(?:of\s+)?(?:customer|support|service|staff|team|web\s*sites?|sites?|design|layouts?|mobile|web|pages?)\b)`,
  ].join('|'),
  'i',
);
/**
 * A cell note that cites a lab result: a lab's name followed, in the same
 * clause, by the test's name, its date or a figure ("AV-Comparatives April
 * 2026", "AV-Comparatives' March 2026 malware protection test"), with no
 * negation in the clause ("Not in AV-Comparatives' tests" cites nothing).
 */
const LAB = new RegExp(`\\b(?:${SOURCE_ALT})\\b`, 'gi');
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const LAB_RESULT = new RegExp(
  [
    String.raw`^(?:'s?)?\s+(?:[\w&+-]+\s+){0,4}?(?:${MONTH}(?:[-–]${MONTH})?\s+)?(?:19|20)\d\d\b`,
    String.raw`^(?:'s?)?\s+(?:[\w&+-]+\s+){0,4}?(?:tests?|reports?|awards?|results?|certification)\b`,
    String.raw`^(?:'s?)?[^.;]{0,40}?\d+(?:\.\d+)?\s*(?:%|ms|seconds?|points?)`,
  ].join('|'),
  'i',
);
const LAB_NEGATION = /\b(?:not|no|never|none|without|lacks?|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|hasn't|haven't)\b/i;
function citesLabResult(note: string): boolean {
  return note.split(/[.;](?=\s|$)/).some(
    (clause) => !LAB_NEGATION.test(clause) && matchesOf(LAB, clause).some((m) => LAB_RESULT.test(clause.slice((m.index ?? 0) + m[0].length))),
  );
}
/**
 * A speed or resource-use claim in prose: allowed only in a sentence that
 * names the lab it comes from. "Blazing fast, even on older phones" and
 * "barely touches your battery" are claims too (Wave 3 verifier,
 * 2026-09-11); "acting fast is crucial" and "how fast a browser feels" are
 * not, so bare "fast" only counts where something is said to be fast.
 */
const SPEED_CLAIM = new RegExp(
  [
    String.raw`\b(?:fastest|quickest|speediest|lightweight|light[- ]weight|low[- ]latency)\b`,
    String.raw`\b(?:faster|quicker|speedier)\s+than\b`,
    String.raw`\b(?:uses?|using)\s+(?:less|little|minimal|very\s+little)\s+(?:memory|RAM|CPU|battery|resources)\b`,
    String.raw`\bblazing\b|\blightning[- ]fast\b|\bspeedy\b|\bsnappy\b|\bzippy\b`,
    String.raw`\b(?:is|are|was|were|stays?|stayed|remains?|feels?|felt|runs?|ran|loads?|loaded|browses?)\s+(?:(?:very|extremely|really|blazing|incredibly|super)\s+)?fast\b`,
    String.raw`\bbarely\s+(?:slows|slowed|touches|touched|uses|used|affects|affected|drains|drained|dents)\b`,
    // Wave 4 verifier, 2026-09-11: the same claim as a negation — "will not
    // slow your phone down", "no lag", "doesn't drain your battery".
    String.raw`\b(?:won't|will\s+not|doesn't|does\s+not|don't|do\s+not|never)\s+(?:\w+\s+){0,2}?(?:slow|slows|lag|lags|drain|drains|bog|bogs|hog|hogs)\b`,
    String.raw`\bno\s+(?:noticeable\s+)?(?:lag|slowdown|slow[- ]down|delay|overhead|battery\s+drain)\b`,
    String.raw`\bwithout\s+(?:the\s+)?(?:slowing|slowdown|lag|a\s+hit\s+to\s+\w+)\b`,
  ].join('|'),
  'i',
);
/** The sentences of a text that make a speed claim without naming the lab it comes from. */
const speedClaims = (text: string) => sentencesOf(text).filter((s) => SPEED_CLAIM.test(s) && !new RegExp(`\\b(?:${SOURCE_ALT})\\b`, 'i').test(s));

/** scripts/schemas/comparison.schema.json: what the generator is told a comparison file looks like. */
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'schemas', 'comparison.schema.json'), 'utf-8'));
const TITLE_MAX: number = SCHEMA.properties.title.maxLength;
const META_MAX: number = SCHEMA.properties.metaDescription.maxLength;
const INTRO_MAX: number = SCHEMA.properties.intro.maxLength;

/**
 * A claim that someone here checked the facts: "we verified every cell",
 * "every cell is cross-checked against the vendor's documentation", "each row
 * is double-checked". Checked on every page now, not only the methodology one
 * (Wave 3 verifier, 2026-09-11), so it must not catch a product's own
 * "independently audited no-logs policy", a tip to "verify the extension is
 * open source", or "no independently verified success-rate figures": the
 * claim has to be ours, or made of the product of checking.
 */
const VERIFICATION_CLAIM = new RegExp(
  [
    String.raw`\b(?:we|our\s+[\w'-]+)\s+(?:\w+\s+){0,3}?(?:verif|fact[- ]?check|double[- ]?check|cross[- ]?check|validat|audit|vett|confirm)\w*`,
    String.raw`\b(?:cells?|rows?|tables?|entr(?:y|ies)|data|pages?|facts?|claims?|figures?|numbers?|scores?|ratings?|everything)\b[^.]{0,24}?\b(?:is|are|was|were|been)\s+(?:\w+\s+){0,2}?(?:verified|fact[- ]?checked|double[- ]?checked|cross[- ]?checked|validated|audited|vetted|confirmed)\b`,
    String.raw`\b(?:fact[- ]?checked|double[- ]?checked|cross[- ]?checked)\b`,
    String.raw`\bchecked\s+against\b`,
  ].join('|'),
  'i',
);

/**
 * Claims of testing or expert review. The rubric reads published features;
 * nobody here tests them. "Tested as Norton Antivirus Plus", "tested by
 * AV-Comparatives" or "AV-TEST benchmarked it" reports a third-party lab and
 * passes, and so does "we haven't measured it".
 */
const TESTING = new RegExp(
  [
    String.raw`\bwe(?:'ve|\s+have)?\s+(?:\w+\s+)?tested\b|\bwe\s+test\b`,
    String.raw`\bexpert[- ](?:tested|reviewed|reviews?|rated|ratings?|guide|picks?|analysis)\b|\bexperts?\b[^.]{0,20}\btest`,
    String.raw`\b(?:was|were|been)\s+(?:\w+\s+)?tested\b(?!\s+(?:as\b|(?:by|in)\s+(?:${SOURCE_ALT})\b))`,
    String.raw`\bin\s+(?:our\s+)?(?:tests?|testing)\b|\bour\s+(?:own\s+)?(?:tests?|testing|lab)\b`,
    String.raw`\bhands[- ]on\b|\blab[- ]tested\b|\btested\s+by\s+(?:us|our)\b`,
    // "Our editors tested each tool", "We tried every tool for a month" (not "we haven't measured it").
    String.raw`\b(?:editors?|reviewers?|team|staff|writers?|testers?|we)\b(?:(?!\bnot\b|\bnever\b|n't\b)[^.]){0,20}?\b(?:tested|tried|trialled|trialed|benchmarked|measured)\b`,
    // "After testing each tool" (not "after you stop using the app", nor "after testing your DNS").
    String.raw`\bafter\s+(?:(?!(?:you|your|they|them|their|he|she|it|people|users?|someone|stop|stopping|quit|quitting)\b)[\w-]+\s+){0,3}?(?:testing|trying|using)\b(?!\s+(?:your|a\s+public|public)\b)`,
    // "We benchmarked each tool", unless a lab is named in the sentence.
    String.raw`(?<!\b(?:${SOURCE_ALT})\b[^.]*)\bbenchmark(?:ed|ing|s)?\b(?![^.]*\b(?:${SOURCE_ALT})\b)`,
    // Wave 3 verifier, 2026-09-11: "We ran each tool on the same Pixel phone
    // for a week", "Our reviewers evaluated each tool", "We put every tool
    // through the same checks". Not "we compared", which is what we do.
    String.raw`\b(?:we|our\s+(?:editors?|reviewers?|team|staff|writers?|testers?|analysts?))\b(?:(?!\bnot\b|\bnever\b|n't\b)[^.]){0,20}?\b(?:ran|run|used|installed|evaluated|reviewed|assessed|checked|inspected|examined)\s+(?:each|every|all\s+|both\s+|the\s+\w+\s+(?:tools?|apps?|products?|browsers?|services?|extensions?)\b)`,
    String.raw`\b(?:we|our\s+(?:editors?|reviewers?|team|staff|writers?|testers?|analysts?))\b(?:(?!\bnot\b|\bnever\b|n't\b)[^.]){0,20}?\bput\s+(?:[\w'-]+\s+){0,3}?through\b`,
    // Wave 4 verifier, 2026-09-11: hands-on testing said as time spent —
    // "We spent a month with each of these apps", "after a month of daily use".
    String.raw`\b(?:we|our\s+(?:editors?|reviewers?|team|staff|writers?|testers?|analysts?))\b(?:(?!\bnot\b|\bnever\b|n't\b)[^.]){0,20}?\bspent\s+(?:[\w'-]+\s+){0,3}?(?:hours?|days?|weeks?|months?|years?)\b`,
    String.raw`\bafter\s+(?:a|an|one|two|three|several|\d+)\s+(?:day|week|month|year)s?\s+(?:of\s+(?:daily\s+)?(?:use|using|testing)|with)\b`,
    String.raw`\b(?:we|our\s+(?:editors?|reviewers?|team|staff|writers?|testers?|analysts?))\s+(?:lived|sat)\s+with\b`,
  ].join('|'),
  'i',
);

/**
 * Leftovers of the product-mention scrub: "a privacy-focused browser" put
 * where our name was, including a text or sentence that starts "Use a
 * privacy-focused browser".
 */
const SCRUB_LEFTOVER =
  /\blike a privacy-focused browser\b|(?:^|[.!?]\s+|[a-z,]\s+)Use a privacy-focused browser\b|\bprivacy-focused browser\s*\((?:which\s+)?we\s+make\)|\bprivacy-focused browser from Google Play\b|\b(?:use|try|switch\s+to|consider|get|install|download|pick|choose)\s+a\s+privacy-focused\s+browser\b/i;

/**
 * A superlative whose criterion, if any, is the words right after it ("the
 * strongest fingerprinting protection here", "the most complete sharing
 * controls"), read like "the best" is.
 */
const SCOPED_BEST = String.raw`(?<!\b(?:its|their|your|our|my|her|his)\s)(?<!'s\s)\b(?:the\s+)?strongest\b|\bmost\s+(?:private|secure|complete|comprehensive|advanced|powerful|thorough|robust)\b`;

/**
 * A claim to be the best or top-rated. In the verdict, bestFor, FAQs, intro
 * and meta description, one may be made only for the top-rated product(s),
 * or, limited to one criterion ("the best phishing simulation score", "scores
 * highest for voice privacy"), only for a product with the top cell on that
 * criterion. A bestFor use case starting "Best …" is one too.
 */
const SUPERLATIVE = new RegExp(
  [
    String.raw`\bthe best\b(?!\s+(?:way|ways|time|approach|defen[cs]e|thing|things|practice|practices|place|bet|chance|chances|of\s+both\s+worlds)\b)`,
    String.raw`\bbest[- ](?:overall|all[- ]around|all[- ]rounder|choice|option|pick|value|in[- ]class)\b`,
    String.raw`\btop[- ](?:choice|pick|spot|score|scorer|scoring|rated|ranked|recommendation)\b`,
    String.raw`\bour\s+(?:top\s+)?(?:pick|recommendation)\b|\bwinners?\b`,
    String.raw`\brecommend(?:ed|s)?\s+(?:\S+\s+){0,4}?(?:above|over)\b`,
    String.raw`\bleads\b(?!\s+to\b)|\bleading\b`,
    String.raw`\b(?:scores?|scored|scoring|rated|rates|ranks?|ranked|comes?|came)\s+(?:the\s+)?highest\b`,
    String.raw`\bhighest[- ](?:score|scoring|scorer|rated|rating|ranked)\b`,
    String.raw`\branks?\s+(?:first|top)\b|\bnumber one\b|#1\b`,
    // Wave 3 verifier, 2026-09-11: "Privacy Badger tops the table", "wins
    // overall", "comes out on top", "offers the strongest protection of the
    // five", "the most private of the five", an editor's choice.
    String.raw`\btops\s+(?:the|this)\s+(?:table|list|ranking|rankings|ratings|chart|field)\b`,
    String.raw`\bwins?\b`,
    String.raw`\bcomes?\s+out\s+(?:on\s+top|ahead)\b`,
    // Wave 4 verifier, 2026-09-11: praise with no superlative word in it.
    String.raw`\btakes?\s+the\s+(?:crown|top\s+spot|honou?rs)\b`,
    String.raw`\bgold\s+standard\b|\bin\s+a\s+league\s+of\s+(?:its|their)\s+own\b`,
    String.raw`\bnothing\s+(?:else\s+)?(?:comes?|came)\s+close\b|\bno(?:thing)?\s+(?:one|other\s+\w+)\s+comes?\s+close\b`,
    String.raw`\bthe\s+(?:clear|obvious)\s+(?:choice|winner)\b|\bsets\s+the\s+standard\b`,
    SCOPED_BEST,
    String.raw`\beditors?'?s?\s+(?:choice|pick)\b`,
  ].join('|'),
  'i',
);
/** Wider, for anything said about our own product: no "best" of any kind unless the table ranks it first. */
const OUR_SUPERLATIVE = new RegExp(
  [
    SUPERLATIVE.source,
    String.raw`\bbest\b|\btop\b|\bultimate\b|\bunbeatable\b|\bstrongest\b|\bfastest\b|\bsafest\b`,
    String.raw`\bmost\s+(?:private|secure|complete|comprehensive|advanced|powerful)\b|\bmost\s+privacy[- ]\w+|\bmost\s+trust\w*`,
    String.raw`\bunrivall?ed\b|\bsecond\s+to\s+none\b|\bour\s+(?:choice|favou?rite)\b|\brecommend(?:ed|s|ation)?\b|\bstandout\b`,
    // Wave 3 verifier, 2026-09-11: "The pick for Android", "the one to get", "your go-to browser".
    String.raw`\bpicks?\b|\bthe\s+one\s+to\s+(?:get|use|install|pick|choose|beat)\b|\bgo[- ]to\b`,
    // Wave 4 verifier, 2026-09-11: a recommendation with no superlative word in
    // it — "If you only install one Android browser, make it …", "go with ours",
    // "hands down". Not "Install from Google Play and start browsing", which is
    // how to get it, not a claim to be the one to get.
    String.raw`\bif\s+you\s+(?:only|just)\s+(?:\w+\s+){0,2}?one\b`,
    String.raw`\bmake\s+it\s+(?:\w|ours\b)`,
    String.raw`\bgo\s+with\b|\bstick\s+with\b|\bstart\s+with\s+(?:it|ours|this\s+one)\b`,
    String.raw`\bhands\s+down\b|\bno\s+contest\b|\b(?:can't|cannot|won't)\s+go\s+wrong\b`,
    String.raw`\blook\s+no\s+further\b|\ball\s+you\s+need\b`,
  ].join('|'),
  'i',
);

/** Places a sentence can claim. */
const ORDINAL: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7,
};
const ORD = '(first|second|third|fourth|fifth|sixth|seventh|1st|2nd|3rd|4th|5th|6th|7th)';
/** "number one", "No. 2": a place written as a number (Wave 3 verifier, 2026-09-11). */
const CARDINAL: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const NUM = '(one|two|three|four|five|six|seven|[1-7])';
/**
 * A claimed place: "is second", "comes third", "ranks fourth overall", "a
 * close second", "tie for second", "ties Edge for second", "second-highest",
 * "in second place", "share third place", "is number two", "No. 3", "the
 * runner-up" (second). Not "third-party", and not "listed first" (the
 * alphabetical tie-break).
 */
const PLACE = new RegExp(
  [
    `\\b(?:is|are|comes?|came|ranks?|ranked|places?|placed|finish(?:es|ed)?|sits?|scores?|scored)\\s+(?:an?\\s+)?(?:(?:close|distant|clear|joint|equal)\\s+)?${ORD}\\b(?![- ]part)`,
    `\\bti(?:e|es|ed|ing)\\s+(?:\\S+\\s+){0,3}?for\\s+${ORD}\\b`,
    `\\bshar(?:e|es|ed|ing)\\s+(?:the\\s+)?${ORD}\\s+(?:place|spot|slot)\\b`,
    `\\b${ORD}[- ](?:highest|best|place|ranked|rated)\\b`,
    `\\bin\\s+${ORD}\\s+place\\b`,
    `\\brunners?[- ]up\\b`,
    `\\bnumber\\s+${NUM}\\b`,
    `\\bNo\\.\\s*${NUM}\\b`,
  ].join('|'),
  'i',
);
/** The place a PLACE match claims. */
const placeOf = (claim: string) => {
  if (/runners?[- ]up/i.test(claim)) return 2;
  const ord = claim.match(new RegExp(ORD, 'i'))?.[1];
  if (ord) return ORDINAL[ord.toLowerCase()];
  const num = claim.match(new RegExp(`(?:number|No\\.)\\s*${NUM}`, 'i'))?.[1] ?? '';
  return CARDINAL[num.toLowerCase()] ?? Number(num);
};
/** A place claimed for every product in a list with it: "X and Y tie for second", "X and Y share third place". */
const SHARED_PLACE = /^(?:ti|shar)/i;
/** "X comes next", "X and Y tie next", "next is X", "…, followed by X, Y and Z". */
const NEXT = /\b(?:comes?|came|is|are|ranks?|ti(?:e|es|ed))\s+next\b|\bnext\s+(?:is|are|comes?)\b|\bfollowed\s+by\b/i;
/** A claim to rate lowest: "scores lowest", "ranks last", "the lowest rating", "is in last place". */
const LAST_PLACE = String.raw`\bin\s+(?:the\s+)?(?:last|bottom)\s+(?:place|spot|slot)\b`;
const LOWEST = new RegExp(
  [
    String.raw`\b(?:scores?|scored|scoring|rates?|rated|ranks?|ranked|comes?|came|is|are|finish(?:es|ed)?|places?|placed|sits?)\s+(?:the\s+)?(?:lowest|last)\b`,
    String.raw`\blowest[- ](?:rated|scoring|ranked)\b|\bthe\s+lowest\s+(?:score|rating)\b|\bat\s+the\s+bottom\b`,
    LAST_PLACE,
  ].join('|'),
  'i',
);
/** The same, as a product's own row would say it ("Ranks last here"), and not "is the lowest-cost plan". */
const LOWEST_RANK = new RegExp(
  [
    String.raw`\b(?:scores?|scored|scoring|rates?|rated|ranks?|ranked|comes?|came|finish(?:es|ed)?|places?|placed|sits?)\s+(?:the\s+)?(?:lowest|last)\b`,
    String.raw`\blowest[- ](?:rated|scoring|ranked)\b|\bthe\s+lowest\s+(?:score|rating)\b`,
    LAST_PLACE,
  ].join('|'),
  'i',
);
/**
 * A rating written out: "7.5/10", "9 out of 10", "scores 9.5", "earns a 9.5"
 * (not an app store's "rated 4.7 stars" or "rated 4.7 on Google Play", a
 * measurement with a unit, or an address such as 1.1.1.1).
 */
const RATING_TEXT = new RegExp(
  [
    String.raw`\b(\d{1,2}(?:\.\d)?)\s*(?:\/\s*10|out\s+of\s+10)\b`,
    String.raw`\b(?:scores?|scored|rates?|rated|earns?|earned|gets?|got|takes?|posts?|lands?|manages?|hits?|achieves?|has|have|with|at)\s+(?:an?\s+)?(\d{1,2}\.\d)\b(?!\.\d)(?!\s*(?:\/|out\s+of|stars?|%|on\s+(?:Google\s+Play|the\s+(?:Play|App)\s+Store)|k?m\b|mm\b|cm\b|kg\b|[GMT]B\b|GHz\b|million|billion|[ap]\.?m\.?))`,
  ].join('|'),
  'i',
);
/** The rating a RATING_TEXT match states. */
const ratingIn = (m: RegExpMatchArray) => Number(m[1] ?? m[2]);
/** A statement of where a product ranks, as a bestFor naming ours must make unless it ranks first. */
const RANK_STATEMENT = new RegExp(`${PLACE.source}|${LOWEST.source}`, 'i');
/**
 * "X and Y tie for second", "ties Edge for second", "tie for the top score",
 * "tie next", "tie well behind them", "Tied top score", "Joint top score".
 * Every product in the tie must have the same rating; a product said to tie
 * on its own must share its rating with another.
 */
const TIE = new RegExp(
  [
    `\\b(?:ti(?:e|es|ed)|tying|joint|equal)\\b(?:\\s+(?:\\S+\\s+){0,3}?for\\s+(?:the\\s+)?(?:${ORD}|top|highest|lowest|last|bottom|best)\\b|\\s+(?:for\\s+)?(?:the\\s+)?(?:top|highest|lowest|last|bottom|next|${ORD})\\b|\\s+(?:(?:well|just|close|closely|narrowly|far)\\s+)?behind\\b|\\s+(?:at|on)\\s+\\d)`,
    // Wave 3 verifier, 2026-09-11: a tie said without the word.
    String.raw`\bshar(?:e|es|ed|ing)\s+(?:the\s+)?(?:${ORD}|top|highest|lowest|last|bottom|best)\s+(?:place|spot|slot|score|rating)\b`,
    String.raw`\b(?:scores?|scored|rates?|rated|ranks?|ranked|finish(?:es|ed)?)\s+the\s+same\b`,
    String.raw`\b(?:the|a)\s+same\s+(?:score|rating)\b|\bthe\s+same\s+(?:score|rating)\b`,
    String.raw`\b(?:is|are|was|were|sits?|stays?|finish(?:es|ed)?|comes?|came)\s+level\s+with\b|\bdraws?\s+level\b|\bdrew\s+level\b|\blevel\s+with\b`,
    // Wave 4 verifier, 2026-09-11: "neck and neck", "on par with", "evenly matched".
    String.raw`\bneck\s+and\s+neck\b|\bon\s+(?:a\s+)?par\s+with\b|\bevenly\s+matched\b|\bnothing\s+(?:to\s+choose|in\s+it)\b`,
  ].join('|'),
  'i',
);
/**
 * One product ranked against another: "X beats Y", "X finishes ahead of Y",
 * "X scores higher than Y" (UP: X must rate higher), "X trails Y", "X is
 * behind Y" (DOWN: X must rate lower). On a criterion ("beats Y on ad
 * blocking"), the cells there decide. Either side may be a list.
 */
const PAIR_UP =
  /\b(?:ahead\s+of|above|beats?|beating|beaten|outscor(?:es?|ed|ing)|outrank(?:s|ed|ing)?|outperform(?:s|ed|ing)?|outdo(?:es|ne)?|outclass(?:es|ed)?|surpass(?:es|ed)?|betters|tops|topped|edges?\s+(?:out|past)|(?:higher|better)\s+than|superior\s+to|leaves?\s+(?:[\w'-]+\s+){1,4}?behind|pulls?\s+ahead\s+of)\b/i;
const PAIR_DOWN = /\b(?:behind|below|trails?|trailed|trailing|(?:lower|worse)\s+than|los(?:es|t|e)\s+to|inferior\s+to|no\s+match\s+for)\b/i;
/**
 * The same, said the other way round: "X is outscored by Y", "X was beaten by
 * Y" put X below Y. Read as UP, "Google Activity Controls is outscored by
 * Incognito Browser" said the opposite of what it means (Wave 3 verifier,
 * 2026-09-11), so a passive is matched first and the UP or DOWN match inside
 * it is dropped.
 */
const PAIR_PASSIVE =
  /\b(?:is|are|was|were|been|being|gets?|got)\s+(?:\w+\s+){0,2}?(?:outscored|outranked|outperformed|outclassed|outdone|beaten|bettered|surpassed|topped|edged\s+(?:out\s+)?|pipped)\s+by\b/i;
/** Every match of a pattern in a string. */
const matchesOf = (re: RegExp, s: string) => [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))];

/**
 * Is the rank statement at `at` negated ("it is not ranked last", "doesn't
 * beat Brave")? A negator among the three words before it, in its clause. A
 * negated statement is checked the other way round.
 */
const RANK_NEGATOR = /^(?:not|never|no|nowhere|hardly|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|can't|cannot)$/i;
function negatedAt(sentence: string, at: number): boolean {
  const words = (sentence.slice(0, at).split(/[,.;:!?()—–]/).pop() ?? '').split(/\s+/).map((w) => w.replace(/[^\w']/g, '')).filter(Boolean);
  return words.slice(-3).some((w) => RANK_NEGATOR.test(w));
}
/** A rank statement in a text that isn't negated. */
const statesRank = (text: string) =>
  sentencesOf(text).some((s) => matchesOf(RANK_STATEMENT, s).some((m) => !negatedAt(s, m.index ?? 0)));

/**
 * An FAQ answer that starts by denying: "No.", "No, it doesn't", "Not on
 * these criteria", "It doesn't …", "It ranks last". Only a real denial
 * counts: "No doubt about it", "Not only", "Not surprisingly, yes" and "None
 * other than Incognito Browser" all start with a denial word and deny nothing
 * (Wave 3 verifier, 2026-09-11).
 */
const DENIAL_SUBJECT = String.raw`(?:it|they|incognito(?:\s+(?:browser|pro))?|the\s+(?:app|browser)|this\s+(?:app|browser))`;
const DENIAL_VERB = String.raw`(?:does\s+not|doesn't|do\s+not|don't|did\s+not|didn't|is\s+not|isn't|are\s+not|aren't|has\s+no|have\s+no|hasn't|haven't|cannot|can't|will\s+not|won't|never\b|lacks\b|ranks?\s+(?:last|lowest)|scores?\s+(?:last|lowest)|comes?\s+last)`;
const DENIAL_ANSWER = new RegExp(
  [
    String.raw`^\s*(?:no|nope|none|neither|never)\s*(?:[.,;:!—–]|$)`,
    String.raw`^\s*no\s*[,.]?\s+(?:${DENIAL_SUBJECT}|there|and|but|that|that's|you|we)\b`,
    String.raw`^\s*n(?:o|either)\s+[\w'-]+(?:\s+[\w'-]+){0,3}\s+(?:is|are|was|were)\s+(?:included|offered|documented|listed|claimed|built[- ]in|available|supported|part\s+of|top[- ]rated|the\s+best)\b`,
    String.raw`^\s*not\s+(?:yet\b|included\b|offered\b|documented\b|listed\b|claimed\b|available\b|supported\b|in\b|on\b|at\b|for\b|from\b|with\b|by\b|unless\b|without\b|really\b|quite\b)`,
    String.raw`^\s*there\s+(?:is|are|was|were)\s+no\b`,
    String.raw`^\s*${DENIAL_SUBJECT}\s+${DENIAL_VERB}`,
  ].join('|'),
  'i',
);
/**
 * What an answer says after its denial word: a denial opener answers the
 * question only if the answer does not go on to affirm it ("Nope — ours is",
 * "No, but it is"). Wave 4 verifier, 2026-09-11.
 */
const AFFIRMS = new RegExp(
  [
    String.raw`\byes\b|\byep\b|\bindeed\b`,
    String.raw`\b(?:it|they|we|you|that|this|ours|pro|incognito(?:\s+(?:browser|pro))?|the\s+(?:app|browser|subscription|upgrade|paid\s+[\w-]+|premium\s+[\w-]+))\s+(?:does|do|can|will|has|have|is|are)\b(?!\s+(?:not|never)\b)`,
    String.raw`\b(?:the\s+)?(?:best|top|one\s+to\s+(?:get|pick|use))\b`,
    String.raw`\bhands\s+down\b|\bno\s+contest\b`,
  ].join('|'),
  'i',
);
/** Is the phrase at `at` denied by a negator in the three words before it, in its clause? */
function negatedBeforeIn(text: string, at: number): boolean {
  const words = (text.slice(0, at).split(/[,.;:!?()—–]|\b(?:but|and|or)\b/i).pop() ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\w']/g, ''))
    .filter(Boolean)
    .slice(-3);
  return words.some((w) => RANK_NEGATOR.test(w));
}
/** Does this answer deny the question, or open with a denial word and then affirm it? */
function deniesAnswer(answer: string): boolean {
  const text = answer.trim();
  const m = DENIAL_ANSWER.exec(text);
  if (!m) return false;
  const rest = text.slice(m.index + m[0].length);
  return !matchesOf(AFFIRMS, rest).some((a) => !negatedBeforeIn(rest, a.index ?? 0));
}

/**
 * An FAQ question asking which product to pick: "Which tool is best on
 * Android?", "What should I use?", "What should Android users install?",
 * "Which one would you pick?" (Wave 3 verifier, 2026-09-11: it took best,
 * top, safest, most, recommend or "should I").
 */
const PICK_QUESTION = new RegExp(
  [
    String.raw`\b(?:which|what)\b[^?]*\b(?:best|top|safest|most\s+[\w-]+|recommend\w*)\b`,
    String.raw`\b(?:which|what)\b[^?]*\bshould\s+(?:i|you|we|people|users?|android\s+users?|someone|anyone)\b[^?]*\b(?:use|pick|choose|get|install|try|go\s+with|download)\b`,
    String.raw`\bshould\s+i\s+(?:use|pick|choose|get|install|try|go\s+with|download)\b`,
    String.raw`\b(?:which|what)\b[^?]*\b(?:would|do|did)\s+you\s+(?:pick|choose|get|use|install|recommend|suggest|go\s+with)\b`,
  ].join('|'),
  'i',
);

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
  const leads = direct || /^the best$/i.test(m[0].trim()) || new RegExp(`^(?:${SCOPED_BEST})$`, 'i').test(m[0].trim());
  const scoped = leads ? rest : (rest.match(/^\s+(?:for|at|in|on)\s+(.*)/i)?.[1] ?? '');
  return criterionIn(d, scoped);
}

/** The page's criterion that the first words of a phrase name, if any ("ad blocking on Android" → "Ad Blocking"). */
function criterionIn(d: ComparisonFile, phrase: string): ComparisonFile['features'][number] | undefined {
  const words = new Set(scopeWords(phrase.split(/[,.;:!?()]/)[0].split(/\s+/).slice(0, 6).join(' ')));
  let best: ComparisonFile['features'][number] | undefined;
  let hits = 0;
  for (const f of d.features) {
    const n = scopeWords(f.name).filter((w) => words.has(w)).length;
    if (n > hits) [best, hits] = [f, n];
  }
  return best;
}

/**
 * A product named as the other side of a comparison, which is not what the
 * rest of the sentence is about: "Tor Browser ties Safari for tracking
 * protection, has the strongest fingerprinting protection here…" is about Tor
 * Browser, not Safari.
 */
const OBJECT_BEFORE =
  /\b(?:ti(?:e|es|ed|ing)|beats?|beating|beaten|outscor\w*|outrank\w*|outperform\w*|outdo\w*|outclass\w*|surpass\w*|tops|topped|edges?|edged|trails?|trailed|trailing|than|behind|above|below|ahead\s+of|level\s+with|compared\s+(?:with|to)|unlike|versus|vs\.?)\s+(?:the\s+)?$/i;

/** Which product a superlative is about: the nearest one named before it, else the first named after it. */
function subjectOf(products: DataProduct[], sentence: string, at: number): DataProduct | undefined {
  let subject: DataProduct | undefined;
  let where = -1;
  let after: DataProduct | undefined;
  let afterAt = Infinity;
  for (const p of products) {
    for (const i of mentionsOf(sentence, p.name)) {
      if (i < at && i > where && !OBJECT_BEFORE.test(sentence.slice(Math.max(0, i - 30), i))) [subject, where] = [p, i];
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

interface PageText { where: string; text: string; ours: boolean; shown: boolean; question?: string; asked?: boolean }

/**
 * Every string a comparison file publishes or keeps about its products: not
 * the editorial, author or editor blocks. `ours` marks text about Incognito
 * Browser by position (its row, its cell notes, a bestFor naming it); `shown`
 * marks text the page renders (cell notes, keywords and pro_tips are not); an
 * FAQ answer carries its `question`.
 */
function textsOf(d: ComparisonFile): PageText[] {
  const out: PageText[] = [];
  const add = (where: string, text: unknown, ours = false, shown = true, question?: string, asked = false) => {
    if (typeof text === 'string' && text.trim()) out.push({ where, text: text.replace(/’/g, "'"), ours, shown, asked, ...(question === undefined ? {} : { question: question.replace(/’/g, "'") }) });
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
    add(`faqs[${i}].question`, q.question, false, true, undefined, true);
    add(`faqs[${i}].answer`, q.answer, false, true, q.question ?? '');
  });
  (d.pro_tips ?? []).forEach((s, i) => add(`pro_tips[${i}]`, s, false, false));
  return out;
}

/**
 * Which FAQ questions ask about our product: one that points at it, or one
 * that follows such a question and names no product at all, so the subject
 * carries over ("Is Incognito Browser free?" then "Is the paid tier the best
 * of these?"). The rule used to list the ways a question can refer back ("it",
 * "the app", "Pro"), and every round found another synonym outside the list
 * (Wave 4 verifier, 2026-09-11), so it is inverted: only naming another
 * product ends the chain. tests/no-vpn-claims.test.ts reads them the same way.
 */
function faqsAboutUs(d: ComparisonFile): boolean[] {
  const others = d.products.filter((p) => p.slug !== OUR_PRODUCT_SLUG);
  let previous = false;
  return (d.faqs ?? []).map((q) => {
    const question = (q.question ?? '').replace(/’/g, "'");
    const them = others.flatMap((p) => mentionsOf(question, p.name)).filter((i) => !asideAt(question, i));
    previous = ourSpans(question).length > 0 || (previous && them.length === 0);
    return previous;
  });
}

/** A text's sentences. "No. 2" is a place, not the end of one. */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/(?<=[.!?])\s+/)) {
    if (out.length && /\bNo\.$/.test(out[out.length - 1]) && /^\d/.test(part)) out[out.length - 1] += ` ${part}`;
    else out.push(part);
  }
  return out.filter((s) => s.trim());
}

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
function aliasesOf(name: string): string[] {
  const bare = name.replace(/\s*\([^)]*\)/g, '').trim();
  const aliases = new Set([name, bare]);
  const words = bare.split(/\s+/);
  for (const w of [words[0], words[words.length - 1]]) if (w.length >= 4 && !GENERIC_NAME_WORD.test(w)) aliases.add(w);
  return [...aliases];
}
const spansOf = (sentence: string, name: string) =>
  aliasesOf(name).flatMap((a) => [...sentence.matchAll(new RegExp(`(?<![\\w-])${escapeRe(a)}(?![\\w-])`, 'g'))].map((m) => ({ at: m.index ?? 0, end: (m.index ?? 0) + a.length })));
function mentionsOf(sentence: string, name: string): number[] {
  return spansOf(sentence, name).map((s) => s.at);
}
const namesProduct = (sentence: string, name: string) => mentionsOf(sentence, name).length > 0;

/**
 * Every product a sentence names, in order, with where each name ends: the
 * longest name wins where two overlap ("Firefox with Privacy Extensions", not
 * "Firefox").
 */
function namedIn(products: DataProduct[], sentence: string): Array<{ at: number; end: number; p: DataProduct }> {
  const all = products.flatMap((p) => spansOf(sentence, p.name).map((s) => ({ ...s, p }))).sort((a, b) => a.at - b.at || b.end - a.end);
  const out: typeof all = [];
  for (const x of all) if (!out.some((y) => x.at >= y.at && x.end <= y.end)) out.push(x);
  return out;
}

/** "Unlike Brave, it …", "It, like Brave, …": a product set off as an aside, which is not the sentence's subject. */
const ASIDE_BEFORE = /(?:^|[,(—–;:]\s*)(?:unlike|like|as\s+with|compared\s+(?:with|to)|besides)\s+(?:the\s+)?$/i;
const asideAt = (sentence: string, at: number) => ASIDE_BEFORE.test(sentence.slice(0, at));
/** A sentence whose subject is a pronoun: "It comes second overall." */
const PRONOUN_START = /^\s*(?:it|its|it's|they|their)\b/i;

/** The product(s) sharing the highest rating, by name; none when nobody has a rating. */
function topRated(scores: ProductScore[]): string[] {
  const top = scores[0]?.rating ?? null;
  return top === null ? [] : scores.filter((s) => s.rating === top).map((s) => s.name);
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

/** What may sit between two products named in one list: "Alpha, Beta and the Gamma Tool", "DuckDuckGo's extension and Incognito Browser". */
const LIST_GAP = /^(?:'s?(?:\s+[\w-]+){0,2})?\s*(?:\([^)]*\)\s*)?,?\s*(?:(?:and|or|nor|&)\s+)?(?:the\s+)?$/i;

/**
 * Places, "next", "lowest", ties, one product ranked against another and
 * ratings that the prose states and the table doesn't: "Privacy Badger is
 * second" for the fourth, "comes next" for a product that doesn't follow the
 * one before it, "scores lowest" for one that doesn't, "Privacy Badger and
 * DuckDuckGo tie for third" when they don't tie, "X beats Y" or "X finishes
 * ahead of Y" when Y rates higher, "rates 9.5/10" or "scores 9.5" for a
 * product rated 8.5. Checked in the verdict summary, FAQ answers, intro, meta
 * description, bestFor reasons and each product's own row (where the product
 * is the card's).
 *
 * A place N is right for a product whose tie spans place N ("tie for
 * second" for the products listed second and third), or whose group of
 * equal ratings is the Nth ("third" after two products tie for first); "the
 * runner-up" is second. "Comes next" and "followed by" must name the group
 * right after (or tied with) the product they follow: either the nearest
 * product named before, or the last product the text gave a place ("Firefox
 * and Tor tie for second. Tor ties Safari for tracking. Edge comes next."
 * follows Tor, not Safari). "Scores lowest" limited to a criterion ("scores
 * lowest on fingerprinting") needs the bottom cell there, and so "beats Y on
 * ad blocking" needs the higher cell there. A tie is the same rating.
 *
 * A claim is about the product named nearest before it. A tie, a rating,
 * "scores lowest" and "ahead of" are about every product named in a list with
 * it ("Alpha and Beta tie for second" checks both; "Telegram and WhatsApp
 * score lowest" means the last two). Where no product is named before it and
 * its sentence or clause starts with a pronoun, it is about the product the
 * text named last ("…scores lowest. It comes second overall."). A product set
 * off as an aside ("Unlike Brave, it …") is not the subject. A negated claim
 * ("it is not ranked last", "doesn't beat Brave") must be false.
 */
function rankingClaimProblems(d: ComparisonFile): string[] {
  const scores = scoreProducts(d);
  const standing = standings(d);
  const of = (p: DataProduct) => standing.get(p.slug)!;
  const label = (p: DataProduct) => {
    const s = of(p);
    return `${p.name} is placed ${s.first}${s.last > s.first ? `–${s.last}` : ''} at ${formatRating(s.rating)}`;
  };
  const pointsOn = (f: ComparisonFile['features'][number], p: DataProduct) => {
    const v = readCell(cellFor(f, p)?.value);
    return v === null ? null : POINTS[v];
  };
  /** Does `a` rank above `b`: a higher rating, or on a criterion a higher cell? A tie is not above. */
  const above = (a: DataProduct, b: DataProduct, f?: ComparisonFile['features'][number]) => {
    const [x, y] = f ? [pointsOn(f, a), pointsOn(f, b)] : [of(a).rating, of(b).rating];
    return x !== null && (y === null || x > y);
  };
  const problems: string[] = [];

  const check = (where: string, text: string, card?: DataProduct, row = false) => {
    // Every product named in the text, in order, for "next" and "followed by".
    const mentions = d.products
      .flatMap((p) => mentionsOf(text, p.name).map((at) => ({ at, p })))
      .sort((a, b) => a.at - b.at);
    // The group of the product the text last gave a place to.
    let cursor: number | null = null;
    // The product the text named last, for a sentence whose subject is a pronoun.
    let carry: DataProduct | undefined;
    let offset = 0;
    for (const sentence of sentencesOf(text)) {
      const start = text.indexOf(sentence, offset);
      offset = start + sentence.length;
      const named = namedIn(d.products, sentence).filter((x) => !asideAt(sentence, x.at));
      /**
       * The products a claim at `at` is about: the product named nearest before
       * it (with `list`, every product named in a list with it), else, where its
       * sentence or clause starts with a pronoun, the product the text named
       * last, else (unless `beforeOnly`) the first named after it.
       */
      const subjectsAt = (at: number, { list = false, beforeOnly = false } = {}): DataProduct[] => {
        if (card) return [card];
        const before = named.filter((x) => x.end <= at).reverse();
        if (before.length) {
          const joined = [before[0]];
          for (const x of list ? before.slice(1) : []) {
            if (!LIST_GAP.test(sentence.slice(x.end, joined[joined.length - 1].at))) break;
            joined.push(x);
          }
          return [...new Set(joined.map((x) => x.p))];
        }
        const clause = sentence.slice(0, at).split(/[;:—–]|,\s*(?:and|but|so)\s/).pop() ?? '';
        if (carry && (PRONOUN_START.test(sentence) || PRONOUN_START.test(clause))) return [carry];
        const after = beforeOnly ? undefined : named.find((x) => x.at > at);
        return after ? [after.p] : [];
      };
      /** Is `p` among the `k` lowest, overall or on a criterion ("Telegram and WhatsApp score lowest" for the last two)? */
      const amongLowest = (p: DataProduct, k: number, f?: ComparisonFile['features'][number]) => {
        const value = (q: DataProduct) => (f ? pointsOn(f, q) : of(q).rating);
        const mine = value(p);
        if (mine === null) return !f;
        const all = d.products.map(value).filter((v): v is number => v !== null).sort((a, b) => a - b);
        return mine <= all[Math.min(k, all.length) - 1];
      };
      /** The products named inside a match: "Ties Tor Browser for second". */
      const insideOf = (m: RegExpMatchArray) => {
        const from = m.index ?? 0;
        return named.filter((x) => x.at >= from && x.end <= from + m[0].length).map((x) => x.p);
      };
      /** The other side of "ahead of": the list named right after `from` (within three words), in its clause, and where it ends. */
      const objectsAfter = (from: number): { list: DataProduct[]; end: number } => {
        const rest = sentence.slice(from);
        const stop = rest.search(/[.;:!?()—–]|,\s*(?:and|but|while|which|who|with|so|then|though|although)\b|\b(?:but|while|whereas|although|though|however|yet|because)\b/i);
        const clauseEnd = from + (stop < 0 ? rest.length : stop);
        const inClause = named.filter((x) => x.at >= from && x.end <= clauseEnd);
        if (!inClause.length || !/^\s*(?:[\w'-]+\s+){0,3}$/.test(sentence.slice(from, inClause[0].at))) return { list: [], end: from };
        const list = [inClause[0]];
        for (const x of inClause.slice(1)) {
          if (!LIST_GAP.test(sentence.slice(list[list.length - 1].end, x.at))) break;
          list.push(x);
        }
        return { list: [...new Set(list.map((x) => x.p))], end: list[list.length - 1].end };
      };
      /** A criterion named after a pairwise claim ("… on ad blocking") or leading the sentence ("On ad blocking, …"). */
      const pairScope = (end: number) => {
        const after = sentence.slice(end).match(/^\s*,?\s*(?:for|at|in|on)\s+(.*)/i)?.[1];
        const lead = sentence.match(/^\s*(?:on|for|in|at)\s+([^,]+),/i)?.[1];
        return (after && criterionIn(d, after)) || (lead && criterionIn(d, lead)) || undefined;
      };

      // "X is outscored by Y" ranks X below Y; the "outscored" inside it must
      // not also be read as "X outscores Y".
      const passive = matchesOf(PAIR_PASSIVE, sentence);
      const inPassive = (m: RegExpMatchArray) =>
        passive.some((p) => (m.index ?? 0) >= (p.index ?? 0) && (m.index ?? 0) < (p.index ?? 0) + p[0].length);
      const events = [
        ...(row ? [] : matchesOf(SUPERLATIVE, sentence).map((m) => ({ kind: 'top' as const, m }))),
        ...matchesOf(PLACE, sentence).map((m) => ({ kind: 'place' as const, m })),
        ...matchesOf(row ? LOWEST_RANK : LOWEST, sentence).map((m) => ({ kind: 'lowest' as const, m })),
        ...matchesOf(RATING_TEXT, sentence).map((m) => ({ kind: 'rating' as const, m })),
        ...matchesOf(TIE, sentence).map((m) => ({ kind: 'tie' as const, m })),
        ...passive.map((m) => ({ kind: 'down' as const, m })),
        ...matchesOf(PAIR_UP, sentence).filter((m) => !inPassive(m)).map((m) => ({ kind: 'up' as const, m })),
        ...matchesOf(PAIR_DOWN, sentence).filter((m) => !inPassive(m)).map((m) => ({ kind: 'down' as const, m })),
        ...(card ? [] : matchesOf(NEXT, sentence).map((m) => ({ kind: 'next' as const, m }))),
      ].sort((a, b) => (a.m.index ?? 0) - (b.m.index ?? 0));

      for (const { kind, m } of events) {
        const idx = m.index ?? 0;
        const negated = negatedAt(sentence, idx);
        const not = negated ? 'not ' : '';
        if (kind === 'top') {
          // Checked by verdictSuperlativeProblems; here it only moves the cursor.
          const [p] = subjectsAt(idx);
          if (p && !negated && !scopeOf(d, sentence, m)) cursor = of(p).group;
        } else if (kind === 'place') {
          const n = placeOf(m[0]);
          // "Alpha and Beta tie for second", "Ties Tor Browser for second", "Alpha
          // and Beta share third place": each product in it holds the place.
          const subjects = SHARED_PLACE.test(m[0]) ? [...new Set([...subjectsAt(idx, { list: true }), ...insideOf(m)])] : subjectsAt(idx);
          for (const p of subjects) {
            const s = of(p);
            const right = s.group === n || (s.first <= n && n <= s.last);
            if (right === negated) problems.push(`${where}: "${not}${m[0]}", but ${label(p)}: "${sentence}"`);
          }
          if (subjects.length && !negated) cursor = of(subjects[0]).group;
        } else if (kind === 'lowest') {
          const criterion = scopeOf(d, sentence, m);
          // "Telegram and WhatsApp score lowest": the last two, in any order.
          const subjects = subjectsAt(idx, { list: !negated });
          for (const p of subjects) {
            if (amongLowest(p, subjects.length, criterion) !== negated) continue;
            problems.push(
              criterion
                ? `${where}: "${not}${m[0]}" for ${p.name}, but ${negated ? 'it has' : "it doesn't have"} the bottom "${criterion.name}" cell: "${sentence}"`
                : `${where}: "${not}${m[0]}", but ${label(p)}: "${sentence}"`,
            );
          }
          if (subjects.length && !criterion && !negated) cursor = of(subjects[0]).group;
        } else if (kind === 'rating') {
          if (negated) continue;
          for (const p of subjectsAt(idx, { list: true })) if (of(p).rating !== ratingIn(m)) problems.push(`${where}: "${m[0]}", but ${label(p)}: "${sentence}"`);
        } else if (kind === 'tie') {
          if (negated) continue;
          const group = [...new Set([...subjectsAt(idx, { list: true }), ...insideOf(m)])];
          if (group.length > 1 && new Set(group.map((p) => of(p).rating)).size > 1) {
            problems.push(`${where}: "${m[0]}", but ${group.map(label).join('; ')}: "${sentence}"`);
          } else if (group.length === 1 && !scores.some((s) => s.slug !== group[0].slug && s.rating === of(group[0]).rating)) {
            problems.push(`${where}: "${m[0]}", but no other product shares its rating (${label(group[0])}): "${sentence}"`);
          }
        } else if (kind === 'up' || kind === 'down') {
          // "Listed ahead of it" is the alphabetical tie-break, not a ranking.
          if (/\blisted\s+(?:\w+\s+)?$/i.test(sentence.slice(0, idx))) continue;
          const subjects = subjectsAt(idx, { list: true, beforeOnly: true });
          const { list: after, end } = objectsAfter(idx + m[0].length);
          // "Privacy Badger leaves Ghostery behind": the other side is inside
          // the match, not after it (Wave 4 verifier, 2026-09-11).
          const objects = after.length ? after : insideOf(m);
          const criterion = pairScope(end);
          for (const s of subjects) {
            for (const o of objects) {
              if (s === o) continue;
              const right = kind === 'up' ? above(s, o, criterion) : above(o, s, criterion);
              if (right === negated) {
                const facts = criterion
                  ? `${s.name}'s "${criterion.name}" cell is ${cellFor(criterion, s)?.value ?? 'blank'} and ${o.name}'s is ${cellFor(criterion, o)?.value ?? 'blank'}`
                  : `${label(s)} and ${label(o)}`;
                problems.push(`${where}: "${not}${m[0]}" ranks ${s.name} ${kind === 'up' ? 'above' : 'below'} ${o.name}, but ${facts}: "${sentence}"`);
              }
            }
          }
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
      if (named.length) carry = named[named.length - 1].p;
    }
  };

  for (const { where, text } of rankingTexts(d)) check(where, text);
  d.verdict.bestFor.forEach((b, i) => {
    const card = d.products.find((p) => p.name === b.product);
    if (card) check(`bestFor[${i}] ${b.product}`, b.reason.replace(/’/g, "'"), card);
  });
  // Each product's own row: "Beats Brave on ad blocking", "Ranks second here".
  for (const p of d.products) {
    [p.tagline, ...(p.pros ?? []), ...(p.cons ?? [])].forEach((s, i) => {
      if (typeof s === 'string' && s.trim()) check(`${p.slug} row[${i}]`, s.replace(/’/g, "'"), p, true);
    });
  }
  return problems;
}

/**
 * A bestFor card naming our product, unless it ranks first, must either
 * name a criterion on which it has the top cell ("Ad blocking" where its cell
 * ties the best), or say where it ranks ("It ranks last on this table's
 * criteria"; rankingClaimProblems checks that the place is right). Saying
 * where it doesn't rank ("it is not ranked last") is not saying where it does.
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
    if (!topOnNamed && !statesRank(b.reason.replace(/’/g, "'"))) {
      problems.push(`bestFor[${i}] "${b.useCase}" names ${OUR_NAME}, which doesn't rank first or have the top cell on a criterion the use case names, and the reason doesn't say where it ranks: "${b.reason}"`);
    }
  });
  return problems;
}

/**
 * Anywhere in the file, "best", "top", "leading", "safest", "recommended" and
 * the like said about our product, unless the table ranks it first. It is
 * about us when we are the nearest product named before it; or, in a sentence
 * naming no product (an aside such as "unlike Brave" doesn't count), when the
 * text is our own row's, answers an FAQ question naming us, or follows a
 * sentence about us ("…, which we make, scores lowest. It is the best choice
 * for Android."). And in the FAQs: a question naming us with a superlative
 * ("Is Incognito Browser the best choice?") must be answered with a denial,
 * and a question asking which product to pick ("Which tool is best on
 * Android?") may not be answered with us first unless that sentence says
 * where we rank.
 */
function ourSuperlatives(d: ComparisonFile): string[] {
  if (topRated(scoreProducts(d)).includes(OUR_NAME)) return [];
  const others = d.products.filter((p) => p.slug !== OUR_PRODUCT_SLUG);
  const asksAboutUs = faqsAboutUs(d);
  const found: string[] = [];
  for (const t of textsOf(d)) {
    let aboutUs = t.ours || (t.question !== undefined && ourSpans(t.question).length > 0);
    const sentences = sentencesOf(t.text);
    sentences.forEach((sentence, i) => {
      const us = ourSpans(sentence);
      const them = others.flatMap((p) => mentionsOf(sentence, p.name)).filter((j) => !asideAt(sentence, j));
      // A question in prose is read like a statement when the sentence after
      // it is about us: "Looking for the best private browser on Android?
      // Incognito Browser, which we make, is it." (Wave 3 verifier).
      const answeredAboutUs = !t.asked && sentence.trim().endsWith('?') && ourSpans(sentences[i + 1] ?? '').length > 0;
      const ours = t.ours || us.length > 0 || (aboutUs && them.length === 0) || answeredAboutUs;
      // An FAQ question of our own is checked by the denial rule below instead.
      if (ours && !(t.asked && sentence.trim().endsWith('?'))) {
        for (const m of matchesOf(OUR_SUPERLATIVE, sentence)) {
          const subject = subjectOf(d.products, sentence, m.index ?? 0);
          if (subject ? subject.slug === OUR_PRODUCT_SLUG : true) found.push(`${t.where}: "${m[0]}": ${sentence}`);
        }
      }
      if (!t.ours && (us.length || them.length)) aboutUs = Math.max(-1, ...us) > Math.max(-1, ...them);
    });
  }
  (d.faqs ?? []).forEach((q, i) => {
    const question = q.question.replace(/’/g, "'");
    const answer = q.answer.replace(/’/g, "'");
    if (asksAboutUs[i] && OUR_SUPERLATIVE.test(question) && !deniesAnswer(answer)) {
      found.push(`faqs[${i}]: "${question}" is answered without a denial: "${answer}"`);
    }
    if (PICK_QUESTION.test(question)) {
      for (const sentence of sentencesOf(answer)) {
        // In an answer to "which should I pick?", a bare "Ours" is us (Wave 4
        // verifier, 2026-09-11: "Ours, hands down." named nobody).
        const ourAt = Math.min(Infinity, ...ourSpans(sentence), ...matchesOf(BARE_OURS, sentence).map((m) => m.index ?? 0));
        const theirAt = Math.min(Infinity, ...others.flatMap((p) => mentionsOf(sentence, p.name)).filter((at) => !asideAt(sentence, at)));
        if (ourAt === Infinity && theirAt === Infinity) continue;
        if (ourAt < theirAt && !statesRank(sentence)) found.push(`faqs[${i}]: "${question}" is answered with ${OUR_NAME} first: "${sentence}"`);
        break;
      }
    }
  });
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
    // Nothing like "verified" anywhere else: not "checked and verified by our team", "we verified",
    // "every cell is fact-checked against the vendor's site", "double-checked", "validated" or "audited".
    expect(prose.split(NOT_VERIFIED).join(' ')).not.toMatch(VERIFICATION_CLAIM);
    expect(prose).not.toMatch(TESTING);
  });

  it('the wording guards catch what they are for', () => {
    for (const s of ['Every cell has been checked and verified by our team.', 'We verified every cell.', "Every cell is fact-checked against the vendor's own site.", 'Each row is double-checked.', 'Our data is validated and audited.']) {
      expect(s, s).toMatch(VERIFICATION_CLAIM);
    }
    expect(NOT_VERIFIED).toMatch(VERIFICATION_CLAIM); // allowed only as that one sentence
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

  it('is in the free site sitemap', async () => {
    // The tier is read at module load, and the Pro deployment's sitemap is
    // empty by design (tools only, noindex). Under the Pro project's build
    // (NEXT_PUBLIC_TIER=pro) this test failed and blocked the Pro deploy of
    // 21c32ed, so load the sitemap as the free site, as tests/seo-offers does.
    const tier = process.env.NEXT_PUBLIC_TIER;
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_TIER;
    try {
      const { default: sitemap } = await import('@/app/sitemap');
      expect(sitemap().map((e) => e.url)).toContain(`https://incognitobrowser.io/resources${METHODOLOGY_PATH}`);
    } finally {
      vi.resetModules();
      if (tier === undefined) delete process.env.NEXT_PUBLIC_TIER;
      else process.env.NEXT_PUBLIC_TIER = tier;
    }
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

  // Each passed every test before the Wave 2c verifier (2026-09-11), on a real
  // page or here. Alpha = Beta 8.8, Gamma Tool 5.0, ours 3.8 (last).
  describe('catches each loophole the Wave 2c verifier found', () => {
    const ranking = (summary: string, bestFor: ComparisonFile['verdict']['bestFor'] = []) => rankingClaimProblems(page(summary, bestFor));
    const withFaq = (question: string, answer: string) => ({ ...page('x'), faqs: [{ question, answer }] });

    it('"beats", "ahead of", "higher than": one product ranked against another, overall or on a criterion', () => {
      expect(ranking('Incognito Browser, which we make, beats Gamma Tool on these criteria.')).toHaveLength(1);
      expect(ranking('Incognito Browser, which we make, finishes ahead of Gamma Tool.')).toHaveLength(1);
      expect(ranking('Gamma Tool scores higher than Alpha.')).toHaveLength(1);
      expect(ranking('Alpha scores higher than Beta.')).toHaveLength(1); // a tie is not higher
      expect(ranking('Gamma Tool trails Incognito Browser.')).toHaveLength(1);
      expect(ranking('Alpha and Beta finish ahead of Gamma Tool and Incognito Browser.')).toEqual([]);
      expect(ranking('Gamma Tool finishes ahead of Incognito Browser, which we make.')).toEqual([]);
      expect(ranking('Incognito Browser, which we make, trails Gamma Tool.')).toEqual([]);
      // On one criterion, the cells decide: Gamma Tool's voice cell is Excellent, Alpha's Good.
      expect(ranking('Gamma Tool beats Alpha on voice privacy.')).toEqual([]);
      expect(ranking('Alpha beats Gamma Tool on voice privacy.')).toHaveLength(1);
      expect(ranking('On ad blocking, Incognito Browser beats Gamma Tool.')).toEqual([]);
      // Negated, it must be false.
      expect(ranking('Incognito Browser does not beat Gamma Tool.')).toEqual([]);
      expect(ranking('Gamma Tool does not beat Incognito Browser.')).toHaveLength(1);
      // "Listed ahead of" is the alphabetical tie-break.
      expect(ranking('Alpha and Beta tie for first; Alpha is listed ahead of Beta.')).toEqual([]);
      // In our own row too.
      const row = page('x');
      row.products[3].pros = ['Beats Gamma Tool on these criteria'];
      expect(rankingClaimProblems(row)).toHaveLength(1);
    });

    it('a tie is the same rating, for every product in it', () => {
      expect(ranking('Gamma Tool and Incognito Browser tie for third.')).not.toEqual([]); // 5.0 and 3.8
      expect(ranking('Alpha, Beta and Gamma Tool tie for first.')).not.toEqual([]);
      expect(ranking('Alpha and Beta tie for the top score.')).toEqual([]);
      expect(ranking('x', [{ useCase: 'Voice', product: 'Gamma Tool', reason: 'Ties for the top voice score' }])).toHaveLength(1); // nobody shares 5.0
      expect(ranking('x', [{ useCase: 'Ads', product: 'Alpha', reason: 'Ties Beta for first' }])).toEqual([]);
    });

    it('a pronoun subject is the product named last before it', () => {
      expect(ranking('Incognito Browser, which we make, scores lowest. It comes second overall.')).toHaveLength(1);
      expect(ranking('Incognito Browser, which we make, scores lowest. It comes fourth overall.')).toEqual([]);
      expect(ranking('Gamma Tool is third. It rates 8.8/10.')).toHaveLength(1);
      expect(ranking('Gamma Tool is third. It comes second, ahead of Incognito Browser.')).toEqual([]); // second group
    });

    it('"the runner-up" is second, and "scores 9.5" is a written rating', () => {
      expect(ranking('Incognito Browser is the runner-up.')).toHaveLength(1);
      expect(ranking('Gamma Tool is the runner-up.')).toEqual([]); // the second group
      expect(ranking('Alpha scores 9.5 here.')).toHaveLength(1);
      expect(ranking('Alpha scores 8.8 here.')).toEqual([]);
      expect(ranking('Alpha is rated 4.6 stars on Google Play.')).toEqual([]);
    });

    it('a negated place must be false: "it is not ranked last" for the product ranked last', () => {
      const card = [{ useCase: 'Social media on Android', product: OUR_NAME, reason: 'Wipes cookies on exit; it is not ranked last.' }];
      expect(ourBestForProblems(page('x', card))).toHaveLength(1);
      expect(ranking('x', card)).toHaveLength(1);
      expect(ranking('Gamma Tool is not ranked last.')).toEqual([]);
    });

    it('an FAQ answer is read in the light of its question', () => {
      expect(ourSuperlatives(withFaq('Is Incognito Browser the best choice on Android?', 'Yes, it is the best private browser for Android.'))).not.toEqual([]);
      expect(ourSuperlatives(withFaq('Is Incognito Browser the best choice on Android?', 'Yes.'))).not.toEqual([]);
      expect(ourSuperlatives(withFaq('Is Incognito Browser the best choice on Android?', 'No. On these criteria it scores lowest.'))).toEqual([]);
      expect(ourSuperlatives(withFaq('Which tool is best on Android?', 'Incognito Browser, which we make.'))).not.toEqual([]);
      expect(ourSuperlatives(withFaq('Which tool is best on Android?', 'Incognito Browser, which we make, scores lowest here; Alpha and Beta tie for the top score.'))).toEqual([]);
      expect(ourSuperlatives(withFaq('Which tool is best on Android?', 'Alpha and Beta tie for the top score; Incognito Browser, which we make, also runs on Android.'))).toEqual([]);
    });

    it('reads a passive comparison the right way round, and knows "outdoes", "outclasses" and "superior to"', () => {
      // Each passed the whole suite before the Wave 3 verifier (2026-09-11).
      expect(ranking('Gamma Tool is outscored by Incognito Browser, which we make.')).toHaveLength(1);
      expect(ranking('Gamma Tool is beaten by Incognito Browser, which we make.')).toHaveLength(1);
      expect(ranking('Gamma Tool was topped by Incognito Browser, which we make.')).toHaveLength(1);
      expect(ranking('Incognito Browser, which we make, outdoes Gamma Tool.')).toHaveLength(1);
      expect(ranking('Incognito Browser, which we make, outclasses Gamma Tool.')).toHaveLength(1);
      expect(ranking('Incognito Browser, which we make, is superior to Gamma Tool.')).toHaveLength(1);
      expect(ranking('Incognito Browser, which we make, surpasses Gamma Tool.')).toHaveLength(1);
      // True the other way round, which must still pass.
      expect(ranking('Incognito Browser, which we make, is outscored by Gamma Tool.')).toEqual([]);
      expect(ranking('Incognito Browser, which we make, is beaten by Gamma Tool.')).toEqual([]);
      expect(ranking('Gamma Tool surpasses Incognito Browser, which we make.')).toEqual([]);
      expect(ranking('Alpha and Beta are outscored by nobody here.')).toEqual([]);
    });

    it('"tops the table", "wins", "comes out on top", "strongest", "most private" and an editor\'s choice', () => {
      expect(verdict('Gamma Tool tops the table.')).toHaveLength(1);
      expect(verdict('Gamma Tool wins overall.')).toHaveLength(1);
      expect(verdict('Gamma Tool comes out on top.')).toHaveLength(1);
      expect(verdict('Gamma Tool comes out ahead of the rest.')).toHaveLength(1);
      expect(verdict('Gamma Tool offers the strongest protection of the four.')).toHaveLength(1);
      expect(verdict('Gamma Tool is the most private tool here.')).toHaveLength(1);
      expect(verdict('x', [{ useCase: "Editor's choice", product: 'Gamma Tool', reason: 'Nothing to set up' }])).toHaveLength(1);
      // Limited to a criterion, the cells decide, and a tied top pair may win.
      expect(verdict('Gamma Tool has the strongest voice privacy here.')).toEqual([]);
      expect(verdict('Alpha and Beta tie for the top score; Alpha wins on ad blocking.')).toEqual([]);
      expect(verdict('Alpha and Beta tie for the top score.')).toEqual([]);
      // "its strongest setting" is not a claim to be the strongest.
      expect(verdict("Gamma Tool's strongest setting is off by default.")).toEqual([]);
    });

    it('places written as numbers, a shared place, last place and a tie said without the word', () => {
      expect(ranking('Incognito Browser, which we make, is number two here.')).toHaveLength(1);
      expect(ranking('Gamma Tool is No. 1.')).toHaveLength(1);
      expect(ranking('Gamma Tool is number two here.')).toEqual([]);
      expect(ranking('Gamma Tool and Incognito Browser share third place.')).not.toEqual([]);
      expect(ranking('Alpha and Beta share first place.')).toEqual([]);
      expect(ranking('Gamma Tool is in last place.')).toHaveLength(1);
      expect(ranking('Incognito Browser, which we make, is in last place.')).toEqual([]);
      expect(ranking('Gamma Tool and Incognito Browser score the same on these criteria.')).not.toEqual([]);
      expect(ranking('Alpha and Beta score the same.')).toEqual([]);
      expect(ranking('Gamma Tool draws level with Incognito Browser.')).not.toEqual([]);
      expect(ranking('Alpha is level with Beta.')).toEqual([]);
    });

    it('a rating written as "earns a 9.5", and not a version, a distance or an address', () => {
      expect(ranking('Alpha earns a 9.5 here.')).toHaveLength(1);
      expect(ranking('Alpha gets 9.5 here.')).toHaveLength(1);
      expect(ranking('Alpha earns an 8.8 here.')).toEqual([]);
      expect(ranking('Gamma Tool gets 5.0 here.')).toEqual([]);
      expect(rankingClaimProblems(page('x', [], 'Free encrypted DNS resolver at 1.1.1.1'))).toEqual([]);
      expect(rankingClaimProblems(page('x', [], 'Detects drones at 1.5 km in ideal conditions'))).toEqual([]);
      expect(rankingClaimProblems(page('x', [], 'Rated 4.7 on Google Play'))).toEqual([]);
    });

    it('an FAQ about us is followed through: a follow-up question, a question to pick with, and a question in prose', () => {
      expect(ourSuperlatives(withFaq('Is Incognito Browser the best choice on Android?', 'No doubt about it.'))).not.toEqual([]);
      expect(ourSuperlatives(withFaq('Is Incognito Browser the best choice on Android?', 'Not only that: it wins on every row.'))).not.toEqual([]);
      const followUp = { ...page('x'), faqs: [
        { question: 'Is Incognito Browser free?', answer: 'Yes; Incognito Pro is an optional subscription.' },
        { question: 'Is it the best private browser on Android?', answer: 'Yes.' },
      ] };
      expect(ourSuperlatives(followUp)).not.toEqual([]);
      const followUpApp = { ...page('x'), faqs: [
        { question: 'Is Incognito Browser free?', answer: 'Yes.' },
        { question: 'Is the app the safest choice on Android?', answer: 'It is.' },
      ] };
      expect(ourSuperlatives(followUpApp)).not.toEqual([]);
      expect(ourSuperlatives(withFaq('What should Android users install?', 'Incognito Browser, which we make.'))).not.toEqual([]);
      expect(ourSuperlatives(withFaq('Which one would you pick for Android?', 'Incognito Browser, which we make.'))).not.toEqual([]);
      expect(ourSuperlatives(withFaq('Which one would you pick for Android?', 'Alpha and Beta tie for the top score.'))).toEqual([]);
      expect(ourSuperlatives(page('Looking for the best private browser on Android? Incognito Browser, which we make, is it.'))).not.toEqual([]);
      expect(ourSuperlatives(page('Which private browser is best on Android? Incognito, which we make, is the best choice on Android.'))).not.toEqual([]);
    });

    it('a bare "Incognito", "the pick" and "the one to get" are about us too', () => {
      expect(ourSuperlatives(page('Incognito, which we make, is the best choice on Android.'))).not.toEqual([]);
      expect(ourSuperlatives(page('Our own browser is the safest choice on Android.'))).not.toEqual([]);
      const pick = page('x');
      pick.products[3].pros = ['The pick for Android'];
      expect(ourSuperlatives(pick)).toHaveLength(1);
      const card = page('x', [{ useCase: 'Android', product: OUR_NAME, reason: 'It ranks last on these criteria, but it is the one to get' }]);
      expect(ourSuperlatives(card)).not.toEqual([]);
      const goTo = page('x');
      goTo.products[3].pros = ['Your go-to browser on Android'];
      expect(ourSuperlatives(goTo)).toHaveLength(1);
    });

    it('"safest", "most privacy-focused", "most trusted", "unrivalled" and "second to none" about us', () => {
      expect(ourSuperlatives(page('Incognito Browser, which we make, is the safest choice on Android.'))).not.toEqual([]);
      expect(ourSuperlatives(page('x', [], 'The safest private browser on Android'))).toHaveLength(1);
      for (const pro of ['The most privacy-focused browser on Android', 'The most trusted private browser', 'Unrivalled privacy on Android', 'Second to none on Android']) {
        const p = page('x');
        p.products[3].pros = [pro];
        expect(ourSuperlatives(p), pro).toHaveLength(1);
      }
    });
  });
});

// --- the speed and wording guards themselves ----------------------------------

describe('the speed and wording guards', () => {
  it('finds a speed or resource-use criterion by its name or description, and nothing else', () => {
    for (const [name, description] of [
      ['Page Load Time', 'How quickly pages open with the tool on'],
      ['Memory Usage', 'How much memory and battery the app uses'],
      ['Connection Speed', 'How fast connections are'],
      ['Battery Impact', 'How much battery life it costs'],
      ['Efficiency', 'Resource use while browsing'],
      ['Responsiveness', 'How the app feels in use'],
      ['Everyday Use', 'How quickly the app responds'],
      ['CPU Overhead', 'Background work'],
    ]) {
      expect(SPEED_CRITERION.test(`${name} ${description}`), name).toBe(true);
    }
    for (const [name, description] of [
      ['Cost Efficiency', 'Value for money'],
      ['Customer Support', 'Quality and responsiveness of customer service and technical support'],
      ['Mobile Banking Support', 'Works seamlessly with mobile banking apps and responsive websites'],
      ['Identity Protection', 'Prevents AI platforms from linking your usage to your real identity'],
      ['Server Security', 'RAM-only servers'],
    ]) {
      expect(SPEED_CRITERION.test(`${name} ${description}`), name).toBe(false);
    }
  });

  it("counts a cell note as a lab measurement only when it cites a result, not the lab's name alone", () => {
    for (const note of [
      'Impact score 17.6 (ADVANCED), AV-Comparatives April 2026',
      "ADVANCED+ in AV-Comparatives' March 2026 malware protection test",
      'Blocked 99.5% of real-world threats (ADVANCED+), AV-Comparatives Feb-May 2026',
      'AV-Comparatives performance test',
    ]) {
      expect(citesLabResult(note), note).toBe(true);
    }
    for (const note of ["Not in AV-Comparatives' tests; fast in daily use", 'AV-Comparatives does not test VPN speed', 'Fast, per AV-Comparatives', 'AV-TEST', 'Quick in daily use']) {
      expect(citesLabResult(note), note).toBe(false);
    }
  });

  it('flags speed claims in prose unless the sentence names the lab', () => {
    expect('uBlock Origin is the fastest blocker here.').toMatch(SPEED_CLAIM);
    expect('A lightweight extension that uses little memory.').toMatch(SPEED_CLAIM);
    expect('Brave loads pages faster than Chrome.').toMatch(SPEED_CLAIM);
    expect(speedClaims('uBlock Origin is the fastest blocker here.')).toHaveLength(1);
    expect(speedClaims("In AV-Comparatives' April 2026 performance test, Bitdefender slowed systems the least and was the fastest.")).toEqual([]);
    expect(speedClaims('Quick private sessions.')).toEqual([]);
  });

  it('TESTING catches testing claims, and not "we haven\'t measured it"', () => {
    for (const s of [
      'Our editors tested each tool.',
      'After testing each tool, we ranked them.',
      'We benchmarked each tool.',
      'We tried every tool for a month.',
      'Our team measured page loads.',
      "We've tested each tool.",
      'In our tests uBlock Origin was fastest.',
    ]) {
      expect(s, s).toMatch(TESTING);
    }
    for (const s of [
      "Sync speed isn't scored, because we haven't measured it.",
      'Latency isn\'t scored, and we have not measured it.',
      'These create profiles that can be used for stalking even after you stop using the app.',
      'After testing your DNS at dnsleaktest.com, switch resolvers.',
      "AV-Comparatives benchmarked each suite in its April 2026 performance test.",
      'tested as Norton Antivirus Plus, which uses the same engine',
    ]) {
      expect(s, s).not.toMatch(TESTING);
    }
  });

  it('SCRUB_LEFTOVER, POINTS_AT_US and NEVER_CLAIM_CRITERION catch the forms the verifier found', () => {
    expect('Use a privacy-focused browser to cut down the data brokers collect.').toMatch(SCRUB_LEFTOVER);
    expect('Brokers buy it from sites. Use a privacy-focused browser to limit what they collect.').toMatch(SCRUB_LEFTOVER);
    expect('Privacy-focused browser with built-in ad blocking').not.toMatch(SCRUB_LEFTOVER);
    for (const s of ['The browser we develop wipes everything when you exit.', 'Our own Android browser wipes everything.', 'Try our product.', 'We built a browser for this.']) {
      expect(s, s).toMatch(POINTS_AT_US);
    }
    expect('Stops sites recognising your phone from one visit to the next').toMatch(NEVER_CLAIM_CRITERION);
    expect("Sites can't tell your device apart from others").toMatch(NEVER_CLAIM_CRITERION);
  });

  // Each of these passed the whole suite before the Wave 3 verifier (2026-09-11).
  it('finds a speed row under another name, and a speed claim in other words', () => {
    for (const [name, description] of [
      ['Throughput', 'Download and upload rates on nearby servers'],
      ['Data Usage', 'How much data the app uses in a month'],
      ['Startup Time', 'How long the app takes to open'],
      ['Bandwidth', 'What it leaves for everything else'],
    ]) {
      expect(SPEED_CRITERION.test(`${name} ${description}`), name).toBe(true);
    }
    expect(speedClaims('uBlock Origin is blazing fast and barely touches your battery.')).toHaveLength(1);
    expect(speedClaims('Blazing fast, even on older phones.')).toHaveLength(1);
    expect(speedClaims('A snappy, lightning-fast browser.')).toHaveLength(1);
    // Not a claim about a product's speed.
    expect(speedClaims('When your data is breached, acting fast is crucial.')).toEqual([]);
    expect(speedClaims('How fast a browser feels depends on your device and the sites you use.')).toEqual([]);
    expect(speedClaims('How fast a company must answer depends on the law where you live.')).toEqual([]);
  });

  it('TESTING catches "we ran each tool" and "our reviewers evaluated each tool", and not "we compared"', () => {
    for (const s of [
      'We ran each tool on the same Pixel phone for a week.',
      'Our reviewers evaluated each tool.',
      'We installed every extension and used it for a month.',
      'Our team put each tool through the same checks.',
      'We put every product through the same checks on one phone.',
    ]) {
      expect(s, s).toMatch(TESTING);
    }
    for (const s of [
      'We compared what each product publishes.',
      'Each cell is our reading of what the vendor documents.',
      "We haven't run each tool, so speed isn't scored.",
    ]) {
      expect(s, s).not.toMatch(TESTING);
    }
  });

  it('VERIFICATION_CLAIM catches a page claiming the cells were checked, and not a product that was audited', () => {
    for (const s of [
      "Every cell is verified against each vendor's documentation.",
      "Every cell is cross-checked against the vendor's documentation.",
      'We verified every row.',
      'Each row is double-checked.',
    ]) {
      expect(s, s).toMatch(VERIFICATION_CLAIM);
    }
    for (const s of [
      'Independently audited no-logs policy',
      "Avoid services that haven't been audited or have unclear privacy policies.",
      'Not assessed: no independently verified success-rate figures',
      'How pages are checked before they go live is covered in our editorial standards.',
      "Automatic tracker blocking is not in the app's verified feature list; cookies are wiped when you exit",
      'Check the developer’s reputation and verify the extension is open source when possible.'.replace(/’/g, "'"),
    ]) {
      expect(s, s).not.toMatch(VERIFICATION_CLAIM);
    }
  });

  it('POINTS_AT_US, NAMES_US and SCRUB_LEFTOVER catch the wordings that got past them', () => {
    expect('Our free Android browser wipes everything when you exit.').toMatch(POINTS_AT_US);
    expect('Our own privacy-focused Android browser wipes everything.').toMatch(POINTS_AT_US);
    expect('The Incognito app for Android pairs well with any of these.').toMatch(NAMES_US);
    expect('Switch to a privacy-focused browser to limit what they collect.').toMatch(SCRUB_LEFTOVER);
    expect('Install a privacy-focused browser and start there.').toMatch(SCRUB_LEFTOVER);
    // Still not a leftover: a product's own tagline, or browsers in general.
    expect('Privacy-focused browser with built-in ad blocking').not.toMatch(SCRUB_LEFTOVER);
    expect('Privacy-focused browsers block third-party trackers.').not.toMatch(SCRUB_LEFTOVER);
  });

  it('the superlative, tie, speed and testing checks catch the wordings the Wave 4 verifier found', () => {
    // About us: a recommendation with no superlative word in it.
    for (const s of [
      'If you only install one Android browser, make it Incognito Browser, which we make.',
      'Ours, hands down.',
      'Go with ours.',
      'Look no further.',
    ]) {
      expect(s, s).toMatch(OUR_SUPERLATIVE);
    }
    // Still not a claim to be the best: how to get it, and where it ranks.
    for (const s of [
      'Install from Google Play and start browsing',
      'It ranks last on this table\'s criteria',
      'Android browser that stays in private mode and wipes history, cookies and sessions when you exit',
    ]) {
      expect(s, s).not.toMatch(OUR_SUPERLATIVE);
    }
    // About any product: praise, ties and comparatives said in other words.
    for (const s of [
      'Privacy Badger takes the crown.',
      'Privacy Badger is the gold standard for tracker blocking.',
      'Privacy Badger is in a league of its own.',
      'Nothing else comes close to Privacy Badger.',
      'Privacy Badger is the clear winner.',
    ]) {
      expect(s, s).toMatch(SUPERLATIVE);
    }
    for (const s of ['Privacy Badger and Ghostery are neck and neck.', 'Privacy Badger is on par with Ghostery.', 'The two are evenly matched.']) {
      expect(s, s).toMatch(TIE);
    }
    expect('Ghostery is no match for Privacy Badger.').toMatch(PAIR_DOWN);
    expect('Privacy Badger leaves Ghostery behind.').toMatch(PAIR_UP);
    // Speed said as a negation, and testing said as time spent.
    expect(speedClaims('uBlock Origin will not slow your phone down.')).toHaveLength(1);
    expect(speedClaims('No lag, even on older phones.')).toHaveLength(1);
    expect(speedClaims("It doesn't drain your battery.")).toHaveLength(1);
    for (const s of ['We spent a month with each of these apps.', 'After a month of daily use, the differences are small.']) {
      expect(s, s).toMatch(TESTING);
    }
    // Not a speed claim: what the methodology says about speed.
    expect(speedClaims('Speed and performance are scored only where the page cites a third-party measurement.')).toEqual([]);
    expect(speedClaims('speed gets no credit, because nothing documented backs it')).toEqual([]);
  });

  it('only a real denial answers an FAQ that asks whether we are the best', () => {
    for (const a of ['No.', 'No, it is not.', 'Nope.', 'Not on these criteria.', 'It ranks last here.', 'Incognito Browser scores lowest here.', 'No. On these criteria it scores lowest.']) {
      expect(DENIAL_ANSWER.test(a), a).toBe(true);
      expect(deniesAnswer(a), a).toBe(true);
    }
    for (const a of ['No doubt about it.', 'Not only that: it wins on every row.', 'Not surprisingly, yes.', 'None other than Incognito Browser.', 'No need to look further.', 'Yes.']) {
      expect(DENIAL_ANSWER.test(a), a).toBe(false);
      expect(deniesAnswer(a), a).toBe(false);
    }
    // A denial word, then the claim anyway (Wave 4 verifier, 2026-09-11).
    for (const a of ['Nope — ours is.', 'No, but it is the one to get.', 'Not really: ours is, hands down.']) {
      expect(deniesAnswer(a), a).toBe(false);
    }
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

  it.each(FILES)('%s: claims nobody here verified the cells, which the methodology page says we have not', (file) => {
    // VERIFICATION_CLAIM used to run on the methodology page alone, so a
    // comparison could say "Every cell is verified against each vendor's
    // documentation" and contradict it (Wave 3 verifier, 2026-09-11).
    const found = textsOf(load(file)).filter((t) => VERIFICATION_CLAIM.test(t.text)).map((t) => `${t.where}: ${t.text}`);
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

  it.each(FILES)('%s: every place, "next", "lowest", tie, "ahead of" and rating the prose states matches the table', (file) => {
    expect(rankingClaimProblems(load(file))).toEqual([]);
  });

  it.each(FILES)('%s: every criterion name is used once on the page', (file) => {
    // IB_BACKING and NOT_A_BROWSER_CRITERION go by name, so a second row with a
    // reviewed name would inherit the review ("Automatic History Deletion",
    // described as stopping sites recognising your phone).
    const keys = load(file).features.map((f) => criterionKey(f.name));
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it.each(FILES)("%s: fits the schema's length limits (title, meta description, intro)", (file) => {
    const d = load(file);
    const over = [
      ['title', d.title, TITLE_MAX],
      ['metaDescription', d.metaDescription, META_MAX],
      ['intro', d.intro, INTRO_MAX],
    ] as const;
    expect(over.filter(([, s, max]) => (s ?? '').length > max).map(([k, s, max]) => `${k} is ${(s ?? '').length} characters (max ${max})`)).toEqual([]);
  });

  it.each(FILES)('%s: speed and performance are scored only where a third-party measurement is cited (sitewide policy)', (file) => {
    // A speed, performance, latency or resource-use criterion (by its name or
    // its description) gets a value for anyone but us only where its note
    // cites a MEASUREMENT_SOURCES result (citesLabResult), else it is '—'. A
    // criterion left with no such cell is deleted, so ours is never the only
    // product assessed on it. (Ours is 'no': IB_BACKING has no speed entry.)
    const d = load(file);
    const problems: string[] = [];
    for (const f of d.features.filter((x) => SPEED_CRITERION.test(`${x.name} ${x.description ?? ''}`))) {
      const assessed = d.products.filter((p) => p.slug !== OUR_PRODUCT_SLUG && readCell(cellFor(f, p)?.value) !== null);
      if (!assessed.length) problems.push(`"${f.name}" has no assessed cell but ours: delete the criterion`);
      for (const p of assessed) {
        const cell = cellFor(f, p)!;
        if (!citesLabResult(cell.note ?? '')) {
          problems.push(`"${f.name}" for ${p.name} is '${cell.value}' with no third-party result cited (note: "${cell.note ?? ''}"): make it '—'`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it.each(FILES)('%s: the page calls nothing fastest, lightweight or low-latency unless the sentence names the lab', (file) => {
    const found = textsOf(load(file))
      .filter((t) => t.shown)
      .flatMap((t) => speedClaims(t.text).map((s) => `${t.where}: ${s}`));
    expect(found).toEqual([]);
  });

  it.each(FILES)('%s: a cell that follows a third-party lab result says so where the page shows it', (file) => {
    // Cell notes aren't rendered, so the lab has to be named in text that is.
    const d = load(file);
    const shown = textsOf(d).filter((t) => t.shown).map((t) => t.text).join('\n');
    const used = MEASUREMENT_SOURCES.filter((s) => d.features.some((f) => d.products.some((p) => (cellFor(f, p)?.note ?? '').includes(s))));
    expect(used.filter((s) => !shown.includes(s))).toEqual([]);
  });
});

// --- one fact, one value, on every page ----------------------------------------

/**
 * The same product under two names, reviewed: `same` means one product listed
 * twice, whose cells are then compared as one; `false` means two products
 * that only look alike. A test finds every pair of names on the site that
 * could be one product and fails until an entry says which, because renaming
 * a row ("DeleteMe (Abine)", "Brave Browser" for "Brave") got round the
 * one-value check (Wave 3 verifier, 2026-09-11).
 */
const PRODUCT_NAMES: Array<{ names: [string, string]; same: boolean; reason: string }> = [
  { names: ['Brave', 'Brave Browser'], same: true, reason: "Brave's browser, listed under both names." },
  { names: ['Brave', 'Brave Leo'], same: false, reason: "Leo is Brave's AI assistant, not the browser." },
  { names: ['Brave Browser', 'Brave Leo'], same: false, reason: "Leo is Brave's AI assistant, not the browser." },
  { names: ['Brave', 'Brave Search'], same: false, reason: "Brave Search is Brave's search engine, not the browser." },
  { names: ['Brave Browser', 'Brave Search'], same: false, reason: "Brave Search is Brave's search engine, not the browser." },
  { names: ['Chrome Incognito Mode', 'Incognito Browser'], same: false, reason: "Chrome's private window is not our Android browser." },
  { names: ['DuckDuckGo', 'DuckDuckGo Browser'], same: false, reason: 'The search engine and the browser are scored as the different products they are.' },
  { names: ['DuckDuckGo', 'DuckDuckGo Search & Tracker Protection'], same: false, reason: 'The search engine and the browser extension are different products.' },
  { names: ['DuckDuckGo Browser', 'DuckDuckGo Search & Tracker Protection'], same: false, reason: 'The browser and the extension are different products.' },
  { names: ['Firefox', 'Mozilla Firefox'], same: true, reason: 'One browser, listed under both names.' },
  { names: ['Firefox', 'Firefox Private Browsing'], same: false, reason: 'The browser and its private window are scored separately, as the incognito-mode page does.' },
  { names: ['Firefox', 'Firefox with Privacy Extensions'], same: false, reason: 'Firefox with extensions added is a different setup from Firefox itself.' },
  { names: ['Firefox', 'Firefox with uBlock Origin'], same: false, reason: 'Firefox with an extension added is a different setup from Firefox itself.' },
  { names: ['Firefox with uBlock Origin', 'uBlock Origin'], same: false, reason: 'The extension on its own is not Firefox running it.' },
  { names: ['Startpage', 'Startpage Anonymous View'], same: false, reason: "The search engine and its proxy viewer are scored separately." },
];

/** A product's name, stripped to what identifies it: no bracketed part, no case, no punctuation. */
const nameKey = (name: string) => name.toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Names reviewed as one product, folded onto the first of the pair. */
const SAME_PRODUCT = new Map(PRODUCT_NAMES.filter((e) => e.same).map((e) => [nameKey(e.names[1]), nameKey(e.names[0])]));
const productKey = (name: string) => SAME_PRODUCT.get(nameKey(name)) ?? nameKey(name);
/** Words that don't tell two products apart. */
const NAME_NOISE = new Set(['browser', 'browsers', 'app', 'apps', 'the', 'mobile', 'android']);
const nameWords = (name: string) => {
  const words = nameKey(name).split(' ').filter((w) => !NAME_NOISE.has(w));
  return words.length ? words : nameKey(name).split(' ');
};
/** Could these two names be one product? One name's words are all in the other's ("Firefox" in "Mozilla Firefox"). */
function couldBeOne(a: string, b: string): boolean {
  const [x, y] = [new Set(nameWords(a)), new Set(nameWords(b))];
  return [...x].every((w) => y.has(w)) || [...y].every((w) => x.has(w));
}

/**
 * Criterion rows that are the same fact under another name, reviewed. The key
 * also drops a leading "built-in" and reads "fingerprinting" as
 * "fingerprint", so "Fingerprint Protection" and "Fingerprinting Protection"
 * are one row.
 */
const CRITERION_SYNONYM: Array<{ keys: string[]; reason: string }> = [
  { keys: ['ease of use', 'usability', 'user friendliness'], reason: 'How easy the tool is to use, however the row is headed.' },
];
/**
 * Every criterion name in use, reviewed. A criterion's name is its key for the
 * one-value check below, so renaming a row to a synonym makes it a new fact
 * and the cross-page comparison never happens: "Ease of Use" renamed "How Easy
 * It Is", with Tor Browser's cell crossed, passed the whole suite (Wave 4
 * verifier, 2026-09-11). CRITERION_SYNONYM can only fold together the wordings
 * someone has thought of, so this is the other half of the rule, the same one
 * PRODUCT_NAMES is for products: a name nobody has reviewed fails, and
 * whoever adds it says whether it is a new fact or an old one under a new
 * name (by adding a CRITERION_SYNONYM entry).
 */
const CRITERION_NAMES: string[] = [
  'Ad & Tracker Blocking', 'Ad Blocking', 'Ad Tracking Prevention', 'Ad and Tracker Blocking', 'Additional Privacy Tools',
  'Anonymity Protection', 'Anonymous Communication', 'Anonymous Payment', 'Anonymous Registration', 'App Detection Resistance',
  'Attachment Protection', 'Audio Fingerprinting Protection', 'Automated Data Discovery', 'Automatic History Deletion',
  'Automatic Protection', 'Breach Monitoring', 'Bridge Support', 'Browser Integration', 'Browsing History Protection',
  'Built-in Ad Blocking', 'Business Features', 'Canvas Fingerprinting Protection', 'Compliance Reporting', 'Connection Encryption',
  'Consent Management', 'Consumer Request Management', 'Consumer Rights Management', 'Content Filtering', 'Conversation Privacy',
  'Cookie Consent Management', 'Cost', 'Cost Effectiveness', 'Cost Efficiency', 'Coverage Database', 'Credit Monitoring',
  'Cross-Device Sync Protection', 'Cross-Platform Protection', 'Cross-Platform Support', 'Cross-Site Protection',
  'Cross-Site Tracking Prevention', 'Custom Domain Support', 'Customer Support', 'Customization', 'Customization Options',
  'DNS Query Encryption', 'Dark Pattern Detection', 'Dark Web Monitoring', 'Data Broker Protection', 'Data Broker Removal',
  'Data Collection Blocking', 'Data Collection Transparency', 'Data Discovery & Mapping', 'Data Download Assistance',
  'Data Encryption', 'Data Mapping & Discovery', 'Default Privacy', 'Default Privacy Settings', 'Detection Range',
  'Device Compatibility', 'Digital Photo Protection', 'Disappearing Messages', 'Drone Disruption Capability',
  'Ease of Implementation', 'Ease of Setup', 'Ease of Use', 'Easy Setup', 'Ecosystem Support', 'End-to-End Encryption',
  'Extension Support', 'Family Sharing', 'Feature Completeness', 'File Sharing Capability', 'File Sharing Controls',
  'Fingerprint Protection', 'Fingerprinting Protection', 'Font Fingerprinting Protection', 'Free Storage Tier', 'GPS Spoofing',
  'Group Chat Size', 'HIPAA-Friendly Features', 'Identity Protection', 'Identity Theft Insurance', 'IoT Device Isolation',
  'Legal Compliance', 'Local Processing', 'Location Masking', 'Location Tracking', 'Malware Protection', 'Message Destruction',
  'Metadata Protection', 'Microphone Protection', 'Mobile App Protection', 'Mobile Apps', 'Mobile Banking Support',
  'Mobile Support', 'Money-Back Guarantee', 'Multi-Device Support', 'Multi-Factor Authentication', 'Multi-Frequency Detection',
  'Multi-State Law Coverage', 'Multi-jurisdictional Support', 'Multi-regulation Support', 'Multiple Device Support',
  'Network Traffic Encryption', 'No-Logs Policy', 'Number of Sites Covered', 'Ongoing Monitoring', 'Open Source',
  'Password Generation', 'Payment Security', 'Phishing Protection', 'Phishing Simulation Training', 'Physical Camera Blocking',
  'Physical Camera Protection', 'Platform Compatibility', 'Platform-Specific Privacy Settings', 'Price Manipulation Protection',
  'Pricing Accessibility', 'Privacy Impact Assessments', 'Privacy Protection', 'Privacy Transparency',
  'Proctoring Software Compatibility', 'Progress Reporting', 'Public WiFi Protection', 'Ransomware Protection',
  'Real-Time Privacy Alerts', 'Real-time Activity Monitoring', 'Real-time Alerts', 'Real-time Email Scanning',
  'Real-time Malware Protection', 'Real-time Updates', 'Recovery Assistance', 'Regulatory Risk', 'Removal Success Rate',
  'Reporting & Transparency', 'Reporting and Analytics', 'Reputation Monitoring', 'Risk Assessment Tools',
  'Safe Browsing Protection', 'School Network Compatibility', 'Screen Resolution Spoofing', 'Screen Time Management',
  'Search Engine Removal', 'Search Quality', 'Search Result Management', 'Secure Connection Features', 'Security Features',
  'Security Monitoring', 'Setup Difficulty', 'Shopping Features', 'Signal Blocking', 'Social Media Monitoring',
  'Social Media Tracker Blocking', 'Storage Space', 'Streaming Support', 'Subject Rights Management', 'System Performance Impact',
  'Telehealth Security', 'Third-Party Email Client Support', 'Third-Party Integration', 'Third-party Cookie Blocking',
  'Threat Intelligence', 'Tracker Blocking', 'Tracker Protection', 'Tracking Protection', 'Traffic Encryption', 'Traffic Hiding',
  'Traffic Monitoring', 'Training Data Opt-Out', 'Transaction Unlinkability', 'Two-Factor Authentication', 'URL Protection',
  'User Agent Randomization', 'User Experience', 'User-Friendly Interface', 'VR Data Protection', 'Vendor Management',
  'Voice Chat Privacy', 'Voice Privacy', 'WebGL Fingerprinting Protection', 'Website Compatibility', 'Zero-Knowledge Encryption',
];

const factKey = (criterion: string) => {
  const key = criterionKey(criterion).replace(/^built-in\s+/, '').replace(/fingerprinting/g, 'fingerprint');
  return CRITERION_SYNONYM.find((e) => e.keys.includes(key))?.keys[0] ?? key;
};

/**
 * The same product on the same criterion with different values on different
 * pages, each a reviewed exception with its reason. Anything else is one fact
 * scored two ways: parallel edits crossed Tor Browser's ease of use and
 * DeleteMe's cost effectiveness this way (Wave 2c verifier, 2026-09-11). A
 * test keeps each entry applying, so none goes stale once the owner decides.
 */
const INCONSISTENCY_OK: Array<{ key: string; reason: string }> = [
  {
    key: `${productKey(OUR_NAME)} :: ease of use`,
    reason: 'Owner decision pending (Wave 2c): good on ad-tracking and browser-extensions, excellent on incognito-mode.',
  },
];

/** Every product-and-criterion pair in data/comparisons, with its value on each page that scores it. */
function valuesAcrossPages(): Map<string, Array<{ file: string; value: string }>> {
  const out = new Map<string, Array<{ file: string; value: string }>>();
  for (const file of FILES) {
    const d = load(file);
    for (const f of d.features) {
      for (const p of d.products) {
        const key = `${productKey(p.name)} :: ${factKey(f.name)}`;
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push({ file, value: readCell(cellFor(f, p)?.value) ?? '—' });
      }
    }
  }
  return out;
}

describe('one product, one criterion, one value across data/comparisons', () => {
  // Read inside each test, so a bad cell fails a test instead of the whole file.
  const differs = (values: ReturnType<typeof valuesAcrossPages>, key: string) => new Set((values.get(key) ?? []).map((v) => v.value)).size > 1;

  it('scores the same product the same on the same criterion on every page (bar reviewed exceptions)', () => {
    const values = valuesAcrossPages();
    const exempt = new Set(INCONSISTENCY_OK.map((e) => e.key));
    const problems = [...values.keys()]
      .filter((key) => differs(values, key) && !exempt.has(key))
      .map((key) => `${key}: ${values.get(key)!.map((v) => `${v.value} on ${v.file}`).join(', ')}`);
    expect(problems).toEqual([]);
  });

  it('every reviewed exception still applies and says why', () => {
    const values = valuesAcrossPages();
    for (const e of INCONSISTENCY_OK) {
      expect(differs(values, e.key), `${e.key} now has one value: drop its INCONSISTENCY_OK entry`).toBe(true);
      expect(e.reason.trim()).not.toBe('');
    }
  });

  it('every pair of product names that could be one product has been reviewed', () => {
    // Renaming a row is otherwise a way round the check above: "Brave" and
    // "Brave Browser", "DeleteMe" and "DeleteMe (Abine)".
    const names = [...new Set(FILES.flatMap((f) => load(f).products.map((p) => p.name)))].sort();
    const reviewed = new Set(PRODUCT_NAMES.map((e) => [...e.names].sort().join(' <-> ')));
    const unreviewed: string[] = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const pair = [names[i], names[j]].sort().join(' <-> ');
        if (couldBeOne(names[i], names[j]) && !reviewed.has(pair)) unreviewed.push(pair);
      }
    }
    expect(unreviewed, 'add a PRODUCT_NAMES entry saying whether these are one product').toEqual([]);
  });

  it('every criterion name in the data is one somebody reviewed, and every reviewed name is still in use', () => {
    // Renaming a criterion is otherwise a way round the check above: the row
    // moves to a new key, so no page is compared with any other on it.
    const inData = [...new Set(FILES.flatMap((f) => load(f).features.map((x) => x.name)))].sort();
    const reviewed = new Set(CRITERION_NAMES);
    expect(
      inData.filter((n) => !reviewed.has(n)),
      'add the criterion name to CRITERION_NAMES, and a CRITERION_SYNONYM entry if it is an existing row renamed',
    ).toEqual([]);
    expect(CRITERION_NAMES.filter((n) => !inData.includes(n)), 'drop the CRITERION_NAMES entries no comparison uses any more').toEqual([]);
    expect(new Set(CRITERION_NAMES).size, 'CRITERION_NAMES lists a name twice').toBe(CRITERION_NAMES.length);
  });

  it('every reviewed pair of names is still in the data, and every criterion synonym is in use', () => {
    const names = new Set(FILES.flatMap((f) => load(f).products.map((p) => p.name)));
    for (const e of PRODUCT_NAMES) {
      for (const n of e.names) expect([...names], `PRODUCT_NAMES lists "${n}", which no comparison uses any more`).toContain(n);
      expect(e.reason.trim(), e.names.join(' <-> ')).not.toBe('');
    }
    const used = new Set(FILES.flatMap((f) => load(f).features.map((x) => factKey(x.name))));
    for (const e of CRITERION_SYNONYM) {
      expect(e.keys.length).toBeGreaterThan(1);
      expect([...used], `no comparison has a "${e.keys[0]}" row any more`).toContain(e.keys[0]);
      expect(e.reason.trim(), e.keys.join('/')).not.toBe('');
    }
  });
});

// --- every real page, rendered -------------------------------------------------

describe('every comparison in data/comparisons renders the disclosure exactly when it compares us', () => {
  it.each(FILES)('%s', (file) => {
    const d = load(file);
    const html = render(d);
    const t = text(html);
    const ours = includesOurProduct(d.products);
    const times = ours ? 1 : 0;
    // The disclosure, the badge on our card and the note under the table: once each, and only here.
    expect(countOf(html, 'data-testid="comparison-disclosure"'), 'disclosure').toBe(times);
    expect(countOf(t, DISCLOSURE), 'disclosure text').toBe(times);
    expect(countOf(t, WE_MAKE_THIS), 'badge').toBe(times);
    expect(countOf(html, 'data-testid="comparison-ib-no-note"'), 'note').toBe(times);
    expect(countOf(t, IB_NO_NOTE), 'note text').toBe(times);
    if (ours) {
      // Right under the hero, before the intro; the badge on our card, beside our name.
      expect(t.indexOf(DISCLOSURE)).toBeLessThan(t.indexOf(d.intro.replace(/\s+/g, ' ').trim()));
      expect(html).toMatch(new RegExp(`<h3 class="font-semibold text-t1">${escapeRe(OUR_NAME)}</h3><span[^>]*>${WE_MAKE_THIS}</span>`));
      // And both are there to be read, not hidden from sight.
      expect([...hiddenAt(html, 'comparison-disclosure'), ...hiddenAt(html, 'comparison-ib-no-note')]).toEqual([]);
    }
    // Highest rated first, as the methodology says: the cards and the table's columns.
    const order = scoreProducts(d).map((s) => s.name);
    expect(cardNames(html)).toEqual(order);
    expect(columnNames(html)).toEqual(order);
    // A table with a gap explains the dash in full.
    const gaps = d.features.some((f) => d.products.some((p) => readCell(cellFor(f, p)?.value) === null));
    expect(t.includes(DASH_LEGEND)).toBe(gaps);
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
      for (const { file, description } of b.on) {
        expect(IB_COMPARABLE, `${criterion}: ${file}`).toContain(file);
        const f = load(file).features.find((x) => criterionKey(x.name) === criterion);
        expect(f, `${criterion} is not a criterion on ${file}`).toBeTruthy();
        // The reviewed wording, so a row can't be re-described into something else.
        expect(f!.description, `${criterion} on ${file} is described differently now: review it again`).toBe(description);
      }
    }
    // Never a criterion on one of brand.json's never-claims.
    expect(Object.keys(IB_BACKING).filter((c) => /fingerprint|vpn|\btor\b|onion|open source|anonym|all platforms|\bios\b|desktop/.test(c) || NEVER_CLAIM_CRITERION.test(c))).toEqual([]);
    // Reviewed 2026-09-10: no tracker blocker or fingerprint protection is documented, and
    // having no history on the device doesn't stop an engine's account history syncing.
    expect(IB_BACKING).not.toHaveProperty('tracker blocking');
    expect(IB_BACKING).not.toHaveProperty('user agent randomization');
    expect(IB_BACKING['cross-device sync protection']?.max).toBe('partial');
    // The Play listing documents that an ad blocker exists, not how well it blocks, so it can't
    // draw level with an "excellent" blocker on any page (Wave 2c verifier, 2026-09-11).
    expect(IB_BACKING['ad blocking']?.max).toBe('good');
    expect(IB_BACKING['built-in ad blocking']?.max).toBe('good');
    // Every reviewed page still compares us. Renaming our row to hide it (a
    // clean concealment takes its disclosure, badge and note with it) then
    // means editing this list (Wave 3 verifier, 2026-09-11).
    for (const f of IB_COMPARABLE) {
      expect(FILES).toContain(f);
      expect(includesOurProduct(load(f).products), `${f} is in IB_COMPARABLE but no longer lists ${OUR_NAME}`).toBe(true);
    }
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
          } else if (!backing.on.some((o) => o.file === file)) {
            problems.push(`"${f.name}" is '${value}', but IB_BACKING's entry was reviewed only for ${backing.on.map((o) => o.file).join(', ')}: make it 'no', or review this page and add it`);
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
    // Each is checked on every file in "fits the schema's length limits".
    expect([META_MAX, INTRO_MAX, TITLE_MAX]).toEqual([160, 300, 70]);
  });

  it('tells the generator the rules the data tests hold it to: one name per criterion, and speed only from a cited lab result', () => {
    const criterion = SCHEMA.properties.features.items.properties.name.description as string;
    const note = cell.properties.note.description as string;
    expect(criterion).toMatch(/\bonce on the page\b/);
    expect(criterion).toMatch(/speed, performance, latency or resource use/);
    for (const lab of MEASUREMENT_SOURCES) expect(note).toContain(lab);
    expect(note).toMatch(/test's name, its date or a figure/);
    // Its example is a note the data rule accepts.
    const example = note.match(/"([^"]+)"/)?.[1] ?? '';
    expect(citesLabResult(example), example).toBe(true);
  });
});
