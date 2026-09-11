/**
 * The comparison rubric: the only way a product's rating is worked out on a
 * comparison page. It is published at /comparisons/methodology, which renders
 * its points table from POINTS below, so keep the two saying the same thing.
 *
 *   - A cell is features[].scores[productSlug] = { value, note? }. Every key
 *     must be a product on the page (its slug, or its name in older files):
 *     a key that matches no product throws (checkTable), because its cell
 *     would otherwise be skipped as if it were blank.
 *   - value → points: yes / excellent = 1; good = 0.75; partial / fair /
 *     limited = 0.5; poor = 0.25; no / none = 0.
 *   - '—', 'unknown', 'n/a' or a missing cell is NOT ASSESSED: it is left out
 *     of the average and does not count towards coverage. An empty value, or
 *     any value outside the rubric, throws.
 *   - Rating = round(10 × mean(points of the assessed cells), 1), a half
 *     rounding up. Worked in whole quarter-points, so a true half can't land
 *     a hair below and round down (in floating point, 0.575 × 100 is
 *     57.49999999999999).
 *   - A product with fewer than half of the page's criteria assessed gets no
 *     rating ("Not enough data") and ranks last.
 *   - Ties (the same rounded rating): alphabetical by name.
 *
 * Nobody types a rating. products[].rating in the data files is never read;
 * toComparisonView() drops it before anything reaches the page.
 *
 * The scorer only scores. It has no product-specific rule: the convention that
 * an Incognito Browser criterion data/brand.json can't back is 'no', never
 * '—', is a rule about the DATA (a blank would be left out and could lift our
 * rating). tests/comparison-score.test.ts enforces it on data/comparisons;
 * this file does not.
 *
 * Pure and dependency-free: the client ComparisonPage imports it, so it must
 * not touch fs or anything server-only.
 */

/** Where every comparison's "How we score" link points. */
export const METHODOLOGY_PATH = '/comparisons/methodology';

/** The product we make. Pages that include it carry a disclosure. */
export const OUR_PRODUCT_SLUG = 'incognito-browser';

/** Cell values the rubric scores, and their points. */
export const POINTS = {
  yes: 1,
  excellent: 1,
  good: 0.75,
  partial: 0.5,
  fair: 0.5,
  limited: 0.5,
  poor: 0.25,
  no: 0,
  none: 0,
} as const;

export type RatedValue = keyof typeof POINTS;

/** The same points in whole quarters, for exact arithmetic. */
const QUARTERS: Record<RatedValue, number> = {
  yes: 4, excellent: 4, good: 3, partial: 2, fair: 2, limited: 2, poor: 1, no: 0, none: 0,
};

/** How a scored value is written on the page. */
export const CELL_LABEL: Record<RatedValue, string> = {
  yes: 'Yes', excellent: 'Excellent', good: 'Good',
  partial: 'Partial', fair: 'Fair', limited: 'Limited',
  poor: 'Poor', no: 'No', none: 'None',
};

/**
 * Values that mean "not assessed". The rubric names '—', 'unknown' and 'n/a';
 * a hyphen or en dash typed for the em dash means the same thing and is
 * treated the same way. An empty value is NOT one of them: a cleared cell is
 * more likely a mistake than a decision, and reading it as "not assessed"
 * would leave it out of the average, which can lift a rating. It throws.
 */
export const NOT_ASSESSED = ['—', 'unknown', 'n/a'] as const;
const NOT_ASSESSED_SET = new Set<string>([...NOT_ASSESSED, '-', '–']);

/** One cell of a comparison table. */
export interface ComparisonCell {
  value?: string | null;
  note?: string;
}

export interface ScoreInput {
  products: ReadonlyArray<{ slug: string; name: string }>;
  features: ReadonlyArray<{
    name?: string;
    scores?: Readonly<Record<string, ComparisonCell | null | undefined>> | null;
  }>;
}

export interface ProductScore {
  slug: string;
  name: string;
  /** 0–10 to one decimal place, or null for "Not enough data". */
  rating: number | null;
  /** 1-based: highest rating first, ties by name, unrated products last. */
  rank: number;
  /** Criteria with an assessed cell for this product. */
  assessed: number;
  /** Criteria on the page. */
  criteria: number;
}

export class UnknownCellValueError extends Error {
  constructor(value: unknown, where?: string) {
    const empty = typeof value === 'string' && value.trim() === '';
    super(
      `Comparison cell value ${JSON.stringify(value)}${where ? ` (${where})` : ''} ` +
      `${empty ? 'is empty' : 'is not in the rubric'}. ` +
      `Use one of ${Object.keys(POINTS).join(', ')}, or "—", "unknown" or "n/a" for not assessed ` +
      '(lib/comparison-score.ts).',
    );
    this.name = 'UnknownCellValueError';
  }
}

/** A comparison table whose cells don't map one-to-one onto its products. */
export class ComparisonTableError extends Error {
  constructor(message: string) {
    super(`${message} (lib/comparison-score.ts).`);
    this.name = 'ComparisonTableError';
  }
}

/**
 * The rubric value a cell holds, or null when it is not assessed. Case and
 * surrounding spaces are ignored. A value outside the rubric throws rather
 * than being quietly left out: leaving it out would change a rating without
 * anyone deciding it should, so a typo in the data fails the tests and the
 * build instead.
 */
export function readCell(value: unknown, where?: string): RatedValue | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new UnknownCellValueError(value, where);
  const v = value.trim().toLowerCase();
  if (NOT_ASSESSED_SET.has(v)) return null;
  if (Object.prototype.hasOwnProperty.call(POINTS, v)) return v as RatedValue;
  throw new UnknownCellValueError(value, where);
}

/** Points for a cell value, or null when it is not assessed. */
export function pointsFor(value: unknown): number | null {
  const v = readCell(value);
  return v === null ? null : POINTS[v];
}

/**
 * A feature's cell for one product. The rubric keys cells by product slug;
 * some data files key them by product name, so that is read too (slug wins).
 * The page draws the table through this same lookup, so the rating and the
 * table can never disagree about which cell belongs to whom.
 */
export function cellFor(
  feature: ScoreInput['features'][number],
  product: { slug: string; name: string },
): ComparisonCell | undefined {
  const scores = feature.scores;
  if (!scores) return undefined;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(scores, k) && scores[k] != null;
  if (has(product.slug)) return scores[product.slug] ?? undefined;
  if (has(product.name)) return scores[product.name] ?? undefined;
  return undefined;
}

/**
 * Throws unless every cell in the table belongs to exactly one product on the
 * page. cellFor only looks a product up by slug or name, so without this a
 * cell under a mistyped or stale key would be skipped and read as "not
 * assessed", leaving it out of the average (a lost 'no' lifts a rating).
 *   - every scores key is the slug or name of a product on the page;
 *   - no product has cells under both its slug and its name;
 *   - no two products share a slug.
 */
export function checkTable(data: ScoreInput): void {
  const slugs = new Set<string>();
  for (const p of data.products) {
    if (slugs.has(p.slug)) throw new ComparisonTableError(`Two products share the slug "${p.slug}"`);
    slugs.add(p.slug);
  }
  for (const feature of data.features) {
    const scores = feature.scores ?? {};
    const criterion = `Criterion "${feature.name ?? '?'}"`;
    for (const key of Object.keys(scores)) {
      if (!data.products.some((p) => p.slug === key || p.name === key)) {
        throw new ComparisonTableError(
          `${criterion} has a cell under "${key}", which is not the slug or name of any product on the page`,
        );
      }
    }
    for (const p of data.products) {
      if (p.name !== p.slug && scores[p.slug] != null && scores[p.name] != null) {
        throw new ComparisonTableError(`${criterion} has two cells for "${p.slug}", one under its slug and one under its name`);
      }
    }
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Alphabetical by name (case-insensitive), then by slug so the order is total. */
export function compareByName(a: { name: string; slug: string }, b: { name: string; slug: string }): number {
  return collator.compare(a.name, b.name) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

/** round(10 × mean, 1) with a half rounding up, as tenths, from a quarter-point sum. */
function tenthsFromQuarters(sumQuarters: number, count: number): number {
  // mean = sumQuarters / (4 × count), so 10 × mean in tenths is
  // 25 × sumQuarters / count; floor(x + 1/2) in integers is below.
  return Math.floor((50 * sumQuarters + count) / (2 * count));
}

/**
 * Every product's rating and rank, from the page's table alone. Returned in
 * rank order. Does not modify its input. Throws on a table checkTable rejects
 * or a cell value readCell rejects.
 */
export function scoreProducts(data: ScoreInput): ProductScore[] {
  checkTable(data);
  const criteria = data.features.length;

  const scored = data.products.map((product) => {
    let assessed = 0;
    let sumQuarters = 0;
    for (const feature of data.features) {
      const where = `product "${product.slug}", criterion "${feature.name ?? '?'}"`;
      const value = readCell(cellFor(feature, product)?.value, where);
      if (value === null) continue;
      assessed++;
      sumQuarters += QUARTERS[value];
    }
    // At least half of the page's criteria must be assessed. `assessed === 0`
    // also covers a page with no criteria, where there is nothing to average.
    const enough = assessed > 0 && assessed * 2 >= criteria;
    const tenths = enough ? tenthsFromQuarters(sumQuarters, assessed) : null;
    return { slug: product.slug, name: product.name, tenths, assessed };
  });

  scored.sort((a, b) => {
    if (a.tenths === null || b.tenths === null) {
      if (a.tenths !== b.tenths) return a.tenths === null ? 1 : -1;
      return compareByName(a, b);
    }
    return b.tenths - a.tenths || compareByName(a, b);
  });

  return scored.map((s, i) => ({
    slug: s.slug,
    name: s.name,
    rating: s.tenths === null ? null : s.tenths / 10,
    rank: i + 1,
    assessed: s.assessed,
    criteria,
  }));
}

/** "7.5/10", or "Not enough data". */
export function formatRating(rating: number | null): string {
  return rating === null ? 'Not enough data' : `${rating.toFixed(1)}/10`;
}

/** Does this comparison include the product we make? */
export function includesOurProduct(products: ReadonlyArray<{ slug: string }>): boolean {
  return products.some((p) => p.slug === OUR_PRODUCT_SLUG);
}

// ---------------------------------------------------------------------------
// What the client page receives
// ---------------------------------------------------------------------------

/** A comparison data file, as far as the page reads it. */
export interface ComparisonSource {
  niche: string;
  title: string;
  intro: string;
  products: Array<{
    name: string;
    slug: string;
    tagline: string;
    pricing?: string;
    /** A list of platforms, or one string. Optional. */
    platforms?: unknown;
    pros?: string[];
    cons?: string[];
  }>;
  features: Array<{
    name: string;
    description: string;
    scores?: Record<string, ComparisonCell | null | undefined> | null;
  }>;
  verdict: { summary: string; bestFor: Array<{ useCase: string; product: string; reason: string }> };
  faqs?: Array<{ question: string; answer: string }>;
}

export interface ComparisonProductView {
  name: string;
  slug: string;
  tagline: string;
  pricing?: string;
  platforms?: string[];
  pros: string[];
  cons: string[];
}

export interface ComparisonFeatureView {
  name: string;
  description: string;
  /** Keyed by product slug. A product with no cell has no key. */
  scores: Record<string, { value: string }>;
}

export interface ComparisonView {
  niche: string;
  title: string;
  intro: string;
  products: ComparisonProductView[];
  features: ComparisonFeatureView[];
  verdict: { summary: string; bestFor: Array<{ useCase: string; product: string; reason: string }> };
  faqs: Array<{ question: string; answer: string }>;
}

function platformsOf(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.filter((p): p is string => typeof p === 'string').map((p) => p.trim()).filter(Boolean);
}

/**
 * The fields the client ComparisonPage renders, and nothing else.
 *
 * Every prop of a client component is serialised into the page's HTML, so
 * this is a whitelist, not a blacklist: no author, editor or editorial block
 * (see redactPeople in lib/content.ts), no typed products[].rating (ratings
 * come from the table only), no cell notes (not shown), and cells re-keyed by
 * product slug.
 *
 * Re-keying keeps only cells that belong to a product, so the source table is
 * checked here first: a stray key must fail the build, not vanish from the
 * view the page scores.
 */
export function toComparisonView(data: ComparisonSource): ComparisonView {
  checkTable(data);
  return {
    niche: data.niche,
    title: data.title,
    intro: data.intro,
    products: data.products.map((p) => {
      const platforms = platformsOf(p.platforms);
      return {
        name: p.name,
        slug: p.slug,
        tagline: p.tagline,
        ...(p.pricing ? { pricing: p.pricing } : {}),
        ...(platforms.length ? { platforms } : {}),
        pros: p.pros ?? [],
        cons: p.cons ?? [],
      };
    }),
    features: data.features.map((f) => {
      const scores: Record<string, { value: string }> = {};
      for (const p of data.products) {
        const value = cellFor(f, p)?.value;
        if (value !== undefined && value !== null) scores[p.slug] = { value: String(value) };
      }
      return { name: f.name, description: f.description, scores };
    }),
    verdict: {
      summary: data.verdict.summary,
      bestFor: data.verdict.bestFor.map((b) => ({ useCase: b.useCase, product: b.product, reason: b.reason })),
    },
    faqs: (data.faqs ?? []).map((f) => ({ question: f.question, answer: f.answer })),
  };
}
