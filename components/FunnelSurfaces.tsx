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

  const figure = result?.grade ? `Grade ${result.grade}` : typeof result?.score === 'number' ? `${Math.round(result.score)} / 100` : result?.stats?.[0]?.value || '';
  return (
    <>
      {result && (
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
