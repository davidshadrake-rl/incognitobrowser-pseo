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
    red: { meaning: 'Most of the ad and tracking requests got through, so sites like this can follow you to the next one.', free: 'Incognito Browser blocks ads for free on Android.', pro: 'Blocks the tracking scripts that follow you from site to site.', button: 'Block trackers with Pro' },
    amber: { meaning: 'Some got through: the ads were stopped, but the tracking calls behind them were not.', pro: 'Blocks those tracking calls too, on every site you open in the app.', button: 'Block the tracking with Pro' },
    green: { meaning: 'This browser stopped nearly all of them, but the photos you post can still say where you took them.', pro: 'Strips location and other hidden details from a whole folder of photos at once.', button: 'Clean your photos with Pro' },
  },
};

const errorsFor = (f: FunnelV2, over: Record<string, unknown> = {}) => validate([record(f, over)] as never).errors;
const withRed = (red: Partial<NonNullable<FunnelV2['results']['red']>>) => ({ ...GOOD, results: { ...GOOD.results, red: { ...GOOD.results.red!, ...red } } });

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
      expect(errorsFor(withRed({ pro })), pro).toContainEqual(expect.stringContaining('talking the reader out of it'));
    }
  });

  it('the Pro line starts with its verb: the card already labels the row "Incognito Pro"', () => {
    expect(errorsFor(withRed({ pro: 'Incognito Pro blocks the tracking scripts that follow you.' }))).toContainEqual(expect.stringContaining("starts with Pro's name"));
    expect(errorsFor(withRed({ pro: 'On Android, it blocks the tracking scripts that follow you.' }))).toContainEqual(expect.stringContaining("doesn't start with what Pro does"));
    // One word of framing is fine: a password page says the blocking is a separate matter.
    expect(errorsFor(withRed({ pro: 'Separately, blocks the tracking scripts on the sites you open.' }))).toEqual([]);
  });

  it('the Pro line sells exactly one data/brand.json Pro outcome, and never a free feature', () => {
    expect(errorsFor(withRed({ pro: 'Makes you private everywhere you go.' }))).toContainEqual(expect.stringContaining('sells no Pro outcome'));
    expect(errorsFor(withRed({ pro: "Checks a link before you tap it, so you can spot a fake login page." }))).toContainEqual(expect.stringContaining('sells no Pro outcome'));
    expect(errorsFor(withRed({ pro: 'Blocks tracking scripts and hides the empty ad boxes.' }))).toContainEqual(expect.stringContaining('sells tracker-blocking and hides-ad-boxes'));
    expect(errorsFor(withRed({ pro: 'Blocks ads and the tracking scripts behind them.' }))).toContainEqual(expect.stringContaining('sells a free app feature as Pro'));
    expect(errorsFor(withRed({ pro: 'Blocks tracking scripts, on top of the free ad blocker.' }))).toEqual([]);
    expect(errorsFor(withRed({ button: 'Clean your photos with Pro' }))).toContainEqual(expect.stringContaining('button asks for photo-cleaning'));
    const monitoring = withRed({ pro: 'Blocks tracking scripts and does link monitoring.' });
    expect(errorsFor(monitoring)).toContainEqual(expect.stringContaining('never-claim (link monitoring)'));
  });

  it('may say plainly that Pro includes no VPN, but never that it includes one', () => {
    expect(errorsFor(withRed({ pro: "Blocks trackers that follow you between sites, but doesn't change your IP address or include a VPN." }))).toEqual([]);
    expect(errorsFor(withRed({ pro: 'Blocks trackers that follow you, and includes a VPN.' }))).toContainEqual(expect.stringContaining("isn't confirmed to do"));
  });

  it('the free fix never names Pro', () => {
    expect(errorsFor(withRed({ free: 'Incognito Pro wipes cookies when you close it.' }))).toContainEqual(expect.stringContaining('free names Pro'));
  });

  it('the meaning is one sentence that points nowhere: the card is not always over the report', () => {
    expect(errorsFor(withRed({ meaning: 'Most requests got through. Sites can follow you.' }))).toContainEqual(expect.stringContaining('more than one sentence'));
    expect(errorsFor(withRed({ meaning: 'Most requests got through, as counted above.' }))).toContainEqual(expect.stringContaining('points above or below'));
    // A domain's dot is not a stop.
    expect(errorsFor(withRed({ meaning: "Nothing on apple.com's homepage loads a tracker." }))).toEqual([]);
  });

  it('stays short: 40 words of stakes, and the result card limits for each answer', () => {
    const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
    expect(errorsFor({ ...GOOD, stakes: long })).toContainEqual(expect.stringContaining('stakes is 45 words'));
    const over = errorsFor(withRed({
      meaning: `${'Most of the ad and tracking requests got through '.repeat(3)}here.`,
      free: 'Incognito Browser blocks ads for free on Android, every day, on every site.',
      pro: 'Blocks the tracking scripts that follow you from site to site, on every site you open in the app, every day of the week.',
      button: 'Block every tracker there is with Pro',
    })).join('\n');
    for (const k of ['meaning is', 'free is', 'pro is', 'button is']) expect(over).toMatch(new RegExp(`results\\.red\\.${k} \\d+ characters`));
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
