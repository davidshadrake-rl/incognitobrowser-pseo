/**
 * Screenshot Leak Checker — pure extraction + assessment engine.
 *
 * Framework-free: operates on Uint8Array / strings only. No DOM, no network.
 * Two phases so the UI layer can plug in browser-only decoding (deflate for
 * compressed PNG text) between them:
 *
 *   const raw = extractRaw(bytes, fileName);   // walk PNG / JPEG / WebP containers
 *   ...optionally resolveCompressedText(raw, item, text) per raw.compressed[]...
 *   const analysis = assess(raw);              // PII scan, leak list, verdict, headline
 *
 * `analyzeImage()` runs both back-to-back for callers that do not need the
 * intermediate step (tests, workers).
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'unknown';
export type Verdict = 'red' | 'amber' | 'green';
export type LeakSeverity = 'high' | 'medium' | 'low';
export type LeakCategory =
  | 'gps'
  | 'thumbnail'
  | 'pii'
  | 'username'
  | 'device'
  | 'software'
  | 'timestamp'
  | 'identifier'
  | 'text';

export interface MetaField {
  /** Human label, e.g. "Software", "Date/time original", "Creator tool". */
  key: string;
  value: string;
  /** Where in the container it was found, e.g. "PNG tEXt chunk". */
  source: string;
}

export interface GpsFix {
  latitude: number;
  longitude: number;
  altitude?: number;
  source: string;
}

export interface ThumbnailInfo {
  bytes: Uint8Array;
  source: string;
  /** True when the bytes start with a JPEG SOI marker and can be shown directly. */
  isJpeg: boolean;
}

export type PiiKind = 'email' | 'phone' | 'address' | 'coordinates' | 'iban' | 'card' | 'handle' | 'name' | 'username';

export interface PiiHit {
  kind: PiiKind;
  value: string;
  source: string;
}

export interface CompressedText {
  key: string;
  source: string;
  /** zlib (RFC 1950) stream — DecompressionStream('deflate') decodes it. */
  data: Uint8Array;
}

export interface Leak {
  category: LeakCategory;
  severity: LeakSeverity;
  what: string;
  source: string;
  why: string;
}

export interface RawExtraction {
  format: ImageFormat;
  fileName: string;
  /** Key/value metadata that can carry information about you. */
  fields: MetaField[];
  /** Neutral container facts (pixel density, dimensions). */
  info: MetaField[];
  gps: GpsFix | null;
  thumbnail: ThumbnailInfo | null;
  /** Compressed PNG text blocks the pure engine cannot inflate on its own. */
  compressed: CompressedText[];
}

export interface ScreenshotAnalysis extends RawExtraction {
  pii: PiiHit[];
  leaks: Leak[];
  verdict: Verdict;
  headline: string;
  counts: { leaks: number; pii: number; gps: boolean; thumbnail: boolean };
}

// ───────────────────────────── byte helpers ─────────────────────────────

const u16be = (b: Uint8Array, o: number): number => ((b[o] << 8) | b[o + 1]) >>> 0;
const u16le = (b: Uint8Array, o: number): number => ((b[o + 1] << 8) | b[o]) >>> 0;
const u32be = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number): number => ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;

function latin1(b: Uint8Array, start = 0, end = b.length): string {
  let s = '';
  const stop = Math.min(end, b.length);
  for (let i = start; i < stop; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** UTF-8 when valid, Latin-1 otherwise (EXIF strings are nominally ASCII but often UTF-8 in practice). */
function decodeText(b: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(b);
    } catch {
      /* fall through */
    }
  }
  return latin1(b);
}

function decodeUtf16(b: Uint8Array, littleEndian: boolean): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    const c = littleEndian ? u16le(b, i) : u16be(b, i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

const MAX_VALUE = 4000;
function clean(s: string): string {
  // Strip C0 controls except tab/newline, trim, cap length.
  const out = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
  return out.length > MAX_VALUE ? out.slice(0, MAX_VALUE) + '…' : out;
}

function indexOfNul(b: Uint8Array, from = 0): number {
  for (let i = from; i < b.length; i++) if (b[i] === 0) return i;
  return -1;
}

function pushField(out: RawExtraction, key: string, value: string, source: string): void {
  const v = clean(value);
  if (!v) return;
  out.fields.push({ key, value: v, source });
}

// ───────────────────────────── format detection ─────────────────────────────

export function detectFormat(b: Uint8Array): ImageFormat {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && latin1(b, 0, 4) === 'RIFF' && latin1(b, 8, 12) === 'WEBP') return 'webp';
  return 'unknown';
}

// ───────────────────────────── XMP ─────────────────────────────

const XMP_KEYS: Array<[string, string]> = [
  ['xmp:CreatorTool', 'Creator tool'],
  ['xmp:CreateDate', 'Create date'],
  ['xmp:ModifyDate', 'Modify date'],
  ['xmp:MetadataDate', 'Metadata date'],
  ['xmp:Label', 'Label'],
  ['xmpMM:DocumentID', 'Document ID'],
  ['xmpMM:InstanceID', 'Instance ID'],
  ['xmpMM:OriginalDocumentID', 'Original document ID'],
  ['tiff:Make', 'Make'],
  ['tiff:Model', 'Model'],
  ['exif:DateTimeOriginal', 'Date/time original'],
  ['exif:UserComment', 'User comment'],
  ['aux:SerialNumber', 'Body serial number'],
  ['aux:LensSerialNumber', 'Lens serial number'],
  ['aux:Lens', 'Lens model'],
  ['dc:creator', 'Creator'],
  ['dc:description', 'Description'],
  ['dc:title', 'Title'],
  ['dc:subject', 'Keywords'],
  ['dc:rights', 'Rights'],
  ['photoshop:History', 'Photoshop history'],
  ['photoshop:City', 'City'],
  ['photoshop:State', 'Province/state'],
  ['photoshop:Country', 'Country'],
  ['photoshop:Credit', 'Credit'],
  ['photoshop:Source', 'Source'],
  ['photoshop:Headline', 'Headline'],
  ['photoshop:AuthorsPosition', 'Author position'],
  ['Iptc4xmpCore:Location', 'Location'],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** All values of a qualified XMP name, in attribute form or element form (rdf:li lists flattened). */
function xmpValues(xml: string, qname: string): string[] {
  const esc = escapeRe(qname);
  const vals: string[] = [];
  let m: RegExpExecArray | null;
  const attrD = new RegExp(`[\\s<]${esc}\\s*=\\s*"([^"]*)"`, 'g');
  while ((m = attrD.exec(xml))) vals.push(m[1]);
  const attrS = new RegExp(`[\\s<]${esc}\\s*=\\s*'([^']*)'`, 'g');
  while ((m = attrS.exec(xml))) vals.push(m[1]);
  const el = new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc}>`, 'g');
  const li = /<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/g;
  while ((m = el.exec(xml))) {
    const inner = m[1];
    let hadLi = false;
    let l: RegExpExecArray | null;
    li.lastIndex = 0;
    while ((l = li.exec(inner))) {
      hadLi = true;
      vals.push(l[1]);
    }
    if (!hadLi && !/<rdf:(Seq|Bag|Alt)/.test(inner)) vals.push(inner);
  }
  return vals.map((v) => clean(decodeEntities(v.replace(/<[^>]+>/g, ' ')))).filter(Boolean);
}

/** "51,30.0437N" | "51,30,2.6N" | "51.5007" → decimal degrees (NaN when unparseable). */
function parseXmpCoord(s: string): number {
  const t = s.trim();
  const refMatch = /([NSEW])$/i.exec(t);
  const ref = refMatch ? refMatch[1].toUpperCase() : '';
  const body = ref ? t.slice(0, -1) : t;
  const parts = body.split(',').map((p) => parseFloat(p.trim()));
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return NaN;
  const deg = Math.abs(parts[0]) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  const negative = ref === 'S' || ref === 'W' || parts[0] < 0;
  return negative ? -deg : deg;
}

function parseRationalString(s: string): number | undefined {
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(s);
  if (m) return Number(m[2]) === 0 ? undefined : Number(m[1]) / Number(m[2]);
  const n = parseFloat(s);
  return Number.isNaN(n) ? undefined : n;
}

/** Extract the interesting keys from an XMP packet. Exported for tests. */
export function parseXmpPacket(xml: string, source: string): { fields: MetaField[]; gps: GpsFix | null } {
  // The element regexes below are O(n²) on a hostile packet; real XMP is a few KB.
  const MAX_XMP = 1 << 20;
  if (xml.length > MAX_XMP) xml = xml.slice(0, MAX_XMP);
  const fields: MetaField[] = [];
  for (const [q, label] of XMP_KEYS) {
    const vals = uniq(xmpValues(xml, q));
    if (vals.length) fields.push({ key: label, value: vals.join('; '), source });
  }
  // xmpMM:History — the edit trail (which app, when, how many saves).
  const agents = uniq(xmpValues(xml, 'stEvt:softwareAgent'));
  if (agents.length) fields.push({ key: 'Edit history software', value: agents.join('; '), source });
  const whens = xmpValues(xml, 'stEvt:when');
  if (whens.length) {
    const value = whens.length > 1 ? `${whens[0]} → ${whens[whens.length - 1]} (${whens.length} events)` : whens[0];
    fields.push({ key: 'Edit history dates', value, source });
  }
  const actions = xmpValues(xml, 'stEvt:action');
  if (actions.length) fields.push({ key: 'Edit history actions', value: `${actions.length} event${actions.length === 1 ? '' : 's'}: ${uniq(actions).join(', ')}`, source });

  let gps: GpsFix | null = null;
  const lat = xmpValues(xml, 'exif:GPSLatitude')[0];
  const lon = xmpValues(xml, 'exif:GPSLongitude')[0];
  if (lat && lon) {
    const la = parseXmpCoord(lat);
    const lo = parseXmpCoord(lon);
    if (!Number.isNaN(la) && !Number.isNaN(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
      gps = { latitude: la, longitude: lo, source };
      const alt = xmpValues(xml, 'exif:GPSAltitude')[0];
      const altN = alt ? parseRationalString(alt) : undefined;
      if (altN !== undefined) {
        const altRef = xmpValues(xml, 'exif:GPSAltitudeRef')[0];
        gps.altitude = altRef === '1' ? -altN : altN;
      }
    }
  }
  return { fields, gps };
}

function absorbXmp(xml: string, source: string, out: RawExtraction): void {
  const { fields, gps } = parseXmpPacket(xml, source);
  out.fields.push(...fields);
  if (gps && !out.gps) out.gps = gps;
}

// ───────────────────────────── TIFF / EXIF ─────────────────────────────

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOff: number;
  size: number;
}

const IFD0_TAGS: Record<number, string> = {
  0x010e: 'Image description',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x0132: 'Modify date',
  0x013b: 'Artist',
  0x013c: 'Host computer',
  0x8298: 'Copyright',
  0x9c9b: 'Windows title',
  0x9c9c: 'Windows comment',
  0x9c9d: 'Windows author',
  0x9c9e: 'Windows keywords',
  0x9c9f: 'Windows subject',
};

const EXIF_TAGS: Record<number, string> = {
  0x9003: 'Date/time original',
  0x9004: 'Date/time digitized',
  0x9286: 'User comment',
  0xa420: 'Image unique ID',
  0xa430: 'Owner name',
  0xa431: 'Body serial number',
  0xa434: 'Lens model',
  0xa435: 'Lens serial number',
};

function parseTiff(input: Uint8Array, source: string, out: RawExtraction): void {
  let t = input;
  if (t.length >= 6 && latin1(t, 0, 4) === 'Exif' && t[4] === 0 && t[5] === 0) t = t.subarray(6);
  if (t.length < 8) return;
  let le: boolean;
  if (t[0] === 0x49 && t[1] === 0x49) le = true;
  else if (t[0] === 0x4d && t[1] === 0x4d) le = false;
  else return;
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? u16le(t, o) : u16be(t, o)) : 0);
  const u32 = (o: number) => (o + 4 <= t.length ? (le ? u32le(t, o) : u32be(t, o)) : 0);
  if (u16(2) !== 42) return;

  const readIfd = (off: number): { entries: IfdEntry[]; next: number } | null => {
    if (off <= 0 || off + 2 > t.length) return null;
    const n = Math.min(u16(off), 512);
    const entries: IfdEntry[] = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > t.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const valueOff = size > 4 ? u32(e + 8) : e + 8;
      entries.push({ tag, type, count, valueOff, size });
    }
    const nextOff = off + 2 + n * 12;
    return { entries, next: nextOff + 4 <= t.length ? u32(nextOff) : 0 };
  };

  const bytesOf = (e: IfdEntry): Uint8Array => {
    if (e.valueOff >= t.length) return new Uint8Array(0);
    return t.subarray(e.valueOff, Math.min(e.valueOff + e.size, t.length));
  };
  const ascii = (e: IfdEntry): string => {
    const b = bytesOf(e);
    const nul = indexOfNul(b);
    return decodeText(nul >= 0 ? b.subarray(0, nul) : b);
  };
  const scalar = (e: IfdEntry): number => {
    if (e.type === 3 || e.type === 8) return u16(e.valueOff);
    if (e.type === 4 || e.type === 9) return u32(e.valueOff);
    if (e.type === 1 || e.type === 6 || e.type === 7) return e.valueOff < t.length ? t[e.valueOff] : 0;
    return 0;
  };
  const rationals = (e: IfdEntry): number[] => {
    const vals: number[] = [];
    for (let k = 0; k < Math.min(e.count, 8); k++) {
      const o = e.valueOff + k * 8;
      if (o + 8 > t.length) break;
      const num = u32(o);
      const den = u32(o + 4);
      vals.push(den === 0 ? 0 : num / den);
    }
    return vals;
  };
  const userComment = (e: IfdEntry): string => {
    const b = bytesOf(e);
    if (b.length >= 8) {
      const prefix = latin1(b, 0, 8);
      const rest = b.subarray(8);
      if (prefix.startsWith('ASCII')) return decodeText(rest);
      if (prefix.startsWith('UNICODE')) return decodeUtf16(rest, le);
      if (prefix.startsWith('JIS')) return decodeText(rest);
      if (/^\0{8}$/.test(prefix)) return decodeText(rest);
    }
    return decodeText(b);
  };
  const valueOf = (e: IfdEntry, tagName: string): string => {
    if (e.type === 2) return ascii(e);
    if (tagName.startsWith('Windows ')) return decodeUtf16(bytesOf(e), true);
    if (e.tag === 0x9286) return userComment(e);
    if (e.type === 7 || e.type === 1) return decodeText(bytesOf(e));
    if (e.type === 3 || e.type === 4 || e.type === 8 || e.type === 9) return String(scalar(e));
    if (e.type === 5 || e.type === 10) return rationals(e).map((n) => String(n)).join(', ');
    return '';
  };

  const ifd0 = readIfd(u32(4));
  if (!ifd0) return;
  let exifPtr = 0;
  let gpsPtr = 0;
  for (const e of ifd0.entries) {
    if (e.tag === 0x8769) exifPtr = scalar(e);
    else if (e.tag === 0x8825) gpsPtr = scalar(e);
    else if (IFD0_TAGS[e.tag]) pushField(out, IFD0_TAGS[e.tag], valueOf(e, IFD0_TAGS[e.tag]), `${source} → IFD0`);
  }

  const exif = readIfd(exifPtr);
  if (exif) {
    for (const e of exif.entries) {
      if (EXIF_TAGS[e.tag]) pushField(out, EXIF_TAGS[e.tag], valueOf(e, EXIF_TAGS[e.tag]), `${source} → Exif IFD`);
    }
  }

  const gps = readIfd(gpsPtr);
  if (gps) {
    let latRef = '';
    let lonRef = '';
    let lat: number[] = [];
    let lon: number[] = [];
    let altRef = 0;
    let alt: number | undefined;
    let dateStamp = '';
    let timeStamp: number[] = [];
    for (const e of gps.entries) {
      switch (e.tag) {
        case 0x0001: latRef = ascii(e).trim().toUpperCase(); break;
        case 0x0002: lat = rationals(e); break;
        case 0x0003: lonRef = ascii(e).trim().toUpperCase(); break;
        case 0x0004: lon = rationals(e); break;
        case 0x0005: altRef = scalar(e); break;
        case 0x0006: alt = rationals(e)[0]; break;
        case 0x0007: timeStamp = rationals(e); break;
        case 0x001d: dateStamp = ascii(e).trim(); break;
      }
    }
    if (lat.length && lon.length && !out.gps) {
      const toDec = (p: number[]) => (p[0] || 0) + (p[1] || 0) / 60 + (p[2] || 0) / 3600;
      const la = toDec(lat) * (latRef === 'S' ? -1 : 1);
      const lo = toDec(lon) * (lonRef === 'W' ? -1 : 1);
      if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
        out.gps = { latitude: la, longitude: lo, source: `${source} → GPS IFD` };
        if (alt !== undefined) out.gps.altitude = altRef === 1 ? -alt : alt;
      }
    }
    if (dateStamp || timeStamp.length === 3) {
      const time = timeStamp.length === 3 ? ` ${timeStamp.map((n) => String(Math.trunc(n)).padStart(2, '0')).join(':')} UTC` : '';
      pushField(out, 'GPS date/time', `${dateStamp}${time}`, `${source} → GPS IFD`);
    }
  }

  // IFD1 — the embedded thumbnail. Older editors leave the ORIGINAL thumbnail
  // in place after a crop/redaction, so this can show what you cut out.
  const ifd1 = readIfd(ifd0.next);
  if (ifd1) {
    let thumbOff = 0;
    let thumbLen = 0;
    for (const e of ifd1.entries) {
      if (e.tag === 0x0201) thumbOff = scalar(e);
      else if (e.tag === 0x0202) thumbLen = scalar(e);
    }
    if (thumbOff > 0 && thumbLen > 0 && thumbOff < t.length) {
      const bytes = t.subarray(thumbOff, Math.min(thumbOff + thumbLen, t.length));
      if (bytes.length > 0 && !out.thumbnail) {
        out.thumbnail = {
          bytes,
          source: `${source} → IFD1 (JPEGInterchangeFormat)`,
          isJpeg: bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8,
        };
      }
    }
  }
}

// ───────────────────────────── PNG ─────────────────────────────

const XMP_PNG_KEY = 'XML:com.adobe.xmp';

function parsePng(b: Uint8Array, out: RawExtraction): void {
  let off = 8;
  while (off + 8 <= b.length) {
    const len = u32be(b, off);
    const type = latin1(b, off + 4, off + 8);
    const dataStart = off + 8;
    // Honour the declared length: a chunk that runs past EOF ends the walk.
    if (len > b.length - dataStart) break;
    const data = b.subarray(dataStart, dataStart + len);

    if (type === 'IHDR' && len >= 8) {
      out.info.push({ key: 'Dimensions', value: `${u32be(data, 0)} × ${u32be(data, 4)} px`, source: 'PNG IHDR chunk' });
    } else if (type === 'tEXt') {
      const nul = indexOfNul(data);
      if (nul > 0) {
        const key = latin1(data, 0, nul);
        const value = latin1(data, nul + 1);
        if (key === XMP_PNG_KEY) absorbXmp(value, 'PNG tEXt XMP packet', out);
        else pushField(out, key, value, 'PNG tEXt chunk');
      }
    } else if (type === 'iTXt') {
      const nul = indexOfNul(data);
      if (nul > 0 && nul + 2 < data.length) {
        const key = latin1(data, 0, nul);
        const compressed = data[nul + 1] === 1;
        let p = nul + 3; // skip compression flag + method
        const langEnd = indexOfNul(data, p);
        const tkeyEnd = langEnd < 0 ? -1 : indexOfNul(data, langEnd + 1);
        if (langEnd >= 0 && tkeyEnd >= 0) {
          p = tkeyEnd + 1;
          const payload = data.subarray(p);
          if (compressed) {
            out.compressed.push({ key, source: 'PNG iTXt chunk (compressed)', data: payload });
          } else {
            const text = decodeText(payload);
            if (key === XMP_PNG_KEY) absorbXmp(text, 'PNG iTXt XMP packet', out);
            else pushField(out, key, text, 'PNG iTXt chunk');
          }
        }
      }
    } else if (type === 'zTXt') {
      const nul = indexOfNul(data);
      if (nul > 0 && nul + 2 <= data.length) {
        const key = latin1(data, 0, nul);
        out.compressed.push({ key, source: 'PNG zTXt chunk (compressed)', data: data.subarray(nul + 2) });
      }
    } else if (type === 'eXIf') {
      parseTiff(data, 'PNG eXIf chunk', out);
    } else if (type === 'pHYs' && len >= 9) {
      const x = u32be(data, 0);
      const y = u32be(data, 4);
      const metre = data[8] === 1;
      const dpi = metre ? ` (≈ ${Math.round(x * 0.0254)} × ${Math.round(y * 0.0254)} DPI)` : '';
      out.info.push({ key: 'Pixel density', value: `${x} × ${y} pixels per ${metre ? 'metre' : 'unit'}${dpi}`, source: 'PNG pHYs chunk' });
    } else if (type === 'tIME' && len >= 7) {
      const y = u16be(data, 0);
      const pad = (n: number) => String(n).padStart(2, '0');
      pushField(out, 'Last modification time', `${y}-${pad(data[2])}-${pad(data[3])} ${pad(data[4])}:${pad(data[5])}:${pad(data[6])} UTC`, 'PNG tIME chunk');
    } else if (type === 'IEND') {
      break;
    }
    off = dataStart + len + 4; // skip CRC
  }
}

/** UI hook: after inflating a compressed PNG text block, fold it into the extraction. */
export function resolveCompressedText(raw: RawExtraction, item: CompressedText, text: string): void {
  const idx = raw.compressed.indexOf(item);
  if (idx >= 0) raw.compressed.splice(idx, 1);
  const source = item.source.replace(' (compressed)', ' (inflated)');
  if (item.key === XMP_PNG_KEY) absorbXmp(text, `${source} XMP packet`, raw);
  else pushField(raw, item.key, text, source);
}

// ───────────────────────────── JPEG ─────────────────────────────

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/';

function parseApp13(seg: Uint8Array, out: RawExtraction): void {
  if (latin1(seg, 0, 13) !== 'Photoshop 3.0') return;
  let off = 14;
  while (off + 12 <= seg.length) {
    if (latin1(seg, off, off + 4) !== '8BIM') break;
    const id = u16be(seg, off + 4);
    const nameLen = seg[off + 6];
    let p = off + 7 + nameLen;
    if ((nameLen + 1) & 1) p++; // name (incl. length byte) padded to even
    if (p + 4 > seg.length) break;
    const size = u32be(seg, p);
    p += 4;
    if (p + size > seg.length) break;
    if (id === 0x0404) parseIptc(seg.subarray(p, p + size), out);
    off = p + size + (size & 1);
  }
}

const IPTC_DATASETS: Record<number, string> = {
  5: 'Object name',
  25: 'Keywords',
  80: 'By-line',
  85: 'By-line title',
  90: 'City',
  92: 'Sub-location',
  95: 'Province/state',
  101: 'Country',
  105: 'Headline',
  110: 'Credit',
  115: 'Source',
  116: 'Copyright notice',
  120: 'Caption',
  122: 'Caption writer',
};

function parseIptc(d: Uint8Array, out: RawExtraction): void {
  const acc = new Map<string, string[]>();
  let off = 0;
  while (off + 5 <= d.length) {
    if (d[off] !== 0x1c) { off++; continue; }
    const rec = d[off + 1];
    const ds = d[off + 2];
    let size = u16be(d, off + 3);
    let p = off + 5;
    if (size & 0x8000) {
      const n = size & 0x7fff;
      if (n > 4 || p + n > d.length) break;
      size = 0;
      for (let i = 0; i < n; i++) size = size * 256 + d[p + i];
      p += n;
    }
    if (p + size > d.length) break;
    if (rec === 2 && IPTC_DATASETS[ds]) {
      const label = IPTC_DATASETS[ds];
      const list = acc.get(label) ?? [];
      list.push(clean(decodeText(d.subarray(p, p + size))));
      acc.set(label, list);
    }
    off = p + size;
  }
  for (const [label, values] of acc) pushField(out, label, values.filter(Boolean).join('; '), 'JPEG APP13 IPTC');
}

function parseJpeg(b: Uint8Array, out: RawExtraction): void {
  let off = 2;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) break;
    const marker = b[off + 1];
    if (marker === 0xff) { off++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    if (marker === 0xd9) break; // EOI
    const len = u16be(b, off + 2);
    if (len < 2) break;
    const segStart = off + 4;
    const segEnd = off + 2 + len;
    if (segEnd > b.length) break;
    const seg = b.subarray(segStart, segEnd);

    if (marker === 0xda) {
      break; // SOS — entropy-coded image data follows, no more metadata segments we can trust
    } else if (marker === 0xe1) {
      if (seg.length >= 6 && latin1(seg, 0, 4) === 'Exif' && seg[4] === 0 && seg[5] === 0) {
        parseTiff(seg.subarray(6), 'JPEG APP1 Exif', out);
      } else if (seg.length > XMP_HEADER.length && latin1(seg, 0, XMP_HEADER.length) === XMP_HEADER) {
        absorbXmp(decodeText(seg.subarray(XMP_HEADER.length + 1)), 'JPEG APP1 XMP packet', out);
      }
    } else if (marker === 0xed) {
      parseApp13(seg, out);
    } else if (marker === 0xfe) {
      pushField(out, 'Comment', decodeText(seg), 'JPEG COM segment');
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (seg.length >= 5) out.info.push({ key: 'Dimensions', value: `${u16be(seg, 3)} × ${u16be(seg, 1)} px`, source: 'JPEG SOF segment' });
    }
    off = segEnd;
  }
}

// ───────────────────────────── WebP ─────────────────────────────

function parseWebp(b: Uint8Array, out: RawExtraction): void {
  let off = 12;
  while (off + 8 <= b.length) {
    const fourcc = latin1(b, off, off + 4);
    const size = u32le(b, off + 4);
    const start = off + 8;
    if (size > b.length - start) break;
    const data = b.subarray(start, start + size);
    if (fourcc === 'EXIF') parseTiff(data, 'WebP EXIF chunk', out);
    else if (fourcc === 'XMP ') absorbXmp(decodeText(data), 'WebP XMP chunk', out);
    else if (fourcc === 'VP8X' && size >= 10) {
      const w = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
      const h = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
      out.info.push({ key: 'Dimensions', value: `${w} × ${h} px`, source: 'WebP VP8X chunk' });
    }
    off = start + size + (size & 1);
  }
}

// ───────────────────────────── phase 1: extraction ─────────────────────────────

export function extractRaw(input: Uint8Array | ArrayBuffer, fileName = ''): RawExtraction {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out: RawExtraction = {
    format: detectFormat(b),
    fileName,
    fields: [],
    info: [],
    gps: null,
    thumbnail: null,
    compressed: [],
  };
  try {
    if (out.format === 'png') parsePng(b, out);
    else if (out.format === 'jpeg') parseJpeg(b, out);
    else if (out.format === 'webp') parseWebp(b, out);
  } catch {
    // A malformed container must never take the tool down — report what we have.
  }
  return out;
}

// ───────────────────────────── PII scanning ─────────────────────────────

export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

const RE_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const RE_CARD = /(^|[^0-9A-Za-z])((?:\d[ -]?){12,18}\d)(?![0-9A-Za-z])/g;
const RE_IBAN = /(^|[^A-Za-z0-9])([A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30})(?![A-Za-z0-9])/g;
const RE_PHONE = /(^|[^A-Za-z0-9:+])(\+?\d[\d\s().-]{6,18}\d)(?![A-Za-z0-9:])/g;
const RE_ADDRESS = /\b\d{1,5}[a-z]?\s+(?:[a-z'.-]+\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|close|crescent|square|sq|highway|hwy|parkway|pkwy|gardens|grove|row|walk)\b\.?/gi;
const RE_COORDS = /(^|[^0-9.\-])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?![0-9.])/g;
const RE_HANDLE = /(^|[^A-Za-z0-9_.@/])@([A-Za-z0-9_]{2,30})(?![A-Za-z0-9_@]|\.[A-Za-z])/g;
const RE_USER_PATH = /(?:[A-Za-z]:\\+Users\\+|\/Users\/|\/home\/)([^\\/\s"'<>|:*?]+)/g;
const GENERIC_USERS = new Set(['public', 'default', 'shared', 'guest', 'all users', 'default user', 'defaultuser', 'administrator', 'admin', 'user']);

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** Scan one string for personal data. Exported for tests. */
export function scanPii(text: string, source: string): PiiHit[] {
  const hits: PiiHit[] = [];
  const add = (kind: PiiKind, value: string) => {
    const v = value.trim();
    if (v && !hits.some((h) => h.kind === kind && h.value === v)) hits.push({ kind, value: v, source });
  };
  if (!text) return hits;
  let m: RegExpExecArray | null;

  RE_EMAIL.lastIndex = 0;
  while ((m = RE_EMAIL.exec(text))) add('email', m[0]);

  const cardDigits = new Set<string>();
  RE_CARD.lastIndex = 0;
  while ((m = RE_CARD.exec(text))) {
    const d = digitsOnly(m[2]);
    if (luhnValid(d)) {
      cardDigits.add(d);
      add('card', m[2].trim());
    }
  }

  RE_IBAN.lastIndex = 0;
  while ((m = RE_IBAN.exec(text))) if (ibanValid(m[2])) add('iban', m[2]);

  RE_PHONE.lastIndex = 0;
  while ((m = RE_PHONE.exec(text))) {
    const cand = m[2].trim();
    const d = digitsOnly(cand);
    if (d.length < 9 || d.length > 15) continue;
    if (cardDigits.has(d)) continue;
    if (/\d{4}[-.\s]\d{2}[-.\s]\d{2}/.test(cand)) continue; // date, not a number
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cand)) continue; // IPv4
    const bare = /^\d+$/.test(cand);
    if (bare && !(d.length === 10 || d.length === 11)) continue; // bare digit runs: only common national lengths
    add('phone', cand);
  }

  RE_ADDRESS.lastIndex = 0;
  while ((m = RE_ADDRESS.exec(text))) add('address', m[0]);

  RE_COORDS.lastIndex = 0;
  while ((m = RE_COORDS.exec(text))) {
    const la = parseFloat(m[2]);
    const lo = parseFloat(m[3]);
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180) add('coordinates', `${m[2]}, ${m[3]}`);
  }

  RE_HANDLE.lastIndex = 0;
  while ((m = RE_HANDLE.exec(text))) add('handle', `@${m[2]}`);

  RE_USER_PATH.lastIndex = 0;
  while ((m = RE_USER_PATH.exec(text))) {
    const name = m[1];
    if (!GENERIC_USERS.has(name.toLowerCase())) add('username', name);
  }
  return hits;
}

// ───────────────────────────── phase 2: assessment ─────────────────────────────

const NAME_KEYS = /^(artist|author|owner name|creator|by-line|caption writer|windows author)$/i;
const TIMESTAMP_KEYS = /date|time/i;
const DEVICE_KEYS = /^(make|model|lens model|host computer)$/i;
const SOFTWARE_KEYS = /software|creator tool|photoshop history|edit history/i;
const IDENTIFIER_KEYS = /serial|document id|instance id|unique id/i;
const SOFTWARE_HINTS = /screenshot|screen ?shot|screen ?capture|snipping|snip & sketch|skitch|cleanshot|shottr|lightshot|greenshot|sharex|flameshot|monosnap|xnip|android|\bios\b|iphone|ipad|macos|mac os|os x|windows|pixel|samsung|one ?ui|miui|huawei|xiaomi|oneplus|chrome ?os|ubuntu|gnome|kde/i;

const PII_LABELS: Record<PiiKind, [string, string]> = {
  email: ['email address', 'email addresses'],
  phone: ['phone number', 'phone numbers'],
  address: ['street address', 'street addresses'],
  coordinates: ['coordinate pair', 'coordinate pairs'],
  iban: ['bank account number', 'bank account numbers'],
  card: ['payment card number', 'payment card numbers'],
  handle: ['@handle', '@handles'],
  name: ['name', 'names'],
  username: ['username', 'usernames'],
};

const PII_WHY: Record<PiiKind, string> = {
  email: 'An email address ties the image to a real account and invites phishing or lookup across breach data.',
  phone: 'A phone number can be reverse-searched to a name, carrier and often a home region.',
  address: 'A street address places you (or someone else) at a physical location.',
  coordinates: 'A decimal latitude/longitude pair pinpoints a place to within a few metres.',
  iban: 'A bank account identifier can be used for fraud and social engineering.',
  card: 'A number that passes the card checksum — treat it as a live payment card.',
  handle: 'A social handle links this file to a public profile and everything on it.',
  name: 'A personal name in an authorship field attributes the file to a real person.',
  username: 'A username from a file path reveals your account name and often your real name or employer naming scheme.',
};

function plural(n: number, forms: [string, string]): string {
  return `${n} ${n === 1 ? forms[0] : forms[1]}`;
}

function joinHuman(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function fmtCoord(n: number): string {
  return n.toFixed(6);
}

export function assess(raw: RawExtraction): ScreenshotAnalysis {
  const pii: PiiHit[] = [];
  const addPii = (list: PiiHit[]) => {
    for (const h of list) if (!pii.some((p) => p.kind === h.kind && p.value === h.value)) pii.push(h);
  };

  addPii(scanPii(raw.fileName, 'file name'));
  for (const f of raw.fields) {
    const src = `${f.key} (${f.source})`;
    addPii(scanPii(f.value, src));
    if (NAME_KEYS.test(f.key) && f.value.trim()) addPii([{ kind: 'name', value: f.value.trim(), source: src }]);
  }

  const leaks: Leak[] = [];

  if (raw.gps) {
    const alt = raw.gps.altitude !== undefined ? `, altitude ${raw.gps.altitude.toFixed(1)} m` : '';
    leaks.push({
      category: 'gps',
      severity: 'high',
      what: `GPS location ${fmtCoord(raw.gps.latitude)}, ${fmtCoord(raw.gps.longitude)}${alt}`,
      source: raw.gps.source,
      why: 'Exact coordinates of where the picture was taken — usually a home, workplace or the place you are right now.',
    });
  }

  if (raw.thumbnail) {
    const kb = (raw.thumbnail.bytes.length / 1024).toFixed(1);
    leaks.push({
      category: 'thumbnail',
      severity: 'high',
      what: `Embedded thumbnail (${kb} KB${raw.thumbnail.isJpeg ? ', JPEG' : ''})`,
      source: raw.thumbnail.source,
      why: 'A second, smaller copy of the image travels inside the file. Editors that crop or blur the main picture often leave the ORIGINAL thumbnail untouched — the thing you removed may still be visible.',
    });
  }

  for (const h of pii) {
    leaks.push({
      category: h.kind === 'username' ? 'username' : 'pii',
      severity: h.kind === 'username' ? 'medium' : 'high',
      what: `${PII_LABELS[h.kind][0].replace(/^./, (c) => c.toUpperCase())}: ${h.value}`,
      source: h.source,
      why: PII_WHY[h.kind],
    });
  }

  for (const f of raw.fields) {
    const key = f.key;
    if (NAME_KEYS.test(key)) continue; // already reported as PII
    if (SOFTWARE_KEYS.test(key)) {
      const hint = SOFTWARE_HINTS.exec(f.value);
      leaks.push({
        category: hint ? 'device' : 'software',
        severity: 'medium',
        what: `${key}: ${f.value}`,
        source: f.source,
        why: hint
          ? `"${hint[0]}" tells a reader which operating system or capture app you use — a device fingerprint that narrows down who you are.`
          : 'Names the software that produced or edited the file, which hints at your platform and workflow.',
      });
    } else if (DEVICE_KEYS.test(key)) {
      leaks.push({
        category: 'device',
        severity: 'medium',
        what: `${key}: ${f.value}`,
        source: f.source,
        why: 'Identifies the hardware that made the image. Combined with other files it becomes a fingerprint for your device.',
      });
    } else if (IDENTIFIER_KEYS.test(key)) {
      leaks.push({
        category: 'identifier',
        severity: 'medium',
        what: `${key}: ${f.value}`,
        source: f.source,
        why: 'A unique identifier that stays constant across files — it lets anyone link everything you have ever published from the same device or document.',
      });
    } else if (TIMESTAMP_KEYS.test(key)) {
      leaks.push({
        category: 'timestamp',
        severity: 'medium',
        what: `${key}: ${f.value}`,
        source: f.source,
        why: 'Reveals exactly when the image was captured or edited — enough to place you somewhere at a given time or to catch a doctored "old" screenshot.',
      });
    } else {
      leaks.push({
        category: 'text',
        severity: 'low',
        what: `${key}: ${f.value.length > 160 ? f.value.slice(0, 160) + '…' : f.value}`,
        source: f.source,
        why: 'Free-text metadata that never shows on screen. Read it before you share — comments and descriptions are where people forget things.',
      });
    }
  }

  for (const c of raw.compressed) {
    leaks.push({
      category: 'text',
      severity: 'medium',
      what: `Compressed text block "${c.key}" (${c.data.length} bytes) present, not decoded`,
      source: c.source,
      why: 'Hidden text is stored compressed inside the file. It could be anything from a software name to a full document — assume it is readable by anyone who looks.',
    });
  }

  const order: Record<LeakSeverity, number> = { high: 0, medium: 1, low: 2 };
  leaks.sort((a, b) => order[a.severity] - order[b.severity]);

  const realPii = pii.filter((p) => p.kind !== 'username');
  const hasAmber = leaks.some((l) => l.severity === 'medium');

  let verdict: Verdict = 'green';
  if (raw.gps || raw.thumbnail || realPii.length) verdict = 'red';
  else if (hasAmber || leaks.length) verdict = 'amber';

  // Headline: "This screenshot leaks GPS location, an embedded thumbnail and 1 email address"
  const parts: string[] = [];
  if (raw.gps) parts.push('GPS location');
  if (raw.thumbnail) parts.push('an embedded thumbnail');
  const byKind = new Map<PiiKind, number>();
  for (const p of pii) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
  for (const kind of Object.keys(PII_LABELS) as PiiKind[]) {
    const n = byKind.get(kind);
    if (n) parts.push(plural(n, PII_LABELS[kind]));
  }
  const cats = new Set(leaks.map((l) => l.category));
  if (cats.has('device') || cats.has('software')) parts.push('device/software details');
  if (cats.has('identifier')) parts.push('a unique identifier');
  if (cats.has('timestamp')) parts.push('timestamps');
  if (!parts.length && cats.has('text')) parts.push('hidden text metadata');

  const headline = parts.length
    ? `This screenshot leaks ${joinHuman(parts)}`
    : 'This screenshot carries no hidden metadata we could detect';

  return {
    ...raw,
    pii,
    leaks,
    verdict,
    headline,
    counts: { leaks: leaks.length, pii: pii.length, gps: !!raw.gps, thumbnail: !!raw.thumbnail },
  };
}

/** One-shot convenience: extraction + assessment (no inflation of compressed PNG text). */
export function analyzeImage(input: Uint8Array | ArrayBuffer, fileName = ''): ScreenshotAnalysis {
  return assess(extractRaw(input, fileName));
}

/** Leaks grouped for the UI's "device / software / timestamps" panel. */
export function contextLeaks(a: ScreenshotAnalysis): Leak[] {
  return a.leaks.filter((l) => l.category === 'device' || l.category === 'software' || l.category === 'timestamp' || l.category === 'identifier');
}
