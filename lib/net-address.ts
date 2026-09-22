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
 *    route to an internal service, so can the scanner.
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
const inBlock = (addr: number, base: string, bits: number) =>
  bits === 0 || (addr >>> (32 - bits)) === (v4(base) >>> (32 - bits));

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
 * True only for an address the scanner may fetch: canonical, and public
 * unicast. Everything else — unparseable, private, reserved, multicast, a
 * tunnel prefix carrying an arbitrary inner address — is false.
 */
export function isPublicUnicastAddress(address: string): boolean {
  const s = address.trim().replace(/\.+$/, '');
  if (!s) return false;

  const n4 = parseIPv4(s);
  if (n4 !== null) return !V4_SPECIAL.some(([b, bits]) => inBlock(n4, b, bits));

  const g = parseIPv6(s);
  if (g === null) return false;

  // An IPv4-mapped or IPv4-compatible address is an IPv4 address wearing a
  // hat. Judge the address it carries, by the IPv4 rules, rather than letting
  // the 2000::/3 test below decide on a v6 form of 127.0.0.1.
  if (v6InBlock(g, [0, 0, 0, 0, 0, 0xffff], 96) || v6InBlock(g, [0, 0, 0, 0, 0, 0], 96)) {
    const inner = (((g[6] << 16) >>> 0) | g[7]) >>> 0;
    return !V4_SPECIAL.some(([b, bits]) => inBlock(inner, b, bits));
  }

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
