/**
 * First-party event counters — validation and key layout (pure).
 *
 * "We count clicks, not people": no IP, no cookie, no user id is ever
 * stored. Each accepted event increments a handful of day-bucketed Redis
 * counters. Every field is an allowlist or a short slug, so the endpoint
 * cannot be used as a free-text sink.
 */
import { TRACK_EVENTS, type TrackEvent } from './track';
import { allFunnelPaths } from './funnels';

export interface EventPayload {
  event: TrackEvent;
  tool?: string;
  niche?: string;
  severity?: 'red' | 'amber' | 'green' | 'info';
  target?: 'play' | 'pro-web' | 'email' | 'copy' | 'share' | 'download' | 'checklist' | 'check-yours';
  platform?: 'android' | 'ios' | 'desktop' | 'other';
  inApp?: boolean;
  page?: string;
  benefit?: 'tracker-blocking' | 'hides-ad-boxes' | 'photo-cleaning';
  reason?: 'scrolled' | 'in-view' | 'hidden' | 'on-load' | 'own-scroll';
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SEVERITIES = new Set(['red', 'amber', 'green', 'info']);
const TARGETS = new Set(['play', 'pro-web', 'email', 'copy', 'share', 'download', 'checklist', 'check-yours']);
// Every tool id that can appear in a counter key. Without this, any slug that
// matched SLUG minted new Redis keys with a 400-day TTL — unbounded key
// cardinality, and /stats SCANs the whole day's keyspace (audit 2026-09-08).
// Keep in step with components/tools/registry.tsx (guarded by tests/event-schema.test.ts).
export const TOOL_IDS = new Set([
  'ad-blocker-test', 'browser-privacy', 'cookie-analyzer', 'dns-leak-test', 'email-pixel-detector',
  'hash-generator', 'link-unwrapper', 'metadata-viewer', 'password-generator', 'password-strength',
  'permission-checker', 'privacy-quiz', 'screenshot-leak-checker', 'text-encryption', 'url-analyzer',
  'useragent-analyzer', 'whats-my-ip',
  'report-card',
]);
const PLATFORMS = new Set(['android', 'ios', 'desktop', 'other']);
const BENEFITS = new Set(['tracker-blocking', 'hides-ad-boxes', 'photo-cleaning']);
const REASONS = new Set(['scrolled', 'in-view', 'hidden', 'on-load', 'own-scroll']);
// A page may only name a funnel page: a fixed list (about 1,400), so a counter
// key can never be minted from free text.
let funnelPaths: Set<string> | null = null;
const isFunnelPath = (p: string) => (funnelPaths ??= new Set(allFunnelPaths())).has(p);

export type Validation = { ok: true; value: EventPayload } | { ok: false; error: string };

export function validateEvent(input: unknown): Validation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'body must be an object' };
  const o = input as Record<string, unknown>;
  if (typeof o.event !== 'string' || !(TRACK_EVENTS as readonly string[]).includes(o.event)) return { ok: false, error: 'unknown event' };
  const v: EventPayload = { event: o.event as TrackEvent };
  for (const k of ['tool', 'niche'] as const) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== 'string' || !SLUG.test(o[k] as string)) return { ok: false, error: `${k} must be a slug` };
    v[k] = o[k] as string;
  }
  if (o.severity !== undefined) { if (!SEVERITIES.has(o.severity as string)) return { ok: false, error: 'bad severity' }; v.severity = o.severity as EventPayload['severity']; }
  if (v.tool !== undefined && !TOOL_IDS.has(v.tool)) return { ok: false, error: 'unknown tool' };
  if (o.target !== undefined) { if (!TARGETS.has(o.target as string)) return { ok: false, error: 'bad target' }; v.target = o.target as EventPayload['target']; }
  if (o.platform !== undefined) { if (!PLATFORMS.has(o.platform as string)) return { ok: false, error: 'bad platform' }; v.platform = o.platform as EventPayload['platform']; }
  if (o.inApp !== undefined) { if (typeof o.inApp !== 'boolean') return { ok: false, error: 'bad inApp' }; v.inApp = o.inApp; }
  if (o.page !== undefined) { if (typeof o.page !== 'string' || !isFunnelPath(o.page)) return { ok: false, error: 'unknown page' }; v.page = o.page; }
  if (o.benefit !== undefined) { if (!BENEFITS.has(o.benefit as string)) return { ok: false, error: 'bad benefit' }; v.benefit = o.benefit as EventPayload['benefit']; }
  if (o.reason !== undefined) { if (!REASONS.has(o.reason as string)) return { ok: false, error: 'bad reason' }; v.reason = o.reason as EventPayload['reason']; }
  return { ok: true, value: v };
}

/** UTC day bucket, YYYY-MM-DD. */
export function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The counters one event increments. Bounded (≤7) so a burst cannot fan out. */
export function eventKeys(day: string, v: EventPayload): string[] {
  const p = v.platform || '-';
  const keys = [`evt:${day}:_all`, `evt:${day}:${v.event}`, `evt:${day}:${v.event}:${v.tool || '-'}:${p}`];
  // The benefit rides on the click's own key, so the count stays bounded (≤7 keys).
  if (v.target) keys.push(`evt:${day}:${v.event}:${v.tool || '-'}:${p}:${v.target}${v.benefit ? `:b-${v.benefit}` : ''}`);
  if (v.reason) keys.push(`evt:${day}:${v.event}:${v.tool || '-'}:${p}:r-${v.reason}`);
  if (v.severity) keys.push(`evt:${day}:${v.event}:${v.tool || '-'}:${p}:sev-${v.severity}`);
  if (v.inApp) keys.push(`evt:${day}:_inapp:${v.event}`);
  // Per funnel page: views, runs, results by colour and clicks (scripts/funnels/stats.ts).
  if (v.page) keys.push(`evt:${day}:page:${v.event}:${v.page}${v.severity ? `:sev-${v.severity}` : ''}${v.target ? `:${v.target}` : ''}`);
  return keys.slice(0, 7);
}

export const EVENT_TTL_SECONDS = 400 * 24 * 3600;
