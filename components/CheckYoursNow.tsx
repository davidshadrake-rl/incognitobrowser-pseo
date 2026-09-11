'use client';

/**
 * The tool card that turns a content page into a proof moment. Rendered on
 * guide, checklist, comparison, template and calculator pages; links to the
 * free tool lib/proof-route picks for the niche (no card when none fits).
 * Every line is the engine's own copy: what the visitor finds out, what they
 * will have to do, and a button that names the tool it opens.
 */
import Link from 'next/link';
import { track } from '@/lib/track';
import type { ProofRoute } from '@/lib/proof-route';

// nicheName is still passed by the page templates; the copy no longer uses it.
export function CheckYoursNow({ route, niche }: { route: ProofRoute; niche: string; nicheName?: string }) {
  return (
    <aside className="my-8 rounded-lg border border-b1 bg-white/[0.03] p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-check-yours={route.engine}>
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wider text-t3 mb-1">Try it yourself</p>
        <p className="text-white font-medium">{route.title}</p>
        <p className="text-sm text-t2 mt-1">{route.gives}</p>
        <p className="text-xs text-t3 mt-1">{route.needs}</p>
      </div>
      <Link href={route.href} onClick={() => track('proof_route_click', { tool: route.engine, niche })} className="btn-primary text-sm !px-5 !py-2.5 shrink-0 text-center">
        {`${route.button} →`}
      </Link>
    </aside>
  );
}
