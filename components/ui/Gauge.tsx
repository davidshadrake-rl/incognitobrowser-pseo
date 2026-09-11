/**
 * Result gauge (DESIGN-SPEC 5.4): a 180x110 SVG arc, 0-100 score, coloured
 * by the caller's `status`, or by the score's own bands when none is passed.
 * Never colour alone — the numeric score, its unit and the label are always
 * rendered as text next to the arc, and `role="img"` carries an aria-label
 * with the number in words too. Server component.
 */
import type { Status } from './StatusDot';

const ARC = 'M20 100 A70 70 0 0 1 160 100';
const ARC_LENGTH = 220;

/** What the number is. A bare "72" read as a count; the unit says it is a score out of 100 or a percentage. */
export type GaugeUnit = '/100' | '%';

/** Same 80 / 50 thresholds as components/tools/ResultContext.tsx
 * severityFromScore, expressed as the status tokens the CSS uses (that file
 * is 'use client' and cannot be imported into this server component). */
function statusFromScore(score: number): Status {
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'danger';
}

const STROKE: Record<Status, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};

export function Gauge({
  score,
  label = 'score',
  unit = '/100',
  status,
}: {
  score: number;
  label?: string;
  unit?: GaugeUnit;
  /**
   * The arc colour, when the verdict beside the gauge is not the score's
   * band: a short link scores 90 but is a Warning, and an ad blocker's
   * Warning runs up to 89%. Omit it and the arc follows the 80 / 50 bands.
   */
  status?: Status;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = STROKE[status ?? statusFromScore(clamped)];
  const offset = ARC_LENGTH - (ARC_LENGTH * clamped) / 100;
  const spoken = unit === '%' ? `${clamped} percent` : `${clamped} out of 100`;
  return (
    <svg viewBox="0 0 180 110" width="100%" role="img" aria-label={`${label}: ${spoken}`}>
      <path d={ARC} stroke="var(--s1)" strokeWidth="12" strokeLinecap="round" fill="none" />
      <path
        d={ARC}
        stroke={stroke}
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={ARC_LENGTH}
        strokeDashoffset={offset}
      />
      <text x="90" y="96" textAnchor="middle" fill="var(--t1)" className="text-gauge font-bold tnum">
        {clamped}
        <tspan fill="var(--t3)" className="text-meta font-normal" dx="2">{unit}</tspan>
      </text>
      <text x="90" y="108" textAnchor="middle" fill="var(--t3)" className="text-kicker uppercase">
        {label}
      </text>
    </svg>
  );
}
