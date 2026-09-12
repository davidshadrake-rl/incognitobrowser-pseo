/**
 * The per-page Pro funnel (PER-PAGE-PRO-FUNNEL plan, owner 2026-09-10).
 *
 * Every page carries the same five steps, worded for that page and no other:
 *   1 the page's own problem, quoted from the page
 *   2 a free check that measures it
 *   3 what each result would mean, here
 *   4 what the Incognito Pro subscription does about it, on this subject
 *   5 the upgrade, carrying this page's context
 *
 * The text is drafted and reviewed offline in funnel-drafts/, which is kept out
 * of the repo (it is public, and the drafts carry review notes), validated by
 * scripts/funnels/validate.ts, and exported to data/funnels.json by
 * scripts/funnels/export.ts. Nothing here invents copy; it only looks it up.
 */
import funnels from '@/data/funnels.json';
import { engineVisibleInThisTier, proUrlFor, tierOfEngine } from '@/lib/tiers';

export interface PageFunnel {
  type: string;
  topic: string | null;
  step1: { label: string; quote: string };
  /** null when no published tool page hosts the engine — a report card is its own check. */
  step2: { engine: string; heading: string; instruction: string; button: string; href: string | null };
  step3: { red: string; amber: string; green: string };
  step4: { line: string };
  step5: { label: string };
}

interface StoredFunnel extends Omit<PageFunnel, 'step2'> {
  step2: { engine: string; heading: string; instruction: string; button: string; target: { niche: string; slug: string } | null; query: string };
}

const BY_URL = funnels as unknown as Record<string, StoredFunnel>;

/**
 * Where this deployment's copy of the check lives. A Pro engine's tool page is
 * only built on the Pro deployment, so the free site links to it absolutely;
 * a free engine is a path within whichever site is rendering. Null when the
 * engine has no page here at all, and the page then shows steps 1, 4 and 5.
 */
function hrefFor(step2: StoredFunnel['step2']): string | null {
  const { target, engine, query } = step2;
  if (!target) return null;
  if (tierOfEngine(engine) === 'pro') return proUrlFor(target.niche, target.slug);
  if (!engineVisibleInThisTier(engine)) return null;
  return `/tools/${target.niche}/${target.slug}/${query ? `?${query}` : ''}`;
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
  const { target: _target, query: _query, ...step2 } = stored.step2;
  return { ...stored, step2: { ...step2, href: hrefFor(stored.step2) } };
}

/** Every page that has one, for the coverage test. */
export function allFunnelPaths(): string[] {
  return Object.keys(BY_URL);
}
