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
  const words = text.split(/\s+/).filter(Boolean);
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
  ctx.fillText('INCOGNITO BROWSER  ·  PRIVACY REPORT', 64, 60);

  // title
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 52px ${FONT}`;
  const title = wrapLines(ctx, spec.title, W - 128, 2);
  title.forEach((l, i) => ctx.fillText(l, 64, 110 + i * 62));
  let y = 110 + title.length * 62 + 18;

  // figure
  ctx.fillStyle = TONE_COLOR[spec.tone];
  ctx.font = `800 120px ${FONT}`;
  ctx.fillText(spec.figure, 64, y);
  y += 140;

  // headline
  ctx.fillStyle = '#e5e7eb';
  ctx.font = `500 30px ${FONT}`;
  const head = wrapLines(ctx, spec.headline, W - 128, 2);
  head.forEach((l, i) => ctx.fillText(l, 64, y + i * 40));
  y += head.length * 40 + 24;

  // stats
  if (spec.stats?.length) {
    const cols = Math.min(4, spec.stats.length);
    const colW = (W - 128) / cols;
    spec.stats.slice(0, 4).forEach((s, i) => {
      const x = 64 + i * colW;
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 34px ${FONT}`;
      ctx.fillText(s.value, x, y);
      ctx.fillStyle = '#B8B8D4';
      ctx.font = `400 20px ${FONT}`;
      ctx.fillText(s.label.toUpperCase(), x, y + 42);
    });
  }

  // footer
  ctx.fillStyle = '#B8B8D4';
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(spec.url.replace(/^https?:\/\//, ''), 64, H - 84);
  ctx.textAlign = 'right';
  ctx.fillText('Check yours free', W - 64, H - 84);
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
