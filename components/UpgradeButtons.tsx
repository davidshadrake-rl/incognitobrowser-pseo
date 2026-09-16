'use client';

/**
 * The upgrade buttons, one set of rules wherever the ask appears: a tool's
 * result (components/ResultCta.tsx) and every page's funnel
 * (components/FunnelCheck.tsx).
 *
 *   Android, or inside the Incognito Browser app: one button to Google Play.
 *   Inside the app, components/InAppBridge.tsx reads the data-upgrade-*
 *   attributes and opens the app's own upgrade screen with that context.
 *
 *   Desktop and iPhone: Incognito Pro is an Android app, so nobody here can
 *   subscribe on the spot. The buttons hand the link over instead: open Play
 *   (it can install to a phone), email it to yourself, or copy it.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Severity } from '@/components/tools/ResultContext';
import { IN_APP_COPY } from '@/lib/cta-copy';
import { playUrl } from '@/lib/play';
import { handoffMailBody, handoffMailto } from '@/lib/handoff';
import { detectPlatform, isInsideIncognitoApp, type Platform } from '@/lib/track';

export type UpgradeTarget = 'play' | 'email' | 'copy';

interface Props {
  engine: string;
  niche?: string;
  severity?: Severity;
  /** Where the ask sits. The app's upgrade screen and the Play referrer both get it. */
  from: 'result' | 'funnel';
  /** Play referrer content, e.g. the niche or "grade-D". */
  content?: string;
  /** Play referrer term: the page type. */
  term?: string;
  /** The page URL to put in the emailed hand-off. */
  pageUrl?: string;
  /**
   * The button's words. Omitted, it is the generic ask ("Get the app, then
   * upgrade to Pro", "Get Incognito Browser for Android"); a funnel passes the
   * words its page was written with.
   */
  label?: string;
  onClick?: (target: UpgradeTarget) => void;
  /** Anything that belongs on the same row after the buttons. */
  children?: ReactNode;
}

const noSubscribe = () => () => {};
const serverPlatform = (): Platform => 'other';
const serverInApp = () => false;

export function UpgradeButtons({ engine, niche, severity, from, content, term, pageUrl, label, onClick, children }: Props) {
  const platform = useSyncExternalStore(noSubscribe, () => detectPlatform(), serverPlatform);
  const inApp = useSyncExternalStore(noSubscribe, () => isInsideIncognitoApp(), serverInApp);
  const [copied, setCopied] = useState(false);
  const [mailFallback, setMailFallback] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);

  const play = playUrl({ medium: from === 'funnel' ? 'funnel' : 'cta', campaign: engine, content: content || niche, term });
  const pageHref = pageUrl || (typeof window !== 'undefined' ? window.location.href : '');
  // See lib/handoff.ts: CRLF body (RFC 6068 — bare "\n" breaks Outlook on Windows), hash stripped.
  const mailBody = handoffMailBody(play, pageHref);
  const mailto = handoffMailto(play, pageHref);

  const copyLink = async () => {
    onClick?.('copy');
    try { await navigator.clipboard.writeText(play); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };
  const copyMessage = async () => {
    try { await navigator.clipboard.writeText(mailBody); setMsgCopied(true); setTimeout(() => setMsgCopied(false), 2000); } catch { /* insecure context: the textarea below is selectable instead */ }
  };
  // A mailto: link gives the page no success signal. If no mail handler is
  // registered (the norm on Windows for people who use Gmail in a browser),
  // nothing happens at all. A registered handler always takes focus (a
  // desktop app) or opens a tab (webmail), so the page blurs or is hidden;
  // if neither happens within 1.5 s, reveal the message to copy. The native
  // navigation is not prevented, so nothing changes when it works.
  const emailClick = () => {
    onClick?.('email');
    let left = false;
    const onLeave = () => { left = true; };
    window.addEventListener('blur', onLeave, { once: true });
    document.addEventListener('visibilitychange', onLeave, { once: true });
    window.setTimeout(() => {
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onLeave);
      if (!left && document.hasFocus()) setMailFallback(true);
    }, 1500);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {inApp || platform === 'android' ? (
          <a
            href={play}
            rel="noopener"
            onClick={() => onClick?.('play')}
            data-upgrade-from={from}
            data-upgrade-topic={niche}
            data-upgrade-result={severity}
            data-upgrade-tool={engine}
            className="btn-pro text-sm !px-5 !py-2.5"
          >
            {label ?? (inApp ? IN_APP_COPY.button : 'Get the app, then upgrade to Pro')}
          </a>
        ) : (
          <>
            <a href={play} rel="noopener" onClick={() => onClick?.('play')} className="btn-primary text-sm !px-5 !py-2.5">
              {label ?? 'Get Incognito Browser for Android'}
            </a>
            <a href={mailto} onClick={emailClick} className="btn-ghost text-sm !px-4 !py-2">Email me the link</a>
            {/* Copies the Google Play link, not this page: say so. */}
            <button type="button" onClick={copyLink} className="btn-ghost text-sm !px-4 !py-2">{copied ? 'App link copied' : 'Copy app link'}</button>
          </>
        )}
        {children}
      </div>
      {mailFallback && (
        <div className="mt-3 rounded border border-b1 bg-black/30 p-3" role="status" aria-live="polite" data-mail-fallback>
          <p className="text-xs text-t2 mb-2">No email app opened on this device. Copy the message and send it from your email instead:</p>
          <textarea readOnly value={mailBody} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Message to send yourself" className="w-full text-xs font-mono bg-s0 border border-b1 rounded p-2 text-t2" />
          <button type="button" onClick={copyMessage} className="btn-ghost mt-2 text-xs !px-3 !py-1.5 !min-h-0">{msgCopied ? 'Copied' : 'Copy message'}</button>
        </div>
      )}
    </>
  );
}
