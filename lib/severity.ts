/**
 * Score and grade to a result colour, used on both sides of the page.
 *
 * Lives outside components/tools/ResultContext.tsx because that module is
 * client-only, and a server page (a report card works out its colour while it
 * is built) cannot call a function exported from a client module.
 * ResultContext re-exports these, so client code imports them as before.
 */
export type Severity = 'red' | 'amber' | 'green' | 'info';

/** Map a 0–100 score to a severity with the thresholds used site-wide. */
export function severityFromScore(score: number): Severity {
  if (score >= 80) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

/** Map a letter grade to a severity. 'A+' is green like 'A'; it used to fall through to red. */
export function severityFromGrade(grade: string): Severity {
  if (grade === 'A+' || grade === 'A' || grade === 'B') return 'green';
  if (grade === 'C') return 'amber';
  return 'red';
}
