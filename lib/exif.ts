/**
 * The metadata reader behind the Image Metadata Viewer
 * (components/tools/MetadataViewerTool.tsx). Pure: bytes in, rows out, with
 * no DOM and no network, so tests can feed it files they build themselves.
 *
 * What it reads. The tool's copy (its "Reads ..." line, the /tools blurb,
 * the registry's How it works and Scoring text, data/tools/*) states exactly
 * this, so change them together:
 *
 *   Exif, walked as a whole TIFF structure: IFD0, the Exif IFD (0x8769), the
 *   GPS IFD (0x8825), the Interop IFD (0xA005) and IFD1, the embedded
 *   thumbnail; in TIFF files also the directories after IFD1 and any SubIFDs
 *   (0x014A). Every entry becomes a row, named from the tables below, or
 *   "Tag 0x…" when the tag is not a standard one. The only entries without a
 *   row of their own are the pointers to other directories (the directory is
 *   listed instead), the thumbnail's offset and length (one "Embedded
 *   Thumbnail" row) and the GPS reference letters (folded into the value they
 *   qualify). Maker notes are listed by size, not decoded.
 *   Exif is found in JPEG APP1, PNG eXIf chunks, WebP EXIF chunks, TIFF files
 *   themselves, and the "Raw profile type exif" text ImageMagick writes to PNG.
 *   Every Exif block in a file is read, not only the first: a second APP1 can
 *   hold the GPS the first one does not. LIMITS.perFile.exif caps how many,
 *   and the file is marked as not fully read once that cap is reached.
 *
 *   XMP (JPEG APP1, PNG text, WebP XMP chunk, TIFF tag 700, Photoshop
 *   resources, GIF application extension): detected, and the common fields in
 *   XMP_FIELDS decoded — a packet holding none of them is reported as found
 *   and not decoded, never as an absence of metadata.
 *   IPTC (Photoshop resources in JPEG APP13 or TIFF tag 34377, TIFF tag
 *   33723): detected, record 2 datasets decoded. PNG text chunks (compressed
 *   ones through inflatePending, where the browser has DecompressionStream),
 *   JPEG and GIF comments, JFIF and Photoshop thumbnails. ICC profiles,
 *   Multi-Picture extra images, Content Credentials (C2PA) and any other JPEG
 *   APP segment or PNG chunk this viewer does not decode: presence only, and
 *   named in `undecoded` so the verdict cannot call the file clean. HEIC, HEIF and AVIF, and a TIFF variant this
 *   viewer cannot walk (BigTIFF, a broken header): the file is recognised,
 *   nothing inside it is read, and the verdict says so instead of scoring it.
 *
 * Hostile files: every read is bounds-checked against the buffer; each TIFF
 * block keeps a set of the directory offsets it has visited, so a pointer back
 * to one of them ends that branch instead of looping; and every count is
 * capped (directories, entries per directory, rows, bytes per value, container
 * segments, XMP length, decompressed size). Every scan of an XMP packet is
 * linear in its length, so a packet of bare '<' cannot stall the page.
 *
 * Whenever anything stops a read — a cap, a truncated file, a structure that
 * breaks off, a variant this viewer does not walk — the reader says so in
 * `undecoded` (or, when nothing at all was read, in `unread`), and
 * summarizeMetadata() refuses to call the file clean on that evidence. A path
 * that only notes what happened, without one of those two, is a bug: it hands
 * back a green verdict for a file the viewer did not finish reading.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'tiff' | 'gif' | 'heic' | 'avif' | 'unknown';
export type Risk = 'high' | 'medium' | 'low';

export interface MetaField {
  /** The standard name of the tag, or "Tag 0x…" when it is not in the tables below. */
  tag: string;
  value: string;
  privacy: Risk;
  warning?: string;
  /** Where the row was read: "IFD0", "Exif IFD", "GPS IFD", "Interop IFD", "IFD1 (thumbnail)", "XMP", "IPTC", "PNG text"… */
  group: string;
  /** The TIFF/Exif tag number, for rows read from a directory entry. */
  id?: number;
}

export interface GpsPosition {
  latitude: number;
  longitude: number;
  altitude?: number;
  group: string;
}

export interface ThumbnailInfo {
  /** "JPEG", "Uncompressed", … */
  format: string;
  /** Bytes the file gives the thumbnail. */
  size: number;
  width?: number;
  height?: number;
  group: string;
  /** The thumbnail's own bytes (a view into the file), when it is a JPEG the page can show. */
  jpeg?: Uint8Array;
}

export type BlockKind =
  | 'Exif'
  | 'XMP'
  | 'IPTC'
  | 'Photoshop resources'
  | 'ICC profile'
  | 'Multi-Picture images'
  | 'Content Credentials (C2PA)'
  | 'PNG text'
  | 'Comment';

/** A metadata block found in the file, with where it sits and its size in bytes. */
export interface MetaBlock {
  kind: BlockKind;
  where: string;
  size: number;
}

/** A compressed PNG text chunk, waiting for inflatePending(). */
export interface PendingText {
  key: string;
  where: string;
  data: Uint8Array;
  utf8: boolean;
}

export interface ImageMetadata {
  format: ImageFormat;
  fields: MetaField[];
  blocks: MetaBlock[];
  gps: GpsPosition | null;
  thumbnail: ThumbnailInfo | null;
  /** HEIC/HEIF/AVIF: the format is recognised and its metadata is not read. */
  unread: boolean;
  /** Plain-language notes about what was not read, and why. */
  notes: string[];
  /**
   * Short phrases for what was found and could not be read: an XMP block
   * holding no field this viewer decodes, extra images, JPEG segments it does
   * not decode, a cap that stopped the read. The verdict reads them, so it
   * never calls a file clean on the strength of a block it did not decode.
   * ICC profiles are not listed: they are colour tables, they appear in
   * `blocks`, and no verdict here says they are absent.
   */
  undecoded: string[];
  pending: PendingText[];
  /** True once the row cap was reached. */
  truncated: boolean;
}

export const LIMITS = {
  /** Directories read per TIFF block (the visited set also stops loops). */
  ifdsPerBlock: 32,
  entriesPerIfd: 1000,
  fields: 1500,
  /** Bytes read from any single value. */
  valueBytes: 16 * 1024,
  /** Numbers shown from an array value before "… (N values)". */
  shownValues: 16,
  shownChars: 2000,
  /** JPEG segments, PNG/WebP chunks, Photoshop resources. */
  segments: 4000,
  xmpChars: 512 * 1024,
  /** Per compressed PNG text chunk, and for all of them together. */
  inflatedBytes: 4 * 1024 * 1024,
  inflatedTotal: 8 * 1024 * 1024,
  pendingTexts: 64,
  subIfds: 8,
  /** Blocks of one kind read per file: a file made of thousands of them must not multiply the work. */
  perFile: { exif: 4, xmp: 8, iptc: 8, photoshop: 8 },
} as const;

export const FORMAT_LABEL: Record<ImageFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  tiff: 'TIFF',
  gif: 'GIF',
  heic: 'HEIC',
  avif: 'AVIF',
  unknown: 'Unknown',
};

// ───────────────────────────── copy used by several rows ─────────────────────────────

const TEXT_WARN = 'Free text written by a person or an app: it can hold names, places or notes';
const DEVICE_WARN = 'Reveals the device that took the photo';
const SOFTWARE_WARN = 'Reveals the app or version that wrote the file';
const SERIAL_WARN = 'Identifies the camera body: photos from the same device can be linked to each other';
const NAME_WARN = "A person's name";
const REGION_WARN = 'A name written against a face or a region of the picture';
const PLACE_WARN = 'A place name';
const CONTACT_WARN = 'Contact details';
const LOCATION_WARN = 'Where the photo was taken, as coordinates. Remove it before sharing publicly';
const TZ_WARN = 'The time zone, which narrows down the region';
const DOCID_WARN = 'A unique ID for the source document: every copy exported from it carries the same ID';
const THUMB_WARN =
  "A small copy of the picture, stored separately from it. Editors that crop or blur a photo don't always update it, so it can still show what was removed";
const C2PA_WARN =
  'A signed record of how the image was made or edited. It can name the device or app that made it, the edits and who signed it. This viewer does not decode it';
const LOOP_NOTE = 'A directory in this file points back to one already read (a loop). It was read once.';

// ───────────────────────────── byte helpers ─────────────────────────────

const u16be = (b: Uint8Array, o: number): number => (o >= 0 && o + 2 <= b.length ? (b[o] << 8) | b[o + 1] : 0);
const u32be = (b: Uint8Array, o: number): number =>
  o >= 0 && o + 4 <= b.length ? b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) : 0;
const u32le = (b: Uint8Array, o: number): number =>
  o >= 0 && o + 4 <= b.length ? b[o + 3] * 0x1000000 + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) : 0;

function latin1(b: Uint8Array, start = 0, end = b.length): string {
  const s = Math.max(0, start);
  const e = Math.min(end, b.length);
  let out = '';
  for (let i = s; i < e; i += 8192) {
    out += String.fromCharCode.apply(null, Array.from(b.subarray(i, Math.min(e, i + 8192))));
  }
  return out;
}

function startsWith(b: Uint8Array, sig: string): boolean {
  if (b.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig.charCodeAt(i)) return false;
  return true;
}

let utf8Decoder: TextDecoder | null | undefined;
/** UTF-8 when the bytes are valid UTF-8, Latin-1 otherwise (Exif strings are nominally ASCII, often UTF-8 in practice). */
function decodeText(b: Uint8Array): string {
  if (utf8Decoder === undefined) utf8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;
  if (utf8Decoder) {
    try {
      return utf8Decoder.decode(b);
    } catch {
      /* not UTF-8 */
    }
  }
  return latin1(b);
}

function utf16(b: Uint8Array, littleEndian: boolean): string {
  let le = littleEndian;
  let o = 0;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) { le = true; o = 2; }
  else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { le = false; o = 2; }
  let s = '';
  for (let i = o; i + 1 < b.length; i += 2) {
    const c = le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Exif's 8-byte character-code prefix (UserComment, GPSProcessingMethod, GPSAreaInformation). */
function charsetText(b: Uint8Array, le: boolean): string {
  if (b.length < 8) return decodeText(b);
  const prefix = latin1(b, 0, 8);
  const rest = b.subarray(8);
  if (prefix.startsWith('ASCII') || prefix.startsWith('JIS') || prefix === '\0\0\0\0\0\0\0\0') return decodeText(rest);
  if (prefix.startsWith('UNICODE')) return utf16(rest, le);
  return decodeText(b);
}

function cleanText(s: string): string {
  return s.replace(/[ --]/g, '').trim();
}

/** True when the bytes read as plain text (trailing NULs allowed). */
function printable(b: Uint8Array): boolean {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  if (end === 0) return false;
  for (let i = 0; i < end; i++) {
    const c = b[i];
    if (!(c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e))) return false;
  }
  return true;
}

export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A number as people write it: integers plain, fractions to 6 significant digits. */
function num(v: number): string {
  if (!Number.isFinite(v) || Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(6)));
}

function ratText(n: number, d: number): string {
  if (d === 0) return n === 0 ? '0' : `${n}/0`;
  return num(n / d);
}

function uniq<T>(list: T[]): T[] {
  return list.filter((v, i) => list.indexOf(v) === i);
}

// ───────────────────────────── output helpers ─────────────────────────────

/** True once the row cap is reached (and says so, once). Checked before any costly decoding. */
function full(out: ImageMetadata): boolean {
  if (out.fields.length < LIMITS.fields) return false;
  if (!out.truncated) {
    out.truncated = true;
    note(out, `Stopped listing after ${LIMITS.fields.toLocaleString('en-US')} fields.`);
    cannotDecode(out, `more fields than this viewer lists (it stopped at ${LIMITS.fields.toLocaleString('en-US')})`);
  }
  return true;
}

function addField(out: ImageMetadata, f: MetaField): void {
  if (full(out)) return;
  const value = f.value.length > LIMITS.shownChars ? `${f.value.slice(0, LIMITS.shownChars)}…` : f.value;
  out.fields.push({ ...f, value });
}

type BudgetKey = keyof typeof LIMITS.perFile;
const budgets = new WeakMap<ImageMetadata, Record<BudgetKey, number>>();
const BLOCK_NAME: Record<BudgetKey, string> = { exif: 'Exif', xmp: 'XMP', iptc: 'IPTC', photoshop: 'Photoshop resource' };

/** Count one more block of a kind against the per-file limit; false (and a note) once it is spent. */
function spend(out: ImageMetadata, key: BudgetKey): boolean {
  let b = budgets.get(out);
  if (!b) {
    b = { exif: 0, xmp: 0, iptc: 0, photoshop: 0 };
    budgets.set(out, b);
  }
  if (b[key] >= LIMITS.perFile[key]) {
    note(out, `Only the first ${LIMITS.perFile[key]} ${BLOCK_NAME[key]} blocks in this file were read.`);
    cannotDecode(out, `more ${BLOCK_NAME[key]} blocks than this viewer reads (it stopped at ${LIMITS.perFile[key]})`);
    return false;
  }
  b[key]++;
  return true;
}

function addBlock(out: ImageMetadata, kind: BlockKind, where: string, size: number): void {
  const b = out.blocks.find((x) => x.kind === kind && x.where === where);
  if (b) b.size += size;
  else out.blocks.push({ kind, where, size });
}

function note(out: ImageMetadata, text: string): void {
  if (!out.notes.includes(text) && out.notes.length < 24) out.notes.push(text);
}

/**
 * Record something that was found and not read, in the words the verdict
 * uses: each phrase has to read after "This file holds …".
 */
function cannotDecode(out: ImageMetadata, text: string): void {
  if (!out.undecoded.includes(text) && out.undecoded.length < 8) out.undecoded.push(text);
}

/** Free-text rows: a blank value carries nothing, so it is low risk. */
function textRow(out: ImageMetadata, tag: string, value: string, risk: Risk, warning: string | undefined, group: string, id?: number): void {
  const v = cleanText(value);
  addField(out, v ? { tag, value: v, privacy: risk, warning, group, id } : { tag, value: '(empty)', privacy: 'low', group, id });
}

// ───────────────────────────── tag tables ─────────────────────────────

type Fmt =
  | 'exposure' | 'fnumber' | 'mm' | 'm' | 'ev' | 'version' | 'components' | 'dotted' | 'utf16' | 'charset' | 'maker' | 'flash'
  | 'orientation' | 'resunit' | 'compression' | 'photometric' | 'planar' | 'ycbcrpos' | 'colorspace' | 'program' | 'metering'
  | 'light' | 'wb' | 'expmode' | 'scene' | 'filesource' | 'scenetype' | 'sensing' | 'custom' | 'contrast' | 'saturation'
  | 'gain' | 'distrange' | 'altref';

interface TagDef {
  name: string;
  risk?: Risk;
  warn?: string;
  fmt?: Fmt;
}

const ENUMS: Partial<Record<Fmt, Record<number, string>>> = {
  orientation: {
    1: 'Normal', 2: 'Mirrored horizontally', 3: 'Rotated 180°', 4: 'Mirrored vertically',
    5: 'Mirrored horizontally, rotated 270° clockwise', 6: 'Rotated 90° clockwise',
    7: 'Mirrored horizontally, rotated 90° clockwise', 8: 'Rotated 270° clockwise',
  },
  resunit: { 1: 'No unit', 2: 'Inches', 3: 'Centimetres' },
  compression: { 1: 'Uncompressed', 2: 'CCITT 1D', 3: 'CCITT Group 3', 4: 'CCITT Group 4', 5: 'LZW', 6: 'JPEG (old style)', 7: 'JPEG', 8: 'Deflate', 32773: 'PackBits', 34892: 'Lossy JPEG' },
  photometric: { 0: 'White is zero', 1: 'Black is zero', 2: 'RGB', 3: 'Palette', 4: 'Transparency mask', 5: 'CMYK', 6: 'YCbCr', 8: 'CIELab', 32803: 'Colour filter array', 34892: 'Linear raw' },
  planar: { 1: 'Chunky', 2: 'Planar' },
  ycbcrpos: { 1: 'Centred', 2: 'Co-sited' },
  colorspace: { 1: 'sRGB', 2: 'Adobe RGB', 65533: 'Wide-gamut RGB', 65534: 'ICC profile', 65535: 'Uncalibrated' },
  program: { 0: 'Not defined', 1: 'Manual', 2: 'Normal program', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative program', 6: 'Action program', 7: 'Portrait mode', 8: 'Landscape mode' },
  metering: { 0: 'Unknown', 1: 'Average', 2: 'Center-weighted average', 3: 'Spot', 4: 'Multi-spot', 5: 'Pattern', 6: 'Partial', 255: 'Other' },
  light: { 0: 'Unknown', 1: 'Daylight', 2: 'Fluorescent', 3: 'Tungsten', 4: 'Flash', 9: 'Fine weather', 10: 'Cloudy', 11: 'Shade', 17: 'Standard light A', 18: 'Standard light B', 19: 'Standard light C', 20: 'D55', 21: 'D65', 22: 'D75', 23: 'D50', 24: 'ISO studio tungsten', 255: 'Other' },
  wb: { 0: 'Auto', 1: 'Manual' },
  expmode: { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' },
  scene: { 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night' },
  filesource: { 1: 'Film scanner', 2: 'Reflection print scanner', 3: 'Digital camera' },
  scenetype: { 1: 'Directly photographed' },
  sensing: { 1: 'Not defined', 2: 'One-chip colour area sensor', 3: 'Two-chip colour area sensor', 4: 'Three-chip colour area sensor', 5: 'Colour sequential area sensor', 7: 'Trilinear sensor', 8: 'Colour sequential linear sensor' },
  custom: { 0: 'Normal process', 1: 'Custom process' },
  contrast: { 0: 'Normal', 1: 'Soft', 2: 'Hard' },
  saturation: { 0: 'Normal', 1: 'Low', 2: 'High' },
  gain: { 0: 'None', 1: 'Low gain up', 2: 'High gain up', 3: 'Low gain down', 4: 'High gain down' },
  distrange: { 0: 'Unknown', 1: 'Macro', 2: 'Close', 3: 'Distant' },
  altref: { 0: 'Above sea level', 1: 'Below sea level' },
};

/** IFD0, IFD1, the Exif IFD and SubIFDs share one number space (TIFF 6.0 + Exif 2.32/3.0 + a few DNG and Windows tags). */
const MAIN_TAGS: Record<number, TagDef> = {
  0x00fe: { name: 'New Subfile Type' },
  0x00ff: { name: 'Subfile Type' },
  0x0100: { name: 'Image Width' },
  0x0101: { name: 'Image Height' },
  0x0102: { name: 'Bits Per Sample' },
  0x0103: { name: 'Compression', fmt: 'compression' },
  0x0106: { name: 'Photometric Interpretation', fmt: 'photometric' },
  0x0107: { name: 'Thresholding' },
  0x010a: { name: 'Fill Order' },
  0x010d: { name: 'Document Name', risk: 'medium', warn: 'Often the original file or folder name' },
  0x010e: { name: 'Image Description', risk: 'medium', warn: TEXT_WARN },
  0x010f: { name: 'Make', risk: 'medium', warn: 'The camera or phone maker' },
  0x0110: { name: 'Model', risk: 'medium', warn: 'Reveals your device model' },
  0x0111: { name: 'Strip Offsets' },
  0x0112: { name: 'Orientation', fmt: 'orientation' },
  0x0115: { name: 'Samples Per Pixel' },
  0x0116: { name: 'Rows Per Strip' },
  0x0117: { name: 'Strip Byte Counts' },
  0x0118: { name: 'Min Sample Value' },
  0x0119: { name: 'Max Sample Value' },
  0x011a: { name: 'X Resolution' },
  0x011b: { name: 'Y Resolution' },
  0x011c: { name: 'Planar Configuration', fmt: 'planar' },
  0x011d: { name: 'Page Name', risk: 'medium', warn: TEXT_WARN },
  0x011e: { name: 'X Position' },
  0x011f: { name: 'Y Position' },
  0x0128: { name: 'Resolution Unit', fmt: 'resunit' },
  0x0129: { name: 'Page Number' },
  0x012d: { name: 'Transfer Function' },
  0x0131: { name: 'Software', risk: 'medium', warn: SOFTWARE_WARN },
  0x0132: { name: 'Modify Date', risk: 'medium', warn: 'When the file was last changed' },
  0x013b: { name: 'Artist', risk: 'high', warn: "Often the photographer's or owner's name" },
  0x013c: { name: 'Host Computer', risk: 'medium', warn: 'The computer or device that wrote the file' },
  0x013d: { name: 'Predictor' },
  0x013e: { name: 'White Point' },
  0x013f: { name: 'Primary Chromaticities' },
  0x0140: { name: 'Color Map' },
  0x0141: { name: 'Halftone Hints' },
  0x0142: { name: 'Tile Width' },
  0x0143: { name: 'Tile Length' },
  0x0144: { name: 'Tile Offsets' },
  0x0145: { name: 'Tile Byte Counts' },
  0x014c: { name: 'Ink Set' },
  0x0151: { name: 'Target Printer', risk: 'medium', warn: TEXT_WARN },
  0x0152: { name: 'Extra Samples' },
  0x0153: { name: 'Sample Format' },
  0x0211: { name: 'YCbCr Coefficients' },
  0x0212: { name: 'YCbCr Sub-Sampling' },
  0x0213: { name: 'YCbCr Positioning', fmt: 'ycbcrpos' },
  0x0214: { name: 'Reference Black/White' },
  // Read as their own blocks (XMP, IPTC, Photoshop resources); these names only show when the value can't be reached.
  0x02bc: { name: 'XMP' },
  0x4746: { name: 'Rating' },
  0x4749: { name: 'Rating Percent' },
  0x8298: { name: 'Copyright', risk: 'medium', warn: "Often includes the owner's name" },
  0x829a: { name: 'Exposure Time', fmt: 'exposure' },
  0x829d: { name: 'F Number', fmt: 'fnumber' },
  0x8822: { name: 'Exposure Program', fmt: 'program' },
  0x8824: { name: 'Spectral Sensitivity' },
  0x8827: { name: 'ISO' },
  0x8828: { name: 'Opto-Electric Conversion Factor' },
  0x8830: { name: 'Sensitivity Type' },
  0x8831: { name: 'Standard Output Sensitivity' },
  0x8832: { name: 'Recommended Exposure Index' },
  0x8833: { name: 'ISO Speed' },
  0x8834: { name: 'ISO Speed Latitude yyy' },
  0x8835: { name: 'ISO Speed Latitude zzz' },
  0x83bb: { name: 'IPTC-NAA' },
  0x8649: { name: 'Photoshop Resources' },
  0x9000: { name: 'Exif Version', fmt: 'version' },
  0x9003: { name: 'Date/Time Original', risk: 'medium', warn: 'When the photo was taken' },
  0x9004: { name: 'Date/Time Digitized', risk: 'medium', warn: 'When the photo was stored' },
  0x9010: { name: 'Offset Time', risk: 'medium', warn: TZ_WARN },
  0x9011: { name: 'Offset Time Original', risk: 'medium', warn: TZ_WARN },
  0x9012: { name: 'Offset Time Digitized', risk: 'medium', warn: TZ_WARN },
  0x9101: { name: 'Components Configuration', fmt: 'components' },
  0x9102: { name: 'Compressed Bits Per Pixel' },
  0x9201: { name: 'Shutter Speed Value' },
  0x9202: { name: 'Aperture Value' },
  0x9203: { name: 'Brightness Value' },
  0x9204: { name: 'Exposure Bias', fmt: 'ev' },
  0x9205: { name: 'Max Aperture Value' },
  0x9206: { name: 'Subject Distance', fmt: 'm' },
  0x9207: { name: 'Metering Mode', fmt: 'metering' },
  0x9208: { name: 'Light Source', fmt: 'light' },
  0x9209: { name: 'Flash', fmt: 'flash' },
  0x920a: { name: 'Focal Length', fmt: 'mm' },
  0x9214: { name: 'Subject Area' },
  0x927c: {
    name: 'Maker Note',
    risk: 'medium',
    fmt: 'maker',
    warn: "The camera maker's own block. It often holds the camera's serial number; this viewer lists its size but does not decode it",
  },
  0x9286: { name: 'User Comment', risk: 'medium', fmt: 'charset', warn: TEXT_WARN },
  0x9290: { name: 'Sub-Second Time' },
  0x9291: { name: 'Sub-Second Time Original' },
  0x9292: { name: 'Sub-Second Time Digitized' },
  0x9400: { name: 'Ambient Temperature' },
  0x9401: { name: 'Humidity' },
  0x9402: { name: 'Pressure' },
  0x9403: { name: 'Water Depth' },
  0x9404: { name: 'Acceleration' },
  0x9405: { name: 'Camera Elevation Angle' },
  0x9c9b: { name: 'Windows Title', risk: 'medium', fmt: 'utf16', warn: TEXT_WARN },
  0x9c9c: { name: 'Windows Comment', risk: 'medium', fmt: 'utf16', warn: TEXT_WARN },
  0x9c9d: { name: 'Windows Author', risk: 'high', fmt: 'utf16', warn: NAME_WARN },
  0x9c9e: { name: 'Windows Keywords', risk: 'medium', fmt: 'utf16', warn: TEXT_WARN },
  0x9c9f: { name: 'Windows Subject', risk: 'medium', fmt: 'utf16', warn: TEXT_WARN },
  0xa000: { name: 'Flashpix Version', fmt: 'version' },
  0xa001: { name: 'Color Space', fmt: 'colorspace' },
  0xa002: { name: 'Pixel X Dimension' },
  0xa003: { name: 'Pixel Y Dimension' },
  0xa004: { name: 'Related Sound File', risk: 'medium', warn: 'Names a sound file recorded with the photo' },
  0xa20b: { name: 'Flash Energy' },
  0xa20c: { name: 'Spatial Frequency Response' },
  0xa20e: { name: 'Focal Plane X Resolution' },
  0xa20f: { name: 'Focal Plane Y Resolution' },
  0xa210: { name: 'Focal Plane Resolution Unit', fmt: 'resunit' },
  0xa214: { name: 'Subject Location' },
  0xa215: { name: 'Exposure Index' },
  0xa217: { name: 'Sensing Method', fmt: 'sensing' },
  0xa300: { name: 'File Source', fmt: 'filesource' },
  0xa301: { name: 'Scene Type', fmt: 'scenetype' },
  0xa302: { name: 'CFA Pattern' },
  0xa401: { name: 'Custom Rendered', fmt: 'custom' },
  0xa402: { name: 'Exposure Mode', fmt: 'expmode' },
  0xa403: { name: 'White Balance', fmt: 'wb' },
  0xa404: { name: 'Digital Zoom Ratio' },
  0xa405: { name: 'Focal Length In 35mm Film', fmt: 'mm' },
  0xa406: { name: 'Scene Capture Type', fmt: 'scene' },
  0xa407: { name: 'Gain Control', fmt: 'gain' },
  0xa408: { name: 'Contrast', fmt: 'contrast' },
  0xa409: { name: 'Saturation', fmt: 'saturation' },
  0xa40a: { name: 'Sharpness', fmt: 'contrast' },
  0xa40b: { name: 'Device Setting Description' },
  0xa40c: { name: 'Subject Distance Range', fmt: 'distrange' },
  0xa420: { name: 'Image Unique ID', risk: 'high', warn: 'An ID given to this one image: every copy you share can be matched to the original' },
  0xa430: { name: 'Camera Owner Name', risk: 'high', warn: "The owner's name, as set in the camera" },
  0xa431: { name: 'Body Serial Number', risk: 'high', warn: SERIAL_WARN },
  0xa432: { name: 'Lens Specification' },
  0xa433: { name: 'Lens Make', risk: 'medium', warn: DEVICE_WARN },
  0xa434: { name: 'Lens Model', risk: 'medium', warn: DEVICE_WARN },
  0xa435: { name: 'Lens Serial Number', risk: 'high', warn: 'Identifies the lens: photos taken with it can be linked to each other' },
  0xa436: { name: 'Image Title', risk: 'medium', warn: TEXT_WARN },
  0xa437: { name: 'Photographer', risk: 'high', warn: NAME_WARN },
  0xa438: { name: 'Image Editor', risk: 'high', warn: NAME_WARN },
  0xa439: { name: 'Camera Firmware', risk: 'medium', warn: DEVICE_WARN },
  0xa43a: { name: 'RAW Developing Software', risk: 'medium', warn: SOFTWARE_WARN },
  0xa43b: { name: 'Image Editing Software', risk: 'medium', warn: SOFTWARE_WARN },
  0xa43c: { name: 'Metadata Editing Software', risk: 'medium', warn: SOFTWARE_WARN },
  0xa460: { name: 'Composite Image' },
  0xa461: { name: 'Source Image Count' },
  0xa462: { name: 'Source Exposure Times' },
  0xa500: { name: 'Gamma' },
  0xc4a5: { name: 'Print Image Matching' },
  0xc612: { name: 'DNG Version', fmt: 'dotted' },
  0xc614: { name: 'Unique Camera Model', risk: 'medium', warn: 'Reveals your device model' },
  0xc62f: { name: 'Camera Serial Number', risk: 'high', warn: SERIAL_WARN },
  0xea1c: { name: 'Padding' },
  0xea1d: { name: 'Offset Schema' },
};

const GPS_TAGS: Record<number, TagDef> = {
  0x0000: { name: 'GPS Version ID', fmt: 'dotted' },
  // Latitude and longitude are folded into one "GPS Coordinates" row (high risk).
  // These entries only show when one half is missing, which is not a position.
  0x0001: { name: 'GPS Latitude Ref' },
  0x0002: { name: 'GPS Latitude', risk: 'medium', warn: 'Half of a position: the longitude is missing' },
  0x0003: { name: 'GPS Longitude Ref' },
  0x0004: { name: 'GPS Longitude', risk: 'medium', warn: 'Half of a position: the latitude is missing' },
  0x0005: { name: 'GPS Altitude Ref', fmt: 'altref' },
  0x0006: { name: 'GPS Altitude', risk: 'medium', warn: 'The height where the photo was taken' },
  0x0007: { name: 'GPS Time Stamp', risk: 'medium', warn: 'The time of the GPS fix, in UTC' },
  0x0008: { name: 'GPS Satellites' },
  0x0009: { name: 'GPS Status' },
  0x000a: { name: 'GPS Measure Mode' },
  0x000b: { name: 'GPS DOP' },
  0x000c: { name: 'GPS Speed Ref' },
  0x000d: { name: 'GPS Speed', risk: 'medium', warn: 'How fast the device was moving' },
  0x000e: { name: 'GPS Track Ref' },
  0x000f: { name: 'GPS Track', risk: 'medium', warn: 'The direction the device was moving' },
  0x0010: { name: 'GPS Image Direction Ref' },
  0x0011: { name: 'GPS Image Direction', risk: 'medium', warn: 'The direction the camera faced' },
  0x0012: { name: 'GPS Map Datum' },
  0x0013: { name: 'GPS Destination Latitude Ref' },
  0x0014: { name: 'GPS Destination Latitude', risk: 'medium' },
  0x0015: { name: 'GPS Destination Longitude Ref' },
  0x0016: { name: 'GPS Destination Longitude', risk: 'medium' },
  0x0017: { name: 'GPS Destination Bearing Ref' },
  0x0018: { name: 'GPS Destination Bearing', risk: 'medium' },
  0x0019: { name: 'GPS Destination Distance Ref' },
  0x001a: { name: 'GPS Destination Distance', risk: 'medium' },
  0x001b: { name: 'GPS Processing Method', fmt: 'charset' },
  0x001c: { name: 'GPS Area Information', risk: 'high', fmt: 'charset', warn: PLACE_WARN },
  0x001d: { name: 'GPS Date Stamp', risk: 'medium', warn: 'The date of the GPS fix, in UTC' },
  0x001e: { name: 'GPS Differential' },
  0x001f: { name: 'GPS Horizontal Positioning Error', fmt: 'm' },
};

const INTEROP_TAGS: Record<number, TagDef> = {
  0x0001: { name: 'Interoperability Index' },
  0x0002: { name: 'Interoperability Version', fmt: 'version' },
  0x1000: { name: 'Related Image File Format' },
  0x1001: { name: 'Related Image Width' },
  0x1002: { name: 'Related Image Height' },
};

/** Entries that are read for what they point at, not listed as rows. */
const EXIF_POINTER = 0x8769;
const GPS_POINTER = 0x8825;
const INTEROP_POINTER = 0xa005;
const SUBIFDS = 0x014a;
const THUMB_OFFSET = 0x0201;
const THUMB_LENGTH = 0x0202;
/** Entries whose value is another metadata block. */
const XMP_TAG = 0x02bc;
const IPTC_TAG = 0x83bb;
const PHOTOSHOP_TAG = 0x8649;
const ICC_TAG = 0x8773;

/** Exported so tests and the copy can check what is covered. */
export const TAG_TABLES = { main: MAIN_TAGS, gps: GPS_TAGS, interop: INTEROP_TAGS } as const;

// ───────────────────────────── TIFF / Exif ─────────────────────────────

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Byte size of the whole value (may be huge in a hostile file; never allocated from). */
  size: number;
  /** Where the value starts, inside the TIFF block. */
  at: number;
  /** The type is known and the whole value lies inside the block. */
  ok: boolean;
}

interface Shown {
  text: string;
  kind: 'text' | 'number' | 'binary' | 'unreadable';
}

interface Pointers {
  exif: number;
  gps: number;
  interop: number;
  sub: number[];
}

type DirKind = 'main' | 'gps' | 'interop';

/**
 * Walk one TIFF structure: an Exif block (from JPEG APP1, PNG eXIf, WebP EXIF…)
 * or a whole TIFF file. Returns false when the bytes are not a TIFF structure.
 */
function readTiffBlock(input: Uint8Array, where: string, out: ImageMetadata, fileIsTiff = false): boolean {
  // Some writers keep JPEG's "Exif\0\0" prefix inside PNG eXIf and WebP EXIF.
  const t = startsWith(input, 'Exif\0\0') ? input.subarray(6) : input;
  /**
   * A block that says "Exif" and is not read. The file must never come out
   * green on the strength of it: a whole TIFF file takes the "not read here"
   * branch HEIC and AVIF take, and a block inside another container leaves a
   * phrase for the verdict to read.
   */
  const place = fileIsTiff ? 'this TIFF file' : `the Exif block in ${where}`;
  const notRead = (why: string): boolean => {
    note(out, `Nothing was read from ${place}: ${why}`);
    if (fileIsTiff) out.unread = true;
    else cannotDecode(out, 'an Exif block this viewer could not read');
    return false;
  };
  if (t.length < 8) return notRead('it is too short to hold a TIFF header.');
  let le: boolean;
  if (t[0] === 0x49 && t[1] === 0x49) le = true;
  else if (t[0] === 0x4d && t[1] === 0x4d) le = false;
  else return notRead('it does not begin with a TIFF byte-order mark (II or MM).');

  const u16 = (o: number): number => (o >= 0 && o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : 0);
  const u32 = (o: number): number =>
    o >= 0 && o + 4 <= t.length
      ? le
        ? t[o] + (t[o + 1] << 8) + (t[o + 2] << 16) + t[o + 3] * 0x1000000
        : t[o] * 0x1000000 + (t[o + 1] << 16) + (t[o + 2] << 8) + t[o + 3]
      : 0;
  const magic = u16(2);
  if (magic === 43) {
    // BigTIFF carries the same directories as any TIFF, GPS included, in a
    // 64-bit layout this viewer does not walk. Never a green "nothing found".
    return notRead('BigTIFF files are not read here, and a BigTIFF can carry the same Exif as a JPEG, GPS included.');
  }
  if (magic !== 42) return notRead('it does not begin with a TIFF header.');
  if (!spend(out, 'exif')) return false;
  addBlock(out, 'Exif', where, t.length);
  const fieldsBefore = out.fields.length;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const visited = new Set<number>();

  const readIfd = (off: number): { entries: Entry[]; next: number } | null => {
    if (off < 8 || off + 2 > t.length) return null;
    if (visited.has(off)) {
      note(out, LOOP_NOTE);
      return null;
    }
    if (visited.size >= LIMITS.ifdsPerBlock) {
      note(out, `Stopped after ${LIMITS.ifdsPerBlock} directories in one Exif block.`);
      cannotDecode(out, `more directories in one Exif block than this viewer reads (it stopped at ${LIMITS.ifdsPerBlock})`);
      return null;
    }
    visited.add(off);
    const declared = u16(off);
    const fit = Math.floor((t.length - off - 2) / 12);
    const n = Math.min(declared, fit, LIMITS.entriesPerIfd);
    if (n < declared) {
      if (n === fit) {
        note(out, 'A directory runs past the end of its block; the entries that fit were read.');
        cannotDecode(out, 'an Exif directory that runs past the end of its block, with the entries after it unread');
      } else {
        note(out, `A directory lists more than ${LIMITS.entriesPerIfd} entries; the first ${LIMITS.entriesPerIfd} were read.`);
        cannotDecode(out, `more entries in one directory than this viewer reads (it stopped at ${LIMITS.entriesPerIfd})`);
      }
    }
    const entries: Entry[] = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const type = u16(e + 2);
      const cnt = u32(e + 4);
      const ts = TYPE_SIZE[type] ?? 0;
      const size = ts * cnt;
      const at = ts && size <= 4 ? e + 8 : u32(e + 8);
      entries.push({ tag: u16(e), type, count: cnt, size, at, ok: ts > 0 && at + size <= t.length });
    }
    return { entries, next: u32(off + 2 + declared * 12) };
  };

  const numAt = (type: number, o: number): number => {
    switch (type) {
      case 1: case 2: case 7: return o < t.length ? t[o] : 0;
      case 6: return o < t.length ? (t[o] << 24) >> 24 : 0;
      case 3: return u16(o);
      case 8: return (u16(o) << 16) >> 16;
      case 4: case 13: return u32(o);
      case 9: return u32(o) | 0;
      case 11: return o + 4 <= t.length ? dv.getFloat32(o, le) : NaN;
      case 12: return o + 8 <= t.length ? dv.getFloat64(o, le) : NaN;
      default: return NaN;
    }
  };
  const ratAt = (type: number, o: number): [number, number] => (type === 10 ? [u32(o) | 0, u32(o + 4) | 0] : [u32(o), u32(o + 4)]);
  const isRational = (e: Entry) => e.type === 5 || e.type === 10;
  /** The first value as a number (a rational divided out). */
  const first = (e: Entry): number => {
    if (isRational(e)) {
      const [n, d] = ratAt(e.type, e.at);
      return d ? n / d : NaN;
    }
    return numAt(e.type, e.at);
  };
  const isInteger = (e: Entry) => e.type === 1 || e.type === 3 || e.type === 4 || e.type === 8 || e.type === 9 || e.type === 13;
  const scalar = (e: Entry): number => (e.ok && e.count > 0 && isInteger(e) ? numAt(e.type, e.at) : 0);
  const scalars = (e: Entry | undefined, max: number): number[] => {
    const vals: number[] = [];
    if (!e || !e.ok || !isInteger(e)) return vals;
    const sz = TYPE_SIZE[e.type];
    for (let i = 0; i < Math.min(e.count, max); i++) vals.push(numAt(e.type, e.at + i * sz));
    return vals;
  };
  const bytesOf = (e: Entry, cap: number = LIMITS.valueBytes): Uint8Array => t.subarray(e.at, e.at + Math.min(e.size, cap));
  /** ASCII values: NUL-separated strings, joined. */
  const asciiText = (e: Entry): string => {
    const b = bytesOf(e);
    const parts: string[] = [];
    let s = 0;
    for (let i = 0; i <= b.length; i++) {
      if (i === b.length || b[i] === 0) {
        if (i > s) parts.push(cleanText(decodeText(b.subarray(s, i))));
        s = i + 1;
      }
    }
    const joined = parts.filter(Boolean).join('; ');
    return e.size > LIMITS.valueBytes ? `${joined}…` : joined;
  };
  const list = (e: Entry, one: (i: number) => string): string => {
    const n = Math.min(e.count, LIMITS.shownValues);
    const vals: string[] = [];
    for (let i = 0; i < n; i++) vals.push(one(i));
    return e.count > n ? `${vals.join(', ')}, … (${count(e.count, 'value')})` : vals.join(', ');
  };

  const formatValue = (e: Entry, def: TagDef | undefined): Shown => {
    if (!TYPE_SIZE[e.type]) return { text: `(stored as unknown type ${e.type})`, kind: 'unreadable' };
    if (e.count === 0) return { text: '', kind: 'text' };
    if (!e.ok) return { text: '(the value points outside the file)', kind: 'unreadable' };
    const fmt = def?.fmt;
    switch (fmt) {
      case 'maker':
        return { text: `${bytesLabel(e.size)} in the maker's own format, not decoded`, kind: 'binary' };
      case 'utf16':
        return { text: cleanText(utf16(bytesOf(e), true)), kind: 'text' };
      case 'charset':
        return { text: cleanText(charsetText(bytesOf(e), le)), kind: 'text' };
      case 'version': {
        const s = latin1(bytesOf(e)).replace(/\0/g, '');
        return { text: /^\d{4}$/.test(s) ? `${parseInt(s.slice(0, 2), 10)}.${s.slice(2)}` : cleanText(s), kind: 'text' };
      }
      case 'components': {
        const names = ['-', 'Y', 'Cb', 'Cr', 'R', 'G', 'B'];
        return { text: Array.from(bytesOf(e, 8)).map((c) => names[c] ?? String(c)).join(' '), kind: 'text' };
      }
      case 'dotted':
        return { text: list(e, (i) => num(numAt(e.type, e.at + i * TYPE_SIZE[e.type]))).replace(/, /g, '.'), kind: 'number' };
      default:
        break;
    }
    if (e.type === 2) return { text: asciiText(e), kind: 'text' };
    if (e.type === 7) {
      const b = bytesOf(e);
      if (printable(b)) return { text: cleanText(latin1(b)), kind: 'text' };
      return { text: `${bytesLabel(e.size)} of binary data`, kind: 'binary' };
    }
    const v = first(e);
    if (fmt && Number.isFinite(v)) {
      switch (fmt) {
        case 'exposure': return { text: v > 0 && v < 1 ? `1/${Math.round(1 / v)} s` : `${num(v)} s`, kind: 'number' };
        case 'fnumber': return { text: `f/${num(v)}`, kind: 'number' };
        case 'mm': return { text: `${num(v)} mm`, kind: 'number' };
        case 'm': return { text: `${num(v)} m`, kind: 'number' };
        case 'ev': return { text: `${v > 0 ? '+' : ''}${num(v)} EV`, kind: 'number' };
        case 'flash': {
          const fired = (v & 1) === 1;
          return { text: `${fired ? 'Fired' : 'Did not fire'}${v & 0x20 ? ' (no flash function)' : ''}`, kind: 'number' };
        }
        default: {
          const table = ENUMS[fmt];
          if (table) return { text: table[v] ?? String(v), kind: 'number' };
        }
      }
    }
    if (isRational(e)) {
      return { text: list(e, (i) => { const [n, d] = ratAt(e.type, e.at + i * 8); return ratText(n, d); }), kind: 'number' };
    }
    return { text: list(e, (i) => num(numAt(e.type, e.at + i * TYPE_SIZE[e.type]))), kind: 'number' };
  };

  const emitRow = (e: Entry, def: TagDef | undefined, group: string): void => {
    if (full(out)) return; // no decoding once no more rows can be shown
    const name = def?.name ?? `Tag 0x${e.tag.toString(16).padStart(4, '0')}`;
    const v = formatValue(e, def);
    let risk: Risk = def?.risk ?? 'low';
    let warning = def?.warn;
    if (!def) {
      const readable = v.kind === 'text' && v.text.replace(/\s/g, '').length >= 4;
      risk = readable ? 'medium' : 'low';
      warning = readable ? 'Not a standard tag. It holds text, so read what it says' : 'Not a standard tag';
    }
    if (v.kind === 'unreadable' || (v.kind === 'text' && !v.text)) {
      risk = 'low';
      if (def) warning = undefined;
    }
    addField(out, { tag: name, value: v.text || '(empty)', privacy: risk, warning, group, id: e.tag });
  };

  const emitThumbnail = (entries: Entry[], group: string, thumbOff: number, thumbLen: number, thumbCtx: boolean): void => {
    const find = (tag: number) => entries.find((x) => x.tag === tag);
    const dims = (): { w?: number; h?: number } => {
      const w = find(0x0100);
      const h = find(0x0101);
      return { w: w ? scalar(w) || undefined : undefined, h: h ? scalar(h) || undefined : undefined };
    };
    if (thumbOff >= 0 || thumbLen >= 0) {
      if (thumbOff > 0 && thumbLen > 0 && thumbOff < t.length) {
        const end = Math.min(t.length, thumbOff + thumbLen);
        const data = t.subarray(thumbOff, end);
        const isJpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8;
        const size = isJpeg ? jpegDimensions(data) : null;
        const parts = [isJpeg ? 'JPEG' : 'Not a JPEG stream', size ? `${size.w} × ${size.h} px` : '', bytesLabel(thumbLen)].filter(Boolean);
        if (end - thumbOff < thumbLen) parts.push('cut off by the end of the block');
        addField(out, { tag: 'Embedded Thumbnail', value: parts.join(', '), privacy: 'medium', warning: THUMB_WARN, group, id: THUMB_OFFSET });
        if (!out.thumbnail) {
          out.thumbnail = { format: isJpeg ? 'JPEG' : 'Unknown', size: thumbLen, width: size?.w, height: size?.h, group, jpeg: isJpeg ? data : undefined };
        }
      } else {
        addField(out, { tag: 'Embedded Thumbnail', value: '(its offset or length points outside the file)', privacy: 'low', group, id: THUMB_OFFSET });
      }
      return;
    }
    // A thumbnail stored as strips: IFD1 of an Exif block, or a TIFF directory
    // marked "reduced-resolution" (New Subfile Type bit 0), as DNG previews are.
    const subfile = find(0x00fe);
    const reduced = !!subfile && (scalar(subfile) & 1) === 1;
    const strips = find(0x0117) ?? find(0x0145);
    if (!(thumbCtx || (fileIsTiff && reduced)) || !strips) return;
    const size = scalars(strips, 1000).reduce((a, b) => a + b, 0);
    const { w, h } = dims();
    const comp = find(0x0103);
    const format = comp ? ENUMS.compression?.[scalar(comp)] ?? 'Compressed' : 'Uncompressed';
    const parts = [format, w && h ? `${w} × ${h} px` : '', bytesLabel(size)].filter(Boolean);
    addField(out, { tag: thumbCtx ? 'Embedded Thumbnail' : 'Embedded Preview', value: parts.join(', '), privacy: 'medium', warning: THUMB_WARN, group });
    if (!out.thumbnail) out.thumbnail = { format, size, width: w, height: h, group };
  };

  const emitDir = (entries: Entry[], group: string, kind: DirKind, thumbCtx: boolean): Pointers => {
    const p: Pointers = { exif: 0, gps: 0, interop: 0, sub: [] };
    if (kind === 'gps') {
      emitGps(entries, group);
      return p;
    }
    const table = kind === 'interop' ? INTEROP_TAGS : MAIN_TAGS;
    let thumbOff = -1;
    let thumbLen = -1;
    for (const e of entries) {
      if (kind === 'main') {
        switch (e.tag) {
          case EXIF_POINTER: p.exif = scalar(e); continue;
          case GPS_POINTER: p.gps = scalar(e); continue;
          case INTEROP_POINTER: p.interop = scalar(e); continue;
          case SUBIFDS: p.sub = scalars(e, LIMITS.subIfds); continue;
          case THUMB_OFFSET: thumbOff = scalar(e); continue;
          case THUMB_LENGTH: thumbLen = scalar(e); continue;
          case XMP_TAG:
            if (e.ok) { readXmp(decodeText(bytesOf(e, LIMITS.xmpChars)), `${where}, tag 700`, out); continue; }
            break;
          case IPTC_TAG:
            if (e.ok) { readIptc(bytesOf(e, 1 << 20), `${where}, tag 33723`, out); continue; }
            break;
          case PHOTOSHOP_TAG:
            if (e.ok) { readIrb(bytesOf(e, 1 << 20), `${where}, tag 34377`, out); continue; }
            break;
          case ICC_TAG:
            addBlock(out, 'ICC profile', `${where}, tag 34675`, e.size);
            continue;
          default:
            break;
        }
      }
      emitRow(e, table[e.tag], group);
    }
    if (kind === 'main') emitThumbnail(entries, group, thumbOff, thumbLen, thumbCtx);
    return p;
  };

  const emitGps = (entries: Entry[], group: string): void => {
    const by = new Map<number, Entry>();
    for (const e of entries) if (!by.has(e.tag)) by.set(e.tag, e);
    const used = new Set<number>();
    const ref = (tag: number): string => {
      const e = by.get(tag);
      return e && e.ok && e.count > 0 ? asciiText(e).trim().toUpperCase() : '';
    };
    const rats = (tag: number): number[] | null => {
      const e = by.get(tag);
      if (!e || !e.ok || !isRational(e) || e.count === 0) return null;
      const vals: number[] = [];
      for (let i = 0; i < Math.min(e.count, 3); i++) {
        const [n, d] = ratAt(e.type, e.at + i * 8);
        vals.push(d ? n / d : 0);
      }
      return vals;
    };
    const degrees = (p: number[]) => (p[0] || 0) + (p[1] || 0) / 60 + (p[2] || 0) / 3600;
    const dms = (v: number, pos: string, neg: string) => {
      const a = Math.abs(v);
      const d = Math.floor(a);
      const mf = (a - d) * 60;
      const m = Math.floor(mf);
      return `${d}° ${m}' ${((mf - m) * 60).toFixed(2)}" ${v < 0 ? neg : pos}`;
    };
    const coords = (latTag: number, lonTag: number): { la: number; lo: number } | null => {
      const lat = rats(latTag);
      const lon = rats(lonTag);
      if (!lat || !lon) return null;
      [latTag - 1, latTag, lonTag - 1, lonTag].forEach((x) => used.add(x));
      return { la: degrees(lat) * (ref(latTag - 1) === 'S' ? -1 : 1), lo: degrees(lon) * (ref(lonTag - 1) === 'W' ? -1 : 1) };
    };

    const pos = coords(0x0002, 0x0004);
    if (pos) {
      const { la, lo } = pos;
      if (!(Math.abs(la) <= 90 && Math.abs(lo) <= 180)) {
        addField(out, { tag: 'GPS Coordinates', value: `${num(la)}, ${num(lo)} (out of range, not a real position)`, privacy: 'low', group, id: 0x0002 });
      } else if (la === 0 && lo === 0) {
        addField(out, { tag: 'GPS Coordinates', value: '0, 0 (a placeholder: no position was recorded)', privacy: 'low', group, id: 0x0002 });
      } else {
        if (!out.gps) out.gps = { latitude: la, longitude: lo, group };
        addField(out, {
          tag: 'GPS Coordinates',
          value: `${la.toFixed(6)}, ${lo.toFixed(6)} (${dms(la, 'N', 'S')}, ${dms(lo, 'E', 'W')})`,
          privacy: 'high',
          warning: LOCATION_WARN,
          group,
          id: 0x0002,
        });
      }
    }

    const alt = rats(0x0006);
    if (alt) {
      used.add(0x0005);
      used.add(0x0006);
      const altRef = by.get(0x0005);
      const below = !!altRef && altRef.ok && numAt(altRef.type, altRef.at) === 1;
      const v = alt[0];
      if (out.gps && out.gps.group === group && out.gps.altitude === undefined) out.gps.altitude = below ? -v : v;
      addField(out, { tag: 'GPS Altitude', value: `${num(Math.round(v * 10) / 10)} m ${below ? 'below' : 'above'} sea level`, privacy: 'medium', warning: 'The height where the photo was taken', group, id: 0x0006 });
    }

    const date = by.get(0x001d);
    const time = rats(0x0007);
    if (date && date.ok && time) {
      used.add(0x001d);
      used.add(0x0007);
      const pad = (n: number) => (Number.isInteger(n) ? String(n).padStart(2, '0') : n.toFixed(2).padStart(5, '0'));
      const hms = `${pad(Math.trunc(time[0] ?? 0))}:${pad(Math.trunc(time[1] ?? 0))}:${pad(time[2] ?? 0)}`;
      textRow(out, 'GPS Date/Time', `${asciiText(date)} ${hms} UTC`, 'medium', 'The date and time of the GPS fix, in UTC', group, 0x001d);
    }

    const withRef = (valTag: number, refTag: number, name: string, unit: (r: string, v: number) => string, warn?: string) => {
      const r = rats(valTag);
      if (!r) return;
      used.add(valTag);
      used.add(refTag);
      addField(out, { tag: name, value: unit(ref(refTag), r[0]), privacy: 'medium', warning: warn, group, id: valTag });
    };
    const bearing = (r: string, v: number) => `${num(v)}° (${r === 'M' ? 'magnetic' : 'true'} north)`;
    withRef(0x000d, 0x000c, 'GPS Speed', (r, v) => `${num(v)} ${r === 'M' ? 'mph' : r === 'N' ? 'knots' : 'km/h'}`, 'How fast the device was moving');
    withRef(0x000f, 0x000e, 'GPS Track', bearing, 'The direction the device was moving');
    withRef(0x0011, 0x0010, 'GPS Image Direction', bearing, 'The direction the camera faced');
    withRef(0x0018, 0x0017, 'GPS Destination Bearing', bearing);
    withRef(0x001a, 0x0019, 'GPS Destination Distance', (r, v) => `${num(v)} ${r === 'M' ? 'miles' : r === 'N' ? 'nautical miles' : 'km'}`);

    const dest = coords(0x0014, 0x0016);
    if (dest && Math.abs(dest.la) <= 90 && Math.abs(dest.lo) <= 180 && !(dest.la === 0 && dest.lo === 0)) {
      addField(out, { tag: 'GPS Destination', value: `${dest.la.toFixed(6)}, ${dest.lo.toFixed(6)}`, privacy: 'high', warning: PLACE_WARN, group, id: 0x0014 });
    } else if (dest) {
      addField(out, { tag: 'GPS Destination', value: `${num(dest.la)}, ${num(dest.lo)} (not a usable position)`, privacy: 'low', group, id: 0x0014 });
    }

    for (const e of entries) if (!used.has(e.tag)) emitRow(e, GPS_TAGS[e.tag], group);
  };

  const plain = (group: string, name: string) => (group === 'IFD0' || group === 'Exif IFD' ? name : `${group} · ${name}`);
  const walk = (off: number, kind: DirKind, group: string, thumbCtx: boolean, depth: number): number => {
    if (depth > 6) return 0;
    const ifd = readIfd(off);
    if (!ifd) return 0;
    const p = emitDir(ifd.entries, group, kind, thumbCtx);
    if (p.exif) walk(p.exif, 'main', plain(group, 'Exif IFD'), false, depth + 1);
    if (p.gps) walk(p.gps, 'gps', plain(group, 'GPS IFD'), false, depth + 1);
    if (p.interop) walk(p.interop, 'interop', plain(group, 'Interop IFD'), false, depth + 1);
    p.sub.forEach((o, i) => walk(o, 'main', `SubIFD ${i + 1}`, false, depth + 1));
    return ifd.next;
  };

  let next = walk(u32(4), 'main', 'IFD0', false, 0);
  if (!visited.size) {
    note(out, `The Exif block in ${where} has no readable first directory.`);
    cannotDecode(out, 'an Exif block this viewer could not read');
    return true;
  }
  // Exif defines IFD0 and IFD1 (the thumbnail) only; a TIFF file may chain many directories.
  const chain = fileIsTiff ? LIMITS.ifdsPerBlock : 1;
  for (let idx = 1; next && idx <= chain; idx++) {
    next = walk(next, 'main', !fileIsTiff && idx === 1 ? 'IFD1 (thumbnail)' : `IFD${idx}`, !fileIsTiff && idx === 1, 0);
  }
  if (next) {
    // A pointer back to a directory already read leaves nothing unread; a
    // pointer onwards does, so the verdict has to hear about it.
    if (visited.has(next)) note(out, LOOP_NOTE);
    else if (!fileIsTiff) {
      note(out, 'The Exif block points to a third directory, which Exif does not define. It was not read.');
      cannotDecode(out, 'an Exif block pointing to a third directory, which was not read');
    } else {
      note(out, `Stopped after ${LIMITS.ifdsPerBlock} directories in this TIFF file; the ones after that were not read.`);
      cannotDecode(out, `more directories than this viewer reads (it stopped at ${LIMITS.ifdsPerBlock})`);
    }
  }
  if (out.fields.length === fieldsBefore) {
    note(out, `The Exif block in ${where} holds no entry this viewer could read.`);
    cannotDecode(out, 'an Exif block this viewer could not read');
  }
  return true;
}

/** Pixel size from a JPEG's SOF segment (bounded walk). */
function jpegDimensions(b: Uint8Array): { w: number; h: number } | null {
  if (!(b[0] === 0xff && b[1] === 0xd8)) return null;
  let off = 2;
  for (let n = 0; off + 9 <= b.length && n < 500; n++) {
    if (b[off] !== 0xff) return null;
    const m = b[off + 1];
    if (m === 0xff) { off++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { off += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;
    const len = u16be(b, off + 2);
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16be(b, off + 5), w: u16be(b, off + 7) };
    off += 2 + len;
  }
  return null;
}

// ───────────────────────────── XMP ─────────────────────────────

const XMP_FIELDS: Array<[string, string, Risk, string?]> = [
  ['dc:creator', 'Creator', 'high', NAME_WARN],
  ['photoshop:CaptionWriter', 'Caption Writer', 'high', NAME_WARN],
  ['exifEX:CameraOwnerName', 'Camera Owner Name', 'high', NAME_WARN],
  ['aux:OwnerName', 'Camera Owner Name', 'high', NAME_WARN],
  ['Iptc4xmpCore:CiEmailWork', 'Creator Email', 'high', CONTACT_WARN],
  ['Iptc4xmpCore:CiTelWork', 'Creator Phone', 'high', CONTACT_WARN],
  ['Iptc4xmpCore:CiAdrExtadr', 'Creator Address', 'high', CONTACT_WARN],
  ['Iptc4xmpCore:CiAdrCity', 'Creator City', 'high', PLACE_WARN],
  ['Iptc4xmpCore:CiAdrPcode', 'Creator Postcode', 'high', PLACE_WARN],
  ['Iptc4xmpCore:CiAdrRegion', 'Creator Province/State', 'medium', PLACE_WARN],
  ['Iptc4xmpCore:CiAdrCtry', 'Creator Country', 'medium'],
  ['Iptc4xmpCore:CiUrlWork', 'Creator Website', 'medium'],
  ['photoshop:AuthorsPosition', "Author's Position", 'medium'],
  ['xmpRights:Owner', 'Rights Owner', 'high', NAME_WARN],
  ['plus:LicensorName', 'Licensor', 'high', NAME_WARN],
  ['plus:LicensorEmail', 'Licensor Email', 'high', CONTACT_WARN],
  // People written into the picture itself: IPTC Extension, the Metadata
  // Working Group's face regions, and Windows' people tags.
  ['Iptc4xmpExt:PersonInImage', 'Person Shown', 'high', NAME_WARN],
  ['mwg-rs:Name', 'Face Region Name', 'high', REGION_WARN],
  ['MPReg:PersonDisplayName', 'Tagged Person', 'high', NAME_WARN],
  ['MPReg:PersonEmailDigest', 'Tagged Person Email Hash', 'high', "A hash of a tagged person's email address: it matches that person across files"],
  ['Iptc4xmpExt:OrganisationInImageName', 'Organisation Shown', 'medium', TEXT_WARN],
  ['Iptc4xmpExt:Event', 'Event', 'medium', TEXT_WARN],
  ['exifEX:BodySerialNumber', 'Body Serial Number', 'high', SERIAL_WARN],
  ['aux:SerialNumber', 'Body Serial Number', 'high', SERIAL_WARN],
  ['exifEX:LensSerialNumber', 'Lens Serial Number', 'high', 'Identifies the lens: photos taken with it can be linked to each other'],
  ['aux:LensSerialNumber', 'Lens Serial Number', 'high', 'Identifies the lens: photos taken with it can be linked to each other'],
  ['exif:ImageUniqueID', 'Image Unique ID', 'high', 'An ID given to this one image: every copy you share can be matched to the original'],
  ['xmpMM:DocumentID', 'Document ID', 'high', DOCID_WARN],
  ['xmpMM:OriginalDocumentID', 'Original Document ID', 'high', DOCID_WARN],
  ['xmpMM:InstanceID', 'Instance ID', 'medium', 'An ID for this saved version of the file'],
  ['photoshop:City', 'City', 'high', PLACE_WARN],
  ['Iptc4xmpCore:Location', 'Sub-location', 'high', PLACE_WARN],
  ['Iptc4xmpExt:City', 'City', 'high', PLACE_WARN],
  ['Iptc4xmpExt:Sublocation', 'Sub-location', 'high', PLACE_WARN],
  ['photoshop:State', 'Province/State', 'medium', PLACE_WARN],
  ['Iptc4xmpExt:ProvinceState', 'Province/State', 'medium', PLACE_WARN],
  ['photoshop:Country', 'Country', 'medium'],
  ['Iptc4xmpExt:CountryName', 'Country', 'medium'],
  ['Iptc4xmpCore:CountryCode', 'Country Code', 'medium'],
  ['Iptc4xmpExt:CountryCode', 'Country Code', 'medium'],
  ['Iptc4xmpExt:WorldRegion', 'World Region', 'medium'],
  ['tiff:Make', 'Make', 'medium', 'The camera or phone maker'],
  ['tiff:Model', 'Model', 'medium', 'Reveals your device model'],
  ['aux:Lens', 'Lens', 'medium', DEVICE_WARN],
  ['exifEX:LensModel', 'Lens Model', 'medium', DEVICE_WARN],
  ['xmp:CreatorTool', 'Creator Tool', 'medium', SOFTWARE_WARN],
  ['tiff:Software', 'Software', 'medium', SOFTWARE_WARN],
  ['exif:GPSAltitude', 'GPS Altitude', 'medium', 'The height where the photo was taken'],
  ['exif:GPSTimeStamp', 'GPS Time', 'medium', 'When the position was recorded'],
  ['exif:DateTimeOriginal', 'Date/Time Original', 'medium', 'When the photo was taken'],
  ['exif:DateTimeDigitized', 'Date/Time Digitized', 'medium', 'When the photo was stored'],
  ['tiff:DateTime', 'Modify Date', 'medium', 'When the file was last changed'],
  ['photoshop:DateCreated', 'Date Created', 'medium'],
  ['xmp:CreateDate', 'Create Date', 'medium'],
  ['xmp:ModifyDate', 'Modify Date', 'medium'],
  ['xmp:MetadataDate', 'Metadata Date', 'medium'],
  ['exif:UserComment', 'User Comment', 'medium', TEXT_WARN],
  ['dc:title', 'Title', 'medium', TEXT_WARN],
  ['dc:description', 'Description', 'medium', TEXT_WARN],
  ['dc:subject', 'Keywords', 'medium', TEXT_WARN],
  ['photoshop:Headline', 'Headline', 'medium', TEXT_WARN],
  ['dc:rights', 'Rights', 'medium', "Often includes the owner's name"],
  ['photoshop:Credit', 'Credit', 'medium'],
  ['photoshop:Source', 'Source', 'medium'],
  ['photoshop:History', 'Photoshop History', 'medium', 'The edits made to the file'],
  ['xmp:Label', 'Label', 'low'],
  ['xmp:Rating', 'Rating', 'low'],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(s: string): string {
  const cp = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => cp(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d: string) => cp(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** rdf:li items inside an element, by indexOf (linear, whatever the input). */
function liValues(inner: string): string[] {
  const vals: string[] = [];
  let from = 0;
  while (vals.length < 50) {
    const s = inner.indexOf('<rdf:li', from);
    if (s < 0) break;
    const gt = inner.indexOf('>', s);
    if (gt < 0) break;
    if (inner.charCodeAt(gt - 1) === 47) { from = gt + 1; continue; } // <rdf:li .../>
    const e = inner.indexOf('</rdf:li>', gt);
    if (e < 0) break;
    vals.push(inner.slice(gt + 1, e));
    from = e + 9;
  }
  return vals;
}

/**
 * Every value of a qualified XMP name, in attribute or element form.
 *
 * Every scan here is linear in the length of the packet. The tag strip at the
 * end is the part that has to be written carefully: `<[^>]*>` walks to the end
 * of the string for every '<' that has no '>' after it, which made a value of
 * 60,000 bare '<' take seconds and a 200 KB one take minutes, on the main
 * thread. `<[^<>]*>` stops at the next '<' instead, so each character is
 * looked at twice at most.
 */
function xmpValues(xml: string, q: string): string[] {
  const vals: string[] = [];
  const attr = new RegExp(`[\\s<]${escapeRe(q)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g');
  let m: RegExpExecArray | null;
  while ((m = attr.exec(xml)) && vals.length < 50) vals.push(m[1] ?? m[2] ?? '');
  const open = `<${q}`;
  const close = `</${q}>`;
  let from = 0;
  while (vals.length < 50) {
    const s = xml.indexOf(open, from);
    if (s < 0) break;
    const after = xml.charCodeAt(s + open.length);
    // "<dc:creator>" or "<dc:creator attr…>", not "<dc:creatorTool>"
    if (!(after === 62 || after === 32 || after === 9 || after === 10 || after === 13 || after === 47)) { from = s + open.length; continue; }
    const gt = xml.indexOf('>', s);
    if (gt < 0) break;
    if (xml.charCodeAt(gt - 1) === 47) { from = gt + 1; continue; }
    const e = xml.indexOf(close, gt);
    if (e < 0) break;
    const inner = xml.slice(gt + 1, e);
    const lis = liValues(inner);
    if (lis.length) vals.push(...lis);
    else if (inner.indexOf('<rdf:') < 0) vals.push(inner);
    from = e + close.length;
  }
  return vals.map((v) => cleanText(decodeEntities(v.replace(/<[^<>]*>/g, ' ')))).filter(Boolean);
}

/** "51,30.0437N" | "51,30,2.6N" | "51.5007" → decimal degrees (NaN when unreadable). */
function xmpCoord(s: string): number {
  const t = s.trim();
  const refMatch = /([NSEW])$/i.exec(t);
  const r = refMatch ? refMatch[1].toUpperCase() : '';
  const parts = (r ? t.slice(0, -1) : t).split(',').map((p) => parseFloat(p.trim()));
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return NaN;
  const deg = Math.abs(parts[0]) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  return r === 'S' || r === 'W' || parts[0] < 0 ? -deg : deg;
}

function readXmp(packet: string, where: string, out: ImageMetadata): void {
  if (!spend(out, 'xmp')) return;
  addBlock(out, 'XMP', where, packet.length);
  if (full(out)) return;
  let xml = packet;
  if (xml.length > LIMITS.xmpChars) {
    xml = xml.slice(0, LIMITS.xmpChars);
    note(out, `Only the first ${LIMITS.xmpChars / 1024} KB of the XMP was decoded.`);
    cannotDecode(out, `more XMP than this viewer decodes (it stopped at ${LIMITS.xmpChars / 1024} KB)`);
  }
  // One row per label: aux:SerialNumber and exifEX:BodySerialNumber both mean "Body Serial Number".
  const rows = new Map<string, { values: string[]; risk: Risk; warning?: string }>();
  for (const [q, label, risk, warning] of XMP_FIELDS) {
    const vals = xmpValues(xml, q);
    if (!vals.length) continue;
    const row = rows.get(label) ?? { values: [], risk, warning };
    row.values.push(...vals);
    rows.set(label, row);
  }
  rows.forEach((row, label) => addField(out, { tag: label, value: uniq(row.values).join('; '), privacy: row.risk, warning: row.warning, group: 'XMP' }));
  let decoded = rows.size;
  const agents = uniq(xmpValues(xml, 'stEvt:softwareAgent'));
  if (agents.length) {
    decoded++;
    addField(out, { tag: 'Edit History Software', value: agents.join('; '), privacy: 'medium', warning: 'The apps that edited the file', group: 'XMP' });
  }
  const whens = xmpValues(xml, 'stEvt:when');
  if (whens.length) {
    decoded++;
    const value = whens.length > 1 ? `${whens[0]} to ${whens[whens.length - 1]} (${count(whens.length, 'event')})` : whens[0];
    addField(out, { tag: 'Edit History Dates', value, privacy: 'medium', warning: 'When the file was edited', group: 'XMP' });
  }
  const lat = xmpValues(xml, 'exif:GPSLatitude')[0];
  const lon = xmpValues(xml, 'exif:GPSLongitude')[0];
  if (lat && lon) {
    decoded++;
    const la = xmpCoord(lat);
    const lo = xmpCoord(lon);
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
      if (!out.gps) out.gps = { latitude: la, longitude: lo, group: 'XMP' };
      addField(out, { tag: 'GPS Coordinates', value: `${la.toFixed(6)}, ${lo.toFixed(6)}`, privacy: 'high', warning: LOCATION_WARN, group: 'XMP' });
    } else {
      addField(out, { tag: 'GPS Coordinates', value: `${lat}, ${lon} (not a usable position)`, privacy: 'low', group: 'XMP' });
    }
  }
  if (!decoded) {
    note(out, `The XMP in ${where} holds none of the common fields this viewer decodes. It can still hold a name, a place or a time under a field this viewer does not know.`);
    cannotDecode(out, 'an XMP block this viewer does not decode');
  }
}

// ───────────────────────────── IPTC and Photoshop resources ─────────────────────────────

const IPTC_DATASETS: Record<number, [string, Risk, string?]> = {
  0: ['Record Version', 'low'],
  5: ['Object Name', 'medium', TEXT_WARN],
  7: ['Edit Status', 'low'],
  10: ['Urgency', 'low'],
  15: ['Category', 'low'],
  20: ['Supplemental Categories', 'low'],
  25: ['Keywords', 'medium', TEXT_WARN],
  40: ['Special Instructions', 'medium', TEXT_WARN],
  55: ['Date Created', 'medium'],
  60: ['Time Created', 'medium'],
  62: ['Digital Creation Date', 'medium'],
  63: ['Digital Creation Time', 'medium'],
  65: ['Originating Program', 'medium', SOFTWARE_WARN],
  70: ['Program Version', 'low'],
  80: ['By-line', 'high', NAME_WARN],
  85: ['By-line Title', 'medium'],
  90: ['City', 'high', PLACE_WARN],
  92: ['Sub-location', 'high', PLACE_WARN],
  95: ['Province/State', 'medium', PLACE_WARN],
  100: ['Country Code', 'medium'],
  101: ['Country', 'medium'],
  103: ['Original Transmission Reference', 'medium'],
  105: ['Headline', 'medium', TEXT_WARN],
  110: ['Credit', 'medium'],
  115: ['Source', 'medium'],
  116: ['Copyright Notice', 'medium', "Often includes the owner's name"],
  118: ['Contact', 'high', CONTACT_WARN],
  120: ['Caption/Abstract', 'medium', TEXT_WARN],
  122: ['Writer/Editor', 'high', NAME_WARN],
};

function readIptc(d: Uint8Array, where: string, out: ImageMetadata): void {
  if (!d.length) return; // an empty IPTC resource (some writers leave one) carries nothing
  if (!spend(out, 'iptc')) return;
  addBlock(out, 'IPTC', where, d.length);
  const before = out.fields.length;
  const acc = new Map<number, string[]>();
  let off = 0;
  for (let steps = 0; off + 5 <= d.length && steps < 100000; steps++) {
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
    if (size > d.length - p) break;
    if (rec === 2) {
      const values = acc.get(ds) ?? [];
      if (values.length < 100) {
        values.push(ds === 0 && size === 2 ? String(u16be(d, p)) : cleanText(decodeText(d.subarray(p, p + Math.min(size, LIMITS.valueBytes)))));
      }
      acc.set(ds, values);
    }
    off = p + size;
  }
  acc.forEach((values, ds) => {
    const def = IPTC_DATASETS[ds];
    const v = values.filter(Boolean).join('; ');
    if (def) {
      textRow(out, def[0], v, def[1], def[2], 'IPTC');
    } else {
      const readable = v.replace(/\s/g, '').length >= 4;
      textRow(out, `IPTC 2:${ds}`, v, readable ? 'medium' : 'low', 'Not a common IPTC field', 'IPTC');
    }
  });
  if (out.fields.length === before) {
    note(out, `The IPTC block in ${where} holds no record 2 dataset, the part this viewer decodes.`);
    cannotDecode(out, 'an IPTC block this viewer does not decode');
  }
}

function photoshopThumbnail(d: Uint8Array, out: ImageMetadata): void {
  if (d.length < 28) return;
  const w = u32be(d, 4);
  const h = u32be(d, 8);
  const jpeg = d.subarray(28);
  const isJpeg = u32be(d, 0) === 1 && jpeg[0] === 0xff && jpeg[1] === 0xd8;
  const format = isJpeg ? 'JPEG' : 'Raw';
  addField(out, { tag: 'Photoshop Thumbnail', value: `${format}, ${w} × ${h} px, ${bytesLabel(d.length)}`, privacy: 'medium', warning: THUMB_WARN, group: 'Photoshop resources' });
  if (!out.thumbnail) out.thumbnail = { format, size: jpeg.length, width: w, height: h, group: 'Photoshop resources', jpeg: isJpeg ? jpeg : undefined };
}

/** Photoshop image resources ("8BIM" blocks): IPTC, XMP, ICC and the Photoshop thumbnail. */
function readIrb(d: Uint8Array, where: string, out: ImageMetadata): void {
  if (!spend(out, 'photoshop')) return;
  addBlock(out, 'Photoshop resources', where, d.length);
  let off = 0;
  for (let n = 0; off + 12 <= d.length && n < LIMITS.segments; n++) {
    if (!startsWith(d.subarray(off), '8BIM')) break;
    const id = u16be(d, off + 4);
    const nameLen = d[off + 6];
    let p = off + 7 + nameLen;
    if ((nameLen + 1) % 2) p++; // the Pascal name, length byte included, is padded to even
    if (p + 4 > d.length) break;
    const size = u32be(d, p);
    p += 4;
    if (size > d.length - p) break;
    const data = d.subarray(p, p + size);
    if (id === 0x0404) readIptc(data, where, out);
    else if (id === 0x0424) readXmp(decodeText(data.subarray(0, LIMITS.xmpChars)), `${where} (Photoshop resource)`, out);
    else if (id === 0x040f) addBlock(out, 'ICC profile', where, size);
    else if (id === 0x0409 || id === 0x040c) photoshopThumbnail(data, out);
    off = p + size + (size % 2);
  }
}

// ───────────────────────────── JPEG ─────────────────────────────

const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXT_SIG = 'http://ns.adobe.com/xmp/extension/\0';

function commentRow(out: ImageMetadata, text: string, group: string): void {
  addBlock(out, 'Comment', group, text.length);
  textRow(out, 'Comment', text, 'medium', TEXT_WARN, group);
}

/** Multi-Picture Format (APP2 "MPF"): how many images the file holds. Presence only. */
function readMpf(t: Uint8Array, out: ImageMetadata): void {
  if (t.length < 8) return;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return;
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : 0);
  const u32 = (o: number) => (le ? u32le(t, o) : u32be(t, o));
  const off = u32(4);
  if (off < 8 || off + 2 > t.length) return;
  const n = Math.min(u16(off), 64);
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12;
    if (e + 12 > t.length) break;
    if (u16(e) !== 0xb001) continue;
    const images = u32(e + 8);
    if (images > 1) {
      addBlock(out, 'Multi-Picture images', 'JPEG APP2', t.length);
      const extra = images - 1 > 99 ? 'more than 99 more images' : count(images - 1, 'more image');
      note(out, `This file holds ${extra} in Multi-Picture Format, such as a preview, a depth map or an HDR layer. Their own metadata is not read.`);
      cannotDecode(out, 'extra images stored beside the main picture, whose own metadata is not read');
    }
    return;
  }
}

function readJpeg(b: Uint8Array, out: ImageMetadata): void {
  let off = 2;
  let icc = 0;
  let c2pa = 0;
  let jumbfIsC2pa = false;
  const other: string[] = [];
  let n = 0;
  for (; off + 4 <= b.length && n < LIMITS.segments; n++) {
    if (b[off] !== 0xff) {
      note(out, 'The JPEG structure breaks off partway; later segments were not read.');
      cannotDecode(out, 'a break in its JPEG structure, with the segments after it unread');
      break;
    }
    const m = b[off + 1];
    if (m === 0xff) { off++; continue; } // fill byte
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { off += 2; continue; }
    if (m === 0xd9 || m === 0xda) break; // end of image, or the image data itself
    const len = u16be(b, off + 2);
    if (len < 2 || off + 2 + len > b.length) {
      note(out, 'A JPEG segment runs past the end of the file; reading stopped there.');
      cannotDecode(out, 'a JPEG segment that runs past the end of the file, with the segments after it unread');
      break;
    }
    const seg = b.subarray(off + 4, off + 2 + len);
    if (m === 0xe1) {
      if (startsWith(seg, 'Exif\0\0')) {
        // Every Exif segment, not only the first: a file can hold a second one
        // whose GPS the first does not carry, and stopping at the first made
        // that photo look clean. spend() caps how many are read, and says so.
        readTiffBlock(seg.subarray(6), 'JPEG APP1', out);
      } else if (startsWith(seg, XMP_SIG)) {
        readXmp(decodeText(seg.subarray(XMP_SIG.length)), 'JPEG APP1', out);
      } else if (startsWith(seg, XMP_EXT_SIG)) {
        addBlock(out, 'XMP', 'JPEG APP1, extended part', seg.length);
        note(out, 'Part of the XMP is stored as "extended XMP"; that part is not decoded.');
        cannotDecode(out, 'an "extended XMP" part this viewer does not decode');
      } else if (!other.includes('APP1')) other.push('APP1');
    } else if (m === 0xe2) {
      if (startsWith(seg, 'ICC_PROFILE\0')) icc += Math.max(0, seg.length - 14);
      else if (startsWith(seg, 'MPF\0')) readMpf(seg.subarray(4), out);
      else if (!other.includes('APP2')) other.push('APP2');
    } else if (m === 0xeb) {
      // JUMBF boxes; Content Credentials label theirs "c2pa".
      if (startsWith(seg, 'JP')) {
        if (latin1(seg, 0, 160).indexOf('c2pa') >= 0) jumbfIsC2pa = true;
        c2pa += seg.length;
      } else if (!other.includes('APP11')) other.push('APP11');
    } else if (m === 0xed) {
      if (startsWith(seg, 'Photoshop 3.0\0')) readIrb(seg.subarray(14), 'JPEG APP13', out);
      else if (!other.includes('APP13')) other.push('APP13');
    } else if (m === 0xfe) {
      commentRow(out, decodeText(seg), 'JPEG comment');
    } else if (m === 0xe0) {
      if (startsWith(seg, 'JFIF\0') && seg.length >= 14 && seg[12] > 0 && seg[13] > 0) {
        const w = seg[12];
        const h = seg[13];
        addField(out, { tag: 'JFIF Thumbnail', value: `Uncompressed, ${w} × ${h} px, ${bytesLabel(3 * w * h)}`, privacy: 'medium', warning: THUMB_WARN, group: 'JFIF' });
        if (!out.thumbnail) out.thumbnail = { format: 'Uncompressed', size: 3 * w * h, width: w, height: h, group: 'JFIF' };
      }
    } else if (m >= 0xe3 && m <= 0xef && m !== 0xee) {
      const name = `APP${m - 0xe0}`;
      if (!other.includes(name)) other.push(name);
    }
    off += 2 + len;
  }
  if (icc) addBlock(out, 'ICC profile', 'JPEG APP2', icc);
  if (c2pa && jumbfIsC2pa) addBlock(out, 'Content Credentials (C2PA)', 'JPEG APP11', c2pa);
  else if (c2pa && !other.includes('APP11')) other.push('APP11');
  if (other.length) {
    note(out, `Other JPEG segments were found but not decoded: ${other.join(', ')}.`);
    cannotDecode(out, `JPEG segments this viewer does not decode (${other.join(', ')})`);
  }
  if (n >= LIMITS.segments && off + 4 <= b.length) {
    note(out, `Reading stopped after ${LIMITS.segments.toLocaleString('en-US')} JPEG segments; metadata after that point was not read.`);
    cannotDecode(out, `more segments than this viewer reads (it stopped after ${LIMITS.segments.toLocaleString('en-US')})`);
  }
}

// ───────────────────────────── PNG ─────────────────────────────

function pngKeyRisk(key: string): [Risk, string] {
  if (/author|artist|creator|owner|e-?mail|by-?line|contact|photographer|username/i.test(key)) return ['high', "Often a person's name or contact details"];
  if (/gps|location|latitude|longitude|city|address|place/i.test(key)) return ['high', PLACE_WARN];
  if (/^software$/i.test(key)) return ['medium', SOFTWARE_WARN];
  if (/time|date/i.test(key)) return ['medium', 'A date or time written into the file'];
  if (/parameters|prompt|workflow/i.test(key)) return ['medium', 'Can hold the prompt and settings used to generate the image'];
  return ['medium', TEXT_WARN];
}

/** ImageMagick stores whole profiles in PNG text as "\n<name>\n<length>\n<hex…>". */
function readRawProfile(out: ImageMetadata, type: string, text: string, where: string): void {
  const m = /^\s*(\S+)\s+(\d+)\s+/.exec(text);
  const hex = m ? text.slice(m[0].length).replace(/[^0-9a-fA-F]/g, '') : '';
  const declared = m ? parseInt(m[2], 10) : 0;
  const n = Math.min(Math.floor(hex.length / 2), declared, LIMITS.inflatedBytes);
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  if ((type === 'exif' || type === 'app1') && readTiffBlock(bytes, where, out)) return;
  if (type === 'xmp' && n) { readXmp(decodeText(bytes), where, out); return; }
  if ((type === 'iptc' || type === '8bim') && n) {
    if (startsWith(bytes, '8BIM')) readIrb(bytes, where, out);
    else readIptc(bytes, where, out);
    return;
  }
  if ((type === 'icc' || type === 'icm') && n) { addBlock(out, 'ICC profile', where, n); return; }
  addField(out, { tag: `Raw profile type ${type}`, value: `${bytesLabel(n)}, not decoded`, privacy: 'medium', warning: 'An embedded profile this viewer does not decode', group: 'PNG text' });
}

function pngText(out: ImageMetadata, rawKey: string, value: string, where: string): void {
  const key = cleanText(rawKey).slice(0, 79) || '(no keyword)';
  if (key === 'XML:com.adobe.xmp') { readXmp(value, where, out); return; }
  const raw = /^Raw profile type ([A-Za-z0-9]+)$/.exec(key);
  if (raw) { readRawProfile(out, raw[1].toLowerCase(), value, `${where} "${key}"`); return; }
  addBlock(out, 'PNG text', where, value.length);
  const [risk, warning] = pngKeyRisk(key);
  textRow(out, key, value, risk, warning, 'PNG text');
}

/**
 * PNG chunks that hold pixels, colour, geometry or timing — nothing personal —
 * plus the ones read above. Anything else is listed as found and not decoded,
 * the way JPEG's APPn segments are: a private chunk can hold a whole preview
 * image or an editor's notes, and the verdict must not call the file clean.
 */
const PNG_KNOWN = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB',
  'cICP', 'mDCv', 'cLLi', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'sTER', 'oFFs', 'pCAL',
  'sCAL', 'acTL', 'fcTL', 'fdAT', 'tIME', 'eXIf', 'tEXt', 'zTXt', 'iTXt', 'caBX',
  // ImageMagick's private chunks: virtual canvas geometry and orientation.
  'vpAg', 'caNv', 'orNT',
]);

function readPng(b: Uint8Array, out: ImageMetadata): void {
  let off = 8;
  const cap = LIMITS.segments * 4;
  let n = 0;
  /** Compressed text chunks met, which is not the number kept: `pending` is capped. */
  let compressed = 0;
  const other: string[] = [];
  for (; off + 8 <= b.length && n < cap; n++) {
    const len = u32be(b, off);
    const type = latin1(b, off + 4, off + 8);
    const start = off + 8;
    if (len > b.length - start) {
      note(out, `A PNG chunk${/^[A-Za-z]{4}$/.test(type) ? ` (${type})` : ''} runs past the end of the file; reading stopped there.`);
      cannotDecode(out, 'a PNG chunk that runs past the end of the file, with the chunks after it unread');
      break;
    }
    const data = b.subarray(start, start + len);
    if (type === 'eXIf') {
      readTiffBlock(data, 'PNG eXIf chunk', out);
    } else if (type === 'tEXt') {
      const nul = data.indexOf(0);
      if (nul > 0) pngText(out, latin1(data, 0, nul), latin1(data, nul + 1), 'PNG tEXt chunk');
    } else if (type === 'iTXt') {
      const nul = data.indexOf(0);
      if (nul > 0 && nul + 2 < data.length) {
        const key = latin1(data, 0, nul);
        const deflated = data[nul + 1] === 1;
        const langEnd = data.indexOf(0, nul + 3);
        const tkeyEnd = langEnd < 0 ? -1 : data.indexOf(0, langEnd + 1);
        if (tkeyEnd >= 0) {
          const payload = data.subarray(tkeyEnd + 1);
          if (!deflated) pngText(out, key, decodeText(payload), 'PNG iTXt chunk');
          else if (++compressed <= LIMITS.pendingTexts) out.pending.push({ key, where: 'PNG iTXt chunk', data: payload, utf8: true });
        }
      }
    } else if (type === 'zTXt') {
      const nul = data.indexOf(0);
      if (nul > 0 && nul + 2 <= data.length && ++compressed <= LIMITS.pendingTexts) {
        out.pending.push({ key: latin1(data, 0, nul), where: 'PNG zTXt chunk', data: data.subarray(nul + 2), utf8: false });
      }
    } else if (type === 'iCCP') {
      addBlock(out, 'ICC profile', 'PNG iCCP chunk', len);
    } else if (type === 'tIME' && len >= 7) {
      const pad = (v: number) => String(v).padStart(2, '0');
      addField(out, {
        tag: 'Last Modification Time',
        value: `${u16be(data, 0)}-${pad(data[2])}-${pad(data[3])} ${pad(data[4])}:${pad(data[5])}:${pad(data[6])} UTC`,
        privacy: 'medium',
        warning: 'When the file was last changed',
        group: 'PNG tIME chunk',
      });
    } else if (type === 'caBX') {
      addBlock(out, 'Content Credentials (C2PA)', 'PNG caBX chunk', len);
    } else if (type === 'IEND') {
      break;
    } else if (!PNG_KNOWN.has(type) && /^[A-Za-z]{4}$/.test(type) && !other.includes(type) && other.length < 8) {
      other.push(type);
    }
    off = start + len + 4; // skip the CRC
  }
  if (other.length) {
    note(out, `Other PNG chunks were found but not decoded: ${other.join(', ')}.`);
    cannotDecode(out, `PNG chunks this viewer does not decode (${other.join(', ')})`);
  }
  if (compressed > LIMITS.pendingTexts) {
    note(out, `This file holds ${compressed.toLocaleString('en-US')} compressed text chunks; only the first ${LIMITS.pendingTexts} are read.`);
    cannotDecode(out, `more compressed text chunks than this viewer reads (it stopped at ${LIMITS.pendingTexts})`);
  }
  if (n >= cap && off + 8 <= b.length) {
    note(out, `Reading stopped after ${cap.toLocaleString('en-US')} PNG chunks; metadata after that point was not read.`);
    cannotDecode(out, `more chunks than this viewer reads (it stopped after ${cap.toLocaleString('en-US')})`);
  }
}

async function inflate(data: Uint8Array, cap: number): Promise<Uint8Array | null> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(data.slice()).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const outBytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { outBytes.set(c, o); o += c.length; }
  return outBytes;
}

/**
 * Decompress the compressed PNG text chunks readImageMetadata() set aside,
 * and add what they hold. Needs DecompressionStream; without it each chunk
 * becomes a row saying it could not be read. Output is capped, so a
 * decompression bomb stops at LIMITS.inflatedBytes.
 */
export async function inflatePending(meta: ImageMetadata): Promise<void> {
  const items = meta.pending.splice(0);
  const canInflate = typeof DecompressionStream !== 'undefined';
  let left: number = LIMITS.inflatedTotal;
  for (const p of items) {
    let value = '';
    let reason = canInflate ? '(compressed text that could not be decompressed)' : '(compressed; this browser cannot decompress it)';
    if (canInflate && left <= 0) {
      reason = `(compressed text past the ${bytesLabel(LIMITS.inflatedTotal)} this viewer decompresses per file; not read)`;
    } else if (canInflate) {
      try {
        const cap = Math.min(LIMITS.inflatedBytes, left);
        const bytes = await inflate(p.data, cap);
        if (bytes) {
          left -= bytes.length;
          value = p.utf8 ? decodeText(bytes) : latin1(bytes);
          reason = '';
        } else {
          left -= cap;
          reason = `(compressed text larger than ${bytesLabel(cap)} once decompressed; not read)`;
        }
      } catch {
        /* corrupt stream: keep the reason */
      }
    }
    try {
      if (reason) addField(meta, { tag: cleanText(p.key).slice(0, 79) || '(no keyword)', value: reason, privacy: 'medium', warning: 'A compressed text chunk this viewer could not read', group: 'PNG text' });
      else pngText(meta, p.key, value, `${p.where}, decompressed`);
    } catch {
      note(meta, 'Part of the file could not be read; the fields listed were read before that point.');
      cannotDecode(meta, 'a part this viewer could not read');
    }
  }
}

// ───────────────────────────── WebP, GIF ─────────────────────────────

function readWebp(b: Uint8Array, out: ImageMetadata): void {
  let off = 12;
  let n = 0;
  for (; off + 8 <= b.length && n < LIMITS.segments; n++) {
    const id = latin1(b, off, off + 4);
    const size = u32le(b, off + 4);
    const start = off + 8;
    if (size > b.length - start) {
      note(out, 'A WebP chunk runs past the end of the file; reading stopped there.');
      cannotDecode(out, 'a WebP chunk that runs past the end of the file, with the chunks after it unread');
      break;
    }
    const data = b.subarray(start, start + size);
    if (id === 'EXIF') readTiffBlock(data, 'WebP EXIF chunk', out);
    else if (id === 'XMP ') readXmp(decodeText(data.subarray(0, LIMITS.xmpChars)), 'WebP XMP chunk', out);
    else if (id === 'ICCP') addBlock(out, 'ICC profile', 'WebP ICCP chunk', size);
    else if (id === 'C2PA') addBlock(out, 'Content Credentials (C2PA)', 'WebP C2PA chunk', size);
    off = start + size + (size % 2);
  }
  if (n >= LIMITS.segments && off + 8 <= b.length) {
    note(out, `Reading stopped after ${LIMITS.segments.toLocaleString('en-US')} WebP chunks; metadata after that point was not read.`);
    cannotDecode(out, `more chunks than this viewer reads (it stopped after ${LIMITS.segments.toLocaleString('en-US')})`);
  }
}

function readGif(b: Uint8Array, out: ImageMetadata): void {
  if (b.length < 13) return;
  let off = 13;
  if (b[10] & 0x80) off += 3 * (1 << ((b[10] & 7) + 1)); // global colour table
  let steps = 0;
  const skipSubBlocks = (from: number): number => {
    let o = from;
    while (o < b.length && steps++ < 4_000_000) {
      const n = b[o];
      if (n === 0) return o + 1;
      o += 1 + n;
    }
    return b.length;
  };
  while (off < b.length && steps++ < 4_000_000) {
    const id = b[off];
    if (id === 0x3b) break; // trailer
    if (id === 0x21) {
      const label = b[off + 1];
      if (label === 0xfe) {
        const parts: Uint8Array[] = [];
        let o = off + 2;
        let total = 0;
        while (o < b.length && steps++ < 4_000_000) {
          const n = b[o];
          if (n === 0) { o++; break; }
          if (total < LIMITS.valueBytes) parts.push(b.subarray(o + 1, Math.min(b.length, o + 1 + n)));
          total += n;
          o += 1 + n;
        }
        commentRow(out, parts.map((p) => latin1(p)).join(''), 'GIF comment');
        off = o;
      } else if (label === 0xff && b[off + 2] === 11) {
        const start = off + 14;
        if (latin1(b, off + 3, start) === 'XMP DataXMP') {
          // The packet is stored raw (a "magic trailer" keeps the sub-block walk valid), so read up to its end marker.
          const hay = latin1(b, start, Math.min(b.length, start + LIMITS.xmpChars));
          const endMark = hay.indexOf('<?xpacket end');
          const close = endMark >= 0 ? hay.indexOf('?>', endMark) : -1;
          const len = close >= 0 ? close + 2 : hay.indexOf('</x:xmpmeta>') >= 0 ? hay.indexOf('</x:xmpmeta>') + 12 : hay.length;
          readXmp(decodeText(b.subarray(start, start + len)), 'GIF XMP extension', out);
        }
        off = skipSubBlocks(start);
      } else {
        off = skipSubBlocks(off + 2);
      }
    } else if (id === 0x2c) {
      if (off + 10 > b.length) {
        note(out, 'A GIF image block runs past the end of the file; reading stopped there.');
        cannotDecode(out, 'a GIF block that runs past the end of the file, with the blocks after it unread');
        break;
      }
      const packed = b[off + 9];
      off += 10;
      if (packed & 0x80) off += 3 * (1 << ((packed & 7) + 1)); // local colour table
      off = skipSubBlocks(off + 1); // skip the LZW minimum code size, then the image data
    } else {
      note(out, 'The GIF structure breaks off partway; later blocks were not read.');
      cannotDecode(out, 'a break in its GIF structure, with the blocks after it unread');
      break;
    }
  }
}

// ───────────────────────────── entry points ─────────────────────────────

export function detectImageFormat(b: Uint8Array): ImageFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && latin1(b, 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 6 && (latin1(b, 0, 6) === 'GIF87a' || latin1(b, 0, 6) === 'GIF89a')) return 'gif';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && (b[2] === 0x2a || b[2] === 0x2b) && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && (b[3] === 0x2a || b[3] === 0x2b)))) return 'tiff';
  if (b.length >= 12 && latin1(b, 0, 4) === 'RIFF' && latin1(b, 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && latin1(b, 4, 8) === 'ftyp') {
    const end = Math.min(u32be(b, 0), b.length, 4096);
    const brands = [latin1(b, 8, 12)];
    for (let o = 16; o + 4 <= end; o += 4) brands.push(latin1(b, o, o + 4));
    if (brands.some((x) => x === 'avif' || x === 'avis')) return 'avif';
    if (brands.some((x) => /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|mif2)$/.test(x))) return 'heic';
  }
  return 'unknown';
}

/**
 * Read every metadata block this viewer knows in an image file. Synchronous;
 * compressed PNG text is left in `pending` for inflatePending().
 */
export function readImageMetadata(input: ArrayBuffer | Uint8Array): ImageMetadata {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out: ImageMetadata = { format: detectImageFormat(b), fields: [], blocks: [], gps: null, thumbnail: null, unread: false, notes: [], undecoded: [], pending: [], truncated: false };
  try {
    switch (out.format) {
      case 'jpeg': readJpeg(b, out); break;
      case 'png': readPng(b, out); break;
      case 'webp': readWebp(b, out); break;
      case 'gif': readGif(b, out); break;
      case 'tiff':
        // readTiffBlock names the variant and sets out.unread, so a BigTIFF or
        // a broken header lands on "not read here", never a green "no metadata".
        if (!readTiffBlock(b, 'TIFF file', out, true)) out.unread = true;
        break;
      case 'heic':
      case 'avif':
        out.unread = true;
        note(
          out,
          `${out.format === 'heic' ? 'HEIC/HEIF' : 'AVIF'} files are recognised, but this viewer does not read the metadata inside them. They can carry the same Exif as a JPEG, GPS included: save the photo as JPEG and choose that copy to read it.`,
        );
        break;
      default:
        note(out, 'Unrecognised file type: no metadata was read.');
    }
  } catch {
    note(out, 'Part of the file could not be read; the fields listed were read before that point.');
    cannotDecode(out, 'a part this viewer could not read');
  }
  const c2pa = out.blocks.filter((x) => x.kind === 'Content Credentials (C2PA)').reduce((s, x) => s + x.size, 0);
  if (c2pa) addField(out, { tag: 'Content Credentials (C2PA)', value: `${bytesLabel(c2pa)}, not decoded`, privacy: 'medium', warning: C2PA_WARN, group: 'Content Credentials' });
  return out;
}

export interface MetadataSummary {
  /** The one rule for both the console and the result bus. */
  severity: 'red' | 'amber' | 'green' | 'info';
  headline: string;
  stats: Array<{ label: string; value: string }>;
  high: MetaField[];
  medium: MetaField[];
  low: MetaField[];
  hasGps: boolean;
  /** ImageMetadata.undecoded: what was found and not read. */
  undecoded: string[];
}

function names(list: MetaField[]): string {
  const n = uniq(list.map((f) => f.tag));
  if (n.length <= 3) return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0];
  return `${n.slice(0, 3).join(', ')} and ${n.length - 3} more`;
}

/** "a", "a and b", "a, b and c": the undecoded phrases, in one sentence. */
function joinPhrases(items: string[]): string {
  const shown = items.length > 3 ? [...items.slice(0, 2), `${items.length - 2} more things this viewer does not read`] : items;
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/**
 * The verdict: red for GPS coordinates or any high-risk field (a name, a
 * place, a serial number, a unique ID); amber for any medium-risk field
 * (device, time, software, free text, a thumbnail, an undecoded block);
 * amber too when a block was found that this viewer cannot read or a read
 * stopped early, whatever else the file holds, because an XMP packet it does
 * not decode can carry a name or a street and an unread segment can carry
 * GPS; green for technical fields only, or none, and only when nothing was
 * left unread; info when nothing was read (HEIC, AVIF, BigTIFF, an unknown
 * file).
 *
 * Green never says "no metadata": it says what was read and found nothing in
 * ("the fields this viewer reads"), so it stays true of a file that also
 * holds an ICC profile or a block listed but not decoded.
 */
export function summarizeMetadata(meta: ImageMetadata): MetadataSummary {
  const high = meta.fields.filter((f) => f.privacy === 'high');
  const medium = meta.fields.filter((f) => f.privacy === 'medium');
  const low = meta.fields.filter((f) => f.privacy === 'low');
  if (meta.unread || meta.format === 'unknown') {
    return {
      severity: 'info',
      headline: meta.unread
        ? `${FORMAT_LABEL[meta.format]} image: the format is recognised, but its metadata is not read here`
        : 'Unrecognised file type: no metadata was read',
      stats: [{ label: 'Format', value: FORMAT_LABEL[meta.format] }],
      high,
      medium,
      low,
      hasGps: false,
      undecoded: meta.undecoded,
    };
  }
  const hasGps = meta.gps !== null;
  const total = meta.fields.length;
  let severity: MetadataSummary['severity'];
  let headline: string;
  if (hasGps) {
    severity = 'red';
    headline = 'This photo carries the GPS location where it was taken';
  } else if (high.length) {
    severity = 'red';
    headline = `This photo carries ${count(high.length, 'identifying field')}: ${names(high)}`;
  } else if (medium.length) {
    severity = 'amber';
    headline = `This photo carries ${count(total, 'metadata field')}, including ${names(medium)}`;
  } else if (meta.undecoded.length) {
    // Nothing risky was decoded, but something in the file was not read at
    // all. Saying "no location or device data" here would be a guess.
    severity = 'amber';
    headline = total
      ? `This photo carries ${count(total, 'technical field')}, and this file holds ${joinPhrases(meta.undecoded)}`
      : `This file holds ${joinPhrases(meta.undecoded)}`;
  } else if (total) {
    severity = 'green';
    headline = `This photo carries only technical metadata: ${count(total, 'field')}`;
  } else {
    severity = 'green';
    // A block this viewer lists without decoding (an ICC profile, a Photoshop
    // resource) makes "nothing found" false, so say what was read instead.
    headline = meta.blocks.length
      ? 'No location, device or time data in the fields this viewer reads'
      : 'No Exif, XMP, IPTC or text metadata found in this file';
  }
  return {
    severity,
    headline,
    // With nothing decoded there is no field count worth sharing: "Fields 0"
    // draws "No metadata" on the scorecard, which is what this fix is about.
    // A stat named something else leaves the scorecard off (lib/scorecard.ts).
    stats:
      total === 0 && meta.undecoded.length
        ? [
            { label: 'Decoded fields', value: '0' },
            { label: 'Blocks found', value: String(meta.blocks.length) },
            { label: 'GPS', value: 'no' },
          ]
        : [
            { label: 'High-risk', value: String(high.length) },
            { label: 'GPS', value: hasGps ? 'yes' : 'no' },
            { label: 'Fields', value: String(total) },
          ],
    high,
    medium,
    low,
    hasGps,
    undecoded: meta.undecoded,
  };
}
