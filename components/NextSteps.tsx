'use client';

/**
 * Post-result "what to do now" — up to three concrete steps from a checklist
 * (the niche's own, else a related niche's), then the full checklist page;
 * or, when no checklist is published, the tool's own tips and the topic hub.
 * Keeps the visitor moving on the site instead of bouncing, and feeds the
 * content funnel.
 */
import Link from 'next/link';
import { track } from '@/lib/track';

export interface NextStep { task: string; why: string }
export interface NextStepsData {
  /** The niche the steps come from: the checklist's niche, which may be a related one. */
  nicheName: string;
  checklistTitle: string;
  checklistHref: string;
  steps: NextStep[];
  /** The steps are the tool's own tips (no published checklist), and the link goes to the topic hub. */
  fromTips?: boolean;
}

const COUNT_WORD = ['One', 'Two', 'Three'];

export function NextSteps({ data, engine, niche }: { data: NextStepsData; engine: string; niche?: string }) {
  if (!data.steps.length) return null;
  const n = data.steps.length;
  const count = COUNT_WORD[n - 1] ?? String(n);
  // Name the real source: the line used to say "from the <this topic>
  // checklist" even when the steps and the link came from another niche's list.
  const lead = data.fromTips
    ? `${count} ${n === 1 ? 'tip' : 'tips'} on ${data.nicheName}.`
    : `${count} ${n === 1 ? 'step' : 'steps'} from the ${data.nicheName} checklist.`;
  return (
    <section className="mt-8 rounded-lg border border-b1 bg-s0 p-5" data-next-steps={niche}>
      <h3 className="text-lg font-semibold text-white mb-1">What to do now</h3>
      <p className="text-xs text-t3 mb-4">{lead}</p>
      <ol className="space-y-3">
        {data.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-white/10 text-white text-xs flex items-center justify-center">{i + 1}</span>
            <div>
              <div className="text-sm text-white">{s.task}</div>
              {s.why && <div className="text-xs text-t2 mt-0.5">{s.why}</div>}
            </div>
          </li>
        ))}
      </ol>
      <Link href={data.checklistHref} onClick={() => track('next_step_click', { tool: engine, niche, target: 'checklist' })} className="inline-block mt-4 text-sm text-white underline hover:no-underline">
        {data.fromTips ? `More on ${data.nicheName} →` : `Full checklist: ${data.checklistTitle} →`}
      </Link>
    </section>
  );
}
