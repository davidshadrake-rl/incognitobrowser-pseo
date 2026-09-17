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
 *
 * Counted per page (scripts/funnels/stats.ts): funnel_view once at least half
 * the card has been on screen, funnel_run on the button.
 */
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { track } from '@/lib/track';

export function ToolEntryCard({ engine, line, button, href, from }: { engine: string; line: string; button: string; href: string; from: string }) {
  const ref = useRef<HTMLElement>(null);

  // A view counts only when the card was actually seen, not when the page loaded.
  useEffect(() => {
    const card = ref.current;
    if (!card || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.intersectionRatio >= 0.5)) {
        track('funnel_view', { tool: engine, page: from }, { once: true });
        io.disconnect();
      }
    }, { threshold: 0.5 });
    io.observe(card);
    return () => io.disconnect();
  }, [engine, from]);

  return (
    <aside ref={ref} className="my-8 rounded-lg border border-b1 bg-white/[0.03] p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-tool-entry={engine}>
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
