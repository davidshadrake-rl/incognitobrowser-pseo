import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { TYPE_ICON } from '@/lib/visuals';

interface RelatedLink {
  title: string;
  url: string;
  type: string;
}

export function RelatedContent({ links, nicheHub }: { links: RelatedLink[]; nicheHub?: { name: string; href: string } }) {
  if ((!links || links.length === 0) && !nicheHub) return null;

  return (
    <aside className="mt-12 pt-8 border-t border-b1">
      <h2 className="text-lg font-semibold text-white mb-4">Related Resources</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {links.map((link, i) => (
          <Link
            key={i}
            href={link.url}
            className="flex items-center gap-3 p-3 border border-b1 rounded-lg hover:border-b2 bg-white/[0.02] transition-all related-card"
          >
            <Icon name={TYPE_ICON[link.type] ?? 'arrow'} size={16} className="text-t3" />
            <div className="min-w-0">
              <span className="text-sm text-white block truncate">{link.title}</span>
              <span className="text-xs text-t3 capitalize">{link.type}</span>
            </div>
          </Link>
        ))}
      </div>
      {nicheHub && (
        <div className="mt-4">
          <Link
            href={nicheHub.href}
            className="text-sm text-t2 hover:text-white transition-colors"
          >
            {`View all ${nicheHub.name} resources →`}
          </Link>
        </div>
      )}
    </aside>
  );
}
