/**
 * Result rules for the IP, browser-privacy, permission and URL engines
 * (CTO review, 2026-09-10: "weird ui ... pretty unclear what is supposed to
 * happen"). Each block pins the rule that the unclear screen broke:
 *
 *   - What's My IP: the red WebRTC card and the verdict now share one leak
 *     rule, IPv4 compared with IPv4 and IPv6 with IPv6, and the server's
 *     `::ffff:a.b.c.d` is stored once, as the IPv4 address it is.
 *   - Browser Privacy Audit: a public STUN address is information, not a fail,
 *     and the advertised check count comes from the rows that render.
 *   - Permission Checker: "asks first" is neutral, browser-default grants do
 *     not turn the result amber, and the header agrees with the rows.
 *   - URL Safety Checker: "Passes" counts checks that found nothing; the
 *     structural-only caveat is a note, never a finding, and it applies to
 *     any untrusted link without a fail or warning, so a minor finding never
 *     turns "Not verified" into "Pass".
 *
 * Pure functions only — no DOM, same pattern as tests/dns-leak.test.ts.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compareWebRtcToServer, ipInfoFromLookup, unmatchedNote } from '../components/tools/WhatsMyIpTool';
import { BROWSER_PRIVACY_CHECKS, webrtcCheck } from '../components/tools/BrowserPrivacyTool';
import {
  PERMISSIONS_TO_CHECK,
  summarizePermissions,
  type PermissionResult,
} from '../components/tools/PermissionCheckerTool';
import { analyzeURL, urlVerdict } from '../components/tools/URLAnalyzerTool';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe("What's My IP: one leak rule for the verdict and the WebRTC card", () => {
  it('the same IPv4 the server saw is not a leak', () => {
    const r = compareWebRtcToServer(['203.0.113.7'], { ipv4: '203.0.113.7' });
    expect(r).toEqual({ leaked: [], same: ['203.0.113.7'], sameNetwork: [], unmatched: [], seenVersion: 'v4' });
  });

  it('a different IPv4 from the one the server saw is a leak', () => {
    const r = compareWebRtcToServer(['198.51.100.20'], { ipv4: '203.0.113.7' });
    expect(r.leaked).toEqual(['198.51.100.20']);
  });

  it('a neighbouring IPv4 in the same /24 is the same network, not a leak (carrier NAT pools)', () => {
    // Inside the Incognito Browser app on a mobile network (2026-09-10): the
    // STUN request left from .17, the page request from .42, and the page said
    // "Leaking" with no VPN anywhere.
    const r = compareWebRtcToServer(['203.0.113.17'], { ipv4: '203.0.113.42' });
    expect(r.leaked).toEqual([]);
    expect(r.sameNetwork).toEqual(['203.0.113.17']);
    // One octet further out is another network, and still a leak.
    expect(compareWebRtcToServer(['203.0.114.17'], { ipv4: '203.0.113.42' }).leaked).toEqual(['203.0.114.17']);
  });

  it('dual-stack without a VPN: an IPv4 from WebRTC is not compared with the IPv6 the server saw', () => {
    // The server records one version per request; before this rule, the
    // other version was flagged "WebRTC leaks your real IP around your VPN".
    const r = compareWebRtcToServer(['203.0.113.7', '2001:db8:1:2::abcd'], { ipv6: '2001:db8:1:2::1' });
    expect(r.leaked).toEqual([]);
    expect(r.unmatched).toEqual(['203.0.113.7']);
    expect(r.same).toEqual(['2001:db8:1:2::abcd']);
  });

  it('IPv6 on the same /64 counts as the same address (privacy extensions rotate the host half)', () => {
    const r = compareWebRtcToServer(['2001:db8:aa:bb:1111:2222:3333:4444'], { ipv6: '2001:db8:aa:bb::9' });
    expect(r.same).toHaveLength(1);
    expect(r.leaked).toEqual([]);
  });

  it('IPv6 on a different network from the one the server saw is a leak', () => {
    const r = compareWebRtcToServer(['2001:db8:ffff:1::5'], { ipv6: '2001:db8:aa:bb::9' });
    expect(r.leaked).toEqual(['2001:db8:ffff:1::5']);
  });

  it('an IPv4-mapped server address is compared as IPv4', () => {
    const r = compareWebRtcToServer(['203.0.113.7'], { ipv6: '::ffff:203.0.113.7' });
    expect(r.same).toEqual(['203.0.113.7']);
    expect(r.leaked).toEqual([]);
  });

  it('local dev (loopback placeholder) compares nothing, so nothing is a leak', () => {
    const r = compareWebRtcToServer(['203.0.113.7'], { ipv4: '127.0.0.1', isLocal: true });
    expect(r.leaked).toEqual([]);
    expect(r.unmatched).toEqual(['203.0.113.7']);
    expect(r.seenVersion).toBeNull();
    expect(unmatchedNote(r, true)).toMatch(/running locally/);
  });

  it('the unmatched copy names the version the server address was compared as', () => {
    // /ip reports a ::ffff: address as 'v6' because it contains ':'. The card
    // used to say "over IPv6 only" for what was an IPv4 connection.
    const mapped = compareWebRtcToServer(['2001:db8::1'], { ipv6: '::ffff:203.0.113.7' });
    expect(mapped.seenVersion).toBe('v4');
    expect(mapped.unmatched).toEqual(['2001:db8::1']);
    expect(unmatchedNote(mapped)).toMatch(/over IPv4 only/);

    const v6 = compareWebRtcToServer(['203.0.113.7'], { ipv6: '2001:db8:1:2::1' });
    expect(v6.seenVersion).toBe('v6');
    expect(unmatchedNote(v6)).toMatch(/over IPv6 only/);
    expect(unmatchedNote(v6)).toMatch(/nothing to compare it with/);
  });

  it('with no server address at all, the copy does not claim a version', () => {
    const r = compareWebRtcToServer(['203.0.113.7', '198.51.100.9'], {});
    expect(r.seenVersion).toBeNull();
    expect(unmatchedNote(r)).not.toMatch(/IPv[46] only/);
    expect(unmatchedNote(r)).toMatch(/nothing to compare them with/);
  });

  describe('the /ip lookup is stored once, normalised', () => {
    const lookup = { local: false, city: null, region: null, country: null, timezone: null };

    it("/ip's ::ffff:a.b.c.d (labelled v6) is stored as the IPv4 address it is", () => {
      // Stored as sent, the hero showed "::ffff:203.0.113.7" labelled IPv6
      // and the leak copy quoted it.
      const info = ipInfoFromLookup({ ...lookup, ip: '::ffff:203.0.113.7', version: 'v6' });
      expect(info).toEqual({ ipv4: '203.0.113.7' });
      // The comparison reads the same address, as IPv4.
      expect(compareWebRtcToServer(['203.0.113.7'], info)).toEqual({ leaked: [], same: ['203.0.113.7'], sameNetwork: [], unmatched: [], seenVersion: 'v4' });
      expect(compareWebRtcToServer(['198.51.100.20'], info).leaked).toEqual(['198.51.100.20']);
    });

    it('a real IPv6 or IPv4 keeps its version, and the location fields come through', () => {
      expect(ipInfoFromLookup({ ...lookup, ip: '2001:db8:1:2::1', version: 'v6' })).toEqual({ ipv6: '2001:db8:1:2::1' });
      expect(ipInfoFromLookup({
        ip: '198.51.100.9', version: 'v4', local: false,
        city: 'Lyon', region: 'ARA', country: 'France', timezone: 'Europe/Paris',
      })).toEqual({ ipv4: '198.51.100.9', city: 'Lyon', region: 'ARA', country: 'France', timezone: 'Europe/Paris' });
    });

    it('local dev keeps the loopback placeholder flagged as local', () => {
      expect(ipInfoFromLookup({ ...lookup, ip: '127.0.0.1', version: 'v4', local: true })).toEqual({ ipv4: '127.0.0.1', isLocal: true });
    });

    it('the page reads its address through that one normaliser', () => {
      const src = read('components/tools/WhatsMyIpTool.tsx');
      const fetcher = src.slice(src.indexOf('async function fetchPublicIpInfo'), src.indexOf('export function WhatsMyIpTool'));
      expect(fetcher).toMatch(/return ipInfoFromLookup\(/);
      expect(fetcher).not.toMatch(/out\.ipv[46] = d\.ip/);
    });
  });

  it('the card drops "No extra address leaks" while an address is still unchecked', () => {
    const src = read('components/tools/WhatsMyIpTool.tsx');
    expect(src).toMatch(/\{unmatched\.length === 0 \? 'No extra address leaks through WebRTC\. ' : ''\}/);
    expect(src).not.toMatch(/around your VPN`/);
  });
});

describe('Browser Privacy Audit', () => {
  it('a public STUN address is information, never a fail', () => {
    const row = webrtcCheck({ publicIPs: ['203.0.113.7'], privateIPs: [] });
    expect(row.status).toBe('info');
    expect(row.detail).toMatch(/not a leak/);
    expect(row.detail).toMatch(/VPN/);
  });

  it('local addresses stay a warning (fingerprinting signal), with or without a public one', () => {
    expect(webrtcCheck({ publicIPs: [], privateIPs: ['192.168.1.4'] }).status).toBe('warning');
    expect(webrtcCheck({ publicIPs: ['203.0.113.7'], privateIPs: ['192.168.1.4'] }).status).toBe('warning');
  });

  it('the row value names what it warns about: the local addresses, not the public IP', () => {
    // It read "Public IP visible" in amber while the detail said the public IP does not count.
    const both = webrtcCheck({ publicIPs: ['203.0.113.7'], privateIPs: ['192.168.1.4'] });
    expect(both.value).toBe('Local IPs visible');
    expect(both.detail).toMatch(/^WebRTC shows local network addresses \(192\.168\.1\.4\)/);
    expect(webrtcCheck({ publicIPs: ['203.0.113.7'], privateIPs: [] }).value).toBe('Public IP visible');
  });

  it('blocked WebRTC and no addresses at all are passes', () => {
    expect(webrtcCheck({ publicIPs: [], privateIPs: [], error: 'unsupported' }).status).toBe('good');
    expect(webrtcCheck({ publicIPs: [], privateIPs: [] }).status).toBe('good');
  });

  it('BROWSER_PRIVACY_CHECKS lists exactly the rows the audit renders, each once', () => {
    // Every `name: '…'` literal in the engine is a rendered row. If a row is
    // added or dropped without the list, the advertised count drifts again.
    const src = read('components/tools/BrowserPrivacyTool.tsx');
    const rendered = [...src.matchAll(/\bname: '([^']+)'/g)].map((m) => m[1]);
    expect([...rendered].sort()).toEqual([...BROWSER_PRIVACY_CHECKS].sort());
    expect(new Set(BROWSER_PRIVACY_CHECKS).size).toBe(BROWSER_PRIVACY_CHECKS.length);
  });

  it('the registry quotes the count from that list, not a typed number', () => {
    const registry = read('components/tools/registry.tsx');
    expect(registry).toMatch(/const BROWSER_PRIVACY_COUNT = BROWSER_PRIVACY_CHECKS\.length;/);
    const block = registry.slice(registry.indexOf("'browser-privacy': {"), registry.indexOf("'text-encryption': {"));
    const countLines = block.split('\n').filter((l) => /^\s+(figure|io|checks):/.test(l));
    expect(countLines).toHaveLength(3);
    for (const line of countLines) {
      expect(line).toMatch(/BROWSER_PRIVACY_COUNT/);
      expect(line).not.toMatch(/\d/);
    }
  });
});

describe('Permission Checker', () => {
  const at = (name: string, state: PermissionResult['state']): PermissionResult => {
    const p = PERMISSIONS_TO_CHECK.find((x) => x.name === name);
    if (!p) throw new Error(`unknown permission ${name}`);
    return { ...p, state };
  };

  // Chrome's out-of-the-box answers on a site the visitor never granted anything.
  const chromeDefaults = (): PermissionResult[] => PERMISSIONS_TO_CHECK.map((p) =>
    ['clipboard-write', 'accelerometer', 'gyroscope', 'magnetometer', 'screen-wake-lock'].includes(p.name)
      ? { ...p, state: 'granted' }
      : { ...p, state: 'prompt' },
  );

  it("a fresh Chrome profile is green: browser-default grants are not the site's permissions", () => {
    const s = summarizePermissions(chromeDefaults());
    expect(s.severity).toBe('green');
    expect(s.allowed).toBe(0);
    expect(s.allowedByDefault).toBe(5);
    expect(s.headline).not.toMatch(/already has/);
  });

  it('a granted camera turns the result amber and says so', () => {
    const results = chromeDefaults().map((r) => (r.name === 'camera' ? at('camera', 'granted') : r));
    const s = summarizePermissions(results);
    expect(s.severity).toBe('amber');
    expect(s.allowed).toBe(1);
    expect(s.headline).toMatch(/already has 1 permission that normally needs your OK/);
  });

  it('the glance stats add up to what was checked', () => {
    const s = summarizePermissions(chromeDefaults());
    const sum = s.stats.reduce((n, x) => n + Number(x.value), 0);
    expect(sum).toBe(s.supported);
  });

  it('a browser that reports nothing is info, never green', () => {
    const s = summarizePermissions(PERMISSIONS_TO_CHECK.map((p) => ({ ...p, state: 'unsupported' as const })));
    expect(s.severity).toBe('info');
    expect(s.supported).toBe(0);
  });
});

describe('URL Safety Checker tally', () => {
  it('Passes counts checks that found nothing', () => {
    const a = analyzeURL('https://example.com/');
    expect(a.risks).toEqual([]);
    expect(a.passed).toBe(a.checks);
    expect(a.checks).toBeGreaterThan(5);
  });

  it('the structural-only caveat is a note, not a finding', () => {
    const a = analyzeURL('https://example.com/');
    expect(a.note).toMatch(/Structural checks only/);
    expect(a.score).toBeLessThanOrEqual(75);
  });

  it('low-severity findings are not counted as passes', () => {
    const a = analyzeURL('https://example.com/p?a=1&b=2&c=3&d=4&e=5&f=6');
    const low = a.risks.filter((r) => r.severity === 'low').length;
    expect(low).toBe(1);
    expect(a.passed).toBe(a.checks - a.risks.length);
  });

  it('the caveat and the 75 cap also apply to an untrusted link with only minor findings', () => {
    // They used to apply only with no findings at all: this link scored 95
    // with no caveat, while the same site with nothing found was held at 75.
    const minor = analyzeURL('https://example.com/p?a=1&b=2&c=3&d=4&e=5&f=6');
    expect(minor.risks.every((r) => r.severity === 'low')).toBe(true);
    expect(minor.note).toMatch(/Structural checks only/);
    expect(minor.score).toBeLessThanOrEqual(75);
    expect(minor.score).toBeLessThanOrEqual(analyzeURL('https://example.com/').score);
  });

  it('a medium or high finding carries no caveat, and a trusted site never does', () => {
    expect(analyzeURL('https://bit.ly/abc').note).toBeUndefined();
    expect(analyzeURL('http://paypa1.com/login').note).toBeUndefined();
    expect(analyzeURL('https://github.com/p?a=1&b=2&c=3&d=4&e=5&f=6').note).toBeUndefined();
  });

  it('a phishing lookalike still fails', () => {
    const a = analyzeURL('http://paypa1.com/login');
    expect(a.risks.filter((r) => r.severity === 'high').length).toBeGreaterThanOrEqual(2);
    expect(a.passed).toBe(a.checks - a.risks.length);
  });
});

describe('URL Safety Checker verdict word', () => {
  // The header word used to follow the score: the 75 cap made a clean link
  // read "Warning" over "Warns 0", and a short link (score 90) read "Pass" over "Warns 1".
  it('a clean link outside the trusted list is "Not verified", never "Warning"', () => {
    const a = analyzeURL('https://example.com/');
    expect(a.risks).toEqual([]);
    expect(urlVerdict(a)).toEqual({ word: 'Not verified', severity: 'amber' });
  });

  it('a medium finding is "Warning" even when the score is green', () => {
    const a = analyzeURL('https://bit.ly/abc');
    expect(a.score).toBeGreaterThanOrEqual(80);
    expect(urlVerdict(a)).toEqual({ word: 'Warning', severity: 'amber' });
  });

  it('any high finding is "Fail"', () => {
    expect(urlVerdict(analyzeURL('http://paypa1.com/login'))).toEqual({ word: 'Fail', severity: 'red' });
  });

  it('an untrusted link with only minor findings is "Not verified", like the same link with none', () => {
    // It read "Pass" (green, 95) while the cleaner https://example.com/ read
    // "Not verified": the verdict got worse as the link got cleaner.
    const minor = analyzeURL('https://example.com/p?a=1&b=2&c=3&d=4&e=5&f=6');
    expect(minor.risks.length).toBeGreaterThan(0);
    expect(urlVerdict(minor)).toEqual({ word: 'Not verified', severity: 'amber' });
    expect(urlVerdict(minor)).toEqual(urlVerdict(analyzeURL('https://example.com/')));
  });

  it('a trusted site without a fail or warning stays "Pass", minor findings or not', () => {
    expect(urlVerdict(analyzeURL('https://github.com/'))).toEqual({ word: 'Pass', severity: 'green' });
    const minor = analyzeURL('https://github.com/p?a=1&b=2&c=3&d=4&e=5&f=6');
    expect(minor.risks.map((r) => r.severity)).toEqual(['low']);
    expect(urlVerdict(minor)).toEqual({ word: 'Pass', severity: 'green' });
  });
});

describe('URL Safety Checker impersonation', () => {
  it.each([
    ['http://paypa1.com/login', 'paypal', 1],
    ['https://goog1e.com', 'google', 1],
    ['https://micros0ft.com', 'microsoft', 1],
  ])('%s is flagged as imitating %s (a pure leet swap normalises to the brand itself)', (url, brand, distance) => {
    expect(analyzeURL(url).suspectedImpersonation).toEqual({ brand, distance });
  });

  it('the brand name itself and a substring lookalike behave as before', () => {
    expect(analyzeURL('https://paypal.com').suspectedImpersonation).toBeUndefined();
    expect(analyzeURL('https://paypal-secure.com').suspectedImpersonation).toEqual({ brand: 'paypal', distance: 0 });
  });
});
