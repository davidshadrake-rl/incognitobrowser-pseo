'use client';

/**
 * Share panel: preview of the scorecard PNG, Share (Web Share API with the
 * image when the device supports it), Download, Copy link. The link a share
 * lands on is the page itself, so every share is a landing for someone
 * else's first visit.
 */
import { useEffect, useRef, useState } from 'react';
import { drawScorecard, renderScorecard, scorecardFilename, SCORECARD_H, SCORECARD_W, type ScorecardSpec } from '@/lib/scorecard';
import { track } from '@/lib/track';
import { pageLinkFor } from '@/lib/handoff';

interface Props extends Omit<ScorecardSpec, 'url'> {
  url?: string;
  engine: string;
  niche?: string;
}

export function Scorecard({ engine, niche, url, ...spec }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageUrl, setPageUrl] = useState(url || '');
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  useEffect(() => {
    if (!url) setPageUrl(pageLinkFor(window.location.href)); // origin + path: no query/hash in share text or on the card
    setCanShareFiles(typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
  }, [url]);

  const full: ScorecardSpec = { ...spec, url: pageUrl || 'incognitobrowser.io/resources' };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (ctx) drawScorecard(ctx, full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full.title, full.figure, full.headline, full.url, full.tone, JSON.stringify(full.stats)]);

  const share = async () => {
    track('share_click', { tool: engine, niche, target: 'share' });
    setState('busy');
    try {
      const blob = await renderScorecard(full);
      const file = new File([blob], scorecardFilename(full.title), { type: 'image/png' });
      const text = `${full.title}: ${full.figure}. ${full.headline}`;
      if (canShareFiles) await navigator.share({ files: [file], title: full.title, text, url: full.url });
      else if (navigator.share) await navigator.share({ title: full.title, text, url: full.url });
      else await download(blob);
      setState('done');
    } catch { setState('idle'); }
    setTimeout(() => setState('idle'), 2000);
  };
  const download = async (blob?: Blob) => {
    track('share_click', { tool: engine, niche, target: 'download' });
    const b = blob || (await renderScorecard(full));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = scorecardFilename(full.title);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const copy = async () => {
    track('share_click', { tool: engine, niche, target: 'copy' });
    try { await navigator.clipboard.writeText(`${full.title}: ${full.figure}. ${full.headline} ${full.url}`); setState('done'); setTimeout(() => setState('idle'), 2000); } catch { /* no clipboard */ }
  };

  return (
    <section className="mt-6 rounded-[16px] border border-b1 bg-s0 p-4" data-scorecard={engine}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3">
        <h3 className="text-row font-semibold text-t1">Share your result</h3>
        <span className="text-meta text-t3">Drawn on your device. Nothing is uploaded.</span>
      </div>
      <div className="relative" style={{ aspectRatio: `${SCORECARD_W} / ${SCORECARD_H}` }}>
        <canvas ref={canvasRef} width={SCORECARD_W} height={SCORECARD_H} className="absolute inset-0 w-full h-full rounded-[12px] border border-b1" aria-label={`Scorecard: ${full.title} ${full.figure}`} />
        {/* The footer row ("domain · Check yours free") drawn on the canvas is a real link here — it can only be a picture once the PNG is shared or downloaded. */}
        <a
          href={full.url}
          onClick={() => track('share_click', { tool: engine, niche, target: 'check-yours' })}
          className="absolute inset-x-[4%] bottom-[4%] h-[12%] rounded"
          aria-label={`Check your own ${full.title} result`}
          title="Check yours free"
        />
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={share} className="btn-primary text-sm !px-4 !py-2">{state === 'busy' ? 'Preparing…' : canShareFiles ? 'Share image' : 'Share'}</button>
        <button type="button" onClick={() => download()} className="btn-ghost text-sm !px-4 !py-2">Download PNG</button>
        <button type="button" onClick={copy} className="btn-ghost text-sm !px-4 !py-2">{state === 'done' ? 'Copied' : 'Copy text + link'}</button>
      </div>
    </section>
  );
}
