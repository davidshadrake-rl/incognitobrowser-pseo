/**
 * Guide content page (DESIGN-SPEC 5.6). Server component — no JS. Steps
 * render as a left-rail timeline the reader scrolls through; the old step
 * pills + activeStep tab state are gone on purpose (nothing indexable may
 * move behind JS, and a reader scrolling is simpler than a reader clicking).
 */
import { Badge } from './ui/Badge';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { Icon } from './ui/Icon';
import { ArticleByline } from './ArticleByline';
import { CheckYoursNow } from './CheckYoursNow';
import { TYPE_ICON, diagramForNiche } from '@/lib/visuals';
import { weaveLinks, unmatchedLinkSentence, isSafeHref, type InlineLink, type WeaveSegment } from '@/lib/inline-links';
import type { ProofRoute } from '@/lib/proof-route';
import type { ReactNode } from 'react';

interface GuideStep {
  stepNumber: number;
  title: string;
  description: string;
  actions: string[];
  proTip?: string;
  warning?: string;
}

interface FAQ {
  question: string;
  answer: string;
}

interface GuideData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
  estimatedTime: string;
  intro?: string;
  prerequisites: string[];
  steps: GuideStep[];
  faqs: FAQ[];
  /** Rendered as the closing "Going further" panel — was in the data, unrendered until now. */
  pro_tips?: string[];
  /** Woven inline into the intro/steps by weaveLinks; a card grid never renders these. */
  relatedLinks?: InlineLink[];
}

/** ~60-word cap on the intro (DESIGN-SPEC section 7 copy-density rules). */
function capWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return text.trim();
  return `${words.slice(0, max).join(' ')}…`;
}

/** Render weaveLinks segments as React children — plain text stays plain text
 *  (React escapes it), anchor segments become real <a> elements. Nothing here
 *  parses or concatenates HTML. */
function renderSegments(segments: WeaveSegment[]): ReactNode {
  return segments.map((seg, i) => {
    if (typeof seg === 'string') return seg;
    const external = seg.type === 'external';
    return (
      <a key={i} href={seg.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {seg.text}
      </a>
    );
  });
}

/**
 * Weave relatedLinks[] across the intro, then the step descriptions, in
 * order: each link is offered to a text block only until it finds a match
 * (weaveLinks reports it back as unmatched otherwise), so no link is ever
 * woven into two places. Anything left unmatched after every block is
 * appended to the intro as one sentence each, per DESIGN-SPEC 5.6, rather
 * than dropped into a card.
 */
function weaveGuideContent(intro: string | undefined, steps: GuideStep[], links: InlineLink[]) {
  let remaining = links;

  let introSegments: WeaveSegment[] = intro ? [intro] : [];
  if (intro && remaining.length > 0) {
    const result = weaveLinks(intro, remaining);
    introSegments = result.segments;
    remaining = result.unmatched;
  }

  const stepSegments: WeaveSegment[][] = steps.map((step) => [step.description]);
  steps.forEach((step, i) => {
    if (remaining.length === 0) return;
    const result = weaveLinks(step.description, remaining);
    stepSegments[i] = result.segments;
    remaining = result.unmatched;
  });

  for (const link of remaining) introSegments = [...introSegments, ...unmatchedLinkSentence(link)];

  return { introSegments, stepSegments };
}

export function GuidePage({ data, nicheName, proofRoute }: { data: GuideData; nicheName: string; proofRoute?: ProofRoute | null }) {
  const cappedIntro = data.intro ? capWords(data.intro, 60) : undefined;
  // isSafeHref here as well as inside weaveLinks: weaveLinks reports an
  // unsafe link back as *unmatched*, and weaveGuideContent turns every
  // leftover unmatched link into an appended anchor — so without this filter
  // a javascript:/data: url in content JSON would skip the weave guard and
  // still reach an <a href>. Today's only call site pre-validates, so this
  // is the second lock, not the first.
  const links = (data.relatedLinks ?? []).filter((l) => l && l.title && l.url && isSafeHref(l.url));
  const { introSegments, stepSegments } = weaveGuideContent(cappedIntro, data.steps, links);

  const author = (data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author;
  const editor = (data as unknown as { editor?: { name: string; profileUrl?: string } | null }).editor;
  const reviewedAt = (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt;

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Guides', href: '/guides' },
        { label: nicheName, href: `/guides/${data.niche}` },
        { label: data.title },
      ]} />

      <PageHero
        icon={TYPE_ICON.guide}
        kicker={`${nicheName} · guide`}
        title={data.title}
        badges={
          <>
            <Badge variant="difficulty" label={data.difficulty} className="capitalize" />
            <Badge label={data.estimatedTime} />
            <Badge label={`${data.steps.length} steps`} />
          </>
        }
        action={<ArticleByline author={author} editor={editor} reviewedAt={reviewedAt} />}
        figure={{ value: data.steps.length, label: 'steps' }}
        diagram={diagramForNiche(data.niche)}
      />

      {cappedIntro && <p className="prose-ib text-lede mb-8">{renderSegments(introSegments)}</p>}

      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      {data.prerequisites.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <span className="text-row text-t3">Before you start:</span>
          {data.prerequisites.map((p, i) => <Badge key={i} variant="neutral" label={p} />)}
        </div>
      )}

      <ol className="relative before:absolute before:left-[19px] before:top-0 before:bottom-0 before:w-px before:bg-b1">
        {data.steps.map((step, i) => (
          <li key={i} id={`step-${step.stepNumber}`} className="relative grid grid-cols-[40px_1fr] gap-6 mb-8">
            <div className="w-10 h-10 rounded-full border border-b2 bg-base font-mono text-meta flex items-center justify-center tnum text-t1">
              {step.stepNumber}
            </div>
            <div className="bg-s0 rounded-[12px] p-4 min-w-0">
              <h3 className="font-mono text-h3 text-t1 mb-2">{step.title}</h3>
              <p className="prose-ib mb-3">{renderSegments(stepSegments[i])}</p>

              {step.actions.length > 0 && (
                <ul className="space-y-1.5 mb-3">
                  {step.actions.map((action, ai) => (
                    <li key={ai} className="flex items-start gap-2 prose-ib text-row">
                      <Icon name="check" size={16} className="text-t3 mt-0.5 shrink-0" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              )}

              {step.proTip && (
                <p className="flex items-start gap-2 text-row prose-ib">
                  <Icon name="star" size={16} className="text-ok mt-0.5 shrink-0" />
                  <span><span className="text-kicker uppercase text-t3 mr-1.5">Note</span>{step.proTip}</span>
                </p>
              )}

              {step.warning && (
                <p className="flex items-start gap-2 text-row prose-ib mt-2">
                  <Icon name="warn" size={16} className="text-warn mt-0.5 shrink-0" />
                  <span><span className="text-kicker uppercase text-t3 mr-1.5">Caution</span>{step.warning}</span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {data.pro_tips && data.pro_tips.length > 0 && (
        <details className="panel" open>
          <summary>
            Going further <Icon name="chevron" size={16} />
          </summary>
          <div className="panel-body">
            <ol className="list-decimal list-outside ml-4 space-y-2">
              {data.pro_tips.map((tip, i) => <li key={i} className="prose-ib text-row">{tip}</li>)}
            </ol>
          </div>
        </details>
      )}

      {data.faqs.length > 0 && (
        <section className="mt-12">
          <h2 className="font-mono text-h2 text-t1 mb-2">Frequently asked questions</h2>
          {data.faqs.map((faq, i) => (
            <details key={i} className="panel">
              <summary>{faq.question} <Icon name="chevron" size={16} /></summary>
              <div className="panel-body">
                <p className="prose-ib">{faq.answer}</p>
              </div>
            </details>
          ))}
        </section>
      )}
    </article>
  );
}
