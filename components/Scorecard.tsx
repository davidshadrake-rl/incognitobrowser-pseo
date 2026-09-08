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
    if (!url) setPageUrl(window.location.href.split('#')[0]);
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
    <section className="mt-6 rounded-lg border border-white/10 bg-[#0a0a0a] p-4" data-scorecard={engine}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-white">Share your result</h3>
        <span className="text-xs text-[#B8B8D4]/60">Drawn on your device. Nothing is uploaded.</span>
      </div>
      <canvas ref={canvasRef} width={SCORECARD_W} height={SCORECARD_H} className="w-full h-auto rounded border border-white/10" aria-label={`Scorecard: ${full.title} ${full.figure}`} />
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={share} className="btn-primary text-sm !px-4 !py-2">{state === 'busy' ? 'Preparing…' : canShareFiles ? 'Share image' : 'Share'}</button>
        <button type="button" onClick={() => download()} className="text-sm px-4 py-2 rounded-full border border-white/15 text-[#B8B8D4] hover:text-white hover:border-white/40">Download PNG</button>
        <button type="button" onClick={copy} className="text-sm px-4 py-2 rounded-full border border-white/15 text-[#B8B8D4] hover:text-white hover:border-white/40">{state === 'done' ? 'Copied' : 'Copy text + link'}</button>
      </div>
    </section>
  );
}
