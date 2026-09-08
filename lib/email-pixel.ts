/**
 * lib/email-pixel — pure, framework-free engine behind the Email
 * Tracking-Pixel Detector.
 *
 * Input: raw email source (RFC 822 / MIME, as exported by "Show original",
 * "View source" or a saved .eml), or a bare HTML body. Output: the
 * open-tracking pixels, click-wrapped links, remote images and the sending
 * platform the message reveals.
 *
 * No network access, no DOM. Runs identically in the browser and in vitest.
 */

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type Severity = 'red' | 'amber' | 'green';
export type VendorCategory = 'esp' | 'sales-tracker' | 'analytics';
/** open = open-tracking endpoint, click = click-tracking endpoint, either = both, infra = identifies the vendor but is not itself a tracker (image CDN, unsubscribe page, bounce domain). */
export type VendorRole = 'open' | 'click' | 'either' | 'infra';

export interface VendorRule {
  vendor: string;
  category: VendorCategory;
  role: VendorRole;
  /** Tested against `host + path + search`, lower-cased, without the scheme. */
  test: RegExp;
}

export interface EmailHeader {
  name: string;
  value: string;
}

export interface ParsedEmail {
  hasHeaders: boolean;
  headers: EmailHeader[];
  /** Every text/html part, decoded and joined. */
  html: string;
  /** Every text/plain part, decoded and joined. */
  text: string;
  htmlParts: number;
  /** Content-Transfer-Encodings encountered while decoding (for the UI). */
  encodings: string[];
}

export interface TrackingPixel {
  src: string;
  host: string;
  vendor: string | null;
  vendorCategory: VendorCategory | null;
  /** Plain-English reasons the image was flagged. */
  reasons: string[];
  width: number | null;
  height: number | null;
}

export interface TrackedLink {
  href: string;
  host: string;
  vendor: string | null;
  vendorCategory: VendorCategory | null;
  reasons: string[];
  /** The real destination when it is visible inside the wrapper URL. */
  destination: string | null;
  destinationHost: string | null;
  /** Visible anchor text (trimmed, tags stripped). */
  text: string;
}

export interface HeaderHint {
  header: string;
  value: string;
  vendor: string | null;
  note: string;
}

export interface EspGuess {
  name: string | null;
  category: VendorCategory | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  evidence: string[];
}

export interface EmailAnalysis {
  severity: Severity;
  headline: string;
  pixels: TrackingPixel[];
  trackedLinks: TrackedLink[];
  /** Distinct http(s) links in the HTML body. */
  totalLinks: number;
  /** Distinct remote (http/https) <img> sources, including pixels. */
  remoteImages: number;
  /** Remote images that are NOT flagged as pixels — they still allow "opened" inference. */
  nonPixelRemoteImages: number;
  esp: EspGuess;
  headerHints: HeaderHint[];
  hasHeaders: boolean;
  hasHtml: boolean;
  htmlParts: number;
  encodings: string[];
  /** Distinct vendor names seen anywhere (pixels, links, headers). */
  vendors: string[];
  /** "What this means" — plain-English bullets. */
  meaning: string[];
  stats: Array<{ label: string; value: string }>;
}

// ─────────────────────────────────────────────────────────────────────────
// Vendor knowledge
// ─────────────────────────────────────────────────────────────────────────

/** Tracking hosts that belong to a product, but where the bare marketing site (www.) must not be flagged. */
function productHost(domain: string): RegExp {
  return new RegExp(`^(?!www\\.)[^/]*${domain.replace(/\./g, '\\.')}/`);
}

/** URL rules, most specific first. Tested against `host + path + search` (lower-case, no scheme). */
export const VENDOR_RULES: VendorRule[] = [
  // Mailchimp
  { vendor: 'Mailchimp', category: 'esp', role: 'open', test: /(^|\.)list-manage\.com\/track\/open/ },
  { vendor: 'Mailchimp', category: 'esp', role: 'click', test: /(^|\.)list-manage\.com\/track\/click/ },
  { vendor: 'Mailchimp', category: 'esp', role: 'infra', test: /(^|\.)(list-manage\.com|mailchi\.mp|mcusercontent\.com|mcsv\.net|rsgsv\.net|mailchimpapp\.net)(\/|$)/ },
  // SendGrid
  { vendor: 'SendGrid', category: 'esp', role: 'open', test: /(^|\.)sendgrid\.net\/wf\/open/ },
  { vendor: 'SendGrid', category: 'esp', role: 'click', test: /(^|\.)sendgrid\.net\/(wf|ls)\/click/ },
  { vendor: 'SendGrid', category: 'esp', role: 'either', test: /(^|\.)ct\.sendgrid\.net\// },
  { vendor: 'SendGrid', category: 'esp', role: 'infra', test: /(^|\.)sendgrid\.(net|com)(\/|$)/ },
  // HubSpot
  { vendor: 'HubSpot', category: 'esp', role: 'either', test: /(^|\.)t\.hubspotemail\.net\// },
  { vendor: 'HubSpot', category: 'esp', role: 'either', test: /hs-analytics/ },
  { vendor: 'HubSpot', category: 'esp', role: 'click', test: /hubspotlinks\.com\// },
  { vendor: 'HubSpot', category: 'esp', role: 'infra', test: /(^|\.)(hubspotemail\.net|hubspot\.com|hs-sites\.com|hubspotusercontent[a-z0-9-]*\.net)(\/|$)/ },
  // Mailgun
  { vendor: 'Mailgun', category: 'esp', role: 'open', test: /(^|\.)email\.mailgun\.net\/o\// },
  { vendor: 'Mailgun', category: 'esp', role: 'click', test: /(^|\.)email\.mailgun\.net\/c\// },
  { vendor: 'Mailgun', category: 'esp', role: 'infra', test: /(^|\.)mailgun\.(net|org|com)(\/|$)/ },
  // Constant Contact
  { vendor: 'Constant Contact', category: 'esp', role: 'open', test: /(^|\.)r20\.rs6\.net\/on\.jsp/ },
  { vendor: 'Constant Contact', category: 'esp', role: 'click', test: /(^|\.)r20\.rs6\.net\/tn\.jsp/ },
  { vendor: 'Constant Contact', category: 'esp', role: 'either', test: /(^|\.)r20\.rs6\.net\// },
  { vendor: 'Constant Contact', category: 'esp', role: 'infra', test: /(^|\.)(rs6\.net|constantcontact\.com|ccsend\.com)(\/|$)/ },
  // Klaviyo
  { vendor: 'Klaviyo', category: 'esp', role: 'either', test: /(^|\.)trk\.klaviyomail\.com\// },
  { vendor: 'Klaviyo', category: 'esp', role: 'infra', test: /klaviyo/ },
  // Customer.io
  { vendor: 'Customer.io', category: 'esp', role: 'either', test: /(^|\.)e\.customeriomail\.com\// },
  { vendor: 'Customer.io', category: 'esp', role: 'infra', test: /customeriomail\.com|customer\.io/ },
  // Iterable
  { vendor: 'Iterable', category: 'esp', role: 'either', test: /(^|\.)links\.iterable\.com\// },
  { vendor: 'Iterable', category: 'esp', role: 'infra', test: /iterable\.com/ },
  // Sailthru
  { vendor: 'Sailthru', category: 'esp', role: 'either', test: /(^|\.)link\.sailthru\.com\// },
  { vendor: 'Sailthru', category: 'esp', role: 'infra', test: /sailthru/ },
  // Sales / individual-inbox trackers
  { vendor: 'Yesware', category: 'sales-tracker', role: 'either', test: /(^|\.)t\.yesware\.com\// },
  { vendor: 'Yesware', category: 'sales-tracker', role: 'infra', test: /yesware/ },
  { vendor: 'Mixmax', category: 'sales-tracker', role: 'either', test: /(^|\.)email\.mixmax\.com\/api\/track/ },
  { vendor: 'Mixmax', category: 'sales-tracker', role: 'infra', test: /mixmax\.com/ },
  { vendor: 'Streak', category: 'sales-tracker', role: 'either', test: /(^|\.)mailfoogae\.appspot\.com\// },
  // Salesforce
  { vendor: 'Salesforce Pardot', category: 'esp', role: 'either', test: /(^|\.)go\.pardot\.com\// },
  { vendor: 'Salesforce Pardot', category: 'esp', role: 'infra', test: /pardot\.com/ },
  { vendor: 'Marketo', category: 'esp', role: 'either', test: /mkto/ },
  { vendor: 'Marketo', category: 'esp', role: 'infra', test: /marketo\.(com|net)/ },
  { vendor: 'Salesforce Marketing Cloud', category: 'esp', role: 'either', test: /(^|\.)exacttarget\.com\// },
  { vendor: 'Salesforce Marketing Cloud', category: 'esp', role: 'either', test: /(^|\.)exct\.net\// },
  { vendor: 'Salesforce Marketing Cloud', category: 'esp', role: 'infra', test: /exacttarget|exct\.net/ },
  // Campaign Monitor
  { vendor: 'Campaign Monitor', category: 'esp', role: 'either', test: /createsend\d*\.com\// },
  { vendor: 'Campaign Monitor', category: 'esp', role: 'either', test: /(^|\.)cmail\d*\.com\// },
  { vendor: 'Campaign Monitor', category: 'esp', role: 'infra', test: /createsend|campaignmonitor/ },
  // ConvertKit
  { vendor: 'ConvertKit', category: 'esp', role: 'either', test: /convertkit-mail\d*\.com\// },
  { vendor: 'ConvertKit', category: 'esp', role: 'infra', test: /convertkit/ },
  // ActiveCampaign
  { vendor: 'ActiveCampaign', category: 'esp', role: 'either', test: /\/lt\.php\?[^#]*(^|[?&])l=/ },
  { vendor: 'ActiveCampaign', category: 'esp', role: 'infra', test: /activehosted\.com|activecampaign/ },
  // Brevo (ex-Sendinblue)
  { vendor: 'Brevo', category: 'esp', role: 'either', test: /(^|\.)sendib[a-z]\d*\.com\// },
  { vendor: 'Brevo', category: 'esp', role: 'either', test: /sendibm/ },
  { vendor: 'Brevo', category: 'esp', role: 'infra', test: /sendinblue|brevo/ },
  // Individual trackers
  { vendor: 'Mailtrack', category: 'sales-tracker', role: 'either', test: /mailtrack\.io\// },
  { vendor: 'Litmus', category: 'analytics', role: 'either', test: /emltrk\.com\// },
  { vendor: 'Bananatag', category: 'sales-tracker', role: 'either', test: /bl-1\.com\// },
  // GetResponse
  { vendor: 'GetResponse', category: 'esp', role: 'either', test: /(^|\.)app\.getresponse\.com\// },
  { vendor: 'GetResponse', category: 'esp', role: 'infra', test: /getresponse/ },
  // Mandrill (Mailchimp Transactional)
  { vendor: 'Mandrill', category: 'esp', role: 'either', test: /mandrillapp\.com\/track/ },
  { vendor: 'Mandrill', category: 'esp', role: 'infra', test: /mandrillapp\.com/ },
  // SparkPost
  { vendor: 'SparkPost', category: 'esp', role: 'either', test: /sparkpostmail\.com\// },
  { vendor: 'SparkPost', category: 'esp', role: 'infra', test: /sparkpost/ },
  // Postmark
  { vendor: 'Postmark', category: 'esp', role: 'click', test: /(^|\.)pstmrk\.it\// },
  { vendor: 'Postmark', category: 'esp', role: 'either', test: productHost('postmarkapp.com') },
  { vendor: 'Postmark', category: 'esp', role: 'infra', test: /postmarkapp\.com/ },
  // Mailjet
  { vendor: 'Mailjet', category: 'esp', role: 'either', test: /(^|\.)mjt\.lu\// },
  { vendor: 'Mailjet', category: 'esp', role: 'either', test: /(^|\.)(links|click|t|r|tr)\.mailjet\.com\// },
  { vendor: 'Mailjet', category: 'esp', role: 'infra', test: /mailjet/ },
  // Braze
  { vendor: 'Braze', category: 'esp', role: 'either', test: /(^|\.)ablink\.[^/]+\// },
  { vendor: 'Braze', category: 'esp', role: 'either', test: /appboy/ },
  { vendor: 'Braze', category: 'esp', role: 'infra', test: /braze/ },
  // Amazon SES
  { vendor: 'Amazon SES', category: 'esp', role: 'open', test: /awstrack\.me\/i0\// },
  { vendor: 'Amazon SES', category: 'esp', role: 'click', test: /awstrack\.me\/l0\// },
  { vendor: 'Amazon SES', category: 'esp', role: 'either', test: /awstrack\.me\// },
  { vendor: 'Amazon SES', category: 'esp', role: 'infra', test: /amazonses/ },
  // More individual / sales trackers
  { vendor: 'Superhuman', category: 'sales-tracker', role: 'either', test: productHost('superhuman.com') },
  { vendor: 'Superhuman', category: 'sales-tracker', role: 'infra', test: /superhuman/ },
  { vendor: 'GMass', category: 'sales-tracker', role: 'either', test: /gmass\.co\// },
  { vendor: 'Hunter', category: 'sales-tracker', role: 'either', test: productHost('hunter.io') },
  { vendor: 'Hunter', category: 'sales-tracker', role: 'infra', test: /hunter\.io/ },
  { vendor: 'SalesLoft', category: 'sales-tracker', role: 'either', test: productHost('salesloft.com') },
  { vendor: 'SalesLoft', category: 'sales-tracker', role: 'infra', test: /salesloft/ },
  { vendor: 'Outreach', category: 'sales-tracker', role: 'either', test: productHost('outreach.io') },
  { vendor: 'Outreach', category: 'sales-tracker', role: 'infra', test: /outreach\.io/ },
  { vendor: 'Cirrus Insight', category: 'sales-tracker', role: 'either', test: productHost('cirrusinsight.com') },
  { vendor: 'Cirrus Insight', category: 'sales-tracker', role: 'infra', test: /cirrusinsight/ },
  { vendor: 'ContactMonkey', category: 'sales-tracker', role: 'either', test: productHost('contactmonkey.com') },
  { vendor: 'ContactMonkey', category: 'sales-tracker', role: 'infra', test: /contactmonkey/ },
  { vendor: 'Mailbutler', category: 'sales-tracker', role: 'either', test: productHost('mailbutler.io') },
  { vendor: 'Mailbutler', category: 'sales-tracker', role: 'infra', test: /mailbutler/ },
  { vendor: 'Polymail', category: 'sales-tracker', role: 'either', test: productHost('polymail.io') },
  { vendor: 'Polymail', category: 'sales-tracker', role: 'infra', test: /polymail/ },
  { vendor: 'Boomerang', category: 'sales-tracker', role: 'either', test: /(^|\.)mailstat\.us\// },
  { vendor: 'Boomerang', category: 'sales-tracker', role: 'either', test: productHost('boomeranggmail.com') },
  { vendor: 'Boomerang', category: 'sales-tracker', role: 'infra', test: /boomeranggmail/ },
  { vendor: 'DocSend', category: 'sales-tracker', role: 'either', test: productHost('docsend.com') },
  { vendor: 'DocSend', category: 'sales-tracker', role: 'infra', test: /docsend/ },
];

/** Product names as they appear in X-Mailer, Feedback-ID, Received lines and bounce domains. */
const VENDOR_NAME_PATTERNS: Array<{ test: RegExp; vendor: string; category: VendorCategory }> = [
  { test: /mailchimp|list-manage|mcsv\.net|rsgsv\.net|mcdlv\.net|:mc$/i, vendor: 'Mailchimp', category: 'esp' },
  { test: /mandrill/i, vendor: 'Mandrill', category: 'esp' },
  { test: /sendgrid/i, vendor: 'SendGrid', category: 'esp' },
  { test: /hubspot/i, vendor: 'HubSpot', category: 'esp' },
  { test: /mailgun/i, vendor: 'Mailgun', category: 'esp' },
  { test: /constant ?contact|rs6\.net|ccsend|roving/i, vendor: 'Constant Contact', category: 'esp' },
  { test: /klaviyo/i, vendor: 'Klaviyo', category: 'esp' },
  { test: /customer\.?io/i, vendor: 'Customer.io', category: 'esp' },
  { test: /iterable/i, vendor: 'Iterable', category: 'esp' },
  { test: /sailthru/i, vendor: 'Sailthru', category: 'esp' },
  { test: /pardot/i, vendor: 'Salesforce Pardot', category: 'esp' },
  { test: /marketo|mkto/i, vendor: 'Marketo', category: 'esp' },
  { test: /exacttarget|exct\.net|salesforce marketing|sfmc/i, vendor: 'Salesforce Marketing Cloud', category: 'esp' },
  { test: /campaign ?monitor|createsend|cmail\d*\.com/i, vendor: 'Campaign Monitor', category: 'esp' },
  { test: /convertkit/i, vendor: 'ConvertKit', category: 'esp' },
  { test: /activecampaign|activehosted/i, vendor: 'ActiveCampaign', category: 'esp' },
  { test: /sendinblue|brevo|sendib[a-z]\d*\.com/i, vendor: 'Brevo', category: 'esp' },
  { test: /getresponse/i, vendor: 'GetResponse', category: 'esp' },
  { test: /sparkpost|msys/i, vendor: 'SparkPost', category: 'esp' },
  { test: /postmark|pstmrk/i, vendor: 'Postmark', category: 'esp' },
  { test: /mailjet|mjt\.lu/i, vendor: 'Mailjet', category: 'esp' },
  { test: /braze|appboy/i, vendor: 'Braze', category: 'esp' },
  { test: /amazonses|awstrack|amazon ses/i, vendor: 'Amazon SES', category: 'esp' },
  { test: /mailerlite/i, vendor: 'MailerLite', category: 'esp' },
  { test: /yesware/i, vendor: 'Yesware', category: 'sales-tracker' },
  { test: /mixmax/i, vendor: 'Mixmax', category: 'sales-tracker' },
  { test: /streak|mailfoogae/i, vendor: 'Streak', category: 'sales-tracker' },
  { test: /mailtrack/i, vendor: 'Mailtrack', category: 'sales-tracker' },
  { test: /superhuman/i, vendor: 'Superhuman', category: 'sales-tracker' },
  { test: /gmass/i, vendor: 'GMass', category: 'sales-tracker' },
  { test: /salesloft/i, vendor: 'SalesLoft', category: 'sales-tracker' },
  { test: /outreach\.io/i, vendor: 'Outreach', category: 'sales-tracker' },
  { test: /litmus|emltrk/i, vendor: 'Litmus', category: 'analytics' },
];

/** Personal mail clients / libraries that show up in X-Mailer but are not sending platforms. */
const MAIL_CLIENT_PATTERNS: Array<{ test: RegExp; name: string }> = [
  { test: /apple mail|iphone mail|ipad mail/i, name: 'Apple Mail' },
  { test: /microsoft outlook|outlook express/i, name: 'Microsoft Outlook' },
  { test: /thunderbird/i, name: 'Thunderbird' },
  { test: /phpmailer/i, name: 'PHPMailer' },
  { test: /swiftmailer|symfony mailer/i, name: 'Symfony Mailer' },
  { test: /nodemailer/i, name: 'Nodemailer' },
  { test: /python/i, name: 'Python script' },
  { test: /wordpress|wp mail/i, name: 'WordPress' },
];

// ─────────────────────────────────────────────────────────────────────────
// Decoding helpers
// ─────────────────────────────────────────────────────────────────────────

function normalizeCharset(charset?: string | null): string {
  const c = (charset || 'utf-8').trim().replace(/^["']|["']$/g, '').toLowerCase();
  if (c === 'utf8' || c === '' ) return 'utf-8';
  return c;
}

function bytesToString(bytes: Uint8Array, charset?: string | null): string {
  const label = normalizeCharset(charset);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Decode base64 (standard or URL-safe, whitespace tolerated) to raw bytes. */
export function decodeBase64Bytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '=') break;
    const v = table.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Decode a base64 text body to a string in the given charset. */
export function decodeBase64Text(input: string, charset?: string | null): string {
  return bytesToString(decodeBase64Bytes(input), charset);
}

/** Decode quoted-printable (RFC 2045) — soft line breaks, =XX escapes — into a string in the given charset. */
export function decodeQuotedPrintable(input: string, charset?: string | null): string {
  const s = input.replace(/=\r?\n/g, '').replace(/[ \t]+(\r?\n)/g, '$1');
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const utf8 = normalizeCharset(charset) === 'utf-8';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x3d && i + 2 < s.length + 1) {
      const hex = s.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (!utf8 && code < 0x100) {
      bytes.push(code);
    } else {
      const cp = s.codePointAt(i) ?? code;
      if (cp > 0xffff) i++; // surrogate pair consumed
      for (const b of encoder.encode(String.fromCodePoint(cp))) bytes.push(b);
    }
  }
  return bytesToString(Uint8Array.from(bytes), charset);
}

/** Minimal HTML entity decoder for attribute values. */
export function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeFromCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MIME parsing
// ─────────────────────────────────────────────────────────────────────────

const HEADER_LINE = /^[A-Za-z][A-Za-z0-9-]*:/;

/** Split a message (or part) into its header block and body. `hasHeaders` is false when the text does not start with a header line. */
export function splitHeadersAndBody(raw: string): { headerBlock: string; body: string; hasHeaders: boolean } {
  let s = raw.replace(/^\uFEFF/, '');
  s = s.replace(/^From [^\n]*\r?\n/, ''); // mbox envelope line
  s = s.replace(/^(?:[ \t]*\r?\n)+/, ''); // leading blank lines
  const nl = s.indexOf('\n');
  const firstLine = nl === -1 ? s : s.slice(0, nl);
  if (!HEADER_LINE.test(firstLine)) return { headerBlock: '', body: s, hasHeaders: false };
  const m = /\r?\n\r?\n/.exec(s);
  if (!m) return { headerBlock: s, body: '', hasHeaders: true };
  return { headerBlock: s.slice(0, m.index), body: s.slice(m.index + m[0].length), hasHeaders: true };
}

/** Parse an RFC 822 header block, unfolding continuation lines. */
export function parseHeaders(block: string): EmailHeader[] {
  const out: EmailHeader[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      if (out.length) out[out.length - 1].value += ' ' + line.trim();
      continue;
    }
    const i = line.indexOf(':');
    if (i <= 0) continue;
    out.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
  }
  return out;
}

export function getHeader(headers: EmailHeader[], name: string): string | undefined {
  const n = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === n)?.value;
}

export function parseContentType(value: string): { type: string; params: Record<string, string> } {
  const [typePart, ...rest] = value.split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i <= 0) continue;
    const k = p.slice(0, i).trim().toLowerCase().replace(/\*$/, '');
    let v = p.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in params)) params[k] = v;
  }
  return { type: (typePart || '').trim().toLowerCase(), params };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a multipart body into its parts (preamble and epilogue dropped). */
export function splitMultipart(body: string, boundary: string): string[] {
  const re = new RegExp(`(?:^|\\r?\\n)--${escapeRegExp(boundary)}(--)?[ \\t]*(?:\\r?\\n|$)`, 'g');
  const parts: string[] = [];
  let last: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (last !== null) parts.push(body.slice(last, m.index));
    if (m[1] === '--') {
      last = null;
      break;
    }
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last !== null && last < body.length) parts.push(body.slice(last));
  return parts;
}

function splitPartHeaders(part: string): { headerBlock: string; body: string } {
  if (/^\r?\n/.test(part)) return { headerBlock: '', body: part.replace(/^\r?\n/, '') };
  const m = /\r?\n\r?\n/.exec(part);
  if (!m) return HEADER_LINE.test(part) ? { headerBlock: part, body: '' } : { headerBlock: '', body: part };
  const head = part.slice(0, m.index);
  if (!HEADER_LINE.test(head)) return { headerBlock: '', body: part };
  return { headerBlock: head, body: part.slice(m.index + m[0].length) };
}

function decodeBody(body: string, encoding: string, charset?: string | null): string {
  const enc = encoding.toLowerCase().trim();
  if (enc === 'quoted-printable') return decodeQuotedPrintable(body, charset);
  if (enc === 'base64') return decodeBase64Text(body, charset);
  return body;
}

export function looksLikeHtml(s: string): boolean {
  return /<\s*(html|body|table|img|a|div|p|span|head|meta|!doctype)\b/i.test(s);
}

/** Bare HTML pasted straight out of a source view often still carries QP artefacts (=3D, soft breaks). */
function looksQuotedPrintable(s: string): boolean {
  const escapes = (s.match(/=3D|=20|=0A|=0D|=E2|=C2|=C3/gi) || []).length;
  const softBreaks = (s.match(/=\r?\n/g) || []).length;
  return escapes >= 2 || softBreaks >= 2;
}

interface Collected {
  html: string[];
  text: string[];
  encodings: Set<string>;
}

function collectParts(headers: EmailHeader[], body: string, out: Collected, depth: number): void {
  const ct = parseContentType(getHeader(headers, 'content-type') || '');
  const encoding = (getHeader(headers, 'content-transfer-encoding') || '7bit').toLowerCase().trim();

  if (ct.type.startsWith('multipart/') && ct.params.boundary && depth < 10) {
    for (const part of splitMultipart(body, ct.params.boundary)) {
      const { headerBlock, body: partBody } = splitPartHeaders(part);
      collectParts(parseHeaders(headerBlock), partBody, out, depth + 1);
    }
    return;
  }

  if (ct.type === 'message/rfc822' && depth < 10) {
    const inner = decodeBody(body, encoding, ct.params.charset);
    const { headerBlock, body: innerBody } = splitHeadersAndBody(inner);
    collectParts(parseHeaders(headerBlock), innerBody, out, depth + 1);
    return;
  }

  const disposition = (getHeader(headers, 'content-disposition') || '').toLowerCase();
  if (disposition.startsWith('attachment') && ct.type !== 'text/html') return;

  const decoded = decodeBody(body, encoding, ct.params.charset);
  out.encodings.add(encoding);

  if (ct.type === 'text/html') {
    out.html.push(decoded);
  } else if (ct.type === 'text/plain') {
    out.text.push(decoded);
  } else if (!ct.type || ct.type === 'text') {
    if (looksLikeHtml(decoded)) out.html.push(decoded);
    else out.text.push(decoded);
  }
  // Other content types (images, PDFs, calendar invites…) are not scanned.
}

/** Parse raw email source (or a bare HTML body) into decoded HTML/text and headers. */
export function parseEmail(raw: string): ParsedEmail {
  const { headerBlock, body, hasHeaders } = splitHeadersAndBody(raw);
  const headers = hasHeaders ? parseHeaders(headerBlock) : [];
  const collected: Collected = { html: [], text: [], encodings: new Set() };

  if (hasHeaders) {
    collectParts(headers, body, collected, 0);
  } else {
    let content = body;
    if (looksQuotedPrintable(content)) {
      content = decodeQuotedPrintable(content, 'utf-8');
      collected.encodings.add('quoted-printable');
    }
    if (looksLikeHtml(content)) collected.html.push(content);
    else collected.text.push(content);
  }

  return {
    hasHeaders,
    headers,
    html: collected.html.join('\n'),
    text: collected.text.join('\n'),
    htmlParts: collected.html.length,
    encodings: Array.from(collected.encodings),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HTML scanning
// ─────────────────────────────────────────────────────────────────────────

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttributes(tagBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(tagBody))) {
    const name = m[1].toLowerCase();
    if (name in out) continue;
    out[name] = decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
  }
  return out;
}

/** Resolve an attribute URL to an absolute http(s) URL, or null for data:, cid:, mailto:, relative paths, etc. */
export function toHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;
  let v = value.trim().replace(/^["']|["']$/g, '').replace(/[\r\n\t]/g, '');
  if (v.startsWith('//')) v = 'https:' + v;
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

function urlKey(url: URL): string {
  return (url.host + url.pathname + url.search).toLowerCase();
}

export interface VendorMatch {
  vendor: string;
  category: VendorCategory;
  role: VendorRole;
}

/** First vendor rule that matches the URL (most specific rules are listed first). */
export function identifyVendor(url: URL | string): VendorMatch | null {
  const u = typeof url === 'string' ? toHttpUrl(url) : url;
  if (!u) return null;
  const key = urlKey(u);
  for (const rule of VENDOR_RULES) {
    if (rule.test.test(key)) return { vendor: rule.vendor, category: rule.category, role: rule.role };
  }
  return null;
}

function vendorFromName(text: string): { vendor: string; category: VendorCategory } | null {
  for (const p of VENDOR_NAME_PATTERNS) if (p.test.test(text)) return { vendor: p.vendor, category: p.category };
  return null;
}

function parsePx(v: string | undefined): number | null {
  if (v === undefined) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(v);
  return m ? parseFloat(m[1]) : null;
}

function styleProp(style: string, prop: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  const m = re.exec(style);
  return m ? m[1].trim() : undefined;
}

const OPEN_TRACKING_PATH = /\/(open|track|trk|pixel|beacon|o|on\.jsp|e2t\/o|wf\/open|i0)(\.php|\.gif|\.png|\.jpg|\/|\?|$)/i;

function hasLongToken(url: URL): boolean {
  const tokens: string[] = [];
  url.searchParams.forEach((v) => tokens.push(v));
  for (const seg of url.pathname.split('/')) tokens.push(seg);
  return tokens.some((t) => /^[A-Za-z0-9_.=-]{16,}$/.test(t));
}

/** Find open-tracking pixels among the <img> tags in an HTML body. */
export function findTrackingPixels(html: string): { pixels: TrackingPixel[]; remoteImages: number } {
  const pixels: TrackingPixel[] = [];
  const seenPixels = new Set<string>();
  const remote = new Set<string>();
  const re = /<img\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = parseAttributes(m[1]);
    const url = toHttpUrl(attrs.src);
    if (!url) continue;
    remote.add(url.href);

    const style = attrs.style || '';
    const width = parsePx(attrs.width) ?? parsePx(styleProp(style, 'width')) ?? parsePx(styleProp(style, 'max-width'));
    const height = parsePx(attrs.height) ?? parsePx(styleProp(style, 'height')) ?? parsePx(styleProp(style, 'max-height'));

    const reasons: string[] = [];
    const tiny =
      (width !== null && width <= 2 && (height === null || height <= 2)) ||
      (height !== null && height <= 2 && (width === null || width <= 2));
    if (tiny) reasons.push(`${width ?? '?'}×${height ?? '?'} pixel dimensions`);

    if (/(^|;)\s*display\s*:\s*none/i.test(style)) reasons.push('hidden with CSS (display:none)');
    else if (/(^|;)\s*visibility\s*:\s*hidden/i.test(style)) reasons.push('hidden with CSS (visibility:hidden)');
    else if (/(^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(;|$|!)/i.test(style)) reasons.push('hidden with CSS (opacity:0)');

    const match = identifyVendor(url);
    if (match && match.role !== 'infra') reasons.push(`known ${match.vendor} tracking endpoint`);

    if (OPEN_TRACKING_PATH.test(url.pathname) && !reasons.some((r) => r.startsWith('known'))) {
      reasons.push(`open-tracking style URL path (${url.pathname.length > 40 ? url.pathname.slice(0, 40) + '…' : url.pathname})`);
    }

    if (reasons.length === 0) continue;
    if (hasLongToken(url)) reasons.push('carries a unique identifier tied to you');

    const key = url.href;
    if (seenPixels.has(key)) continue;
    seenPixels.add(key);
    pixels.push({
      src: url.href,
      host: url.host,
      vendor: match ? match.vendor : null,
      vendorCategory: match ? match.category : null,
      reasons,
      width,
      height,
    });
  }
  return { pixels, remoteImages: remote.size };
}

const WRAPPER_SUBDOMAINS = new Set(['click', 'clicks', 'links', 'link', 'email', 'e', 't', 'trk', 'track', 'tracking', 'go', 'l', 'r', 'ct', 'tr', 'url', 'mail', 'em', 'm', 'redirect']);
const WRAPPER_PATH = /\/click\b|\/ls\/click|\/cl0\/|\/track\/|\/wf\/click|\/c\/|\/e\/c\//i;
const GENERIC_TRACKING_PATH = /\/ls\/click|\/wf\/(click|open)|\/cl0\/|\/e2t\/|\/track\/(click|open)|\/tn\.jsp|\/lt\.php\?|\/l0\//i;
const DESTINATION_PARAMS = new Set(['url', 'u', 'redirect', 'redirect_uri', 'redir', 'r', 'target', 'dest', 'destination', 'link', 'to', 'goto', 'next', 'q', 'p', 'l', 'e', 'ref', 'href', 'return', 'returnurl', 'continue']);

function tryDecodeUri(s: string): string {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

function asUrlString(v: string): string | null {
  const d = tryDecodeUri(v.trim());
  return /^https?:\/\/[^\s"'<>]+/i.test(d) ? d : null;
}

/** Extract the real destination from a wrapped link when the wrapper carries it visibly (query param, base64 param or path). */
export function extractDestination(url: URL): { destination: string; via: string } | null {
  let fromParam: { destination: string; via: string } | null = null;
  url.searchParams.forEach((v, k) => {
    if (fromParam) return;
    const d = asUrlString(v);
    if (d) fromParam = { destination: d, via: `query parameter "${k}"` };
  });
  if (fromParam) return fromParam;

  let fromB64: { destination: string; via: string } | null = null;
  url.searchParams.forEach((v, k) => {
    if (fromB64) return;
    if (!/^[A-Za-z0-9+/_-]{12,}={0,2}$/.test(v)) return;
    try {
      const d = asUrlString(decodeBase64Text(v, 'utf-8'));
      if (d) fromB64 = { destination: d, via: `base64 parameter "${k}"` };
    } catch {
      /* not base64 */
    }
  });
  if (fromB64) return fromB64;

  const rest = tryDecodeUri(url.pathname + url.search + url.hash);
  const m = /https?:\/\/[^\s"'<>]+/i.exec(rest);
  if (m) return { destination: m[0], via: 'embedded in the path' };
  return null;
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Find click-tracking wrappers among the <a href> tags in an HTML body. */
export function findTrackedLinks(html: string): { tracked: TrackedLink[]; totalLinks: number } {
  const tracked: TrackedLink[] = [];
  const seenTracked = new Set<string>();
  const all = new Set<string>();
  const re = /<a\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = parseAttributes(m[1]);
    const url = toHttpUrl(attrs.href);
    if (!url) continue;
    all.add(url.href);

    const reasons: string[] = [];
    const match = identifyVendor(url);
    if (match && match.role !== 'infra') reasons.push(`routed through ${match.vendor}'s click tracker`);

    const firstLabel = url.hostname.split('.')[0];
    const pathAndQuery = url.pathname + url.search;
    if (!reasons.length && WRAPPER_SUBDOMAINS.has(firstLabel) && WRAPPER_PATH.test(pathAndQuery)) {
      reasons.push('tracking-style redirect host and path');
    }
    if (!reasons.length && GENERIC_TRACKING_PATH.test(pathAndQuery)) reasons.push('tracking-style redirect path');

    const dest = extractDestination(url);
    let destinationHost: string | null = null;
    if (dest) {
      try {
        destinationHost = new URL(dest.destination).host;
      } catch {
        destinationHost = null;
      }
      const paramName = /query parameter "([^"]+)"/.exec(dest.via)?.[1];
      const knownParam = paramName ? DESTINATION_PARAMS.has(paramName.toLowerCase()) : dest.via !== 'embedded in the path' || reasons.length > 0;
      if ((knownParam || reasons.length) && destinationHost && destinationHost !== url.host) {
        reasons.push(`wraps the real destination (${dest.via})`);
      }
    }

    if (!reasons.length) continue;
    if (seenTracked.has(url.href)) continue;
    seenTracked.add(url.href);

    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 600);
    const close = after.search(/<\/a\s*>/i);
    const text = stripTags(close === -1 ? after.slice(0, 120) : after.slice(0, close)).slice(0, 80);

    tracked.push({
      href: url.href,
      host: url.host,
      vendor: match ? match.vendor : null,
      vendorCategory: match ? match.category : null,
      reasons,
      destination: dest && destinationHost && destinationHost !== url.host ? dest.destination : null,
      destinationHost: dest && destinationHost && destinationHost !== url.host ? destinationHost : null,
      text,
    });
  }
  return { tracked, totalLinks: all.size };
}

// ─────────────────────────────────────────────────────────────────────────
// Header hints → sending platform
// ─────────────────────────────────────────────────────────────────────────

const HEADER_RULES: Array<{ test: RegExp; vendor: string | ((value: string) => { vendor: string; category: VendorCategory } | null); category?: VendorCategory; note: string }> = [
  { test: /^x-mailer$/i, vendor: (v) => vendorFromName(v), note: 'Sending software identifies itself' },
  { test: /^x-mailgun-/i, vendor: 'Mailgun', category: 'esp', note: 'Mailgun delivery header' },
  { test: /^x-sg-(eid|id)$/i, vendor: 'SendGrid', category: 'esp', note: 'SendGrid event ID' },
  { test: /^x-sendgrid-/i, vendor: 'SendGrid', category: 'esp', note: 'SendGrid header' },
  { test: /^x-mc-/i, vendor: 'Mailchimp', category: 'esp', note: 'Mailchimp account header' },
  { test: /^x-mandrill-/i, vendor: 'Mandrill', category: 'esp', note: 'Mandrill (Mailchimp Transactional) header' },
  { test: /^x-campaign/i, vendor: (v) => vendorFromName(v), note: 'Bulk campaign identifier' },
  { test: /^list-unsubscribe$/i, vendor: (v) => vendorFromName(v), note: 'Bulk mailing-list header (unsubscribe endpoint)' },
  { test: /^feedback-id$/i, vendor: (v) => vendorFromName(v), note: 'Feedback-loop ID used by bulk senders' },
  { test: /^x-csa-complaints$/i, vendor: () => null, note: 'Certified Senders Alliance (bulk sender whitelisting)' },
  { test: /^x-msfbl$/i, vendor: () => null, note: 'Microsoft feedback-loop ID (bulk sender)' },
  { test: /^x-ses-/i, vendor: 'Amazon SES', category: 'esp', note: 'Amazon SES header' },
  { test: /^x-pm-message-id$/i, vendor: 'Postmark', category: 'esp', note: 'Postmark message ID' },
  { test: /^x-hubspot-/i, vendor: 'HubSpot', category: 'esp', note: 'HubSpot header' },
  { test: /^x-(marketo|mkt)/i, vendor: 'Marketo', category: 'esp', note: 'Marketo header' },
  { test: /^x-klaviyo/i, vendor: 'Klaviyo', category: 'esp', note: 'Klaviyo header' },
  { test: /^x-(mj-|mailjet-)/i, vendor: 'Mailjet', category: 'esp', note: 'Mailjet header' },
  { test: /^x-(msys-api|sparkpost)/i, vendor: 'SparkPost', category: 'esp', note: 'SparkPost header' },
  { test: /^x-sib-/i, vendor: 'Brevo', category: 'esp', note: 'Brevo header' },
  { test: /^x-braze-/i, vendor: 'Braze', category: 'esp', note: 'Braze header' },
  { test: /^x-iterable-/i, vendor: 'Iterable', category: 'esp', note: 'Iterable header' },
  { test: /^x-roving-/i, vendor: 'Constant Contact', category: 'esp', note: 'Constant Contact header' },
  { test: /^x-sfmc-/i, vendor: 'Salesforce Marketing Cloud', category: 'esp', note: 'Salesforce Marketing Cloud header' },
  { test: /^x-pardot/i, vendor: 'Salesforce Pardot', category: 'esp', note: 'Pardot header' },
  { test: /^x-getresponse/i, vendor: 'GetResponse', category: 'esp', note: 'GetResponse header' },
  { test: /^x-mailerlite/i, vendor: 'MailerLite', category: 'esp', note: 'MailerLite header' },
  { test: /^x-cio-/i, vendor: 'Customer.io', category: 'esp', note: 'Customer.io header' },
];

const INFRA_HEADERS = /^(return-path|message-id|dkim-signature|received|x-originating-ip|sender|x-sender)$/i;

/** Pull sending-platform evidence out of the headers. */
export function extractHeaderHints(headers: EmailHeader[]): HeaderHint[] {
  const hints: HeaderHint[] = [];
  for (const h of headers) {
    const rule = HEADER_RULES.find((r) => r.test.test(h.name));
    if (rule) {
      let vendor: string | null;
      let note = rule.note;
      if (typeof rule.vendor === 'string') {
        vendor = rule.vendor;
      } else {
        const found = rule.vendor(h.value);
        vendor = found ? found.vendor : null;
        if (!vendor && /^x-mailer$/i.test(h.name)) {
          const client = MAIL_CLIENT_PATTERNS.find((c) => c.test.test(h.value));
          if (client) note = `Sent from ${client.name} — a mail client or library, not a marketing platform`;
        }
      }
      hints.push({ header: h.name, value: truncate(h.value, 160), vendor, note });
      continue;
    }
    if (INFRA_HEADERS.test(h.name)) {
      const found = vendorFromName(h.value);
      if (found) hints.push({ header: h.name, value: truncate(h.value, 160), vendor: found.vendor, note: `${found.vendor} infrastructure in the delivery path` });
    }
  }
  return hints;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function categoryOf(vendor: string): VendorCategory | null {
  const rule = VENDOR_RULES.find((r) => r.vendor === vendor) || null;
  if (rule) return rule.category;
  const named = VENDOR_NAME_PATTERNS.find((p) => p.vendor === vendor);
  return named ? named.category : null;
}

/** Weigh header, pixel and link evidence into a single sending-platform guess. */
export function guessEsp(headerHints: HeaderHint[], pixels: TrackingPixel[], links: TrackedLink[]): EspGuess {
  const votes = new Map<string, { score: number; evidence: string[] }>();
  const add = (vendor: string | null, weight: number, evidence: string) => {
    if (!vendor) return;
    const cur = votes.get(vendor) || { score: 0, evidence: [] };
    cur.score += weight;
    if (cur.evidence.length < 6 && !cur.evidence.includes(evidence)) cur.evidence.push(evidence);
    votes.set(vendor, cur);
  };
  // Explicit platform headers (X-Mailer, X-MC-User…) make better evidence than Received lines, so list them first.
  const isInfra = (h: HeaderHint) => h.note.endsWith('in the delivery path');
  for (const h of [...headerHints.filter((h) => !isInfra(h)), ...headerHints.filter(isInfra)]) add(h.vendor, 3, `${h.header}: ${truncate(h.value, 80)}`);
  for (const p of pixels) add(p.vendor, 2, `Open-tracking pixel from ${p.host}`);
  for (const l of links) add(l.vendor, 1, `Tracked link via ${l.host}`);

  let best: { vendor: string; score: number; evidence: string[] } | null = null;
  votes.forEach((v, vendor) => {
    if (!best || v.score > best.score) best = { vendor, score: v.score, evidence: v.evidence };
  });
  if (!best) {
    const clientHint = headerHints.find((h) => /^x-mailer$/i.test(h.header) && !h.vendor);
    return {
      name: null,
      category: null,
      confidence: 'none',
      evidence: clientHint ? [`${clientHint.header}: ${clientHint.value}`] : [],
    };
  }
  const chosen: { vendor: string; score: number; evidence: string[] } = best;
  const headerBacked = headerHints.some((h) => h.vendor === chosen.vendor);
  const pixelBacked = pixels.some((p) => p.vendor === chosen.vendor);
  return {
    name: chosen.vendor,
    category: categoryOf(chosen.vendor),
    confidence: headerBacked ? 'high' : pixelBacked ? 'medium' : 'low',
    evidence: chosen.evidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Verdict
// ─────────────────────────────────────────────────────────────────────────

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function buildHeadline(pixels: number, trackedLinks: number, remoteImages: number, esp: string | null): string {
  const suffix = esp ? ` (${esp})` : '';
  if (pixels > 0 && trackedLinks > 0) return `This email contains ${plural(pixels, 'tracking pixel')} and ${plural(trackedLinks, 'tracked link')}${suffix}`;
  if (pixels > 0) return `This email contains ${plural(pixels, 'tracking pixel')}${suffix}`;
  if (trackedLinks > 0) return `No tracking pixels, but ${plural(trackedLinks, 'tracked link')} report your clicks${suffix}`;
  if (remoteImages > 0) return `No tracking pixels, but ${plural(remoteImages, 'remote image')} can still reveal when you open it${suffix}`;
  return 'No tracking pixels or tracked links found';
}

function buildMeaning(a: Omit<EmailAnalysis, 'meaning' | 'stats' | 'headline' | 'severity'>): string[] {
  const out: string[] = [];
  const espName = a.esp.name;
  const isSalesTracker = a.esp.category === 'sales-tracker';

  if (a.pixels.length > 0) {
    const who = espName ? espName : 'the sender';
    out.push(
      `When your mail app loads images, ${who} is told the moment you opened this email, roughly where you were (from your IP address) and which device or client you used. ${a.pixels.length > 1 ? 'Multiple pixels usually mean more than one system is watching — for example a marketing platform plus a separate analytics vendor.' : ''}`.trim(),
    );
    if (a.pixels.some((p) => p.reasons.some((r) => r.includes('unique identifier')))) {
      out.push('At least one pixel URL carries a unique identifier, so the open is tied to your specific address, not just counted anonymously.');
    }
    const unknown = a.pixels.filter((p) => !p.vendor);
    if (unknown.length) out.push(`${plural(unknown.length, 'pixel')} could not be matched to a known vendor — it may be the sender's own server, a smaller tracking service, or a personalised image used as a beacon.`);
  }

  if (a.trackedLinks.length > 0) {
    const vendors = Array.from(new Set(a.trackedLinks.map((l) => l.vendor).filter((v): v is string => !!v)));
    const via = vendors.length ? ` through ${joinNames(vendors)}` : ' through a redirect service';
    const hidden = a.trackedLinks.filter((l) => !l.destination).length;
    out.push(
      `${plural(a.trackedLinks.length, 'link')} out of ${a.totalLinks} go${via} before reaching the real page, so every click is logged against your address with a timestamp.${hidden ? ` ${plural(hidden, 'destination')} ${hidden === 1 ? 'is' : 'are'} hidden behind an opaque token — you cannot see where the link goes until you click it.` : ''}`,
    );
  }

  if (a.pixels.length === 0 && a.nonPixelRemoteImages > 0) {
    out.push(`There is no dedicated pixel, but ${plural(a.nonPixelRemoteImages, 'remote image')} still load from the sender's servers when displayed. Each of those requests can be logged as an "open" just the same.`);
  } else if (a.pixels.length > 0 && a.nonPixelRemoteImages > 0) {
    out.push(`A further ${plural(a.nonPixelRemoteImages, 'ordinary remote image')} ${a.nonPixelRemoteImages === 1 ? 'is' : 'are'} loaded from the sender's servers too — blocking the pixel alone is not enough; block remote images entirely to stay invisible.`);
  }

  if (espName) {
    if (isSalesTracker) {
      out.push(`${espName} is a tracking add-on used by individual senders (sales reps, recruiters). The person who emailed you gets a notification the moment you open it, and often how many times.`);
    } else if (a.esp.confidence === 'high') {
      out.push(`Headers show it was sent through ${espName}, a bulk email platform that offers open and click analytics to senders by default.`);
    } else {
      out.push(`The tracking endpoints point to ${espName}, a bulk email platform that offers open and click analytics to senders by default.`);
    }
  }

  if (a.pixels.length === 0 && a.trackedLinks.length === 0 && a.nonPixelRemoteImages === 0) {
    out.push(a.hasHtml
      ? 'Nothing in this email phones home when opened: no remote images, no redirect wrappers. The sender only learns something if you reply or click a plain link.'
      : 'This is a plain-text message with no HTML body, so there is nothing that can load remotely or report an open.');
  }

  if (!a.hasHeaders) {
    out.push('Only the HTML body was provided, so the sending platform was inferred from URLs alone. Paste the full source ("Show original") to include header evidence.');
  }

  return out;
}

/** Full analysis of raw email source or a bare HTML body. */
export function analyzeEmail(raw: string): EmailAnalysis {
  const parsed = parseEmail(raw);
  const { pixels, remoteImages } = findTrackingPixels(parsed.html);
  const { tracked, totalLinks } = findTrackedLinks(parsed.html);
  const headerHints = extractHeaderHints(parsed.headers);
  const esp = guessEsp(headerHints, pixels, tracked);

  const nonPixelRemoteImages = Math.max(0, remoteImages - pixels.length);
  const vendors = Array.from(
    new Set([
      ...pixels.map((p) => p.vendor),
      ...tracked.map((l) => l.vendor),
      ...headerHints.map((h) => h.vendor),
    ].filter((v): v is string => !!v)),
  );

  const severity: Severity = pixels.length > 0 ? 'red' : tracked.length > 0 || nonPixelRemoteImages > 0 ? 'amber' : 'green';
  const headline = buildHeadline(pixels.length, tracked.length, nonPixelRemoteImages, esp.name);

  const partial = {
    pixels,
    trackedLinks: tracked,
    totalLinks,
    remoteImages,
    nonPixelRemoteImages,
    esp,
    headerHints,
    hasHeaders: parsed.hasHeaders,
    hasHtml: parsed.html.trim().length > 0,
    htmlParts: parsed.htmlParts,
    encodings: parsed.encodings,
    vendors,
  };

  const meaning = buildMeaning(partial);
  const stats = [
    { label: 'Pixels', value: String(pixels.length) },
    { label: 'Tracked links', value: `${tracked.length}${totalLinks ? ` of ${totalLinks}` : ''}` },
    { label: 'Remote images', value: String(remoteImages) },
    { label: 'Sender platform', value: esp.name ?? 'Not identified' },
  ];

  return { severity, headline, ...partial, meaning, stats };
}

// ─────────────────────────────────────────────────────────────────────────
// Demo sample — a realistic Mailchimp-style newsletter with an open pixel,
// wrapped links (Mailchimp + SendGrid), an unknown 1×1 beacon, and a normal
// remote logo. Quoted-printable, as "Show original" would show it.
// ─────────────────────────────────────────────────────────────────────────

export const EXAMPLE_EMAIL = [
  'Delivered-To: you@example.com',
  'Received: from mail42.atl61.mcsv.net (mail42.atl61.mcsv.net [198.2.128.42])',
  '        by mx.example.com with ESMTPS id x12si345678',
  '        for <you@example.com>; Mon, 07 Sep 2026 09:14:22 -0700 (PDT)',
  'Return-Path: <bounce-mc.us21_1234567890abcdef.9f8e7d6c5b-you=example.com@mail42.atl61.mcsv.net>',
  'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mail42.atl61.mcsv.net; s=k1;',
  '        h=Subject:From:Reply-To:To:Date:Message-ID:List-Unsubscribe; bh=Q2xhdWRl0=; b=abc123',
  'From: Northwind Outfitters <hello@northwind-outfitters.example>',
  'Reply-To: Northwind Outfitters <hello@northwind-outfitters.example>',
  'To: you@example.com',
  'Subject: Your September gear guide is here',
  'Date: Mon, 07 Sep 2026 16:14:20 +0000',
  'Message-ID: <a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.20260907161420@mail42.atl61.mcsv.net>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="_----------=_MCPart_1694081660"',
  'X-Mailer: Mailchimp Mailer - **CID9f8e7d6c5b4a**',
  'X-Campaign: mailchimp1234567890abcdef.9f8e7d6c5b',
  'X-campaignid: mailchimp1234567890abcdef.9f8e7d6c5b',
  'X-MC-User: 1234567890abcdef',
  'X-Accounttype: pd',
  'List-Unsubscribe: <https://northwind-outfitters.us21.list-manage.com/unsubscribe?u=1234567890abcdef&id=9f8e7d6c5b&e=abcdef1234>,',
  '        <mailto:unsubscribe-mc.us21_1234567890abcdef.9f8e7d6c5b-abcdef1234@mailin1.us21.mcsv.net?subject=unsubscribe>',
  'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
  'Feedback-ID: 1234567890abcdef:1234567890abcdef.9f8e7d6c5b:us21:mc',
  'X-Report-Abuse: Please report abuse for this campaign here: https://mailchimp.com/contact/abuse/?u=1234567890abcdef&id=9f8e7d6c5b',
  '',
  'This is a multi-part message in MIME format.',
  '',
  '--_----------=_MCPart_1694081660',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Your September gear guide is here',
  '',
  'Shop the guide: https://northwind-outfitters.us21.list-manage.com/track/cli=',
  'ck?u=3D1234567890abcdef&id=3D0a1b2c3d4e&e=3Dabcdef1234',
  '',
  'Unsubscribe: https://northwind-outfitters.us21.list-manage.com/unsubscribe?=',
  'u=3D1234567890abcdef&id=3D9f8e7d6c5b&e=3Dabcdef1234',
  '',
  '--_----------=_MCPart_1694081660',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<!doctype html>',
  '<html>',
  '<head><meta charset=3D"utf-8"><title>September gear guide</title></head>',
  '<body style=3D"margin:0;padding:0;background:#f4f4f4;">',
  '<table role=3D"presentation" width=3D"100%" cellpadding=3D"0" cellspacing=3D=',
  '"0">',
  '<tr><td align=3D"center" style=3D"padding:24px;font-family:Helvetica,Arial,=',
  'sans-serif;">',
  '<img src=3D"https://mcusercontent.com/1234567890abcdef/images/logo-600.png" =',
  'width=3D"600" height=3D"120" alt=3D"Northwind Outfitters">',
  '<h1 style=3D"font-size:24px;">Your September gear guide is here</h1>',
  '<p>Cooler mornings, longer trails. We put together the kit our guides actua=',
  'lly carry this month =E2=80=94 plus a partner offer on trail insurance.</p>',
  '<p><a href=3D"https://northwind-outfitters.us21.list-manage.com/track/click?=',
  'u=3D1234567890abcdef&amp;id=3D0a1b2c3d4e&amp;e=3Dabcdef1234">Shop the guide<=',
  '/a></p>',
  '<p><a href=3D"https://ct.sendgrid.net/ls/click?upn=3Du001.A2mWcxk9QeHfj2Ph0=',
  'GbG5x2sJXr3eK8p1V4Ykz7rQ9L-2FnMd8yC1xvwGh0k1rJ1d">Partner offer: 20% off tr=',
  'ail insurance</a></p>',
  '<p><a href=3D"https://northwind-outfitters.us21.list-manage.com/track/click?=',
  'u=3D1234567890abcdef&amp;id=3D5f6e7d8c9b&amp;e=3Dabcdef1234">Read the trail =',
  'report</a></p>',
  '<p><a href=3D"https://www.northwind-outfitters.example/returns">Returns poli=',
  'cy</a></p>',
  '<p style=3D"font-size:12px;color:#888;"><a href=3D"https://northwind-outfitt=',
  'ers.us21.list-manage.com/unsubscribe?u=3D1234567890abcdef&amp;id=3D9f8e7d6c=',
  '5b&amp;e=3Dabcdef1234">Unsubscribe</a></p>',
  '</td></tr>',
  '</table>',
  '<img src=3D"https://northwind-outfitters.us21.list-manage.com/track/open.php=',
  '?u=3D1234567890abcdef&amp;id=3D9f8e7d6c5b&amp;e=3Dabcdef1234" height=3D"1" w=',
  'idth=3D"1" alt=3D"">',
  '<img src=3D"https://metrics.northwind-outfitters.example/o.gif?rid=3D7c1f0e9=',
  'd8b6a4f3e" width=3D"1" height=3D"1" style=3D"display:none" alt=3D"">',
  '</body>',
  '</html>',
  '',
  '--_----------=_MCPart_1694081660--',
  '',
].join('\r\n');
