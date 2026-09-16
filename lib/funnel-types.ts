/**
 * The shapes of a page's funnel, with no data in them.
 *
 * Browser-side components import from HERE, never from lib/funnels.ts: that
 * module imports data/funnels.json (every page's funnel, about 2 MB), and a
 * single value import of it from a client component shipped the whole
 * internal plan to visitors' browsers, 500 KB gzipped on a glossary page
 * (2026-09-16). tests/client-bundle.test.ts keeps it out of the build.
 */

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
 * Where the visitor meets the tool from this page:
 *   inline  a free tool on this deployment: the card links to its page
 *   link    a tool this deployment doesn't build (a Pro tool on the free site)
 *           or one that can't share a page: the card links to it absolutely
 *   page    this IS the tool page: the answer sits under "What to do now"
 *   card    a report card: the grade is the result, known when the page is built
 * All but `card` reach the visitor through the same plain card.
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
