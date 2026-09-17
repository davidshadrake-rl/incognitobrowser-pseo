'use client';

/**
 * The words written for the page the visitor came from.
 *
 * A content page's card links to a tool page with ?from=<that page>, and the
 * tool page answers the visitor's result in that page's words, loaded from
 * /funnels/cta/<engine>.json (scripts/funnels/export.ts writes it), so a tool
 * page never ships every page's copy. Called once per page, by ResultProvider
 * (components/tools/ResultContext.tsx).
 */
import { useEffect, useState } from 'react';
import { basePathFrom } from '@/lib/adblock-bait';
import type { FunnelSeverity, PageFunnelV2, ResultCopy } from '@/lib/funnel-types';

/** One page's answers for this engine, as scripts/funnels/export.ts writes them. */
export interface CtaEntry { type: string; topic: string | null; results: Partial<Record<FunnelSeverity, ResultCopy>> }

/**
 * `pending` is true while the lookup runs, so the card waits for the right
 * words instead of flashing the tool's default and swapping them.
 * An empty engine (a page with no tool) resolves at once to nothing.
 */
export function useFromPageFunnel(engine: string): { funnel: PageFunnelV2 | null; pending: boolean } {
  const [state, setState] = useState<{ funnel: PageFunnelV2 | null; pending: boolean }>({ funnel: null, pending: !!engine });
  useEffect(() => {
    let cancelled = false;
    const from = new URLSearchParams(window.location.search).get('from');
    // Only a page path: never a URL, never anything a link could smuggle in.
    if (!engine || !from || !/^\/[a-z0-9/._~-]*$/i.test(from)) {
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
