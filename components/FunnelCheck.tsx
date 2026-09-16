'use client';

/**
 * The live part of a v2 funnel (lib/funnels.ts): the check, and the answer to
 * the visitor's own result.
 *
 * Nothing loads until the visitor asks: the button mounts one engine from
 * components/tools/engine-loaders.tsx inside its own ResultProvider, and
 * FunnelAnswer waits for that engine to report. Only the result the visitor
 * actually got is answered — the v1 funnels printed all three colours up
 * front, which read as a legend, not as anything about them.
 *
 * Counted per page (lib/track.ts): funnel_view when the funnel scrolls into
 * view, funnel_run when the check starts, result_shown with the page, and
 * funnel_click on the upgrade buttons.
 */
import { useEffect, useRef, useState } from 'react';
import { ResultProvider, useToolResult } from '@/components/tools/ResultContext';
import { ENGINE_LOADERS } from '@/components/tools/engine-loaders';
import { UpgradeButtons } from '@/components/UpgradeButtons';
import { track } from '@/lib/track';
import { PRO_FOOTNOTE } from '@/lib/tiers';
import type { FunnelSeverity, PageFunnelV2 } from '@/lib/funnels';

const TONE: Record<FunnelSeverity, string> = {
  red: 'border-t-danger',
  amber: 'border-t-warn',
  green: 'border-t-ok',
  info: 'border-t-b2',
};

/** The words for one result and the ask that follows them. */
export function FunnelOutcome({ funnel, severity }: { funnel: PageFunnelV2; severity: FunnelSeverity }) {
  const copy = funnel.results[severity];
  if (!copy) return null;
  const { engine } = funnel.check;
  const topic = funnel.topic ?? undefined;
  return (
    <div className={`mt-5 border-t-2 ${TONE[severity]} pt-4`} data-funnel-result={severity} role="status" aria-live="polite">
      <p className="text-t1 font-medium">{copy.meaning}</p>
      {/* ib-upgrade: hidden inside the app for someone who already has Pro (lib/in-app.ts); the meaning above stays. */}
      <div className="ib-upgrade">
        <p className="mt-2 text-sm text-t2">{copy.pro}</p>
        <div className="mt-4">
          <UpgradeButtons
            engine={engine}
            niche={topic}
            severity={severity}
            from="funnel"
            content={topic || funnel.type}
            term={funnel.type}
            label={copy.button}
            onClick={(target) => track('funnel_click', { tool: engine, severity, target, page: funnel.path })}
          />
        </div>
        <p className="text-meta text-t3 mt-3">{PRO_FOOTNOTE}</p>
      </div>
    </div>
  );
}

/** Answers whatever the engine inside the nearest ResultProvider reports. */
export function FunnelAnswer({ funnel }: { funnel: PageFunnelV2 }) {
  const result = useToolResult();
  const severity = result?.severity;
  useEffect(() => {
    if (severity) track('result_shown', { tool: funnel.check.engine, severity, page: funnel.path }, { once: true });
  }, [severity, funnel.check.engine, funnel.path]);
  if (!severity) return null;
  return <FunnelOutcome funnel={funnel} severity={severity} />;
}

/** The check itself: a button that loads it in place, or a link to its own page. */
export function FunnelCheck({ funnel }: { funnel: PageFunnelV2 }) {
  const { engine, button, mode, href } = funnel.check;
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        track('funnel_view', { tool: engine, page: funnel.path }, { once: true });
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [engine, funnel.path]);

  const Engine = ENGINE_LOADERS[engine];

  if (mode === 'link' || !Engine) {
    if (!href) return <div ref={ref} />;
    return (
      <div ref={ref}>
        <a
          href={href}
          onClick={() => track('funnel_run', { tool: engine, target: 'check-yours', page: funnel.path })}
          className="btn-primary text-sm !px-5 !py-2.5 mt-4 inline-block"
        >
          {`${button} →`}
        </a>
      </div>
    );
  }

  return (
    <div ref={ref}>
      {running ? (
        <ResultProvider>
          <div className="mt-4 rounded-[12px] border border-b1 bg-black p-3 sm:p-4" data-funnel-engine={engine}>
            <Engine />
          </div>
          <FunnelAnswer funnel={funnel} />
        </ResultProvider>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRunning(true);
            track('funnel_run', { tool: engine, page: funnel.path });
            track('tool_run', { tool: engine });
          }}
          className="btn-primary text-sm !px-5 !py-2.5 mt-4"
        >
          {button}
        </button>
      )}
    </div>
  );
}
