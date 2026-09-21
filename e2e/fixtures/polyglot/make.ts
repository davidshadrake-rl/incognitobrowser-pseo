/**
 * Hostile image fixtures for e2e/pro-metadata-files.spec.ts.
 *
 * Built here, in code, rather than committed as binaries: every one of these
 * is a file a virus scanner or a code-review tool is entitled to be unhappy
 * about, and all of them are under 10 KB of arithmetic anyway. The one file
 * that is genuinely large (the size-cap case) is written sparse into a temp
 * directory at run time and deleted afterwards.
 *
 * Every fixture carries a marker string. The spec asserts the marker is
 * visible as TEXT where the tool decoded it, is never executed, and never
 * appears in the body of an outbound request.
 *
 * Grounded in what the reader actually does (lib/exif.ts):
 *   - detectImageFormat() keys off magic bytes only: FFD8FF is JPEG whatever
 *     else the file holds, and an SVG (which begins '<' or '<?xml') falls
 *     through every branch to 'unknown'.
 *   - readJpeg() decodes marker 0xFFFE (COM) through commentRow(), so a
 *     comment segment becomes a visible "Comment" field.
 *   - readPng() treats IHDR as known-and-boring (PNG_KNOWN) and never reads a
 *     width or a height out of it, so a declared 65535 x 65535 canvas costs
 *     the reader nothing. That is the claim the bomb fixture exercises.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Fixture {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Fires only if a <script> the tool was handed ever runs. Distinct per vector. */
export const MARK = {
  /** Inside the JPEG COM segment — the byte range the tool decodes and prints. */
  jpegComment: '__ibXssJpegComment',
  /** After the JPEG EOI — classic trailing-HTML polyglot payload. */
  jpegTrailer: '__ibXssJpegTrailer',
  /** Inside the SVG, both as a <script> element and as an onload attribute. */
  svg: '__ibXssSvg',
} as const;

/** Text the SVG paints, so the spec can prove it was never rendered as markup. */
export const SVG_TEXT_MARKER = 'IB-SVG-RENDERED-AS-MARKUP';

/** The PNG bomb's declared canvas: 65535 x 65535 x 4 bytes is about 17 GB. */
export const BOMB_WIDTH = 65535;
export const BOMB_HEIGHT = 65535;
/** The tEXt chunk the bomb also carries, so the spec can prove the file WAS parsed. */
export const BOMB_TEXT_KEY = 'Comment';
export const BOMB_TEXT_VALUE = 'IB-PNG-BOMB-HEADER-ONLY';

// ───────────────────────────── JPEG ─────────────────────────────

/** One JPEG COM (0xFFFE) segment carrying `text`. */
function comSegment(text: string): Buffer {
  const body = Buffer.from(text, 'latin1');
  const seg = Buffer.alloc(4 + body.length);
  seg[0] = 0xff;
  seg[1] = 0xfe;
  seg.writeUInt16BE(body.length + 2, 2); // length counts itself, not the marker
  body.copy(seg, 4);
  return seg;
}

/**
 * An HTML-as-JPEG polyglot built on a REAL photo, so "the tool parses it as an
 * image" is a claim about a file browsers genuinely decode, not about a stub.
 *
 * Layout: SOI, the original APP0/JFIF header, our COM segment holding a script
 * tag, the rest of the original file, then an HTML document after the EOI. The
 * COM goes after the first APPn rather than straight after the SOI so the file
 * stays a well-formed JFIF — a decoder that rejected it would make the test
 * pass for the wrong reason.
 */
export function htmlJpegPolyglot(sourceJpeg: string): Fixture {
  const jpeg = fs.readFileSync(sourceJpeg);
  if (!(jpeg[0] === 0xff && jpeg[1] === 0xd8)) throw new Error(`${sourceJpeg} is not a JPEG`);
  let at = 2;
  if (jpeg[at] === 0xff && jpeg[at + 1] >= 0xe0 && jpeg[at + 1] <= 0xef) {
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  const comment = `<script>window.${MARK.jpegComment}=1</script>`;
  const trailer = `\n<html><body><script>window.${MARK.jpegTrailer}=1</script></body></html>\n`;
  return {
    name: 'holiday-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.concat([
      jpeg.subarray(0, at),
      comSegment(comment),
      jpeg.subarray(at),
      Buffer.from(trailer, 'latin1'),
    ]),
  };
}

/** The exact string the COM segment holds, which the tool must print verbatim. */
export const JPEG_COMMENT_TEXT = `<script>window.${MARK.jpegComment}=1</script>`;

// ───────────────────────────── SVG ─────────────────────────────

/**
 * An SVG that tries three ways to run: a <script> element, an onload on the
 * root, and an onload on an <image>. None of them run inside an <img> element
 * by specification — this fixture exists to prove the tool really does put the
 * file in an <img> (and never in innerHTML), on the live page rather than in
 * a source grep.
 */
function svgBytes(): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" ` +
      `onload="window.${MARK.svg}=1">` +
      `<script type="text/javascript">window.${MARK.svg}=1;</script>` +
      `<rect width="200" height="120" fill="#123456"/>` +
      `<text x="8" y="60" fill="#ffffff" font-size="12">${SVG_TEXT_MARKER}</text>` +
      `</svg>\n`,
    'utf-8',
  );
}

/** The same XML, named and typed as a JPEG: the extension lies about the bytes. */
export function svgRenamedJpg(): Fixture {
  return { name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: svgBytes() };
}

/** The same XML, honestly typed. `accept="image/*"` lets it through. */
export function svgAsSvg(): Fixture {
  return { name: 'selfie.svg', mimeType: 'image/svg+xml', buffer: svgBytes() };
}

// ───────────────────────────── PNG ─────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A ~130-byte PNG whose IHDR declares a 65535 x 65535 RGBA canvas — about
 * 17 GB decoded — and which carries no pixel data at all.
 *
 * HONEST LIMIT, stated here rather than hidden in a green tick: this is a
 * header bomb, not a compression bomb. A real zip/PNG bomb is a file whose
 * IDAT genuinely inflates to gigabytes, and shipping one would mean the test
 * machine actually allocating those gigabytes if the product failed — a test
 * that takes the developer's laptop down with it when it finds the bug is not
 * a test anyone will keep running. So this fixture covers the half that can be
 * checked safely: that the METADATA READER never sizes anything from a
 * declared dimension. The spec says so, and says what is left uncovered.
 */
export function pngHeaderBomb(): Fixture {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(BOMB_WIDTH, 0);
  ihdr.writeUInt32BE(BOMB_HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const text = Buffer.from(`${BOMB_TEXT_KEY}\0${BOMB_TEXT_VALUE}`, 'latin1');
  return {
    name: 'panorama.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('tEXt', text),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  };
}

// ───────────────────────── the oversized file ─────────────────────────

/**
 * A file of exactly `size` bytes that BEGINS as a valid JPEG.
 *
 * The valid header matters: if the size guard failed to fire, the reader would
 * go on to parse it, so a passing test proves the cap stopped it rather than
 * that the bytes were unreadable garbage.
 *
 * Written sparse (ftruncate, not 50 MB of writes) so the fixture costs a few
 * milliseconds and a directory entry. The browser is handed the path, so the
 * bytes never cross the CDP connection either.
 */
export function oversizedJpeg(dir: string, size: number, name = 'huge.jpg'): string {
  const file = path.join(dir, name);
  const fd = fs.openSync(file, 'w');
  try {
    // SOI + an APP0/JFIF header, then nothing but a hole out to `size`.
    fs.writeSync(
      fd,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
      0,
      20,
      0,
    );
    fs.ftruncateSync(fd, size);
  } finally {
    fs.closeSync(fd);
  }
  const actual = fs.statSync(file).size;
  if (actual !== size) throw new Error(`oversized fixture is ${actual} bytes, wanted ${size}`);
  return file;
}
