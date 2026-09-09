'use client';

/**
 * Result-moment CTA — the ask arrives when the visitor has just seen their
 * own exposure. Copy is composed from lib/cta-copy (engine × severity ×
 * niche). Two populations:
 *   A. web visitors — Android: straight to Play with an attributed referrer;
 *      desktop/iOS: hand-off (email the link to yourself, copy it) because
 *      Incognito Pro is an Android app and a desktop visitor cannot convert
 *      on the spot.
 *   B. people already inside the free Incognito Browser app — "Upgrade to Pro".
 * Optional secondary link to the Pro web app for tools that have one.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Severity } from '@/components/tools/ResultContext';
import { composeCta, IN_APP_COPY } from '@/lib/cta-copy';
import { playUrl } from '@/lib/play';
import { handoffMailBody, handoffMailto } from '@/lib/handoff';
import { detectPlatform, isInsideIncognitoApp, track, type Platform } from '@/lib/track';
import { PRO_FOOTNOTE, PRO_WEB_GATED } from '@/lib/tiers';
import { Icon } from '@/components/ui/Icon';
import { PhoneFrame } from '@/components/ui/PhoneFrame';

interface Props {
  engine: string;
  niche?: string;
  severity: Severity;
  /** The visitor's own number, shown above the ask so the CTA reads as an answer. */
  headline?: string;
  /** Where this tool's deeper version lives, if any (absolute URL). */
  proWebUrl?: string;
  /** The page URL to include in the hand-off message. */
  pageUrl?: string;
  /** Play referrer content, e.g. the niche or "grade-D". */
  content?: string;
  /** Page type for utm_term (tool | report-card). */
  term?: string;
}

/** DESIGN-SPEC 5.4: tone is now a 2px top border only, not a fill or side border. */
const TONE: Record<Severity, string> = {
  red: 'border-t-danger',
  amber: 'border-t-warn',
  green: 'border-t-ok',
  info: 'border-t-b2',
};

export function ResultCta({ engine, niche, severity, headline, proWebUrl, pageUrl, content, term = 'tool' }: Props) {
  const [platform, setPlatform] = useState<Platform>('other');
  const [inApp, setInApp] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setPlatform(detectPlatform());
    setInApp(isInsideIncognitoApp());
    track('cta_view', { tool: engine, niche, severity }, { once: true });
  }, [engine, niche, severity]);

  const copy = useMemo(() => composeCta(engine, niche, severity), [engine, niche, severity]);
  const play = playUrl({ medium: 'cta', campaign: engine, content: content || niche, term });
  const pageHref = pageUrl || (typeof window !== 'undefined' ? window.location.href : '');
  // See lib/handoff.ts: CRLF body (RFC 6068 — bare "\n" breaks Outlook on Windows), hash stripped.
  const mailBody = handoffMailBody(play, pageHref);
  const mailto = handoffMailto(play, pageHref);
  const [mailFallback, setMailFallback] = useState(false);
  const [msgCopied, setMsgCopied] = useState(false);

  const click = (target: 'play' | 'pro-web' | 'email' | 'copy') => track('cta_click', { tool: engine, niche, severity, target });
  const copyLink = async () => {
    click('copy');
    try { await navigator.clipboard.writeText(play); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };
  const copyMessage = async () => {
    try { await navigator.clipboard.writeText(mailBody); setMsgCopied(true); setTimeout(() => setMsgCopied(false), 2000); } catch { /* insecure context: the textarea below is selectable instead */ }
  };
  // A mailto: link gives the page no success signal. If no mail handler is
  // registered (the norm on Windows for people who use Gmail in a browser),
  // nothing happens at all — the second reason "Email me the link" appeared
  // dead on a colleague's Windows machine. A registered handler always takes
  // focus (a desktop app) or opens a tab (webmail), so the page blurs or is
  // hidden; if neither happens within 1.5 s, reveal the message to copy.
  // The native navigation is not prevented, so nothing changes when it works.
  const emailClick = () => {
    click('email');
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
    <aside
      className={`relative mt-8 grid gap-6 overflow-hidden rounded-[16px] border border-b1 border-t-2 ${TONE[severity]} bg-s0 p-5 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-pro lg:grid-cols-[1fr_200px]`}
      data-result-cta={severity}
      data-engine={engine}
    >
      <div className="min-w-0">
        {headline && <p className="text-kicker uppercase text-t3 mb-2 break-words">{headline}</p>}
        <h3 className="font-mono text-h2 text-t1 mb-2">{inApp ? IN_APP_COPY.headline : copy.headline}</h3>
        <p className="prose-ib text-[15px] mb-4">{inApp ? IN_APP_COPY.body : copy.body}</p>
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
          {copy.benefits.map((b) => (
            <li key={b.key} className="flex gap-2 rounded-lg border border-hair bg-black p-3">
              <Icon name={b.icon} size={16} className="text-pro" />
              <span className="text-row text-t2"><span className="font-medium text-t1">{b.title}</span> {b.line}</span>
            </li>
          ))}
        </ul>
        {/* PR4 (DESIGN-SPEC 6.2): <TierCompare rows={['price', 'coming']} /> renders here when proWebUrl is present. */}
        <div className="flex flex-wrap items-center gap-3">
          {inApp || platform === 'android' ? (
            <a href={play} rel="noopener" onClick={() => click('play')} className="btn-pro text-sm !px-5 !py-2.5">
              {inApp ? IN_APP_COPY.button : 'Get the app, then upgrade to Pro'}
            </a>
          ) : (
            <>
              <a href={play} rel="noopener" onClick={() => click('play')} className="btn-primary text-sm !px-5 !py-2.5">Get Incognito Browser for Android</a>
              <a href={mailto} onClick={emailClick} className="btn-ghost text-sm !px-4 !py-2">Email me the link</a>
              <button type="button" onClick={copyLink} className="btn-ghost text-sm !px-4 !py-2">{copied ? 'Copied' : 'Copy link'}</button>
            </>
          )}
          {proWebUrl && !inApp && (
            <a href={proWebUrl} rel="noopener" onClick={() => click('pro-web')} className="text-sm text-pro underline underline-offset-4">
              {PRO_WEB_GATED ? 'Pro version of this check →' : 'Pro version of this check, free for now →'}
            </a>
          )}
        </div>
        {mailFallback && (
          <div className="mt-3 rounded border border-b1 bg-black/30 p-3" role="status" aria-live="polite" data-mail-fallback>
            <p className="text-xs text-t2 mb-2">No email app opened on this device. Copy the message and send it from your email instead:</p>
            <textarea readOnly value={mailBody} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Message to send yourself" className="w-full text-xs font-mono bg-s0 border border-b1 rounded p-2 text-t2" />
            <button type="button" onClick={copyMessage} className="btn-ghost mt-2 text-xs !px-3 !py-1.5 !min-h-0">{msgCopied ? 'Copied' : 'Copy message'}</button>
          </div>
        )}
        <p className="text-meta text-t3 mt-3">{PRO_FOOTNOTE}</p>
      </div>
      <div className="hidden lg:block">
        <PhoneFrame />
      </div>
    </aside>
  );
}
