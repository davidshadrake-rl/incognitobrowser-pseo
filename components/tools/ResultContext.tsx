'use client';

/**
 * Result bus — how a tool tells the page "the visitor has just seen their
 * own exposure". The page (ToolPageClient) provides the context and renders
 * the funnel surfaces below the tool once a result is reported:
 *   - the result-moment CTA (severity-aware, niche-specific copy),
 *   - the shareable scorecard (client-side PNG),
 *   - the post-result "what to do now" checklist.
 *
 * Engines call `useReportResult()` and invoke it whenever their result
 * changes. Outside a provider (previews, tests) it is a no-op, so engines
 * never depend on the page.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Severity = 'red' | 'amber' | 'green' | 'info';

export interface ToolResult {
  /** red = exposed / failing; amber = partial; green = protected; info = neutral output (generators, converters). */
  severity: Severity;
  /** One line, the visitor's own number: "Your browser is 1 in 2.3M", "cnn.com sets 12 tracking cookies". */
  headline: string;
  /** Optional second line. */
  detail?: string;
  /** 0–100 when the tool produces a score. */
  score?: number;
  /** Letter grade when the tool produces one. */
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Up to 4 label/value pairs for the scorecard image. */
  stats?: Array<{ label: string; value: string }>;
  /** Text used when sharing; defaults to headline. */
  shareText?: string;
}

const ReportContext = createContext<((r: ToolResult | null) => void) | null>(null);
const ResultContext = createContext<ToolResult | null>(null);

export function ResultProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<ToolResult | null>(null);
  const report = useCallback((r: ToolResult | null) => setResult(r), []);
  const value = useMemo(() => result, [result]);
  return (
    <ReportContext.Provider value={report}>
      <ResultContext.Provider value={value}>{children}</ResultContext.Provider>
    </ReportContext.Provider>
  );
}

/** For engines: call with the current result (or null to clear). No-op outside a provider. */
export function useReportResult(): (r: ToolResult | null) => void {
  const report = useContext(ReportContext);
  return report ?? (() => {});
}

/** For the page: the latest reported result. */
export function useToolResult(): ToolResult | null {
  return useContext(ResultContext);
}

/** Map a 0–100 score to a severity with the thresholds used site-wide. */
export function severityFromScore(score: number): Severity {
  if (score >= 80) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

/** Map a letter grade to a severity. */
export function severityFromGrade(grade: string): Severity {
  if (grade === 'A' || grade === 'B') return 'green';
  if (grade === 'C') return 'amber';
  return 'red';
}
