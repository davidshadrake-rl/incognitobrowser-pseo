/**
 * The one place that builds Play Store links.
 *
 * Every Play link carries an install referrer so the app can attribute the
 * install to the page and tool that earned it (Play Install Referrer API,
 * first-party to Google Play — no third parties). Keep the parameter shape
 * stable: the app team reads it.
 *
 *   utm_source   resources | pro            which deployment
 *   utm_medium   site | tool | report-card | scorecard | cta
 *   utm_campaign <engine> | header | footer  what earned the click
 *   utm_content  <niche> | grade-D | …       the specific door
 */
import { IS_PRO_DEPLOYMENT } from './tiers';

export const PLAY_PACKAGE = 'com.androidbull.incognito.browser';

export interface PlayLinkOpts {
  source?: 'resources' | 'pro';
  medium: 'site' | 'tool' | 'report-card' | 'scorecard' | 'cta' | 'handoff';
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

/** Parse the referrer back out of a Play URL (tests, analytics sanity checks). */
export function parsePlayReferrer(url: string): Record<string, string> {
  const m = new URL(url).searchParams.get('referrer') || '';
  return Object.fromEntries(m.split('&').filter(Boolean).map((kv) => kv.split('=') as [string, string]));
}
