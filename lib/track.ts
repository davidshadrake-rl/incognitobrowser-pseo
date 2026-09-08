/**
 * First-party, cookieless event counter (client side).
 *
 * We count clicks, not people: no cookie, no user id, no IP persisted (the
 * server increments day-bucketed counters and drops the request). Events are
 * an allowlist so the endpoint cannot be used as a free-text sink.
 * Sent with sendBeacon (survives navigation to the Play Store) and falls
 * back to fetch keepalive. Silent on every failure — analytics must never
 * affect the page.
 */
import { SCAN_API_BASE } from './scan-client';

export const TRACK_EVENTS = ['tool_run', 'result_shown', 'cta_view', 'cta_click', 'share_click', 'handoff_send', 'next_step_click', 'report_card_view', 'proof_route_click'] as const;
export type TrackEvent = (typeof TRACK_EVENTS)[number];

export interface TrackProps {
  tool?: string;
  niche?: string;
  severity?: 'red' | 'amber' | 'green' | 'info';
  target?: 'play' | 'pro-web' | 'email' | 'copy' | 'share' | 'download' | 'checklist';
}

export type Platform = 'android' | 'ios' | 'desktop' | 'other';

export function detectPlatform(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): Platform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

/**
 * Is this page open inside the free Incognito Browser app? Assumption to
 * confirm with the app team: the app's WebView user agent carries the
 * product name. Until confirmed this only ever changes copy, never access.
 */
export function isInsideIncognitoApp(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /incognito ?browser/i.test(ua);
}

const sent = new Set<string>();

export function track(event: TrackEvent, props: TrackProps = {}, opts: { once?: boolean } = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const key = `${event}:${props.tool || ''}:${props.target || ''}`;
    if (opts.once) {
      if (sent.has(key)) return;
      sent.add(key);
    }
    const body = JSON.stringify({ event, ...props, platform: detectPlatform(), inApp: isInsideIncognitoApp() });
    const url = `${SCAN_API_BASE}/event`;
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
    fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' }).catch(() => {});
  } catch {
    /* never affect the page */
  }
}
