'use client';

/**
 * Screenshot Leak Checker — "what does this screenshot give away before
 * anyone reads it?"
 *
 * Rendering only. All parsing lives in lib/screenshot-leak.ts. The file is
 * read with File.arrayBuffer() and never leaves the device: no upload, no
 * fetch, no map tiles. Compressed PNG text is inflated with the browser's
 * DecompressionStream when available; otherwise it is reported as present
 * but not decoded.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReportResult, type ToolResult } from '@/components/tools/ResultContext';
import {
  assess,
  contextLeaks,
  extractRaw,
  resolveCompressedText,
  type Leak,
  type LeakSeverity,
  type PiiKind,
  type ScreenshotAnalysis,
  type Verdict,
} from '@/lib/screenshot-leak';

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

const PII_KIND_LABEL: Record<PiiKind, string> = {
  email: 'Email address',
  phone: 'Phone number',
  address: 'Street address',
  coordinates: 'Coordinate pair',
  iban: 'Bank account (IBAN)',
  card: 'Payment card number',
  handle: 'Social handle',
  name: 'Name',
  username: 'Username in path',
};

async function inflate(data: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const copy = new Uint8Array(data); // own ArrayBuffer, detached from the file view
    const reader = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    // A compressed text chunk of zeros inflates ~1000:1 (a 24 MB zTXt → tab
    // out of memory). Read with a budget instead of buffering the whole stream.
    const MAX_INFLATED = 4 * 1024 * 1024;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INFLATED) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.byteLength; }
    return new TextDecoder().decode(out);
  } catch {
    return null;
  }
}

function toResult(a: ScreenshotAnalysis): ToolResult {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return {
    severity: a.verdict,
    headline: a.headline,
    detail: `${a.format.toUpperCase()} · ${n(a.fields.length, 'metadata field', 'metadata fields')} · ${n(a.leaks.length, 'leak', 'leaks')}`,
    stats: [
      { label: 'Leaks', value: String(a.counts.leaks) },
      { label: 'GPS', value: a.counts.gps ? 'Yes' : 'No' },
      { label: 'Thumbnail', value: a.counts.thumbnail ? 'Yes' : 'No' },
      { label: 'PII items', value: String(a.counts.pii) },
    ],
    shareText: a.headline,
  };
}

function verdictClasses(v: Verdict): { box: string; text: string; label: string } {
  switch (v) {
    case 'red':
      return { box: 'border-danger/30 bg-danger-dim', text: 'text-danger', label: 'Exposed' };
    case 'amber':
      return { box: 'border-warn/30 bg-warn-dim', text: 'text-warn', label: 'Partially exposed' };
    default:
      return { box: 'border-ok/30 bg-ok-dim', text: 'text-ok', label: 'Clean' };
  }
}

function severityClasses(s: LeakSeverity): { border: string; text: string } {
  switch (s) {
    case 'high':
      return { border: 'border-danger/30', text: 'text-danger' };
    case 'medium':
      return { border: 'border-warn/30', text: 'text-warn' };
    default:
      return { border: 'border-b1', text: 'text-t3' };
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ScreenshotLeakCheckerTool() {
  const report = useReportResult();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  const [analysis, setAnalysis] = useState<ScreenshotAnalysis | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);
  const [preview, setPreview] = useState('');
  const [thumbUrl, setThumbUrl] = useState('');
  const [cleanUrl, setCleanUrl] = useState('');
  const [cleanName, setCleanName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Result bus: report whenever the analysis changes, clear when it is gone.
  useEffect(() => {
    report(analysis ? toResult(analysis) : null);
  }, [analysis, report]);
  useEffect(() => () => report(null), [report]);

  // Object URLs are revoked on replacement/unmount.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (thumbUrl) URL.revokeObjectURL(thumbUrl); }, [thumbUrl]);
  useEffect(() => () => { if (cleanUrl) URL.revokeObjectURL(cleanUrl); }, [cleanUrl]);

  const reset = useCallback(() => {
    fileRef.current = null;
    setAnalysis(null);
    setFileMeta(null);
    setPreview('');
    setThumbUrl('');
    setCleanUrl('');
    setCleanName('');
    setError('');
    setBusy(false);
    setCleaning(false);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const processFile = useCallback(async (file: File) => {
    setError('');
    setAnalysis(null);
    setThumbUrl('');
    setCleanUrl('');
    setCleanName('');

    if (file.size > MAX_BYTES) {
      setError(`That file is ${formatBytes(file.size)} — the limit is 25 MB.`);
      return;
    }
    fileRef.current = file;
    setFileMeta({ name: file.name, size: file.size });
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const raw = extractRaw(bytes, file.name);
      if (raw.format === 'unknown') {
        setError('Not a PNG, JPEG or WebP file (we checked the bytes, not the extension).');
        fileRef.current = null;
        setPreview('');
        return;
      }
      for (const item of [...raw.compressed]) {
        const text = await inflate(item.data);
        if (text !== null) resolveCompressedText(raw, item, text);
      }
      const a = assess(raw);
      if (a.thumbnail?.isJpeg) {
        setThumbUrl(URL.createObjectURL(new Blob([new Uint8Array(a.thumbnail.bytes)], { type: 'image/jpeg' })));
      }
      setAnalysis(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void processFile(f);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  };

  // Clean copy: decode → canvas → re-encode. The canvas only ever holds pixels,
  // so every metadata block (Exif, XMP, IPTC, PNG text, thumbnails) is gone.
  const downloadClean = async () => {
    const file = fileRef.current;
    if (!file || !analysis) return;
    setCleaning(true);
    const src = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('The browser could not decode this image, so a clean copy cannot be made.'));
        img.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable.');
      ctx.drawImage(img, 0, 0);
      const isPng = analysis.format === 'png';
      const blob: Blob | null = await new Promise((res) => (isPng ? canvas.toBlob(res, 'image/png') : canvas.toBlob(res, 'image/jpeg', 0.92)));
      if (!blob) throw new Error('Re-encoding failed.');
      setCleanUrl(URL.createObjectURL(blob));
      setCleanName(file.name.replace(/\.[^.]+$/, '') + (isPng ? '-clean.png' : '-clean.jpg'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clean copy failed.');
    } finally {
      URL.revokeObjectURL(src);
      setCleaning(false);
    }
  };

  const v = analysis ? verdictClasses(analysis.verdict) : null;
  const context = analysis ? contextLeaks(analysis) : [];
  const realPii = analysis ? analysis.pii.filter((p) => p.kind !== 'username') : [];
  const usernames = analysis ? analysis.pii.filter((p) => p.kind === 'username') : [];

  return (
    <div className="space-y-6">
      {/* Upload / drop zone */}
      <div
        data-testid="screenshot-drop-zone"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`bg-s0 border rounded-lg p-6 transition-colors ${dragging ? 'border-b2 bg-white/5' : 'border-b1'}`}
      >
        <label htmlFor="screenshot-leak-file" className="block text-sm font-medium text-t2 mb-3">
          Drop a screenshot here, or choose a file (PNG, JPEG or WebP, up to 25 MB)
        </label>
        <input
          id="screenshot-leak-file"
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onInput}
          className="w-full text-sm text-t2 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-white hover:file:bg-white/20"
        />
        <p className="mt-2 text-xs text-t3">
          Everything runs in your browser. The file never leaves your device — no upload, no network request, nothing stored.
        </p>
      </div>

      {error && (
        <div className="bg-s0 border border-danger/30 rounded-lg p-4 text-sm text-danger" role="alert">
          {error}
        </div>
      )}

      {busy && (
        <div className="bg-s0 border border-b1 rounded-lg p-4 text-sm text-t2">Reading the file…</div>
      )}

      {analysis && v && (
        <>
          {/* Verdict */}
          <div className={`border rounded-lg p-5 ${v.box}`}>
            <div className={`text-xs font-semibold uppercase tracking-wide ${v.text}`}>{v.label}</div>
            <h3 className="mt-1 text-lg font-semibold text-white">{analysis.headline}</h3>
            {fileMeta && (
              <p className="mt-1 text-xs text-t3 font-mono break-all">
                {fileMeta.name} · {formatBytes(fileMeta.size)} · {analysis.format.toUpperCase()}
                {analysis.info.map((i) => ` · ${i.value}`).join('')}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Leaks', value: String(analysis.counts.leaks), hot: analysis.counts.leaks > 0 },
                { label: 'GPS', value: analysis.counts.gps ? 'Yes' : 'No', hot: analysis.counts.gps },
                { label: 'Thumbnail', value: analysis.counts.thumbnail ? 'Yes' : 'No', hot: analysis.counts.thumbnail },
                { label: 'PII items', value: String(analysis.counts.pii), hot: analysis.counts.pii > 0 },
              ].map((s) => (
                <div key={s.label} className="bg-s0 border border-b1 rounded p-3">
                  <div className="text-xs text-t3">{s.label}</div>
                  <div className={`text-lg font-bold ${s.hot ? 'text-danger' : 'text-ok'}`}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Preview + embedded thumbnail side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {preview && (
              <div className="bg-s0 border border-b1 rounded-lg p-4">
                <div className="text-xs font-semibold text-white mb-2">What you see</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Preview of the screenshot you selected" className="w-full h-48 object-contain rounded bg-black/40" />
              </div>
            )}
            {analysis.thumbnail && (
              <div className="bg-s0 border border-danger/30 rounded-lg p-4">
                <div className="text-xs font-semibold text-danger mb-2">This is what the file also contains</div>
                {thumbUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={thumbUrl} alt="Thumbnail embedded inside the file's metadata" className="w-full h-48 object-contain rounded bg-black/40" />
                ) : (
                  <div className="h-48 flex items-center justify-center text-xs text-t3 text-center px-4">
                    A thumbnail block is present ({formatBytes(analysis.thumbnail.bytes.length)}) but it is not in a format the browser can display.
                  </div>
                )}
                <p className="mt-2 text-xs text-t3">
                  Embedded thumbnail, {formatBytes(analysis.thumbnail.bytes.length)}, from {analysis.thumbnail.source}. If you cropped or blurred this image, compare the two — the thumbnail may still show the original.
                </p>
              </div>
            )}
          </div>

          {/* Leaks */}
          <div className="bg-s0 border border-b1 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Leaks found ({analysis.leaks.length})</h3>
            {analysis.leaks.length === 0 ? (
              <p className="text-sm text-ok">Nothing hidden in the container or the file name. The visible content is still on you.</p>
            ) : (
              <div className="space-y-2">
                {analysis.leaks.map((l: Leak, i: number) => {
                  const c = severityClasses(l.severity);
                  return (
                    <div key={i} className={`border ${c.border} rounded-lg p-3`}>
                      <div className="flex items-start justify-between gap-3">
                        <code className="text-sm text-white font-mono break-all">{l.what}</code>
                        <span className={`shrink-0 text-xs ${c.text}`}>{l.severity}</span>
                      </div>
                      <div className="mt-1 text-xs text-t3">From: {l.source}</div>
                      <p className="mt-1 text-xs text-warn/80">{l.why}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* GPS */}
          {analysis.gps && (
            <div className="bg-s0 border border-danger/30 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-danger mb-2">GPS location embedded</h3>
              <code className="block text-lg text-white font-mono">
                {analysis.gps.latitude.toFixed(6)}, {analysis.gps.longitude.toFixed(6)}
              </code>
              {analysis.gps.altitude !== undefined && (
                <div className="mt-1 text-xs text-t2">Altitude: {analysis.gps.altitude.toFixed(1)} m</div>
              )}
              <div className="mt-1 text-xs text-t3">From: {analysis.gps.source}</div>
              <p className="mt-2 text-xs text-t3">
                Shown as numbers only. We do not load a map or contact any service — paste the pair into a map yourself if you want to see where it points.
              </p>
            </div>
          )}

          {/* Device / software / timestamps */}
          <div className="bg-s0 border border-b1 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Device, software and timestamps</h3>
            {context.length === 0 ? (
              <p className="text-sm text-t3">No device, software, identifier or timestamp fields.</p>
            ) : (
              <div className="space-y-2">
                {context.map((l, i) => (
                  <div key={i} className="flex flex-col md:flex-row md:items-baseline md:justify-between gap-1 border-b border-hair pb-2 last:border-0 last:pb-0">
                    <code className="text-sm text-t2 font-mono break-all">{l.what}</code>
                    <span className="text-xs text-t3 shrink-0">{l.category} · {l.source}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PII */}
          <div className="bg-s0 border border-b1 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Personal data ({analysis.pii.length})</h3>
            {analysis.pii.length === 0 ? (
              <p className="text-sm text-t3">No personal-data patterns in the metadata or the file name.</p>
            ) : (
              <div className="space-y-2">
                {[...realPii, ...usernames].map((p, i) => (
                  <div key={i} className={`border rounded-lg p-3 ${p.kind === 'username' ? 'border-warn/30' : 'border-danger/30'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-t2">{PII_KIND_LABEL[p.kind]}</span>
                      <span className={`text-xs shrink-0 ${p.kind === 'username' ? 'text-warn' : 'text-danger'}`}>{p.kind === 'username' ? 'medium' : 'high'}</span>
                    </div>
                    <code className="block mt-1 text-sm text-white font-mono break-all">{p.value}</code>
                    <div className="mt-1 text-xs text-t3">From: {p.source}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Every extracted field */}
          {(analysis.fields.length > 0 || analysis.compressed.length > 0) && (
            <details className="bg-s0 border border-b1 rounded-lg p-4">
              <summary className="text-sm font-semibold text-white cursor-pointer">
                All extracted metadata ({analysis.fields.length + analysis.compressed.length})
              </summary>
              <div className="mt-3 space-y-2">
                {analysis.fields.map((f, i) => (
                  <div key={i} className="border-b border-hair pb-2 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-white">{f.key}</span>
                      <span className="text-xs text-t3 shrink-0">{f.source}</span>
                    </div>
                    <code className="block text-sm text-t2 font-mono break-all whitespace-pre-wrap">{f.value}</code>
                  </div>
                ))}
                {analysis.compressed.map((c, i) => (
                  <div key={`c${i}`} className="border-b border-hair pb-2 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-white">{c.key}</span>
                      <span className="text-xs text-t3 shrink-0">{c.source}</span>
                    </div>
                    <code className="block text-sm text-warn/80 font-mono">compressed text present ({c.data.length} bytes), not decoded by this browser</code>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Actions */}
          <div className="bg-s0 border border-b1 rounded-lg p-4">
            <div className="flex flex-wrap gap-3 items-center">
              <button onClick={downloadClean} disabled={cleaning} className="btn-primary text-sm px-4 py-2">
                {cleaning ? 'Re-encoding…' : 'Download clean copy'}
              </button>
              {cleanUrl && (
                <a href={cleanUrl} download={cleanName} className="text-sm px-4 py-2 border border-ok/30 rounded text-ok hover:bg-ok-dim">
                  Save {cleanName}
                </a>
              )}
              <button
                onClick={reset}
                className="text-sm px-4 py-2 border border-b1 rounded text-t2 hover:text-white hover:border-b2"
              >
                Check another file
              </button>
            </div>
            <p className="mt-3 text-xs text-t3">
              The clean copy is made by drawing the decoded pixels onto a canvas and re-encoding, which drops every metadata block — Exif, XMP, IPTC, PNG text, the embedded thumbnail. PNG stays PNG and lossless. JPEG and WebP are saved as JPEG at quality 92, so they recompress slightly. The file name is reset too; pick a neutral one.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
