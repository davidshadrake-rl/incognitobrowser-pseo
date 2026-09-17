/**
 * What a page shows of its funnel (lib/funnels.ts): only the path, never the
 * plan. Owner, 2026-09-16: visitors should see a way into the free tool and,
 * once they have a result, a Pro subscription CTA written for it — not labels,
 * the page quoted back at them, or every possible result listed up front.
 * The plan for each page lives in the internal funnel doc.
 *
 *   content pages   a plain card into the free tool page (ToolEntryCard); the
 *                   tool page answers the result for the page it came from
 *   report cards    nothing here: the grade is the result, and its answer is
 *                   the result card under the grade (app/site/[domain]/page.tsx)
 *   tool pages      nothing here: the answer is the result card at the top of
 *                   the result (components/tools/ResultCard.tsx)
 *
 * A page whose funnel isn't rewritten yet (v1) still gets the card; its tool
 * page answers with the tool's own CTA until it is.
 */
import { ToolEntryCard } from '@/components/ToolEntryCard';
import { isV2, type PageFunnel as Funnel } from '@/lib/funnel-types';

export function PageFunnel({ funnel }: { funnel: Funnel; niche?: string }) {
  if (funnel.type === 'tool' || funnel.type === 'pro-tool' || funnel.type === 'report-card') return null;

  if (isV2(funnel)) {
    const { mode, engine, button, href } = funnel.check;
    if (mode === 'page' || mode === 'card' || !href) return null;
    return <ToolEntryCard engine={engine} line={funnel.stakes} button={button} href={href} from={funnel.path} />;
  }

  if (!funnel.step2.href) return null;
  return <ToolEntryCard engine={funnel.step2.engine} line={funnel.step2.heading} button={funnel.step2.button} href={funnel.step2.href} from={funnel.path} />;
}
