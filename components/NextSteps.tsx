'use client';

/**
 * Post-result "what to do now" — three concrete steps from the niche's own
 * checklist, then the full checklist page. Keeps the visitor moving on the
 * site instead of bouncing, and feeds the content funnel.
 */
import Link from 'next/link';
import { track } from '@/lib/track';

export interface NextStep { task: string; why: string }
export interface NextStepsData { nicheName: string; checklistTitle: string; checklistHref: string; steps: NextStep[] }

export function NextSteps({ data, engine, niche }: { data: NextStepsData; engine: string; niche?: string }) {
  if (!data.steps.length) return null;
  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-[#0a0a0a] p-5" data-next-steps={niche}>
      <h3 className="text-lg font-semibold text-white mb-1">What to do now</h3>
      <p className="text-xs text-[#B8B8D4]/60 mb-4">Three steps from the {data.nicheName} checklist. Each one is verifiable.</p>
      <ol className="space-y-3">
        {data.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-white/10 text-white text-xs flex items-center justify-center">{i + 1}</span>
            <div>
              <div className="text-sm text-white">{s.task}</div>
              {s.why && <div className="text-xs text-[#B8B8D4] mt-0.5">{s.why}</div>}
            </div>
          </li>
        ))}
      </ol>
      <Link href={data.checklistHref} onClick={() => track('next_step_click', { tool: engine, niche, target: 'checklist' })} className="inline-block mt-4 text-sm text-white underline hover:no-underline">
        Full checklist: {data.checklistTitle} →
      </Link>
    </section>
  );
}
