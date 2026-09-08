/**
 * lib/link-unwrapper — redirect peeling, tracking-parameter classification
 * and clean-URL construction must be deterministic and never touch the
 * network. Same input → same output.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_HOPS,
  MAX_INPUT_LENGTH,
  TRACKING_PARAMS,
  analyzeLink,
  analyzeParams,
  base64Decode,
  decodeProofpointV2,
  decodeProofpointV3,
  decodeTarget,
  lookupParam,
  normalizeInput,
  unwrapRedirects,
} from '../lib/link-unwrapper';

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const enc = encodeURIComponent;

function okOrThrow(input: string) {
  const r = analyzeLink(input);
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r;
}

describe('normalizeInput', () => {
  it('prepends https:// when the scheme is missing, including host:port forms', () => {
    expect(normalizeInput('example.com/x?gclid=1')).toEqual({ ok: true, url: 'https://example.com/x?gclid=1' });
    expect(normalizeInput('localhost:3000/x')).toEqual({ ok: true, url: 'https://localhost:3000/x' });
    expect(normalizeInput('//cdn.example.com/a')).toEqual({ ok: true, url: 'https://cdn.example.com/a' });
  });

  it('strips the angle brackets and quotes mail clients wrap links in', () => {
    expect(normalizeInput('<https://example.com/>')).toEqual({ ok: true, url: 'https://example.com/' });
    expect(normalizeInput('"https://example.com/a"')).toEqual({ ok: true, url: 'https://example.com/a' });
  });

  it('rejects mailto:, tel: and other non-web schemes with a friendly message', () => {
    const m = normalizeInput('mailto:someone@example.com');
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.error).toMatch(/mailto: links are not supported/);
    const tel = normalizeInput('tel:+15551234567');
    expect(tel.ok).toBe(false);
    if (!tel.ok) expect(tel.error).toMatch(/tel: links are not supported/);
    expect(normalizeInput('ftp://example.com/file').ok).toBe(false);
    expect(normalizeInput('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects empty, over-long and unparseable input', () => {
    expect(normalizeInput('').ok).toBe(false);
    expect(normalizeInput('   ').ok).toBe(false);
    const long = normalizeInput('https://example.com/' + 'a'.repeat(MAX_INPUT_LENGTH));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toContain(String(MAX_INPUT_LENGTH));
    expect(normalizeInput('not a url at all').ok).toBe(false);
    expect(analyzeLink('mailto:a@b.co')).toEqual({ ok: false, error: expect.stringMatching(/mailto/) });
  });
});

describe('decodeTarget / base64Decode', () => {
  it('accepts absolute http(s) URLs as-is, percent-decoded once or twice, or base64', () => {
    expect(decodeTarget('https://example.com/a')).toBe('https://example.com/a');
    expect(decodeTarget('https%3A%2F%2Fexample.com%2Fa')).toBe('https://example.com/a');
    expect(decodeTarget('https%253A%252F%252Fexample.com%252Fa')).toBe('https://example.com/a');
    expect(decodeTarget(b64url('https://example.com/a?x=1'))).toBe('https://example.com/a?x=1');
    expect(decodeTarget(Buffer.from('http://example.org/p').toString('base64'))).toBe('http://example.org/p');
  });

  it('rejects relative paths, other schemes and non-URL base64', () => {
    expect(decodeTarget('/relative/path')).toBeNull();
    expect(decodeTarget('ftp://example.com')).toBeNull();
    expect(decodeTarget(b64url('just some words here'))).toBeNull();
    expect(decodeTarget('')).toBeNull();
    expect(decodeTarget(null)).toBeNull();
    expect(base64Decode('not*base64')).toBeNull();
    expect(base64Decode('YT9i')).toBe('a?b');
  });
});

describe('Proofpoint URL Defense', () => {
  it('v2 swaps - back to % and _ back to /', () => {
    expect(decodeProofpointV2('https-3A__example.com_path-3Fa-3D1-26b-3D2')).toBe('https://example.com/path?a=1&b=2');
    expect(decodeProofpointV2('garbage')).toBeNull();
  });

  it('v3 substitutes single * tokens and **X runs from the base64url payload', () => {
    // '?' → base64url 'Pw'
    expect(decodeProofpointV3('https://urldefense.com/v3/__https://example.com/path*a=1__;Pw!!AbC!xyz$')).toEqual({
      url: 'https://example.com/path?a=1',
      wrappedHost: 'example.com',
    });
    // 'a?b' → 'YT9i'; **B is a run of 3
    expect(decodeProofpointV3('https://urldefense.proofpoint.com/v3/__https://example.com/**Bx__;YT9i!!AbC!xyz$').url).toBe(
      'https://example.com/a?bx',
    );
    // No substitutions needed at all
    expect(decodeProofpointV3('https://urldefense.com/v3/__https://www.example.org/__;!!AbC!xyz$').url).toBe('https://www.example.org/');
  });

  it('v3 falls back to the wrapped host when the payload cannot supply the substitutions', () => {
    const r = decodeProofpointV3('https://urldefense.com/v3/__https://hidden.example.com/x*y__;!!AbC$');
    expect(r.url).toBeNull();
    expect(r.wrappedHost).toBe('hidden.example.com');

    const a = okOrThrow('https://urldefense.com/v3/__https://hidden.example.com/x*y__;!!AbC$');
    expect(a.redirectCount).toBe(0);
    expect(a.opaqueWrapper).toEqual({ vendor: 'Proofpoint', wrappedHost: 'hidden.example.com' });
    expect(a.severity).toBe('amber');
    expect(a.headline).toMatch(/wrapped by Proofpoint/);
  });

  it('v2 unwraps end to end through analyzeLink', () => {
    const a = okOrThrow('https://urldefense.proofpoint.com/v2/url?u=https-3A__example.com_path-3Fgclid-3Dabc123&d=DwMFaQ&c=x&r=y');
    expect(a.hops.map((h) => h.wrapper)).toEqual(['Proofpoint', undefined]);
    expect(a.finalUrl).toBe('https://example.com/path?gclid=abc123');
    expect(a.identityCount).toBe(1);
  });
});

describe('unwrapRedirects — known vendors', () => {
  const dest = 'https://example.com/deal?fbclid=IwAR1abc&utm_source=newsletter';

  it('Google /url?q=', () => {
    const r = unwrapRedirects(`https://www.google.com/url?q=${enc(dest)}&sa=D&source=editors`);
    expect(r.hops[0].wrapper).toBe('Google');
    expect(r.finalUrl).toBe(dest);
    expect(r.redirectCount).toBe(1);
    expect(unwrapRedirects(`https://google.co.uk/url?url=${enc(dest)}`).finalUrl).toBe(dest);
  });

  it('Facebook, Instagram, LinkedIn, YouTube, Tumblr, VK, Slack, Reddit', () => {
    expect(unwrapRedirects(`https://l.facebook.com/l.php?u=${enc(dest)}&h=AT0`).hops[0].wrapper).toBe('Facebook');
    expect(unwrapRedirects(`https://lm.facebook.com/l.php?u=${enc(dest)}`).finalUrl).toBe(dest);
    expect(unwrapRedirects(`https://l.instagram.com/?u=${enc(dest)}&e=AT1`).hops[0].wrapper).toBe('Instagram');
    expect(unwrapRedirects(`https://www.linkedin.com/redir/redirect?url=${enc(dest)}&urlhash=abc`).hops[0].wrapper).toBe('LinkedIn');
    expect(unwrapRedirects(`https://www.youtube.com/redirect?event=video_description&q=${enc(dest)}`).hops[0].wrapper).toBe('YouTube');
    expect(unwrapRedirects(`https://t.umblr.com/redirect?z=${enc(dest)}&t=tok`).hops[0].wrapper).toBe('Tumblr');
    expect(unwrapRedirects(`https://away.vk.com/away.php?to=${enc(dest)}&cc_key=`).hops[0].wrapper).toBe('VK');
    expect(unwrapRedirects(`https://slack-redir.net/link?url=${enc(dest)}`).hops[0].wrapper).toBe('Slack');
    expect(unwrapRedirects(`https://out.reddit.com/?url=${enc(dest)}`).hops[0].wrapper).toBe('Reddit');
    expect(unwrapRedirects(`https://out.reddit.com/?url=${enc(dest)}`).finalUrl).toBe(dest);
  });

  it('Microsoft Safe Links and Bing (a1 + base64url)', () => {
    const sl = unwrapRedirects(`https://nam02.safelinks.protection.outlook.com/?url=${enc(dest)}&data=05%7C01%7C&sdata=abc&reserved=0`);
    expect(sl.hops[0].wrapper).toBe('Microsoft Safe Links');
    expect(sl.finalUrl).toBe(dest);
    const bing = unwrapRedirects(`https://www.bing.com/ck/a?!&&p=abc&u=a1${b64url('https://example.com/landing')}&ntb=1`);
    expect(bing.hops[0].wrapper).toBe('Bing');
    expect(bing.finalUrl).toBe('https://example.com/landing');
  });

  it('a known vendor host without a decodable destination is reported as opaque, not skipped', () => {
    const r = unwrapRedirects('https://nam02.safelinks.protection.outlook.com/?data=05&reserved=0');
    expect(r.redirectCount).toBe(0);
    expect(r.opaque).toEqual({ vendor: 'Microsoft Safe Links', wrappedHost: undefined });
  });
});

describe('unwrapRedirects — generic wrappers and limits', () => {
  it('recognises /redirect|/redir|/click|/track|/link paths with a URL-bearing key (plain, double-encoded, base64)', () => {
    const d = 'https://shop.example.com/item?gclid=abc123';
    expect(unwrapRedirects(`https://mail.example.com/track/click?u=${b64url(d)}`).finalUrl).toBe(d);
    expect(unwrapRedirects(`https://news.example.com/redirect?url=${enc(enc(d))}`).finalUrl).toBe(d);
    expect(unwrapRedirects(`https://cdn.example.com/link?dest=${enc(d)}`).finalUrl).toBe(d);
    expect(unwrapRedirects(`https://cdn.example.com/redir?goto=${enc(d)}`).hops[0].wrapper).toBe('Generic redirect');
    // Redirect-ish path but no absolute URL in any known key → not a wrapper
    const not = unwrapRedirects('https://example.com/click?id=42&r=/relative');
    expect(not.redirectCount).toBe(0);
    expect(not.hops[0].wrapper).toBeUndefined();
    // Ordinary path with a url= param is not a wrapper either
    expect(unwrapRedirects(`https://example.com/search?url=${enc(d)}`).redirectCount).toBe(0);
  });

  it('follows a multi-vendor chain hop by hop', () => {
    const inner = 'https://example.com/deal?fbclid=IwAR1&utm_source=x';
    const google = `https://www.google.com/url?q=${enc(inner)}&sa=D`;
    const safe = `https://nam02.safelinks.protection.outlook.com/?url=${enc(google)}&data=05&reserved=0`;
    const r = unwrapRedirects(safe);
    expect(r.hops.length).toBe(3);
    expect(r.hops.map((h) => h.wrapper)).toEqual(['Microsoft Safe Links', 'Google', undefined]);
    expect(r.hops.map((h) => h.host)).toEqual(['nam02.safelinks.protection.outlook.com', 'www.google.com', 'example.com']);
    expect(r.finalUrl).toBe(inner);
    expect(r.hitHopLimit).toBe(false);
  });

  it(`stops after ${MAX_HOPS} hops and flags the limit`, () => {
    let url = 'https://example.com/final';
    for (let i = 0; i < MAX_HOPS + 2; i++) url = `https://r${i}.example.com/redirect?u=${enc(url)}`;
    const r = unwrapRedirects(url);
    expect(r.redirectCount).toBe(MAX_HOPS);
    expect(r.hops.length).toBe(MAX_HOPS + 1);
    expect(r.hitHopLimit).toBe(true);
    expect(r.finalUrl).not.toBe('https://example.com/final');
    expect(unwrapRedirects(url, 0)).toMatchObject({ redirectCount: 0, hitHopLimit: true });
  });
});

describe('parameter classification', () => {
  it('has every required key in the table, each with a vendor, class and a sentence', () => {
    const required = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid',
      'gclsrc', 'msclkid', 'ttclid', 'twclid', 'li_fat_id', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'hsCtaTracking', '__hssc', '__hstc',
      '__hsfp', 'vero_id', 'vero_conv', 'yclid', 'igshid', 'igsh', 'ref_src', 'ref_url', 's_cid', '_ga', '_gl', 'mkt_tok', 'oly_anon_id',
      'oly_enc_id', 'rb_clickid', 'sc_cid', 'ScCid', 'trk', 'trkCampaign', 'sc_campaign', 'sc_channel', 'spm', 'ncid', 'cmpid',
      'campaign_id', 'ad_id', 'adset_id', 'adgroupid', 'keyword', 'matchtype', 'device', 'placement', 'ck_subscriber_id', 'srsltid', 'si',
      'ss_source', 'ss_campaign_id', '_branch_match_id', '_branch_referrer', 'mkevt', 'mkcid', 'mkrid', 'campid', 'toolid', 'customid',
      'epik', 'pp', 'at_medium', 'at_campaign', 'wt_mc', 'ga_source', 'ga_medium', 'ga_campaign',
    ];
    for (const k of required) {
      expect(TRACKING_PARAMS[k], k).toBeDefined();
      expect(TRACKING_PARAMS[k].vendor.length, k).toBeGreaterThan(0);
      expect(['identity', 'campaign'], k).toContain(TRACKING_PARAMS[k].cls);
      expect(TRACKING_PARAMS[k].reveals, k).toMatch(/^[A-Z].+\.$/);
    }
  });

  it('classifies identity-level click IDs, campaign-level tags, and leaves unknowns as kept', () => {
    const identity = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'ttclid', 'twclid', 'li_fat_id', 'mc_eid', '_hsenc', 'vero_id',
      'yclid', 'igshid', 'igsh', 'oly_anon_id', 'oly_enc_id', 'ck_subscriber_id', '_branch_match_id', 'srsltid', 'epik', 'mkevt', 'rb_clickid', 'ScCid', 'sc_cid'];
    for (const k of identity) expect(lookupParam(k)?.cls, k).toBe('identity');
    const campaign = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'mc_cid', 'cmpid', 'campaign_id', 'gclsrc', 'trk', 'spm'];
    for (const k of campaign) expect(lookupParam(k)?.cls, k).toBe('campaign');
    expect(lookupParam('page')).toBeNull();
    expect(lookupParam('id')).toBeNull();
    expect(lookupParam('q')).toBeNull();
  });

  it('matches case-insensitively and treats any utm_* as campaign-level', () => {
    expect(lookupParam('SCCID')?.vendor).toBe('Snapchat');
    expect(lookupParam('FBCLID')?.cls).toBe('identity');
    expect(lookupParam('Utm_Source')?.cls).toBe('campaign');
    expect(lookupParam('utm_custom_thing')?.cls).toBe('campaign');
    expect(lookupParam('utm_custom_thing')?.vendor).toBe('UTM / Google Analytics');
  });

  it('analyzeParams reports where each parameter lives and preserves the original encoding of kept ones', () => {
    const r = analyzeParams('https://example.com/s?q=hello%20world&utm_source=x&page=2&fbclid=abc#utm_medium=share&sec=intro');
    expect(r.params.map((p) => [p.key, p.cls, p.where])).toEqual([
      ['q', 'kept', 'query'],
      ['utm_source', 'campaign', 'query'],
      ['page', 'kept', 'query'],
      ['fbclid', 'identity', 'query'],
      ['utm_medium', 'campaign', 'fragment'],
      ['sec', 'kept', 'fragment'],
    ]);
    expect(r.cleanUrl).toBe('https://example.com/s?q=hello%20world&page=2#sec=intro');
    expect(r.removedCount).toBe(3);
    expect(r.keptCount).toBe(3);
  });
});

describe('clean URL', () => {
  it('drops the ? entirely when every query parameter was tracking', () => {
    expect(analyzeParams('https://example.com/page?utm_source=a&utm_medium=b&gclid=c').cleanUrl).toBe('https://example.com/page');
  });

  it('keeps plain anchors, strips tracking from hash-router fragments, and drops an emptied fragment', () => {
    expect(analyzeParams('https://example.com/doc?utm_medium=email#section-2').cleanUrl).toBe('https://example.com/doc#section-2');
    expect(analyzeParams('https://app.example.com/#/dash?utm_source=x&view=1').cleanUrl).toBe('https://app.example.com/#/dash?view=1');
    expect(analyzeParams('https://app.example.com/#/dash?utm_source=x').cleanUrl).toBe('https://app.example.com/#/dash');
    expect(analyzeParams('https://example.com/p?id=42#fbclid=abc').cleanUrl).toBe('https://example.com/p?id=42');
  });

  it('drops embedded credentials and keeps a non-default port', () => {
    expect(analyzeParams('https://user:pw@example.com:8443/x?utm_source=a&keep=1').cleanUrl).toBe('https://example.com:8443/x?keep=1');
  });
});

describe('analyzeLink — verdicts', () => {
  it('red: identity-level ID inside a two-vendor redirect chain, with stats and share text', () => {
    const inner = 'https://example.com/deal?fbclid=IwAR1abc&utm_source=newsletter&ref=footer';
    const google = `https://www.google.com/url?q=${enc(inner)}&sa=D`;
    const safe = `https://nam02.safelinks.protection.outlook.com/?url=${enc(google)}&data=05&reserved=0`;
    const a = okOrThrow(safe);
    expect(a.severity).toBe('red');
    expect(a.headline).toBe('This link carried 2 trackers from 2 vendors across 2 redirects');
    expect(a.detail).toMatch(/1 identity-level ID \(Facebook \(Meta\)\) can tie this click to you personally/);
    expect(a.stats).toEqual([
      { label: 'Trackers', value: '2' },
      { label: 'Vendors', value: '2' },
      { label: 'Redirect hops', value: '2' },
      { label: 'Identity IDs', value: '1' },
    ]);
    expect(a.vendors).toEqual(['Facebook (Meta)', 'UTM / Google Analytics']);
    expect(a.identityVendors).toEqual(['Facebook (Meta)']);
    expect(a.cleanUrl).toBe('https://example.com/deal?ref=footer');
    expect(a.removedCount).toBe(2);
    expect(a.keptCount).toBe(1);
    expect(a.charsRemoved).toBeGreaterThan(100);
    expect(a.shareText).toMatch(/^This link carried 2 trackers from 2 vendors across 2 redirects\. 1 of them was an identity-level click ID \(Facebook \(Meta\)\)/);
  });

  it('amber: campaign-level tags only', () => {
    const a = okOrThrow('https://example.com/?utm_source=nl&utm_medium=email&utm_campaign=spring');
    expect(a.severity).toBe('amber');
    expect(a.headline).toBe('This link carried 3 trackers from 1 vendor');
    expect(a.identityCount).toBe(0);
    expect(a.campaignCount).toBe(3);
    expect(a.detail).toMatch(/Campaign tags only/);
    expect(a.shareText).toMatch(/tell example\.com where I came from/);
  });

  it('amber: redirect wrapping with no trackers at all', () => {
    const a = okOrThrow(`https://www.google.com/url?q=${enc('https://example.com/about')}&sa=D`);
    expect(a.severity).toBe('amber');
    expect(a.headline).toBe('This link passed through 1 redirect but carried no trackers');
    expect(a.trackerCount).toBe(0);
    expect(a.redirectCount).toBe(1);
    expect(a.cleanUrl).toBe('https://example.com/about');
  });

  it('amber: opaque shortener whose destination cannot be read without fetching', () => {
    const a = okOrThrow('https://bit.ly/3abcDEF');
    expect(a.severity).toBe('amber');
    expect(a.hiddenDestination).toEqual({ host: 'bit.ly' });
    expect(a.headline).toBe('This link hides its destination behind bit.ly');
    expect(okOrThrow('https://u1234.ct.sendgrid.net/ls/click?upn=abc').hiddenDestination?.host).toBe('u1234.ct.sendgrid.net');
  });

  it('green: a plain link with ordinary parameters is clean', () => {
    const a = okOrThrow('https://en.wikipedia.org/wiki/UTM_parameters?oldid=123#History');
    expect(a.severity).toBe('green');
    expect(a.headline).toBe('This link is clean');
    expect(a.stats.map((s) => s.value)).toEqual(['0', '0', '0', '0']);
    expect(a.params).toEqual([{ key: 'oldid', value: '123', cls: 'kept', where: 'query' }]);
    expect(a.cleanUrl).toBe('https://en.wikipedia.org/wiki/UTM_parameters?oldid=123#History');
    expect(a.removedCount).toBe(0);
    expect(a.charsRemoved).toBe(0);
  });

  it('is deterministic and adds https:// to bare hosts', () => {
    const a = okOrThrow('example.com/x?msclkid=abc&utm_term=shoes');
    const b = okOrThrow('example.com/x?msclkid=abc&utm_term=shoes');
    expect(a).toEqual(b);
    expect(a.startUrl).toBe('https://example.com/x?msclkid=abc&utm_term=shoes');
    expect(a.hops).toEqual([{ url: 'https://example.com/x?msclkid=abc&utm_term=shoes', host: 'example.com' }]);
    expect(a.severity).toBe('red');
  });

  it('never fetches: analysis of a URL to an unroutable host completes synchronously', () => {
    const a = analyzeLink('https://this-host-does-not-exist.invalid/redirect?u=' + enc('https://also.invalid/?gclid=1'));
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.redirectCount).toBe(1);
  });
});
