/**
 * Shareable scorecard — a PNG drawn client-side with the Canvas 2D API.
 * No fonts fetched, no server, nothing uploaded. 1200×630 (the size every
 * social card slot expects) so a share lands as a proper preview.
 */
export interface ScorecardSpec {
  /** Big line: "cnn.com" or "My browser fingerprint" */
  title: string;
  /** The visitor's own number: "Grade D" / "63 / 100" / "12 trackers" */
  figure: string;
  /** One line under the figure */
  headline: string;
  /** Up to 4 label/value pairs */
  stats?: Array<{ label: string; value: string }>;
  /** Shown bottom-left; the landing for a share */
  url: string;
  /** Colour of the figure */
  tone: 'red' | 'amber' | 'green' | 'info';
}

export const SCORECARD_W = 1200;
export const SCORECARD_H = 630;

const TONE_COLOR: Record<ScorecardSpec['tone'], string> = { red: '#f87171', amber: '#fbbf24', green: '#4ade80', info: '#e5e7eb' };
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Greedy word wrap that respects the canvas measure. */
export function wrapLines(ctx: { measureText(s: string): { width: number } }, text: string, maxWidth: number, maxLines = 3): string[] {
  // A single token wider than the line (a 60-char hostname, a long URL) is
  // hard-split into pieces that fit; otherwise the greedy loop below would
  // emit it whole and let it run past the edge.
  const words = text.split(/\s+/).filter(Boolean).flatMap((w) => {
    if (ctx.measureText(w).width <= maxWidth) return [w];
    const parts: string[] = [];
    let piece = '';
    for (const ch of w) {
      if (ctx.measureText(piece + ch).width > maxWidth && piece) { parts.push(piece); piece = ch; }
      else piece += ch;
    }
    if (piece) parts.push(piece);
    return parts;
  });
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  return lines;
}

export function drawScorecard(ctx: CanvasRenderingContext2D, spec: ScorecardSpec): void {
  const W = SCORECARD_W, H = SCORECARD_H;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  // brand
  ctx.fillStyle = '#B8B8D4';
  ctx.font = `600 22px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; // never inherit a stale 'right' from a previous draw
  ctx.fillText('INCOGNITO BROWSER  ·  PRIVACY REPORT', 64, 60);

  // Shrinks text to fit availW (and, failing that, truncates with an
  // ellipsis, re-measured) so no two fixed-position canvas draws can ever
  // collide — the fix for every "long value ran into its neighbor" bug on
  // this card (stat columns, the footer URL running into "Check yours
  // free", an IPv6 address or "Microsoft Edge 128.0.2739.42" as the
  // figure, a long domain as the title). Canvas has no wrap/overflow
  // handling, unlike the site's CSS layouts, so every fixed-coordinate
  // text draw here MUST go through this, never a bare fillText.
  const fitText = (text: string, weight: number, startSize: number, minSize: number, availW: number): { text: string; size: number } => {
    let size = startSize;
    ctx.font = `${weight} ${size}px ${FONT}`;
    while (size > minSize && ctx.measureText(text).width > availW) {
      size -= 2;
      ctx.font = `${weight} ${size}px ${FONT}`;
    }
    let out = text;
    if (ctx.measureText(out).width > availW) {
      while (out.length > 1 && ctx.measureText(out + '…').width > availW) out = out.slice(0, -1);
      out += '…';
    }
    return { text: out, size };
  };

  // title — always ONE line (shrunk to fit). A two-line title pushed the
  // whole stack down 62px: with a two-line headline the stat labels then
  // ended at y=558, over the footer at y=546 — measured live on 19 report
  // cards with long domains (audit 2026-09-08). One line keeps the stack at
  // most 496px tall by construction, 50px clear of the footer.
  const ttl = fitText(spec.title, 700, 52, 34, W - 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${ttl.size}px ${FONT}`;
  ctx.fillText(ttl.text, 64, 110);
  let y = 110 + 62 + 18;

  // figure — the visitor's own number. Drawn huge, so it is the first thing
  // to run off the card when an engine hands over a long string.
  const fig = fitText(spec.figure, 800, 120, 48, W - 128);
  ctx.fillStyle = TONE_COLOR[spec.tone];
  ctx.font = `800 ${fig.size}px ${FONT}`;
  ctx.fillText(fig.text, 64, y);
  y += 140;

  // headline
  ctx.fillStyle = '#e5e7eb';
  ctx.font = `500 30px ${FONT}`;
  const head = wrapLines(ctx, spec.headline, W - 128, 2);
  head.forEach((l, i) => ctx.fillText(l, 64, y + i * 40));
  y += head.length * 40 + 24;

  // stats — each column shrinks its own font (and, failing that, truncates)
  // so a long IP or location can never overlap the next column.
  if (spec.stats?.length) {
    const cols = Math.min(4, spec.stats.length);
    const colW = (W - 128) / cols;
    const availW = colW - 16; // gutter between columns
    spec.stats.slice(0, 4).forEach((s, i) => {
      const x = 64 + i * colW;
      const value = fitText(s.value, 700, 34, 18, availW);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${value.size}px ${FONT}`;
      ctx.fillText(value.text, x, y);
      const label = fitText(s.label.toUpperCase(), 400, 20, 12, availW);
      ctx.fillStyle = '#B8B8D4';
      ctx.font = `400 ${label.size}px ${FONT}`;
      ctx.fillText(label.text, x, y + 42);
    });
  }

  // footer — "Check yours free" is fixed and short; the URL gets whatever
  // width is left after it, with a gutter, so a long path (a real one
  // reported live: "incognitobrowser-pseo.vercel.app/tools/children-safety/
  // permission-checker") shrinks/truncates instead of running into it.
  const FOOTER_LABEL = 'Check yours free';
  ctx.font = `400 22px ${FONT}`;
  const labelW = ctx.measureText(FOOTER_LABEL).width;
  const urlAvailW = W - 128 - labelW - 24;
  const url = fitText(spec.url.replace(/^https?:\/\//, ''), 400, 22, 14, urlAvailW);
  ctx.fillStyle = '#B8B8D4';
  ctx.font = `400 ${url.size}px ${FONT}`;
  ctx.fillText(url.text, 64, H - 84);
  ctx.font = `400 22px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(FOOTER_LABEL, W - 64, H - 84);
  ctx.textAlign = 'left';
}

/** Render to a PNG blob. Browser-only. */
export async function renderScorecard(spec: ScorecardSpec): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SCORECARD_W;
  canvas.height = SCORECARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  drawScorecard(ctx, spec);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

/** A safe filename for the download. */
export function scorecardFilename(title: string): string {
  return `privacy-scorecard-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'result'}.png`;
}
