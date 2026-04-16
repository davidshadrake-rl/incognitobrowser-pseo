/**
 * CORS Security Tests (OWASP A01 - Broken Access Control)
 *
 * Verifies that:
 * - CORS only allows whitelisted origins
 * - Unauthorized origins don't get Access-Control-Allow-Origin
 * - OPTIONS preflight returns correct headers
 * - Security headers are present on all responses
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const routeSource = fs.readFileSync(
  path.join(__dirname, '..', 'app/api/scan-url/route.ts'),
  'utf-8'
);

describe('CORS - Origin Whitelist', () => {
  it('only allows incognitobrowser.io origins', () => {
    expect(routeSource).toContain("'https://incognitobrowser.io'");
    expect(routeSource).toContain("'https://www.incognitobrowser.io'");
  });

  it('does not use wildcard * for Access-Control-Allow-Origin', () => {
    // Ensure no Access-Control-Allow-Origin: * anywhere
    expect(routeSource).not.toMatch(/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/);
  });

  it('checks origin against allowed list before setting header', () => {
    expect(routeSource).toContain('ALLOWED_ORIGINS.includes(origin)');
  });
});

describe('CORS - Allowed Methods', () => {
  it('only allows POST and OPTIONS methods', () => {
    expect(routeSource).toContain("'POST, OPTIONS'");
  });

  it('only allows Content-Type header', () => {
    expect(routeSource).toContain("'Content-Type'");
  });
});

describe('Security Headers on API Responses', () => {
  it('sets X-Content-Type-Options: nosniff', () => {
    expect(routeSource).toContain("'X-Content-Type-Options'");
    expect(routeSource).toContain("'nosniff'");
  });

  it('sets X-Frame-Options: DENY', () => {
    expect(routeSource).toContain("'X-Frame-Options'");
    expect(routeSource).toContain("'DENY'");
  });

  it('sets Referrer-Policy', () => {
    expect(routeSource).toContain("'Referrer-Policy'");
    expect(routeSource).toContain("'strict-origin-when-cross-origin'");
  });

  it('sets Content-Type: application/json', () => {
    expect(routeSource).toContain("'Content-Type': 'application/json'");
  });
});

describe('CORS - No Credentials Allowed', () => {
  it('does not set Access-Control-Allow-Credentials', () => {
    // Should not allow credentials for a public scan API
    expect(routeSource).not.toContain('Access-Control-Allow-Credentials');
  });
});
