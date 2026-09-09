/**
 * Generic content card (DESIGN-SPEC 5.3): same anatomy as ToolCard — a 40px
 * IconTile in column one, title + line-clamped blurb in column two — but
 * with no engine, no tier, and no coloured rail. Used by the per-niche
 * index grids for guides, checklists, comparisons, templates and calculators
 * (e.g. app/guides/[niche]/page.tsx), which have no engine to key a tool
 * card off. Server component.
 */
import Link from 'next/link';
import { Badge } from './Badge';
import { IconTile, type IconName } from './Icon';

interface CardProps {
  title: string;
  description: string;
  href: string;
  badge?: string;
  /** Defaults to a generic document glyph — callers with a more specific icon (TYPE_ICON, etc.) should pass it. */
  icon?: IconName;
}

export function Card({ title, description, href, badge, icon = 'doc' }: CardProps) {
  return (
    <Link href={href} className="group relative grid grid-cols-[40px_1fr] gap-3.5 bg-s0 border border-b1 rounded-[12px] p-4 hover:border-b2 transition-colors">
      <IconTile name={icon} />
      <div className="min-w-0">
        {badge && <Badge label={badge} className="mb-2" />}
        <h3 className="font-mono text-[15px] font-semibold text-t1">{title}</h3>
        <p className="prose-ib text-row line-clamp-2 mt-1">{description}</p>
      </div>
    </Link>
  );
}
