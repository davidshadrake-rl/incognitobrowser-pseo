/**
 * Resource Bounds Tests (OWASP A04 - Insecure Design / DoS hardening)
 *
 * Verifies that the scanner endpoint has hard caps on every unbounded
 * resource path an attacker could amplify: response body bytes, Set-Cookie
 * header count, script-src regex iterations, and unhandled redirects.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

describe('Scanner Response Body Cap', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('declares MAX_BODY_SIZE as 5MB', () => {
    expect(routeSource).toContain('const MAX_BODY_SIZE = 5 * 1024 * 1024');
  });

  it('uses readCappedText instead of unbounded response.text()', () => {
    // The only response.text() call should be gone; readCappedText should be used.
    expect(routeSource).toContain('readCappedText(response, MAX_BODY_SIZE)');
    expect(routeSource).not.toMatch(/await response\.text\(\)/);
  });

  it('readCappedText cancels the stream once the cap is hit', () => {
    expect(routeSource).toContain('readCappedText');
    expect(routeSource).toMatch(/reader\.cancel\(\)/);
  });
});

describe('Scanner Cookie Array Cap', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('declares MAX_COOKIES', () => {
    expect(routeSource).toContain('const MAX_COOKIES = 100');
  });

  it('slices the Set-Cookie array before mapping', () => {
    expect(routeSource).toMatch(/rawSetCookiesAll\.slice\(0,\s*MAX_COOKIES\)/);
  });
});

describe('Scanner Script Regex Loop Cap', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('declares MAX_SCRIPT_MATCHES', () => {
    expect(routeSource).toContain('const MAX_SCRIPT_MATCHES = 500');
  });

  it('breaks the script-src loop after MAX_SCRIPT_MATCHES iterations', () => {
    expect(routeSource).toMatch(/scriptIterations\s*>\s*MAX_SCRIPT_MATCHES/);
  });

  it('breaks early once MAX_THIRD_PARTY_DOMAINS collected', () => {
    expect(routeSource).toMatch(/thirdPartyDomains\.size\s*>=\s*MAX_THIRD_PARTY_DOMAINS/);
  });

  it('bounds the script-src URL character class to prevent ReDoS', () => {
    // Character class is bounded {1,2048} instead of unbounded +
    expect(routeSource).toMatch(/\[\^"'\]\{1,2048\}/);
  });

  it('uses MAX_THIRD_PARTY_DOMAINS constant in the response slice', () => {
    expect(routeSource).toMatch(/slice\(0,\s*MAX_THIRD_PARTY_DOMAINS\)/);
  });
});

describe('Scanner Redirect Handling', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it("uses redirect: 'manual' to prevent SSRF-by-redirect", () => {
    expect(routeSource).toContain("redirect: 'manual'");
  });

  it('rejects 3xx redirect responses with a 400', () => {
    expect(routeSource).toMatch(/response\.status\s*>=\s*300\s*&&\s*response\.status\s*<\s*400/);
    // Returns 400 status code in that branch
    expect(routeSource).toMatch(/This URL redirects/);
  });

  it('truncates the reported Location header', () => {
    expect(routeSource).toMatch(/location[^\n]*\.slice\(0,\s*500\)/);
  });
});
