/**
 * lib/site-grade — the Report Card rubric must be transparent, monotonic,
 * and stable (same input → same grade) because the grades are published
 * and meant to be argued with.
 */
import { describe, expect, it } from 'vitest';
import { gradeSite } from '../lib/site-grade';

const clean = { cookies: [], trackers: [], inlineTrackers: [], thirdPartyDomains: [], security: { isHTTPS: true, hasCSP: true, hasPermPolicy: true, hasHSTS: true } };

describe('gradeSite', () => {
  it('a clean, well-configured site is an A with no deductions', () => {
    const g = gradeSite(clean);
    expect(g.score).toBe(100);
    expect(g.grade).toBe('A');
    expect(g.deductions).toEqual([]);
    expect(g.headline).toMatch(/Grade A/);
  });

  it('missing security headers cost a little, not HTTPS costs a lot', () => {
    expect(gradeSite({ ...clean, security: { isHTTPS: true, hasCSP: false, hasPermPolicy: false, hasHSTS: false } }).score).toBe(93);
    expect(gradeSite({ ...clean, security: { isHTTPS: false, hasCSP: true, hasPermPolicy: true, hasHSTS: true } }).score).toBe(75);
  });

  it('tracking cookies before consent are the heaviest per-item deduction, and capped', () => {
    const one = gradeSite({ ...clean, cookies: [{ category: 'tracking', risk: 'high' }] });
    expect(one.score).toBe(92);
    const many = gradeSite({ ...clean, cookies: Array(10).fill({ category: 'tracking', risk: 'high' }) });
    expect(many.score).toBe(68); // capped at −32
  });

  it('ad trackers, analytics, inline pixels and third parties all deduct with caps', () => {
    const g = gradeSite({
      ...clean,
      trackers: [
        { category: 'tracking', risk: 'high', name: 'Facebook Pixel' },
        { category: 'tracking', risk: 'high', name: 'Criteo' },
        { category: 'analytics', risk: 'medium', name: 'Hotjar' },
      ],
      inlineTrackers: ['Facebook Pixel (inline)'],
      thirdPartyDomains: Array.from({ length: 12 }, (_, i) => `cdn${i}.example`),
    });
    // 100 − 12 (2 ad) − 3 (1 analytics) − 3 (1 inline) − 7 (12−5 third parties) = 75 → C (B needs ≥78)
    expect(g.score).toBe(75);
    expect(g.grade).toBe('C');
    expect(g.deductions.map((d) => d.reason)).toEqual([
      'Advertising / marketing trackers loaded',
      'Analytics trackers loaded',
      'Inline tracking pixels',
      'Third-party script domains beyond a reasonable five',
    ]);
  });

  it('is monotonic: adding a tracker never raises the score', () => {
    const base = gradeSite({ ...clean, trackers: [{ category: 'tracking', risk: 'high' }] });
    const more = gradeSite({ ...clean, trackers: [{ category: 'tracking', risk: 'high' }, { category: 'tracking', risk: 'high' }] });
    expect(more.score).toBeLessThanOrEqual(base.score);
  });

  it('floors at 0 and grades F for an aggressive site', () => {
    const g = gradeSite({
      cookies: Array(10).fill({ category: 'tracking', risk: 'high' }),
      trackers: Array(10).fill({ category: 'tracking', risk: 'high', name: 'x' }),
      inlineTrackers: ['a', 'b', 'c', 'd'],
      thirdPartyDomains: Array.from({ length: 40 }, (_, i) => `t${i}.example`),
      security: { isHTTPS: false, hasCSP: false, hasPermPolicy: false, hasHSTS: false },
    });
    expect(g.score).toBe(0);
    expect(g.grade).toBe('F');
  });

  it('is deterministic', () => {
    const input = { ...clean, trackers: [{ category: 'analytics', risk: 'medium', name: 'GA' }] };
    expect(gradeSite(input)).toEqual(gradeSite(input));
  });
});
