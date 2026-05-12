/**
 * CORS Security Tests (OWASP A01 - Broken Access Control)
 *
 * CORS logic moved to lib/origin.ts (shared by /scan-url and /challenge),
 * so these tests inspect that module + verify the route still wires it correctly.
 *
 * Verifies:
 * - CORS only allows whitelisted origins (default list when env unset, or
 *   ALLOWED_ORIGINS env var when present)
 * - Unauthorized origins don't get Access-Control-Allow-Origin
 * - Security headers are present on all responses
 * - The route enforces a strict 403 rejection on unknown origins
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const routeSource = fs.readFileSync(
  path.join(__dirname, '..', 'app/scan-url/route.ts'),
  'utf-8'
);

const originLibSource = fs.readFileSync(
  path.join(__dirname, '..', 'lib/origin.ts'),
  'utf-8'
);

describe('CORS - Origin Whitelist (lib/origin.ts)', () => {
  it('default list includes the production origins', () => {
    expect(originLibSource).toContain("'https://incognitobrowser.io'");
    expect(originLibSource).toContain("'https://www.incognitobrowser.io'");
  });

  it('reads ALLOWED_ORIGINS env var for runtime configuration', () => {
    expect(originLibSource).toContain('process.env.ALLOWED_ORIGINS');
  });

  it('does not use wildcard * for Access-Control-Allow-Origin', () => {
    expect(routeSource).not.toMatch(/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/);
    expect(originLibSource).not.toMatch(/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/);
  });

  it('checks origin against allowed list before setting header', () => {
    expect(originLibSource).toContain('isOriginAllowed');
    // The route uses isOriginAllowed() — strict origin enforcement
    expect(routeSource).toContain('isOriginAllowed(origin)');
  });
});

describe('CORS - Allowed Methods', () => {
  it('allows GET, POST, and OPTIONS methods (POST for scan, GET for challenge)', () => {
    expect(originLibSource).toContain("'GET, POST, OPTIONS'");
  });

  it('allows Content-Type and Authorization headers (Authorization for Altcha POW)', () => {
    expect(originLibSource).toContain('Content-Type, Authorization');
  });
});

describe('Security Headers on API Responses', () => {
  it('sets X-Content-Type-Options: nosniff', () => {
    expect(originLibSource).toContain("'X-Content-Type-Options'");
    expect(originLibSource).toContain("'nosniff'");
  });

  it('sets X-Frame-Options: DENY', () => {
    expect(originLibSource).toContain("'X-Frame-Options'");
    expect(originLibSource).toContain("'DENY'");
  });

  it('sets Referrer-Policy: strict-origin-when-cross-origin', () => {
    expect(originLibSource).toContain("'Referrer-Policy'");
    expect(originLibSource).toContain("'strict-origin-when-cross-origin'");
  });

  it('sets Content-Type: application/json on default response headers', () => {
    expect(originLibSource).toMatch(/['"]Content-Type['"]\s*:\s*['"]application\/json['"]/);
  });

  it('sets Vary: Origin to prevent cache poisoning across origins', () => {
    expect(originLibSource).toMatch(/Vary['"]?\s*:\s*['"]Origin['"]/);
  });
});

describe('Origin enforcement on the route', () => {
  it('rejects requests from non-allowed origins with 403', () => {
    expect(routeSource).toMatch(/!isOriginAllowed\(origin\)/);
    expect(routeSource).toContain("'Origin not allowed.'");
    expect(routeSource).toMatch(/status:\s*403/);
  });
});

describe('CORS - No Credentials Allowed', () => {
  it('credentials flag is explicitly false (never true)', () => {
    // Some routes need credentials, our public scan API does not.
    expect(originLibSource).not.toMatch(/['"]Access-Control-Allow-Credentials['"]\s*:\s*['"]true['"]/);
  });
});
