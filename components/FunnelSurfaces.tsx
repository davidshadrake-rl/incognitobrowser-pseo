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

interface Props {
  engine: string;
  niche: string;
  title: string;
  nextSteps?: NextStepsData | null;
  proWebUrl?: string;
}

export function FunnelSurfaces({ engine, niche, title, nextSteps, proWebUrl }: Props) {
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
          <ResultCta engine={engine} niche={niche} severity={result.severity} headline={result.headline} proWebUrl={proWebUrl} content={niche} />
          {figure && (
            <Scorecard engine={engine} niche={niche} title={title} figure={figure} headline={result.shareText || result.headline} stats={result.stats} tone={result.severity} />
          )}
        </>
      )}
      {nextSteps && <NextSteps data={nextSteps} engine={engine} niche={niche} />}
    </>
  );
}
