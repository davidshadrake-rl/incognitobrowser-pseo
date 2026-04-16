/**
 * JSON-LD Injection Tests (OWASP A07 - XSS via structured data)
 *
 * Verifies that:
 * - The JsonLd component escapes < characters
 * - Script tag injection via JSON-LD is prevented
 * - Malicious payloads in data are neutralized
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf-8');
}

// Simulate the JsonLd escaping logic
function escapeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

describe('JSON-LD Injection Prevention', () => {
  it('JsonLd component uses < escaping', () => {
    const content = readFile('components/seo/JsonLd.tsx');
    expect(content).toContain("replace(/</g, '\\\\u003c')");
  });

  it('escapes </script> injection attempts', () => {
    const malicious = { name: '</script><script>alert("xss")</script>' };
    const escaped = escapeJsonLd(malicious);

    expect(escaped).not.toContain('</script>');
    expect(escaped).toContain('\\u003c/script>');
    expect(escaped).toContain('\\u003cscript>');
  });

  it('escapes <img onerror> injection attempts', () => {
    const malicious = { description: '<img src=x onerror=alert(1)>' };
    const escaped = escapeJsonLd(malicious);

    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('\\u003cimg');
  });

  it('escapes SVG injection attempts', () => {
    const malicious = { name: '<svg onload=alert(1)>' };
    const escaped = escapeJsonLd(malicious);

    expect(escaped).not.toContain('<svg');
    expect(escaped).toContain('\\u003csvg');
  });

  it('preserves valid JSON structure after escaping', () => {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Test App',
      description: 'A test with <special> chars & "quotes"',
    };
    const escaped = escapeJsonLd(data);

    // Should be valid JSON (with \u003c in place of <)
    const reparsed = JSON.parse(escaped.replace(/\\u003c/g, '<'));
    expect(reparsed.name).toBe('Test App');
    expect(reparsed['@type']).toBe('WebApplication');
  });

  it('handles deeply nested malicious payloads', () => {
    const malicious = {
      step: [
        {
          name: 'Step 1',
          text: 'Do this</script><script>fetch("evil.com")</script>',
        },
      ],
    };
    const escaped = escapeJsonLd(malicious);
    expect(escaped).not.toContain('</script>');
  });
});
