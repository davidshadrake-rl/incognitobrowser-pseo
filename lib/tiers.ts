/**
 * Free / Pro tool tiers — one source of truth.
 *
 * Decided 2026-09-07: four engines are Pro and live on a separate
 * deployment (same repo, second Vercel project, NEXT_PUBLIC_TIER=pro).
 * There is no gate yet — "for now we are simply dividing the tools up".
 *
 * How the flag behaves:
 *   NEXT_PUBLIC_TIER=free (default) — the marketing site. Shows every tool.
 *     Pro-engine pages stay here as the free one-shot version (they're the
 *     flagship funnels and indexed pSEO pages) and carry a "Pro" badge that
 *     links to the Pro deployment.
 *   NEXT_PUBLIC_TIER=pro — the Pro deployment. Shows ONLY the Pro engines,
 *     no pSEO content pages, and is noindex sitewide: it's a product surface
 *     (gate coming later), not an SEO surface, and must not compete with the
 *     free site for the same content.
 *
 * Tier is a property of the ENGINE, not the niche page — every niche shell
 * of a Pro engine is Pro.
 */

export type Tier = 'free' | 'pro';

export const PRO_ENGINES = new Set<string>([
  'cookie-analyzer', // site-wide crawl, scheduled re-scans, compliance export
  'browser-privacy', // fingerprint history over time, change alerts, reports
  'url-analyzer', // bulk URL checking, unfurl + monitoring
  'metadata-viewer', // batch / folder EXIF strip
]);

export function tierOfEngine(engine: string | undefined | null): Tier {
  return engine && PRO_ENGINES.has(engine) ? 'pro' : 'free';
}

/** Which deployment this build is. Baked in at build time (NEXT_PUBLIC_). */
export const TIER: Tier = process.env.NEXT_PUBLIC_TIER === 'pro' ? 'pro' : 'free';
export const IS_PRO_DEPLOYMENT = TIER === 'pro';

/** Where the Pro deployment lives — the free site links Pro-engine pages here. */
export const PRO_BASE_URL: string =
  process.env.NEXT_PUBLIC_PRO_URL?.replace(/\/$/, '') || 'https://pro.incognitobrowser.io';

/** Where the free marketing site lives — the Pro deployment links back here. */
export const FREE_BASE_URL: string =
  process.env.NEXT_PUBLIC_FREE_URL?.replace(/\/$/, '') || 'https://incognitobrowser.io/resources';

/** Should this deployment render a given engine's tool pages at all? */
export function engineVisibleInThisTier(engine: string | undefined | null): boolean {
  if (!IS_PRO_DEPLOYMENT) return true; // free site shows everything
  return tierOfEngine(engine) === 'pro';
}

/** Path to the same tool on the Pro deployment (server-mode: no /resources prefix). */
export function proUrlFor(niche: string, slug: string): string {
  return `${PRO_BASE_URL}/tools/${niche}/${slug}`;
}
