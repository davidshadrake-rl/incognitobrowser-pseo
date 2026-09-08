/**
 * lib/screenshot-leak — container walkers + PII scan + verdict.
 *
 * Every fixture is built in-memory: a PNG with tEXt / iTXt / zTXt / tIME
 * chunks, a JPEG with APP1 Exif (IFD0, Exif IFD, GPS IFD, IFD1 thumbnail),
 * an APP1 XMP packet, an APP13 IPTC block and a COM segment, and a WebP with
 * an EXIF chunk. CRCs are zero — the parser must honour chunk lengths, not
 * checksums.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  analyzeImage,
  assess,
  detectFormat,
  extractRaw,
  ibanValid,
  luhnValid,
  parseXmpPacket,
  resolveCompressedText,
  scanPii,
} from '../lib/screenshot-leak';

// ───────────────────────── byte helpers ─────────────────────────

const str = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const nulStr = (s: string): Uint8Array => concat(str(s), new Uint8Array([0]));
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function le32(n: number): Uint8Array {
  return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
}

// ───────────────────────── PNG builder ─────────────────────────

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return concat(be32(data.length), str(type), data, new Uint8Array(4)); // CRC left as zeros
}
const IHDR = pngChunk('IHDR', concat(be32(640), be32(480), new Uint8Array([8, 6, 0, 0, 0])));
const IEND = pngChunk('IEND', new Uint8Array(0));
function tEXt(key: string, value: string): Uint8Array {
  return pngChunk('tEXt', concat(nulStr(key), str(value)));
}
function iTXt(key: string, text: string, compressed = false, payload?: Uint8Array): Uint8Array {
  return pngChunk('iTXt', concat(nulStr(key), new Uint8Array([compressed ? 1 : 0, 0]), nulStr(''), nulStr(''), payload ?? utf8(text)));
}
function zTXt(key: string, text: string): Uint8Array {
  return pngChunk('zTXt', concat(nulStr(key), new Uint8Array([0]), new Uint8Array(deflateSync(Buffer.from(text, 'utf8')))));
}
function tIME(y: number, mo: number, d: number, h: number, mi: number, s: number): Uint8Array {
  return pngChunk('tIME', new Uint8Array([y >> 8, y & 255, mo, d, h, mi, s]));
}

// ───────────────────────── TIFF / JPEG builder ─────────────────────────

type Entry =
  | { tag: number; type: number; count: number; bytes: Uint8Array }
  | { tag: number; type: 4; ifd: string }
  | { tag: number; type: 4; blob: string }
  | { tag: number; type: 4; blobLength: string };
interface IfdSpec { name: string; entries: Entry[]; next?: string }

const asciiEntry = (tag: number, s: string): Entry => ({ tag, type: 2, count: s.length + 1, bytes: nulStr(s) });
const byteEntry = (tag: number, n: number): Entry => ({ tag, type: 1, count: 1, bytes: new Uint8Array([n]) });
const undefinedEntry = (tag: number, b: Uint8Array): Entry => ({ tag, type: 7, count: b.length, bytes: b });
function rationalEntry(tag: number, vals: Array<[number, number]>): Entry {
  return { tag, type: 5, count: vals.length, bytes: concat(...vals.flatMap(([n, d]) => [le32(n), le32(d)])) };
}

/** Little-endian TIFF: header, IFDs back to back, then a data area for long values and named blobs. */
function buildTiff(ifds: IfdSpec[], blobs: Record<string, Uint8Array> = {}): Uint8Array {
  const ifdOffsets: Record<string, number> = {};
  let pos = 8;
  for (const ifd of ifds) {
    ifdOffsets[ifd.name] = pos;
    pos += 2 + ifd.entries.length * 12 + 4;
  }
  const dataOffsets = new Map<Entry, number>();
  for (const ifd of ifds) {
    for (const e of ifd.entries) {
      if ('bytes' in e && e.bytes.length > 4) {
        dataOffsets.set(e, pos);
        pos += e.bytes.length + (e.bytes.length & 1);
      }
    }
  }
  const blobOffsets: Record<string, number> = {};
  for (const [name, b] of Object.entries(blobs)) {
    blobOffsets[name] = pos;
    pos += b.length + (b.length & 1);
  }
  const out = new Uint8Array(pos);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOffsets[ifds[0].name], true);
  for (const ifd of ifds) {
    let p = ifdOffsets[ifd.name];
    dv.setUint16(p, ifd.entries.length, true);
    p += 2;
    for (const e of ifd.entries) {
      dv.setUint16(p, e.tag, true);
      dv.setUint16(p + 2, e.type, true);
      if ('bytes' in e) {
        dv.setUint32(p + 4, e.count, true);
        if (e.bytes.length > 4) dv.setUint32(p + 8, dataOffsets.get(e)!, true);
        else out.set(e.bytes, p + 8);
      } else {
        dv.setUint32(p + 4, 1, true);
        const v = 'ifd' in e ? ifdOffsets[e.ifd] : 'blob' in e ? blobOffsets[e.blob] : blobs[e.blobLength].length;
        dv.setUint32(p + 8, v, true);
      }
      p += 12;
    }
    dv.setUint32(p, ifd.next ? ifdOffsets[ifd.next] : 0, true);
  }
  for (const [e, off] of dataOffsets) out.set((e as { bytes: Uint8Array }).bytes, off);
  for (const [name, b] of Object.entries(blobs)) out.set(b, blobOffsets[name]);
  return out;
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  return concat(new Uint8Array([0xff, marker, len >> 8, len & 255]), payload);
}
const SOI = new Uint8Array([0xff, 0xd8]);
const EOI = new Uint8Array([0xff, 0xd9]);
const SOS = jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0]));

// A tiny "JPEG" thumbnail: SOI, a COM segment, EOI.
const THUMB = concat(SOI, jpegSegment(0xfe, str('thumb')), EOI);

function buildExifTiff(): Uint8Array {
  return buildTiff(
    [
      {
        name: 'ifd0',
        entries: [
          asciiEntry(0x010f, 'Apple'),
          asciiEntry(0x0110, 'iPhone 15 Pro'),
          asciiEntry(0x0131, 'Screenshot'),
          asciiEntry(0x0132, '2024:01:15 10:22:33'),
          asciiEntry(0x013b, 'Jane Doe'),
          { tag: 0x8769, type: 4, ifd: 'exif' },
          { tag: 0x8825, type: 4, ifd: 'gps' },
        ],
        next: 'ifd1',
      },
      {
        name: 'exif',
        entries: [
          asciiEntry(0x9003, '2024:01:15 10:20:00'),
          undefinedEntry(0x9286, concat(str('ASCII\0\0\0'), str('call me on +44 7700 900123'))),
          asciiEntry(0xa431, 'SN-ABC123456'),
        ],
      },
      {
        name: 'gps',
        entries: [
          asciiEntry(0x0001, 'N'),
          rationalEntry(0x0002, [[51, 1], [30, 1], [26, 10]]),
          asciiEntry(0x0003, 'W'),
          rationalEntry(0x0004, [[0, 1], [7, 1], [287, 10]]),
          byteEntry(0x0005, 0),
          rationalEntry(0x0006, [[355, 10]]),
        ],
      },
      {
        name: 'ifd1',
        entries: [
          { tag: 0x0201, type: 4, blob: 'thumb' },
          { tag: 0x0202, type: 4, blobLength: 'thumb' },
        ],
      },
    ],
    { thumb: THUMB },
  );
}

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
 <rdf:Description xmp:CreatorTool="Adobe Photoshop 25.0 (Macintosh)" xmp:CreateDate="2024-01-15T10:22:33Z"
   xmpMM:DocumentID="xmp.did:0123456789ABCDEF0123456789ABCDEF" exif:GPSLatitude="51,30.0437N" exif:GPSLongitude="0,7.4783W">
  <dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator>
  <xmpMM:History><rdf:Seq>
   <rdf:li stEvt:action="created" stEvt:softwareAgent="Adobe Photoshop 25.0 (Macintosh)" stEvt:when="2024-01-15T10:22:33Z"/>
   <rdf:li stEvt:action="saved" stEvt:softwareAgent="Adobe Photoshop 25.0 (Macintosh)" stEvt:when="2024-01-16T08:00:00Z"/>
  </rdf:Seq></xmpMM:History>
 </rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

function iptcDataset(ds: number, value: string): Uint8Array {
  const v = utf8(value);
  return concat(new Uint8Array([0x1c, 2, ds, v.length >> 8, v.length & 255]), v);
}
function app13(iptc: Uint8Array): Uint8Array {
  const padded = iptc.length & 1 ? concat(iptc, new Uint8Array([0])) : iptc;
  // "Photoshop 3.0\0" + 8BIM + id 0x0404 + empty pascal name (padded to 2 bytes) + size + data
  return concat(str('Photoshop 3.0\0'), str('8BIM'), new Uint8Array([0x04, 0x04, 0, 0]), be32(iptc.length), padded);
}

function buildJpeg(): Uint8Array {
  return concat(
    SOI,
    jpegSegment(0xe1, concat(str('Exif\0\0'), buildExifTiff())),
    jpegSegment(0xe1, concat(str('http://ns.adobe.com/xap/1.0/\0'), utf8(XMP))),
    jpegSegment(0xed, app13(concat(iptcDataset(120, 'Team offsite at 10 Downing St'), iptcDataset(80, 'J. Doe'), iptcDataset(90, 'London')))),
    jpegSegment(0xfe, str('Contact: jane@example.com')),
    SOS,
    new Uint8Array([0x12, 0x34, 0x56]),
    EOI,
  );
}

// ───────────────────────── WebP builder ─────────────────────────

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const padded = data.length & 1 ? concat(data, new Uint8Array([0])) : data;
  return concat(str(fourcc), le32(data.length), padded);
}
function buildWebp(): Uint8Array {
  const vp8x = new Uint8Array([0x28, 0, 0, 0, 0x7f, 0x02, 0, 0xdf, 0x01, 0]); // flags EXIF|XMP, 640x480
  const tiff = buildTiff([{ name: 'ifd0', entries: [asciiEntry(0x0131, 'Android 14; Pixel 8'), asciiEntry(0x0110, 'Pixel 8')] }]);
  const body = concat(str('WEBP'), riffChunk('VP8X', vp8x), riffChunk('EXIF', tiff));
  return concat(str('RIFF'), le32(body.length), body);
}

// ═══════════════════════════════ tests ═══════════════════════════════

describe('detectFormat', () => {
  it('recognises PNG, JPEG, WebP and rejects the rest', () => {
    expect(detectFormat(concat(PNG_SIG, IHDR, IEND))).toBe('png');
    expect(detectFormat(buildJpeg())).toBe('jpeg');
    expect(detectFormat(buildWebp())).toBe('webp');
    expect(detectFormat(str('GIF89a......'))).toBe('unknown');
    expect(detectFormat(new Uint8Array(0))).toBe('unknown');
  });
});

describe('PNG chunks', () => {
  const png = concat(
    PNG_SIG,
    IHDR,
    tEXt('Software', 'Snipping Tool'),
    tEXt('Author', 'Jane Doe'),
    iTXt('Comment', 'Saved from /Users/alice/Desktop/receipt.png'),
    zTXt('Description', 'Inflated: dm me @alice_99'),
    tIME(2024, 1, 15, 10, 22, 33),
    IEND,
  );

  it('reads tEXt and iTXt key/value pairs with their chunk source', () => {
    const raw = extractRaw(png, 'shot.png');
    const byKey = Object.fromEntries(raw.fields.map((f) => [f.key, f]));
    expect(byKey.Software.value).toBe('Snipping Tool');
    expect(byKey.Software.source).toBe('PNG tEXt chunk');
    expect(byKey.Author.value).toBe('Jane Doe');
    expect(byKey.Comment.value).toBe('Saved from /Users/alice/Desktop/receipt.png');
    expect(byKey.Comment.source).toBe('PNG iTXt chunk');
  });

  it('reads tIME as a timestamp and IHDR dimensions as info', () => {
    const raw = extractRaw(png);
    expect(raw.fields.find((f) => f.key === 'Last modification time')?.value).toBe('2024-01-15 10:22:33 UTC');
    expect(raw.info.find((f) => f.key === 'Dimensions')?.value).toBe('640 × 480 px');
  });

  it('surfaces zTXt as compressed text and folds it in once inflated', () => {
    const raw = extractRaw(png);
    expect(raw.compressed).toHaveLength(1);
    expect(raw.compressed[0].key).toBe('Description');
    // Before inflation: assessed as an undecoded block.
    const before = assess(raw);
    expect(before.leaks.some((l) => /Compressed text block "Description"/.test(l.what))).toBe(true);
    // The payload is a real zlib stream — what the UI would hand back after DecompressionStream('deflate').
    const text = inflateSync(Buffer.from(raw.compressed[0].data)).toString('utf8');
    resolveCompressedText(raw, raw.compressed[0], text);
    expect(raw.compressed).toHaveLength(0);
    const after = assess(raw);
    expect(after.fields.find((f) => f.key === 'Description')?.value).toBe('Inflated: dm me @alice_99');
    expect(after.pii.some((p) => p.kind === 'handle' && p.value === '@alice_99')).toBe(true);
  });

  it('classifies Author as a name, the path as a username and the capture app as a device hint', () => {
    const a = analyzeImage(png, 'shot.png');
    expect(a.pii).toContainEqual(expect.objectContaining({ kind: 'name', value: 'Jane Doe' }));
    expect(a.pii).toContainEqual(expect.objectContaining({ kind: 'username', value: 'alice' }));
    expect(a.leaks.find((l) => l.category === 'device')?.what).toBe('Software: Snipping Tool');
    expect(a.verdict).toBe('red'); // a name is PII
  });

  it('honours declared chunk lengths: a chunk that overruns the file stops the walk without throwing', () => {
    const overrun = concat(be32(9999), str('tEXt'), str('Software\0Sni'));
    const truncated = concat(PNG_SIG, IHDR, tEXt('Source', 'first'), overrun);
    const raw = extractRaw(truncated);
    expect(raw.fields.map((f) => f.key)).toEqual(['Source']);
  });

  it('does not bleed a tEXt value into the following chunk', () => {
    const raw = extractRaw(concat(PNG_SIG, IHDR, tEXt('Title', 'abc'), tEXt('Warning', 'xyz'), IEND));
    expect(raw.fields.map((f) => `${f.key}=${f.value}`)).toEqual(['Title=abc', 'Warning=xyz']);
  });

  it('reports a metadata-free PNG as green', () => {
    const a = analyzeImage(concat(PNG_SIG, IHDR, IEND), 'Screenshot 2024-01-15 at 10.22.33.png');
    expect(a.verdict).toBe('green');
    expect(a.leaks).toHaveLength(0);
    expect(a.pii).toHaveLength(0);
    expect(a.headline).toMatch(/no hidden metadata/i);
  });
});

describe('JPEG segments', () => {
  const jpeg = buildJpeg();
  const a = analyzeImage(jpeg, 'IMG_4471.jpg');
  const byKey = Object.fromEntries(a.fields.map((f) => [f.key, f]));

  it('reads IFD0 and Exif IFD tags', () => {
    expect(byKey.Make.value).toBe('Apple');
    expect(byKey.Model.value).toBe('iPhone 15 Pro');
    expect(byKey.Software.value).toBe('Screenshot');
    expect(byKey.Artist.value).toBe('Jane Doe');
    expect(byKey['Modify date'].value).toBe('2024:01:15 10:22:33');
    expect(byKey['Date/time original'].value).toBe('2024:01:15 10:20:00');
    expect(byKey['Body serial number'].value).toBe('SN-ABC123456');
    expect(byKey['User comment'].value).toBe('call me on +44 7700 900123');
    expect(byKey.Make.source).toBe('JPEG APP1 Exif → IFD0');
  });

  it('decodes the GPS IFD to signed decimal degrees with altitude', () => {
    expect(a.gps).not.toBeNull();
    expect(a.gps!.latitude).toBeCloseTo(51.500722, 5);
    expect(a.gps!.longitude).toBeCloseTo(-0.124639, 5);
    expect(a.gps!.altitude).toBeCloseTo(35.5, 5);
    expect(a.gps!.source).toBe('JPEG APP1 Exif → GPS IFD');
  });

  it('finds the IFD1 embedded thumbnail and returns its exact bytes', () => {
    expect(a.thumbnail).not.toBeNull();
    expect(a.thumbnail!.isJpeg).toBe(true);
    expect(Array.from(a.thumbnail!.bytes)).toEqual(Array.from(THUMB));
    expect(a.thumbnail!.source).toContain('IFD1');
  });

  it('reads the COM segment, the XMP packet and the APP13 IPTC block', () => {
    expect(byKey.Comment.value).toBe('Contact: jane@example.com');
    expect(byKey.Comment.source).toBe('JPEG COM segment');
    expect(byKey['Creator tool'].value).toBe('Adobe Photoshop 25.0 (Macintosh)');
    expect(byKey['Document ID'].value).toBe('xmp.did:0123456789ABCDEF0123456789ABCDEF');
    expect(byKey['Edit history software'].value).toBe('Adobe Photoshop 25.0 (Macintosh)');
    expect(byKey['Edit history dates'].value).toBe('2024-01-15T10:22:33Z → 2024-01-16T08:00:00Z (2 events)');
    expect(byKey.Caption.value).toBe('Team offsite at 10 Downing St');
    expect(byKey['By-line'].value).toBe('J. Doe');
    expect(byKey.City.value).toBe('London');
    expect(byKey.Caption.source).toBe('JPEG APP13 IPTC');
  });

  it('prefers Exif GPS over XMP GPS and keeps a single fix', () => {
    // XMP says 51°30.0437' — the Exif value is the one reported.
    expect(a.gps!.source).toContain('Exif');
  });

  it('collects PII from every string: email, phone, address, names', () => {
    const kinds = a.pii.map((p) => `${p.kind}:${p.value}`);
    expect(kinds).toContain('email:jane@example.com');
    expect(kinds).toContain('phone:+44 7700 900123');
    expect(kinds).toContain('address:10 Downing St');
    expect(kinds).toContain('name:Jane Doe');
    expect(kinds).toContain('name:J. Doe');
  });

  it('produces a red verdict and a headline in the agreed shape', () => {
    expect(a.verdict).toBe('red');
    expect(a.headline).toMatch(/^This screenshot leaks GPS location, an embedded thumbnail, 1 email address, 1 phone number, 1 street address, \d+ names, device\/software details, a unique identifier and timestamps$/);
    expect(a.counts).toEqual({ leaks: a.leaks.length, pii: a.pii.length, gps: true, thumbnail: true });
    // High-severity leaks are listed first.
    expect(a.leaks[0].severity).toBe('high');
    expect(a.leaks.some((l) => l.category === 'thumbnail' && /ORIGINAL thumbnail/.test(l.why))).toBe(true);
  });

  it('stops at SOS and survives a truncated segment', () => {
    const cut = jpeg.subarray(0, 40); // mid-APP1
    expect(() => extractRaw(cut)).not.toThrow();
    expect(extractRaw(cut).fields).toHaveLength(0);
  });
});

describe('XMP packet', () => {
  it('extracts attribute-form and element-form values plus GPS in DM notation', () => {
    const { fields, gps } = parseXmpPacket(XMP, 'test');
    const get = (k: string) => fields.find((f) => f.key === k)?.value;
    expect(get('Creator tool')).toBe('Adobe Photoshop 25.0 (Macintosh)');
    expect(get('Create date')).toBe('2024-01-15T10:22:33Z');
    expect(get('Creator')).toBe('Jane Doe');
    expect(get('Edit history actions')).toBe('2 events: created, saved');
    expect(gps).not.toBeNull();
    expect(gps!.latitude).toBeCloseTo(51.500728, 5);
    expect(gps!.longitude).toBeCloseTo(-0.124638, 5);
  });

  it('parses element-form keys and decodes entities', () => {
    const xml = '<rdf:Description><xmp:CreatorTool>Snip &amp; Sketch</xmp:CreatorTool><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Sent to bob@corp.example</rdf:li></rdf:Alt></dc:description></rdf:Description>';
    const { fields } = parseXmpPacket(xml, 'test');
    expect(fields.find((f) => f.key === 'Creator tool')?.value).toBe('Snip & Sketch');
    expect(fields.find((f) => f.key === 'Description')?.value).toBe('Sent to bob@corp.example');
  });
});

describe('WebP RIFF chunks', () => {
  it('parses the EXIF chunk and flags the OS string as a device leak', () => {
    const a = analyzeImage(buildWebp(), 'photo.webp');
    expect(a.format).toBe('webp');
    expect(a.fields.find((f) => f.key === 'Software')?.value).toBe('Android 14; Pixel 8');
    expect(a.fields.find((f) => f.key === 'Software')?.source).toBe('WebP EXIF chunk → IFD0');
    expect(a.info.find((f) => f.key === 'Dimensions')?.value).toBe('640 × 480 px');
    expect(a.leaks.some((l) => l.category === 'device' && /Android/.test(l.why))).toBe(true);
    expect(a.verdict).toBe('amber'); // device/software only
    expect(a.headline).toBe('This screenshot leaks device/software details');
  });
});

describe('PII regexes', () => {
  const kinds = (s: string) => scanPii(s, 't').map((h) => `${h.kind}:${h.value}`);

  it('emails: positive and negative', () => {
    expect(kinds('mail jane.doe+tag@example.co.uk now')).toContain('email:jane.doe+tag@example.co.uk');
    expect(kinds('user at example dot com')).toHaveLength(0);
    expect(kinds('@ alone or a@b')).not.toContainEqual(expect.stringMatching(/^email:/));
  });

  it('phones: international and national formats, but not dates, IPs or serials', () => {
    expect(kinds('ring +1 (415) 555-0137')).toContain('phone:+1 (415) 555-0137');
    expect(kinds('mob 07700 900123')).toContain('phone:07700 900123');
    expect(kinds('taken 2024:01:15 10:22:33')).not.toContainEqual(expect.stringMatching(/^phone:/));
    expect(kinds('shot 2024-01-15 10-22-33')).not.toContainEqual(expect.stringMatching(/^phone:/));
    expect(kinds('host 192.168.100.200')).not.toContainEqual(expect.stringMatching(/^phone:/));
    expect(kinds('serial SN123456789012')).not.toContainEqual(expect.stringMatching(/^phone:/));
    expect(kinds('ref 123456789')).not.toContainEqual(expect.stringMatching(/^phone:/));
  });

  it('street addresses: number + street word', () => {
    expect(kinds('meet at 221B Baker Street, London')).toContain('address:221B Baker Street');
    expect(kinds('1600 Pennsylvania Avenue')).toContain('address:1600 Pennsylvania Avenue');
    expect(kinds('Windows 11 Pro version 23H2')).not.toContainEqual(expect.stringMatching(/^address:/));
    expect(kinds('iPhone 15 Pro Max')).not.toContainEqual(expect.stringMatching(/^address:/));
  });

  it('decimal coordinate pairs within range only', () => {
    expect(kinds('pin 51.500729, -0.124625')).toContain('coordinates:51.500729, -0.124625');
    expect(kinds('v 1.5, 2.3')).not.toContainEqual(expect.stringMatching(/^coordinates:/));
    expect(kinds('bad 95.123456, 10.123456')).not.toContainEqual(expect.stringMatching(/^coordinates:/));
  });

  it('IBAN and card numbers are checksum-validated', () => {
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
    expect(kinds('pay GB82 WEST 1234 5698 7654 32')).toContain('iban:GB82 WEST 1234 5698 7654 32');
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(kinds('card 4111 1111 1111 1111')).toContain('card:4111 1111 1111 1111');
    expect(kinds('card 4111 1111 1111 1112')).not.toContainEqual(expect.stringMatching(/^card:/));
    // A valid card is not double-reported as a phone number.
    expect(kinds('card 4111 1111 1111 1111')).not.toContainEqual(expect.stringMatching(/^phone:/));
  });

  it('@handles, but not the domain half of an email', () => {
    expect(kinds('shot by @alice_99 today')).toContain('handle:@alice_99');
    expect(kinds('alice@example.com')).not.toContainEqual(expect.stringMatching(/^handle:/));
  });

  it('usernames from Windows and Unix home paths, ignoring generic accounts', () => {
    expect(kinds('C:\\Users\\dshadrake\\Pictures\\shot.png')).toContain('username:dshadrake');
    expect(kinds('/Users/alice/Desktop/x.png')).toContain('username:alice');
    expect(kinds('/home/bob/')).toContain('username:bob');
    expect(kinds('C:\\Users\\Public\\Pictures')).not.toContainEqual(expect.stringMatching(/^username:/));
    expect(kinds('/usr/share/icons')).not.toContainEqual(expect.stringMatching(/^username:/));
  });

  it('scans the file name too', () => {
    const a = analyzeImage(concat(PNG_SIG, IHDR, IEND), 'invoice-4111111111111111.png');
    expect(a.pii).toContainEqual(expect.objectContaining({ kind: 'card', source: 'file name' }));
    expect(a.verdict).toBe('red');
  });
});

describe('verdict ladder', () => {
  it('amber for a username-only leak, red once real PII appears', () => {
    const userOnly = analyzeImage(concat(PNG_SIG, IHDR, tEXt('Comment', 'from /home/carol/'), IEND));
    expect(userOnly.verdict).toBe('amber');
    expect(userOnly.headline).toBe('This screenshot leaks 1 username');
    const withEmail = analyzeImage(concat(PNG_SIG, IHDR, tEXt('Comment', 'from /home/carol/ carol@x.io'), IEND));
    expect(withEmail.verdict).toBe('red');
  });

  it('amber for timestamps only, low-severity free text alone is still amber (something is there)', () => {
    const ts = analyzeImage(concat(PNG_SIG, IHDR, tEXt('Creation Time', '15 Jan 2024 10:22:33'), IEND));
    expect(ts.verdict).toBe('amber');
    expect(ts.headline).toBe('This screenshot leaks timestamps');
    const txt = analyzeImage(concat(PNG_SIG, IHDR, tEXt('Title', 'Holiday'), IEND));
    expect(txt.verdict).toBe('amber');
    expect(txt.headline).toBe('This screenshot leaks hidden text metadata');
  });
});
