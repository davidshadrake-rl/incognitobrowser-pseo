/**
 * The per-page Pro funnel (lib/funnels.ts).
 *
 * v2 records: the page's problem and what it means for the visitor are plain
 * HTML (so they're crawlable and read without JavaScript), and the check plus
 * the answer to the visitor's own result are components/FunnelCheck.tsx. A
 * report card's result is its grade, known when the page is built, so its
 * answer renders straight away. On a tool page the page itself is the check:
 * the answer sits inside the tool (app/tools/[niche]/[slug]/client.tsx) and
 * nothing renders here.
 *
 * v1 records render exactly as they did on 2026-09-14 until they're rewritten.
 *
 * The upgrade link is the Play listing, with the data-upgrade-* attributes
 * components/InAppBridge.tsx watches: inside the Incognito Browser app that tap
 * opens the app's own upgrade screen with this page's context instead
 * (IN-APP-BRIDGE.md).
 */
import Link from 'next/link';
import { playUrl } from '@/lib/play';
import { FunnelCheck, FunnelOutcome } from '@/components/FunnelCheck';
import { isV2, type FunnelSeverity, type PageFunnel as Funnel, type PageFunnelV1, type PageFunnelV2 } from '@/lib/funnels';

export function PageFunnel({ funnel, niche, cardSeverity }: { funnel: Funnel; niche?: string; cardSeverity?: FunnelSeverity }) {
  return isV2(funnel) ? <PageFunnelV2View funnel={funnel} cardSeverity={cardSeverity} /> : <PageFunnelV1View funnel={funnel} niche={niche} />;
}

function PageFunnelV2View({ funnel, cardSeverity }: { funnel: PageFunnelV2; cardSeverity?: FunnelSeverity }) {
  const { mode, engine } = funnel.check;
  if (mode === 'page') return null;
  return (
    <section
      className="my-10 rounded-[16px] border border-b1 bg-white/[0.03] p-5 sm:p-6"
      data-page-funnel={engine}
      data-funnel-v="2"
      aria-labelledby="page-funnel-heading"
    >
      <p className="text-xs uppercase tracking-wider text-t3">{funnel.step1.label}</p>
      <blockquote className="mt-2 text-t2 text-row border-l-2 border-b1 pl-3">{funnel.step1.quote}</blockquote>
      <h3 id="page-funnel-heading" className="mt-4 text-white text-row font-semibold">{funnel.stakes}</h3>
      {mode === 'card'
        ? cardSeverity && <FunnelOutcome funnel={funnel} severity={cardSeverity} />
        : <FunnelCheck funnel={funnel} />}
    </section>
  );
}

function PageFunnelV1View({ funnel, niche }: { funnel: PageFunnelV1; niche?: string }) {
  const topic = funnel.topic || niche || '';
  const play = playUrl({ medium: 'funnel', campaign: funnel.step2.engine, content: topic || funnel.type });

  return (
    <section
      className="my-10 rounded-[16px] border border-b1 bg-white/[0.03] p-5 sm:p-6"
      data-page-funnel={funnel.step2.engine}
      aria-labelledby="page-funnel-heading"
    >
      {/* 1 — the page's own problem, in the page's own words. */}
      <p className="text-xs uppercase tracking-wider text-t3">{funnel.step1.label}</p>
      <blockquote id="page-funnel-heading" className="mt-2 text-white text-row font-medium border-l-2 border-b1 pl-3">
        {funnel.step1.quote}
      </blockquote>

      {/* 2 — the free check that settles it. */}
      <h3 className="mt-5 text-white font-semibold">{funnel.step2.heading}</h3>
      <p className="mt-1 text-sm text-t2">{funnel.step2.instruction}</p>
      {funnel.step2.href ? (
        <Link href={funnel.step2.href} className="btn-primary text-sm !px-5 !py-2.5 mt-3 inline-block">
          {`${funnel.step2.button} →`}
        </Link>
      ) : (
        // A report card is its own check: the grade above IS the result.
        <p className="mt-3 text-sm text-t3">{funnel.step2.button}</p>
      )}

      {/* 3 — what the result will mean, on this page's subject. */}
      <dl className="mt-5 space-y-2 text-sm">
        {([
          ['Red', 'text-danger', funnel.step3.red],
          ['Amber', 'text-warn', funnel.step3.amber],
          ['Green', 'text-ok', funnel.step3.green],
        ] as const).map(([label, tone, text]) => (
          <div key={label} className="flex gap-3">
            <dt className={`${tone} shrink-0 w-14 font-medium`}>{label}</dt>
            <dd className="text-t2">{text}</dd>
          </div>
        ))}
      </dl>

      {/* 4 and 5 — what Pro does about it here, and the way to it. */}
      <p className="mt-5 text-sm text-t2">{funnel.step4.line}</p>
      <a
        href={play}
        rel="noopener"
        data-upgrade-from="funnel"
        data-upgrade-topic={topic}
        data-upgrade-tool={funnel.step2.engine}
        className="btn-pro text-sm !px-5 !py-2.5 mt-3 inline-block ib-upgrade"
      >
        {funnel.step5.label}
      </a>
    </section>
  );
}
