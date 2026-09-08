'use client';

/**
 * The result moment on a Website Privacy Report Card: the grade is the
 * proof, the ask follows it, and the scorecard makes it shareable. The
 * "scan it yourself" destination is the Pro web app (owner decision).
 */
import { useEffect } from 'react';
import { ResultCta } from '@/components/ResultCta';
import { Scorecard } from '@/components/Scorecard';
import { severityFromGrade } from '@/components/tools/ResultContext';
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
}

export function ReportCardFunnel({ domain, niche, grade, score, headline, stats, proUrl, pageUrl }: Props) {
  const severity = severityFromGrade(grade);
  useEffect(() => { track('report_card_view', { tool: 'report-card', niche, severity }, { once: true }); }, [niche, severity]);
  return (
    <div data-report-card-funnel={grade}>
      <ResultCta engine="report-card" niche={niche} severity={severity} headline={`${domain}: grade ${grade}, ${score} / 100`} proWebUrl={proUrl} pageUrl={pageUrl} content={`grade-${grade}`} term="report-card" />
      <Scorecard engine="report-card" niche={niche} title={`Does ${domain} track you?`} figure={`Grade ${grade}`} headline={headline} stats={stats} tone={severity} url={pageUrl} />
    </div>
  );
}
