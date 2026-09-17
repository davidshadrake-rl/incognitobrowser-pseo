/**
 * DEMO SWITCH (owner, 2026-09-17): every upgrade link points at the other
 * product's staging paywall instead of the Play listing, as a demo of the
 * CTA. Flip DEMO_UPGRADE_URL back to '' to restore the real Play links —
 * that one line is the whole rollback. While it's set:
 *   - no install referrer is sent (a non-Play page won't read it), so
 *     scripts/funnels/stats.ts loses install attribution for every click;
 *   - components/InAppBridge.tsx's isUpgradeLink() no longer matches these
 *     links (it checks for play.google.com/store/apps/details), so a tap
 *     inside the app opens this page in the WebView instead of the app's
 *     native upgrade screen;
 *   - the footnote under the button ("Pro is part of the free Incognito
 *     Browser app. Android only.") and the in-app label ("Upgrade to Pro")
 *     no longer describe where the tap goes.
 * Do not ship this beyond the agreed demo without revisiting those three.
 */
export const DEMO_UPGRADE_URL = 'https://staging.ufile.io/pricing';

/**
 * The one place that builds Play Store links.
 *
 * Every Play link carries an install referrer so the app can attribute the
 * install to the page and tool that earned it (Play Install Referrer API,
 * first-party to Google Play — no third parties). Keep the parameter shape
 * stable: the app team reads it.
 *
 *   utm_source   resources | pro            which deployment
 *   utm_medium   site | tool | report-card | scorecard | cta | funnel
 *   utm_campaign <engine> | header | footer  what earned the click
 *   utm_content  <benefit> | <niche> | grade-D | …  the specific door
 *
 * On a result card's upgrade button (components/UpgradeButtons.tsx),
 * utm_content is the Pro benefit the card sold: tracker-blocking |
 * hides-ad-boxes | photo-cleaning (lib/card-copy.ts). Otherwise it is the
 * niche or the grade.
 */
import { IS_PRO_DEPLOYMENT } from './tiers';

export const PLAY_PACKAGE = 'com.androidbull.incognito.browser';

export interface PlayLinkOpts {
  source?: 'resources' | 'pro';
  medium: 'site' | 'tool' | 'report-card' | 'scorecard' | 'cta' | 'handoff' | 'funnel';
  campaign: string;
  content?: string;
  /** Which page TYPE earned the click (tool | report-card | guide | checklist …): the only way to learn which content converts. */
  term?: string;
}

/** The real Play link, with its install referrer. Exported so tests can check this logic stays correct while DEMO_UPGRADE_URL short-circuits playUrl() below. */
export function playInstallUrl({ source = IS_PRO_DEPLOYMENT ? 'pro' : 'resources', medium, campaign, content, term }: PlayLinkOpts): string {
  const referrer = [`utm_source=${source}`, `utm_medium=${medium}`, `utm_campaign=${campaign}`, content ? `utm_content=${content}` : '', term ? `utm_term=${term}` : '']
    .filter(Boolean)
    .join('&');
  return `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}&hl=en_US&referrer=${encodeURIComponent(referrer)}`;
}

export function playUrl(opts: PlayLinkOpts): string {
  return DEMO_UPGRADE_URL || playInstallUrl(opts);
}

/** Parse the referrer back out of a Play URL (tests, analytics sanity checks). */
export function parsePlayReferrer(url: string): Record<string, string> {
  const m = new URL(url).searchParams.get('referrer') || '';
  return Object.fromEntries(m.split('&').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
}
