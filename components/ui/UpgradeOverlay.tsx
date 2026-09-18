'use client';

/**
 * The gate overlay (components/useUpgradeGate.tsx): a focused interstitial
 * that appears when a visitor attempts one of the few actions the Pro tools
 * site restricts (owner, 2026-09-18 — see lib/card-copy.ts GATE_COPY for
 * which actions and why). Everything else on these tools stays fully free
 * and immediate; this only ever sits in front of a secondary action.
 *
 * The panel's content reuses the exact classes ResultCard.tsx's Pro band
 * uses (.rc-rows, .rc-row, .rc-row.pro, .rc-proof, .rc-foot) — same look as
 * every other Pro ask on the site. Only the modal chrome itself (.ug-*) is
 * new: a backdrop, a centered panel, and a close control.
 *
 * The CTA inside is the real UpgradeButtons component, unmodified — a tap
 * on it is a genuine anchor click, so components/InAppBridge.tsx's
 * document-level listener intercepts it exactly as it does the inline ask,
 * and hands off to the app's native upgrade screen when running in-app. No
 * app-side change is needed: this overlay only changes *when* the ask
 * appears, never *how* it resolves.
 */
import { useEffect, useId, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { UpgradeButtons } from '@/components/UpgradeButtons';
import { PLAY_PROOF, DATA_SAFETY_URL, type Benefit, type GateAction } from '@/lib/card-copy';
import { PRO_FOOTNOTE } from '@/lib/tiers';
import { track } from '@/lib/track';

export interface UpgradeOverlayProps {
  open: boolean;
  onClose: () => void;
  /** The element to return focus to when the overlay closes. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  engine: string;
  niche?: string;
  /** Which restricted action this gate is (lib/card-copy.ts GATE_COPY), for analytics. */
  gate: GateAction;
  benefit: Benefit;
  headline: string;
  stake: string;
  free: string;
  pro: string;
  button: string;
  term?: string;
}

export function UpgradeOverlay({ open, onClose, returnFocusTo, engine, niche, gate, benefit, headline, stake, free, pro, button, term }: UpgradeOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    track('gate_shown', { tool: engine, benefit, gate });
    const previouslyFocused = returnFocusTo?.current ?? (document.activeElement as HTMLElement | null);
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const handleClose = () => {
    track('gate_dismissed', { tool: engine, benefit, gate });
    onClose();
  };

  return createPortal(
    <div className="ug-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div ref={panelRef} className="ug-panel" role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={bodyId} data-upgrade-gate={gate}>
        <button type="button" ref={closeRef} className="ug-close" onClick={handleClose} aria-label="Close">×</button>
        <h2 id={headingId} className="ug-headline">{headline}</h2>
        <p id={bodyId} className="ug-body">{stake}</p>
        <dl className="rc-rows rc-rows-free">
          <div className="rc-row">
            <dt>Free</dt>
            <dd>{free}</dd>
          </div>
        </dl>
        <dl className="rc-rows">
          <div className="rc-row pro">
            <dt>Incognito Pro</dt>
            <dd>{pro}</dd>
          </div>
        </dl>
        <UpgradeButtons
          engine={engine}
          niche={niche}
          from="gate"
          benefit={benefit}
          term={term}
          label={button}
          onClick={(target) => track('gate_click', { tool: engine, target, benefit, gate })}
        />
        <p className="rc-proof mt-3">
          {PLAY_PROOF}
          <span className="rc-proof-more"> · <a href={DATA_SAFETY_URL} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-t1">Data safety</a></span>
        </p>
        <p className="rc-foot">{PRO_FOOTNOTE}</p>
      </div>
    </div>,
    document.body,
  );
}
