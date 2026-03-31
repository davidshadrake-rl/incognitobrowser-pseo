import Link from 'next/link';

interface RelatedLink {
  title: string;
  url: string;
  type: string;
}

export function RelatedContent({ links }: { links: RelatedLink[] }) {
  if (!links || links.length === 0) return null;

  return (
    <aside className="mt-12 pt-8 border-t border-gray-200">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Related Resources</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {links.map((link, i) => (
          <Link
            key={i}
            href={link.url}
            className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-all"
          >
            <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{link.type}</span>
            <span className="text-sm text-gray-900">{link.title}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
}
