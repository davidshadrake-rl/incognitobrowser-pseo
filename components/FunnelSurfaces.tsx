'use client';

/**
 * Everything that appears under a tool once the visitor has a result:
 * the result-moment CTA, the shareable scorecard, and the "what to do now"
 * steps. Reads the result bus; engines never know these exist.
 */
import { useEffect } from 'react';
import { useToolResult } from '@/components/tools/ResultContext';
import { ResultCta } from '@/components/ResultCta';
import { Scorecard } from '@/components/Scorecard';
import { NextSteps, type NextStepsData } from '@/components/NextSteps';
import { scorecardFigure, VALUE_ONLY_ENGINES } from '@/lib/scorecard';
import { track } from '@/lib/track';
import { FunnelAnswer } from '@/components/FunnelCheck';
import type { PageFunnelV2 } from '@/lib/funnels';

interface Props {
  engine: string;
  niche: string;
  title: string;
  nextSteps?: NextStepsData | null;
  proWebUrl?: string;
  /**
   * This tool page's own v2 funnel. When present it answers the result in the
   * words written for this page, in place of the generic ResultCta: one ask.
   */
  funnel?: PageFunnelV2 | null;
}

export function FunnelSurfaces({ engine, niche, title, nextSteps, proWebUrl, funnel }: Props) {
  const result = useToolResult();
  useEffect(() => {
    if (result) track('result_shown', { tool: engine, niche, severity: result.severity }, { once: true });
  }, [result, engine, niche]);

  // A generated hash, password or ciphertext says nothing about the visitor:
  // no "your result" CTA and no share card for those tools.
  const aboutVisitor = !VALUE_ONLY_ENGINES.has(engine);
  const figure = result ? scorecardFigure(engine, result) : '';
  return (
    <>
      {result && aboutVisitor && (
        <>
          {funnel
            ? <section className="mt-8 rounded-[16px] border border-b1 bg-white/[0.03] p-5 sm:p-6" data-page-funnel={engine} data-funnel-v="2"><FunnelAnswer funnel={funnel} /></section>
            : <ResultCta engine={engine} niche={niche} severity={result.severity} headline={result.headline} proWebUrl={proWebUrl} content={niche} />}
          {figure && (
            <Scorecard engine={engine} niche={niche} title={title} figure={figure} headline={result.shareText || result.headline} stats={result.stats} tone={result.severity} />
          )}
        </>
      )}
      {nextSteps && <NextSteps data={nextSteps} engine={engine} niche={niche} />}
    </>
  );
}
