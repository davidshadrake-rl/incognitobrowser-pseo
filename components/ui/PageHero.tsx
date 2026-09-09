/**
 * Shared page hero (DESIGN-SPEC 5.4), used by tools, guides, checklists,
 * comparisons, templates, calculators, glossary, report cards and every
 * category index. Server component.
 *
 * Figure sources (never invented — DESIGN-SPEC 5.4 "Figure sources"): the
 * caller supplies an already-known number (ENGINE_META[engine].figure once
 * the registry exists, "{steps.length} / steps" for a guide, a corpus count
 * for an index page, and so on) as the `figure` prop. `ENGINE_META` does not
 * exist yet, so PageHero itself never imports the tools registry — it only
 * renders what it is given.
 *
 * Amendment A §4: on a tool PageHero the pull-quote's top rule may use the
 * engine's family hue instead of white — pass `figureFamily`. Everywhere
 * else the rule stays white (omit the prop).
 */
import type { ReactNode } from 'react';
import { IconTile, type IconName } from './Icon';
import { Diagram } from './Diagram';
import { Rings } from './Rings';
import type { Diagram as DiagramId, Family } from '@/lib/visuals';
import type { Tier } from '@/lib/tiers';

export interface PageHeroFigure {
  value: string | number;
  label: string;
}

const FIGURE_BORDER_VAR: Record<Family, string> = {
  net: 'var(--fam-net)',
  trace: 'var(--fam-trace)',
  identity: 'var(--fam-identity)',
  cipher: 'var(--fam-cipher)',
};

export function PageHero({
  icon,
  kicker,
  title,
  description,
  badges,
  action,
  figure,
  figureFamily,
  diagram,
  tier = 'free',
  aside,
}: {
  icon: IconName;
  /** Uppercase eyebrow, e.g. "Browser privacy · analyzer". */
  kicker: string;
  title: ReactNode;
  /** Capped ~160 chars. */
  description?: ReactNode;
  /** Badge row: tier, client|server, difficulty, time, steps. */
  badges?: ReactNode;
  action?: ReactNode;
  /** Pull-quote figure. Never invented — see the module doc above. */
  figure?: PageHeroFigure;
  /** Amendment A: tint the figure's top rule with a family hue instead of white. */
  figureFamily?: Family;
  diagram?: DiagramId;
  tier?: Tier;
  /** Pro site: a ProNotice panel instead of the diagram. */
  aside?: ReactNode;
}) {
  return (
    <section
      className="relative overflow-hidden grid lg:grid-cols-[1fr_320px] gap-6 border border-b1 rounded-[16px] p-6 mb-8"
      style={{ backgroundImage: 'var(--accent-gradient)' }}
    >
      <Rings />
      <div className="relative min-w-0">
        <div className="flex items-center gap-3 mb-3">
          <IconTile name={icon} size={56} tone={tier === 'pro' ? 'pro' : 'free'} />
          <p className="text-kicker uppercase text-t3">{kicker}</p>
        </div>
        {badges && <div className="flex flex-wrap gap-1.5 mb-3">{badges}</div>}
        <h1 className="font-mono text-[24px] md:text-[28px] leading-[1.2] font-semibold text-t1 mb-3">{title}</h1>
        {description && <p className="prose-ib text-[15px] max-w-[56ch]">{description}</p>}
        {action}
      </div>
      <div className="relative hidden lg:flex flex-col justify-between">
        {figure && (
          <p className="figure" style={figureFamily ? { borderTopColor: FIGURE_BORDER_VAR[figureFamily] } : undefined}>
            <b>{figure.value}</b>
            <span>{figure.label}</span>
          </p>
        )}
        {diagram && <Diagram id={diagram} pro={tier === 'pro'} />}
        {aside}
      </div>
    </section>
  );
}
