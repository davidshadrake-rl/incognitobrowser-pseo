/**
 * Free/Pro tool card (DESIGN-SPEC 5.3, Amendment A §3). Server component.
 *
 * The engine drives the icon, the tier and — for free engines — the
 * family-hued left rail; a Pro engine keeps the blue rail regardless of
 * its family (IconTile's own tone="pro" precedence rule applies here too).
 */
import Link from 'next/link';
import { IconTile } from './ui/Icon';
import { Badge } from './ui/Badge';
import { Schematic } from './ui/Schematic';
import { ENGINE_ICON, familyOfEngine, type Family } from '@/lib/visuals';
import { tierOfEngine } from '@/lib/tiers';

// Literal class strings per family, never template-interpolated, so
// Tailwind's content scanner can find them (same pattern as Icon.tsx's
// FAMILY_LOOK / DESIGN-SPEC-AMENDMENT-COLORS.md's guard).
const RAIL: Record<Family, string> = {
  net: 'before:bg-fam-net',
  trace: 'before:bg-fam-trace',
  identity: 'before:bg-fam-identity',
  cipher: 'before:bg-fam-cipher',
};

export interface ToolCardProps {
  engine: string;
  title: string;
  blurb: string;
  href: string;
  /** Defaults to 'client' — most engines run entirely in the browser. */
  processing?: 'client' | 'server';
  /** 56px on the tools-index instrument panel, 40px (default) elsewhere, 32px in AtoZCatalogue. */
  tileSize?: 40 | 56 | 32;
  /** Instrument panel only: the input -> check -> verdict strip under the blurb. */
  schematic?: boolean;
  /** AtoZCatalogue's compact listing: hides the processing badge, keeps only the tier badge. */
  compact?: boolean;
}

export function ToolCard({ engine, title, blurb, href, processing, tileSize = 40, schematic = false, compact = false }: ToolCardProps) {
  const tier = tierOfEngine(engine);
  const rail = tier === 'pro' ? 'before:bg-pro' : RAIL[familyOfEngine(engine)];
  const gridCols = tileSize === 56 ? 'grid-cols-[56px_1fr]' : tileSize === 32 ? 'grid-cols-[32px_1fr]' : 'grid-cols-[40px_1fr]';
  // The free-site Pro band links at the Pro deployment (a different origin) —
  // a plain anchor there, next/link for every same-origin href.
  const isExternal = /^https?:\/\//.test(href);

  const className = `group relative overflow-hidden grid ${gridCols} gap-3.5 bg-s0 border border-b1 rounded-[12px] p-4 hover:border-b2 transition-colors before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${rail}`;

  const content = (
    <>
      <IconTile name={ENGINE_ICON[engine] ?? 'hat'} size={tileSize} tone={tier} family={familyOfEngine(engine)} />
      <div className="min-w-0">
        <h3 className="font-mono text-[15px] font-semibold text-t1">{title}</h3>
        <p className="prose-ib text-row line-clamp-2 mt-1">{blurb}</p>
        {schematic && (
          <div className="mt-3 max-w-[200px]">
            <Schematic />
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant={tier} />
          {!compact && <Badge variant={processing === 'server' ? 'server' : 'client'} />}
        </div>
      </div>
    </>
  );

  if (isExternal) {
    return (
      <a href={href} className={className} data-tool-card={engine}>
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={className} data-tool-card={engine}>
      {content}
    </Link>
  );
}
