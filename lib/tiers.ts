/**
 * Free / Pro tool tiers — one source of truth.
 *
 * Decided 2026-09-07: three engines are Pro and live on a separate
 * deployment (same repo, second static build, NEXT_PUBLIC_TIER=pro).
 * There is no gate yet — "for now we are simply dividing the tools up".
 *
 * Moved 2026-09-17: url-analyzer left PRO_ENGINES for the free deployment.
 * Pro has no link-safety benefit (its card always fell through to
 * "Separately," — correct wording, not a bug), so keeping the tool on the
 * noindex Pro site cost the free site its best buyer-intent queries
 * ("is this link safe") for nothing url-analyzer's own card could sell.
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
 * "Pro" alone always means the paid app tier. The second deployment showing
 * itself as "Incognito Pro" is accurate, not a naming slip (owner,
 * 2026-09-17): these tool pages ARE the tools sold as part of the larger Pro
 * package in the free app, so the site naming them that is the honest label,
 * not an overclaim. What Pro adds is exactly data/brand.json's `pro`
 * outcomes (owner, 2026-09-16).
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
  'metadata-viewer', // the one-photo reader; Pro's batch cleaning handles whole folders
]);

export function tierOfEngine(engine: string | undefined | null): Tier {
  return engine && PRO_ENGINES.has(engine) ? 'pro' : 'free';
}

/** Which deployment this build is. Baked in at build time (NEXT_PUBLIC_). */
export const TIER: Tier = process.env.NEXT_PUBLIC_TIER === 'pro' ? 'pro' : 'free';
export const IS_PRO_DEPLOYMENT = TIER === 'pro';

/**
 * Where the two deployments live. The free site links Pro-engine pages at the
 * Pro base; the Pro deployment links back to the free base. The droplet is the
 * only deploy target (owner, 2026-09-18: the previous hosting platform is
 * being removed entirely), and the defaults below are the live droplet so a
 * build with no env var at all still links somewhere that resolves.
 *
 * ONE HOST, ENFORCED HERE AND NOT ONLY IN THE DEPLOY SCRIPT. These two used to
 * read NEXT_PUBLIC_PRO_URL and NEXT_PUBLIC_FREE_URL as two independent
 * variables, and the only thing keeping them on one host was scripts/deploy.sh
 * setting both from $SITE_ORIGIN. Any other build path — `npm run
 * build:static`, a company CI job, a laptop — could move one and leave the
 * other behind, and nothing would fail. That is not cosmetic drift:
 * components/InAppBridge.tsx derives SISTER_ORIGINS from exactly these two
 * constants and, inside the app, appends ?inapp=1&pro=1 to every link into
 * either origin. With the pair split, the app-session flags are decorated onto
 * links into a host the installed APK has no bridge on, or that is no longer
 * ours (audit 2026-09-21, gap B6).
 *
 * So the pair is DERIVED from one value, NEXT_PUBLIC_SITE_ORIGIN:
 * `${origin}/resources` and `${origin}/resources-pro`, the two folders
 * scripts/deploy.sh uploads to. NEXT_PUBLIC_PRO_URL / NEXT_PUBLIC_FREE_URL
 * remain as an explicit override for a layout that is not those two folders,
 * but only as a PAIR: exactly one of them set is the half-moved state this
 * exists to refuse, and it throws here, at module load, so the build fails
 * instead of shipping it. A value that is not an absolute http(s) URL throws
 * for the same reason — SISTER_ORIGINS silently drops anything new URL()
 * cannot parse, so a scheme-less value would not error, it would switch the
 * in-app link rewriter off.
 *
 * Every read below is a direct `process.env.NEXT_PUBLIC_*` property access on
 * purpose: Next inlines those at build time and ONLY those (node_modules/next/
 * dist/docs/01-app/02-guides/environment-variables.md — a dynamic lookup such
 * as process.env[name] is not inlined), and these constants are imported by
 * client components, so the browser sees whatever was inlined.
 */
function urlEnv(name: string, raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/\/$/, '');
  if (v && !/^https?:\/\/[^/\s]+/i.test(v)) {
    throw new Error(`lib/tiers: ${name} must be an absolute http(s) URL, got "${v}"`);
  }
  return v;
}
const SITE_ORIGIN = urlEnv('NEXT_PUBLIC_SITE_ORIGIN', process.env.NEXT_PUBLIC_SITE_ORIGIN);
const PRO_URL_OVERRIDE = urlEnv('NEXT_PUBLIC_PRO_URL', process.env.NEXT_PUBLIC_PRO_URL);
const FREE_URL_OVERRIDE = urlEnv('NEXT_PUBLIC_FREE_URL', process.env.NEXT_PUBLIC_FREE_URL);

if (!!PRO_URL_OVERRIDE !== !!FREE_URL_OVERRIDE) {
  const set = PRO_URL_OVERRIDE ? 'NEXT_PUBLIC_PRO_URL' : 'NEXT_PUBLIC_FREE_URL';
  const missing = PRO_URL_OVERRIDE ? 'NEXT_PUBLIC_FREE_URL' : 'NEXT_PUBLIC_PRO_URL';
  throw new Error(
    `lib/tiers: NEXT_PUBLIC_PRO_URL and NEXT_PUBLIC_FREE_URL must be set together or not at all — ` +
      `${set} is set and ${missing} is not. The free and Pro sites have to live on one host ` +
      `(the in-app bridge trusts both as siblings), so a half-moved pair is refused at build time. ` +
      `Set NEXT_PUBLIC_SITE_ORIGIN to derive both from one origin, or set both explicitly.`,
  );
}

export const PRO_BASE_URL: string =
  PRO_URL_OVERRIDE || (SITE_ORIGIN && `${SITE_ORIGIN}/resources-pro`) || 'https://206-189-186-34.nip.io/resources-pro';

export const FREE_BASE_URL: string =
  FREE_URL_OVERRIDE || (SITE_ORIGIN && `${SITE_ORIGIN}/resources`) || 'https://206-189-186-34.nip.io/resources';

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
