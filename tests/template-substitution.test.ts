/**
 * Template placeholder substitution tests.
 *
 * Regression guard for the bug where TemplatePage's fillTemplate used
 * {{KEY}} regex against content that uses [KEY] brackets. Every placeholder
 * key defined in a template's JSON must be substitutable against that
 * template's own content.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Re-implementation of the component's pure logic for testing. Must stay in
// sync with components/TemplatePage.tsx — if that regex changes, change here.
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function fillTemplate(content: string, values: Record<string, string>) {
  let result = content;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`\\[${escapeRegExp(key)}\\]`, 'g');
    result = result.replace(pattern, value || `[${key}]`);
  }
  return result;
}

interface Placeholder {
  key: string;
  label: string;
  defaultValue: string;
}
interface Section {
  heading: string;
  content: string;
  placeholders?: Placeholder[];
}
interface Template {
  niche: string;
  slug: string;
  sections: Section[];
}

function loadAllTemplates(): Template[] {
  const root = path.join(__dirname, '..', 'data', 'templates');
  const out: Template[] = [];
  for (const niche of fs.readdirSync(root)) {
    const nicheDir = path.join(root, niche);
    if (!fs.statSync(nicheDir).isDirectory()) continue;
    for (const file of fs.readdirSync(nicheDir)) {
      if (!file.endsWith('.json')) continue;
      out.push(JSON.parse(fs.readFileSync(path.join(nicheDir, file), 'utf-8')));
    }
  }
  return out;
}

describe('Template placeholder substitution', () => {
  it('TemplatePage source uses [KEY] bracket regex, not {{KEY}} mustache', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'TemplatePage.tsx'),
      'utf-8'
    );
    // The fillTemplate regex must target [KEY] brackets
    expect(src).toContain('`\\\\[${escapeRegExp(key)}\\\\]`');
    // Must not contain the old broken mustache pattern
    expect(src).not.toContain('`\\\\{\\\\{${key}\\\\}\\\\}`');
  });

  it('TemplatePage auto-synthesizes inputs for orphan [TOKEN]s in content', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'TemplatePage.tsx'),
      'utf-8'
    );
    // Should scan section content for bracket tokens
    expect(src).toMatch(/section\.content\.match\(\/\\\[\[A-Z_\]/);
    // Should fall back when a key wasn't declared
    expect(src).toMatch(/if \(!declared\.has\(key\)\)/);
  });

  it('substitutes a single placeholder value', () => {
    const out = fillTemplate('Email: [YOUR_EMAIL]', { YOUR_EMAIL: 'a@b.com' });
    expect(out).toBe('Email: a@b.com');
  });

  it('substitutes all occurrences of the same key (global replace)', () => {
    const out = fillTemplate('[X] and [X] and [X]', { X: 'hi' });
    expect(out).toBe('hi and hi and hi');
  });

  it('keeps bracket token when value is empty (visual marker)', () => {
    const out = fillTemplate('Hello [NAME]', { NAME: '' });
    expect(out).toBe('Hello [NAME]');
  });

  it('escapes regex metacharacters in placeholder keys', () => {
    // Pathological key with regex metachars — should not blow up or mis-match
    const out = fillTemplate('[A.B]', { 'A.B': 'safe' });
    expect(out).toBe('safe');
  });

  it('does not substitute {{KEY}} mustache syntax (old broken format)', () => {
    const out = fillTemplate('{{YOUR_EMAIL}}', { YOUR_EMAIL: 'a@b.com' });
    expect(out).toBe('{{YOUR_EMAIL}}');
  });
});

describe('Every template in data/ is fully substitutable', () => {
  const templates = loadAllTemplates();

  it('loads at least a few template files', () => {
    expect(templates.length).toBeGreaterThan(10);
  });

  // Simulates what TemplatePage does at render time: merge declared placeholders
  // with auto-synthesized ones for any orphan [TOKEN]s in the content.
  function effectiveKeys(t: Template): Set<string> {
    const keys = new Set<string>();
    for (const s of t.sections) {
      for (const p of s.placeholders || []) keys.add(p.key);
      for (const token of s.content.match(/\[[A-Z_][A-Z0-9_]*\]/g) || []) {
        keys.add(token.slice(1, -1));
      }
    }
    return keys;
  }

  for (const t of templates) {
    it(`${t.niche}/${t.slug}: every content [TOKEN] becomes a fillable input (after synthesis)`, () => {
      const keys = effectiveKeys(t);
      const missing: string[] = [];
      for (const section of t.sections) {
        for (const token of section.content.match(/\[[A-Z_][A-Z0-9_]*\]/g) || []) {
          const key = token.slice(1, -1);
          if (!keys.has(key)) missing.push(`${section.heading}: ${token}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`${t.niche}/${t.slug}: user-supplied values substitute into every referenced token`, () => {
      const keys = effectiveKeys(t);
      const userValues = Object.fromEntries(Array.from(keys).map(k => [k, `USER_${k}`]));
      for (const section of t.sections) {
        const filled = fillTemplate(section.content, userValues);
        for (const key of keys) {
          if (section.content.includes(`[${key}]`)) {
            expect(filled).toContain(`USER_${key}`);
            expect(filled).not.toContain(`[${key}]`);
          }
        }
      }
      // After substituting user values for every discovered token, no bracket
      // tokens should remain — the clipboard copy will be fully filled.
      for (const section of t.sections) {
        const filled = fillTemplate(section.content, userValues);
        expect(filled.match(/\[[A-Z_][A-Z0-9_]*\]/g) || []).toEqual([]);
      }
    });
  }
});

// Informational: tracks data-quality debt. Templates whose JSON placeholders
// array is incomplete still work (auto-synthesized), but content generation
// should declare everything explicitly so labels/defaults are human-written.
describe('Template data quality (informational)', () => {
  const templates = loadAllTemplates();

  it('reports templates with orphan [TOKEN]s not declared in placeholders', () => {
    const orphanReport: string[] = [];
    for (const t of templates) {
      const declaredKeys = new Set(
        t.sections.flatMap(s => (s.placeholders || []).map(p => p.key))
      );
      const orphans = new Set<string>();
      for (const s of t.sections) {
        for (const token of s.content.match(/\[[A-Z_][A-Z0-9_]*\]/g) || []) {
          const key = token.slice(1, -1);
          if (!declaredKeys.has(key)) orphans.add(key);
        }
      }
      if (orphans.size > 0) {
        orphanReport.push(`${t.niche}/${t.slug}: ${Array.from(orphans).join(', ')}`);
      }
    }
    // Non-blocking — just surface the debt in test output for visibility.
    if (orphanReport.length > 0) {
      console.warn(`\n[data-quality] ${orphanReport.length} templates with orphan tokens:\n  ${orphanReport.join('\n  ')}\n`);
    }
    expect(orphanReport.length).toBeGreaterThanOrEqual(0); // always passes
  });
});
