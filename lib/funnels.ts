/**
 * The per-page Pro funnel.
 *
 * Every page carries the same five steps, worded for that page and no other:
 *   1 the page's own problem, quoted from the page
 *   2 a free check that measures it
 *   3 what the visitor's own result means for them
 *   4 what Incognito Pro does about it, as an outcome
 *   5 the upgrade, carrying this page's context
 *
 * Two record shapes live side by side while pages are rewritten:
 *   v1 (the first draft, live 2026-09-14): one step-3 line per colour, all
 *      shown before the visitor has run anything, and one Pro line for every
 *      result. The owner judged these "a fair start but not compelling".
 *   v2 (2026-09-16): the check runs inside the page and only the visitor's own
 *      result is answered, with its own meaning, Pro line and button. Stakes
 *      come first, in plain words.
 * A v1 record renders as it always has until it is rewritten as v2.
 *
 * The text is drafted and reviewed offline in funnel-drafts/, which is kept out
 * of the repo (it is public, and the drafts carry review notes), validated by
 * scripts/funnels/validate.ts, and exported to data/funnels.json by
 * scripts/funnels/export.ts. Nothing here invents copy; it only looks it up.
 */
import funnels from '@/data/funnels.json';
import { engineVisibleInThisTier, proUrlFor, tierOfEngine } from '@/lib/tiers';

export type FunnelSeverity = 'red' | 'amber' | 'green' | 'info';

export interface PageFunnelV1 {
  v?: 1;
  path: string;
  type: string;
  topic: string | null;
  step1: { label: string; quote: string };
  /** null when no published tool page hosts the engine — a report card is its own check. */
  step2: { engine: string; heading: string; instruction: string; button: string; href: string | null };
  step3: { red: string; amber: string; green: string };
  step4: { line: string };
  step5: { label: string };
}

/** What one result means for the visitor, what Pro does about it, and the button that asks. */
export interface ResultCopy {
  meaning: string;
  pro: string;
  button: string;
}

/**
 * How the check is reached from this page:
 *   inline  it runs inside the funnel (a free engine on a content page)
 *   link    it opens on its own page: a Pro engine on the free site, or an
 *           engine that can't share a page (LINK_OUT_ENGINES)
 *   page    this IS the tool page: the funnel answers the page's own engine
 *   card    a report card: the grade is the result, known when the page is built
 */
export type CheckMode = 'inline' | 'link' | 'page' | 'card';

export interface PageFunnelV2 {
  v: 2;
  path: string;
  type: string;
  topic: string | null;
  step1: { label: string; quote: string };
  /** What happens to the visitor, in everyday words, before they run anything. */
  stakes: string;
  check: { engine: string; button: string; mode: CheckMode; href: string | null };
  /** One entry per result the check can return. */
  results: Partial<Record<FunnelSeverity, ResultCopy>>;
}

export type PageFunnel = PageFunnelV1 | PageFunnelV2;

export const isV2 = (f: PageFunnel): f is PageFunnelV2 => f.v === 2;

/**
 * Engines that can't run inside another page, so a funnel links to their own
 * page instead: the quiz reads and rewrites the address bar's #r= hash, which
 * belongs to the page hosting it.
 */
export const LINK_OUT_ENGINES = new Set(['privacy-quiz']);

interface StoredTarget { niche: string; slug: string }
type StoredV1 = Omit<PageFunnelV1, 'path' | 'step2'> & {
  step2: { engine: string; heading: string; instruction: string; button: string; target: StoredTarget | null; query: string };
};
type StoredV2 = Omit<PageFunnelV2, 'path' | 'check'> & {
  check: { engine: string; button: string; target: StoredTarget | null; query: string };
};

const BY_URL = funnels as unknown as Record<string, StoredV1 | StoredV2>;

/**
 * Where this deployment's copy of a tool page lives. A Pro engine's tool page
 * is only built on the Pro deployment, so the free site links to it
 * absolutely; a free engine is a path within whichever site is rendering.
 * Null when the engine has no page here at all.
 */
function hrefFor(engine: string, target: StoredTarget | null, query: string): string | null {
  if (!target) return null;
  if (tierOfEngine(engine) === 'pro') return proUrlFor(target.niche, target.slug);
  if (!engineVisibleInThisTier(engine)) return null;
  return `/tools/${target.niche}/${target.slug}/${query ? `?${query}` : ''}`;
}

function modeFor(type: string, engine: string): CheckMode {
  if (engine === 'report-card') return 'card';
  if (type === 'tool' || type === 'pro-tool') return 'page';
  // The free site builds no Pro tool code, and some engines can't share a page.
  if (!engineVisibleInThisTier(engine) || LINK_OUT_ENGINES.has(engine)) return 'link';
  return 'inline';
}

/**
 * This page's funnel, or null where it has none. Utility pages (editorial
 * standards, the methodology pages) are deliberate no-funnel records, not
 * oversights: nothing on them is a problem a check can settle.
 *
 * Paths are stored without a trailing slash, which is how the funnel records
 * are keyed; callers pass either form.
 */
export function funnelFor(path: string): PageFunnel | null {
  const key = path.length > 1 ? path.replace(/\/$/, '') : path;
  const stored = BY_URL[key];
  if (!stored) return null;
  if ((stored as StoredV2).v === 2) {
    const s = stored as StoredV2;
    const { target, query, ...check } = s.check;
    return { ...s, v: 2, path: key, check: { ...check, mode: modeFor(s.type, check.engine), href: hrefFor(check.engine, target, query) } };
  }
  const s = stored as StoredV1;
  const { target, query, ...step2 } = s.step2;
  return { ...s, path: key, step2: { ...step2, href: hrefFor(step2.engine, target, query) } };
}

/** Every page that has one: the coverage test, and the allowlist for per-page event counters. */
export function allFunnelPaths(): string[] {
  return Object.keys(BY_URL);
}
