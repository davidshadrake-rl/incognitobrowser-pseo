'use client';

/**
 * "Check yours now" — the one block that turns a content page into a proof
 * moment. Rendered on every guide, checklist, comparison, template,
 * calculator and glossary page; links to the niche's free tool.
 */
import Link from 'next/link';
import { track } from '@/lib/track';
import type { ProofRoute } from '@/lib/proof-route';

export function CheckYoursNow({ route, niche, nicheName }: { route: ProofRoute; niche: string; nicheName: string }) {
  return (
    <aside className="my-8 rounded-lg border border-b1 bg-white/[0.03] p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-check-yours={route.engine}>
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wider text-t3 mb-1">Check yours now</p>
        <p className="text-white font-medium">{route.title}</p>
        <p className="text-sm text-t2 mt-1">{route.sameNiche ? `The ${nicheName} check that shows your own number in one tap. Free, runs in your browser.` : 'Reading is one thing. See your own number in one tap. Free, runs in your browser.'}</p>
      </div>
      <Link href={route.href} onClick={() => track('proof_route_click', { tool: route.engine, niche })} className="btn-primary text-sm !px-5 !py-2.5 shrink-0 text-center">
        Run the check →
      </Link>
    </aside>
  );
}
