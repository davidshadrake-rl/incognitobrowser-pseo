'use client';

import { useEffect, useState } from 'react';
import { useReportResult } from './ResultContext';

interface ExifField {
  tag: string;
  value: string;
  privacy: 'high' | 'medium' | 'low';
  warning?: string;
}

// ----------------------- PNG tEXt / iTXt / zTXt chunks ----------------------
function readPngMetadata(buffer: ArrayBuffer): ExifField[] {
  const view = new DataView(buffer);
  const fields: ExifField[] = [];
  // Signature: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (view.getUint8(i) !== sig[i]) return fields;

  let offset = 8;
  const decoder = new TextDecoder('latin1');
  while (offset < view.byteLength - 8) {
    const length = view.getUint32(offset);
    const type = decoder.decode(new Uint8Array(buffer, offset + 4, 4));
    const dataOffset = offset + 8;
    if (dataOffset + length > view.byteLength) break;

    if (type === 'tEXt') {
      const bytes = new Uint8Array(buffer, dataOffset, length);
      const nul = bytes.indexOf(0);
      if (nul > 0) {
        const key = decoder.decode(bytes.subarray(0, nul));
        const value = decoder.decode(bytes.subarray(nul + 1));
        fields.push({
          tag: `PNG: ${key}`,
          value: value.slice(0, 200),
          privacy: /author|creator|artist|copyright|gps|location|software/i.test(key) ? 'high' : 'medium',
        });
      }
    } else if (type === 'iTXt') {
      const bytes = new Uint8Array(buffer, dataOffset, length);
      const nul = bytes.indexOf(0);
      if (nul > 0) {
        const key = decoder.decode(bytes.subarray(0, nul));
        fields.push({
          tag: `PNG: ${key}`,
          value: '(international text payload present)',
          privacy: 'medium',
        });
      }
    } else if (type === 'eXIf') {
      // Some PNGs include an eXIf chunk — parse as raw EXIF
      parseExifData(new DataView(buffer, dataOffset, length), fields, /*pngExifChunk*/ true);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataOffset + length + 4; // skip CRC
  }
  return fields;
}

// ----------------------- JPEG EXIF parser (+ GPS IFD) -----------------------
function readJpegExif(buffer: ArrayBuffer): ExifField[] {
  const view = new DataView(buffer);
  const fields: ExifField[] = [];
  if (view.getUint16(0) !== 0xffd8) return fields;

  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      const length = view.getUint16(offset + 2);
      parseExifData(new DataView(buffer, offset + 4, length - 2), fields);
      break;
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      const segLen = view.getUint16(offset + 2);
      offset += 2 + segLen;
    }
  }
  return fields;
}

function toRational(data: DataView, off: number, littleEndian: boolean): number {
  const num = data.getUint32(off, littleEndian);
  const den = data.getUint32(off + 4, littleEndian);
  return den === 0 ? 0 : num / den;
}

function parseExifData(data: DataView, fields: ExifField[], pngExifChunk = false) {
  let tiffOffset = 0;
  if (!pngExifChunk) {
    // JPEG APP1: starts with "Exif\0\0"
    if (data.byteLength < 6) return;
    const exifHeader = String.fromCharCode(data.getUint8(0), data.getUint8(1), data.getUint8(2), data.getUint8(3));
    if (exifHeader !== 'Exif') return;
    tiffOffset = 6;
  }
  if (data.byteLength < tiffOffset + 8) return;

  const byteOrder = data.getUint16(tiffOffset);
  const littleEndian = byteOrder === 0x4949;

  const get16 = (off: number) => data.getUint16(tiffOffset + off, littleEndian);
  const get32 = (off: number) => data.getUint32(tiffOffset + off, littleEndian);

  const ifdOffset = get32(4);
  if (tiffOffset + ifdOffset + 2 > data.byteLength) return;
  const numEntries = get16(ifdOffset);

  const tagNames: Record<number, { name: string; privacy: ExifField['privacy']; warning?: string }> = {
    0x010f: { name: 'Camera Make', privacy: 'medium' },
    0x0110: { name: 'Camera Model', privacy: 'medium', warning: 'Reveals your device model' },
    0x0112: { name: 'Orientation', privacy: 'low' },
    0x011a: { name: 'X Resolution', privacy: 'low' },
    0x011b: { name: 'Y Resolution', privacy: 'low' },
    0x0131: { name: 'Software', privacy: 'medium', warning: 'Reveals editing software used' },
    0x0132: { name: 'Date/Time', privacy: 'high', warning: 'Shows when the photo was taken' },
    0x013b: { name: 'Artist', privacy: 'high', warning: 'May contain your name' },
    0x8298: { name: 'Copyright', privacy: 'medium' },
    0x8769: { name: 'Exif IFD Pointer', privacy: 'low' },
    0x8825: { name: 'GPS IFD Pointer', privacy: 'high', warning: 'GPS data present — location may be embedded!' },
    0xa420: { name: 'Image Unique ID', privacy: 'high', warning: 'Unique identifier that can track this image' },
  };

  let gpsIfdOffset = 0;

  for (let i = 0; i < numEntries && i < 50; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (tiffOffset + entryOffset + 12 > data.byteLength) break;

    const tag = get16(entryOffset);
    const type = get16(entryOffset + 2);
    const count = get32(entryOffset + 4);

    if (tag === 0x8825) gpsIfdOffset = get32(entryOffset + 8);

    const tagInfo = tagNames[tag];
    if (!tagInfo) continue;

    let value = '';
    if (type === 2) {
      const valueOffset = count > 4 ? get32(entryOffset + 8) : entryOffset + 8;
      const chars: string[] = [];
      for (let j = 0; j < Math.min(count - 1, 100); j++) {
        if (tiffOffset + valueOffset + j >= data.byteLength) break;
        const c = data.getUint8(tiffOffset + valueOffset + j);
        if (c === 0) break;
        chars.push(String.fromCharCode(c));
      }
      value = chars.join('');
    } else if (type === 3) {
      value = get16(entryOffset + 8).toString();
    } else if (type === 4) {
      value = get32(entryOffset + 8).toString();
    } else {
      value = `[${tagInfo.name} data present]`;
    }

    if (value && tagInfo.name !== 'Exif IFD Pointer' && tagInfo.name !== 'GPS IFD Pointer') {
      fields.push({ tag: tagInfo.name, value, privacy: tagInfo.privacy, warning: tagInfo.warning });
    }
  }

  // ------------- GPS IFD: actually decode coordinates -------------
  if (gpsIfdOffset && tiffOffset + gpsIfdOffset + 2 < data.byteLength) {
    const gpsEntries = get16(gpsIfdOffset);
    const gps: Record<number, number[] | string> = {};
    for (let i = 0; i < gpsEntries && i < 20; i++) {
      const entryOffset = gpsIfdOffset + 2 + i * 12;
      if (tiffOffset + entryOffset + 12 > data.byteLength) break;
      const tag = get16(entryOffset);
      const type = get16(entryOffset + 2);
      const count = get32(entryOffset + 4);
      const valOff = count * (type === 5 ? 8 : type === 2 ? 1 : 2) > 4 ? get32(entryOffset + 8) : entryOffset + 8;

      if (type === 2 /* ASCII */ && count > 0) {
        const chars: string[] = [];
        for (let j = 0; j < Math.min(count - 1, 10); j++) {
          if (tiffOffset + valOff + j >= data.byteLength) break;
          const c = data.getUint8(tiffOffset + valOff + j);
          if (c === 0) break;
          chars.push(String.fromCharCode(c));
        }
        gps[tag] = chars.join('');
      } else if (type === 5 /* RATIONAL */ && count > 0) {
        const vals: number[] = [];
        for (let k = 0; k < count && k < 3; k++) {
          if (tiffOffset + valOff + k * 8 + 8 > data.byteLength) break;
          vals.push(toRational(data, tiffOffset + valOff + k * 8, littleEndian));
        }
        gps[tag] = vals;
      }
    }

    const latRef = gps[0x0001] as string | undefined; // 'N' / 'S'
    const lat = gps[0x0002] as number[] | undefined;   // [deg, min, sec]
    const lonRef = gps[0x0003] as string | undefined; // 'E' / 'W'
    const lon = gps[0x0004] as number[] | undefined;
    const altRef = gps[0x0005] as string | undefined;
    const alt = gps[0x0006] as number[] | undefined;

    if (lat && lat.length === 3 && lon && lon.length === 3) {
      const latDec = (lat[0] + lat[1] / 60 + lat[2] / 3600) * (latRef === 'S' ? -1 : 1);
      const lonDec = (lon[0] + lon[1] / 60 + lon[2] / 3600) * (lonRef === 'W' ? -1 : 1);
      const dms = `${Math.trunc(lat[0])}° ${Math.trunc(lat[1])}' ${lat[2].toFixed(2)}" ${latRef ?? ''}, ${Math.trunc(lon[0])}° ${Math.trunc(lon[1])}' ${lon[2].toFixed(2)}" ${lonRef ?? ''}`;
      fields.push({
        tag: 'GPS Coordinates',
        value: `${latDec.toFixed(6)}, ${lonDec.toFixed(6)}  (${dms})`,
        privacy: 'high',
        warning: 'Exact location where the photo was taken — strip before sharing publicly',
      });
    }
    if (alt && alt.length >= 1) {
      fields.push({
        tag: 'GPS Altitude',
        value: `${alt[0].toFixed(1)} m${altRef === '\x01' ? ' (below sea level)' : ''}`,
        privacy: 'high',
      });
    }
  }
}

// ------------- Format detection -------------
type ImageFormat = 'jpeg' | 'png' | 'heic' | 'webp' | 'gif' | 'tiff' | 'unknown';

function detectFormat(buffer: ArrayBuffer): ImageFormat {
  if (buffer.byteLength < 12) return 'unknown';
  const view = new DataView(buffer);
  const b0 = view.getUint8(0);
  const b1 = view.getUint8(1);
  const b2 = view.getUint8(2);
  const b3 = view.getUint8(3);
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'jpeg';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'png';
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return 'gif';
  if ((b0 === 0x49 && b1 === 0x49 && view.getUint16(2) === 0x2a00) || (b0 === 0x4d && b1 === 0x4d && view.getUint16(2) === 0x002a)) return 'tiff';

  // HEIC / HEIF: 'ftyp' at offset 4, brand in {heic, heix, mif1, msf1, heim, heis}
  const brand = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
  if (brand === 'ftyp') {
    const major = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (/^(heic|heix|mif1|msf1|heim|heis|hevc|hevx)$/.test(major)) return 'heic';
  }
  // WebP: 'RIFF' .... 'WEBP'
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
    const webp = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (webp === 'WEBP') return 'webp';
  }
  return 'unknown';
}

function getPrivacyColor(privacy: string) {
  switch (privacy) {
    case 'high':
      return 'text-red-400 border-red-500/20';
    case 'medium':
      return 'text-yellow-400 border-yellow-500/20';
    default:
      return 'text-green-400 border-green-500/20';
  }
}

export function MetadataViewerTool() {
  const [fields, setFields] = useState<ExifField[]>([]);
  const report = useReportResult();
  useEffect(() => {
    if (!fields.length) { report(null); return; }
    const high = fields.filter((x) => x.privacy === 'high').length;
    const gps = fields.some((x) => /gps|latitude|longitude/i.test(x.tag));
    const exifCount = Math.max(0, fields.length - 4);
    report({
      severity: gps || high > 0 ? 'red' : exifCount > 0 ? 'amber' : 'green',
      headline: gps ? `This photo carries the GPS location where it was taken` : high ? `This photo carries ${high} identifying metadata fields` : exifCount ? `This photo carries ${exifCount} metadata fields` : 'This photo carries no embedded metadata',
      stats: [{ label: 'High-risk', value: String(high) }, { label: 'GPS', value: gps ? 'yes' : 'no' }, { label: 'Fields', value: String(exifCount) }],
    });
  }, [fields, report]);
  const [format, setFormat] = useState<ImageFormat>('unknown');
  const [scanned, setScanned] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [stripped, setStripped] = useState('');

  // Revoke object URLs on unmount or replacement.
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      if (stripped) URL.revokeObjectURL(stripped);
    };
  }, [imagePreview, stripped]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      alert('File too large. Maximum size is 50MB.');
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    if (stripped) URL.revokeObjectURL(stripped);
    setStripped('');
    setCurrentFile(file);

    const url = URL.createObjectURL(file);
    setImagePreview(url);

    const buffer = await file.arrayBuffer();
    const fmt = detectFormat(buffer);
    setFormat(fmt);

    let exif: ExifField[] = [];
    if (fmt === 'jpeg') exif = readJpegExif(buffer);
    else if (fmt === 'png') exif = readPngMetadata(buffer);
    else if (fmt === 'heic') {
      exif = [
        {
          tag: 'Format',
          value: 'HEIC/HEIF detected',
          privacy: 'medium',
          warning:
            'HEIC uses a container format where EXIF is embedded inside an ISOBMFF box. Full parsing requires a heavy decoder — upload after conversion to JPEG for full inspection. Most HEICs still contain GPS and camera data.',
        },
      ];
    } else if (fmt === 'webp' || fmt === 'gif' || fmt === 'tiff') {
      exif = [{ tag: 'Format', value: fmt.toUpperCase(), privacy: 'low', warning: `${fmt.toUpperCase()} container metadata inspection is limited in this viewer.` }];
    } else {
      exif = [{ tag: 'Format', value: 'Unrecognized image format', privacy: 'low' }];
    }

    const all: ExifField[] = [
      { tag: 'File Name', value: file.name, privacy: 'medium', warning: 'File names can reveal info about content or creator' },
      { tag: 'File Size', value: `${(file.size / 1024).toFixed(1)} KB`, privacy: 'low' },
      { tag: 'MIME Type', value: file.type || `image/${fmt}`, privacy: 'low' },
      { tag: 'Last Modified', value: new Date(file.lastModified).toLocaleString(), privacy: 'medium', warning: 'Shows when the file was last saved' },
      ...exif,
    ];

    setFields(all);
    setScanned(true);
  };

  // Strip metadata by re-encoding the image through a <canvas>. Canvas decodes
  // only pixel data — no EXIF/GPS/author text survives. Output is a clean JPEG.
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
      if (stripped) URL.revokeObjectURL(stripped);
      setStripped(URL.createObjectURL(blob));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Strip failed');
    } finally {
      URL.revokeObjectURL(src);
    }
  };

  const openGpsOnMap = () => {
    const gps = fields.find((f) => f.tag === 'GPS Coordinates');
    if (!gps) return;
    const m = gps.value.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    if (!m) return;
    // OpenStreetMap — no tracking, no account.
    window.open(`https://www.openstreetmap.org/?mlat=${m[1]}&mlon=${m[2]}&zoom=16`, '_blank', 'noopener,noreferrer');
  };

  const highRisk = fields.filter((f) => f.privacy === 'high');
  const medRisk = fields.filter((f) => f.privacy === 'medium');
  const hasGps = fields.some((f) => f.tag === 'GPS Coordinates');
  const strippedName = currentFile ? currentFile.name.replace(/\.[^.]+$/, '') + '-clean.jpg' : 'clean.jpg';

  return (
    <div className="space-y-6">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <label className="block text-sm font-medium text-[#B8B8D4] mb-3">Upload an image to inspect its metadata</label>
        <input
          type="file"
          accept="image/*,.heic,.heif"
          onChange={handleFile}
          className="w-full text-sm text-[#B8B8D4] file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-white hover:file:bg-white/20"
        />
        <p className="mt-2 text-xs text-[#B8B8D4]/60">
          Supports JPEG (full EXIF + GPS), PNG (tEXt/iTXt chunks), HEIC (basic detection), WebP, GIF, TIFF. Processed entirely in your browser.
        </p>
      </div>

      {scanned && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {imagePreview && (
              <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="Uploaded preview" className="w-full h-48 object-contain rounded" />
                <div className="mt-2 text-xs text-[#B8B8D4]/60">Format: <span className="text-white uppercase">{format}</span></div>
              </div>
            )}
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Privacy Risk Summary</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">High Risk Fields</span>
                  <span className={`text-sm font-bold ${highRisk.length > 0 ? 'text-red-400' : 'text-green-400'}`}>{highRisk.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">Medium Risk Fields</span>
                  <span className={`text-sm font-bold ${medRisk.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{medRisk.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">Total Fields</span>
                  <span className="text-sm font-bold text-white">{fields.length}</span>
                </div>
              </div>
              {highRisk.length > 0 && (
                <div className="mt-3 p-3 bg-red-500/10 rounded text-xs text-red-400">
                  This image contains sensitive metadata that could reveal your identity or location.
                </div>
              )}
            </div>
          </div>

          {/* Action bar */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 flex flex-wrap gap-3 items-center">
            <button onClick={stripMetadata} className="btn-primary text-sm px-4 py-2">
              Strip metadata &amp; download
            </button>
            {hasGps && (
              <button
                onClick={openGpsOnMap}
                className="text-sm px-4 py-2 border border-white/10 rounded text-[#B8B8D4] hover:text-white hover:border-white/30"
              >
                View GPS on map
              </button>
            )}
            {stripped && (
              <a href={stripped} download={strippedName} className="text-sm px-4 py-2 border border-green-500/20 rounded text-green-400 hover:bg-green-500/10">
                Download clean image ({strippedName})
              </a>
            )}
          </div>

          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={i} className={`bg-[#0a0a0a] border ${getPrivacyColor(f.privacy).split(' ')[1]} rounded-lg p-4`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">{f.tag}</span>
                  <span className={`text-xs ${getPrivacyColor(f.privacy).split(' ')[0]}`}>{f.privacy} risk</span>
                </div>
                <code className="block text-sm text-[#B8B8D4] font-mono break-all">{f.value}</code>
                {f.warning && <p className="mt-1 text-xs text-yellow-400/80">{f.warning}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
