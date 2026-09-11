/**
 * lib/scanner inline snippets → tracker names.
 *
 * The report card page (app/site/[domain] extraInlinePixels) counts an inline
 * snippet as an extra tracking pixel unless the tracker it comes with was
 * already found. That only avoids counting one tag twice while every inline
 * label analyzeScan can push has a TRACKER_FOR_INLINE entry naming a real
 * TRACKER_PATTERNS tracker: a renamed tracker or a new snippet without an
 * entry would quietly bring back "1 tracker and 1 tracking pixel" for a
 * single Google tag.
 */
import { describe, expect, it } from 'vitest';
import { analyzeScan, INLINE_TRACKERS, TRACKER_FOR_INLINE, TRACKER_PATTERNS } from '../lib/scanner';

const TARGET = 'https://example.test/';
const LIMITS = { maxCookies: 100, maxScriptMatches: 500, maxThirdPartyDomains: 100 };
const scan = (html: string) => analyzeScan(TARGET, new URL(TARGET), new Response(''), html, LIMITS);
const TRACKER_NAMES = new Set(TRACKER_PATTERNS.map((t) => t.name));

/** Each tag's standard embed, as sites paste it: the loader script and the inline call. */
const EMBEDS: Record<string, string> = {
  'Facebook Pixel (inline)':
    `<script>!function(f,b,e,v,n,t,s){t=b.createElement(e);t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '123456789');fbq('track', 'PageView');</script>`,
  'Google gtag (inline)':
    `<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-TEST1');</script>`,
  'Google Analytics (inline)':
    `<script>(function(i,s,o,g,r,a,m){a=s.createElement(o);a.src=g;m=s.getElementsByTagName(o)[0];m.parentNode.insertBefore(a,m)})(window,document,'script','https://www.google-analytics.com/analytics.js','ga');ga('create', 'UA-1234-1', 'auto');ga('send', 'pageview');</script>`,
  'LinkedIn Insight (inline)':
    `<script>_linkedin_partner_id = "123456";window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];window._linkedin_data_partner_ids.push(_linkedin_partner_id);</script><script async src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script>`,
  'Twitter Pixel (inline)':
    `<script>!function(e,t,n){var s=t.createElement(n);s.async=!0;s.src='https://static.ads-twitter.com/uwt.js';t.head.appendChild(s)}(window,document,'script');twq('init','o1abc');twq('track','PageView');</script>`,
  'Pinterest Tag (inline)':
    `<script>!function(e){var n=document.createElement("script");n.async=!0;n.src=e;document.head.appendChild(n)}("https://s.pinimg.com/ct/core.js");pintrk('load', '2612345678901');pintrk('page');</script>`,
};

describe('TRACKER_FOR_INLINE — every inline label names a real tracker', () => {
  it('every inline label analyzeScan can push has an entry, and its value is a TRACKER_PATTERNS name', () => {
    const pushed = scan(Object.values(EMBEDS).join('\n')).inlineTrackers;
    // The fixture sets off every inline detection, so these are all the labels analyzeScan can push.
    expect(pushed, 'add an EMBEDS fixture for a new inline snippet').toEqual(INLINE_TRACKERS.map((i) => i.label));
    for (const label of pushed) {
      expect(label in TRACKER_FOR_INLINE, `${label} has no TRACKER_FOR_INLINE entry`).toBe(true);
      expect(TRACKER_NAMES.has(TRACKER_FOR_INLINE[label]), `${label} → "${TRACKER_FOR_INLINE[label]}" is not a TRACKER_PATTERNS name`).toBe(true);
    }
  });

  it('has exactly one entry per inline detection, and no label is used twice', () => {
    const labels = INLINE_TRACKERS.map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(Object.keys(TRACKER_FOR_INLINE).sort()).toEqual([...labels].sort());
  });

  it('a standard embed reports its inline snippet and the tracker the label maps to, so a card counts the tag once', () => {
    for (const [label, html] of Object.entries(EMBEDS)) {
      const r = scan(html);
      expect(r.inlineTrackers, label).toEqual([label]);
      expect(r.trackers.map((t) => t.name), label).toContain(TRACKER_FOR_INLINE[label]);
    }
  });

  it('a page with no inline snippet reports none', () => {
    expect(scan('<html><body><script src="/app.js"></script></body></html>').inlineTrackers).toEqual([]);
  });
});
