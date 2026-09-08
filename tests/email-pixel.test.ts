/**
 * lib/email-pixel — the Email Tracking-Pixel Detector engine.
 *
 * Pure-logic coverage: MIME parsing (multipart, quoted-printable, base64),
 * pixel heuristics (tiny, hidden, known vendor, unknown), link wrapping and
 * destination recovery, header-based ESP identification, and the verdict.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeEmail,
  decodeBase64Text,
  decodeQuotedPrintable,
  extractDestination,
  extractHeaderHints,
  findTrackedLinks,
  findTrackingPixels,
  identifyVendor,
  parseEmail,
  parseHeaders,
  splitMultipart,
  EXAMPLE_EMAIL,
} from '../lib/email-pixel';

// ── Realistic multipart .eml: Mailchimp open pixel + SendGrid wrapped link ──
const MULTIPART_EML = [
  'Return-Path: <bounce-mc.us5_9876543210fedcba.1a2b3c4d5e-you=example.com@mail7.suw11.mcsv.net>',
  'From: Acme Weekly <news@acme.example>',
  'To: you@example.com',
  'Subject: Acme Weekly #42',
  'Date: Tue, 08 Sep 2026 08:00:00 +0000',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="=_boundary_42"',
  'X-Mailer: Mailchimp Mailer - **CID1a2b3c4d5e**',
  'X-MC-User: 9876543210fedcba',
  'List-Unsubscribe: <https://acme.us5.list-manage.com/unsubscribe?u=9876543210fedcba&id=1a2b3c4d5e&e=deadbeef01>',
  '',
  '--=_boundary_42',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: 7bit',
  '',
  'Acme Weekly #42 - read online: https://mailchi.mp/acme/weekly-42',
  '',
  '--=_boundary_42',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<html><body>',
  '<img src=3D"https://cdn.acme.example/img/header-600.png" width=3D"600" heig=',
  'ht=3D"150" alt=3D"Acme">',
  '<p><a href=3D"https://acme.us5.list-manage.com/track/click?u=3D9876543210fe=',
  'dcba&amp;id=3D0f1e2d3c4b&amp;e=3Ddeadbeef01">Read issue 42</a></p>',
  '<p><a href=3D"https://ct.sendgrid.net/ls/click?upn=3Du001.Zz9Yy8Xx7Ww6Vv5Uu=',
  '4Tt3Ss2Rr1Qq0Pp">Sponsor: try the thing</a></p>',
  '<p><a href=3D"https://www.acme.example/about">About us</a></p>',
  '<img src=3D"https://acme.us5.list-manage.com/track/open.php?u=3D9876543210f=',
  'edcba&amp;id=3D1a2b3c4d5e&amp;e=3Ddeadbeef01" height=3D"1" width=3D"1" alt=3D"">',
  '</body></html>',
  '',
  '--=_boundary_42--',
  '',
].join('\r\n');

// ── Clean plain-text email: no HTML, no images, no links ──
const CLEAN_PLAIN_TEXT = [
  'From: Jo Friend <jo@example.org>',
  'To: you@example.com',
  'Subject: Lunch on Thursday?',
  'Date: Tue, 08 Sep 2026 10:12:00 +0100',
  'Message-ID: <lunch-42@example.org>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: 7bit',
  'X-Mailer: Apple Mail (2.3774.600.62)',
  '',
  'Hey,',
  '',
  'Are you free for lunch on Thursday? The usual place at 12:30.',
  '',
  'Jo',
  '',
].join('\r\n');

// ── Quoted-printable single-part HTML with a hidden 1×1 from an unknown host ──
const QP_HTML_EMAIL = [
  'From: Shop <orders@shop.example>',
  'To: you@example.com',
  'Subject: Your order has shipped',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<html><body style=3D"font-family:Arial">',
  '<p>Your order <b>#10042</b> is on its way =E2=80=94 thanks for shopping w=',
  'ith us!</p>',
  '<img src=3D"https://beacons.shop.example/img/blank.gif?oid=3D10042&amp;t=3D=',
  'a9b8c7d6e5f4a3b2" style=3D"width:1px;height:1px;display:none;" alt=3D"">',
  '</body></html>',
].join('\r\n');

// ── Base64-encoded HTML part inside multipart/mixed → multipart/alternative ──
const BASE64_HTML_PART = [
  'PGh0bWw+PGJvZHk+PHA+SGkgPGI+dGhlcmU8L2I+PC9wPjxhIGhyZWY9Imh0dHBzOi8vZXhhbXBs',
  'ZS5vcmcvcmVwb3J0Ij5SZXBvcnQ8L2E+PGltZyBzcmM9Imh0dHBzOi8vdC5odWJzcG90ZW1haWwu',
  'bmV0L2UydC9vL2FiYzEyM2RlZjQ1NmdoaTc4OSIgd2lkdGg9IjEiIGhlaWdodD0iMSI+PC9ib2R5',
  'PjwvaHRtbD4=',
].join('\r\n');

const NESTED_BASE64_EML = [
  'From: Sales <rep@vendor.example>',
  'To: you@example.com',
  'Subject: Following up',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="outer"',
  'X-HubSpot-Sent: true',
  '',
  '--outer',
  'Content-Type: multipart/alternative; boundary="inner"',
  '',
  '--inner',
  'Content-Type: text/plain; charset="utf-8"',
  '',
  'Hi there',
  '',
  '--inner',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: base64',
  '',
  BASE64_HTML_PART,
  '',
  '--inner--',
  '',
  '--outer',
  'Content-Type: application/pdf; name="deck.pdf"',
  'Content-Disposition: attachment; filename="deck.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '',
  '--outer--',
  '',
].join('\r\n');

describe('decoders', () => {
  it('decodes quoted-printable escapes, soft line breaks and UTF-8 sequences', () => {
    expect(decodeQuotedPrintable('a=3Db=\r\nc =E2=80=94 d')).toBe('a=bc — d');
    expect(decodeQuotedPrintable('caf=E9', 'iso-8859-1')).toBe('café');
  });

  it('decodes base64 text ignoring line wrapping', () => {
    expect(decodeBase64Text('SGVs\r\nbG8gd29y\nbGQ=')).toBe('Hello world');
  });

  it('parses folded headers and multipart boundaries', () => {
    const headers = parseHeaders('Subject: Hello\r\n world\r\nX-Test: 1\r\n');
    expect(headers).toEqual([
      { name: 'Subject', value: 'Hello world' },
      { name: 'X-Test', value: '1' },
    ]);
    const parts = splitMultipart('preamble\r\n--b\r\nContent-Type: text/plain\r\n\r\nA\r\n--b\r\n\r\nB\r\n--b--\r\nepilogue', 'b');
    expect(parts).toHaveLength(2);
    expect(parts[1].trim()).toBe('B');
  });
});

describe('parseEmail', () => {
  it('extracts and decodes the quoted-printable HTML part of a multipart message', () => {
    const parsed = parseEmail(MULTIPART_EML);
    expect(parsed.hasHeaders).toBe(true);
    expect(parsed.htmlParts).toBe(1);
    expect(parsed.encodings).toContain('quoted-printable');
    expect(parsed.html).toContain('href="https://ct.sendgrid.net/ls/click?upn=u001.Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp"');
    expect(parsed.html).toContain('track/open.php?u=9876543210fedcba&amp;id=1a2b3c4d5e');
  });

  it('decodes a base64 HTML part nested two multipart levels deep and skips attachments', () => {
    const parsed = parseEmail(NESTED_BASE64_EML);
    expect(parsed.encodings).toContain('base64');
    expect(parsed.html).toContain('t.hubspotemail.net/e2t/o/');
    expect(parsed.text.trim()).toBe('Hi there');
    expect(parsed.html).not.toContain('JVBERi0xLjQK');
  });

  it('treats bare pasted HTML as the body, undoing leftover quoted-printable artefacts', () => {
    const bare = '<p>Hello</p><img src=3D"https://x.example/o.gif?id=3Dabc" width=3D"1" height=3D"1">';
    const parsed = parseEmail(bare);
    expect(parsed.hasHeaders).toBe(false);
    expect(parsed.html).toContain('src="https://x.example/o.gif?id=abc"');
  });
});

describe('findTrackingPixels', () => {
  it('flags tiny, hidden and known-vendor images but not ordinary content images', () => {
    const html = `
      <img src="https://cdn.example/logo.png" width="600" height="120">
      <img src="https://x.example/a.gif" width="1" height="1">
      <img src="https://x.example/b.gif" style="display:none;width:200px">
      <img src="https://x.example/c.gif" style="visibility:hidden">
      <img src="https://x.example/d.gif" style="opacity:0">
      <img src="https://example.us1.list-manage.com/track/open.php?u=1&id=2&e=3" width="300" height="300">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="1" height="1">
      <img src="cid:part1.abc@example" width="1" height="1">
    `;
    const { pixels, remoteImages } = findTrackingPixels(html);
    expect(remoteImages).toBe(6);
    expect(pixels.map((p) => p.src)).toEqual([
      'https://x.example/a.gif',
      'https://x.example/b.gif',
      'https://x.example/c.gif',
      'https://x.example/d.gif',
      'https://example.us1.list-manage.com/track/open.php?u=1&id=2&e=3',
    ]);
    expect(pixels[0].vendor).toBeNull();
    expect(pixels[0].reasons[0]).toMatch(/1×1/);
    expect(pixels[1].reasons).toContain('hidden with CSS (display:none)');
    expect(pixels[4].vendor).toBe('Mailchimp');
    expect(pixels[4].reasons).toContain('known Mailchimp tracking endpoint');
  });

  it('reads px dimensions from inline style and dedupes repeated pixel URLs', () => {
    const html = `
      <img src="https://x.example/p.gif?u=1" style="width:1px; height:1px; border:0">
      <img src="https://x.example/p.gif?u=1" style="width:1px; height:1px; border:0">
    `;
    const { pixels } = findTrackingPixels(html);
    expect(pixels).toHaveLength(1);
    expect(pixels[0].width).toBe(1);
    expect(pixels[0].height).toBe(1);
  });
});

describe('findTrackedLinks + destinations', () => {
  it('identifies vendor click wrappers, subdomain/path heuristics, and leaves plain links alone', () => {
    const html = `
      <a href="https://www.acme.example/about">About</a>
      <a href="mailto:hi@acme.example">Mail</a>
      <a href="https://acme.us5.list-manage.com/track/click?u=1&id=2&e=3">Mailchimp</a>
      <a href="https://ct.sendgrid.net/ls/click?upn=u001.abc">SendGrid</a>
      <a href="https://click.acme.example/ls/click?upn=u001.xyz">Custom domain</a>
      <a href="https://r20.rs6.net/tn.jsp?f=001abc&c=def&ch=ghi">Constant Contact</a>
      <a href="https://acme.example/lt.php?s=abc&i=1A2B&l=open">ActiveCampaign</a>
      <a href="https://t.yesware.com/tt/abc123/def456/ghi789/https%3A%2F%2Fwww.example.org%2Fpricing">Yesware</a>
    `;
    const { tracked, totalLinks } = findTrackedLinks(html);
    expect(totalLinks).toBe(7);
    expect(tracked.map((l) => [l.vendor, l.text])).toEqual([
      ['Mailchimp', 'Mailchimp'],
      ['SendGrid', 'SendGrid'],
      [null, 'Custom domain'],
      ['Constant Contact', 'Constant Contact'],
      ['ActiveCampaign', 'ActiveCampaign'],
      ['Yesware', 'Yesware'],
    ]);
    expect(tracked[2].reasons).toContain('tracking-style redirect host and path');
    expect(tracked[5].destination).toBe('https://www.example.org/pricing');
    expect(tracked[5].destinationHost).toBe('www.example.org');
  });

  it('recovers the real destination from percent-encoded and base64 query parameters', () => {
    const viaParam = extractDestination(new URL('https://go.acme.example/r?url=https%3A%2F%2Fwww.example.org%2Fdeal%3Fx%3D1&uid=42'));
    expect(viaParam?.destination).toBe('https://www.example.org/deal?x=1');
    expect(viaParam?.via).toBe('query parameter "url"');

    const b64 = Buffer.from('https://docs.example.org/guide').toString('base64');
    const viaB64 = extractDestination(new URL(`https://links.acme.example/c/${'0'.repeat(20)}?d=${b64}`));
    expect(viaB64?.destination).toBe('https://docs.example.org/guide');
    expect(viaB64?.via).toBe('base64 parameter "d"');

    expect(extractDestination(new URL('https://ct.sendgrid.net/ls/click?upn=u001.opaque'))).toBeNull();
  });

  it('identifies vendors from the URL table, with open/click roles and www marketing sites excluded', () => {
    expect(identifyVendor('https://email.mailgun.net/o/abc')).toMatchObject({ vendor: 'Mailgun', role: 'open' });
    expect(identifyVendor('https://email.mailgun.net/c/abc')).toMatchObject({ vendor: 'Mailgun', role: 'click' });
    expect(identifyVendor('https://mandrillapp.com/track/open.php?upn=1')).toMatchObject({ vendor: 'Mandrill' });
    expect(identifyVendor('https://r.superhuman.com/abc')).toMatchObject({ vendor: 'Superhuman', role: 'either' });
    expect(identifyVendor('https://www.superhuman.com/pricing')?.role).toBe('infra');
    expect(identifyVendor('https://www.example.org/')).toBeNull();
  });
});

describe('header hints + ESP guess', () => {
  it('maps platform headers to vendors and recognises personal mail clients', () => {
    const hints = extractHeaderHints(parseHeaders([
      'X-SG-EID: abc123',
      'X-Mailgun-Sid: xyz',
      'X-Mandrill-User: md_123',
      'X-SES-Outgoing: 2026.09.08-1.2.3.4',
      'X-PM-Message-Id: pm-1',
      'Feedback-ID: 1:2:3:hubspot',
      'X-CSA-Complaints: whitelist-complaints@eco.de',
      'X-Mailer: Microsoft Outlook 16.0',
    ].join('\r\n')));
    expect(hints.map((h) => h.vendor)).toEqual(['SendGrid', 'Mailgun', 'Mandrill', 'Amazon SES', 'Postmark', 'HubSpot', null, null]);
    expect(hints[7].note).toMatch(/Microsoft Outlook/);
  });

  it('weighs header evidence above pixel and link evidence', () => {
    const a = analyzeEmail(NESTED_BASE64_EML);
    expect(a.esp.name).toBe('HubSpot');
    expect(a.esp.confidence).toBe('high');
    expect(a.pixels).toHaveLength(1);
    expect(a.pixels[0].vendor).toBe('HubSpot');
    expect(a.trackedLinks).toHaveLength(0);
    expect(a.totalLinks).toBe(1);
  });
});

describe('analyzeEmail verdicts', () => {
  it('multipart .eml with a Mailchimp pixel and a SendGrid wrapped link is red, identifies Mailchimp', () => {
    const a = analyzeEmail(MULTIPART_EML);
    expect(a.severity).toBe('red');
    expect(a.headline).toBe('This email contains 1 tracking pixel and 2 tracked links (Mailchimp)');
    expect(a.pixels).toHaveLength(1);
    expect(a.pixels[0].vendor).toBe('Mailchimp');
    expect(a.trackedLinks.map((l) => l.vendor)).toEqual(['Mailchimp', 'SendGrid']);
    expect(a.totalLinks).toBe(3);
    expect(a.remoteImages).toBe(2);
    expect(a.nonPixelRemoteImages).toBe(1);
    expect(a.esp).toMatchObject({ name: 'Mailchimp', category: 'esp', confidence: 'high' });
    expect(a.vendors).toEqual(expect.arrayContaining(['Mailchimp', 'SendGrid']));
    expect(a.stats).toEqual([
      { label: 'Pixels', value: '1' },
      { label: 'Tracked links', value: '2 of 3' },
      { label: 'Remote images', value: '2' },
      { label: 'Sender platform', value: 'Mailchimp' },
    ]);
  });

  it('a clean plain-text email is green with nothing flagged', () => {
    const a = analyzeEmail(CLEAN_PLAIN_TEXT);
    expect(a.severity).toBe('green');
    expect(a.headline).toBe('No tracking pixels or tracked links found');
    expect(a.pixels).toHaveLength(0);
    expect(a.trackedLinks).toHaveLength(0);
    expect(a.remoteImages).toBe(0);
    expect(a.hasHtml).toBe(false);
    expect(a.esp.name).toBeNull();
    expect(a.esp.evidence[0]).toMatch(/Apple Mail/);
    expect(a.meaning.join(' ')).toMatch(/plain-text message/);
  });

  it('quoted-printable HTML with a hidden unknown-vendor pixel is red with "unknown vendor" semantics', () => {
    const a = analyzeEmail(QP_HTML_EMAIL);
    expect(a.severity).toBe('red');
    expect(a.pixels).toHaveLength(1);
    expect(a.pixels[0].vendor).toBeNull();
    expect(a.pixels[0].host).toBe('beacons.shop.example');
    expect(a.pixels[0].src).toBe('https://beacons.shop.example/img/blank.gif?oid=10042&t=a9b8c7d6e5f4a3b2');
    expect(a.pixels[0].reasons).toEqual(expect.arrayContaining(['1×1 pixel dimensions', 'hidden with CSS (display:none)']));
    expect(a.headline).toBe('This email contains 1 tracking pixel');
    expect(a.esp.name).toBeNull();
    expect(a.meaning.join(' ')).toMatch(/could not be matched to a known vendor/);
  });

  it('remote images without a pixel are amber; wrapped links without a pixel are amber', () => {
    const images = analyzeEmail('<html><body><img src="https://cdn.example/hero.jpg" width="600" height="300"></body></html>');
    expect(images.severity).toBe('amber');
    expect(images.headline).toBe('No tracking pixels, but 1 remote image can still reveal when you open it');
    expect(images.hasHeaders).toBe(false);

    const links = analyzeEmail('<p><a href="https://ct.sendgrid.net/ls/click?upn=u001.abc">Go</a></p>');
    expect(links.severity).toBe('amber');
    expect(links.headline).toBe('No tracking pixels, but 1 tracked link report your clicks (SendGrid)');
    expect(links.esp.confidence).toBe('low');
  });

  it('the bundled example email demonstrates every panel', () => {
    const a = analyzeEmail(EXAMPLE_EMAIL);
    expect(a.severity).toBe('red');
    expect(a.headline).toBe('This email contains 2 tracking pixels and 3 tracked links (Mailchimp)');
    expect(a.pixels.map((p) => p.vendor)).toEqual(['Mailchimp', null]);
    expect(a.trackedLinks.map((l) => l.vendor)).toEqual(['Mailchimp', 'SendGrid', 'Mailchimp']);
    expect(a.totalLinks).toBe(5);
    expect(a.remoteImages).toBe(3);
    expect(a.headerHints.some((h) => h.header === 'X-Mailer' && h.vendor === 'Mailchimp')).toBe(true);
    expect(a.encodings).toEqual(['quoted-printable']);
  });

  it('never throws on garbage, empty, or truncated input', () => {
    expect(analyzeEmail('').severity).toBe('green');
    // Missing closing boundary (message cut off mid-download): the part is still scanned.
    expect(analyzeEmail('Content-Type: multipart/alternative; boundary="x"\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<img src="https://a.example/o.gif" width=1 height=1>').pixels).toHaveLength(1);
    expect(() => analyzeEmail('<img src="http://[::1"><a href="https://%zz">x</a>')).not.toThrow();
    expect(analyzeEmail('﻿From: a@b.c\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n!!!not base64!!!').severity).toBe('green');
  });
});
