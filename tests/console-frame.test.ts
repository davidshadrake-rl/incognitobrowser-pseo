/**
 * ConsoleFrame header and Gauge unit (CTO review, 2026-09-10). The header
 * used to read "● dns-leak-test · 6 checks · local only 14:32": an internal
 * id, a verdict carried by the dot's colour alone, a processing slogan and
 * an unlabelled time. Gauges showed "72" with no unit, and coloured their
 * arc from the score, so a short link showed a green 90 under an amber
 * "Warning". Render-level checks via react-dom/server, same pattern as
 * tests/design-components.test.ts.
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsoleFrame, ENGINE_NAME, statusFromSeverity } from '../components/tools/ConsoleFrame';
import { analyzeURL, urlVerdict } from '../components/tools/URLAnalyzerTool';
import { Gauge } from '../components/ui/Gauge';

const header = (html: string) => html.slice(html.indexOf('<header'), html.indexOf('</header>'));
/** The coloured arc's stroke: the grey track path has no dash offset. */
const arcStroke = (html: string) => html.match(/<path[^>]*\bstroke="([^"]+)"[^>]*stroke-dashoffset=/)?.[1];

describe('ConsoleFrame header', () => {
  it('names the tool, not its engine id', () => {
    const html = renderToStaticMarkup(React.createElement(ConsoleFrame, { engine: 'dns-leak-test', status: 'ok' }));
    expect(header(html)).toContain('DNS Leak Test');
    expect(header(html)).not.toContain('dns-leak-test');
    // The id stays on the data attribute for tests and analytics.
    expect(html).toContain('data-console="dns-leak-test"');
  });

  it('has a display name for every engine that renders a console', () => {
    for (const engine of [
      'whats-my-ip', 'password-strength', 'browser-privacy', 'cookie-analyzer', 'url-analyzer', 'privacy-quiz',
      'permission-checker', 'metadata-viewer', 'useragent-analyzer', 'link-unwrapper', 'email-pixel-detector',
      'screenshot-leak-checker', 'dns-leak-test', 'ad-blocker-test',
    ]) {
      expect(ENGINE_NAME[engine], engine).toBeTruthy();
    }
  });

  it('writes the verdict as a word next to the dot, never colour alone', () => {
    const words = { ok: 'Pass', warn: 'Warning', danger: 'Fail', info: 'Checked' } as const;
    for (const [status, word] of Object.entries(words)) {
      const html = renderToStaticMarkup(React.createElement(ConsoleFrame, { engine: 'url-analyzer', status: status as keyof typeof words }));
      expect(header(html), status).toContain(`>${word}<`);
    }
    const custom = renderToStaticMarkup(React.createElement(ConsoleFrame, { engine: 'whats-my-ip', status: 'danger', verdict: 'Leaking' }));
    expect(header(custom)).toContain('>Leaking<');
  });

  it('labels the time as the run time and carries no processing slogan', () => {
    const runAt = new Date(2026, 8, 10, 14, 32).getTime();
    const html = renderToStaticMarkup(
      React.createElement(ConsoleFrame, { engine: 'metadata-viewer', status: 'warn', runAt }),
    );
    expect(header(html)).toMatch(/>Run at [^<]*32/);
    expect(html).not.toMatch(/local only|via our server/);
  });

  it('names what the checks count when it is not "checks"', () => {
    const html = renderToStaticMarkup(
      React.createElement(ConsoleFrame, { engine: 'dns-leak-test', status: 'ok', checks: 6, checksNoun: ['test lookup', 'test lookups'] }),
    );
    expect(header(html)).toContain('6 test lookups');
  });

  it('shows a Minor count in the tally only when there is one', () => {
    const withMinor = renderToStaticMarkup(
      React.createElement(ConsoleFrame, { engine: 'url-analyzer', status: 'warn', score: 70, tally: { fails: 0, warns: 1, minor: 2, passes: 9 } }),
    );
    expect(withMinor).toContain('Minor 2');
    expect(withMinor).toContain('Passes 9');
    const without = renderToStaticMarkup(
      React.createElement(ConsoleFrame, { engine: 'url-analyzer', status: 'ok', score: 90, tally: { fails: 0, warns: 0, minor: 0, passes: 12 } }),
    );
    expect(without).not.toContain('Minor');
  });
});

describe('Gauge unit', () => {
  it('shows /100 by default and says "out of 100"', () => {
    const html = renderToStaticMarkup(React.createElement(Gauge, { score: 72, label: 'safety' }));
    expect(html).toContain('/100');
    expect(html).toMatch(/aria-label="safety: 72 out of 100"/);
  });

  it('shows % for a percentage and says "percent"', () => {
    const html = renderToStaticMarkup(React.createElement(Gauge, { score: 72, label: 'blocked', unit: '%' }));
    expect(html).toMatch(/72<tspan[^>]*>%<\/tspan>/);
    expect(html).toMatch(/aria-label="blocked: 72 percent"/);
  });
});

describe('Gauge colour', () => {
  const stroke = (props: React.ComponentProps<typeof Gauge>) => arcStroke(renderToStaticMarkup(React.createElement(Gauge, props)));

  it('with no status, the arc follows the 80 / 50 score bands as before', () => {
    expect(stroke({ score: 90 })).toBe('var(--ok)');
    expect(stroke({ score: 80 })).toBe('var(--ok)');
    expect(stroke({ score: 60 })).toBe('var(--warn)');
    expect(stroke({ score: 30 })).toBe('var(--danger)');
  });

  it('a status sets the arc colour whatever the score', () => {
    expect(stroke({ score: 90, status: 'warn' })).toBe('var(--warn)');
    expect(stroke({ score: 30, status: 'ok' })).toBe('var(--ok)');
    expect(stroke({ score: 85, status: 'danger' })).toBe('var(--danger)');
    expect(stroke({ score: 50, status: 'info' })).toBe('var(--info)');
  });
});

describe('ConsoleFrame gauge', () => {
  it('the arc takes the header status, not the score band', () => {
    const html = renderToStaticMarkup(React.createElement(ConsoleFrame, { engine: 'ad-blocker-test', status: 'warn', score: 85, scoreUnit: '%' }));
    expect(header(html)).toContain('>Warning<');
    expect(arcStroke(html)).toBe('var(--warn)');
  });

  it('a short link scores 90 but its arc, dot and CTA severity are all the Warning amber', () => {
    const a = analyzeURL('https://bit.ly/abc');
    const v = urlVerdict(a);
    expect(a.score).toBeGreaterThanOrEqual(80);
    expect(v).toEqual({ word: 'Warning', severity: 'amber' });
    // The tool passes this status to the frame and this severity to report() (the CTA).
    const html = renderToStaticMarkup(
      React.createElement(ConsoleFrame, { engine: 'url-analyzer', status: statusFromSeverity(v.severity), verdict: v.word, score: a.score }),
    );
    expect(header(html)).toContain('bg-warn');
    expect(arcStroke(html)).toBe('var(--warn)');
  });
});
