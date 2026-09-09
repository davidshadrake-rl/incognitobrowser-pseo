/**
 * Design system components (DESIGN-SPEC section 4 illustrations, 5.4 Gauge
 * and PageHero). Source-level render checks via react-dom/server, same
 * pattern as tests/design-guards.test.ts.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Diagram } from '../components/ui/Diagram';
import { Gauge } from '../components/ui/Gauge';
import { PageHero } from '../components/ui/PageHero';
import { DIAGRAM_FAMILY, type Diagram as DiagramId } from '../lib/visuals';

describe('Diagram', () => {
  const ids = Object.keys(DIAGRAM_FAMILY) as DiagramId[];

  it('covers all eight motifs', () => {
    expect(ids.length).toBe(8);
  });

  it.each(ids)('id="%s" renders an svg with role img and an aria-label', (id) => {
    const html = renderToStaticMarkup(React.createElement(Diagram, { id }));
    expect(html).toMatch(/<svg[^>]*\brole="img"/);
    expect(html).toMatch(/\baria-label="[^"]+"/);
  });

  it.each(ids)('id="%s" pro=true still renders (adds the cut mark, does not throw)', (id) => {
    const html = renderToStaticMarkup(React.createElement(Diagram, { id, pro: true }));
    expect(html).toMatch(/<svg/);
  });
});

describe('Gauge', () => {
  it('renders three different dashoffsets for score 0, 50 and 100', () => {
    const offsets = [0, 50, 100].map((score) => {
      const html = renderToStaticMarkup(React.createElement(Gauge, { score }));
      const match = html.match(/stroke-dashoffset="([^"]+)"/);
      expect(match, `no stroke-dashoffset for score ${score}`).not.toBeNull();
      return match![1];
    });
    expect(new Set(offsets).size).toBe(3);
  });

  it('never uses colour alone: the numeric score is visible text and the svg is labelled', () => {
    const html = renderToStaticMarkup(React.createElement(Gauge, { score: 42, label: 'audit' }));
    expect(html).toContain('42');
    expect(html).toMatch(/role="img"/);
    expect(html).toMatch(/aria-label="[^"]*42[^"]*"/);
  });
});

describe('PageHero', () => {
  it('renders the h1 and the kicker', () => {
    const html = renderToStaticMarkup(
      React.createElement(PageHero, {
        icon: 'globe',
        kicker: 'Tools',
        title: 'Free privacy tools',
      })
    );
    expect(html).toMatch(/<h1[^>]*>Free privacy tools<\/h1>/);
    expect(html).toContain('Tools');
  });

  it('tints the figure rule with the family hue when figureFamily is given', () => {
    const html = renderToStaticMarkup(
      React.createElement(PageHero, {
        icon: 'globe',
        kicker: 'Whats my ip',
        title: 'What is my IP address?',
        figure: { value: '1', label: 'question: who resolves you' },
        figureFamily: 'net',
      })
    );
    expect(html).toContain('border-top-color:var(--fam-net)');
  });
});
