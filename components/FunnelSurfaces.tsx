'use client';

/**
 * What follows a tool's report once the visitor has a result: the "what to
 * do now" steps. The answer, the upgrade ask and sharing are in the result
 * card at the top of the result (components/tools/ResultCard.tsx; owner,
 * 2026-09-16: they sit above the long report, on screen when it appears).
 * Reads the result bus; engines never know this exists.
 */
import { useEffect } from 'react';
import { useResultAsk, useToolResult } from '@/components/tools/ResultContext';
import { NextSteps, type NextStepsData } from '@/components/NextSteps';
import { track } from '@/lib/track';

interface Props {
  engine: string;
  niche: string;
  nextSteps?: NextStepsData | null;
}

export function FunnelSurfaces({ engine, niche, nextSteps }: Props) {
  const result = useToolResult();
  const askState = useResultAsk();
  const page = askState?.pending ? undefined : askState?.answer?.path;
  const runId = askState?.run?.id ?? 0;
  useEffect(() => {
    if (!result || askState?.pending) return;
    track('result_shown', { tool: engine, niche, severity: result.severity, page }, { once: true });
    // One count per run and colour; a re-run with a new colour counts again (lib/track.ts keys on severity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.severity, runId, engine, niche, page, askState?.pending]);
  return nextSteps ? <NextSteps data={nextSteps} engine={engine} niche={niche} /> : null;
}
