/**
 * The v2 funnel standard (2026-09-16): the owner judged the v1 funnels "a fair
 * start but not compelling", and approved these rules. scripts/funnels/validate.ts
 * enforces what a machine can; the examples and the review do the rest.
 */
import { describe, expect, it } from 'vitest';
import { validate, type FunnelV2 } from '../scripts/funnels/validate';
import { validateEvent, eventKeys } from '../lib/event-schema';
import { allFunnelPaths } from '../lib/funnels';

const record = (funnel: FunnelV2, over: Record<string, unknown> = {}) => ({
  id: 'x', url: '/guides/example/page', type: 'guide', topic: 'ad-tracking', title: 'Example',
  units: [{ key: 'step-1', label: 'Step 1', text: 'Ad networks follow you from site to site with scripts and pixels.' }],
  check: { engine: 'ad-blocker-test' },
  funnel,
  ...over,
});

const GOOD: FunnelV2 = {
  v: 2,
  step1: { unitKey: 'step-1', label: 'Step 1 of 5', quote: 'Ad networks follow you from site to site' },
  stakes: 'Every site with an ad network on it can add what you read to a profile of you. See how much of that your browser lets through.',
  check: { engine: 'ad-blocker-test', button: 'Test this browser' },
  results: {
    red: { meaning: 'Most of the ad and tracking requests got through, so sites like this can follow you to the next one.', pro: 'Incognito Pro blocks the tracking scripts and pixels as well as the ads.', button: 'Block the trackers with Pro' },
    amber: { meaning: 'Some got through: the ads were stopped, but the tracking calls behind them were not.', pro: 'Incognito Pro blocks tracking scripts and pixels too, and hides the empty ad boxes.', button: 'Stop the rest with Pro' },
    green: { meaning: 'This browser stopped nearly all of them. The sites you visit on your phone may not be so lucky.', pro: 'Incognito Pro blocks tracking scripts and pixels on your Android phone too.', button: 'Get the same on your phone' },
  },
};

const errorsFor = (f: FunnelV2, over: Record<string, unknown> = {}) => validate([record(f, over)] as never).errors;

describe('v2 funnel rules', () => {
  it('a funnel written to the standard passes', () => {
    expect(errorsFor(GOOD)).toEqual([]);
  });

  it('answers every result the check can return', () => {
    const { amber: _gone, ...rest } = GOOD.results;
    expect(errorsFor({ ...GOOD, results: rest })).toContainEqual(expect.stringContaining('no answer for a amber result'));
    // What's My IP reports only red or info (read from its code), so its funnel answers those two.
    const ip = { ...GOOD, check: { engine: 'whats-my-ip', button: 'Show my address' } };
    expect(errorsFor(ip)).toContainEqual(expect.stringContaining('no answer for a info result'));
    expect(errorsFor(ip).join('\n')).not.toContain('amber result');
  });

  it('a report card answers only its own grade', () => {
    const card = { ...GOOD, check: { engine: 'report-card', button: 'See the grade' }, step1: { unitKey: '', label: 'Graded D', quote: 'Grade D: 3 ad trackers on the homepage.' }, results: { red: GOOD.results.red } };
    expect(errorsFor(card, { type: 'report-card', units: [], facts: { grade: 'D', headline: 'Grade D: 3 ad trackers on the homepage.' } })).toEqual([]);
  });

  it('the check button never says the check already ran', () => {
    expect(errorsFor({ ...GOOD, check: { ...GOOD.check, button: 'Address checked' } })).toContainEqual(expect.stringContaining('already ran'));
  });

  it("the Pro line never opens by talking the reader out of it", () => {
    for (const pro of ['Free fix: turn WebRTC off in settings, and Incognito Pro blocks trackers.', "Pro doesn't include a VPN, but it blocks tracking scripts.", 'No need to pay: Incognito Pro blocks tracking scripts.']) {
      expect(errorsFor({ ...GOOD, results: { ...GOOD.results, red: { ...GOOD.results.red!, pro } } }), pro).toContainEqual(expect.stringContaining('talking the reader out of it'));
    }
  });

  it('the Pro line names something Pro or the app really has, and nothing it does not', () => {
    const vague = { ...GOOD, results: { ...GOOD.results, red: { ...GOOD.results.red!, pro: 'Incognito Pro makes you private everywhere.' } } };
    expect(errorsFor(vague)).toContainEqual(expect.stringContaining('names nothing Pro or the app really has'));
    const monitoring = { ...GOOD, results: { ...GOOD.results, red: { ...GOOD.results.red!, pro: 'Incognito Pro blocks tracking scripts and does link monitoring.' } } };
    expect(errorsFor(monitoring)).toContainEqual(expect.stringContaining('never-claim (link monitoring)'));
  });

  it('stays short: 40 words of stakes, about 70 from result to button', () => {
    const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
    expect(errorsFor({ ...GOOD, stakes: long })).toContainEqual(expect.stringContaining('stakes is 45 words'));
  });

  it('flags jargon that is not explained in brackets', () => {
    const jargon = { ...GOOD, stakes: 'Any site can read your WebRTC address in the background, even with your VPN on.' };
    expect(validate([record(jargon)] as never).warnings).toContainEqual(expect.stringContaining('uses "WebRTC" without explaining it'));
    const explained = { ...GOOD, stakes: 'Any site can read your WebRTC (a way browsers make calls) address in the background.' };
    expect(validate([record(explained)] as never).warnings.join('\n')).not.toContain('WebRTC');
  });

  it('v1 records keep their own rules', () => {
    expect(validate([] as never).errors).toEqual([]);
  });
});

describe('per-page funnel events', () => {
  const page = allFunnelPaths()[0];

  it('accept a page only if it is a funnel page, so no counter key comes from free text', () => {
    expect(validateEvent({ event: 'funnel_view', tool: 'ad-blocker-test', page })).toMatchObject({ ok: true });
    expect(validateEvent({ event: 'funnel_view', tool: 'ad-blocker-test', page: '/anything/a-visitor-typed' })).toEqual({ ok: false, error: 'unknown page' });
    expect(validateEvent({ event: 'funnel_view', page: 42 })).toEqual({ ok: false, error: 'unknown page' });
  });

  it('count views, runs, results by colour and clicks by target, per page', () => {
    const keys = eventKeys('2026-09-16', { event: 'funnel_click', tool: 'ad-blocker-test', severity: 'red', target: 'play', platform: 'android', page });
    expect(keys).toContain(`evt:2026-09-16:page:funnel_click:${page}:sev-red:play`);
    expect(keys.length).toBeLessThanOrEqual(7);
  });
});

describe('a check that opens on another page', () => {
  it('needs no answers on this page: the result is answered where it happens', () => {
    const linkOut = { ...GOOD, check: { engine: 'cookie-analyzer', button: 'Scan your homepage' }, results: {} };
    expect(errorsFor(linkOut, { type: 'calculator' })).toEqual([]);
    // The same Pro engine on its own tool page answers every result.
    expect(errorsFor(linkOut, { type: 'pro-tool', units: [] }).join('\n')).toContain('no answer for a red result');
  });
});
