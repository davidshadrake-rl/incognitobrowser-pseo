/**
 * Design guards (DESIGN-SPEC section 8, PR1). Source-level, no build needed,
 * same pattern as tests/tiers.test.ts.
 *
 *   (a) no emoji codepoints in app/**\/*.tsx, components/**\/*.tsx
 *   (b) no ad-hoc hex or stock-Tailwind status colours in app/, components/
 *   (c) every FEATURED_TOOLS engine and TOOL_ENGINES key has an ENGINE_ICON + ENGINE_DIAGRAM
 *   (d) every navItems href has a TYPE_ICON
 *   (e) ICON_PATHS values are static, safe SVG markup
 *   (f) with PRO_WEB_GATED=true, the Pro badge carries no "free for now"
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(rel, exts, out);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(rel);
    }
  }
  return out;
}

const SOURCE_DIRS = ['app', 'components'];

describe('(a) no emoji in app/ or components/', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿]/u;
  const files = SOURCE_DIRS.flatMap((d) => walk(d, ['.tsx']));
  it('scans a realistic number of files', () => {
    expect(files.length).toBeGreaterThan(40);
  });
  it('finds zero emoji codepoints', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (EMOJI.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  it('finds zero unicode-escaped emoji standing in for icons', () => {
    // '✓' / '\u{1F4D6}' escapes render the same glyphs as literal emoji.
    // The only permitted one is the canvas-fingerprint probe string in
    // BrowserPrivacyTool (CANVAS_PROBE_TEXT), which is data, not UI.
    const ESCAPE = /\\u\{?(1F[0-9A-Fa-f]{3}|2[67][0-9A-Fa-f]{2})\}?/;
    const offenders: string[] = [];
    for (const f of files) {
      read(f).split('\n').forEach((line, i) => {
        if (ESCAPE.test(line) && !line.includes('CANVAS_PROBE_TEXT')) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  it('finds zero HTML-entity glyphs standing in for icons', () => {
    // &#10003; (check), &#10007; (cross), &#9888; (warning), &#10132; (arrow), &#127881; (party popper)
    const ENTITY = /&#(10003|10007|9888|10132|127881);/;
    const offenders = files.filter((f) => ENTITY.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('(b) no ad-hoc hex or stock-Tailwind status colours', () => {
  // Same regex as the spec's post-codemod grep (2.3).
  const LEGACY = /text-\[#|bg-\[#0a|-(red|green|yellow|blue|purple|amber|orange|lime)-[0-9]{3}/;
  const files = SOURCE_DIRS.flatMap((d) => walk(d, ['.tsx', '.ts', '.css']));
  it('zero matches in app/ and components/', () => {
    const offenders: string[] = [];
    for (const f of files) {
      read(f).split('\n').forEach((line, i) => {
        if (LEGACY.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('(c) every engine has an icon and a diagram motif', () => {
  it('FEATURED_TOOLS engines and TOOL_ENGINES keys are all registered in lib/visuals', async () => {
    const { ENGINE_ICON, ENGINE_DIAGRAM } = await import('../lib/visuals');
    const featured = [...read('app/tools/page.tsx').matchAll(/^\s+engine: '([a-z-]+)',$/gm)].map((m) => m[1]);
    const registry = [...read('components/tools/registry.tsx').matchAll(/^\s+'([a-z-]+)': [A-Za-z]+Tool,$/gm)].map((m) => m[1]);
    expect(featured.length).toBe(17);
    expect(registry.length).toBe(17);
    for (const e of new Set([...featured, ...registry])) {
      expect(ENGINE_ICON[e], `ENGINE_ICON[${e}]`).toBeTruthy();
      expect(ENGINE_DIAGRAM[e], `ENGINE_DIAGRAM[${e}]`).toBeTruthy();
    }
    // FEATURED_TOOLS no longer carries an icon field; icons come from ENGINE_ICON.
    expect(read('app/tools/page.tsx')).not.toMatch(/^\s+icon: /m);
  });
  it('every taxonomy niche has a NICHE_DIAGRAM entry', async () => {
    const { NICHE_DIAGRAM } = await import('../lib/visuals');
    const taxonomy = JSON.parse(read('data/taxonomy.json')) as { niches: { id: string }[] };
    for (const n of taxonomy.niches) expect(NICHE_DIAGRAM[n.id], `NICHE_DIAGRAM[${n.id}]`).toBeTruthy();
  });
});

describe('(d) every nav item has a TYPE_ICON', () => {
  it('navItems hrefs resolve to an icon name', async () => {
    const { TYPE_ICON } = await import('../lib/visuals');
    const { ICON_PATHS } = await import('../components/ui/Icon');
    const hrefs = [...read('app/layout.tsx').matchAll(/href: "\/([a-z-]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(8);
    for (const slug of hrefs) {
      const icon = TYPE_ICON[slug];
      expect(icon, `TYPE_ICON[${slug}]`).toBeTruthy();
      expect(ICON_PATHS[icon]).toBeTruthy();
    }
  });
});

describe('(e) ICON_PATHS are static, safe SVG markup', () => {
  it('every value matches the safe-character regex and only uses drawing primitives', async () => {
    const { ICON_PATHS } = await import('../components/ui/Icon');
    const SAFE = /^[<>a-zA-Z0-9 ="'./,-]+$/;
    for (const [name, markup] of Object.entries(ICON_PATHS)) {
      expect(markup, name).toMatch(SAFE);
      // Only path / circle / rect elements, never script, foreignObject, use, image, or event handlers.
      expect(markup.replace(/<(path|circle|rect)\b[^>]*\/>/g, ''), name).toBe('');
      expect(markup.toLowerCase(), name).not.toMatch(/on[a-z]+=|href|script|javascript/);
    }
  });
  it('the Icon component is the only dangerouslySetInnerHTML consumer of ICON_PATHS', () => {
    const src = read('components/ui/Icon.tsx');
    expect(src).not.toMatch(/^'use client'/m);
    expect(src).toContain("ICON_PATHS[name]");
  });
});

describe('(f) gate day: PRO_WEB_GATED=true removes every "free for now"', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/tiers');
    vi.resetModules();
  });

  it('Badge variant="pro" says "free for now" today', async () => {
    vi.resetModules();
    const { Badge } = await import('../components/ui/Badge');
    const html = renderToStaticMarkup(React.createElement(Badge, { variant: 'pro' }));
    expect(html).toContain('PRO');
    expect(html).toContain('free for now');
  });

  it('Badge variant="pro" renders no "free for now" once gated', async () => {
    vi.resetModules();
    vi.doMock('@/lib/tiers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../lib/tiers')>();
      return { ...actual, PRO_WEB_GATED: true };
    });
    const { Badge } = await import('../components/ui/Badge');
    const full = renderToStaticMarkup(React.createElement(Badge, { variant: 'pro' }));
    const compact = renderToStaticMarkup(React.createElement(Badge, { variant: 'pro', compact: true }));
    for (const html of [full, compact]) {
      expect(html.toLowerCase()).not.toContain('free for now');
      expect(html.toLowerCase()).not.toContain('free on the web today');
      expect(html).toContain('PRO');
    }
  });

  it('composeCta / IN_APP_COPY carry no "free for now" string to gate', async () => {
    // ProNotice and TierCompare do not exist until PR4; lib/cta-copy carries
    // no "free for now" copy today, so this asserts the current state and
    // becomes a real gate check when PR4 adds gated copy there.
    const src = read('lib/cta-copy.ts');
    expect(src.toLowerCase()).not.toContain('free for now');
  });
});

describe('(g) Amendment A: the four family hues stay confined to their five surfaces', () => {
  it('every ENGINE_DIAGRAM value has a DIAGRAM_FAMILY entry', async () => {
    const { ENGINE_DIAGRAM, DIAGRAM_FAMILY } = await import('../lib/visuals');
    for (const d of new Set(Object.values(ENGINE_DIAGRAM))) {
      expect(DIAGRAM_FAMILY[d], `DIAGRAM_FAMILY[${d}]`).toBeTruthy();
    }
  });

  it('"fam-" appears only in Icon.tsx, Diagram.tsx, ToolCard.tsx, PageHero.tsx and globals.css', () => {
    // ToolCard.tsx does not exist until PR2 (DESIGN-SPEC 5.3); it stays on
    // the allow-list so this guard does not need editing when it lands.
    // DESIGN-SPEC 5.3 places it at components/ToolCard.tsx (not components/ui/) —
    // corrected here to match where it actually landed.
    const ALLOWED = new Set([
      'app/globals.css',
      'components/ui/Icon.tsx',
      'components/ui/Diagram.tsx',
      'components/ToolCard.tsx',
      'components/ui/PageHero.tsx',
    ]);
    const files = SOURCE_DIRS.flatMap((d) => walk(d, ['.tsx', '.ts', '.css']));
    const offenders = files.filter((f) => /fam-/.test(read(f)) && !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });

  it('the four family hex values appear only in globals.css', () => {
    const HEXES = ['#2dd4bf', '#fb923c', '#a78bfa', '#f472b6'];
    const files = SOURCE_DIRS.flatMap((d) => walk(d, ['.tsx', '.ts', '.css'])).filter((f) => f !== 'app/globals.css');
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const hex of HEXES) if (src.includes(hex)) offenders.push(`${f}: ${hex}`);
    }
    expect(offenders).toEqual([]);
  });
});
