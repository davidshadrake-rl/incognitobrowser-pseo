'use client';

/**
 * Inside the Incognito Browser app (lib/in-app.ts), one listener for the
 * whole site:
 *  - an upgrade tap (any Google Play link to our app, or a link marked
 *    data-upgrade) opens the app's own upgrade screen instead of the Play
 *    listing of an app the visitor is already using;
 *  - a link to our other deployment (free ↔ Pro) carries ?inapp=1 across,
 *    because the flag lives in sessionStorage, which is per origin.
 * On the open web it does nothing. Renders nothing.
 *
 * The tap's context comes from the link: data-upgrade-from (header, home,
 * result…), data-upgrade-topic, data-upgrade-result, data-upgrade-tool.
 */
import { useEffect } from 'react';
import { inAppPro, inAppSource, openAppUpgrade } from '@/lib/in-app';
import { PLAY_PACKAGE } from '@/lib/play';
import { FREE_BASE_URL, PRO_BASE_URL } from '@/lib/tiers';

function isUpgradeLink(a: HTMLAnchorElement): boolean {
  if (a.hasAttribute('data-upgrade')) return true;
  try {
    const u = new URL(a.href);
    return u.hostname === 'play.google.com' && u.searchParams.get('id') === PLAY_PACKAGE;
  } catch {
    return false;
  }
}

const SISTER_ORIGINS = new Set(
  [FREE_BASE_URL, PRO_BASE_URL].flatMap((b) => {
    try { return [new URL(b).origin]; } catch { return []; }
  }),
);

export function InAppBridge() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!inAppSource()) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement)) return;

      if (isUpgradeLink(a)) {
        const d = a.dataset;
        const handled = openAppUpgrade({
          from: d.upgradeFrom || 'link',
          topic: d.upgradeTopic || undefined,
          result: d.upgradeResult || undefined,
          tool: d.upgradeTool || undefined,
        });
        if (handled) e.preventDefault();
        return;
      }

      try {
        const u = new URL(a.href);
        if (u.origin === location.origin || !SISTER_ORIGINS.has(u.origin)) return;
        u.searchParams.set('inapp', '1');
        if (inAppPro()) u.searchParams.set('pro', '1');
        a.href = u.toString();
      } catch {
        /* leave the link as it is */
      }
    };
    // Capture: runs before the page's own handlers, so a prevented upgrade
    // tap never reaches the Play listing.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return null;
}
