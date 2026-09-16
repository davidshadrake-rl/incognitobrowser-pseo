/**
 * What a page shows of its funnel (lib/funnels.ts): only the path, never the
 * plan. Owner, 2026-09-16: visitors should see a way into the free tool and,
 * once they have a result, a Pro subscription CTA written for it — not labels,
 * the page quoted back at them, or every possible result listed up front.
 * The plan for each page lives in the internal funnel doc.
 *
 *   content pages   a plain card into the free tool page (ToolEntryCard); the
 *                   tool page answers the result for the page it came from
 *   report cards    the grade is the result: its answer, under the grade
 *   tool pages      nothing here; the answer sits under "What to do now"
 *                   (components/FunnelSurfaces.tsx)
 *
 * A page whose funnel isn't rewritten yet (v1) still gets the card; its tool
 * page answers with the tool's own CTA until it is.
 */
import { ToolEntryCard } from '@/components/ToolEntryCard';
import { FunnelOutcome } from '@/components/FunnelCheck';
import { isV2, type FunnelSeverity, type PageFunnel as Funnel } from '@/lib/funnel-types';

export function PageFunnel({ funnel, cardSeverity }: { funnel: Funnel; niche?: string; cardSeverity?: FunnelSeverity }) {
  if (funnel.type === 'tool' || funnel.type === 'pro-tool') return null;

  if (isV2(funnel)) {
    const { mode, engine, button, href } = funnel.check;
    if (mode === 'page') return null;
    if (mode === 'card') {
      if (!cardSeverity || !funnel.results[cardSeverity]) return null;
      return (
        <section className="my-10 rounded-[16px] border border-b1 bg-white/[0.03] p-5 sm:p-6" data-page-funnel="report-card" data-funnel-v="2">
          <p className="text-white text-row">{funnel.stakes}</p>
          <FunnelOutcome funnel={funnel} severity={cardSeverity} />
        </section>
      );
    }
    if (!href) return null;
    return <ToolEntryCard engine={engine} line={funnel.stakes} button={button} href={href} from={funnel.path} />;
  }

  // A report card's own grade block (components/ReportCardFunnel.tsx) is its ask.
  if (funnel.type === 'report-card' || !funnel.step2.href) return null;
  return <ToolEntryCard engine={funnel.step2.engine} line={funnel.step2.heading} button={funnel.step2.button} href={funnel.step2.href} from={funnel.path} />;
}
