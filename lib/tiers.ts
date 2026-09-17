/**
 * Free / Pro tool tiers — one source of truth.
 *
 * Decided 2026-09-07: four engines are Pro and live on a separate
 * deployment (same repo, second Vercel project, NEXT_PUBLIC_TIER=pro).
 * There is no gate yet — "for now we are simply dividing the tools up".
 *
 * How the flag behaves:
 *   NEXT_PUBLIC_TIER=free (default) — the marketing site. Shows ONLY the
 *     free engines. Pro-engine tool pages are not built here, are not in the
 *     sitemap, and are never linked from free pages (link generators consult
 *     engineVisibleInThisTier). Decided 2026-09-08: "pro tools are still in
 *     the free privacy tools catalogue" — the split is a clean division.
 *   NEXT_PUBLIC_TIER=pro — the Pro deployment. Shows ONLY the Pro engines,
 *     no pSEO content pages, and is noindex sitewide: it's a product surface
 *     (gate coming later), not an SEO surface, and must not compete with the
 *     free site for the same content. Its related-content links point back
 *     at the free site (absolute URLs) because those pages exist only there.
 *
 * Tier is a property of the ENGINE, not the niche page — every niche shell
 * of a Pro engine is Pro.
 */

export type Tier = 'free' | 'pro';

/**
 * The definition of Pro every surface shares. Import it, never paraphrase it.
 * "Pro" alone always means the paid app tier; the second deployment is
 * "the Pro tools site", never "Incognito Pro". What it adds is exactly
 * data/brand.json's `pro` outcomes (owner, 2026-09-16).
 */
export const PRO_DEFINITION =
  'Incognito Pro is the paid tier of the free Incognito Browser Android app. It blocks tracking scripts and pixels (the free app already blocks ads), hides the empty boxes blocked ads leave, and strips location and other metadata from a whole folder of photos at once.';
/**
 * Under every upgrade button. The Play listing a button opens is the free
 * Incognito Browser app's and never mentions Pro, so this says where Pro is.
 * It never says how Pro is billed or cancelled (owner, 2026-09-17).
 */
export const PRO_FOOTNOTE = 'Pro is part of the free Incognito Browser app. Android only.';

/**
 * The tools that are part of Incognito Pro. What Pro itself adds, as outcomes,
 * is data/brand.json's `pro` block (owner, 2026-09-16): tracker blocking,
 * hiding the empty ad boxes, and cleaning the metadata from a whole folder of
 * photos. Pro does NOT do fingerprint change alerts, link monitoring, scheduled
 * re-scans or a compliance export; those are never-claims, whatever these
 * tools' names might suggest.
 */
export const PRO_ENGINES = new Set<string>([
  'cookie-analyzer',
  'browser-privacy',
  'url-analyzer',
  'metadata-viewer', // the one-photo reader; Pro's batch cleaning handles whole folders
]);

export function tierOfEngine(engine: string | undefined | null): Tier {
  return engine && PRO_ENGINES.has(engine) ? 'pro' : 'free';
}

/** Which deployment this build is. Baked in at build time (NEXT_PUBLIC_). */
export const TIER: Tier = process.env.NEXT_PUBLIC_TIER === 'pro' ? 'pro' : 'free';
export const IS_PRO_DEPLOYMENT = TIER === 'pro';

/**
 * Where the Pro deployment lives — the free site links Pro-engine pages here.
 * Default is the LIVE host. pro.incognitobrowser.io has no DNS yet; when it
 * does, set NEXT_PUBLIC_PRO_URL (or change this default) — never default to
 * a host that does not resolve, or every free→Pro link ships dead.
 */
export const PRO_BASE_URL: string =
  process.env.NEXT_PUBLIC_PRO_URL?.replace(/\/$/, '') || 'https://incognitobrowser-pro.vercel.app';

/**
 * Where the free marketing site lives — the Pro deployment links back here.
 * Default is the LIVE host: incognitobrowser.io/resources currently 301s to
 * the WordPress home page (the static bundle is not deployed there yet).
 * Set NEXT_PUBLIC_FREE_URL when it is.
 */
export const FREE_BASE_URL: string =
  process.env.NEXT_PUBLIC_FREE_URL?.replace(/\/$/, '') || 'https://incognitobrowser-pseo.vercel.app';

/**
 * Should this deployment render, list, or link a given engine's tool pages?
 * Symmetric: a free build sees free engines only, a Pro build Pro engines only.
 */
export function engineVisibleInThisTier(engine: string | undefined | null): boolean {
  return tierOfEngine(engine) === TIER;
}

/** Path to the same tool on the Pro deployment (server-mode: no /resources prefix). */
export function proUrlFor(niche: string, slug: string): string {
  return `${PRO_BASE_URL}/tools/${niche}/${slug}`;
}
