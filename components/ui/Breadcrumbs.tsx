import Link from 'next/link';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      {/* flex-wrap + break-all: a 26-char report-card domain otherwise forces the
          whole page to scroll sideways at 375px. The root "Resources" crumb is
          rendered here, so callers must not pass it again. */}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#B8B8D4]/60">
        <li>
          <Link href="/" className="hover:text-white transition-colors">Resources</Link>
        </li>
        {items.filter((item, i) => !(i === 0 && item.href === '/' && item.label === 'Resources')).map((item, i) => (
          <li key={i} className="flex items-center min-w-0">
            <svg className="w-4 h-4 mx-1 shrink-0 text-white/20" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            {item.href ? (
              <Link href={item.href} className="hover:text-white transition-colors">{item.label}</Link>
            ) : (
              <span className="text-[#B8B8D4] break-all">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
