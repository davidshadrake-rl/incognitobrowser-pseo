import Link from 'next/link';

interface RelatedLink {
  title: string;
  url: string;
  type: string;
}

const TYPE_ICONS: Record<string, string> = {
  guide: '&#128214;',
  checklist: '&#9745;',
  comparison: '&#8596;',
  tool: '&#9881;',
  template: '&#128196;',
  calculator: '&#128290;',
  internal: '&#128279;',
  external: '&#127760;',
};

export function RelatedContent({ links, nicheHub }: { links: RelatedLink[]; nicheHub?: { name: string; href: string } }) {
  if ((!links || links.length === 0) && !nicheHub) return null;

  return (
    <aside className="mt-12 pt-8 border-t border-white/10">
      <h2 className="text-lg font-semibold text-white mb-4">Related Resources</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {links.map((link, i) => (
          <Link
            key={i}
            href={link.url}
            className="flex items-center gap-3 p-3 border border-white/10 rounded-lg hover:border-white/30 bg-white/[0.02] transition-all"
          >
            <span
              className="text-base"
              dangerouslySetInnerHTML={{ __html: TYPE_ICONS[link.type] || TYPE_ICONS.internal }}
            />
            <div className="min-w-0">
              <span className="text-sm text-white block truncate">{link.title}</span>
              <span className="text-xs text-[#B8B8D4]/50 capitalize">{link.type}</span>
            </div>
          </Link>
        ))}
      </div>
      {nicheHub && (
        <div className="mt-4">
          <Link
            href={nicheHub.href}
            className="text-sm text-[#B8B8D4] hover:text-white transition-colors"
          >
            View all {nicheHub.name} resources &rarr;
          </Link>
        </div>
      )}
    </aside>
  );
}
