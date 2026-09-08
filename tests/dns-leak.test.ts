/**
 * lib/dns-leak — the pure logic behind the DNS Leak Test.
 *
 * Covers: test-id generation/validation, hostname generation, id extraction
 * from query names, DNS wire format (a real query packet → the exact response
 * bytes), the authoritative answer policy, IPv4/IPv6 prefix helpers,
 * observation summarising, and the leak classification table.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPRESSION_POINTER_QNAME,
  DNS_RCODE,
  DNS_TYPE,
  TEST_ID_RE,
  answerAuthoritatively,
  buildAResponse,
  buildDnsQuery,
  buildHostnames,
  classifyDnsLeak,
  expandIPv6,
  extractTestId,
  generateTestId,
  ipv4Prefix,
  ipv6Prefix,
  isInZone,
  isValidTestId,
  networkOf,
  parseDnsQuery,
  parseDnsResponse,
  parseObservation,
  readName,
  sameIspRange,
  summarizeObservations,
  type ResolverSummary,
  type SoaFields,
} from '../lib/dns-leak';

const ZONE = 'dnsleak.example.com';
const ID = 'abcdefghijkl';

function u16(buf: Uint8Array, off: number): number {
  return (buf[off] << 8) | buf[off + 1];
}
function u32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}
function resolver(ip: string, count = 6): ResolverSummary {
  return { ip, count, firstSeen: 1_700_000_000_000, network: networkOf(ip) ?? ip };
}

describe('test ids', () => {
  it('generates 12 chars of [a-z0-9] that validate', () => {
    const id = generateTestId();
    expect(id).toHaveLength(12);
    expect(id).toMatch(TEST_ID_RE);
    expect(isValidTestId(id)).toBe(true);
    expect(generateTestId()).not.toBe(id);
  });

  it('rejects anything that is not exactly 12 lower-case alphanumerics', () => {
    expect(isValidTestId('ABCDEFGHIJKL')).toBe(false);
    expect(isValidTestId('abcdefghijk')).toBe(false);
    expect(isValidTestId('abcdefghijklm')).toBe(false);
    expect(isValidTestId('abcdefghijk-')).toBe(false);
    expect(isValidTestId('abcdefghijk.')).toBe(false);
    expect(isValidTestId(123456789012)).toBe(false);
    expect(isValidTestId(null)).toBe(false);
  });

  it('maps injected random bytes onto the alphabet and rejects bytes >= 252 (no modulo bias)', () => {
    const rng = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 255 : i));
    // byte 0 (255) is rejected; bytes 1..12 → alphabet[1..12] = b..m
    expect(generateTestId(rng)).toBe('bcdefghijklm');
  });
});

describe('hostnames and id extraction', () => {
  it('builds <n>.<id>.<zone> for n = 1..count', () => {
    const hosts = buildHostnames(ID, ZONE, 6);
    expect(hosts).toHaveLength(6);
    expect(hosts[0]).toBe(`1.${ID}.${ZONE}`);
    expect(hosts[5]).toBe(`6.${ID}.${ZONE}`);
    expect(new Set(hosts).size).toBe(6);
    expect(() => buildHostnames('bad id', ZONE)).toThrow();
  });

  it('extracts the id from the label before the zone, ignoring case and trailing dot', () => {
    expect(extractTestId(`3.${ID}.${ZONE}`, ZONE)).toBe(ID);
    expect(extractTestId(`3.AbCdEfGhIjKl.DNSLEAK.Example.COM.`, ZONE)).toBe(ID);
    expect(extractTestId(ZONE, ZONE)).toBeNull();
    expect(extractTestId(`ns1.${ZONE}`, ZONE)).toBeNull();
    expect(extractTestId(`1.${ID}.other.example.com`, ZONE)).toBeNull();
    expect(extractTestId(`1.${ID}.notdnsleak.example.com`, ZONE)).toBeNull();
  });

  it('isInZone matches the apex and children only', () => {
    expect(isInZone(ZONE, ZONE)).toBe(true);
    expect(isInZone(`x.${ZONE}.`, ZONE)).toBe(true);
    expect(isInZone(`xdnsleak.example.com`, ZONE)).toBe(false);
    expect(isInZone('example.com', ZONE)).toBe(false);
  });
});

describe('DNS wire format', () => {
  it('answers a real A query with the exact expected bytes', () => {
    const qname = `1.${ID}.${ZONE}`;
    const query = buildDnsQuery(qname, DNS_TYPE.A, 0x1234, true);
    const parsed = parseDnsQuery(query);
    expect(parsed).not.toBeNull();
    expect(parsed!.question).toEqual({ name: qname, type: DNS_TYPE.A, cls: 1 });
    expect(parsed!.questionEnd).toBe(query.length);

    const res = buildAResponse(parsed!, '203.0.113.10', 1);

    // Header: id echoed; QR + AA set, RD copied, RA clear, RCODE 0.
    expect(u16(res, 0)).toBe(0x1234);
    const flags = u16(res, 2);
    expect(flags & 0x8000).toBe(0x8000);
    expect(flags & 0x0400).toBe(0x0400);
    expect(flags & 0x0100).toBe(0x0100);
    expect(flags & 0x0080).toBe(0);
    expect(flags & 0x000f).toBe(0);
    expect(u16(res, 4)).toBe(1); // QDCOUNT
    expect(u16(res, 6)).toBe(1); // ANCOUNT
    expect(u16(res, 8)).toBe(0); // NSCOUNT
    expect(u16(res, 10)).toBe(0); // ARCOUNT

    // Question copied verbatim.
    expect(Array.from(res.subarray(12, parsed!.questionEnd))).toEqual(Array.from(query.subarray(12)));

    // Answer: pointer to the question name, A, IN, TTL 1, RDLENGTH 4, RDATA = IP.
    const a = parsed!.questionEnd;
    expect(u16(res, a)).toBe(COMPRESSION_POINTER_QNAME);
    expect(u16(res, a)).toBe(0xc00c);
    expect(u16(res, a + 2)).toBe(DNS_TYPE.A);
    expect(u16(res, a + 4)).toBe(1);
    expect(u32(res, a + 6)).toBe(1);
    expect(u16(res, a + 10)).toBe(4);
    expect(Array.from(res.subarray(a + 12, a + 16))).toEqual([203, 0, 113, 10]);
    expect(res.length).toBe(a + 16);

    // And the parser decodes it back.
    const back = parseDnsResponse(res);
    expect(back.flags).toMatchObject({ qr: true, aa: true, rd: true, ra: false, rcode: 0 });
    expect(back.answers).toHaveLength(1);
    expect(back.answers[0].name).toBe(qname);
    expect(back.answers[0].data).toBe('203.0.113.10');
    expect(back.answers[0].ttl).toBe(1);
  });

  it('preserves 0x20 case randomisation in the copied question and still extracts the id', () => {
    const mixed = `2.AbCdEfGhIjKl.DnSlEaK.ExAmPlE.cOm`;
    const query = buildDnsQuery(mixed, DNS_TYPE.A, 7);
    const parsed = parseDnsQuery(query)!;
    const res = buildAResponse(parsed, '198.51.100.7', 0);
    expect(Array.from(res.subarray(12, parsed.questionEnd))).toEqual(Array.from(query.subarray(12)));
    expect(parseDnsResponse(res).questions[0].name).toBe(mixed);
    expect(extractTestId(parsed.question.name, ZONE)).toBe(ID);
  });

  it('readName follows a backwards compression pointer and rejects a forward one', () => {
    // "a.b" at 0, then at offset 5: label "c" + pointer to 0 → "c.a.b"
    const packet = Uint8Array.from([1, 0x61, 1, 0x62, 0, 1, 0x63, 0xc0, 0x00]);
    expect(readName(packet, 0)).toEqual({ name: 'a.b', end: 5 });
    expect(readName(packet, 5)).toEqual({ name: 'c.a.b', end: 9 });
    expect(() => readName(Uint8Array.from([0xc0, 0x05, 0, 0, 0, 0]), 0)).toThrow();
  });

  it('parseDnsQuery rejects truncated packets and responses', () => {
    expect(parseDnsQuery(Uint8Array.from([0, 1, 1, 0]))).toBeNull();
    const response = buildAResponse(parseDnsQuery(buildDnsQuery(ZONE))!, '203.0.113.10');
    expect(parseDnsQuery(response)).toBeNull();
    const noQuestion = buildDnsQuery(ZONE);
    noQuestion[5] = 0; // QDCOUNT = 0
    expect(parseDnsQuery(noQuestion)).toBeNull();
  });

  it('answerAuthoritatively: A in-zone (with id), NS + glue and SOA at the apex, NODATA for AAAA, REFUSED outside', () => {
    const cfg = { zone: ZONE, answerIp: '203.0.113.10', nsHost: `ns1.${ZONE}`, ttl: 1 };

    const a = answerAuthoritatively(parseDnsQuery(buildDnsQuery(`4.${ID}.${ZONE}`, DNS_TYPE.A))!, cfg);
    expect(a.inZone).toBe(true);
    expect(a.testId).toBe(ID);
    expect(parseDnsResponse(a.response).answers[0].data).toBe('203.0.113.10');

    const ns = answerAuthoritatively(parseDnsQuery(buildDnsQuery(ZONE, DNS_TYPE.NS))!, cfg);
    const nsParsed = parseDnsResponse(ns.response);
    expect(ns.testId).toBeNull();
    expect(nsParsed.answers[0].type).toBe(DNS_TYPE.NS);
    expect(nsParsed.answers[0].data).toBe(`ns1.${ZONE}`);
    expect(nsParsed.additional[0]).toMatchObject({ name: `ns1.${ZONE}`, type: DNS_TYPE.A, data: '203.0.113.10' });

    const soa = answerAuthoritatively(parseDnsQuery(buildDnsQuery(ZONE, DNS_TYPE.SOA))!, cfg);
    const soaData = parseDnsResponse(soa.response).answers[0].data as SoaFields;
    expect(soaData.mname).toBe(`ns1.${ZONE}`);
    expect(soaData.rname).toBe(`hostmaster.${ZONE}`);
    expect(soaData.minimum).toBe(1);

    const aaaa = answerAuthoritatively(parseDnsQuery(buildDnsQuery(`4.${ID}.${ZONE}`, DNS_TYPE.AAAA))!, cfg);
    const aaaaParsed = parseDnsResponse(aaaa.response);
    expect(aaaa.testId).toBe(ID); // still recorded — the lookup happened
    expect(aaaaParsed.flags.rcode).toBe(DNS_RCODE.NOERROR);
    expect(aaaaParsed.answers).toHaveLength(0);
    expect(aaaaParsed.authority[0].type).toBe(DNS_TYPE.SOA);

    const nsHostA = answerAuthoritatively(parseDnsQuery(buildDnsQuery(`ns1.${ZONE}`, DNS_TYPE.A))!, cfg);
    expect(nsHostA.testId).toBeNull();
    expect(parseDnsResponse(nsHostA.response).answers[0].data).toBe('203.0.113.10');

    const outside = answerAuthoritatively(parseDnsQuery(buildDnsQuery('www.google.com', DNS_TYPE.A))!, cfg);
    const outsideParsed = parseDnsResponse(outside.response);
    expect(outside.inZone).toBe(false);
    expect(outside.testId).toBeNull();
    expect(outsideParsed.flags.rcode).toBe(DNS_RCODE.REFUSED);
    expect(outsideParsed.flags.aa).toBe(false);
    expect(outsideParsed.answers).toHaveLength(0);
  });
});

describe('network prefix helpers', () => {
  it('IPv4 /24 and /16', () => {
    expect(ipv4Prefix('73.12.5.9', 24)).toBe('73.12.5.0/24');
    expect(ipv4Prefix('73.12.5.9', 16)).toBe('73.12.0.0/16');
    expect(ipv4Prefix('255.255.255.255', 8)).toBe('255.0.0.0/8');
    expect(ipv4Prefix('999.1.1.1', 24)).toBeNull();
    expect(ipv4Prefix('1.2.3', 24)).toBeNull();
  });

  it('IPv6 /64 and /32, with :: expansion and IPv4-mapped input', () => {
    expect(ipv6Prefix('2001:db8:1:2:3:4:5:6', 64)).toBe('2001:db8:1:2::/64');
    expect(ipv6Prefix('2001:0db8::1', 32)).toBe('2001:db8::/32');
    expect(ipv6Prefix('2001:db8::1', 64)).toBe('2001:db8:0:0::/64');
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(expandIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('1:2:3')).toBeNull();
    expect(expandIPv6('1::2::3')).toBeNull();
    expect(ipv6Prefix('2001:db8::1', 65)).toBeNull();
  });

  it('networkOf / sameIspRange', () => {
    expect(networkOf('8.8.8.8')).toBe('8.8.8.0/24');
    expect(networkOf('2001:4860:4860::8888')).toBe('2001:4860:4860:0::/64');
    expect(networkOf('not-an-ip')).toBeNull();
    expect(sameIspRange('73.12.5.9', '73.12.200.1')).toBe(true);
    expect(sameIspRange('73.12.5.9', '73.13.0.1')).toBe(false);
    expect(sameIspRange('73.12.5.9', '2001:db8::1')).toBe(false);
    expect(sameIspRange(null, '73.12.5.9')).toBe(false);
  });
});

describe('observations', () => {
  it('parses nameserver entries, dropping malformed ones', () => {
    expect(parseObservation('{"resolverIp":"8.8.8.8","ts":5,"qname":"1.x.z"}')).toEqual({ resolverIp: '8.8.8.8', ts: 5, qname: '1.x.z' });
    expect(parseObservation('{"resolverIp":"nope"}')).toBeNull();
    expect(parseObservation('not json')).toBeNull();
  });

  it('summarises per resolver IP, oldest first, never echoing qnames', () => {
    const summary = summarizeObservations([
      { resolverIp: '8.8.4.4', ts: 300, qname: '1.a.z' },
      { resolverIp: '8.8.8.8', ts: 100, qname: '2.a.z' },
      { resolverIp: '8.8.8.8', ts: 200, qname: '3.a.z' },
    ]);
    expect(summary).toEqual([
      { ip: '8.8.8.8', firstSeen: 100, count: 2, network: '8.8.8.0/24' },
      { ip: '8.8.4.4', firstSeen: 300, count: 1, network: '8.8.4.0/24' },
    ]);
    expect(JSON.stringify(summary)).not.toContain('qname');
  });
});

describe('classifyDnsLeak', () => {
  const VPN_EXIT = '185.220.101.7';
  const ISP_IP = '73.12.5.9';

  it('no observations is never green: inconclusive with the backend reason', () => {
    const none = classifyDnsLeak({ publicIp: VPN_EXIT, resolvers: [], vpnOn: true, storage: 'none' });
    expect(none.severity).toBe('amber');
    expect(none.verdict).toBe('inconclusive');
    expect(none.reason).toBe('no-backend');
    expect(none.headline).toMatch(/not configured on this deployment/);

    const empty = classifyDnsLeak({ publicIp: VPN_EXIT, resolvers: [], vpnOn: true, storage: 'redis' });
    expect(empty.severity).toBe('amber');
    expect(empty.reason).toBe('no-observations');
    expect(empty.headline).toMatch(/no DNS query reached our nameserver/);
    expect(empty.detail).toMatch(/delegated|wildcard/);

    const emptyOff = classifyDnsLeak({ publicIp: ISP_IP, resolvers: [], vpnOn: false, storage: 'redis' });
    expect(emptyOff.severity).not.toBe('green');
  });

  it('VPN off is a baseline (info), naming the resolver network without any ISP name', () => {
    const c = classifyDnsLeak({ publicIp: ISP_IP, resolvers: [resolver('68.87.85.98')], vpnOn: false, storage: 'redis' });
    expect(c.severity).toBe('info');
    expect(c.verdict).toBe('baseline');
    expect(c.reason).toBe('vpn-off');
    expect(c.headline).toBe('With your VPN off, your DNS requests are answered by 1 resolver on network 68.87.0.0/16');
    expect(c.networks).toEqual(['68.87.0.0/16']);
  });

  it('VPN on, one resolver on the same /16 as the public (VPN exit) IP → green (DNS rides the tunnel)', () => {
    const c = classifyDnsLeak({ publicIp: VPN_EXIT, resolvers: [resolver('185.220.101.7')], vpnOn: true, storage: 'redis' });
    expect(c.severity).toBe('green');
    expect(c.verdict).toBe('no-leak');
    expect(c.reason).toBe('vpn-network');
    expect(c.headline).toMatch(/1 resolver on network 185\.220\.0\.0\/16 — the same network as your VPN exit IP/);
  });

  it('VPN on, one resolver on a different /16 from the public IP, no baseline → amber (cannot tell VPN from ISP)', () => {
    const c = classifyDnsLeak({ publicIp: VPN_EXIT, resolvers: [resolver('68.87.85.98')], vpnOn: true, storage: 'redis' });
    expect(c.severity).toBe('amber');
    expect(c.reason).toBe('needs-baseline');
    expect(c.headline).toMatch(/a different network from your VPN exit IP/);
  });

  it('VPN on, one resolver on a different /16 from the public IP that is NOT the ISP baseline → green', () => {
    const c = classifyDnsLeak({
      publicIp: VPN_EXIT,
      resolvers: [resolver('172.71.1.5')],
      vpnOn: true,
      storage: 'redis',
      baseline: { publicIp: ISP_IP, resolverIps: ['68.87.85.98'] },
    });
    expect(c.severity).toBe('green');
    expect(c.reason).toBe('outside-isp-baseline');
    expect(c.headline).toMatch(/not on your ISP’s resolver network/);
  });

  it('VPN on, resolver on the ISP baseline /16 (the public IP seen with the VPN off) → red', () => {
    const c = classifyDnsLeak({
      publicIp: VPN_EXIT,
      resolvers: [resolver('73.12.200.53'), resolver('73.12.200.54')],
      vpnOn: true,
      storage: 'redis',
      baseline: { publicIp: ISP_IP, resolverIps: [] },
    });
    expect(c.severity).toBe('red');
    expect(c.verdict).toBe('leak');
    expect(c.reason).toBe('matches-isp-baseline');
    expect(c.headline).toBe('Your DNS requests are answered by 2 resolvers on network 73.12.0.0/16 — the same network as when your VPN was off');
    expect(c.headline).not.toMatch(/comcast/i);
  });

  it('VPN on, resolver matching a baseline RESOLVER network (not the baseline IP) → red', () => {
    const c = classifyDnsLeak({
      publicIp: VPN_EXIT,
      resolvers: [resolver('68.87.85.98')],
      vpnOn: true,
      storage: 'redis',
      baseline: { publicIp: ISP_IP, resolverIps: ['68.87.64.1'] },
    });
    expect(c.severity).toBe('red');
    expect(c.reason).toBe('matches-isp-baseline');
  });

  it('VPN on, multiple distinct resolver networks → red', () => {
    const c = classifyDnsLeak({
      publicIp: VPN_EXIT,
      resolvers: [resolver('185.220.101.7'), resolver('68.87.85.98')],
      vpnOn: true,
      storage: 'redis',
    });
    expect(c.severity).toBe('red');
    expect(c.verdict).toBe('leak');
    expect(c.reason).toBe('multiple-networks');
    expect(c.headline).toBe('Your DNS requests are answered by 2 resolvers on 2 different networks (185.220.0.0/16, 68.87.0.0/16) while your VPN is on');
    expect(c.networks).toEqual(['185.220.0.0/16', '68.87.0.0/16']);
  });

  it('VPN on, multiple networks but a baseline proves none is the ISP → amber, not red', () => {
    const c = classifyDnsLeak({
      publicIp: VPN_EXIT,
      resolvers: [resolver('74.125.1.1'), resolver('172.253.2.2')],
      vpnOn: true,
      storage: 'redis',
      baseline: { publicIp: ISP_IP, resolverIps: ['68.87.85.98'] },
    });
    expect(c.severity).toBe('amber');
    expect(c.reason).toBe('multiple-networks-unmatched');
  });

  it('works for IPv6 resolvers using /32 as the operator range', () => {
    const c = classifyDnsLeak({
      publicIp: '2a03:1b20:4:f011::a05f',
      resolvers: [resolver('2a03:1b20:9:ffff::1')],
      vpnOn: true,
      storage: 'redis',
    });
    expect(c.severity).toBe('green');
    expect(c.networks).toEqual(['2a03:1b20::/32']);
  });
});
