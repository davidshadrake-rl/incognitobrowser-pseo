'use client';

/**
 * The way from a content page into its free tool: one plain line and a button
 * to the tool page. Nothing else — the owner's rule (2026-09-16) is that the
 * funnel is the path a visitor takes, never a block that spells the funnel
 * out. Each page's plan (which tool, what each result means, the Pro ask) is
 * kept in the internal funnel doc, not on the page.
 *
 * The link carries ?from=<this page>, so the tool page can answer the
 * visitor's result with the Pro CTA written for the page they came from
 * (components/FunnelSurfaces.tsx).
 */
import Link from 'next/link';
import { track } from '@/lib/track';

export function ToolEntryCard({ engine, line, button, href, from }: { engine: string; line: string; button: string; href: string; from: string }) {
  return (
    <aside className="my-8 rounded-lg border border-b1 bg-white/[0.03] p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-tool-entry={engine}>
      <p className="flex-1 text-white">{line}</p>
      {/* next/link, not a plain <a>: it adds the base path. A plain <a href="/tools/…"> left out
          /resources on the static export and 404'd on the droplet (2026-09-16). */}
      <Link
        href={href}
        onClick={() => track('funnel_run', { tool: engine, target: 'check-yours', page: from })}
        className="btn-primary text-sm !px-5 !py-2.5 shrink-0 text-center"
      >
        {`${button} →`}
      </Link>
    </aside>
  );
}
