/**
 * Image Metadata Viewer (lib/exif.ts + components/tools/MetadataViewerTool).
 *
 * The funnel pilot found the viewer read only the first APP1 segment's IFD0
 * (12 named tags) and GPS, while the page promised "every EXIF tag" and
 * WebP/GIF/TIFF support. These tests build their own files with a small
 * TIFF writer and check the whole structure is read: the Exif sub-IFD, GPS,
 * Interop, IFD1's thumbnail, the four containers, XMP and IPTC, and that a
 * hostile file (a directory loop, counts and offsets past the end) ends.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { inflatePending, LIMITS, readImageMetadata, summarizeMetadata, type ImageMetadata } from '../lib/exif';
import { scorecardFigure } from '../lib/scorecard';
import { ENGINE_COPY } from '../lib/cta-copy';
import { METADATA_VIEWER_READS } from '../components/tools/MetadataViewerTool';

// ───────────────────────────── a small TIFF writer ─────────────────────────────

type Value =
  | { kind: 'ascii'; s: string }
  | { kind: 'short'; v: number[] }
  | { kind: 'long'; v: number[] }
  | { kind: 'rational'; v: Array<[number, number]> }
  | { kind: 'undef'; b: number[] }
  | { kind: 'byte'; b: number[] }
  /** LONG offset of another directory or blob, resolved at layout time. */
  | { kind: 'ptr'; to: string }
  /** A hand-made entry: any type, count and value/offset field (for hostile files). */
  | { kind: 'raw'; type: number; count: number; field: number };

interface Dir {
  name: string;
  entries: Array<[number, Value]>;
  next?: string;
}

const ascii = (s: string): Value => ({ kind: 'ascii', s });
const short = (...v: number[]): Value => ({ kind: 'short', v });
const long = (...v: number[]): Value => ({ kind: 'long', v });
const rational = (...v: Array<[number, number]>): Value => ({ kind: 'rational', v });
const undef = (b: number[] | string): Value => ({ kind: 'undef', b: typeof b === 'string' ? [...b].map((c) => c.charCodeAt(0)) : b });
const byte = (...b: number[]): Value => ({ kind: 'byte', b });
const ptr = (to: string): Value => ({ kind: 'ptr', to });

function encode(v: Exclude<Value, { kind: 'ptr' } | { kind: 'raw' }>, le: boolean): { type: number; count: number; bytes: number[] } {
  const u16 = (n: number) => (le ? [n & 255, (n >> 8) & 255] : [(n >> 8) & 255, n & 255]);
  const u32 = (n: number) => {
    const b = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    return le ? b.reverse() : b;
  };
  switch (v.kind) {
    case 'ascii': return { type: 2, count: v.s.length + 1, bytes: [...Buffer.from(v.s, 'utf-8'), 0] };
    case 'short': return { type: 3, count: v.v.length, bytes: v.v.flatMap(u16) };
    case 'long': return { type: 4, count: v.v.length, bytes: v.v.flatMap(u32) };
    case 'rational': return { type: 5, count: v.v.length, bytes: v.v.flatMap(([n, d]) => [...u32(n), ...u32(d)]) };
    case 'undef': return { type: 7, count: v.b.length, bytes: v.b };
    case 'byte': return { type: 1, count: v.b.length, bytes: v.b };
  }
}

/** Lays out a TIFF structure: header, each directory followed by its out-of-line values, then the blobs. */
function tiff(dirs: Dir[], blobs: Record<string, number[]> = {}, le = true): Uint8Array {
  const pad = (n: number) => n + (n % 2);
  const at = new Map<string, number>();
  let o = 8;
  const laid = dirs.map((d) => {
    const ents = d.entries.map(([tag, v]) => ({ tag, v, enc: v.kind === 'ptr' || v.kind === 'raw' ? null : encode(v, le) }));
    const data = ents.reduce((s, e) => s + (e.enc && e.enc.bytes.length > 4 ? pad(e.enc.bytes.length) : 0), 0);
    at.set(d.name, o);
    o += 2 + ents.length * 12 + 4 + data;
    return { d, ents };
  });
  for (const [name, b] of Object.entries(blobs)) { at.set(name, o); o += pad(b.length); }
  const out = new Uint8Array(o);
  const w16 = (p: number, n: number) => { out[p] = le ? n & 255 : (n >> 8) & 255; out[p + 1] = le ? (n >> 8) & 255 : n & 255; };
  const w32 = (p: number, n: number) => {
    const b = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    (le ? b.reverse() : b).forEach((x, i) => { out[p + i] = x; });
  };
  out[0] = out[1] = le ? 0x49 : 0x4d;
  w16(2, 42);
  w32(4, at.get(dirs[0].name)!);
  for (const { d, ents } of laid) {
    let p = at.get(d.name)!;
    let data = p + 2 + ents.length * 12 + 4;
    w16(p, ents.length);
    p += 2;
    for (const e of ents) {
      w16(p, e.tag);
      if (e.v.kind === 'ptr') {
        w16(p + 2, 4); w32(p + 4, 1); w32(p + 8, at.get(e.v.to)!);
      } else if (e.v.kind === 'raw') {
        w16(p + 2, e.v.type); w32(p + 4, e.v.count); w32(p + 8, e.v.field);
      } else {
        const enc = e.enc!;
        w16(p + 2, enc.type); w32(p + 4, enc.count);
        if (enc.bytes.length <= 4) enc.bytes.forEach((x, i) => { out[p + 8 + i] = x; });
        else { w32(p + 8, data); enc.bytes.forEach((x, i) => { out[data + i] = x; }); data += pad(enc.bytes.length); }
      }
      p += 12;
    }
    w32(p, d.next ? at.get(d.next)! : 0);
  }
  for (const [name, b] of Object.entries(blobs)) out.set(b, at.get(name)!);
  return out;
}

// ───────────────────────────── containers ─────────────────────────────

const cat = (...parts: Array<Uint8Array | number[]>) => {
  const all = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
};
const str = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

const jpegSegment = (marker: number, payload: Uint8Array) => cat([0xff, marker], be16(payload.length + 2), payload);
const jpeg = (...segments: Uint8Array[]) => cat([0xff, 0xd8], ...segments, [0xff, 0xd9]);
const jpegWithExif = (t: Uint8Array) => jpeg(jpegSegment(0xe1, cat(str('Exif\0\0'), t)));

const riffChunk = (id: string, data: Uint8Array) => cat(str(id), le32(data.length), data, data.length % 2 ? [0] : []);
function webp(...chunks: Uint8Array[]): Uint8Array {
  const body = cat(str('WEBP'), riffChunk('VP8X', new Uint8Array(10)), ...chunks);
  return cat(str('RIFF'), le32(body.length), body);
}

const pngChunk = (type: string, data: Uint8Array) => cat(be32(data.length), str(type), data, [0, 0, 0, 0]);
const png = (...chunks: Uint8Array[]) =>
  cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pngChunk('IHDR', new Uint8Array(13)), ...chunks, pngChunk('IEND', new Uint8Array(0)));

/** A minimal JPEG stream the parser can size: SOI, SOF0 (120 × 160), EOI. */
const TINY_JPEG = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x00, 0xa0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9];

// ───────────────────────────── a camera photo's Exif ─────────────────────────────

const userComment = [...'ASCII\0\0\0'].map((c) => c.charCodeAt(0)).concat([...'Meet at the back door'].map((c) => c.charCodeAt(0)));

function cameraExif(le = true): Uint8Array {
  return tiff(
    [
      {
        name: 'ifd0',
        entries: [
          [0x010f, ascii('Canon')],
          [0x0110, ascii('Canon EOS R5')],
          [0x0112, short(6)],
          [0x011a, rational([72, 1])],
          [0x0131, ascii('Firmware 1.8.1')],
          [0x8769, ptr('exif')],
          [0x8825, ptr('gps')],
        ],
        next: 'ifd1',
      },
      {
        name: 'exif',
        entries: [
          [0x829a, rational([1, 125])],
          [0x829d, rational([28, 10])],
          [0x8827, short(400)],
          [0x9000, undef('0232')],
          [0x9003, ascii('2026:05:01 18:22:07')],
          [0x9011, ascii('+02:00')],
          [0x927c, undef(new Array(40).fill(7))],
          [0x9286, undef(userComment)],
          [0xa005, ptr('interop')],
          [0xa420, ascii('4f2a9c0e7b3d11ef')],
          [0xa431, ascii('012345678901')],
          [0xa434, ascii('RF24-105mm F4 L IS USM')],
          [0xa435, ascii('LENS-99887')],
          [0xc0de, ascii('Owner: J. Doe')],
        ],
      },
      {
        name: 'gps',
        entries: [
          [0x0000, byte(2, 3, 0, 0)],
          [0x0001, ascii('N')],
          [0x0002, rational([37, 1], [46, 1], [2964, 100])],
          [0x0003, ascii('W')],
          [0x0004, rational([122, 1], [25, 1], [984, 100])],
          [0x0005, byte(0)],
          [0x0006, rational([155, 10])],
          [0x0007, rational([14, 1], [3, 1], [22, 1])],
          [0x001d, ascii('2026:05:01')],
        ],
      },
      { name: 'interop', entries: [[0x0001, ascii('R98')], [0x0002, undef('0100')]] },
      { name: 'ifd1', entries: [[0x0103, short(6)], [0x0201, ptr('thumb')], [0x0202, long(TINY_JPEG.length)]] },
    ],
    { thumb: TINY_JPEG },
    le,
  );
}

const field = (m: ImageMetadata, tag: string) => m.fields.find((f) => f.tag === tag);
const rows = (m: ImageMetadata, tag: string) => m.fields.filter((f) => f.tag === tag);

describe('Exif is walked as a whole TIFF structure', () => {
  const m = readImageMetadata(jpegWithExif(cameraExif()));

  it('reads IFD0 by name', () => {
    expect(m.format).toBe('jpeg');
    expect(field(m, 'Make')).toMatchObject({ value: 'Canon', group: 'IFD0', privacy: 'medium' });
    expect(field(m, 'Model')?.value).toBe('Canon EOS R5');
    expect(field(m, 'Orientation')?.value).toBe('Rotated 90° clockwise');
    expect(field(m, 'X Resolution')?.value).toBe('72');
    // Pointers are followed, not listed.
    expect(m.fields.some((f) => f.id === 0x8769 || f.id === 0x8825)).toBe(false);
  });

  it('follows the Exif sub-IFD (0x8769): capture details, serial numbers, unique ID, user comment', () => {
    const exif = m.fields.filter((f) => f.group === 'Exif IFD');
    expect(exif.length).toBeGreaterThanOrEqual(13);
    expect(field(m, 'Exposure Time')?.value).toBe('1/125 s');
    expect(field(m, 'F Number')?.value).toBe('f/2.8');
    expect(field(m, 'ISO')?.value).toBe('400');
    expect(field(m, 'Exif Version')?.value).toBe('2.32');
    expect(field(m, 'Date/Time Original')).toMatchObject({ value: '2026:05:01 18:22:07', privacy: 'medium' });
    expect(field(m, 'Offset Time Original')?.privacy).toBe('medium');
    expect(field(m, 'Body Serial Number')).toMatchObject({ value: '012345678901', privacy: 'high', group: 'Exif IFD' });
    expect(field(m, 'Lens Serial Number')?.privacy).toBe('high');
    expect(field(m, 'Image Unique ID')).toMatchObject({ value: '4f2a9c0e7b3d11ef', privacy: 'high' });
    expect(field(m, 'User Comment')).toMatchObject({ value: 'Meet at the back door', privacy: 'medium' });
    expect(field(m, 'Lens Model')?.value).toBe('RF24-105mm F4 L IS USM');
    expect(field(m, 'Maker Note')).toMatchObject({ value: "40 bytes in the maker's own format, not decoded", privacy: 'medium' });
  });

  it('shows an unknown tag as "Tag 0x…", rated by whether it holds text', () => {
    expect(field(m, 'Tag 0xc0de')).toMatchObject({ value: 'Owner: J. Doe', privacy: 'medium', group: 'Exif IFD' });
  });

  it('follows the Interop IFD (0xA005)', () => {
    expect(field(m, 'Interoperability Index')).toMatchObject({ value: 'R98', group: 'Interop IFD', privacy: 'low' });
    expect(field(m, 'Interoperability Version')?.value).toBe('1.00');
  });

  it('decodes GPS into one position, with altitude and the UTC time of the fix', () => {
    expect(m.gps?.latitude).toBeCloseTo(37.7749, 4);
    expect(m.gps?.longitude).toBeCloseTo(-122.4194, 4);
    expect(m.gps?.altitude).toBeCloseTo(15.5, 5);
    const coords = field(m, 'GPS Coordinates');
    expect(coords).toMatchObject({ privacy: 'high', group: 'GPS IFD' });
    expect(coords?.value).toMatch(/^37\.774900, -122\.419400 \(37° 46' 29\.64" N, 122° 25' 9\.84" W\)$/);
    expect(field(m, 'GPS Altitude')?.value).toBe('15.5 m above sea level');
    expect(field(m, 'GPS Date/Time')?.value).toBe('2026:05:01 14:03:22 UTC');
    expect(field(m, 'GPS Version ID')?.value).toBe('2.3.0.0');
    // The reference letters are folded into the position, not listed again.
    expect(rows(m, 'GPS Latitude Ref')).toHaveLength(0);
    expect(rows(m, 'GPS Latitude')).toHaveLength(0);
  });

  it('reports IFD1, the embedded thumbnail: its presence, format, size and pixel size', () => {
    expect(m.thumbnail).toMatchObject({ format: 'JPEG', size: TINY_JPEG.length, width: 160, height: 120, group: 'IFD1 (thumbnail)' });
    expect(Array.from(m.thumbnail!.jpeg!)).toEqual(TINY_JPEG);
    expect(field(m, 'Embedded Thumbnail')).toMatchObject({ value: `JPEG, 160 × 120 px, ${TINY_JPEG.length} bytes`, privacy: 'medium', group: 'IFD1 (thumbnail)' });
    expect(field(m, 'Compression')).toMatchObject({ value: 'JPEG (old style)', group: 'IFD1 (thumbnail)' });
  });

  it('reads big-endian (MM) Exif the same way', () => {
    const mm = readImageMetadata(jpegWithExif(cameraExif(false)));
    expect(mm.fields.map((f) => `${f.group}|${f.tag}|${f.value}`)).toEqual(m.fields.map((f) => `${f.group}|${f.tag}|${f.value}`));
  });

  it('the verdict is red with GPS, and the result bus says so', () => {
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('red');
    expect(s.headline).toBe('This photo carries the GPS location where it was taken');
    expect(s.stats).toEqual([
      { label: 'High-risk', value: String(s.high.length) },
      { label: 'GPS', value: 'yes' },
      { label: 'Fields', value: String(m.fields.length) },
    ]);
    expect(scorecardFigure('metadata-viewer', s)).toBe('GPS location');
  });
});

describe('every container the copy names', () => {
  const t = cameraExif();
  const makes = (m: ImageMetadata) => [field(m, 'Make')?.value, field(m, 'Body Serial Number')?.value, !!m.gps, m.thumbnail?.width];

  it('WebP: an EXIF chunk, with or without the "Exif\\0\\0" prefix some writers keep', () => {
    const a = readImageMetadata(webp(riffChunk('EXIF', t)));
    const b = readImageMetadata(webp(riffChunk('EXIF', cat(str('Exif\0\0'), t))));
    expect(a.format).toBe('webp');
    expect(makes(a)).toEqual(['Canon', '012345678901', true, 160]);
    expect(makes(b)).toEqual(makes(a));
    expect(a.blocks).toContainEqual({ kind: 'Exif', where: 'WebP EXIF chunk', size: t.length });
  });

  it('WebP: an XMP chunk is read too', () => {
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmp:CreatorTool="Lightroom"/></rdf:RDF></x:xmpmeta>';
    const m = readImageMetadata(webp(riffChunk('XMP ', str(xmp))));
    expect(field(m, 'Creator Tool')).toMatchObject({ value: 'Lightroom', group: 'XMP' });
  });

  it('PNG: an eXIf chunk', () => {
    const m = readImageMetadata(png(pngChunk('eXIf', t)));
    expect(m.format).toBe('png');
    expect(makes(m)).toEqual(['Canon', '012345678901', true, 160]);
  });

  it('TIFF: the file is the TIFF structure', () => {
    const file = tiff([{ name: 'ifd0', entries: [[0x0100, long(4000)], [0x0101, long(3000)], [0x010f, ascii('Nikon')], [0xc62f, ascii('SN-77')]] }], {}, false);
    const m = readImageMetadata(file);
    expect(m.format).toBe('tiff');
    expect(field(m, 'Image Width')?.value).toBe('4000');
    expect(field(m, 'Make')?.value).toBe('Nikon');
    expect(field(m, 'Camera Serial Number')?.privacy).toBe('high');
  });

  it('PNG: ImageMagick\'s compressed "Raw profile type exif" text is inflated and read', async () => {
    const hex = Buffer.from(cat(str('Exif\0\0'), t)).toString('hex');
    const text = `\nexif\n${String(t.length + 6).padStart(8)}\n${hex.replace(/(.{72})/g, '$1\n')}\n`;
    const z = zlib.deflateSync(Buffer.from(text, 'latin1'));
    const m = readImageMetadata(png(pngChunk('zTXt', cat(str('Raw profile type exif\0'), [0], z))));
    expect(m.pending).toHaveLength(1);
    await inflatePending(m);
    expect(m.pending).toHaveLength(0);
    expect(makes(m)).toEqual(['Canon', '012345678901', true, 160]);
  });

  it('PNG: tEXt chunks become rows, rated by what the key says', () => {
    const m = readImageMetadata(png(pngChunk('tEXt', str('Author\0Jane Doe')), pngChunk('tEXt', str('Software\0Snipping Tool'))));
    expect(field(m, 'Author')).toMatchObject({ value: 'Jane Doe', privacy: 'high', group: 'PNG text' });
    expect(field(m, 'Software')?.privacy).toBe('medium');
  });

  it('JPEG: XMP (APP1) and IPTC (APP13) blocks are detected and their common fields decoded', () => {
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmpMM:DocumentID="xmp.did:1234" exif:GPSLatitude="51,30.0437N" exif:GPSLongitude="0,7.5W">' +
      '<dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Our new flat</rdf:li></rdf:Alt></dc:description>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta>';
    const iptc = cat([0x1c, 2, 80], be16(8), str('Jane Doe'), [0x1c, 2, 90], be16(6), str('London'));
    const irb = cat(str('8BIM'), be16(0x0404), [0, 0], be32(iptc.length), iptc);
    const m = readImageMetadata(jpeg(jpegSegment(0xe1, cat(str('http://ns.adobe.com/xap/1.0/\0'), str(xmp))), jpegSegment(0xed, cat(str('Photoshop 3.0\0'), irb))));
    expect(m.blocks.map((b) => b.kind)).toEqual(expect.arrayContaining(['XMP', 'IPTC', 'Photoshop resources']));
    expect(field(m, 'Creator')).toMatchObject({ value: 'Jane Doe', privacy: 'high', group: 'XMP' });
    expect(field(m, 'Description')?.value).toBe('Our new flat');
    expect(field(m, 'Document ID')?.privacy).toBe('high');
    expect(m.gps?.latitude).toBeCloseTo(51.500728, 5);
    expect(m.gps?.longitude).toBeCloseTo(-0.125, 5);
    expect(field(m, 'By-line')).toMatchObject({ value: 'Jane Doe', privacy: 'high', group: 'IPTC' });
    expect(field(m, 'City')).toMatchObject({ value: 'London', privacy: 'high', group: 'IPTC' });
  });

  it('JPEG and GIF comments are read', () => {
    const j = readImageMetadata(jpeg(jpegSegment(0xfe, str('shot for the landlord'))));
    expect(field(j, 'Comment')).toMatchObject({ value: 'shot for the landlord', group: 'JPEG comment', privacy: 'medium' });
    const gif = cat(str('GIF89a'), [1, 0, 1, 0, 0, 0, 0], [0x21, 0xfe, 5], str('hello'), [0], [0x3b]);
    const g = readImageMetadata(gif);
    expect(g.format).toBe('gif');
    expect(field(g, 'Comment')).toMatchObject({ value: 'hello', group: 'GIF comment' });
  });

  it('HEIC is recognised and not read; the verdict is info and there is no share card', () => {
    const heic = cat(be32(24), str('ftypheic'), be32(0), str('mif1heic'));
    const m = readImageMetadata(heic);
    expect(m.format).toBe('heic');
    expect(m.unread).toBe(true);
    expect(m.fields).toHaveLength(0);
    expect(m.notes.join(' ')).toMatch(/recognised, but this viewer does not read the metadata/);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('info');
    expect(s.headline).toMatch(/^HEIC image: the format is recognised, but its metadata is not read here$/);
    expect(scorecardFigure('metadata-viewer', s)).toBe('');
    const avif = readImageMetadata(cat(be32(24), str('ftypavif'), be32(0), str('mif1avif')));
    expect(avif.format).toBe('avif');
    expect(avif.unread).toBe(true);
  });
});

describe('hostile files end, and every read stays in bounds', () => {
  it('a cyclic IFD pointer is read once and the walk terminates', () => {
    // IFD0 -> Exif IFD -> (Exif pointer back to IFD0); IFD0.next -> IFD1 -> next back to IFD0; GPS points at itself.
    const t = tiff([
      { name: 'ifd0', entries: [[0x010f, ascii('Loop')], [0x8769, ptr('exif')], [0x8825, ptr('gps')]], next: 'ifd1' },
      { name: 'exif', entries: [[0x9003, ascii('2026:01:01 00:00:00')], [0x8769, ptr('ifd0')], [0xa005, ptr('exif')]] },
      { name: 'gps', entries: [[0x0006, rational([10, 1])], [0x8825, ptr('gps')]] },
      { name: 'ifd1', entries: [[0x0103, short(6)]], next: 'ifd0' },
    ]);
    for (const file of [jpegWithExif(t), t]) {
      const m = readImageMetadata(file);
      expect(rows(m, 'Make')).toHaveLength(1);
      expect(rows(m, 'Date/Time Original')).toHaveLength(1);
      expect(m.notes).toContain('A directory in this file points back to one already read (a loop). It was read once.');
    }
  });

  it('counts and offsets past the end of the file are refused, not followed', () => {
    const t = tiff([
      {
        name: 'ifd0',
        entries: [
          [0x010f, { kind: 'raw', type: 2, count: 0x7fffffff, field: 12 }], // a string "billions of bytes" long
          [0x0110, { kind: 'raw', type: 2, count: 64, field: 0xfffffff0 }], // value far past the end
          [0x0111, { kind: 'raw', type: 4, count: 0xffffffff, field: 8 }], // 4 G strip offsets
          [0x8769, { kind: 'raw', type: 4, count: 1, field: 0x7ffffff0 }], // Exif IFD past the end
          [0x9999, { kind: 'raw', type: 99, count: 1, field: 0 }], // unknown type
        ],
      },
    ]);
    const m = readImageMetadata(jpegWithExif(t));
    expect(field(m, 'Make')).toMatchObject({ value: '(the value points outside the file)', privacy: 'low' });
    expect(field(m, 'Model')?.value).toBe('(the value points outside the file)');
    expect(field(m, 'Strip Offsets')?.value).toBe('(the value points outside the file)');
    expect(field(m, 'Tag 0x9999')?.value).toBe('(stored as unknown type 99)');
    expect(m.fields.some((f) => f.group === 'Exif IFD')).toBe(false);
  });

  it('a directory claiming 65,535 entries in a tiny block reads only what fits', () => {
    const t = cat([0x49, 0x49, 42, 0], le32(8), [0xff, 0xff], new Array(12 * 3).fill(0));
    const m = readImageMetadata(jpegWithExif(t));
    expect(m.fields.length).toBeLessThanOrEqual(3);
    expect(m.notes.join(' ')).toMatch(/runs past the end of its block/);
  });

  it('random bytes behind every header never throw and stay within the row cap', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000);
    const headers = [[0xff, 0xd8, 0xff, 0xe1], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [...str('RIFF'), 0, 0, 0, 0, ...str('WEBP')], [0x49, 0x49, 42, 0], [0x4d, 0x4d, 0, 42], [...str('GIF89a')]];
    for (let i = 0; i < 300; i++) {
      const h = headers[i % headers.length];
      const body = Array.from({ length: 64 + Math.floor(rnd() * 2000) }, () => Math.floor(rnd() * 256));
      // Seed plausible structure so the walkers get past the first check.
      if (h[0] === 0x49 || h[0] === 0x4d) body.splice(0, 4, 8, 0, 0, 0);
      const m = readImageMetadata(Uint8Array.from([...h, ...body]));
      expect(m.fields.length).toBeLessThanOrEqual(LIMITS.fields);
    }
  });

  it('a file made of hundreds of metadata blocks reads only the first few of each kind', () => {
    const t0 = performance.now();
    const xmp = '<x:xmpmeta><rdf:RDF><rdf:Description xmp:CreatorTool="A"/></rdf:RDF></x:xmpmeta>';
    const j = readImageMetadata(jpeg(...Array.from({ length: 300 }, () => jpegSegment(0xe1, cat(str('http://ns.adobe.com/xap/1.0/\0'), str(xmp))))));
    expect(j.notes).toContain(`Only the first ${LIMITS.perFile.xmp} XMP blocks in this file were read.`);
    expect(rows(j, 'Creator Tool')).toHaveLength(LIMITS.perFile.xmp);
    const p = readImageMetadata(png(...Array.from({ length: 60 }, () => pngChunk('eXIf', cameraExif()))));
    expect(p.notes).toContain(`Only the first ${LIMITS.perFile.exif} Exif blocks in this file were read.`);
    expect(rows(p, 'Make')).toHaveLength(LIMITS.perFile.exif);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('a directory with thousands of entries is capped', () => {
    const entries: Array<[number, Value]> = Array.from({ length: 1200 }, (_, i) => [0x9000 + i, short(i)] as [number, Value]);
    const m = readImageMetadata(tiff([{ name: 'ifd0', entries }]));
    expect(m.fields.length).toBe(LIMITS.entriesPerIfd);
    expect(m.notes.join(' ')).toMatch(/more than 1000 entries/);
  });
});

describe('risk ratings and the verdict', () => {
  const fileWith = (entries: Array<[number, Value]>) => readImageMetadata(jpegWithExif(tiff([{ name: 'ifd0', entries }])));

  it('only technical fields: green, and the headline says so', () => {
    const m = fileWith([[0x0112, short(1)], [0x011a, rational([72, 1])], [0x0128, short(2)]]);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('green');
    expect(s.headline).toBe('This photo carries only technical metadata: 3 fields');
  });

  it('device details: amber, naming them', () => {
    const s = summarizeMetadata(fileWith([[0x010f, ascii('Apple')], [0x0110, ascii('iPhone 15')], [0x0112, short(1)]]));
    expect(s.severity).toBe('amber');
    expect(s.headline).toBe('This photo carries 3 metadata fields, including Make and Model');
  });

  it('a blank comment or description is not personal text', () => {
    const blank = [...'ASCII\0\0\0'].map((c) => c.charCodeAt(0)).concat([32, 32, 32, 32]);
    const m = fileWith([[0x9286, undef(blank)], [0x010e, ascii('   ')]]);
    expect(m.fields.every((f) => f.privacy === 'low' && f.value === '(empty)')).toBe(true);
    expect(summarizeMetadata(m).severity).toBe('green');
  });

  it('a serial number without GPS is red, and the headline names the field', () => {
    const s = summarizeMetadata(fileWith([[0x010f, ascii('Sony')], [0xa431, ascii('5012345')]]));
    expect(s.severity).toBe('red');
    expect(s.headline).toBe('This photo carries 1 identifying field: Body Serial Number');
    expect(scorecardFigure('metadata-viewer', s)).toBe('2 metadata fields');
  });

  it('a 0,0 GPS placeholder is not a location', () => {
    const m = readImageMetadata(jpegWithExif(tiff([
      { name: 'ifd0', entries: [[0x8825, ptr('gps')]] },
      { name: 'gps', entries: [[0x0002, rational([0, 1], [0, 1], [0, 1])], [0x0004, rational([0, 1], [0, 1], [0, 1])]] },
    ])));
    expect(m.gps).toBeNull();
    expect(field(m, 'GPS Coordinates')).toMatchObject({ privacy: 'low' });
  });

  it('nothing at all: green, and the headline names what was looked for', () => {
    const s = summarizeMetadata(readImageMetadata(jpeg()));
    expect(s.severity).toBe('green');
    expect(s.headline).toBe('No Exif, XMP, IPTC or text metadata found in this file');
  });
});

describe('the copy says what the viewer reads', () => {
  const ROOT = path.join(__dirname, '..');
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

  it('the tool\'s own line names the four formats, the five directories, XMP/IPTC, and HEIC as not read', () => {
    for (const s of ['JPEG, PNG, WebP and TIFF', 'IFD0', 'Exif, GPS and Interop', 'IFD1', 'the common XMP and IPTC fields', 'Maker notes are listed by size, not decoded', 'HEIC and AVIF photos are recognised but not read']) {
      expect(METADATA_VIEWER_READS).toContain(s);
    }
    expect(read('components/tools/MetadataViewerTool.tsx')).not.toMatch(/Supports JPEG \(full EXIF \+ GPS\)|metadata inspection is limited/);
  });

  it('no page promises "every EXIF tag" or JPEG-only reading any more', () => {
    expect(read('app/tools/page.tsx')).not.toMatch(/every EXIF tag/i);
    for (const f of ['dating-privacy/image-metadata-checker', 'drone-surveillance/image-metadata-checker', 'facial-recognition/image-metadata-stripper']) {
      const j = JSON.parse(read(`data/tools/${f}.json`));
      expect(j.educational.howItWorks, f).toMatch(/JPEG, PNG, WebP and TIFF/);
      expect(j.educational.howItWorks, f).toMatch(/HEIC and AVIF photos are recognised but not read/);
      expect(j.educational.howItWorks, f).not.toMatch(/reads EXIF metadata from JPEG images/);
      // Converting formats is not a way to strip metadata: many converters copy it across.
      expect(j.educational.tips.join(' '), f).not.toMatch(/image conversion/i);
    }
  });

  it('the red CTA line holds for every red result, not only GPS', () => {
    expect(ENGINE_COPY['metadata-viewer'].red.headline).toBe('This photo carries location or identifying data.');
    expect(ENGINE_COPY['metadata-viewer'].red.headline).not.toMatch(/where it was taken/);
    expect(ENGINE_COPY['metadata-viewer'].info.headline).toMatch(/JPEG/);
  });
});

// ───────────────────────────── XMP: hostile packets, and people and places ─────────────────────────────

const XMP_HEADER = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF>';
const XMP_FOOTER = '</rdf:RDF></x:xmpmeta>';
const xmpPacket = (body: string) => `${XMP_HEADER}${body}${XMP_FOOTER}`;
const jpegXmp = (xmp: string) => jpeg(jpegSegment(0xe1, cat(str(XMP_SIG), str(xmp))));
const webpXmp = (xmp: string) => webp(riffChunk('XMP ', str(xmp)));
const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * A packet whose only content is `n` bare '<'. The tag strip has to walk it,
 * and a strip written as /<[^>]*>/ walks to the end of the string for every
 * one of them: 60,000 of these took 5.4 s, 200 KB took about a minute, on the
 * main thread, with eight such blocks allowed per file.
 */
const hostileAttr = (n: number) => xmpPacket(`<rdf:Description dc:creator="${'<'.repeat(n)}" xmp:Rating="3"/>`);
const hostileElement = (n: number) => xmpPacket(`<rdf:Description><dc:title>${'<'.repeat(n)}</dc:title></rdf:Description>`);

describe('a hostile XMP packet cannot stall the page', () => {
  const KB200 = 200 * 1024;

  it('200 KB of bare "<" in an attribute is read in under 100 ms', () => {
    const t0 = performance.now();
    const m = readImageMetadata(webpXmp(hostileAttr(KB200)));
    const ms = performance.now() - t0;
    expect(m.blocks.map((b) => b.kind)).toContain('XMP');
    expect(field(m, 'Rating')?.value).toBe('3');
    expect(ms).toBeLessThan(100);
  });

  it('200 KB of bare "<" in an element is read in under 100 ms', () => {
    const t0 = performance.now();
    const m = readImageMetadata(webpXmp(hostileElement(KB200)));
    expect(performance.now() - t0).toBeLessThan(100);
    expect(m.blocks.map((b) => b.kind)).toContain('XMP');
  });

  it('eight XMP blocks at the 512 KB cap — the most one file can spend — stay well inside a second', () => {
    const packet = hostileAttr(LIMITS.xmpChars - 200);
    const chunks = Array.from({ length: LIMITS.perFile.xmp + 4 }, () => riffChunk('XMP ', str(packet)));
    const t0 = performance.now();
    const m = readImageMetadata(webp(...chunks));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(m.notes).toContain(`Only the first ${LIMITS.perFile.xmp} XMP blocks in this file were read.`);
  });

  it('a real value keeps its text when the markup inside it is stripped', () => {
    const m = readImageMetadata(webpXmp(xmpPacket('<rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Our flat</rdf:li></rdf:Alt></dc:title></rdf:Description>')));
    expect(field(m, 'Title')?.value).toBe('Our flat');
  });
});

describe('people and places written in XMP are read', () => {
  it('a face region name (mwg-rs:Name) is a person\'s name, and the verdict is red', () => {
    const m = readImageMetadata(jpegXmp(xmpPacket(
      '<rdf:Description><mwg-rs:Regions><mwg-rs:RegionList><rdf:Bag><rdf:li>' +
      '<rdf:Description mwg-rs:Type="Face" mwg-rs:Name="Jane Doe"/></rdf:li></rdf:Bag></mwg-rs:RegionList></mwg-rs:Regions></rdf:Description>',
    )));
    expect(field(m, 'Face Region Name')).toMatchObject({ value: 'Jane Doe', privacy: 'high', group: 'XMP' });
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('red');
    expect(s.headline).toBe('This photo carries 1 identifying field: Face Region Name');
    expect(m.undecoded).toEqual([]);
  });

  it('IPTC Extension street-level location and the people shown are read', () => {
    const m = readImageMetadata(jpegXmp(xmpPacket(
      '<rdf:Description><Iptc4xmpExt:LocationCreated><rdf:Description Iptc4xmpExt:City="London" Iptc4xmpExt:Sublocation="12 Elm Street" Iptc4xmpExt:CountryName="United Kingdom"/></Iptc4xmpExt:LocationCreated>' +
      '<Iptc4xmpExt:PersonInImage><rdf:Bag><rdf:li>John Smith</rdf:li></rdf:Bag></Iptc4xmpExt:PersonInImage></rdf:Description>',
    )));
    expect(field(m, 'City')).toMatchObject({ value: 'London', privacy: 'high' });
    expect(field(m, 'Sub-location')).toMatchObject({ value: '12 Elm Street', privacy: 'high' });
    expect(field(m, 'Person Shown')).toMatchObject({ value: 'John Smith', privacy: 'high' });
    expect(field(m, 'Country')).toMatchObject({ value: 'United Kingdom', privacy: 'medium' });
    expect(summarizeMetadata(m).severity).toBe('red');
  });

  it('a Windows people tag (MPReg:PersonDisplayName) is read', () => {
    const m = readImageMetadata(jpegXmp(xmpPacket(
      '<rdf:Description><MPRI:Regions><rdf:Bag><rdf:li><rdf:Description MPReg:PersonDisplayName="Alice Brown" MPReg:Rectangle="0.1,0.1,0.2,0.2"/></rdf:li></rdf:Bag></MPRI:Regions></rdf:Description>',
    )));
    expect(field(m, 'Tagged Person')).toMatchObject({ value: 'Alice Brown', privacy: 'high' });
    expect(summarizeMetadata(m).severity).toBe('red');
  });

  it('GPS altitude and the digitised date are read as medium', () => {
    const m = readImageMetadata(jpegXmp(xmpPacket('<rdf:Description exif:GPSAltitude="63/1" exif:DateTimeDigitized="2026-05-01T18:22:07"/>')));
    expect(field(m, 'GPS Altitude')?.privacy).toBe('medium');
    expect(field(m, 'Date/Time Digitized')?.privacy).toBe('medium');
    expect(summarizeMetadata(m).severity).toBe('amber');
  });
});

// ───────────────────────────── found and not decoded is never "nothing found" ─────────────────────────────

/** APP2 "MPF" saying the file holds a second image. Presence only, by design. */
const mpfJpeg = () => {
  const t = cat(str('II'), [42, 0], le32(8), [1, 0], [0x01, 0xb0], [4, 0], le32(1), le32(2));
  return jpeg(jpegSegment(0xe2, cat(str('MPF\0'), t)));
};

describe('a block that was found and not decoded is never reported as no metadata', () => {
  const noneDecoded = xmpPacket('<rdf:Description tiff:ImageWidth="4000" tiff:ImageLength="3000"/>');

  it('an XMP block holding no field this viewer decodes: amber, and it says so', () => {
    const m = readImageMetadata(jpegXmp(noneDecoded));
    expect(m.fields).toHaveLength(0);
    expect(m.blocks.map((b) => b.kind)).toContain('XMP');
    expect(m.undecoded).toEqual(['an XMP block this viewer does not decode']);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('amber');
    expect(s.headline).toBe('This file holds an XMP block this viewer does not decode');
    expect(s.headline).not.toMatch(/No Exif, XMP, IPTC or text metadata found/);
    // Nothing was decoded, so there is no field count to put on a share card.
    expect(s.stats.map((x) => x.label)).not.toContain('Fields');
    expect(scorecardFigure('metadata-viewer', s)).toBe('');
  });

  it('extra images beside the main picture (MPF): amber, named', () => {
    const m = readImageMetadata(mpfJpeg());
    expect(m.blocks.map((b) => b.kind)).toContain('Multi-Picture images');
    expect(m.fields).toHaveLength(0);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('amber');
    expect(s.headline).toBe('This file holds extra images stored beside the main picture, whose own metadata is not read');
    expect(scorecardFigure('metadata-viewer', s)).toBe('');
  });

  it('JPEG APP segments this viewer does not decode: amber, and they are named', () => {
    const m = readImageMetadata(jpeg(jpegSegment(0xe4, str('anything')), jpegSegment(0xe1, str('not Exif, not XMP'))));
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('amber');
    // Named in the order they were met, which is the order they sit in the file.
    expect(s.headline).toBe('This file holds JPEG segments this viewer does not decode (APP4, APP1)');
  });

  it('an IPTC block with no record 2 dataset: amber, not "nothing found"', () => {
    const iptc = cat([0x1c, 3, 60], be16(4), str('xxxx'));
    const irb = cat(str('8BIM'), be16(0x0404), [0, 0], be32(iptc.length), iptc);
    const m = readImageMetadata(jpeg(jpegSegment(0xed, cat(str('Photoshop 3.0\0'), irb))));
    expect(m.blocks.map((b) => b.kind)).toContain('IPTC');
    expect(m.fields).toHaveLength(0);
    expect(summarizeMetadata(m).severity).toBe('amber');
  });

  it('technical fields next to an undecoded block: amber, counting both', () => {
    const t = tiff([{ name: 'ifd0', entries: [[0x0112, short(1)], [0x011a, rational([72, 1])]] }]);
    const m = readImageMetadata(jpeg(jpegSegment(0xe1, cat(str('Exif\0\0'), t)), jpegSegment(0xe1, cat(str(XMP_SIG), str(noneDecoded)))));
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('amber');
    expect(s.headline).toBe('This photo carries 2 technical fields, and this file holds an XMP block this viewer does not decode');
    // Fields were decoded here, so the share card keeps its count.
    expect(scorecardFigure('metadata-viewer', s)).toBe('2 metadata fields');
  });

  it('reading that stopped at the segment cap says so, and is not green', () => {
    const filler = Array.from({ length: LIMITS.segments + 100 }, () => jpegSegment(0xe0, str('x')));
    const m = readImageMetadata(jpeg(...filler, jpegSegment(0xe1, cat(str('Exif\0\0'), cameraExif()))));
    expect(m.fields).toHaveLength(0);
    expect(m.notes.join(' ')).toMatch(/Reading stopped after 4,000 JPEG segments/);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('amber');
    expect(s.headline).toBe('This file holds more segments than this viewer reads (it stopped after 4,000)');
  });

  it('a file holding only an ICC profile: still green, but the sentence is scoped to what was read', () => {
    const m = readImageMetadata(jpeg(jpegSegment(0xe2, cat(str('ICC_PROFILE\0'), new Uint8Array(200)))));
    expect(m.blocks.map((b) => b.kind)).toEqual(['ICC profile']);
    expect(m.undecoded).toEqual([]);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('green');
    expect(s.headline).toBe('No location, device or time data in the fields this viewer reads');
  });

  it('the green CTA claims only what the viewer reads', () => {
    const green = ENGINE_COPY['metadata-viewer'].green;
    expect(green.headline).toBe('No location, device or time data in the fields this viewer reads.');
    expect(green.headline).not.toMatch(/in this file/);
  });
});

// ───────────────────────────── every Exif block, and every stop ─────────────────────────────

/** IFD0 with two technical tags and nothing else: green on its own. */
const technicalExif = () => tiff([{ name: 'ifd0', entries: [[0x0112, short(1)], [0x0128, short(2)]] }]);
/** A second block a camera can write: 51.5 N, 0.125 W and nothing else. */
const gpsOnlyExif = () =>
  tiff([
    { name: 'ifd0', entries: [[0x8825, ptr('gps')]] },
    {
      name: 'gps',
      entries: [
        [0x0001, ascii('N')],
        [0x0002, rational([51, 1], [30, 1], [0, 1])],
        [0x0003, ascii('W')],
        [0x0004, rational([0, 1], [7, 1], [30, 1])],
      ],
    },
  ]);
const exifSegment = (t: Uint8Array) => jpegSegment(0xe1, cat(str('Exif\0\0'), t));
/** II, magic 43: a real BigTIFF header, which this viewer does not walk. */
const bigTiffHeader = () => cat(str('II'), [0x2b, 0], [8, 0], [0, 0], le32(16), le32(0), new Uint8Array(16));

describe('a second Exif block is read, not dropped', () => {
  it('a benign first APP1 and a GPS second APP1: red, with the position', () => {
    const first = readImageMetadata(jpeg(exifSegment(technicalExif())));
    expect(summarizeMetadata(first).severity).toBe('green');

    const m = readImageMetadata(jpeg(exifSegment(technicalExif()), exifSegment(gpsOnlyExif())));
    expect(m.gps?.latitude).toBeCloseTo(51.5, 5);
    expect(m.gps?.longitude).toBeCloseTo(-0.125, 5);
    expect(field(m, 'GPS Coordinates')?.privacy).toBe('high');
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('red');
    expect(s.headline).toBe('This photo carries the GPS location where it was taken');
    // The old reading stopped at the first block and only left a grey note.
    expect(m.notes).not.toContain('A second Exif segment was found and not read.');
  });

  it('a high-risk field in the second APP1 is read too', () => {
    const m = readImageMetadata(jpeg(exifSegment(technicalExif()), exifSegment(tiff([{ name: 'ifd0', entries: [[0x013b, ascii('Jane Doe')]] }]))));
    expect(field(m, 'Artist')).toMatchObject({ value: 'Jane Doe', privacy: 'high' });
    expect(summarizeMetadata(m).severity).toBe('red');
  });

  it('past the per-file cap the file is marked as not fully read', () => {
    const m = readImageMetadata(jpeg(...Array.from({ length: LIMITS.perFile.exif + 3 }, () => exifSegment(technicalExif()))));
    expect(rows(m, 'Orientation')).toHaveLength(LIMITS.perFile.exif);
    expect(m.notes).toContain(`Only the first ${LIMITS.perFile.exif} Exif blocks in this file were read.`);
    expect(m.undecoded).toContain(`more Exif blocks than this viewer reads (it stopped at ${LIMITS.perFile.exif})`);
    expect(summarizeMetadata(m).severity).toBe('amber');
  });
});

describe('a read that stopped early never comes out green', () => {
  /** Every file here hides something after the point the read stops. */
  const stops: Array<[string, () => Uint8Array, string]> = [
    [
      'a JPEG structure that breaks off',
      () => cat([0xff, 0xd8], exifSegment(technicalExif()), [0x00, 0x00], exifSegment(gpsOnlyExif()), [0xff, 0xd9]),
      'a break in its JPEG structure, with the segments after it unread',
    ],
    [
      'a JPEG segment that runs past the end',
      () => cat([0xff, 0xd8], exifSegment(technicalExif()), [0xff, 0xe1, 0xff, 0xfe], str('truncated')),
      'a JPEG segment that runs past the end of the file, with the segments after it unread',
    ],
    [
      'a PNG chunk that runs past the end',
      () =>
        cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pngChunk('IHDR', new Uint8Array(13)), pngChunk('eXIf', technicalExif()), be32(4000), str('tEXt'), str('cut off here')),
      'a PNG chunk that runs past the end of the file, with the chunks after it unread',
    ],
    [
      'a WebP chunk that runs past the end',
      () => cat(str('RIFF'), le32(64), str('WEBP'), riffChunk('VP8X', new Uint8Array(10)), riffChunk('EXIF', technicalExif()), str('XMP '), le32(99999), str('cut')),
      'a WebP chunk that runs past the end of the file, with the chunks after it unread',
    ],
    [
      'an Exif block pointing to a third directory',
      () =>
        jpeg(
          exifSegment(
            tiff([
              { name: 'ifd0', entries: [[0x0112, short(1)]], next: 'ifd1' },
              { name: 'ifd1', entries: [[0x0128, short(2)]], next: 'ifd2' },
              { name: 'ifd2', entries: [[0x013b, ascii('Jane Doe')]] },
            ]),
          ),
        ),
      'an Exif block pointing to a third directory, which was not read',
    ],
    [
      'a directory that runs past the end of its block',
      () => jpeg(exifSegment(cat([0x49, 0x49, 42, 0], le32(8), [0xff, 0xff], new Array(12 * 2).fill(0)))),
      'an Exif directory that runs past the end of its block, with the entries after it unread',
    ],
    [
      'a directory listing more entries than the cap',
      () => tiff([{ name: 'ifd0', entries: Array.from({ length: LIMITS.entriesPerIfd + 200 }, (_, i) => [0x9000 + i, short(i)] as [number, Value]) }]),
      `more entries in one directory than this viewer reads (it stopped at ${LIMITS.entriesPerIfd})`,
    ],
    [
      'a chain of directories past the cap',
      () =>
        tiff(
          Array.from({ length: LIMITS.ifdsPerBlock + 8 }, (_, i) => ({
            name: `d${i}`,
            entries: (i === LIMITS.ifdsPerBlock + 7 ? [[0x013b, ascii('Jane Doe')]] : [[0x0112, short(1)]]) as Array<[number, Value]>,
            next: i === LIMITS.ifdsPerBlock + 7 ? undefined : `d${i + 1}`,
          })),
        ),
      `more directories in one Exif block than this viewer reads (it stopped at ${LIMITS.ifdsPerBlock})`,
    ],
    [
      'a GIF structure that breaks off',
      () => cat(str('GIF89a'), [1, 0, 1, 0, 0, 0, 0], [0x21, 0xfe, 5], str('hello'), [0], [0x55, 0x55]),
      'a break in its GIF structure, with the blocks after it unread',
    ],
    [
      'a BigTIFF Exif block inside a JPEG',
      () => jpeg(exifSegment(bigTiffHeader())),
      'an Exif block this viewer could not read',
    ],
  ];

  for (const [name, build, phrase] of stops) {
    it(`${name}: amber, and the verdict names it`, () => {
      const m = readImageMetadata(build());
      expect(m.undecoded, name).toContain(phrase);
      const s = summarizeMetadata(m);
      expect(s.severity, name).toBe('amber');
      expect(s.headline, name).not.toMatch(/only technical metadata|No Exif, XMP, IPTC or text metadata found|No location, device or time data/);
    });
  }

  it('what sits after the stop really is unread, so the amber is load-bearing', () => {
    // The GPS is in the segment after the break; the third directory holds a name.
    const broken = readImageMetadata(cat([0xff, 0xd8], exifSegment(technicalExif()), [0x00, 0x00], exifSegment(gpsOnlyExif()), [0xff, 0xd9]));
    expect(broken.gps).toBeNull();
    expect(summarizeMetadata(broken).headline).toBe('This photo carries 2 technical fields, and this file holds a break in its JPEG structure, with the segments after it unread');

    const third = readImageMetadata(jpeg(exifSegment(tiff([
      { name: 'ifd0', entries: [[0x0112, short(1)]], next: 'ifd1' },
      { name: 'ifd1', entries: [[0x0128, short(2)]], next: 'ifd2' },
      { name: 'ifd2', entries: [[0x013b, ascii('Jane Doe')]] },
    ]))));
    expect(field(third, 'Artist')).toBeUndefined();

    const chained = readImageMetadata(tiff(Array.from({ length: LIMITS.ifdsPerBlock + 8 }, (_, i) => ({
      name: `d${i}`,
      entries: (i === LIMITS.ifdsPerBlock + 7 ? [[0x013b, ascii('Jane Doe')]] : [[0x0112, short(1)]]) as Array<[number, Value]>,
      next: i === LIMITS.ifdsPerBlock + 7 ? undefined : `d${i + 1}`,
    }))));
    expect(field(chained, 'Artist')).toBeUndefined();
  });

  it('a BigTIFF file takes the "not read here" branch, like HEIC and AVIF', () => {
    const m = readImageMetadata(bigTiffHeader());
    expect(m.format).toBe('tiff');
    expect(m.unread).toBe(true);
    expect(m.fields).toHaveLength(0);
    expect(m.notes.join(' ')).toMatch(/BigTIFF files are not read here/);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('info');
    expect(s.headline).toBe('TIFF image: the format is recognised, but its metadata is not read here');
    expect(s.headline).not.toMatch(/No Exif, XMP, IPTC or text metadata found/);
    expect(scorecardFigure('metadata-viewer', s)).toBe('');
  });

  it('a TIFF too short to hold a header is "not read here" too, not "nothing found"', () => {
    const m = readImageMetadata(cat(str('II'), [42, 0], [0, 0]));
    expect(m.format).toBe('tiff');
    expect(m.unread).toBe(true);
    expect(summarizeMetadata(m).severity).toBe('info');
  });
});

describe('the published Scoring copy matches summarizeMetadata', () => {
  const ROOT = path.join(__dirname, '..');
  const registry = fs.readFileSync(path.join(ROOT, 'components/tools/registry.tsx'), 'utf-8');
  const entry = registry.slice(registry.indexOf("  'metadata-viewer': {"), registry.indexOf("  'useragent-analyzer': {"));
  const scoring = /scoring: "(.+?)",\n/.exec(entry)?.[1] ?? '';
  const io = /io: \[(.+?)\],\n/.exec(entry)?.[1] ?? '';
  const verdict = (file: Uint8Array) => summarizeMetadata(readImageMetadata(file)).severity;
  const exifWith = (entries: Array<[number, Value]>) => jpeg(exifSegment(tiff([{ name: 'ifd0', entries }])));
  const xmpWith = (attrs: string) => jpegXmp(xmpPacket(`<rdf:Description ${attrs}/>`));

  it('the three pages that render this copy are metadata-viewer pages', () => {
    for (const f of ['dating-privacy/image-metadata-checker', 'drone-surveillance/image-metadata-checker', 'facial-recognition/image-metadata-stripper']) {
      expect(JSON.parse(fs.readFileSync(path.join(ROOT, `data/tools/${f}.json`), 'utf-8')).toolEngine, f).toBe('metadata-viewer');
    }
    expect(scoring.length).toBeGreaterThan(80);
  });

  it('every colour the copy claims is the colour the tool gives', () => {
    const claims: Array<[string, Uint8Array, 'red' | 'amber' | 'green' | 'info']> = [
      ['GPS coordinates', jpeg(exifSegment(gpsOnlyExif())), 'red'],
      ["a person's name or contact details", exifWith([[0x013b, ascii('Jane Doe')]]), 'red'],
      ['a city or street-level place', xmpWith('photoshop:City="Brighton"'), 'red'],
      ['a serial number or unique ID', exifWith([[0xa431, ascii('012345678901')]]), 'red'],
      ['device, time, software or free-text details', exifWith([[0x010f, ascii('Apple')], [0x0132, ascii('2026:05:01 18:22:07')], [0x0131, ascii('Photos 1.0')]]), 'amber'],
      ['a province, country or copyright line', xmpWith('photoshop:State="Kent" photoshop:Country="United Kingdom"'), 'amber'],
      ['an embedded thumbnail', jpeg(exifSegment(tiff([
        { name: 'ifd0', entries: [[0x0112, short(1)]], next: 'ifd1' },
        { name: 'ifd1', entries: [[0x0103, short(6)], [0x0201, ptr('thumb')], [0x0202, long(TINY_JPEG.length)]] },
      ], { thumb: TINY_JPEG }))), 'amber'],
      ['a block it found and could not read', jpegXmp(xmpPacket('<rdf:Description tiff:ImageWidth="4000"/>')), 'amber'],
      ['a read that a cap or a broken file cut short', cat([0xff, 0xd8], exifSegment(technicalExif()), [0xff, 0xe1, 0xff, 0xfe], str('truncated')), 'amber'],
      ['every field it read is technical', jpeg(exifSegment(technicalExif())), 'green'],
      ['HEIC, AVIF and BigTIFF files are recognised but not read', bigTiffHeader(), 'info'],
    ];
    for (const [claim, file, severity] of claims) {
      expect(scoring, claim).toContain(claim);
      expect(verdict(file), claim).toBe(severity);
    }
    for (const heic of [cat(be32(24), str('ftypheic'), be32(0), str('mif1heic')), cat(be32(24), str('ftypavif'), be32(0), str('mif1avif'))]) {
      expect(verdict(heic)).toBe('info');
    }
  });

  it('the sentences this round made false are gone', () => {
    // Green was "only technical fields or none": a file with an undecoded
    // block and no fields is amber now, so that sentence no longer holds.
    expect(scoring).not.toMatch(/only technical fields or none/);
    // Red was "a place name", but a province or a country is amber.
    expect(scoring).not.toMatch(/red when[^.]*a place name/);
    expect(verdict(xmpWith('photoshop:Country="United Kingdom"'))).not.toBe('red');
    // io claimed whole XMP and IPTC blocks were read; only the common fields are.
    expect(io).toContain('the common XMP and IPTC fields');
    expect(io).not.toMatch(/IFD1\), XMP, IPTC/);
    expect(METADATA_VIEWER_READS).toContain('the common XMP and IPTC fields');
  });

  it('the tool\'s own line says it reads every Exif block and flags a read that stopped', () => {
    expect(METADATA_VIEWER_READS).toMatch(/every Exif block the file holds/);
    expect(METADATA_VIEWER_READS).toMatch(/or a read stops early/);
    for (const f of ['dating-privacy/image-metadata-checker', 'drone-surveillance/image-metadata-checker', 'facial-recognition/image-metadata-stripper']) {
      const how = JSON.parse(fs.readFileSync(path.join(ROOT, `data/tools/${f}.json`), 'utf-8')).educational.howItWorks;
      expect(how, f).toMatch(/says so instead of reporting the photo as clean/);
    }
  });
});

describe('a PNG chunk this viewer does not decode is listed, like a JPEG APPn segment', () => {
  it('a private chunk beside an ordinary one: amber, and the chunk is named', () => {
    // prVW is Fireworks\' preview image: a whole second picture, undecoded here.
    const m = readImageMetadata(png(pngChunk('pHYs', new Uint8Array(9)), pngChunk('prVW', str('a preview image')), pngChunk('mkBF', str('x'))));
    expect(m.notes.join(' ')).toMatch(/Other PNG chunks were found but not decoded: prVW, mkBF\./);
    expect(m.undecoded).toContain('PNG chunks this viewer does not decode (prVW, mkBF)');
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('amber');
    expect(s.headline).toBe('This file holds PNG chunks this viewer does not decode (prVW, mkBF)');
  });

  it('an ordinary PNG is still green: pixels, colour and timing chunks are not "undecoded"', () => {
    const ordinary = png(
      pngChunk('gAMA', new Uint8Array(4)),
      pngChunk('cHRM', new Uint8Array(32)),
      pngChunk('sRGB', new Uint8Array(1)),
      pngChunk('pHYs', new Uint8Array(9)),
      pngChunk('tRNS', new Uint8Array(6)),
      pngChunk('bKGD', new Uint8Array(6)),
      pngChunk('IDAT', new Uint8Array(16)),
      pngChunk('acTL', new Uint8Array(8)),
    );
    const m = readImageMetadata(ordinary);
    expect(m.undecoded).toEqual([]);
    const s = summarizeMetadata(m);
    expect(s.severity).toBe('green');
    expect(s.headline).toBe('No Exif, XMP, IPTC or text metadata found in this file');
  });
});
