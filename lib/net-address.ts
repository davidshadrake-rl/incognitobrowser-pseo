/**
 * Is this address one the scanner is allowed to fetch? Default: no.
 *
 * ## Why this replaces a denylist
 *
 * isBlockedHostname() in lib/scanner.ts answers the opposite question — "is
 * this address on my list of bad ones?" — and returns false when it does not
 * recognise something. Four bypasses were found against it in one week, all
 * the same shape: a form the regexes did not anticipate, therefore allowed.
 * `::ffff:7f00:1`, `localhost.`, hex-mapped IPv4, single-label names. Each fix
 * added one more regex, which is a game with no last move.
 *
 * This function inverts the default. An address is refused unless it parses
 * canonically AND lands in public unicast space. A form nobody anticipated is
 * now refused rather than allowed, which is the only difference that matters.
 *
 * ## What this does NOT fix — read before trusting it
 *
 * Two things, and neither is a code problem:
 *
 * 1. **Internal services on public IPs.** A corporate host at 52.94.236.10 is
 *    public unicast and this function allows it, correctly — a URL scanner
 *    that refused public addresses would not be a URL scanner. If the box can
 *    route to an internal service, so can the scanner. The only thing that
 *    can refuse such a host is BLOCKED_TARGET_HOSTS, and the estate that host
 *    sits in is a RANGE — so the knob takes CIDRs, and matchesBlockedTarget()
 *    at the bottom of this file is the one place they are judged. The kernel
 *    policy cannot help here: scripts/droplet-egress-lockdown.sh only denies
 *    private space.
 *
 * 2. **DNS rebinding.** The route resolves a name, judges the addresses, then
 *    calls fetch(), which resolves the name AGAIN. A name that answers
 *    publicly on the first query and privately on the second walks past
 *    anything decided here, because what was judged is not what gets
 *    connected to.
 *
 * Both are closed at the network layer, not in TypeScript: deny the ib-api
 * uid's egress to internal ranges, and neither the parser nor the TOCTOU
 * matters. See API-ON-DROPLET.md. Treat this function as defence in depth
 * behind that, never as the control itself.
 */
import { BLOCKED_TARGET_HOSTS } from './tuning';

/** Exactly four dotted decimal octets, no leading zeros, each 0-255. */
function parseIPv4(s: string): number | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    // Leading zeros are rejected rather than interpreted: "0177.0.0.1" means
    // one thing to a C resolver and another to a JS parseInt, and an address
    // two readers disagree about is not one to make a security decision on.
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

const v4 = (s: string) => parseIPv4(s)!;
/** Is `addr` inside base/bits? Both are 32-bit unsigned; /0 is everything. */
const inBlock = (addr: number, base: number, bits: number) =>
  bits === 0 || (addr >>> (32 - bits)) === (base >>> (32 - bits));

/**
 * IANA IPv4 Special-Purpose Address Registry, in full. Anything matching one
 * of these is not public unicast.
 */
const V4_SPECIAL: Array<[string, number]> = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // RFC 1918
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, and the cloud metadata address
  ['172.16.0.0', 12],    // RFC 1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.31.196.0', 24],  // AS112-v4
  ['192.52.193.0', 24],  // AMT
  ['192.88.99.0', 24],   // 6to4 relay anycast
  ['192.168.0.0', 16],   // RFC 1918
  ['192.175.48.0', 24],  // direct delegation AS112
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, and 255.255.255.255 with it
];

/** Expand an IPv6 address to exactly 8 groups, or null if it is not one. */
function parseIPv6(s: string): number[] | null {
  let str = s.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (str.includes('%')) str = str.slice(0, str.indexOf('%')); // drop a zone id
  // A trailing IPv4 part (::ffff:127.0.0.1) becomes two groups.
  const v4tail = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(str);
  if (v4tail) {
    const n = parseIPv4(v4tail[1]);
    if (n === null) return null;
    str = str.slice(0, v4tail.index + 1) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string) => {
    if (part === '') return [];
    const gs = part.split(':');
    const out: number[] = [];
    for (const g of gs) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]);
  if (tail === null) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null; // "::" must stand for at least one zero group
  return [...head, ...Array(fill).fill(0), ...tail];
}

const v6InBlock = (g: number[], prefix: number[], bits: number) => {
  for (let i = 0; i < Math.floor(bits / 16); i++) if (g[i] !== (prefix[i] ?? 0)) return false;
  const rem = bits % 16;
  if (rem) {
    const i = Math.floor(bits / 16);
    const mask = (0xffff << (16 - rem)) & 0xffff;
    if ((g[i] & mask) !== ((prefix[i] ?? 0) & mask)) return false;
  }
  return true;
};

/**
 * The IPv4 address an IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible
 * (::a.b.c.d) IPv6 address carries, or null when it carries none. Such an
 * address is an IPv4 address wearing a hat, and every judgement in this file
 * judges the address under the hat by the IPv4 rules.
 */
function embeddedIPv4(g: number[]): number | null {
  if (v6InBlock(g, [0, 0, 0, 0, 0, 0xffff], 96) || v6InBlock(g, [0, 0, 0, 0, 0, 0], 96)) {
    return (((g[6] << 16) >>> 0) | g[7]) >>> 0;
  }
  return null;
}

/**
 * True only for an address the scanner may fetch: canonical, and public
 * unicast. Everything else — unparseable, private, reserved, multicast, a
 * tunnel prefix carrying an arbitrary inner address — is false.
 */
export function isPublicUnicastAddress(address: string): boolean {
  const s = address.trim().replace(/\.+$/, '');
  if (!s) return false;

  const n4 = parseIPv4(s);
  if (n4 !== null) return !V4_SPECIAL.some(([b, bits]) => inBlock(n4, v4(b), bits));

  const g = parseIPv6(s);
  if (g === null) return false;

  // An IPv4-mapped or IPv4-compatible address is an IPv4 address wearing a
  // hat. Judge the address it carries, by the IPv4 rules, rather than letting
  // the 2000::/3 test below decide on a v6 form of 127.0.0.1.
  const inner = embeddedIPv4(g);
  if (inner !== null) return !V4_SPECIAL.some(([b, bits]) => inBlock(inner, v4(b), bits));

  // Global unicast is 2000::/3 and nothing else. This is the allowlist: every
  // other IPv6 block — loopback, unique-local, link-local, multicast,
  // discard, NAT64 — is outside it and refused without being enumerated.
  if (!v6InBlock(g, [0x2000], 3)) return false;

  // Inside 2000::/3, the tunnel and documentation prefixes still have to go.
  // 6to4 and Teredo each embed an arbitrary IPv4 address, private ones
  // included, which is the whole reason 2002:: was on the old denylist —
  // Teredo was not, and that inconsistency is what an enumeration produces.
  const inside: Array<[number[], number]> = [
    [[0x2001, 0x0000], 32],  // Teredo
    [[0x2001, 0x0db8], 32],  // documentation
    [[0x2002], 16],          // 6to4
  ];
  return !inside.some(([p, bits]) => v6InBlock(g, p, bits));
}

// ---------------------------------------------------------------------------
// BLOCKED_TARGET_HOSTS — the operator's own denylist, with ranges
// ---------------------------------------------------------------------------

/**
 * BLOCKED_TARGET_HOSTS, compiled. Hostnames are matched as text; addresses
 * are matched by block, and a bare address is just a /32 or /128 block, so
 * "one host" and "an estate" go through the same comparison.
 */
export interface BlockedTargets {
  readonly hostnames: ReadonlySet<string>;
  readonly v4: ReadonlyArray<readonly [base: number, bits: number]>;
  readonly v6: ReadonlyArray<readonly [prefix: number[], bits: number]>;
  /** Every entry that was refused, verbatim, so a caller can see what the warning named. */
  readonly rejected: ReadonlyArray<string>;
}

const HOSTNAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const PREFIX_LENGTH = /^(0|[1-9]\d{0,2})$/;

/**
 * Turn the entries of BLOCKED_TARGET_HOSTS into something matchesBlockedTarget
 * can judge against. Accepted forms, one per comma-separated entry:
 *
 *   206.189.186.34          an IPv4 address (a /32)
 *   20.30.40.0/24           an IPv4 range; host bits are masked off, so
 *                           20.30.40.50/24 names the same range
 *   2001:db8:aa::1          an IPv6 address (a /128), brackets optional
 *   2001:db8:aa::/48        an IPv6 range
 *   intranet.corp.example   a hostname, matched exactly (no suffix match)
 *
 * Anything else is dropped and reported with console.warn. Loud, for the same
 * reason intEnv's fallback is loud: the failure mode of a typo here is that a
 * corp range the operator believes is refused is quietly fetched, and nothing
 * in the request path would ever say so. A malformed entry is dropped on its
 * own; the rest of the list still holds. It is NOT reinterpreted as a
 * hostname, which is what a naive split would do with "20.30.40.0/33" — an
 * entry that matches nothing at all while looking configured.
 */
export function compileBlockedTargets(entries: Iterable<string>): BlockedTargets {
  const hostnames = new Set<string>();
  const v4: Array<readonly [number, number]> = [];
  const v6: Array<readonly [number[], number]> = [];
  const rejected: string[] = [];
  const reject = (entry: string, why: string) => {
    rejected.push(entry);
    console.warn(`[tuning] BLOCKED_TARGET_HOSTS entry ${JSON.stringify(entry)} ignored: ${why}`);
  };

  for (const raw of entries) {
    const s = raw.trim().toLowerCase().replace(/\.+$/, '');
    if (!s) continue;

    const slash = s.lastIndexOf('/');
    if (slash !== -1) {
      const prefix = s.slice(0, slash);
      const bitsText = s.slice(slash + 1);
      const bits = PREFIX_LENGTH.test(bitsText) ? Number(bitsText) : NaN;
      const n4 = parseIPv4(prefix);
      if (n4 !== null) {
        if (bits >= 0 && bits <= 32) { v4.push([n4, bits]); continue; }
        reject(raw, `an IPv4 prefix length must be 0-32, not ${JSON.stringify(bitsText)}`);
        continue;
      }
      const g = parseIPv6(prefix);
      if (g !== null) {
        if (bits >= 0 && bits <= 128) { v6.push([g, bits]); continue; }
        reject(raw, `an IPv6 prefix length must be 0-128, not ${JSON.stringify(bitsText)}`);
        continue;
      }
      reject(raw, 'not a.b.c.d/nn or an IPv6 prefix/nn');
      continue;
    }

    const n4 = parseIPv4(s);
    if (n4 !== null) { v4.push([n4, 32]); continue; }
    if (/^[\d.]+$/.test(s)) {
      // All digits and dots but not four canonical octets: 20.30.40.256,
      // 020.30.40.50, 20.30.40. None of these can ever equal a resolved
      // address, so as a "hostname" it would be a dead entry.
      reject(raw, 'not a canonical IPv4 address (four decimal octets, no leading zeros)');
      continue;
    }
    if (s.includes(':') || s.startsWith('[')) {
      const g = parseIPv6(s);
      if (g !== null) { v6.push([g, 128]); continue; }
      reject(raw, 'not an IPv6 address');
      continue;
    }
    if (!HOSTNAME.test(s)) {
      reject(raw, 'not a hostname');
      continue;
    }
    hostnames.add(s);
  }
  return { hostnames, v4, v6, rejected };
}

// Compiled once, at module load, from the knob in lib/tuning.ts — so a bad
// entry is reported when the route module loads, not on the first scan that
// would have needed it. lib/tuning.ts imports nothing, so there is no cycle.
const DEFAULT_BLOCKED_TARGETS: BlockedTargets = compileBlockedTargets(BLOCKED_TARGET_HOSTS);

/**
 * Is this hostname or address one the operator has refused outright?
 *
 * Used at BOTH legs of the scan route: on the hostname text before the
 * resolver is asked, and on every address the resolver returns. Missing
 * either one reopens the half it guards: without the address leg any
 * third-party name that points into the range is fetched; without the text
 * leg a listed name is resolved (and a listed address literal is judged only
 * by what the resolver echoes back). A hostname matches exactly. An address
 * matches if any configured block contains it, judged by the same canonical
 * parsers the public-unicast allowlist uses — so an IPv4-mapped IPv6 answer
 * carrying a blocked IPv4 is blocked too, and a spelling those parsers refuse
 * matches nothing (isPublicUnicastAddress refuses it upstream anyway).
 */
export function matchesBlockedTarget(
  addressOrHost: string,
  targets: BlockedTargets = DEFAULT_BLOCKED_TARGETS,
): boolean {
  const s = addressOrHost.trim().toLowerCase().replace(/\.+$/, '');
  if (!s) return false;
  if (targets.hostnames.has(s)) return true;

  const n4 = parseIPv4(s);
  if (n4 !== null) return targets.v4.some(([base, bits]) => inBlock(n4, base, bits));

  const g = parseIPv6(s);
  if (g === null) return false;
  const inner = embeddedIPv4(g);
  if (inner !== null && targets.v4.some(([base, bits]) => inBlock(inner, base, bits))) return true;
  return targets.v6.some(([prefix, bits]) => v6InBlock(g, prefix, bits));
}
