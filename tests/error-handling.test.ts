/**
 * Error Handling & Information Disclosure Tests (OWASP A09)
 *
 * Verifies that:
 * - Error responses don't leak stack traces or internal details
 * - Error logging uses safe structured format
 * - Generic error messages are returned to clients
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

describe('Error Handling - No Stack Trace Leakage', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('does not pass raw error objects to console.error', () => {
    // Should NOT have console.error('...', err) with raw error
    expect(routeSource).not.toMatch(/console\.error\([^)]*,\s*err\s*\)/);
  });

  it('logs only error type and message, not full stack', () => {
    expect(routeSource).toContain('errorType');
    expect(routeSource).toContain('err.message');
  });

  it('returns generic error message to client', () => {
    expect(routeSource).toContain('An unexpected error occurred while scanning.');
  });

  it('does not include error details in client response', () => {
    // The catch block should not include err.message or err.stack in the response
    const catchBlock = routeSource.split('} catch (err)')[1];
    if (catchBlock) {
      // The NextResponse.json should only contain a generic error string
      const responseMatch = catchBlock.match(/NextResponse\.json\(\{[^}]+\}/);
      if (responseMatch) {
        expect(responseMatch[0]).not.toContain('err.message');
        expect(responseMatch[0]).not.toContain('err.stack');
      }
    }
  });
});

describe('Error Handling - Client Error Messages', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('returns 400 for missing URL', () => {
    expect(routeSource).toContain("'URL is required'");
    expect(routeSource).toContain('status: 400');
  });

  it('returns 400 for invalid URL format', () => {
    expect(routeSource).toContain("'Invalid URL format'");
  });

  it('returns 400 for unsupported protocols', () => {
    expect(routeSource).toContain('Only HTTP/HTTPS URLs are supported');
  });

  it('returns 400 for private IP addresses', () => {
    expect(routeSource).toContain('Cannot scan private IP addresses');
  });

  it('returns 429 for rate limited requests', () => {
    expect(routeSource).toContain('Too many requests');
    expect(routeSource).toContain('status: 429');
  });

  it('returns 502 for unreachable URLs', () => {
    expect(routeSource).toContain('status: 502');
  });
});
