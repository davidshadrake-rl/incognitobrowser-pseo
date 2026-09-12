'use client';

/**
 * Share panel: preview of the scorecard PNG, Share (Web Share API, with the
 * image when the device supports it), Download, Copy text + link. The link a
 * share lands on is the page itself (plus the quiz's result hash, see
 * shareLinkFor), so every share is a landing for someone else's first visit.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { drawScorecard, renderScorecard, scorecardFilename, shareLinkFor, SCORECARD_H, SCORECARD_W, type ScorecardSpec } from '@/lib/scorecard';
import { isInsideIncognitoApp, track } from '@/lib/track';
import { pageLinkFor } from '@/lib/handoff';
import { blobToDataUrl, saveImageInApp } from '@/lib/in-app';

interface Props extends Omit<ScorecardSpec, 'url'> {
  url?: string;
  engine: string;
  niche?: string;
}

// Browser capabilities and the page address, read without effects. None of
// them change without a re-render (the quiz writes its result hash before it
// reports), so there is nothing to subscribe to. Server snapshots: no share
// support and no URL, which is what the static report-card HTML shows.
const noSubscribe = () => () => {};
let fileShare: boolean | null = null;
function canShareFilesNow(): boolean {
  if (fileShare === null) {
    try {
      fileShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
    } catch {
      fileShare = false;
    }
  }
  return fileShare;
}
const canShareNow = () => typeof navigator.share === 'function';
const hrefNow = () => window.location.href;
const inAppNow = () => isInsideIncognitoApp();
const serverFalse = () => false;
const serverHref = () => '';

export function Scorecard({ engine, niche, url, ...spec }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canShare = useSyncExternalStore(noSubscribe, canShareNow, serverFalse);
  const canShareFiles = useSyncExternalStore(noSubscribe, canShareFilesNow, serverFalse);
  const href = useSyncExternalStore(noSubscribe, hrefNow, serverHref);
  const inApp = useSyncExternalStore(noSubscribe, inAppNow, serverFalse);
  // Separate states: "Copied" used to light up after a share, or after the
  // share fell back to a download, when nothing had been copied.
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'shared'>('idle');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Inside an app build with no save bridge: the picture itself, to press and hold. */
  const [manualSave, setManualSave] = useState<string | null>(null);

  // Drawn on the card: origin + path only. Carried by Share / Copy: the same,
  // plus the quiz's result hash, so the recipient sees the result, not a blank quiz.
  const cardUrl = url || (href ? pageLinkFor(href) : '');
  const shareUrl = url || (href ? shareLinkFor(href) : '');
  const full: ScorecardSpec = { ...spec, url: cardUrl || 'incognitobrowser.io/resources' };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (ctx) drawScorecard(ctx, full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full.title, full.figure, full.headline, full.url, full.tone, JSON.stringify(full.stats)]);

  const shareText = `${full.title}: ${full.figure}. ${full.headline}`;
  const share = async () => {
    track('share_click', { tool: engine, niche, target: 'share' });
    setShareState('busy');
    try {
      const target = shareUrl || full.url;
      if (canShareFiles) {
        const blob = await renderScorecard(full);
        const file = new File([blob], scorecardFilename(full.title), { type: 'image/png' });
        // The link goes inside the text, not in `url`. A share sheet handed
        // files + text + url passes three separate items, and what the target
        // does with them is its own business: some attach the picture and then
        // the link's preview picture too, and some drop the text, leaving the
        // "Check yours:" with nothing after it. One picture, one message.
        await navigator.share({ files: [file], title: full.title, text: `${shareText} ${target}` });
      } else {
        await navigator.share({ title: full.title, text: shareText, url: target });
      }
      setShareState('shared');
      setTimeout(() => setShareState('idle'), 2000);
    } catch {
      setShareState('idle'); // cancelled by the visitor, or the share sheet failed
    }
  };
  const download = async () => {
    track('share_click', { tool: engine, niche, target: 'download' });
    const b = await renderScorecard(full);
    if (inApp) {
      // The app's download manager takes http(s) links only, so the blob:
      // link below fails there ("Invalid URL: blob"). Hand the image to the
      // app instead (IN-APP-BRIDGE.md); without that, show it to press and hold.
      if (await saveImageInApp(b, scorecardFilename(full.title))) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setManualSave(await blobToDataUrl(b));
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = scorecardFilename(full.title);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const copy = async () => {
    track('share_click', { tool: engine, niche, target: 'copy' });
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl || full.url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard */ }
  };

  return (
    <section className="mt-6 rounded-[16px] border border-b1 bg-s0 p-4" data-scorecard={engine}>
      <h3 className="text-row font-semibold text-t1 mb-3">Share your result</h3>
      {/* No link over the picture: its footer URL is this page, and following it reloaded the page and wiped the result. */}
      <div className="relative" style={{ aspectRatio: `${SCORECARD_W} / ${SCORECARD_H}` }}>
        <canvas ref={canvasRef} width={SCORECARD_W} height={SCORECARD_H} className="absolute inset-0 w-full h-full rounded-[12px] border border-b1" aria-label={`Scorecard: ${full.title} ${full.figure}`} />
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {/* Only where the device can share: elsewhere "Share" just downloaded the PNG, a second Download button. */}
        {canShare && (
          <button type="button" onClick={share} disabled={shareState === 'busy'} className="btn-primary text-sm !px-4 !py-2">
            {shareState === 'busy' ? 'Preparing…' : shareState === 'shared' ? 'Shared' : canShareFiles ? 'Share image' : 'Share'}
          </button>
        )}
        <button type="button" onClick={download} className={`${canShare ? 'btn-ghost' : 'btn-primary'} text-sm !px-4 !py-2`}>
          {saved ? 'Saved' : inApp ? 'Save image' : 'Download PNG'}
        </button>
        <button type="button" onClick={copy} className="btn-ghost text-sm !px-4 !py-2">{copied ? 'Copied' : 'Copy text + link'}</button>
      </div>
      {manualSave && (
        <div className="mt-3 rounded-[12px] border border-b1 bg-black p-3" role="status" data-manual-save>
          <p className="text-row text-t2 mb-2">To save it, press and hold the image, or take a screenshot.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={manualSave} alt={`Scorecard: ${full.title} ${full.figure}`} className="w-full rounded-[8px] border border-b1" />
          <button type="button" onClick={() => setManualSave(null)} className="btn-ghost mt-2 text-xs !px-3 !py-1.5 !min-h-0">Close</button>
        </div>
      )}
    </section>
  );
}
