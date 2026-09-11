'use client';

/**
 * The result moment on a Website Privacy Report Card: the grade is the
 * proof, the ask follows it, and the scorecard makes it shareable. The
 * "scan it yourself" destination is the Pro web app (owner decision).
 */
import { useEffect, useMemo } from 'react';
import { ResultCta } from '@/components/ResultCta';
import { Scorecard } from '@/components/Scorecard';
import { severityFromGrade } from '@/components/tools/ResultContext';
import { reportCardLine } from '@/lib/cta-copy';
import { track } from '@/lib/track';

interface Props {
  domain: string;
  niche: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  headline: string;
  stats: Array<{ label: string; value: string }>;
  proUrl: string;
  pageUrl: string;
  /**
   * Inline tracking pixels on the homepage that the tracker count does not
   * already include (the report-card page works them out). A card reads
   * "clean" only when this is 0 as well.
   */
  pixels?: number;
}

/** A count from the stats the page already passes, by label; 0 when absent. */
function statCount(stats: Props['stats'], label: string): number {
  const n = parseInt(stats.find((s) => s.label.toLowerCase() === label)?.value ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

export function ReportCardFunnel({ domain, niche, grade, score, headline, stats, proUrl, pageUrl, pixels = 0 }: Props) {
  const severity = severityFromGrade(grade);
  // The tone follows the grade; the words follow the scan (see reportCardLine).
  const line = useMemo(
    () => reportCardLine(grade, severity, { trackingCookies: statCount(stats, 'tracking cookies'), trackers: statCount(stats, 'trackers'), pixels }),
    [grade, severity, stats, pixels],
  );
  useEffect(() => { track('report_card_view', { tool: 'report-card', niche, severity }, { once: true }); }, [niche, severity]);
  return (
    <div data-report-card-funnel={grade}>
      <ResultCta engine="report-card" niche={niche} severity={severity} line={line} headline={`${domain}: grade ${grade}, ${score} / 100`} proWebUrl={proUrl} pageUrl={pageUrl} content={`grade-${grade}`} term="report-card" />
      <Scorecard engine="report-card" niche={niche} title={`Does ${domain} track you?`} figure={`Grade ${grade}`} headline={headline} stats={stats} tone={severity} url={pageUrl} />
    </div>
  );
}
