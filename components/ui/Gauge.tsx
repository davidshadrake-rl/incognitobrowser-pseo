/**
 * Result gauge (DESIGN-SPEC 5.4): a 180x110 SVG arc, 0-100 score, coloured
 * by severity. Never colour alone — the numeric score and the label are
 * always rendered as text next to the arc, and `role="img"` carries an
 * aria-label with the number in words too. Server component.
 */
const ARC = 'M20 100 A70 70 0 0 1 160 100';
const ARC_LENGTH = 220;

type Status = 'ok' | 'warn' | 'danger';

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
};

export function Gauge({ score, label = 'score' }: { score: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const status = statusFromScore(clamped);
  const offset = ARC_LENGTH - (ARC_LENGTH * clamped) / 100;
  return (
    <svg viewBox="0 0 180 110" width="100%" role="img" aria-label={`${label}: ${clamped} out of 100`}>
      <path d={ARC} stroke="var(--s1)" strokeWidth="12" strokeLinecap="round" fill="none" />
      <path
        d={ARC}
        stroke={STROKE[status]}
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={ARC_LENGTH}
        strokeDashoffset={offset}
      />
      <text x="90" y="96" textAnchor="middle" fill="var(--t1)" className="text-gauge font-bold tnum">
        {clamped}
      </text>
      <text x="90" y="108" textAnchor="middle" fill="var(--t3)" className="text-kicker uppercase">
        {label}
      </text>
    </svg>
  );
}
