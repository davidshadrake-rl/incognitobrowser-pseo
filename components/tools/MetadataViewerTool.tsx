'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useReportResult } from './ResultContext';
import { ConsoleFrame, statusFromSeverity } from './ConsoleFrame';
import {
  FORMAT_LABEL,
  bytesLabel,
  inflatePending,
  readImageMetadata,
  summarizeMetadata,
  type ImageMetadata,
  type MetaField,
} from '@/lib/exif';

/**
 * What this viewer reads, in the words the page shows. It must match
 * lib/exif.ts, which does the reading: the /tools blurb, the registry's
 * How it works and Scoring copy and data/tools/* say the same thing.
 */
export const METADATA_VIEWER_READS =
  'Reads Exif tag by tag in JPEG, PNG, WebP and TIFF files: IFD0, the Exif, GPS and Interop directories, and IFD1 with its embedded thumbnail, in every Exif block the file holds rather than only the first. Also decodes the common XMP and IPTC fields, PNG text chunks and JPEG and GIF comments, and says so when a block holds none of the fields it decodes or a read stops early. Maker notes are listed by size, not decoded. HEIC and AVIF photos are recognised but not read, and so is BigTIFF.';

/** What the browser says about the file itself. Not stored inside the image, so not counted as its metadata. */
interface FileField {
  tag: string;
  value: string;
  privacy: 'medium' | 'low';
  warning?: string;
}

/** "IMG_4471.HEIC" -> "IMG_4471-clean.jpg": the clean copy is always re-encoded as JPEG. */
function cleanFileName(file: File): string {
  return file.name.replace(/\.[^.]+$/, '') + '-clean.jpg';
}

function getPrivacyColor(privacy: string) {
  switch (privacy) {
    case 'high':
      return 'text-danger border-danger/30';
    case 'medium':
      return 'text-warn border-warn/30';
    default:
      return 'text-ok border-ok/30';
  }
}

function FieldRow({ f }: { f: MetaField | FileField }) {
  return (
    <div className={`bg-s0 border ${getPrivacyColor(f.privacy).split(' ')[1]} rounded-lg p-4`}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-sm font-medium text-white min-w-0 break-words">{f.tag}</span>
        <span className={`text-xs shrink-0 ${getPrivacyColor(f.privacy).split(' ')[0]}`}>{f.privacy} risk</span>
      </div>
      <code className="block text-sm text-t2 font-mono break-all whitespace-pre-wrap">{f.value}</code>
      {f.warning && <p className="mt-1 text-xs text-warn/80">{f.warning}</p>}
    </div>
  );
}

export function MetadataViewerTool() {
  const [meta, setMeta] = useState<ImageMetadata | null>(null);
  const [reading, setReading] = useState(false);
  /** A read that failed: shown instead of the previous file's result. */
  const [error, setError] = useState('');
  const [fileFields, setFileFields] = useState<FileField[]>([]);
  // One rule for the console and the result bus: both read this summary.
  const summary = useMemo(() => (meta ? summarizeMetadata(meta) : null), [meta]);
  const report = useReportResult();
  useEffect(() => {
    if (!summary) { report(null); return; }
    report({ severity: summary.severity, headline: summary.headline, stats: summary.stats });
  }, [summary, report]);
  const [scanned, setScanned] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [thumbPreview, setThumbPreview] = useState('');
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [stripped, setStripped] = useState('');
  // The console stays mounted when a second file is chosen, so it is told when each read finished.
  const [runAt, setRunAt] = useState(0);
  // Reading is async (compressed PNG text is inflated); a newer file wins over a slower, older read.
  const readSeq = useRef(0);

  // Revoke object URLs on unmount or replacement. One effect per URL: a shared
  // effect's cleanup revoked the live preview every time a clean copy was made.
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);
  useEffect(() => () => { if (thumbPreview) URL.revokeObjectURL(thumbPreview); }, [thumbPreview]);
  useEffect(() => () => { if (stripped) URL.revokeObjectURL(stripped); }, [stripped]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      alert('File too large. Maximum size is 50MB.');
      return;
    }
    const seq = ++readSeq.current;
    setError('');

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    if (stripped) URL.revokeObjectURL(stripped);
    setStripped('');
    setCurrentFile(file);

    const url = URL.createObjectURL(file);
    setImagePreview(url);

    setReading(true);
    try {
      const buffer = await file.arrayBuffer();
      // readImageMetadata is synchronous, and every scan in it is linear and
      // capped, but a 50 MB file of metadata is still work: hand the browser a
      // turn first, so it paints "Reading…" instead of an unexplained pause.
      await new Promise((r) => setTimeout(r, 0));
      const m = readImageMetadata(buffer);
      await inflatePending(m);
      if (seq !== readSeq.current) return;

      // The embedded thumbnail, shown as the file stores it: it can differ from the picture.
      const thumb = m.thumbnail?.jpeg;
      setThumbPreview(thumb ? URL.createObjectURL(new Blob([thumb.slice()], { type: 'image/jpeg' })) : '');
      setFileFields([
        { tag: 'File Name', value: file.name, privacy: 'medium', warning: 'Travels with the file when you send it, and can reveal what it shows or who made it' },
        { tag: 'File Size', value: bytesLabel(file.size), privacy: 'low' },
        { tag: 'MIME Type', value: file.type || `image/${m.format}`, privacy: 'low' },
        { tag: 'Last Modified', value: new Date(file.lastModified).toLocaleString(), privacy: 'low', warning: "From your device's file system, not from inside the image" },
      ]);
      setMeta(m);
      setRunAt(Date.now());
      setScanned(true);
    } catch {
      // arrayBuffer() rejects when the file changed on disk between the pick
      // and the read (macOS raises NotReadableError routinely). Leaving the
      // last file's verdict on screen beside this file's picture would read as
      // this file's result, so clear it and say what happened.
      if (seq === readSeq.current) {
        setMeta(null);
        setFileFields([]);
        // The [thumbPreview] effect revokes the old URL when this clears it.
        setThumbPreview('');
        setScanned(false);
        setError(`${file.name} could not be read. It may have moved or changed since you chose it — choose it again.`);
      }
    } finally {
      // A file that cannot be read leaves the label behind otherwise. An older
      // read that lost the race must not clear the newer one's label.
      if (seq === readSeq.current) setReading(false);
    }
  };

  // Strip metadata by re-encoding the image through a <canvas>. Canvas decodes
  // only pixel data — no EXIF/GPS/author text survives. Output is a clean JPEG.
  // The button says "& download", so the download starts on this click; the
  // link it leaves behind is only a fallback (it used to be the only way to
  // actually save the file, which took a second, unexplained click).
  const stripMetadata = async () => {
    if (!currentFile) return;
    const img = new Image();
    const src = URL.createObjectURL(currentFile);
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Could not decode image (browser may not support this format natively — HEIC usually needs conversion first)'));
        img.src = src;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(img, 0, 0);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('Encode failed');
      const cleanUrl = URL.createObjectURL(blob);
      // The previous clean copy is revoked by the [stripped] effect's cleanup.
      setStripped(cleanUrl);
      const a = document.createElement('a');
      a.href = cleanUrl;
      a.download = cleanFileName(currentFile);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Strip failed');
    } finally {
      URL.revokeObjectURL(src);
    }
  };

  const openGpsOnMap = () => {
    const gps = meta?.gps;
    if (!gps) return;
    // OpenStreetMap, in a new tab, centred on the photo's coordinates.
    window.open(`https://www.openstreetmap.org/?mlat=${gps.latitude.toFixed(6)}&mlon=${gps.longitude.toFixed(6)}&zoom=16`, '_blank', 'noopener,noreferrer');
  };

  const groups = useMemo(() => {
    const map = new Map<string, MetaField[]>();
    for (const f of meta?.fields ?? []) {
      const list = map.get(f.group) ?? [];
      list.push(f);
      map.set(f.group, list);
    }
    return Array.from(map.entries());
  }, [meta]);

  const strippedName = currentFile ? cleanFileName(currentFile) : 'clean.jpg';
  const unread = summary?.severity === 'info';
  // Blocks were found and none of them produced a row: a pass/fail tally of
  // zeroes would read as "all clear", which is the opposite of what happened.
  const nothingDecoded = !unread && !!summary && !!meta && meta.fields.length === 0 && summary.undecoded.length > 0;
  const formatLabel = meta ? FORMAT_LABEL[meta.format] : '';
  const thumb = meta?.thumbnail;

  return (
    <div className="space-y-6">
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        <label htmlFor="metadata-file" className="block text-sm font-medium text-t2 mb-3">Choose an image to inspect its metadata</label>
        <input
          id="metadata-file"
          type="file"
          accept="image/*,.heic,.heif,.avif,.tif,.tiff"
          onChange={handleFile}
          className="w-full text-sm text-t2 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-white hover:file:bg-white/20"
        />
        {reading && <p className="mt-2 text-sm text-t2">Reading this file…</p>}
        {error && !reading && <p className="mt-2 text-sm text-warn">{error}</p>}
        <p className="mt-2 text-xs text-t3">{METADATA_VIEWER_READS}</p>
      </div>

      {scanned && meta && summary && (
        <ConsoleFrame
          engine="metadata-viewer"
          status={statusFromSeverity(summary.severity)}
          verdict={summary.severity === 'red' ? 'Exposed' : unread ? 'Not read' : nothingDecoded ? 'Not decoded' : undefined}
          checks={unread ? undefined : meta.fields.length}
          checksNoun={['field', 'fields']}
          runAt={runAt || undefined}
          tally={unread || nothingDecoded ? undefined : { fails: summary.high.length, warns: summary.medium.length, passes: summary.low.length }}
          statTiles={
            unread
              ? [
                  { label: 'Format', value: formatLabel },
                  { label: 'Metadata', value: 'Not read' },
                ]
              : nothingDecoded
              ? [
                  { label: 'Format', value: formatLabel },
                  { label: 'Blocks found', value: meta.blocks.length },
                  { label: 'Decoded fields', value: 0 },
                ]
              : [
                  { label: 'High risk', value: summary.high.length },
                  { label: 'Medium risk', value: summary.medium.length },
                  { label: 'Fields', value: meta.fields.length },
                  { label: 'GPS', value: summary.hasGps ? 'yes' : 'no' },
                ]
          }
        >
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {imagePreview && (
              <div className="bg-s0 border border-b1 rounded-lg p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Preview of the image you chose" className="w-full h-48 object-contain rounded" />
                <div className="mt-2 text-xs text-t3">Format: <span className="text-white">{formatLabel}</span></div>
              </div>
            )}
            <div className="space-y-4">
              {summary.high.length > 0 && (
                <div className="bg-s0 border border-b1 rounded-lg p-4">
                  <div className="p-3 bg-danger-dim rounded text-xs text-danger">
                    Fields that can locate or identify you: {Array.from(new Set(summary.high.map((f) => f.tag))).join(', ')}.
                  </div>
                </div>
              )}
              {thumb && (
                <div className="bg-s0 border border-b1 rounded-lg p-4">
                  <p className="text-sm font-medium text-white mb-1">Embedded thumbnail</p>
                  <p className="text-xs text-t2 mb-2">
                    {[thumb.format, thumb.width && thumb.height ? `${thumb.width} × ${thumb.height} px` : '', bytesLabel(thumb.size)].filter(Boolean).join(', ')}
                    {' '}(in {thumb.group}). Compare it with the picture: an edit to the picture does not always reach it.
                  </p>
                  {thumbPreview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbPreview} alt="The thumbnail stored inside the file" className="max-h-32 w-auto object-contain rounded border border-hair" />
                  )}
                </div>
              )}
            </div>
          </div>

          {meta.notes.length > 0 && (
            <div className={`bg-s0 border ${unread ? 'border-warn/30' : 'border-b1'} rounded-lg p-4`}>
              <ul className="space-y-1 text-xs text-t2">
                {meta.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Action bar */}
          <div className="bg-s0 border border-b1 rounded-lg p-4 flex flex-wrap gap-3 items-center">
            <button onClick={stripMetadata} className="btn-primary text-sm px-4 py-2">
              Strip metadata &amp; download
            </button>
            {summary.hasGps && (
              <button
                onClick={openGpsOnMap}
                className="text-sm px-4 py-2 border border-b1 rounded text-t2 hover:text-white hover:border-b2"
              >
                View GPS on map
              </button>
            )}
            {stripped && (
              <span className="text-sm text-t2">
                Didn&apos;t download?{' '}
                <a href={stripped} download={strippedName} className="text-ok underline underline-offset-4 hover:text-t1">
                  Save {strippedName}
                </a>
              </span>
            )}
          </div>

          {meta.blocks.length > 0 && (
            <div className="bg-s0 border border-b1 rounded-lg p-4">
              <p className="text-sm font-medium text-white mb-2">Metadata blocks found</p>
              <div className="flex flex-wrap gap-2">
                {meta.blocks.map((b) => (
                  <span key={`${b.kind}-${b.where}`} className="text-xs px-2 py-1 bg-white/5 rounded font-mono text-t2">
                    {b.kind} · {b.where} · {bytesLabel(b.size)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!unread && meta.fields.length === 0 && (
            <div className={`bg-s0 border ${summary.undecoded.length ? 'border-warn/30' : 'border-ok/30'} rounded-lg p-4 text-sm text-t2`}>
              {summary.undecoded.length ? (
                <>
                  <p>Nothing in this file was decoded into fields, and it is not empty. Found and not read: {summary.undecoded.join('; ')}.</p>
                  <p className="mt-1">A block this viewer does not decode can still hold a name, a place or a time. Save a clean copy if you are about to share the picture.</p>
                </>
              ) : meta.blocks.length ? (
                <>No location, device or time data in the fields this viewer reads. The blocks listed above were found; this viewer reads no field out of them.</>
              ) : (
                <>No Exif, XMP, IPTC or text metadata found in this file.</>
              )}
            </div>
          )}

          {groups.map(([group, list]) => (
            <section key={group} className="space-y-2">
              <h3 className="text-sm font-semibold text-white">
                {group} <span className="text-t3 font-normal">({list.length})</span>
              </h3>
              {list.map((f, i) => (
                <FieldRow key={`${group}-${i}`} f={f} />
              ))}
            </section>
          ))}

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-white">
              The file itself <span className="text-t3 font-normal">(what your browser reports; not stored inside the image)</span>
            </h3>
            {fileFields.map((f) => (
              <FieldRow key={f.tag} f={f} />
            ))}
          </section>
        </>
        </ConsoleFrame>
      )}
    </div>
  );
}
