'use client';

/**
 * The result card: the answer and the ask, together, at the top of a result
 * (owner rules, 2026-09-16).
 *
 *   1. The result: the one number, the headline, what it means.
 *   2. The Pro band: the free fix if there is one, what Incognito Pro does
 *      about this result (only data/brand.json `pro` outcomes), one button,
 *      Google Play proof and the subscription footnote.
 *   3. Share your result.
 * The tool's long report follows the card (ConsoleFrame's "Full report").
 *
 * The upgrade button is on screen when the result appears: after the
 * visitor's own action the card brings itself into view by the shortest
 * scroll (lib/place-result.ts), unless they have scrolled away since.
 * Pages that show a result on load (report cards, What's My IP) are laid out
 * so it is already there.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useResultAsk, useToolResult, type Severity, type ToolResult } from '@/components/tools/ResultContext';
import { UpgradeButtons } from '@/components/UpgradeButtons';
import { Scorecard } from '@/components/Scorecard';
import { resolveCardCopy, PLAY_PROOF, type CardCopy } from '@/lib/card-copy';
import { placeResultCard, type PlaceReason } from '@/lib/place-result';
import { scorecardFigure, VALUE_ONLY_ENGINES } from '@/lib/scorecard';
import { PRO_FOOTNOTE } from '@/lib/tiers';
import { track } from '@/lib/track';

/** A result known when the page is built (a report card's grade). */
export interface StaticCard {
  engine: string;
  niche?: string;
  severity: Severity;
  figure: string;
  headline: string;
  /** Extra lines under the headline (a report card's scan summary). */
  detail?: ReactNode;
  /** Lines after the ask (a report card's scan date and "How we grade"): kept below the button so it fits on a small phone. */
  after?: ReactNode;
  copy: CardCopy;
  /** The funnel page the words were written for, for counting. */
  page?: string;
  /** Share image. */
  share: { title: string; headline: string; stats: Array<{ label: string; value: string }>; url?: string };
  term?: string;
}

/** Wait until the visitor stops typing: 800 ms idle, Enter or blur (blur only while an on-screen keyboard is up). */
function afterTyping(field: HTMLElement, done: () => void): () => void {
  let timer = 0;
  const keyboardUp = () => !!window.visualViewport && window.visualViewport.height < 0.8 * window.innerHeight;
  const finish = () => { cleanup(); done(); };
  const idle = () => { window.clearTimeout(timer); if (!keyboardUp()) timer = window.setTimeout(finish, 800); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter') finish(); };
  const cleanup = () => {
    window.clearTimeout(timer);
    field.removeEventListener('input', idle);
    field.removeEventListener('keydown', key);
    field.removeEventListener('blur', finish);
  };
  field.addEventListener('input', idle);
  field.addEventListener('keydown', key);
  field.addEventListener('blur', finish);
  idle();
  return cleanup;
}

export function ResultCard({ result: shown, staticCard }: { result?: ToolResult | null; staticCard?: StaticCard }) {
  const bus = useToolResult();
  const askState = useResultAsk();
  const cardRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlaceReason | null>(null);

  const result = shown ?? bus;
  const engine = staticCard?.engine ?? askState?.ask?.engine ?? '';
  const severity: Severity | null = staticCard?.severity ?? result?.severity ?? null;
  const runId = askState?.run?.id ?? 0;
  // The ask needs the visitor's own result (an example reports none) and a page to sell from.
  const live = !!staticCard || (!!bus && !!askState?.ask && !VALUE_ONLY_ENGINES.has(engine));
  const pending = !staticCard && !!askState?.pending;
  const copy: CardCopy | null = staticCard?.copy ?? (severity && live ? resolveCardCopy(engine, severity, askState?.answer ?? null) : null);
  const page = staticCard?.page ?? askState?.answer?.path;

  // Bring the card on screen once per run, after the right words are in.
  useEffect(() => {
    const card = cardRef.current;
    const run = askState?.run;
    if (staticCard || !card || !live || pending || !run || !severity) return;
    if (!run.byVisitor) {
      setPlaced('on-load');
      return;
    }
    if (!askState.claimPlacement(run.id)) return;
    let cancelled = false;
    let stopTyping: (() => void) | null = null;
    const place = () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        void (document.fonts?.ready ?? Promise.resolve()).then(() => {
          if (cancelled) return;
          const { reason } = askState.scrolledAway() ? { reason: 'own-scroll' as const } : placeResultCard(card, run.typingField);
          const settle = () => { if (!cancelled) setPlaced(reason); };
          if (reason === 'scrolled' && 'onscrollend' in window) {
            const t = window.setTimeout(settle, 1000);
            window.addEventListener('scrollend', () => { window.clearTimeout(t); settle(); }, { once: true });
          } else if (reason === 'scrolled') {
            window.setTimeout(settle, 600);
          } else {
            settle();
          }
          track('result_card_placed', { tool: engine, severity, reason, page }, { once: true });
        });
      }));
    };
    if (run.typingField) stopTyping = afterTyping(run.typingField, place);
    else place();
    return () => { cancelled = true; stopTyping?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, live, pending, !!severity]);

  // A report card counts its own view: the grade is a result the visitor didn't ask for.
  useEffect(() => {
    if (staticCard) track('report_card_view', { tool: 'report-card', niche: staticCard.niche, severity: staticCard.severity }, { once: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A view counts only when the button is fully on screen.
  useEffect(() => {
    const button = cardRef.current?.querySelector('[data-result-cta] .btn-pro');
    if (!button || !live || pending || !severity || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.intersectionRatio >= 1)) {
        track('cta_view', { tool: engine, severity, page, benefit: copy?.benefit }, { once: true });
        io.disconnect();
      }
    }, { threshold: 1 });
    io.observe(button);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, live, pending, severity, copy?.benefit]);

  if (!severity || (!result && !staticCard)) return null;
  const figure = staticCard?.figure ?? (result ? scorecardFigure(engine, result) : '');
  const headline = staticCard?.headline ?? result?.headline ?? '';
  const share = staticCard?.share ?? (bus && askState?.ask && figure
    ? { title: askState.ask.title, headline: bus.shareText || bus.headline, stats: bus.stats ?? [], url: undefined }
    : null);

  return (
    <div
      ref={cardRef}
      className="rc"
      data-tone={severity}
      data-result-card={engine}
      data-result-placed={staticCard ? 'on-load' : placed ?? undefined}
    >
      <div className="rc-result" role="status" aria-live="polite">
        {figure && <p className="rc-figure" data-long={figure.length > 10 || undefined}>{figure}</p>}
        <div className="min-w-0">
          <h2 className="rc-headline">{headline}</h2>
          {copy && !pending && <p className="rc-meaning">{copy.meaning}</p>}
          {staticCard?.detail}
        </div>
      </div>

      {copy && (
        // ib-upgrade: hidden inside the app for someone who already has Pro (lib/in-app.ts); the result above stays.
        <div className="rc-pro ib-upgrade" data-result-cta={severity} data-benefit={copy.benefit} style={pending ? { visibility: 'hidden' } : undefined}>
          <dl className="rc-rows">
            {copy.free && (
              <div className="rc-row">
                <dt>Free</dt>
                <dd>{copy.free}</dd>
              </div>
            )}
            <div className="rc-row pro">
              <dt>Incognito Pro</dt>
              <dd>{copy.pro}</dd>
            </div>
          </dl>
          <UpgradeButtons
            engine={engine}
            niche={staticCard?.niche ?? askState?.ask?.niche}
            severity={severity}
            from={staticCard ? 'report-card' : page ? 'funnel' : 'result'}
            term={staticCard?.term ?? (askState?.answer?.type || 'tool')}
            label={copy.button}
            benefit={copy.benefit}
            pageUrl={staticCard?.share.url}
            onClick={(target) => track('cta_click', { tool: engine, severity, target, page, benefit: copy.benefit })}
          />
          {/* The data-safety clause drops on the narrowest phones so the button and footnote still fit. */}
          <p className="rc-proof">{PLAY_PROOF.replace(/ · [^·]*$/, '')}<span className="rc-proof-more">{PLAY_PROOF.match(/ · [^·]*$/)?.[0]}</span></p>
          <p className="rc-foot">{PRO_FOOTNOTE}</p>
        </div>
      )}

      {staticCard?.after && <div className="rc-after">{staticCard.after}</div>}

      {share && (
        <Scorecard
          variant="row"
          engine={engine}
          niche={staticCard?.niche ?? askState?.ask?.niche}
          title={share.title}
          figure={figure}
          headline={share.headline}
          stats={share.stats}
          tone={severity}
          url={share.url}
        />
      )}
    </div>
  );
}
