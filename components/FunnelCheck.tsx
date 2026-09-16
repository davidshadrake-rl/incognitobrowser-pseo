'use client';

/**
 * The answer to a visitor's result: what it means for them, what Incognito Pro
 * does about it, and the Pro subscription button. It appears only once there
 * is a result, and only for that result.
 *
 * Whose words it uses: a visitor who came from a content page's card arrives
 * with ?from=<that page> (components/ToolEntryCard.tsx), and gets the answer
 * written for that page — loaded from /funnels/cta/<engine>.json, which
 * scripts/funnels/export.ts writes, so a tool page never ships every page's
 * copy. Without one, the tool page's own funnel answers.
 *
 * Counted per page (lib/track.ts): result_shown and funnel_click carry the
 * page the funnel belongs to.
 */
import { useEffect, useState } from 'react';
import { useToolResult } from '@/components/tools/ResultContext';
import { UpgradeButtons } from '@/components/UpgradeButtons';
import { basePathFrom } from '@/lib/adblock-bait';
import { track } from '@/lib/track';
import { PRO_FOOTNOTE } from '@/lib/tiers';
import type { FunnelSeverity, PageFunnelV2, ResultCopy } from '@/lib/funnels';

const TONE: Record<FunnelSeverity, string> = {
  red: 'border-t-danger',
  amber: 'border-t-warn',
  green: 'border-t-ok',
  info: 'border-t-b2',
};

/** The words for one result and the ask that follows them. */
export function FunnelOutcome({ funnel, severity }: { funnel: PageFunnelV2; severity: FunnelSeverity }) {
  const copy = funnel.results[severity];
  if (!copy) return null;
  const { engine } = funnel.check;
  const topic = funnel.topic ?? undefined;
  return (
    <div className={`mt-5 border-t-2 ${TONE[severity]} pt-4`} data-funnel-result={severity} role="status" aria-live="polite">
      <p className="text-t1 font-medium">{copy.meaning}</p>
      {/* ib-upgrade: hidden inside the app for someone who already has Pro (lib/in-app.ts); the meaning above stays. */}
      <div className="ib-upgrade">
        <p className="mt-2 text-sm text-t2">{copy.pro}</p>
        <div className="mt-4">
          <UpgradeButtons
            engine={engine}
            niche={topic}
            severity={severity}
            from="funnel"
            content={topic || funnel.type}
            term={funnel.type}
            label={copy.button}
            onClick={(target) => track('funnel_click', { tool: engine, severity, target, page: funnel.path })}
          />
        </div>
        <p className="text-meta text-t3 mt-3">{PRO_FOOTNOTE}</p>
      </div>
    </div>
  );
}

/** Answers whatever the engine inside the nearest ResultProvider reports. */
export function FunnelAnswer({ funnel }: { funnel: PageFunnelV2 }) {
  const result = useToolResult();
  const severity = result?.severity;
  useEffect(() => {
    if (severity) track('result_shown', { tool: funnel.check.engine, severity, page: funnel.path }, { once: true });
  }, [severity, funnel.check.engine, funnel.path]);
  if (!severity) return null;
  return <FunnelOutcome funnel={funnel} severity={severity} />;
}

/** One page's answers for this engine, as scripts/funnels/export.ts writes them. */
export interface CtaEntry { type: string; topic: string | null; results: Partial<Record<FunnelSeverity, ResultCopy>> }

/**
 * The funnel of the page the visitor came from, if they came from one that
 * has an answer written for this tool. `pending` is true while that is still
 * being looked up, so the generic ask doesn't flash in and get replaced.
 */
export function useFromPageFunnel(engine: string): { funnel: PageFunnelV2 | null; pending: boolean } {
  const [state, setState] = useState<{ funnel: PageFunnelV2 | null; pending: boolean }>({ funnel: null, pending: true });
  useEffect(() => {
    let cancelled = false;
    const from = new URLSearchParams(window.location.search).get('from');
    // Only a page path: never a URL, never anything a link could smuggle in.
    if (!from || !/^\/[a-z0-9/._~-]*$/i.test(from)) {
      setState({ funnel: null, pending: false });
      return;
    }
    const base = basePathFrom(window.location.pathname);
    fetch(`${base}/funnels/cta/${engine}.json`, { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((all: Record<string, CtaEntry>) => {
        if (cancelled) return;
        const e = Object.prototype.hasOwnProperty.call(all, from) ? all[from] : null;
        setState({
          funnel: e ? { v: 2, path: from, type: e.type, topic: e.topic, step1: { label: '', quote: '' }, stakes: '', check: { engine, button: '', mode: 'page', href: null }, results: e.results } : null,
          pending: false,
        });
      })
      .catch(() => { if (!cancelled) setState({ funnel: null, pending: false }); });
    return () => { cancelled = true; };
  }, [engine]);
  return state;
}
