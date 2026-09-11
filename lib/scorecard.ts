/**
 * Shareable scorecard — a PNG drawn client-side with the Canvas 2D API.
 * No fonts fetched, no server, nothing uploaded. 1200×630 (the size every
 * social card slot expects) so a share lands as a proper preview.
 */
import { pageLinkFor } from './handoff';

export interface ScorecardSpec {
  /** Big line: "cnn.com" or "My browser fingerprint" */
  title: string;
  /** The visitor's own number, with its label (see scorecardFigure): "Grade D" / "Score 63/100" / "12 trackers" */
  figure: string;
  /** One line under the figure */
  headline: string;
  /** Up to 4 label/value pairs */
  stats?: Array<{ label: string; value: string }>;
  /** Shown bottom-left; the landing for a share */
  url: string;
  /** Colour of the figure */
  tone: 'red' | 'amber' | 'green' | 'info';
  /**
   * 0-100. When present, draws the same gauge arc as the page's <Gauge>
   * (DESIGN-SPEC 4.2: "the shared PNG matches the page") in the card's top
   * right. Optional and additive: omitting it reproduces the pre-existing
   * layout exactly (no engine passes it yet — see openQuestions).
   */
  score?: number;
}

export const SCORECARD_W = 1200;
export const SCORECARD_H = 630;

// DESIGN-SPEC 2.1 tokens, as literal hex — canvas cannot read CSS custom
// properties, so these are the --base/--s0/--s1/--t1/--t2/--t3/--b1/--ok/
// --warn/--danger/--info values from app/globals.css, copied, not reinvented.
const TOKEN = {
  base: '#000000', s0: '#191b1c', s1: '#2b2b36',
  t1: '#ffffff', t2: '#b8b8d4', t3: '#8c8ca6',
  b1: '#ffffff33',
  ok: '#4ade80', warn: '#facc15', danger: '#f87171', info: '#8c8ca6',
} as const;

const TONE_COLOR: Record<ScorecardSpec['tone'], string> = { red: TOKEN.danger, amber: TOKEN.warn, green: TOKEN.ok, info: TOKEN.info };
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Same geometry family as components/ui/Gauge.tsx (0-100 score, semicircle,
// track then value arc), redrawn with canvas arc() instead of an SVG path
// since Canvas 2D has no elliptical-arc primitive to match Gauge's `A70 70`
// command directly. Canvas angles increase clockwise from 3 o'clock; a
// semicircle open at the bottom runs from PI (9 o'clock) to 2*PI (3 o'clock)
// through -PI/2 (12 o'clock).
const GAUGE_R = 64;
const GAUGE_STROKE = 14;
/** Reserved width on the right so a long title/figure (through fitText) never runs under the gauge. */
const GAUGE_RESERVE = 210;

type FitText = (text: string, weight: number, startSize: number, minSize: number, availW: number) => { text: string; size: number };

function drawGaugeArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, score: number, color: string, fit: FitText): void {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = GAUGE_STROKE;
  ctx.strokeStyle = TOKEN.s1;
  ctx.beginPath();
  ctx.arc(cx, cy, GAUGE_R, Math.PI, 2 * Math.PI, false);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, GAUGE_R, Math.PI, Math.PI + Math.PI * (clamped / 100), false);
  ctx.stroke();
  ctx.restore();

  // score + label, centred in the arc — through fitText like every other
  // data-driven draw on this card, even though a 0-100 integer rarely needs to shrink.
  ctx.textAlign = 'center';
  const value = fit(String(clamped), 800, 40, 22, GAUGE_R * 1.5);
  ctx.fillStyle = TOKEN.t1;
  ctx.font = `800 ${value.size}px ${FONT}`;
  ctx.fillText(value.text, cx, cy - 26);
  const label = fit('SCORE', 400, 16, 10, GAUGE_R * 1.5);
  ctx.fillStyle = TOKEN.t3;
  ctx.font = `400 ${label.size}px ${FONT}`;
  ctx.fillText(label.text, cx, cy + 16);
  ctx.textAlign = 'left';
}

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
  ctx.fillStyle = TOKEN.s0; // DESIGN-SPEC 2.3 codemod: #0a0a0a -> s0
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = TOKEN.b1; // "brand divider; card borders"
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  // brand
  ctx.fillStyle = TOKEN.t2;
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

  // DESIGN-SPEC 4.2: when a score is given, a gauge arc (same shape as the
  // page's <Gauge>) sits top-right. Title and figure reserve that width
  // through fitText's availW so a long value can never run under it.
  const hasGauge = typeof spec.score === 'number';
  const rightReserve = hasGauge ? GAUGE_RESERVE : 0;

  // title — always ONE line (shrunk to fit). A two-line title pushed the
  // whole stack down 62px: with a two-line headline the stat labels then
  // ended at y=558, over the footer at y=546 — measured live on 19 report
  // cards with long domains (audit 2026-09-08). One line keeps the stack at
  // most 496px tall by construction, 50px clear of the footer.
  const ttl = fitText(spec.title, 700, 52, 34, W - 128 - rightReserve);
  ctx.fillStyle = TOKEN.t1;
  ctx.font = `700 ${ttl.size}px ${FONT}`;
  ctx.fillText(ttl.text, 64, 110);
  let y = 110 + 62 + 18;

  if (hasGauge) drawGaugeArc(ctx, W - 160, 130, spec.score as number, TONE_COLOR[spec.tone], fitText);

  // figure — the visitor's own number. Drawn huge, so it is the first thing
  // to run off the card when an engine hands over a long string.
  const fig = fitText(spec.figure, 800, 120, 48, W - 128 - rightReserve);
  ctx.fillStyle = TONE_COLOR[spec.tone];
  ctx.font = `800 ${fig.size}px ${FONT}`;
  ctx.fillText(fig.text, 64, y);
  y += 140;

  // headline
  ctx.fillStyle = TOKEN.t2;
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
      ctx.fillStyle = TOKEN.t1;
      ctx.font = `700 ${value.size}px ${FONT}`;
      ctx.fillText(value.text, x, y);
      const label = fitText(s.label.toUpperCase(), 400, 20, 12, availW);
      ctx.fillStyle = TOKEN.t2;
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
  ctx.fillStyle = TOKEN.t2;
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

/**
 * Tools that only produce a value (a hash, a password, ciphertext). There is
 * nothing about the visitor to share, so they get no scorecard and no
 * result CTA: the card used to show a bare "4" or "20" or "123 chars".
 */
export const VALUE_ONLY_ENGINES = new Set(['hash-generator', 'password-generator', 'text-encryption']);

interface FigureSource {
  score?: number;
  /**
   * How the tool writes its score (ToolResult.scoreUnit): '%' draws "72%",
   * anything else "72/100". Optional, so a result bus without the field
   * still draws "/100".
   */
  scoreUnit?: string;
  grade?: string;
  stats?: Array<{ label: string; value: string }>;
}

/**
 * The scorecard's big figure for a tool result: the tool's own number WITH
 * its label ("72% blocked", "3 trackers"), matching what the tool itself
 * says. It used to be the grade, else the score as "/ 100" (so a percentage
 * read "72 / 100"), else the first stat's value with no label at all.
 * '' means nothing worth sharing, and the scorecard is not shown.
 * Stats are looked up by label, not position, so reordering a tool's stats
 * cannot silently change the figure.
 */
export function scorecardFigure(engine: string, r: FigureSource): string {
  if (VALUE_ONLY_ENGINES.has(engine)) return '';
  const stat = (label: string) => r.stats?.find((s) => s.label.toLowerCase() === label)?.value;
  const num = (label: string) => {
    const n = parseInt(stat(label) ?? '', 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const score = typeof r.score === 'number' ? Math.round(r.score) : undefined;
  const scored = (label: string) => (score === undefined ? '' : `${label} ${score}${r.scoreUnit === '%' ? '%' : '/100'}`);
  switch (engine) {
    // A share of requests blocked: a percentage whatever unit the result names.
    case 'ad-blocker-test': return score === undefined ? '' : `${score}% blocked`;
    case 'password-strength': return scored('Strength');
    // The quiz's number is its score. Its letter, "+" included, is in the
    // share headline; drawn as "Grade X" it once lost the "+" ("A+" as "A").
    case 'privacy-quiz':
    case 'browser-privacy': return scored('Score');
    case 'url-analyzer': return scored('Safety');
    case 'whats-my-ip': {
      const v = stat('verdict');
      return v ? `IP ${v.toLowerCase()}` : '';
    }
    case 'dns-leak-test': {
      // A VPN-off run only records the baseline: nothing to share yet.
      const v = stat('verdict');
      return v === 'Leaking' ? 'DNS leaking' : v === 'No leak' ? 'No DNS leak' : v === 'Inconclusive' ? 'Inconclusive' : '';
    }
    case 'useragent-analyzer': return stat('browser') ?? '';
    case 'permission-checker': {
      // The tool's own words (summarizePermissions): Allowed / Blocked / Asks
      // first / Allowed by default. The figure is out of the permissions that
      // need the visitor's OK (Allowed + Blocked + Asks first), the ones the
      // headline talks about: counting "Allowed by default" too gave a fresh
      // Chrome "0 of 11 allowed" beside "Allowed by default 5". Its unsupported
      // branch reports only Checked 0 and Unsupported N: nothing was checked,
      // so there is nothing to share.
      const allowed = num('allowed');
      if (allowed === undefined || num('checked') === 0) return '';
      const total = allowed + (num('blocked') ?? 0) + (num('asks first') ?? 0);
      return total ? `${allowed} of ${total} allowed` : '';
    }
    case 'link-unwrapper': {
      const n = num('trackers');
      return n === undefined ? '' : n ? count(n, 'tracker') : 'No trackers';
    }
    case 'email-pixel-detector': {
      const pixels = num('pixels') ?? 0;
      const links = num('tracked links') ?? 0;
      return pixels ? count(pixels, 'tracking pixel') : links ? count(links, 'tracked link') : 'No trackers';
    }
    case 'screenshot-leak-checker': {
      const n = num('leaks');
      return n === undefined ? '' : n ? count(n, 'leak') : 'No leaks';
    }
    case 'metadata-viewer': {
      if (stat('gps') === 'yes') return 'GPS location';
      const n = num('fields');
      return n === undefined ? '' : n ? count(n, 'metadata field') : 'No metadata';
    }
    case 'cookie-analyzer': {
      const n = num('tracking cookies') ?? num('tracking');
      return n === undefined ? '' : count(n, 'tracking cookie');
    }
    default:
      return r.grade ? `Grade ${r.grade}` : scored('Score');
  }
}

/**
 * The link a shared scorecard carries: origin + path (lib/handoff's
 * pageLinkFor drops the query and hash, so crafted text never rides along),
 * plus the Privacy Score Quiz's own result hash when it is exactly that shape
 * (#r= and the base-36 answer digits the quiz writes). Without it the
 * recipient opened a blank quiz instead of the result.
 */
export function shareLinkFor(href: string): string {
  let hash = '';
  try { hash = new URL(href).hash; } catch { /* not an absolute URL: no hash kept */ }
  return pageLinkFor(href) + (/^#r=[0-9a]{1,32}$/.test(hash) ? hash : '');
}
