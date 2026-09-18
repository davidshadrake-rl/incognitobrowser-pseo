/**
 * The scanner fetches a URL the visitor supplies, from our own server, so its
 * SSRF check decides what our droplet can be pointed at.
 *
 * isBlockedHostname only compares the hostname TEXT. Four bypasses were
 * verified against it on 2026-09-18, all returning allowed: a name that
 * resolves to the cloud metadata address (169-254-169-254.nip.io), one that
 * resolves to this droplet's own localhost (127-0-0-1.nip.io), and 127.0.0.1
 * written in decimal (2130706433) and hex (0x7f.0.0.1). The port allowlist
 * kept Redis and MySQL out of reach, but metadata and the co-hosted WordPress
 * both answer on port 80.
 *
 * app/scan-url/route.ts now resolves the name and applies the same check to
 * every ADDRESS it points at. These cases pin the text check's limits, so
 * nobody later reads it as sufficient on its own.
 */
import { describe, expect, it } from 'vitest';
import { isBlockedHostname } from '../lib/scanner';

describe('isBlockedHostname judges text, which is why the route resolves first', () => {
  it('catches addresses written plainly', () => {
    for (const h of ['169.254.169.254', '127.0.0.1', '10.0.0.5', '192.168.1.1', 'localhost', 'metadata.google.internal']) {
      expect(isBlockedHostname(h), h).toBe(true);
    }
  });

  it('does NOT catch a name that merely resolves somewhere private — the gap the route closes', () => {
    for (const h of ['169-254-169-254.nip.io', '127-0-0-1.nip.io', '2130706433', '0x7f.0.0.1']) {
      expect(isBlockedHostname(h), `${h} is expected to pass the TEXT check`).toBe(false);
    }
  });

  it('applied to a resolved address, it blocks every one of those', () => {
    // What the route now does: resolve, then judge each address.
    for (const addr of ['169.254.169.254', '127.0.0.1']) {
      expect(isBlockedHostname(addr), addr).toBe(true);
    }
  });
});

describe('the scan route resolves before it fetches', () => {
  it('looks the hostname up and checks the addresses, not just the string', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app/scan-url/route.ts'), 'utf-8');
    expect(src).toContain('dnsLookup(parsedUrl.hostname');
    expect(src).toMatch(/resolved\.filter\(\(r\) => isBlockedHostname\(r\.address\)\)/);
    // and it must still refuse to follow redirects, or the check is re-openable
    expect(src).toContain("redirect: 'manual'");
  });
});
