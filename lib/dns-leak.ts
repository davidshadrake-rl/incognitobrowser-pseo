/**
 * DNS leak test — pure, framework-free logic shared by four consumers:
 *
 *   - components/tools/DnsLeakTestTool.tsx  (browser)  — hostnames, classification
 *   - app/dns-leak/{start,result}/route.ts  (Vercel)   — id generation/validation,
 *                                                        observation summarising
 *   - scripts/dnsleak-server.mjs            (droplet)  — DNS wire-format parse/build
 *   - scripts/dnsleak-check.mjs             (anywhere) — query build / response parse
 *
 * How the test works: the page asks the browser to resolve unique hostnames
 * under a zone we are authoritative for (`<n>.<testId>.<zone>`). Whatever
 * recursive resolver asks our nameserver for them is the resolver the visitor
 * is really using; the nameserver records that resolver's IP against the test
 * id. The page then compares the resolver's network to the visitor's public IP
 * (and, optionally, to a baseline recorded with the VPN off).
 *
 * The only platform hook is `globalThis.crypto.getRandomValues` (browsers,
 * Node >= 19, Edge runtime). No Node-only APIs, no DOM, no React.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_DNSLEAK_ZONE = 'dnsleak.incognitobrowser.io';

/**
 * The delegated zone. Overridable at build time with NEXT_PUBLIC_DNSLEAK_ZONE
 * (Next.js inlines that expression into the browser bundle; under plain Node
 * it reads the process env).
 */
export const DNSLEAK_ZONE: string = normalizeZone(
  process.env.NEXT_PUBLIC_DNSLEAK_ZONE || DEFAULT_DNSLEAK_ZONE,
);

export const TEST_ID_LENGTH = 12;
export const TEST_ID_RE = /^[a-z0-9]{12}$/;
/** How long a test id and its observations live in Redis. */
export const TEST_TTL_SECONDS = 600;
/** Unique hostnames the browser is asked to resolve per test. */
export const HOSTNAMES_PER_TEST = 6;

export const TEST_KEY_PREFIX = 'dnsleak:test:';
export const SEEN_KEY_PREFIX = 'dnsleak:seen:';

export function testKey(id: string): string {
  return `${TEST_KEY_PREFIX}${id}`;
}
export function seenKey(id: string): string {
  return `${SEEN_KEY_PREFIX}${id}`;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type DnsLeakStorage = 'redis' | 'none';

/** Stored at `dnsleak:test:<id>` when a test starts. */
export interface DnsLeakTestRecord {
  createdAt: number;
  publicIp: string | null;
}

/** One entry RPUSHed to `dnsleak:seen:<id>` by the nameserver. */
export interface DnsLeakObservation {
  resolverIp: string;
  ts: number;
  qname: string;
}

/** One resolver as returned by /dns-leak/result. */
export interface ResolverSummary {
  ip: string;
  firstSeen: number;
  count: number;
  /** /24 (IPv4) or /64 (IPv6) prefix the resolver IP sits in. */
  network: string;
}

// ---------------------------------------------------------------------------
// Test ids and hostnames
// ---------------------------------------------------------------------------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function defaultRandomBytes(n: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available in this runtime');
  }
  return c.getRandomValues(new Uint8Array(n));
}

/**
 * 12 chars of [a-z0-9] from a CSPRNG. Rejection sampling (bytes >= 252 are
 * discarded) keeps the distribution uniform: 252 = 36 * 7.
 */
export function generateTestId(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  let out = '';
  let rounds = 0;
  while (out.length < TEST_ID_LENGTH) {
    if (++rounds > 64) throw new Error('random source keeps producing rejected bytes');
    const bytes = randomBytes(TEST_ID_LENGTH * 2);
    for (let i = 0; i < bytes.length && out.length < TEST_ID_LENGTH; i++) {
      const b = bytes[i];
      if (b >= 252) continue;
      out += ID_ALPHABET[b % ID_ALPHABET.length];
    }
  }
  return out;
}

export function isValidTestId(id: unknown): id is string {
  return typeof id === 'string' && TEST_ID_RE.test(id);
}

/** Lower-case, trimmed, no trailing dot. */
export function normalizeZone(zone: string): string {
  return zone.trim().toLowerCase().replace(/\.+$/, '');
}

/** Same normalisation for any DNS name (handles 0x20 case randomisation). */
export function normalizeName(name: string): string {
  return normalizeZone(name);
}

/** `['1.<id>.<zone>', '2.<id>.<zone>', …]` */
export function buildHostnames(id: string, zone: string = DNSLEAK_ZONE, count: number = HOSTNAMES_PER_TEST): string[] {
  if (!isValidTestId(id)) throw new Error('invalid test id');
  const z = normalizeZone(zone);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`${i}.${id}.${z}`);
  return out;
}

/** True when `name` is the zone apex or any name below it. */
export function isInZone(name: string, zone: string): boolean {
  const n = normalizeName(name);
  const z = normalizeZone(zone);
  if (!z) return false;
  return n === z || n.endsWith(`.${z}`);
}

/**
 * The test id is the label immediately before the zone:
 *   `3.abc123def456.dnsleak.example.com` → `abc123def456`
 * Returns null for the apex, the nameserver host, or anything that is not a
 * well-formed id — those queries are answered but never recorded.
 */
export function extractTestId(qname: string, zone: string): string | null {
  const n = normalizeName(qname);
  const z = normalizeZone(zone);
  if (!z || n === z || !n.endsWith(`.${z}`)) return null;
  const prefix = n.slice(0, -(z.length + 1));
  const labels = prefix.split('.').filter(Boolean);
  if (labels.length === 0) return null;
  const candidate = labels[labels.length - 1];
  return isValidTestId(candidate) ? candidate : null;
}

// ---------------------------------------------------------------------------
// IP helpers
// ---------------------------------------------------------------------------

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIPv4(ip: string): number[] | null {
  const m = IPV4_RE.exec(ip.trim());
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

export function isIPv4(ip: string): boolean {
  return parseIPv4(ip) !== null;
}

/**
 * Expand an IPv6 address to 8 hextets (numbers). Handles `::` compression,
 * IPv4-mapped tails (`::ffff:1.2.3.4`), zone ids (`fe80::1%eth0`) and the
 * bracketed form. Returns null when the string is not a valid IPv6 address.
 */
export function expandIPv6(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(':')) return null;

  // IPv4-mapped / embedded tail → convert the dotted quad to two hextets.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (parts.length === 1 && head.length !== 8) return null;
  if (parts.length === 2 && head.length + rest.length > 7) return null;

  const hextets: number[] = [];
  const push = (h: string): boolean => {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return false;
    hextets.push(parseInt(h, 16));
    return true;
  };
  for (const h of head) if (!push(h)) return null;
  if (parts.length === 2) {
    const fill = 8 - head.length - rest.length;
    for (let i = 0; i < fill; i++) hextets.push(0);
    for (const h of rest) if (!push(h)) return null;
  }
  return hextets.length === 8 ? hextets : null;
}

export function isIPv6(ip: string): boolean {
  return expandIPv6(ip) !== null;
}

/** `ipv4Prefix('73.12.5.9', 24)` → `'73.12.5.0/24'`; `16` → `'73.12.0.0/16'`. */
export function ipv4Prefix(ip: string, bits: number): string | null {
  const o = parseIPv4(ip);
  if (!o || bits < 0 || bits > 32) return null;
  const addr = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const net = (addr & mask) >>> 0;
  return `${net >>> 24}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}/${bits}`;
}

/**
 * `ipv6Prefix('2001:db8:1:2:3:4:5:6', 64)` → `'2001:db8:1:2::/64'`.
 * `bits` must be a multiple of 16 (0–128); the kept hextets are printed
 * without leading zeros, the rest are collapsed to `::`.
 */
export function ipv6Prefix(ip: string, bits: number): string | null {
  const h = expandIPv6(ip);
  if (!h || bits < 0 || bits > 128 || bits % 16 !== 0) return null;
  const keep = bits / 16;
  const kept = h.slice(0, keep).map((x) => x.toString(16));
  if (keep === 8) return `${kept.join(':')}/${bits}`;
  if (keep === 0) return `::/${bits}`;
  return `${kept.join(':')}::/${bits}`;
}

/** The "same neighbourhood" prefix used for display: /24 for IPv4, /64 for IPv6. */
export function networkOf(ip: string): string | null {
  if (isIPv4(ip)) return ipv4Prefix(ip, 24);
  if (isIPv6(ip)) return ipv6Prefix(ip, 64);
  return null;
}

/**
 * The coarser "same operator" range used for leak comparison: /16 for IPv4,
 * /32 for IPv6 (a typical ISP allocation). Consumer ISPs and VPN exits rarely
 * share one of these by accident.
 */
export function ispRangeOf(ip: string): string | null {
  if (isIPv4(ip)) return ipv4Prefix(ip, 16);
  if (isIPv6(ip)) return ipv6Prefix(ip, 32);
  return null;
}

export function sameIspRange(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ra = ispRangeOf(a);
  const rb = ispRangeOf(b);
  return ra !== null && ra === rb;
}

// ---------------------------------------------------------------------------
// Observations → resolver summaries
// ---------------------------------------------------------------------------

export function parseObservation(json: string): DnsLeakObservation | null {
  try {
    const v = JSON.parse(json) as Partial<DnsLeakObservation>;
    if (!v || typeof v.resolverIp !== 'string' || !v.resolverIp) return null;
    if (!isIPv4(v.resolverIp) && !isIPv6(v.resolverIp)) return null;
    return {
      resolverIp: v.resolverIp,
      ts: typeof v.ts === 'number' && Number.isFinite(v.ts) ? v.ts : 0,
      qname: typeof v.qname === 'string' ? v.qname.slice(0, 253) : '',
    };
  } catch {
    return null;
  }
}

export function parseTestRecord(json: string | null | undefined): DnsLeakTestRecord | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<DnsLeakTestRecord>;
    if (!v || typeof v.createdAt !== 'number') return null;
    const ip = typeof v.publicIp === 'string' && (isIPv4(v.publicIp) || isIPv6(v.publicIp)) ? v.publicIp : null;
    return { createdAt: v.createdAt, publicIp: ip };
  } catch {
    return null;
  }
}

/** Group raw observations by resolver IP, oldest first. Never echoes qnames. */
export function summarizeObservations(observations: DnsLeakObservation[]): ResolverSummary[] {
  const byIp = new Map<string, ResolverSummary>();
  for (const o of observations) {
    const existing = byIp.get(o.resolverIp);
    if (existing) {
      existing.count += 1;
      if (o.ts && (o.ts < existing.firstSeen || existing.firstSeen === 0)) existing.firstSeen = o.ts;
    } else {
      byIp.set(o.resolverIp, {
        ip: o.resolverIp,
        firstSeen: o.ts,
        count: 1,
        network: networkOf(o.resolverIp) ?? o.resolverIp,
      });
    }
  }
  return [...byIp.values()].sort((a, b) => a.firstSeen - b.firstSeen || a.ip.localeCompare(b.ip));
}

// ---------------------------------------------------------------------------
// Leak classification
// ---------------------------------------------------------------------------

export type DnsLeakSeverity = 'red' | 'amber' | 'green' | 'info';
export type DnsLeakVerdict = 'leak' | 'no-leak' | 'inconclusive' | 'baseline';
export type DnsLeakReason =
  | 'no-backend'
  | 'no-observations'
  | 'vpn-off'
  | 'matches-isp-baseline'
  | 'multiple-networks'
  | 'multiple-networks-unmatched'
  | 'vpn-network'
  | 'outside-isp-baseline'
  | 'needs-baseline';

/** What a VPN-off run recorded, so a VPN-on run can recognise the ISP's resolvers. */
export interface DnsLeakBaseline {
  publicIp: string | null;
  resolverIps: string[];
  savedAt?: number;
}

export interface ClassifyDnsLeakInput {
  publicIp: string | null;
  resolvers: ResolverSummary[];
  vpnOn: boolean;
  storage: DnsLeakStorage;
  baseline?: DnsLeakBaseline | null;
}

export interface DnsLeakClassification {
  severity: DnsLeakSeverity;
  verdict: DnsLeakVerdict;
  reason: DnsLeakReason;
  headline: string;
  detail: string;
  /** Distinct operator ranges (/16 or /32) the resolvers were seen on. */
  networks: string[];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function listNetworks(nets: string[]): string {
  return nets.join(', ');
}

/** Distinct operator ranges of a set of resolvers, in first-seen order. */
export function resolverNetworks(resolvers: ResolverSummary[]): string[] {
  const out: string[] = [];
  for (const r of resolvers) {
    const range = ispRangeOf(r.ip) ?? r.ip;
    if (!out.includes(range)) out.push(range);
  }
  return out;
}

function baselineRanges(baseline: DnsLeakBaseline | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!baseline) return set;
  if (baseline.publicIp) {
    const r = ispRangeOf(baseline.publicIp);
    if (r) set.add(r);
  }
  for (const ip of baseline.resolverIps ?? []) {
    const r = ispRangeOf(ip);
    if (r) set.add(r);
  }
  return set;
}

/**
 * Turn a result into a verdict. Honest by construction:
 *
 *   - 0 observations is never green — it is "inconclusive", with the reason
 *     (backend not configured vs. no query reached the nameserver).
 *   - VPN off is a baseline, not a pass/fail: it tells us which resolver
 *     network the ISP hands the visitor, so a later VPN-on run can recognise it.
 *   - VPN on: a resolver on the same operator range as the public IP (which,
 *     with the VPN on, IS the VPN exit) means DNS rides the tunnel → green.
 *     A resolver on the ISP baseline's range → red. Several distinct ranges
 *     → red (at least one is outside the tunnel) unless a baseline proves none
 *     of them is the ISP, in which case amber. A single unknown range with no
 *     baseline is amber: we cannot tell the VPN's resolver from the ISP's
 *     without a baseline, and we do not do ASN lookups.
 */
export function classifyDnsLeak(input: ClassifyDnsLeakInput): DnsLeakClassification {
  const { publicIp, resolvers, vpnOn, storage, baseline } = input;
  const networks = resolverNetworks(resolvers);
  const n = resolvers.length;

  if (n === 0) {
    if (storage === 'none') {
      return {
        severity: 'amber',
        verdict: 'inconclusive',
        reason: 'no-backend',
        headline: 'Inconclusive — the test backend is not configured on this deployment',
        detail: 'No resolver could be recorded because this deployment has no storage for test observations.',
        networks,
      };
    }
    return {
      severity: 'amber',
      verdict: 'inconclusive',
      reason: 'no-observations',
      headline: 'Inconclusive — no DNS query reached our nameserver',
      detail:
        'The test zone may not be delegated yet, or a resolver cached a wildcard; try again in a minute.',
      networks,
    };
  }

  const first = networks[0];

  if (!vpnOn) {
    return {
      severity: 'info',
      verdict: 'baseline',
      reason: 'vpn-off',
      headline: `With your VPN off, your DNS requests are answered by ${plural(n, 'resolver')} on network ${listNetworks(networks)}`,
      detail:
        'This is your ISP-side baseline. Turn the VPN on and run the test again: if the same resolver network answers, DNS is leaking around the tunnel.',
      networks,
    };
  }

  const bRanges = baselineRanges(baseline);
  const hasBaseline = bRanges.size > 0;
  const matchesBaseline = networks.filter((r) => bRanges.has(r));

  if (matchesBaseline.length > 0) {
    return {
      severity: 'red',
      verdict: 'leak',
      reason: 'matches-isp-baseline',
      headline: `Your DNS requests are answered by ${plural(n, 'resolver')} on network ${listNetworks(matchesBaseline)} — the same network as when your VPN was off`,
      detail:
        'Your lookups are still going to the resolver your ISP hands you, so your browsing destinations are visible to it even though your traffic is tunnelled.',
      networks,
    };
  }

  if (networks.length >= 2) {
    if (hasBaseline) {
      return {
        severity: 'amber',
        verdict: 'inconclusive',
        reason: 'multiple-networks-unmatched',
        headline: `Your DNS requests are answered by ${plural(n, 'resolver')} on ${networks.length} different networks (${listNetworks(networks)}) while your VPN is on`,
        detail:
          'None of them matches your ISP baseline. Large public resolvers use many egress ranges, so this is probably not an ISP leak, but your lookups are not all answered from your VPN’s network.',
        networks,
      };
    }
    return {
      severity: 'red',
      verdict: 'leak',
      reason: 'multiple-networks',
      headline: `Your DNS requests are answered by ${plural(n, 'resolver')} on ${networks.length} different networks (${listNetworks(networks)}) while your VPN is on`,
      detail:
        'At least one of these resolvers is outside your VPN’s network, which means some lookups are leaving the tunnel.',
      networks,
    };
  }

  const publicRange = publicIp ? ispRangeOf(publicIp) : null;
  if (publicRange && first === publicRange) {
    return {
      severity: 'green',
      verdict: 'no-leak',
      reason: 'vpn-network',
      headline: `Your DNS requests are answered by ${plural(n, 'resolver')} on network ${first} — the same network as your VPN exit IP`,
      detail: 'Your lookups are travelling through the tunnel and being answered by your VPN provider’s resolver.',
      networks,
    };
  }

  if (hasBaseline) {
    return {
      severity: 'green',
      verdict: 'no-leak',
      reason: 'outside-isp-baseline',
      headline: `Your DNS requests are answered by ${plural(n, 'resolver')} on network ${first}, not on your ISP’s resolver network`,
      detail:
        'The resolver answering for you is not the one your ISP handed you with the VPN off. Your VPN (or a resolver you configured) is handling DNS.',
      networks,
    };
  }

  return {
    severity: 'amber',
    verdict: 'inconclusive',
    reason: 'needs-baseline',
    headline: `Your DNS requests are answered by ${plural(n, 'resolver')} on network ${first} — a different network from your VPN exit IP`,
    detail:
      'Without a baseline we cannot tell whether that resolver belongs to your VPN provider or to your ISP. Turn the VPN off, run the test once, then turn it on and run again.',
    networks,
  };
}

// ---------------------------------------------------------------------------
// DNS wire format (RFC 1035) — just enough for an authoritative A/NS/SOA responder
// ---------------------------------------------------------------------------

export const DNS_TYPE = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  TXT: 16,
  AAAA: 28,
  OPT: 41,
  ANY: 255,
} as const;

export const DNS_CLASS_IN = 1;

export const DNS_RCODE = {
  NOERROR: 0,
  FORMERR: 1,
  SERVFAIL: 2,
  NXDOMAIN: 3,
  NOTIMP: 4,
  REFUSED: 5,
} as const;

export const DNS_FLAG = {
  QR: 0x8000,
  AA: 0x0400,
  TC: 0x0200,
  RD: 0x0100,
  RA: 0x0080,
} as const;

/** Pointer to offset 12 — the question name — used to compress answer owner names. */
export const COMPRESSION_POINTER_QNAME = 0xc00c;

export interface DnsHeader {
  id: number;
  flags: number;
  qdcount: number;
  ancount: number;
  nscount: number;
  arcount: number;
}

export interface DnsQuestion {
  name: string;
  type: number;
  cls: number;
}

export interface ParsedDnsQuery {
  header: DnsHeader;
  question: DnsQuestion;
  /** Byte offset just past the first question — the question bytes are copied verbatim into responses. */
  questionEnd: number;
  rd: boolean;
  raw: Uint8Array;
}

export interface DnsRecord {
  name: string;
  type: number;
  cls?: number;
  ttl: number;
  rdata: Uint8Array;
}

function u16(buf: Uint8Array, off: number): number {
  if (off + 2 > buf.length) throw new Error('truncated');
  return (buf[off] << 8) | buf[off + 1];
}

function u32(buf: Uint8Array, off: number): number {
  if (off + 4 > buf.length) throw new Error('truncated');
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function pushU16(out: number[], v: number): void {
  out.push((v >>> 8) & 0xff, v & 0xff);
}

function pushU32(out: number[], v: number): void {
  out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

/** Encode a name as uncompressed labels: `a.b` → `01 61 01 62 00`. */
export function encodeName(name: string): Uint8Array {
  const labels = name.trim().replace(/\.+$/, '').split('.').filter(Boolean);
  const out: number[] = [];
  for (const label of labels) {
    if (label.length > 63) throw new Error(`label too long: ${label}`);
    out.push(label.length);
    for (let i = 0; i < label.length; i++) {
      const code = label.charCodeAt(i);
      if (code > 0x7f) throw new Error('non-ASCII label');
      out.push(code);
    }
  }
  if (out.length > 254) throw new Error('name too long');
  out.push(0);
  return Uint8Array.from(out);
}

/**
 * Read a (possibly compressed) name at `offset`. Returns the dotted name and
 * the offset just past the name in the *original* stream (i.e. after the
 * first pointer, if any). Pointers may only point backwards.
 */
export function readName(buf: Uint8Array, offset: number): { name: string; end: number } {
  const labels: string[] = [];
  let pos = offset;
  let end = -1;
  let jumps = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('name runs past end of packet');
    const len = buf[pos];
    if (len === 0) {
      pos += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('truncated pointer');
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (end < 0) end = pos + 2;
      if (ptr >= pos || ++jumps > 32) throw new Error('bad compression pointer');
      pos = ptr;
      continue;
    }
    if ((len & 0xc0) !== 0) throw new Error('unsupported label type');
    if (pos + 1 + len > buf.length) throw new Error('label runs past end of packet');
    let label = '';
    for (let i = pos + 1; i < pos + 1 + len; i++) label += String.fromCharCode(buf[i]);
    labels.push(label);
    pos += 1 + len;
  }
  if (end < 0) end = pos;
  return { name: labels.join('.'), end };
}

/** Parse the header + first question of a query packet. Null when malformed or not a query. */
export function parseDnsQuery(buf: Uint8Array): ParsedDnsQuery | null {
  if (buf.length < 12) return null;
  try {
    const header: DnsHeader = {
      id: u16(buf, 0),
      flags: u16(buf, 2),
      qdcount: u16(buf, 4),
      ancount: u16(buf, 6),
      nscount: u16(buf, 8),
      arcount: u16(buf, 10),
    };
    if (header.flags & DNS_FLAG.QR) return null;
    if (header.qdcount < 1) return null;
    const { name, end } = readName(buf, 12);
    const question: DnsQuestion = { name, type: u16(buf, end), cls: u16(buf, end + 2) };
    return { header, question, questionEnd: end + 4, rd: (header.flags & DNS_FLAG.RD) !== 0, raw: buf };
  } catch {
    return null;
  }
}

/** Build a query packet (used by the check script and the tests). */
export function buildDnsQuery(name: string, type: number = DNS_TYPE.A, id?: number, rd: boolean = true): Uint8Array {
  const out: number[] = [];
  const qid = id ?? Math.floor(Math.random() * 0x10000);
  pushU16(out, qid & 0xffff);
  pushU16(out, rd ? DNS_FLAG.RD : 0);
  pushU16(out, 1);
  pushU16(out, 0);
  pushU16(out, 0);
  pushU16(out, 0);
  out.push(...encodeName(name));
  pushU16(out, type);
  pushU16(out, DNS_CLASS_IN);
  return Uint8Array.from(out);
}

export interface BuildResponseOptions {
  rcode?: number;
  /** Authoritative Answer bit. Defaults to true — we only speak for our own zone. */
  aa?: boolean;
  answers?: DnsRecord[];
  authority?: DnsRecord[];
  additional?: DnsRecord[];
}

/**
 * Build a response to `query`. The question section is copied byte-for-byte
 * (preserving 0x20 case randomisation); any record whose owner name equals
 * the question name is written as the 2-byte pointer 0xC00C.
 */
export function buildDnsResponse(query: ParsedDnsQuery, opts: BuildResponseOptions = {}): Uint8Array {
  const answers = opts.answers ?? [];
  const authority = opts.authority ?? [];
  const additional = opts.additional ?? [];
  const out: number[] = [];

  pushU16(out, query.header.id);
  let flags = DNS_FLAG.QR | (query.header.flags & 0x7800) | (query.header.flags & DNS_FLAG.RD) | ((opts.rcode ?? 0) & 0x0f);
  if (opts.aa ?? true) flags |= DNS_FLAG.AA;
  pushU16(out, flags);
  pushU16(out, 1);
  pushU16(out, answers.length);
  pushU16(out, authority.length);
  pushU16(out, additional.length);

  for (let i = 12; i < query.questionEnd; i++) out.push(query.raw[i]);

  const qname = normalizeName(query.question.name);
  const writeRecord = (rr: DnsRecord) => {
    if (normalizeName(rr.name) === qname) pushU16(out, COMPRESSION_POINTER_QNAME);
    else out.push(...encodeName(rr.name));
    pushU16(out, rr.type);
    pushU16(out, rr.cls ?? DNS_CLASS_IN);
    pushU32(out, rr.ttl >>> 0);
    pushU16(out, rr.rdata.length);
    out.push(...rr.rdata);
  };
  for (const rr of answers) writeRecord(rr);
  for (const rr of authority) writeRecord(rr);
  for (const rr of additional) writeRecord(rr);

  return Uint8Array.from(out);
}

export function rdataA(ip: string): Uint8Array {
  const o = parseIPv4(ip);
  if (!o) throw new Error(`not an IPv4 address: ${ip}`);
  return Uint8Array.from(o);
}

/** NS / CNAME rdata: an (uncompressed) domain name. */
export function rdataName(name: string): Uint8Array {
  return encodeName(name);
}

export interface SoaFields {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
}

export function rdataSoa(f: SoaFields): Uint8Array {
  const out: number[] = [];
  out.push(...encodeName(f.mname));
  out.push(...encodeName(f.rname));
  pushU32(out, f.serial);
  pushU32(out, f.refresh);
  pushU32(out, f.retry);
  pushU32(out, f.expire);
  pushU32(out, f.minimum);
  return Uint8Array.from(out);
}

/** A single A record for the question name. */
export function buildAResponse(query: ParsedDnsQuery, ip: string, ttl: number = 1): Uint8Array {
  return buildDnsResponse(query, {
    aa: true,
    answers: [{ name: query.question.name, type: DNS_TYPE.A, ttl, rdata: rdataA(ip) }],
  });
}

export function buildEmptyResponse(query: ParsedDnsQuery, opts: { rcode?: number; aa?: boolean; authority?: DnsRecord[] } = {}): Uint8Array {
  return buildDnsResponse(query, { rcode: opts.rcode ?? DNS_RCODE.NOERROR, aa: opts.aa ?? true, authority: opts.authority });
}

export interface AuthoritativeConfig {
  zone: string;
  /** The IPv4 address every A query in the zone is answered with. */
  answerIp: string;
  /** The nameserver's own hostname, e.g. `ns1.<zone>`. */
  nsHost: string;
  /** TTL for A answers. 0 or 1 keeps resolvers from caching test names. */
  ttl?: number;
  serial?: number;
}

export interface AuthoritativeAnswer {
  response: Uint8Array;
  inZone: boolean;
  /** The test id to record, or null when the query is for the apex / nameserver / a malformed label. */
  testId: string | null;
}

function soaRecord(zone: string, cfg: AuthoritativeConfig): DnsRecord {
  return {
    name: zone,
    type: DNS_TYPE.SOA,
    ttl: 60,
    rdata: rdataSoa({
      mname: cfg.nsHost,
      rname: `hostmaster.${zone}`,
      serial: cfg.serial ?? 2026090701,
      refresh: 3600,
      retry: 600,
      expire: 86400,
      minimum: 1,
    }),
  };
}

/**
 * Decide how to answer a query as the authority for `cfg.zone`:
 *   - outside the zone → REFUSED (we are not a recursive resolver)
 *   - A / ANY → the configured IP, TTL 1 (every name in the zone, apex and ns host included)
 *   - NS at the apex → our NS record (+ glue A when the host is inside the zone)
 *   - SOA at the apex → a minimal SOA
 *   - anything else → NOERROR / empty answer with the SOA in the authority section
 * The test id (if the name carries one) is returned so the caller can record the resolver.
 */
export function answerAuthoritatively(query: ParsedDnsQuery, cfg: AuthoritativeConfig): AuthoritativeAnswer {
  const zone = normalizeZone(cfg.zone);
  const qname = normalizeName(query.question.name);
  if (!isInZone(qname, zone)) {
    return { response: buildDnsResponse(query, { rcode: DNS_RCODE.REFUSED, aa: false }), inZone: false, testId: null };
  }
  const testId = extractTestId(qname, zone);
  const ttl = cfg.ttl ?? 1;
  const nsHost = normalizeName(cfg.nsHost);
  const soa = soaRecord(zone, cfg);
  const qtype = query.question.type;

  if (qtype === DNS_TYPE.A || qtype === DNS_TYPE.ANY) {
    return { response: buildAResponse(query, cfg.answerIp, ttl), inZone: true, testId };
  }
  if (qtype === DNS_TYPE.NS && qname === zone) {
    const additional: DnsRecord[] = isInZone(nsHost, zone)
      ? [{ name: nsHost, type: DNS_TYPE.A, ttl: 3600, rdata: rdataA(cfg.answerIp) }]
      : [];
    return {
      response: buildDnsResponse(query, {
        aa: true,
        answers: [{ name: zone, type: DNS_TYPE.NS, ttl: 3600, rdata: rdataName(nsHost) }],
        additional,
      }),
      inZone: true,
      testId,
    };
  }
  if (qtype === DNS_TYPE.SOA && qname === zone) {
    return { response: buildDnsResponse(query, { aa: true, answers: [soa] }), inZone: true, testId };
  }
  return { response: buildEmptyResponse(query, { aa: true, authority: [soa] }), inZone: true, testId };
}

// ---------------------------------------------------------------------------
// Response parsing (check script + tests)
// ---------------------------------------------------------------------------

export interface ParsedDnsRecord {
  name: string;
  type: number;
  cls: number;
  ttl: number;
  rdata: Uint8Array;
  /** Decoded rdata: dotted IPv4 for A, a name for NS/CNAME, fields for SOA, hex otherwise. */
  data: string | SoaFields;
}

export interface ParsedDnsResponse {
  header: DnsHeader;
  flags: { qr: boolean; aa: boolean; tc: boolean; rd: boolean; ra: boolean; opcode: number; rcode: number };
  questions: DnsQuestion[];
  answers: ParsedDnsRecord[];
  authority: ParsedDnsRecord[];
  additional: ParsedDnsRecord[];
}

function decodeRdata(buf: Uint8Array, type: number, start: number, len: number): string | SoaFields {
  const rd = buf.subarray(start, start + len);
  switch (type) {
    case DNS_TYPE.A:
      return len === 4 ? `${rd[0]}.${rd[1]}.${rd[2]}.${rd[3]}` : toHex(rd);
    case DNS_TYPE.NS:
    case DNS_TYPE.CNAME:
      return readName(buf, start).name;
    case DNS_TYPE.SOA: {
      const m = readName(buf, start);
      const r = readName(buf, m.end);
      let p = r.end;
      const serial = u32(buf, p); p += 4;
      const refresh = u32(buf, p); p += 4;
      const retry = u32(buf, p); p += 4;
      const expire = u32(buf, p); p += 4;
      const minimum = u32(buf, p);
      return { mname: m.name, rname: r.name, serial, refresh, retry, expire, minimum };
    }
    case DNS_TYPE.AAAA: {
      if (len !== 16) return toHex(rd);
      const parts: string[] = [];
      for (let i = 0; i < 16; i += 2) parts.push(((rd[i] << 8) | rd[i + 1]).toString(16));
      return parts.join(':');
    }
    default:
      return toHex(rd);
  }
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function parseDnsResponse(buf: Uint8Array): ParsedDnsResponse {
  const header: DnsHeader = {
    id: u16(buf, 0),
    flags: u16(buf, 2),
    qdcount: u16(buf, 4),
    ancount: u16(buf, 6),
    nscount: u16(buf, 8),
    arcount: u16(buf, 10),
  };
  const f = header.flags;
  const flags = {
    qr: (f & DNS_FLAG.QR) !== 0,
    aa: (f & DNS_FLAG.AA) !== 0,
    tc: (f & DNS_FLAG.TC) !== 0,
    rd: (f & DNS_FLAG.RD) !== 0,
    ra: (f & DNS_FLAG.RA) !== 0,
    opcode: (f >>> 11) & 0x0f,
    rcode: f & 0x0f,
  };
  let pos = 12;
  const questions: DnsQuestion[] = [];
  for (let i = 0; i < header.qdcount; i++) {
    const { name, end } = readName(buf, pos);
    questions.push({ name, type: u16(buf, end), cls: u16(buf, end + 2) });
    pos = end + 4;
  }
  const readSection = (count: number): ParsedDnsRecord[] => {
    const records: ParsedDnsRecord[] = [];
    for (let i = 0; i < count; i++) {
      const { name, end } = readName(buf, pos);
      const type = u16(buf, end);
      const cls = u16(buf, end + 2);
      const ttl = u32(buf, end + 4);
      const len = u16(buf, end + 8);
      const start = end + 10;
      if (start + len > buf.length) throw new Error('rdata runs past end of packet');
      records.push({ name, type, cls, ttl, rdata: buf.slice(start, start + len), data: decodeRdata(buf, type, start, len) });
      pos = start + len;
    }
    return records;
  };
  const answers = readSection(header.ancount);
  const authority = readSection(header.nscount);
  const additional = readSection(header.arcount);
  return { header, flags, questions, answers, authority, additional };
}
