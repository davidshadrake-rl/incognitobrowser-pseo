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
  const routeSource = readFile('app/scan-url/route.ts');

  it('enforces URL length limit', () => {
    expect(routeSource).toContain('MAX_URL_LENGTH');
    expect(routeSource).toContain('url.length > MAX_URL_LENGTH');
  });

  it('MAX_URL_LENGTH default is 2048 (configurable via env var)', () => {
    const tuningSource = readFile('lib/tuning.ts');
    expect(tuningSource).toMatch(/MAX_URL_LENGTH.*=.*intEnv\('MAX_URL_LENGTH',\s*2048\)/);
  });
});

describe('API Input Validation - Protocol Restrictions', () => {
  const routeSource = readFile('app/scan-url/route.ts');

  it('only allows http and https protocols', () => {
    expect(routeSource).toContain("['http:', 'https:'].includes(parsedUrl.protocol)");
  });
});

describe('API Input Validation - Port Restrictions', () => {
  const routeSource = readFile('app/scan-url/route.ts');

  it('restricts to standard web ports', () => {
    expect(routeSource).toContain('port !== 80 && port !== 443');
    expect(routeSource).toContain('port !== 8080');
    expect(routeSource).toContain('port !== 8443');
  });
});

describe('API Input Validation - Redirect Handling', () => {
  const routeSource = readFile('app/scan-url/route.ts');

  it('does not auto-follow redirects (SSRF prevention)', () => {
    // Should use manual redirect mode, not follow
    expect(routeSource).toContain("redirect: 'manual'");
    expect(routeSource).not.toContain("redirect: 'follow'");
  });
});

describe('API Input Validation - Response Size', () => {
  const routeSource = readFile('app/scan-url/route.ts');

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
  const routeSource = readFile('app/scan-url/route.ts');

  it('validates url field is a string', () => {
    expect(routeSource).toContain("typeof url !== 'string'");
  });

  it('validates url field is not empty', () => {
    expect(routeSource).toContain('!url');
  });
});

describe('Content lookups cannot be walked out of data/ (path traversal)', () => {
  /**
   * lib/content.ts builds a filesystem path out of caller-supplied segments and
   * reads it. path.join normalises '..' as it goes, so a segment of '../../..'
   * resolves outside data/ with the '.json' suffix as the only remaining
   * constraint. Every caller today is build-time and passes route params from a
   * fixed generateStaticParams, so this was never reachable — it is defence in
   * depth for the first refactor that hands one of these functions a value from
   * a request, because that refactor will not come and read this file.
   */
  it('getContentItem refuses traversal segments', async () => {
    const { getContentItem } = await import('../lib/content');
    expect(getContentItem('guides', '..', '..', 'package')).toBeNull();
    expect(getContentItem('guides', '../../..', 'package')).toBeNull();
    expect(getContentItem('..', 'package')).toBeNull();
    expect(getContentItem('guides', 'x/../../../package')).toBeNull();
    expect(getContentItem('guides', 'niche', 'slug\0.png')).toBeNull();
  });

  it('getGlossaryItem refuses them too', async () => {
    const { getGlossaryItem } = await import('../lib/content');
    expect(getGlossaryItem('../../package')).toBeNull();
    expect(getGlossaryItem('..')).toBeNull();
    expect(getGlossaryItem('')).toBeNull();
  });

  it('getContentFiles refuses them too', async () => {
    const { getContentFiles } = await import('../lib/content');
    expect(getContentFiles('..')).toEqual([]);
    expect(getContentFiles('guides', '../../..')).toEqual([]);
  });

  it('every slug the site actually ships still resolves', async () => {
    // The guard is worthless if it also rejects real content, and the content
    // build is the thing that would notice last. Walk the real tree.
    const { getContentFiles, getContentItem } = await import('../lib/content');
    let checked = 0;
    for (const type of ['guides', 'checklists', 'comparisons', 'tools', 'templates', 'calculators']) {
      const files = getContentFiles(type);
      expect(files.length, type).toBeGreaterThan(0);
      for (const file of files) {
        const [niche, slug] = file.split('/');
        expect(getContentItem(type, niche, slug), file).not.toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('every glossary term still resolves', async () => {
    const { getGlossaryFiles, getGlossaryItem } = await import('../lib/content');
    const terms = getGlossaryFiles();
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) expect(getGlossaryItem(term), term).not.toBeNull();
  });
});
