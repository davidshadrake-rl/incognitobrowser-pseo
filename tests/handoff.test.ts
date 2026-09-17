/**
 * lib/handoff — the bytes behind "Email me the link".
 *
 * Regression guard for the Windows failure reported 2026-09-08: the body used
 * bare "\n" line breaks, which RFC 6068 forbids and Outlook on Windows drops.
 * (The other Windows cause, no registered mailto handler, is handled in
 * components/ResultCta.tsx with a blur-detection fallback.)
 */
import { describe, expect, it } from 'vitest';
import { handoffGmailUrl, handoffMailBody, handoffMailto, stripHash, pageLinkFor, MAILTO_MAX_LENGTH } from '../lib/handoff';
import { playUrl } from '../lib/play';

const PLAY = playUrl({ medium: 'cta', campaign: 'permission-checker', content: 'children-safety', term: 'tool' });
const PAGE = 'https://incognitobrowser-pseo.vercel.app/tools/children-safety/permission-checker';

describe('handoffMailBody', () => {
  it('uses CRLF line breaks only — never a bare \\n (RFC 6068 §5; Outlook on Windows drops the body otherwise)', () => {
    const body = handoffMailBody(PLAY, PAGE);
    expect(body).toContain('\r\n\r\n');
    expect(body.replace(/\r\n/g, '')).not.toContain('\n');
    expect(body.replace(/\r\n/g, '')).not.toContain('\r');
  });
  it('contains the Play link and the page link, with the page hash stripped', () => {
    const body = handoffMailBody(PLAY, PAGE + '#result');
    expect(body).toContain(PLAY);
    expect(body).toContain(PAGE);
    expect(body).not.toContain('#result');
  });
});

describe('handoffMailBody — says what the Play listing is', () => {
  it('names the app as free and Pro inside it with the one outcome offered, and nothing about billing', () => {
    const body = handoffMailBody(PLAY, PAGE, 'Blocks tracking scripts and pixels.');
    expect(body).toMatch(/^Install Incognito Browser \(free\) on your Android phone: /);
    expect(body).toContain('Incognito Pro, inside the app: Blocks tracking scripts and pixels.');
    // Owner, 2026-09-17: the ask never says how Pro is billed or cancelled.
    expect(body).not.toMatch(/subscription|billed|cancel|\bper (week|month|year)\b/i);
    expect(body).not.toMatch(/Get Incognito Pro on Google Play/);
    expect(body.split('\r\n\r\n')).toHaveLength(3);
  });
  it('without a benefit, leaves the Pro line out', () => {
    expect(handoffMailBody(PLAY, PAGE)).not.toContain('Incognito Pro');
  });
  it('the Gmail fallback carries the same message', () => {
    const g = handoffGmailUrl(PLAY, PAGE, 'Blocks tracking scripts and pixels.');
    expect(g).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&su=/);
    expect(decodeURIComponent(g.split('&body=')[1])).toBe(handoffMailBody(PLAY, PAGE, 'Blocks tracking scripts and pixels.'));
  });
});

describe('handoffMailto', () => {
  it('encodes the CRLFs as %0D%0A and carries subject + body', () => {
    const m = handoffMailto(PLAY, PAGE);
    expect(m.startsWith('mailto:?subject=')).toBe(true);
    expect(m).toContain('%0D%0A%0D%0A');
    expect(m).not.toMatch(/(?<!%0D)%0A/);
    expect(m).toContain('&body=');
  });
  it('stays under the Windows ShellExecute limit for a realistic long page URL', () => {
    const longPage = 'https://incognitobrowser.io/resources/tools/social-media-privacy/screenshot-leak-checker';
    const longPlay = playUrl({ medium: 'cta', campaign: 'screenshot-leak-checker', content: 'social-media-privacy', term: 'tool' });
    expect(handoffMailto(longPlay, longPage).length).toBeLessThan(MAILTO_MAX_LENGTH);
  });
});

describe('stripHash', () => {
  it('removes a fragment and leaves everything else', () => {
    expect(stripHash('https://a.b/c?d=1#e')).toBe('https://a.b/c?d=1');
    expect(stripHash('https://a.b/c')).toBe('https://a.b/c');
  });
});

describe('pageLinkFor — nothing from the query string reaches the email body', () => {
  it('keeps origin + path only', () => {
    expect(pageLinkFor('https://a.b/tools/x/y?ref=CALL%200800%20NOW&utm=1#r=abc')).toBe('https://a.b/tools/x/y');
    expect(handoffMailBody(PLAY, PAGE + '?ref=CALL%200800')).not.toContain('CALL');
  });
  it('degrades safely on a non-URL string', () => {
    expect(pageLinkFor('/relative?x=1#h')).toBe('/relative');
  });
});

/**
 * The desktop / iPhone button (components/UpgradeButtons.tsx handoffLabel).
 *
 * This is the one upgrade button that reaches a visitor who cannot act on it
 * where they stand, so it has two jobs: name the platform, so nobody taps
 * expecting to finish here, and name the outcome they just saw evidence for.
 * It used to say only "Get Pro on Android", which did the first and dropped
 * the second (owner, 2026-09-17).
 */
describe('handoffLabel', () => {
  it('names the benefit and the platform, inside the button limit', async () => {
    const { handoffLabel, HANDOFF_LABEL } = await import('../components/UpgradeButtons');
    const { CARD_LIMITS, PRO_LINE } = await import('../lib/card-copy');
    for (const benefit of Object.keys(PRO_LINE)) {
      const label = handoffLabel(benefit);
      expect(label, benefit).not.toBe(HANDOFF_LABEL);
      expect(label, benefit).toMatch(/ on Android$/);
      expect(label.length, `${benefit}: "${label}"`).toBeLessThanOrEqual(CARD_LIMITS.button);
      // It never says how Pro is billed, and never names a price (owner, 2026-09-17).
      expect(label).not.toMatch(/subscri|billed|cancel|trial|\$|\/(week|month|year)/i);
    }
  });

  it('falls back to the plain platform label when no benefit reached the button', async () => {
    const { handoffLabel, HANDOFF_LABEL } = await import('../components/UpgradeButtons');
    expect(handoffLabel(undefined)).toBe(HANDOFF_LABEL);
    expect(handoffLabel('not-a-benefit')).toBe(HANDOFF_LABEL);
    expect(HANDOFF_LABEL).toMatch(/Android/);
  });
});
