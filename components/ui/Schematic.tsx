/**
 * Compact input -> check -> verdict schematic (DESIGN-SPEC 5.4): three 8px
 * dots joined by 1px t3 lines, labelled in text-kicker. Sits under a
 * ToolCard blurb on the instrument panel. Server component.
 */
export function Schematic() {
  return (
    <svg viewBox="0 0 200 32" width="100%" role="img" aria-label="Input, check, verdict">
      <line x1="4" y1="4" x2="100" y2="4" stroke="var(--t3)" strokeWidth="1" />
      <line x1="100" y1="4" x2="196" y2="4" stroke="var(--t3)" strokeWidth="1" />
      <circle cx="4" cy="4" r="4" fill="var(--t3)" />
      <circle cx="100" cy="4" r="4" fill="var(--t3)" />
      <circle cx="196" cy="4" r="4" fill="var(--t3)" />
      <text x="4" y="24" textAnchor="middle" fill="var(--t3)" className="text-kicker uppercase">
        input
      </text>
      <text x="100" y="24" textAnchor="middle" fill="var(--t3)" className="text-kicker uppercase">
        check
      </text>
      <text x="196" y="24" textAnchor="middle" fill="var(--t3)" className="text-kicker uppercase">
        verdict
      </text>
    </svg>
  );
}
