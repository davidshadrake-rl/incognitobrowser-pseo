'use client';

/**
 * The next step at a calculator's result (owner, 2026-09-16).
 *
 * A calculator's result is a free resource result too, but its visitors are
 * mostly site owners checking compliance, which Pro doesn't do. So there is
 * no upgrade box here: once the result is the visitor's own, the way into
 * the matching check is on screen, on the words the page already uses for it.
 *
 *   result  one line and a button at the top of "Your result"; on a laptop
 *           that column stays under the site header (CalculatorPage)
 *   bar     a slim bar at the bottom of the calculator with the main figure
 *           and the button, while the result's own button is off screen: on
 *           a phone, the result is below the settings being changed; on a
 *           laptop, only at the calculator's top and bottom edges
 */
import type { Ref } from 'react';
import Link from 'next/link';
import { isV2, type PageFunnel } from '@/lib/funnel-types';
import type { ProofRoute } from '@/lib/proof-route';
import { track } from '@/lib/track';

export interface NextStep {
  engine: string;
  button: string;
  /** The funnel's own link, ?from= included, or the proof route's. */
  href: string;
  /** The funnel page the click is counted against; none for a proof route. */
  page?: string;
}

/**
 * Where the page already sends its visitors: the funnel's check, linked as
 * PageFunnel links it, or the proof route where the page has no funnel. A
 * page with a funnel but no link shows no card above the calculator, and no
 * next step either.
 */
export function nextStepOf(funnel: PageFunnel | null | undefined, proofRoute: ProofRoute | null | undefined): NextStep | null {
  if (funnel) {
    if (isV2(funnel)) {
      const { mode, engine, button, href } = funnel.check;
      return mode === 'page' || mode === 'card' || !href ? null : { engine, button, href, page: funnel.path };
    }
    const { engine, button, href } = funnel.step2;
    return href ? { engine, button, href, page: funnel.path } : null;
  }
  return proofRoute ? { engine: proofRoute.engine, button: proofRoute.button, href: proofRoute.href } : null;
}

/** The one line above the button: the result stands on the visitor's answers, and some can be checked. */
export const NEXT_STEP_LINE = 'Your answers decide this result. Check one for yourself.';

function NextStepLink({ step, where, className, linkRef }: { step: NextStep; where: 'column' | 'bar'; className: string; linkRef?: Ref<HTMLAnchorElement> }) {
  return (
    // next/link adds the base path, as in ToolEntryCard.
    <Link
      ref={linkRef}
      href={step.href}
      onClick={() => track('funnel_run', { tool: step.engine, target: 'check-yours', page: step.page })}
      className={className}
      data-next-step={where}
    >
      {/* No break before the arrow: alone on a line of its own it read as a stray mark. */}
      {`${step.button}\u00a0→`}
    </Link>
  );
}

/** At the top of "Your result": the line and the button. */
export function NextStepBlock({ step, linkRef }: { step: NextStep; linkRef?: Ref<HTMLAnchorElement> }) {
  return (
    <div className="mt-3 pb-4 border-b border-b1">
      <p className="text-row text-t2">{NEXT_STEP_LINE}</p>
      <NextStepLink step={step} where="column" linkRef={linkRef} className="btn-primary !text-sm w-full mt-3 text-center" />
    </div>
  );
}

/**
 * The bar: sticky at the bottom of the calculator, so it never shows outside
 * it, and under the result column on a laptop. It keeps its space while
 * hidden, so showing it moves nothing.
 */
export function NextStepBar({ step, label, value, valueClass, hidden }: { step: NextStep; label: string; value: string; valueClass: string; hidden: boolean }) {
  return (
    <div
      className={`sticky bottom-0 z-40 pt-3 pb-3 pointer-events-none lg:ml-[calc(50%+1rem)] transition-[opacity,visibility] duration-150 motion-reduce:transition-none ${hidden ? 'invisible opacity-0' : 'opacity-100'}`}
      data-next-step-bar={hidden ? 'hidden' : 'shown'}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-[12px] border border-b2 bg-s0 p-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.6)]">
        <div className="min-w-0 flex-1 pl-1">
          <div className="text-meta text-t3 truncate">{label}</div>
          <div className={`text-lg font-bold tnum leading-tight ${valueClass}`}>{value}</div>
        </div>
        <NextStepLink step={step} where="bar" className="btn-primary !text-[13px] !min-h-10 !px-3 !py-1.5 shrink-0 max-w-[66%] text-center" />
      </div>
    </div>
  );
}
