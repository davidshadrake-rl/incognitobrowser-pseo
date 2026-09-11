/**
 * lib/scorecard — regression guard for the stat-column overlap bug (reported
 * 2026-09-08 on a live What's My IP scorecard: a long IP + "Dublin, Ireland"
 * + "unknown" ran together because stat values were drawn at a fixed font
 * size regardless of column width). drawScorecard now shrinks (and, failing
 * that, truncates) each column's text to fit; this test proves it with a
 * fake canvas context that measures text by character count, so a
 * regression that removes the fit logic fails immediately.
 */
import { describe, expect, it } from 'vitest';
import { drawScorecard, scorecardFigure, shareLinkFor, VALUE_ONLY_ENGINES, wrapLines, type ScorecardSpec } from '../lib/scorecard';
import { reportCardLine } from '../lib/cta-copy';
import { PERMISSIONS_TO_CHECK, summarizePermissions, type PermissionResult } from '../components/tools/PermissionCheckerTool';

const CHAR_W = 12; // fake monospace width per character, matches a real font closely enough to catch overlaps

class FakeCtx {
  calls: Array<{ text: string; x: number; y: number; font: string }> = [];
  arcs: Array<{ x: number; y: number; radius: number; startAngle: number; endAngle: number; strokeStyle: string }> = [];
  fillStyle = '';
  font = '';
  textAlign: CanvasTextAlign = 'left';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  strokeStyle = '';
  lineWidth = 0;
  lineCap: CanvasLineCap = 'butt';
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  beginPath() {}
  stroke() {}
  // Records the arc so gauge tests can assert on its sweep without caring
  // about fill/stroke pixel output (jsdom has no real canvas backend).
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
    this.arcs.push({ x, y, radius, startAngle, endAngle, strokeStyle: this.strokeStyle });
  }
  measureText(s: string) {
    const sizeMatch = /(\d+)px/.exec(this.font);
    const size = sizeMatch ? Number(sizeMatch[1]) : 16;
    return { width: s.length * size * (CHAR_W / 34) } as TextMetrics;
  }
  fillText(text: string, x: number, y: number) {
    this.calls.push({ text, x, y, font: this.font });
  }
}

function spanOf(ctx: FakeCtx, call: { text: string; x: number; font: string }): [number, number] {
  ctx.font = call.font;
  const w = ctx.measureText(call.text).width;
  return call.text === '' ? [call.x, call.x] : ctx.textAlign === 'right' ? [call.x - w, call.x] : [call.x, call.x + w];
}

const BASE: ScorecardSpec = { title: 'Test', figure: 'Grade D', headline: 'Headline', url: 'example.com/x', tone: 'red' };

describe('drawScorecard — stat columns never overlap', () => {
  it('shrinks a long value/label so all 4 columns stay within their own width, even with realistic long data', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, {
      ...BASE,
      stats: [
        { label: 'IP', value: '185.192.16.117' },
        { label: 'Location', value: 'Dublin, Ireland' },
        { label: 'Network', value: 'unknown' },
        { label: 'WebRTC IPs', value: '0' },
      ],
    });
    const statCalls = ctx.calls.filter((c) => /185\.192|Dublin|unknown|^0$|^IP$|LOCATION|NETWORK|WEBRTC/.test(c.text));
    expect(statCalls.length).toBe(8); // 4 values + 4 labels
    // Only compare calls on the SAME row (values sit above their own label at
    // a fixed y offset, which is fine) — the real risk is two columns'
    // text colliding at the same y, which is what caused the reported bug.
    const rows = new Map<number, typeof statCalls>();
    for (const c of statCalls) rows.set(c.y, [...(rows.get(c.y) || []), c]);
    for (const row of rows.values()) {
      const spans = row.map((c) => spanOf(ctx, c));
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const [aStart, aEnd] = spans[i];
          const [bStart, bEnd] = spans[j];
          const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
          expect(overlap, `"${row[i].text}" (${aStart}-${aEnd}) vs "${row[j].text}" (${bStart}-${bEnd})`).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('never grows a value past its column even with an extreme outlier string', () => {
    const ctx = new FakeCtx();
    const colW = (1200 - 128) / 4 - 16;
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, {
      ...BASE,
      stats: [
        { label: 'Third parties', value: 'COMCAST-7922-a Comcast Cable Communications LLC' },
        { label: 'B', value: '1' },
        { label: 'C', value: '2' },
        { label: 'D', value: '3' },
      ],
    });
    const long = ctx.calls.find((c) => c.text.startsWith('COMCAST') || c.text.includes('…'));
    expect(long).toBeTruthy();
    const [start, end] = spanOf(ctx, long!);
    expect(end - start).toBeLessThanOrEqual(colW + 1);
  });

  it('falls back to a smaller font before truncating, and only truncates as a last resort', () => {
    const ctx = new FakeCtx();
    // 4 narrow columns force a shrink for a value that would fit comfortably alone.
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, {
      ...BASE,
      stats: [{ label: 'X', value: 'moderately long value here' }, { label: 'B', value: '1' }, { label: 'C', value: '2' }, { label: 'D', value: '3' }],
    });
    const call = ctx.calls.find((c) => c.text.startsWith('moderately'));
    expect(call).toBeTruthy();
    expect(/700 (\d+)px/.exec(call!.font)![1]).not.toBe('34'); // shrunk below the default size
    expect(call!.text).toBe('moderately long value here'); // shrinking alone was enough — no truncation needed
  });

  it('renders 1-3 stat columns without dividing by a phantom 4th column', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, { ...BASE, stats: [{ label: 'Only', value: 'one' }] });
    expect(ctx.calls.some((c) => c.text === 'one')).toBe(true);
  });
});

describe('wrapLines', () => {
  it('wraps to at most maxLines and never drops the first word', () => {
    const ctx = new FakeCtx();
    ctx.font = '500 30px x';
    const lines = wrapLines(ctx, 'This is a fairly long headline that should wrap across two lines of text', 300, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines[0].startsWith('This')).toBe(true);
  });
});

describe('drawScorecard — footer URL never runs into "Check yours free"', () => {
  it('shrinks/truncates a long path (the exact URL reported live) so the two footer texts do not overlap', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, {
      ...BASE,
      url: 'https://incognitobrowser-pseo.vercel.app/tools/children-safety/permission-checker',
    });
    const label = ctx.calls.find((c) => c.text === 'Check yours free');
    const url = ctx.calls.find((c) => c.text.startsWith('incognitobrowser-pseo'));
    expect(label).toBeTruthy();
    expect(url).toBeTruthy();
    // URL is drawn left-aligned from x=64; the label is drawn right-aligned ending at x=W-64.
    ctx.font = url!.font;
    const urlEnd = url!.x + ctx.measureText(url!.text).width;
    ctx.font = label!.font;
    const labelStart = label!.x - ctx.measureText(label!.text).width;
    expect(urlEnd, `url ends at ${urlEnd}, label starts at ${labelStart}`).toBeLessThan(labelStart);
  });

  it('leaves a short URL at full size and untruncated', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, { ...BASE, url: 'https://example.com/x' });
    const url = ctx.calls.find((c) => c.text === 'example.com/x');
    expect(url).toBeTruthy();
    expect(url!.font).toMatch(/400 22px/);
  });
});

describe('drawScorecard — gauge arc (DESIGN-SPEC 4.2)', () => {
  it('omits the arc entirely when no score is given (pre-existing layout is untouched)', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, BASE);
    expect(ctx.arcs).toEqual([]);
  });

  it('draws a track arc and a value arc swept to the score, and a centred score readout', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, { ...BASE, score: 63 });
    expect(ctx.arcs.length).toBe(2);
    const [track, value] = ctx.arcs;
    // Same centre and radius for both arcs of one gauge.
    expect(value.x).toBe(track.x);
    expect(value.y).toBe(track.y);
    expect(value.radius).toBe(track.radius);
    // Track always sweeps the full semicircle; the value arc stops at score%.
    expect(track.endAngle - track.startAngle).toBeCloseTo(Math.PI, 5);
    expect(value.endAngle - value.startAngle).toBeCloseTo(Math.PI * 0.63, 5);
    const score = ctx.calls.find((c) => c.text === '63');
    expect(score).toBeTruthy();
    expect(ctx.calls.some((c) => c.text === 'SCORE')).toBe(true);
  });

  it('clamps an out-of-range score instead of drawing past a full sweep', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, { ...BASE, score: 140 });
    const [, value] = ctx.arcs;
    expect(value.endAngle - value.startAngle).toBeCloseTo(Math.PI, 5);
    expect(ctx.calls.some((c) => c.text === '100')).toBe(true);
  });

  it('reserves room so a long title never runs under the gauge', () => {
    const ctx = new FakeCtx();
    drawScorecard(ctx as unknown as CanvasRenderingContext2D, {
      ...BASE,
      title: 'a-genuinely-long-domain-name-that-would-otherwise-run-edge-to-edge.example.com',
      score: 92,
    });
    const title = ctx.calls.find((c) => c.font.startsWith('700') && /example\.com|…/.test(c.text));
    expect(title).toBeTruthy();
    ctx.font = title!.font;
    const titleEnd = title!.x + ctx.measureText(title!.text).width;
    const [track] = ctx.arcs;
    const gaugeLeftEdge = track.x - track.radius;
    expect(titleEnd, `title ends at ${titleEnd}, gauge starts at ${gaugeLeftEdge}`).toBeLessThan(gaugeLeftEdge);
  });
});

/**
 * The share card's figure (CTO review 2026-09-10): the tool's own number
 * with its label, never a bare count; no card at all for tools that only
 * produce a value.
 */
describe('scorecardFigure — the number carries its label', () => {
  it('labels each engine\'s number the way the tool itself says it', () => {
    expect(scorecardFigure('ad-blocker-test', { score: 72, stats: [{ label: 'Blocked', value: '36/50' }] })).toBe('72% blocked');
    expect(scorecardFigure('password-strength', { score: 41.6 })).toBe('Strength 42/100');
    expect(scorecardFigure('whats-my-ip', { stats: [{ label: 'Verdict', value: 'Visible to sites' }] })).toBe('IP visible to sites');
    expect(scorecardFigure('whats-my-ip', { stats: [{ label: 'Verdict', value: 'Leaking' }] })).toBe('IP leaking');
    expect(scorecardFigure('dns-leak-test', { stats: [{ label: 'Verdict', value: 'Leaking' }] })).toBe('DNS leaking');
    expect(scorecardFigure('link-unwrapper', { stats: [{ label: 'Trackers', value: '1' }] })).toBe('1 tracker');
    expect(scorecardFigure('link-unwrapper', { stats: [{ label: 'Trackers', value: '0' }] })).toBe('No trackers');
    expect(scorecardFigure('email-pixel-detector', { stats: [{ label: 'Pixels', value: '0' }, { label: 'Tracked links', value: '3 of 9' }] })).toBe('3 tracked links');
    expect(scorecardFigure('screenshot-leak-checker', { stats: [{ label: 'Leaks', value: '2' }] })).toBe('2 leaks');
  });
  it('shows the quiz score, never its letter (the "+" of an "A+" was lost that way)', () => {
    expect(scorecardFigure('privacy-quiz', { score: 93, grade: 'A' })).toBe('Score 93/100');
    expect(scorecardFigure('privacy-quiz', { score: 93, grade: 'A+' })).toBe('Score 93/100');
  });
  it('writes a score in the unit the result names: "72%" for a percentage, "/100" otherwise', () => {
    expect(scorecardFigure('some-new-engine', { score: 72, scoreUnit: '%' })).toBe('Score 72%');
    expect(scorecardFigure('some-new-engine', { score: 72 })).toBe('Score 72/100');
    expect(scorecardFigure('some-new-engine', { score: 72, scoreUnit: '/100' })).toBe('Score 72/100');
    expect(scorecardFigure('url-analyzer', { score: 64, scoreUnit: '%' })).toBe('Safety 64%');
    // The ad-blocker's number is a share of requests: a percentage with or without the field.
    expect(scorecardFigure('ad-blocker-test', { score: 72, scoreUnit: '%' })).toBe('72% blocked');
    expect(scorecardFigure('ad-blocker-test', { score: 72 })).toBe('72% blocked');
  });
  it('returns nothing for value-only tools and a DNS baseline run', () => {
    for (const e of ['hash-generator', 'password-generator', 'text-encryption']) {
      expect(VALUE_ONLY_ENGINES.has(e)).toBe(true);
      expect(scorecardFigure(e, { stats: [{ label: 'Algorithms', value: '4' }] }), e).toBe('');
    }
    expect(scorecardFigure('dns-leak-test', { stats: [{ label: 'Verdict', value: 'Baseline' }] })).toBe('');
  });
});

/**
 * Permission Checker: built from the stats the tool itself reports
 * (summarizePermissions), never a hand-written list. The share card vanished
 * from all 4 permission-checker pages when the tool renamed its stats and a
 * literal fixture here kept the old labels, so a rename must fail this test.
 */
describe('scorecardFigure — Permission Checker, from the tool\'s real stats', () => {
  const scan = (states: Record<string, PermissionResult['state']>, rest: PermissionResult['state']): PermissionResult[] =>
    PERMISSIONS_TO_CHECK.map((p) => ({ ...p, state: states[p.name] ?? rest }));
  // What a fresh Chrome profile reports: five sensors and clipboard-write
  // granted without asking, everything else asks first.
  const CHROME_DEFAULTS: Record<string, PermissionResult['state']> = {
    'clipboard-write': 'granted', accelerometer: 'granted', gyroscope: 'granted', magnetometer: 'granted', 'screen-wake-lock': 'granted',
  };
  const figure = (results: PermissionResult[]) => scorecardFigure('permission-checker', { stats: summarizePermissions(results).stats });
  /** The permissions a fresh Chrome profile does not grant by itself: the ones that need an OK. */
  const NEEDS_OK = PERMISSIONS_TO_CHECK.length - Object.keys(CHROME_DEFAULTS).length;

  it('a fresh Chrome profile: a card, none of the permissions that need an OK allowed', () => {
    // Out of the 6 that need an OK, not all 11: "0 of 11 allowed" sat beside "Allowed by default 5".
    expect(NEEDS_OK).toBe(6);
    expect(figure(scan(CHROME_DEFAULTS, 'prompt'))).toBe('0 of 6 allowed');
  });
  it('counts the permissions the tool calls Allowed, out of Allowed + Blocked + Asks first', () => {
    expect(figure(scan({ ...CHROME_DEFAULTS, camera: 'granted', microphone: 'granted', notifications: 'denied' }, 'prompt'))).toBe(`2 of ${NEEDS_OK} allowed`);
    // A browser that reports some names and rejects the rest: out of the ones it reported.
    expect(figure(scan({ geolocation: 'granted', notifications: 'prompt', camera: 'denied', microphone: 'prompt' }, 'unsupported'))).toBe('1 of 4 allowed');
  });
  it('the denominator is the sum of the tool\'s own Allowed, Blocked and Asks first stats, never Allowed by default', () => {
    const results = scan({ ...CHROME_DEFAULTS, geolocation: 'granted', camera: 'denied', midi: 'denied' }, 'prompt');
    const stats = summarizePermissions(results).stats;
    const stat = (label: string) => Number(stats.find((s) => s.label === label)?.value);
    expect(stat('Allowed by default')).toBe(Object.keys(CHROME_DEFAULTS).length);
    expect(figure(results)).toBe(`${stat('Allowed')} of ${stat('Allowed') + stat('Blocked') + stat('Asks first')} allowed`);
    expect(figure(results)).toBe(`1 of ${NEEDS_OK} allowed`);
  });
  it('shows no card when the browser exposes no permission states at all', () => {
    expect(figure(scan({}, 'unsupported'))).toBe('');
  });
  it('shows no card when every permission reported is one the browser allows by default', () => {
    // Nothing that needs an OK was reported: "0 of 0 allowed" would say nothing.
    expect(figure(scan(CHROME_DEFAULTS, 'unsupported'))).toBe('');
  });
});

describe('shareLinkFor — keeps the quiz result, drops everything else', () => {
  it('keeps a #r= quiz result hash so the recipient sees the result', () => {
    expect(shareLinkFor('https://a.b/tools/x/privacy-score-quiz#r=a98765432100')).toBe('https://a.b/tools/x/privacy-score-quiz#r=a98765432100');
  });
  it('drops the query string and any other hash (lib/handoff rule: nothing crafted rides along)', () => {
    expect(shareLinkFor('https://a.b/tools/x/y?ref=CALL%200800#r=a9')).toBe('https://a.b/tools/x/y#r=a9');
    expect(shareLinkFor('https://a.b/tools/x/y#r=CALL 0800 NOW')).toBe('https://a.b/tools/x/y');
    expect(shareLinkFor('https://a.b/tools/x/y#section')).toBe('https://a.b/tools/x/y');
  });
});

describe('reportCardLine — "clean" only when the scan found nothing (CTO review 2026-09-10)', () => {
  it('calls an A or B clean only with no trackers and no tracking cookies', () => {
    expect(reportCardLine('A', 'green', { trackingCookies: 0, trackers: 0 }).headline).toBe('A clean site. Most are not.');
  });
  it('says what still loads on an A or B that tracks (airbnb.com: B, 3 trackers)', () => {
    const line = reportCardLine('B', 'green', { trackingCookies: 0, trackers: 3 });
    expect(line.headline).toBe('Light tracking, but still 3 trackers before you click anything.');
    expect(line.headline).not.toMatch(/clean/i);
    expect(reportCardLine('A', 'green', { trackingCookies: 1, trackers: 1 }).headline).toBe('Minimal tracking, but still 1 tracker and 1 tracking cookie before you click anything.');
    expect(reportCardLine('B', 'green', { trackingCookies: 0, trackers: 0, pixels: 1 }).headline).toMatch(/1 tracking pixel/);
  });
  it('leaves C, D and F on their own lines', () => {
    expect(reportCardLine('D', 'red', { trackingCookies: 4, trackers: 9 }).headline).toBe('This site tracks you before you click anything.');
  });
});
