/**
 * The five-step Pro funnel, rendered for one page (lib/funnels.ts).
 *
 * Server-rendered: every word is drafted and reviewed offline, so there is
 * nothing here to compute in the browser and no tool code to load. The check
 * itself opens on its own tool page, carrying this page's topic so the result
 * there speaks for the page the visitor came from.
 *
 * The upgrade link is the Play listing, with the data-upgrade-* attributes
 * components/InAppBridge.tsx watches: inside the Incognito Browser app that tap
 * opens the app's own upgrade screen with this page's context instead
 * (IN-APP-BRIDGE.md).
 */
import Link from 'next/link';
import { playUrl } from '@/lib/play';
import type { PageFunnel as Funnel } from '@/lib/funnels';

export function PageFunnel({ funnel, niche }: { funnel: Funnel; niche?: string }) {
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
