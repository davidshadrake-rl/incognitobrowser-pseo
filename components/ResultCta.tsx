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
import { detectPlatform, isInsideIncognitoApp, track, type Platform } from '@/lib/track';

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

const TONE: Record<Severity, string> = {
  red: 'border-red-500/30 bg-red-500/[0.06]',
  amber: 'border-amber-500/30 bg-amber-500/[0.06]',
  green: 'border-green-500/30 bg-green-500/[0.06]',
  info: 'border-white/10 bg-white/[0.03]',
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
  const mailto = `mailto:?subject=${encodeURIComponent('Incognito Pro (Android)')}&body=${encodeURIComponent(`Get Incognito Pro on Google Play: ${play}\n\nThe check I ran: ${pageHref}`)}`;

  const click = (target: 'play' | 'pro-web' | 'email' | 'copy') => track('cta_click', { tool: engine, niche, severity, target });
  const copyLink = async () => {
    click('copy');
    try { await navigator.clipboard.writeText(play); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };

  return (
    <aside className={`mt-8 rounded-lg border p-5 ${TONE[severity]}`} data-result-cta={severity} data-engine={engine}>
      {headline && <p className="text-xs uppercase tracking-wider text-[#B8B8D4]/70 mb-2">{headline}</p>}
      <h3 className="text-xl font-semibold text-white mb-2">{inApp ? IN_APP_COPY.headline : copy.headline}</h3>
      <p className="text-sm text-[#B8B8D4] mb-4">{inApp ? IN_APP_COPY.body : copy.body}</p>
      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
        {copy.benefits.map((b) => (
          <li key={b.key} className="text-xs text-[#B8B8D4] bg-black/30 border border-white/5 rounded p-2">
            <span className="text-white font-medium">{b.title}</span> {b.line}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        {inApp || platform === 'android' ? (
          <a href={play} rel="noopener" onClick={() => click('play')} className="btn-primary text-sm !px-5 !py-2.5">
            {inApp ? IN_APP_COPY.button : 'Get the app, unlock Pro'}
          </a>
        ) : (
          <>
            <a href={play} rel="noopener" onClick={() => click('play')} className="btn-primary text-sm !px-5 !py-2.5">Get Incognito Browser for Android</a>
            <a href={mailto} onClick={() => click('email')} className="text-sm px-4 py-2 rounded-full border border-white/15 text-[#B8B8D4] hover:text-white hover:border-white/40">Email me the link</a>
            <button type="button" onClick={copyLink} className="text-sm px-4 py-2 rounded-full border border-white/15 text-[#B8B8D4] hover:text-white hover:border-white/40">{copied ? 'Copied' : 'Copy link'}</button>
          </>
        )}
        {proWebUrl && !inApp && (
          <a href={proWebUrl} rel="noopener" onClick={() => click('pro-web')} className="text-sm text-purple-300 hover:text-purple-200 underline">Open the Pro web app →</a>
        )}
      </div>
      {platform !== 'android' && !inApp && (
        <p className="text-xs text-[#B8B8D4]/60 mt-3">Incognito Browser is an Android app; Pro is unlocked inside it. Send the link to your phone and the check re-runs there.</p>
      )}
    </aside>
  );
}
