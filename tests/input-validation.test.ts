/**
 * Input Validation Tests (OWASP A03 - Injection)
 *
 * Verifies that:
 * - URL length is capped at 2048 characters
 * - Only http/https protocols are accepted
 * - Port restrictions are enforced
 * - File upload sizes are validated
 * - URL analyzer has length guards against ReDoS
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

describe('API Input Validation - URL Length', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('enforces URL length limit', () => {
    expect(routeSource).toContain('MAX_URL_LENGTH');
    expect(routeSource).toContain('url.length > MAX_URL_LENGTH');
  });

  it('MAX_URL_LENGTH is 2048', () => {
    expect(routeSource).toContain('const MAX_URL_LENGTH = 2048');
  });
});

describe('API Input Validation - Protocol Restrictions', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('only allows http and https protocols', () => {
    expect(routeSource).toContain("['http:', 'https:'].includes(parsedUrl.protocol)");
  });
});

describe('API Input Validation - Port Restrictions', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('restricts to standard web ports', () => {
    expect(routeSource).toContain('port !== 80 && port !== 443');
    expect(routeSource).toContain('port !== 8080');
    expect(routeSource).toContain('port !== 8443');
  });
});

describe('API Input Validation - Redirect Handling', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('does not auto-follow redirects (SSRF prevention)', () => {
    // Should use manual redirect mode, not follow
    expect(routeSource).toContain("redirect: 'manual'");
    expect(routeSource).not.toContain("redirect: 'follow'");
  });
});

describe('API Input Validation - Response Size', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('defines MAX_BODY_SIZE limit', () => {
    expect(routeSource).toContain('MAX_BODY_SIZE');
  });
});

describe('Client-Side Input Validation - File Upload Limits', () => {
  it('HashGeneratorTool validates file size before processing', () => {
    const content = readFile('components/tools/HashGeneratorTool.tsx');
    expect(content).toContain('file.size >');
    expect(content).toContain('File too large');
  });

  it('MetadataViewerTool validates file size before processing', () => {
    const content = readFile('components/tools/MetadataViewerTool.tsx');
    expect(content).toContain('file.size >');
    expect(content).toContain('File too large');
  });
});

describe('Client-Side Input Validation - URL Analyzer Length Guard', () => {
  it('URLAnalyzerTool has input length validation', () => {
    const content = readFile('components/tools/URLAnalyzerTool.tsx');
    expect(content).toContain('urlString.length > 2048');
    expect(content).toContain('suspiciously long');
  });
});

describe('API Input Validation - Request Body Type Check', () => {
  const routeSource = readFile('app/api/scan-url/route.ts');

  it('validates url field is a string', () => {
    expect(routeSource).toContain("typeof url !== 'string'");
  });

  it('validates url field is not empty', () => {
    expect(routeSource).toContain('!url');
  });
});
