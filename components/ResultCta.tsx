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
 * Optional secondary link to a related Pro tool page, which names that tool.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Severity } from '@/components/tools/ResultContext';
import { composeCta, IN_APP_COPY, proHandoffTitle, type SeverityCopy } from '@/lib/cta-copy';
import { isInsideIncognitoApp, track } from '@/lib/track';
import { UpgradeButtons } from '@/components/UpgradeButtons';
import { PRO_FOOTNOTE } from '@/lib/tiers';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { PhoneFrame } from '@/components/ui/PhoneFrame';

interface Props {
  engine: string;
  niche?: string;
  severity: Severity;
  /** Replaces the engine's severity line when the result picks the wording (report cards). */
  line?: SeverityCopy;
  /** The visitor's own number, shown above the ask so the CTA reads as an answer. */
  headline?: string;
  /** A Pro tool page related to this result, if any (absolute URL). Shown only when lib/cta-copy can name it. */
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

// The user agent never changes during a visit: nothing to subscribe to. The
// server snapshot ('other', not in the app) is what the static HTML shows.
const noSubscribe = () => () => {};
const serverInApp = () => false;

export function ResultCta({ engine, niche, severity, line, headline, proWebUrl, pageUrl, content, term = 'tool' }: Props) {
  const inApp = useSyncExternalStore(noSubscribe, () => isInsideIncognitoApp(), serverInApp);
  useEffect(() => {
    track('cta_view', { tool: engine, niche, severity }, { once: true });
  }, [engine, niche, severity]);

  const copy = useMemo(() => composeCta(engine, niche, severity, line), [engine, niche, severity, line]);
  // Name the Pro page the link opens: "Pro version of this check" sent the
  // Ad-Blocker Test, Link Unwrapper, DNS Leak Test and What's My IP to other tools.
  const proTitle = proHandoffTitle(proWebUrl);
  const click = (target: 'play' | 'pro-web' | 'email' | 'copy') => track('cta_click', { tool: engine, niche, severity, target });

  return (
    // ib-upgrade: hidden inside the app for someone who already has Pro (lib/in-app.ts).
    <aside
      className={`ib-upgrade relative mt-8 grid gap-6 overflow-hidden rounded-[16px] border border-b1 border-t-2 ${TONE[severity]} bg-s0 p-5 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-pro lg:grid-cols-[1fr_200px]`}
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
        <UpgradeButtons engine={engine} niche={niche} severity={severity} from="result" content={content} term={term} pageUrl={pageUrl} onClick={click}>
          {proWebUrl && proTitle && !inApp && (
            <span className="inline-flex flex-wrap items-center gap-2">
              <a href={proWebUrl} rel="noopener" onClick={() => click('pro-web')} className="text-sm text-pro underline underline-offset-4">
                {`Try the Pro ${proTitle} →`}
              </a>
              <Badge variant="pro" />
            </span>
          )}
        </UpgradeButtons>
        <p className="text-meta text-t3 mt-3">{PRO_FOOTNOTE}</p>
      </div>
      {/* A picture of the app, not a result: captioned so it never reads as a second score beside the visitor's own. */}
      <figure className="hidden lg:flex flex-col items-center gap-2" aria-hidden="true">
        <PhoneFrame />
        <figcaption className="text-meta text-t3 text-center">Incognito Pro on Android (illustration)</figcaption>
      </figure>
    </aside>
  );
}
