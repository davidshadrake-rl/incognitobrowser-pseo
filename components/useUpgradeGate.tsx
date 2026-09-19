'use client';

/**
 * Wraps an existing handler so a Pro subscriber runs it untouched, and
 * everyone else sees the upgrade overlay first (components/ui/UpgradeOverlay.tsx).
 *
 * The Pro check itself is `shouldGate()`, a tiny pure function kept separate
 * from React state so it can be unit-tested by stubbing `document` the same
 * way tests/in-app.test.ts already does, without needing to render a hook
 * (this repo has no DOM test environment or React testing library).
 */
import { useCallback, useRef, useState } from 'react';
import { UpgradeOverlay, type UpgradeOverlayProps } from '@/components/ui/UpgradeOverlay';
import { inAppPro } from '@/lib/in-app';

/**
 * True when this visitor should see the gate: false only for a confirmed Pro
 * subscriber.
 *
 * "Confirmed" is load-bearing and lives in lib/in-app.ts. Until 2026-09-18 the
 * mark this reads, <html data-ib-pro>, was set by `?inapp=1&pro=1` in the URL
 * with nothing else checked, so any link opened all three gates — and hid
 * every upgrade band with it (app/globals.css) — for the rest of the tab. The
 * boot script now sets that mark only when the app's own bridge object or its
 * user agent backs the claim up. The check stays a single attribute read here
 * on purpose: the CSS that hides the bands keys off the same attribute, and a
 * second, different rule in JavaScript is how the two drift apart.
 */
export function shouldGate(): boolean {
  return !inAppPro();
}

export type UpgradeGateContext = Omit<UpgradeOverlayProps, 'open' | 'onClose' | 'returnFocusTo'>;

export function useUpgradeGate(ctx: UpgradeGateContext) {
  const [open, setOpen] = useState(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  /** Wrap a handler: a confirmed Pro subscriber runs it immediately; everyone else sees the ask first. */
  const guard = useCallback(
    <A extends unknown[]>(action: (...a: A) => void) =>
      (...a: A) => {
        if (!shouldGate()) { action(...a); return; }
        returnFocusTo.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      },
    [],
  );

  const overlay = (
    <UpgradeOverlay {...ctx} open={open} onClose={() => setOpen(false)} returnFocusTo={returnFocusTo} />
  );

  return { guard, overlay };
}
