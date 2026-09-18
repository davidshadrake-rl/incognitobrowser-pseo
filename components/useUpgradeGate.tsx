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

/** True when this visitor should see the gate: false only for a confirmed Pro subscriber. */
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
