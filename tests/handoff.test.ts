/**
 * lib/handoff — the bytes behind "Email me the link".
 *
 * Regression guard for the Windows failure reported 2026-09-08: the body used
 * bare "\n" line breaks, which RFC 6068 forbids and Outlook on Windows drops.
 * (The other Windows cause, no registered mailto handler, is handled in
 * components/ResultCta.tsx with a blur-detection fallback.)
 */
import { describe, expect, it } from 'vitest';
import { handoffMailBody, handoffMailto, stripHash, pageLinkFor, MAILTO_MAX_LENGTH } from '../lib/handoff';
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
