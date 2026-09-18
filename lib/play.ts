/**
 * The one place that builds Play Store links. playUrl() always returns a
 * real Play link — the header, footer and home-hero "install the app"
 * buttons (app/layout.tsx, app/page.tsx) go through this and must always
 * reach Play. The upgrade-CTA demo switch lives in components/UpgradeButtons.tsx
 * instead, scoped to the "Get Pro on Android" buttons alone (owner,
 * 2026-09-17: an earlier version of this switch lived here and silently
 * redirected the free-app install links too — caught before it shipped).
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
  medium: 'site' | 'tool' | 'report-card' | 'scorecard' | 'cta' | 'handoff' | 'funnel' | 'gate';
  campaign: string;
  content?: string;
  /** Which page TYPE earned the click (tool | report-card | guide | checklist …): the only way to learn which content converts. */
  term?: string;
}

export function playUrl({ source = IS_PRO_DEPLOYMENT ? 'pro' : 'resources', medium, campaign, content, term }: PlayLinkOpts): string {
  const referrer = [`utm_source=${source}`, `utm_medium=${medium}`, `utm_campaign=${campaign}`, content ? `utm_content=${content}` : '', term ? `utm_term=${term}` : '']
    .filter(Boolean)
    .join('&');
  return `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}&hl=en_US&referrer=${encodeURIComponent(referrer)}`;
}
/** @deprecated alias kept only for the parts of the test suite written against the old name; use playUrl(). */
export const playInstallUrl = playUrl;

/** Parse the referrer back out of a Play URL (tests, analytics sanity checks). */
export function parsePlayReferrer(url: string): Record<string, string> {
  const m = new URL(url).searchParams.get('referrer') || '';
  return Object.fromEntries(m.split('&').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
}
