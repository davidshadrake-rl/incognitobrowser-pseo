/**
 * SSRF Protection Tests (OWASP A01 / A10)
 *
 * Verifies that the scan-url API blocks:
 * - Localhost and loopback addresses
 * - Private RFC 1918 IP ranges (10.x, 172.16-31.x, 192.168.x)
 * - Cloud metadata endpoints (169.254.169.254)
 * - IPv6 private/loopback addresses
 * - Non-standard ports (used to probe internal services)
 * - Redirect-based SSRF bypasses
 */

import { describe, it, expect } from 'vitest';

// The REAL guard, imported. This file used to carry a hand-copied replica of
// the implementation, with a comment claiming the function was not exported —
// it is, and has been. The copy silently drifted from the original, so every
// case below graded a function that does not run in production: the suite
// stayed green straight through the IPv4-mapped-IPv6 and trailing-dot
// bypasses found on 2026-09-18 (see the regression block at the foot of this
// file). Never re-inline it; a test that grades a copy grades nothing.
import { isBlockedHostname } from '@/lib/scanner';

describe('SSRF Protection - Localhost/Loopback', () => {
  it('blocks localhost', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
  });

  it('blocks localhost.localdomain', () => {
    expect(isBlockedHostname('localhost.localdomain')).toBe(true);
  });

  it('blocks 127.0.0.1', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
  });

  it('blocks 127.x.x.x variants', () => {
    expect(isBlockedHostname('127.0.0.2')).toBe(true);
    expect(isBlockedHostname('127.1.1.1')).toBe(true);
    expect(isBlockedHostname('127.255.255.255')).toBe(true);
  });

  it('blocks IPv6 loopback ::1', () => {
    expect(isBlockedHostname('::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 loopback ::ffff:127.0.0.1', () => {
    expect(isBlockedHostname('::ffff:127.0.0.1')).toBe(true);
  });
});

describe('SSRF Protection - Private IP Ranges (RFC 1918)', () => {
  it('blocks 10.0.0.0/8', () => {
    expect(isBlockedHostname('10.0.0.1')).toBe(true);
    expect(isBlockedHostname('10.255.255.255')).toBe(true);
    expect(isBlockedHostname('10.10.10.10')).toBe(true);
  });

  it('blocks 172.16.0.0/12', () => {
    expect(isBlockedHostname('172.16.0.1')).toBe(true);
    expect(isBlockedHostname('172.31.255.255')).toBe(true);
    expect(isBlockedHostname('172.20.0.1')).toBe(true);
  });

  it('allows 172.15.x.x (not private)', () => {
    expect(isBlockedHostname('172.15.0.1')).toBe(false);
  });

  it('allows 172.32.x.x (not private)', () => {
    expect(isBlockedHostname('172.32.0.1')).toBe(false);
  });

  it('blocks 192.168.0.0/16', () => {
    expect(isBlockedHostname('192.168.0.1')).toBe(true);
    expect(isBlockedHostname('192.168.1.1')).toBe(true);
    expect(isBlockedHostname('192.168.255.255')).toBe(true);
  });
});

describe('SSRF Protection - Cloud Metadata Endpoints', () => {
  it('blocks AWS metadata endpoint 169.254.169.254', () => {
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
  });

  it('blocks all link-local 169.254.x.x', () => {
    expect(isBlockedHostname('169.254.0.1')).toBe(true);
    expect(isBlockedHostname('169.254.255.255')).toBe(true);
  });

  it('blocks GCP metadata hostname', () => {
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
  });

  it('blocks IPv4-mapped metadata ::ffff:169.254.169.254', () => {
    expect(isBlockedHostname('::ffff:169.254.169.254')).toBe(true);
  });
});

describe('SSRF Protection - IPv6 Private Ranges', () => {
  it('blocks ULA fd00::/8', () => {
    expect(isBlockedHostname('fd00::1')).toBe(true);
    expect(isBlockedHostname('fdab:1234::1')).toBe(true);
  });

  it('blocks ULA fc00::/7', () => {
    expect(isBlockedHostname('fc00::1')).toBe(true);
  });

  it('blocks link-local fe80::/10', () => {
    expect(isBlockedHostname('fe80::1')).toBe(true);
  });

  it('blocks multicast ff00::/8', () => {
    expect(isBlockedHostname('ff02::1')).toBe(true);
  });

  it('blocks unspecified address ::', () => {
    expect(isBlockedHostname('::')).toBe(true);
  });
});

describe('SSRF Protection - Other Reserved Ranges', () => {
  it('blocks 0.0.0.0/8 (current network)', () => {
    expect(isBlockedHostname('0.0.0.0')).toBe(true);
    expect(isBlockedHostname('0.1.2.3')).toBe(true);
  });

  it('blocks carrier-grade NAT 100.64.0.0/10', () => {
    expect(isBlockedHostname('100.64.0.1')).toBe(true);
    expect(isBlockedHostname('100.127.255.255')).toBe(true);
  });

  it('blocks broadcast 255.255.255.255', () => {
    expect(isBlockedHostname('255.255.255.255')).toBe(true);
  });

  it('blocks benchmarking 198.18.0.0/15', () => {
    expect(isBlockedHostname('198.18.0.1')).toBe(true);
    expect(isBlockedHostname('198.19.255.255')).toBe(true);
  });
});

describe('SSRF Protection - Allows Public IPs', () => {
  it('allows google.com', () => {
    expect(isBlockedHostname('google.com')).toBe(false);
  });

  it('allows public IPs', () => {
    expect(isBlockedHostname('8.8.8.8')).toBe(false);
    expect(isBlockedHostname('1.1.1.1')).toBe(false);
    expect(isBlockedHostname('93.184.216.34')).toBe(false);
  });

  it('allows normal domains', () => {
    expect(isBlockedHostname('example.com')).toBe(false);
    expect(isBlockedHostname('incognitobrowser.io')).toBe(false);
  });
});

// Each case below was verified ALLOWED by the real function on 2026-09-18,
// while this suite reported all green against its inlined copy.
describe('SSRF Protection - bypasses found 2026-09-18', () => {
  // WHATWG URL rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1, so the hex form is
  // the one that actually arrives — from a typed URL and from dns.lookup alike.
  it('blocks IPv4-mapped IPv6 written in hex', () => {
    expect(isBlockedHostname('[::ffff:7f00:1]')).toBe(true);      // 127.0.0.1
    expect(isBlockedHostname('::ffff:7f00:1')).toBe(true);
    expect(isBlockedHostname('[::ffff:a9fe:a9fe]')).toBe(true);   // 169.254.169.254
    expect(isBlockedHostname('0:0:0:0:0:ffff:7f00:1')).toBe(true); // uncompressed
  });

  it('blocks names with a trailing dot', () => {
    expect(isBlockedHostname('localhost.')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal.')).toBe(true);
    expect(isBlockedHostname('LOCALHOST.')).toBe(true);
  });

  it('blocks multicast and reserved space', () => {
    expect(isBlockedHostname('224.0.0.1')).toBe(true);
    expect(isBlockedHostname('239.255.255.250')).toBe(true);  // SSDP
    expect(isBlockedHostname('240.0.0.1')).toBe(true);
  });

  it('blocks 6to4, NAT64 and documentation ranges', () => {
    expect(isBlockedHostname('192.88.99.1')).toBe(true);
    expect(isBlockedHostname('2002:7f00:1::1')).toBe(true);
    expect(isBlockedHostname('64:ff9b::7f00:1')).toBe(true);
    expect(isBlockedHostname('192.0.2.1')).toBe(true);
    expect(isBlockedHostname('198.51.100.1')).toBe(true);
    expect(isBlockedHostname('203.0.113.1')).toBe(true);
  });

  // The widened rules must not start refusing real scan targets.
  it('still allows ordinary public addresses', () => {
    for (const h of ['example.com', 'apnews.com', '8.8.8.8', '1.1.1.1', '93.184.216.34', '100.128.0.1', '172.32.0.1']) {
      expect(isBlockedHostname(h), h).toBe(false);
    }
  });
});
