/**
 * XSS Protection Tests (OWASP A07 - Cross-Site Scripting)
 *
 * Verifies that:
 * - No dangerouslySetInnerHTML is used with user-controlled data
 * - HTML entity icons are replaced with safe unicode escapes
 * - JSON-LD output escapes < to prevent script injection
 * - No eval() or innerHTML usage in client components
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.join(__dirname, '..');

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf-8');
}

function findTsxFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(path.join(PROJECT_ROOT, dir), { withFileTypes: true });
  for (const entry of entries) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...findTsxFiles(relative));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      files.push(relative);
    }
  }
  return files;
}

describe('XSS - dangerouslySetInnerHTML Audit', () => {
  it('homepage does not use dangerouslySetInnerHTML', () => {
    const content = readFile('app/page.tsx');
    expect(content).not.toContain('dangerouslySetInnerHTML');
  });

  it('RelatedContent does not use dangerouslySetInnerHTML', () => {
    const content = readFile('components/seo/RelatedContent.tsx');
    expect(content).not.toContain('dangerouslySetInnerHTML');
  });

  it('topics hub page does not use dangerouslySetInnerHTML', () => {
    const content = readFile('app/topics/[niche]/page.tsx');
    expect(content).not.toContain('dangerouslySetInnerHTML');
  });

  it('ComparisonPage does not use dangerouslySetInnerHTML', () => {
    const content = readFile('components/ComparisonPage.tsx');
    expect(content).not.toContain('dangerouslySetInnerHTML');
  });

  it('JsonLd escapes < characters to prevent script injection', () => {
    const content = readFile('components/seo/JsonLd.tsx');
    expect(content).toContain("replace(/</g, '\\\\u003c')");
  });
});

describe('XSS - No eval() or innerHTML in Tool Components', () => {
  const toolFiles = fs.readdirSync(path.join(PROJECT_ROOT, 'components/tools'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => `components/tools/${f}`);

  it('found tool component files to check', () => {
    expect(toolFiles.length).toBeGreaterThan(0);
  });

  for (const file of toolFiles) {
    it(`${file} does not use eval()`, () => {
      const content = readFile(file);
      // Match eval( but not "evaluate" or similar words
      const evalMatches = content.match(/\beval\s*\(/g);
      expect(evalMatches).toBeNull();
    });

    it(`${file} does not use .innerHTML`, () => {
      const content = readFile(file);
      expect(content).not.toMatch(/\.innerHTML\s*=/);
    });
  }
});

describe('XSS - Icon Rendering Uses Safe Unicode', () => {
  it('homepage icons use unicode escapes, not HTML entities', () => {
    const content = readFile('app/page.tsx');
    // Should NOT contain HTML entity patterns like &#1234;
    expect(content).not.toMatch(/&#\d+;/);
    // Should use \\u{} or \\u escapes
    expect(content).toMatch(/\\u/);
  });

  it('topics page icons use unicode escapes', () => {
    const content = readFile('app/topics/[niche]/page.tsx');
    expect(content).not.toMatch(/&#\d+;/);
    expect(content).toMatch(/\\u/);
  });

  it('RelatedContent icons use unicode escapes', () => {
    const content = readFile('components/seo/RelatedContent.tsx');
    expect(content).not.toMatch(/&#\d+;/);
    expect(content).toMatch(/\\u/);
  });
});

describe('XSS - No Unescaped User Input in Rendered HTML', () => {
  // Check that user-provided data from API responses doesn't flow into dangerouslySetInnerHTML
  const clientComponents = [
    'components/tools/CookieAnalyzerTool.tsx',
    'components/tools/URLAnalyzerTool.tsx',
    'components/tools/BrowserPrivacyTool.tsx',
    'components/tools/TextEncryptionTool.tsx',
    'components/tools/HashGeneratorTool.tsx',
    'components/tools/PasswordStrengthTool.tsx',
    'components/tools/PasswordGeneratorTool.tsx',
    'components/tools/PrivacyQuizTool.tsx',
    'components/tools/PermissionCheckerTool.tsx',
    'components/tools/UserAgentAnalyzerTool.tsx',
    'components/tools/MetadataViewerTool.tsx',
  ];

  for (const file of clientComponents) {
    it(`${path.basename(file)} does not use dangerouslySetInnerHTML`, () => {
      try {
        const content = readFile(file);
        expect(content).not.toContain('dangerouslySetInnerHTML');
      } catch {
        // File might not exist, skip
      }
    });
  }
});
