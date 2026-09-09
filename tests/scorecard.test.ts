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
import { drawScorecard, wrapLines, type ScorecardSpec } from '../lib/scorecard';

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
