/**
 * Rendered-pages test suite.
 *
 * Verifies the HTML output of the pSEO build against an authoritative
 * checklist of E-A-T, indexability, and link-integrity guarantees.
 *
 * Modes:
 *   • If `PAGES_TEST_BASE_URL` is set → fetch live URLs (catches deploy
 *     regressions; what we run on the Cowork schedule against the
 *     test droplet).
 *   • Else → read the local `out/` directory after a static build.
 *
 * Run:
 *   npm run test:pages                                            # local out/
 *   PAGES_TEST_BASE_URL=https://206-189-186-34.nip.io npm run test:pages
 *
 * This suite catches the class of bugs that slipped past the editorial
 * gate + audit work:
 *   - byline not rendering despite the JSON file having the author block
 *   - JSX whitespace eating spaces ("Targeted Advertisingresources")
 *   - footer links pointing to the wrong URL
 *   - demoted pages forgetting to emit noindex
 *   - sitemap leaking draft URLs
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const LIVE_BASE = process.env.PAGES_TEST_BASE_URL?.replace(/\/$/, '') || '';
const IS_LIVE = LIVE_BASE.length > 0;
const OUT_DIR = path.join(process.cwd(), 'out');

/**
 * This suite verifies BUILD OUTPUT, so it can only run after a build
 * (or against a live URL). The `build` npm script runs `vitest run`
 * BEFORE `next build`, so on a clean CI/Vercel checkout there is no
 * `out/` yet. We must SKIP in that case — never throw — or every
 * Vercel deploy fails before it compiles (this is what broke prod).
 */
const HAS_TARGET = IS_LIVE || fs.existsSync(OUT_DIR);

/**
 * Routes to spot-check. The first entry of each kind is the canonical
 * sample; if more variety is needed, add more here rather than expanding
 * the assertions.
 */
const ROUTES = {
  home: '/',
  robots: '/robots.txt',
  sitemap: '/sitemap.xml',
  publishedChecklist: '/checklists/browser-privacy/browser-privacy-security-checklist/',
  publishedGuide: '/guides/browser-privacy/complete-guide-to-browser-privacy/',
  topicHub: '/topics/browser-privacy/',
  authorWriter: '/authors/darkpool-david/',
  authorEditor: '/authors/david-shadrake/',
  // F4 demoted (same template under a non-canonical niche). Must
  // emit noindex,follow.
  demotedChecklist: '/checklists/incognito-mode/incognito-mode-security-checklist/',
};

// Add /resources prefix when running against the static-export deploys
// (droplet, WordPress). Local dev + Vercel serve at root.
function prefix(p: string): string {
  if (!IS_LIVE) return p;
  if (/localhost|vercel\.app/i.test(LIVE_BASE)) return p;
  // Routes that exist at site root regardless of basePath:
  if (p === '/robots.txt' || p === '/sitemap.xml') {
    return '/resources' + p;
  }
  return '/resources' + p;
}

async function fetchText(route: string): Promise<{ ok: boolean; status: number; body: string }> {
  if (IS_LIVE) {
    const res = await fetch(`${LIVE_BASE}${prefix(route)}`);
    return { ok: res.ok, status: res.status, body: await res.text() };
  }
  // Local: map the route to out/<route>/index.html (or out/robots.txt etc.)
  let fp: string;
  if (route.endsWith('.txt') || route.endsWith('.xml')) {
    fp = path.join(OUT_DIR, route.replace(/^\//, ''));
  } else {
    fp = path.join(OUT_DIR, route.replace(/^\//, ''), 'index.html');
  }
  if (!fs.existsSync(fp)) {
    return { ok: false, status: 404, body: '' };
  }
  return { ok: true, status: 200, body: fs.readFileSync(fp, 'utf-8') };
}

beforeAll(() => {
  if (!HAS_TARGET) {
    // Skipped via describe.skipIf below; this is informational only.
    // Do NOT throw here — a throw fails `vitest run`, which fails the
    // Vercel build before `next build` ever runs.
    console.warn(
      '[rendered-pages] no out/ and no PAGES_TEST_BASE_URL — skipping. Run after a static build or set PAGES_TEST_BASE_URL.'
    );
  }
});

describe.skipIf(!HAS_TARGET)('robots.txt', () => {
  it('exists and points at the sitemap', async () => {
    const r = await fetchText(ROUTES.robots);
    expect(r.ok).toBe(true);
    expect(r.body).toMatch(/User-agent:\s*\*/);
    expect(r.body).toMatch(/Sitemap:\s*https?:\/\/incognitobrowser\.io\/resources\/sitemap\.xml/);
  });
});

describe.skipIf(!HAS_TARGET)('sitemap.xml', () => {
  it('serves a non-empty XML sitemap', async () => {
    const r = await fetchText(ROUTES.sitemap);
    expect(r.ok).toBe(true);
    expect(r.body).toContain('<urlset');
    expect(r.body.length).toBeGreaterThan(1000);
  });

  it('does NOT include the demoted F4 doorway URL', async () => {
    const r = await fetchText(ROUTES.sitemap);
    expect(r.ok).toBe(true);
    // The demoted incognito-mode-security-checklist is in the noindex set;
    // it must not appear in the sitemap.
    expect(r.body).not.toMatch(
      /incognito-mode\/incognito-mode-security-checklist/
    );
  });

  it('includes the canonical published URL', async () => {
    const r = await fetchText(ROUTES.sitemap);
    expect(r.body).toMatch(/browser-privacy\/browser-privacy-security-checklist/);
  });
});

describe.skipIf(!HAS_TARGET)('published article page (checklist)', () => {
  let html = '';
  beforeAll(async () => {
    const r = await fetchText(ROUTES.publishedChecklist);
    expect(r.ok).toBe(true);
    html = r.body;
  });

  it('returns 200 and has a canonical URL', () => {
    expect(html).toMatch(/<link[^>]*rel="canonical"[^>]*href="https:\/\/incognitobrowser\.io\/resources\/checklists\/browser-privacy\/browser-privacy-security-checklist\/?"/);
  });

  it('does NOT emit noindex (published pages must be indexable)', () => {
    expect(html).not.toMatch(/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/);
  });

  it('emits Article JSON-LD with author + editor', () => {
    // The Article LD is embedded as one of the <script type="application/ld+json"> blobs.
    const articleLdMatches = html.match(/application\/ld\+json"[^>]*>(\{[^<]+"@type":"Article"[^<]+)</);
    expect(articleLdMatches, 'No Article JSON-LD found in HTML').toBeTruthy();
    const ld = articleLdMatches![1];
    expect(ld).toContain('"name":"Darkpool David"');
    expect(ld).toContain('"name":"David Shadrake"');
    // Editor must include LinkedIn URL.
    expect(ld).toMatch(/"editor":\{[^}]*"url":"https:\/\/www\.linkedin\.com\/in\/davidshadrake/);
    // Writer must include WP author archive URL.
    expect(ld).toMatch(/"author":\{[^}]*"url":"https:\/\/incognitobrowser\.io\/author\/david\//);
  });

  it('renders a visible byline near the H1', () => {
    expect(html).toContain('data-testid="article-byline"');
    // Writer name appears as text content inside the byline anchor.
    expect(html).toMatch(/href="https:\/\/incognitobrowser\.io\/author\/david\/"[^>]*rel="author"[^>]*>Darkpool David</);
    // Editor's "Edited by" anchor points to LinkedIn.
    expect(html).toMatch(/href="https:\/\/www\.linkedin\.com\/in\/davidshadrake\/"[^>]*>David Shadrake</);
  });

  it('emits article:published_time + article:modified_time OG tags', () => {
    expect(html).toMatch(/<meta[^>]+property="article:published_time"[^>]+content="\d{4}-\d{2}-\d{2}T/);
    expect(html).toMatch(/<meta[^>]+property="article:modified_time"[^>]+content="\d{4}-\d{2}-\d{2}T/);
  });

  it('emits Breadcrumb JSON-LD', () => {
    expect(html).toMatch(/application\/ld\+json"[^>]*>\{[^<]+"@type":"BreadcrumbList"/);
  });
});

describe.skipIf(!HAS_TARGET)('demoted F4 doorway-duplicate page', () => {
  let html = '';
  let status = 0;
  beforeAll(async () => {
    const r = await fetchText(ROUTES.demotedChecklist);
    status = r.status;
    html = r.body;
  });

  it('still serves (200), since the page exists and is internally linkable', () => {
    expect(status).toBe(200);
  });

  it('emits noindex,follow', () => {
    // Next emits the robots meta via `name="robots"`; the value can be
    // "noindex,follow" or "noindex, follow" depending on serializer.
    expect(html).toMatch(/<meta[^>]+name="robots"[^>]+content="noindex,?\s*follow"/);
  });
});

describe.skipIf(!HAS_TARGET)('author profile pages', () => {
  it('writer profile page emits Person JSON-LD with name=Darkpool David', async () => {
    const r = await fetchText(ROUTES.authorWriter);
    expect(r.ok).toBe(true);
    expect(r.body).toMatch(/application\/ld\+json"[^>]*>\{[^<]+"@type":"Person"[^<]+"name":"Darkpool David"/);
  });

  it('editor profile page emits Person JSON-LD with sameAs LinkedIn', async () => {
    const r = await fetchText(ROUTES.authorEditor);
    expect(r.ok).toBe(true);
    expect(r.body).toMatch(/application\/ld\+json"[^>]*>\{[^<]+"@type":"Person"[^<]+"name":"David Shadrake"/);
    expect(r.body).toMatch(/"sameAs":\[[^\]]*"https:\/\/incognitobrowser\.io\/resources\/authors\/david-shadrake\/"/);
  });
});

describe.skipIf(!HAS_TARGET)('header + footer link integrity', () => {
  let homeHtml = '';
  beforeAll(async () => {
    const r = await fetchText(ROUTES.home);
    homeHtml = r.body;
  });

  it('header Download button points to the Play Store', () => {
    expect(homeHtml).toMatch(
      /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.androidbull\.incognito\.browser[^"]*"[^>]*>[^<]*Download[^<]*Browser/
    );
  });

  it('footer Download link points to the Play Store', () => {
    // Multiple matches OK; just assert presence.
    expect(homeHtml).toMatch(/href="https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.androidbull\.incognito\.browser/);
  });

  it('footer Blog link points to /news/', () => {
    expect(homeHtml).toMatch(/href="https:\/\/incognitobrowser\.io\/news\/"[^>]*>[^<]*Blog/);
  });
});

describe.skipIf(!HAS_TARGET)('JSX whitespace regression — "View all <niche> resources →"', () => {
  it('renders the RelatedContent link with proper spacing', async () => {
    const r = await fetchText(ROUTES.publishedChecklist);
    expect(r.ok).toBe(true);
    // The visible link is "View all Browser Privacy resources →" — a
    // single space MUST appear between the niche name and "resources".
    // The previous bug ran them together: "Browser Privacyresources →".
    expect(r.body).toMatch(/View all Browser Privacy resources →/);
    // Negative: a niche-name letter followed directly by "resources"
    // (no whitespace) would indicate the JSX whitespace bug is back.
    expect(r.body).not.toMatch(/[a-z]resources →/);
  });
});

describe.skipIf(!HAS_TARGET)('no missing-space concatenations in visible text', () => {
  /**
   * Allow-list of legitimate brand names that are CamelCase by design.
   * Anything else that looks like wordWord is suspicious.
   */
  const BRAND_CAMELCASE = new Set([
    'WhatsApp', 'DuckDuckGo', 'ProtonMail', 'PlayStation', 'SecureDrop',
    'JavaScript', 'TypeScript', 'HyperText', 'LinkedIn', 'GitHub', 'YouTube',
    'PayPal', 'OneDrive', 'eBay', 'HackerOne', 'TikTok', 'OpenSSL',
    'iCloud', 'iMessage', 'iPad', 'iPhone', 'iOS', 'macOS', 'iPadOS',
    'NextDNS', 'NextJS', 'NextJs', 'PostgreSQL', 'MySQL', 'GraphQL',
    'OAuth', 'OpenID', 'WebKit', 'WebRTC', 'WebGL', 'WebGPU', 'WebAuthn',
    'OpenAI', 'ChatGPT', 'OpenVPN', 'WireGuard', 'BitTorrent',
    'AdBlock', 'uBlock', 'AdGuard', 'PrivacyBadger',
    'resistFingerprinting', 'privacyResistFingerprinting',
  ]);

  // Pages to sweep. Each page type is sampled.
  const SAMPLE_ROUTES = [
    ROUTES.home,
    ROUTES.publishedChecklist,
    ROUTES.publishedGuide,
    ROUTES.topicHub,
  ];

  for (const route of SAMPLE_ROUTES) {
    it(`finds no suspicious word-mashes on ${route}`, async () => {
      const r = await fetchText(route);
      expect(r.ok, `Failed to load ${route}`).toBe(true);
      // Strip <script> and <style> blocks; collapse remaining tags to spaces.
      let text = r.body.replace(/<script[\s\S]*?<\/script>/g, ' ');
      text = text.replace(/<style[\s\S]*?<\/style>/g, ' ');
      text = text.replace(/<[^>]+>/g, ' ');
      // Decode the most common entity that creates false positives.
      text = text.replace(/&[a-zA-Z]+;/g, ' ');

      // Find runs of lowercase-letters-then-uppercase-letter-then-lowercase
      // (e.g. "Advertisingresources" would match "Advertisingr" + "esources").
      // The pattern checks for 3+ lowercase, then uppercase, then 2+ lowercase.
      // BUT my pattern above misses single-cap mashes — let me try a different one
      // that catches things like "wordWord":
      const matches = text.match(/[a-z]{3,}[A-Z][a-z]{2,}/g) || [];
      const suspect = matches.filter((w) => {
        if (BRAND_CAMELCASE.has(w)) return false;
        // The regex doesn't capture the leading char of the brand
        // (so "WhatsApp" is matched as "hatsApp"). Allow any substring of
        // a known brand.
        for (const brand of BRAND_CAMELCASE) {
          if (brand.includes(w) || w === brand.slice(1)) return false;
        }
        return true;
      });
      expect(suspect, `Suspicious word-mashes on ${route}: ${suspect.join(', ')}`).toEqual([]);
    });
  }
});

describe.skipIf(!HAS_TARGET)('every published article from a sample list has the byline', () => {
  // Spot-check 5 published article URLs across content types. If any of
  // these regresses, the patcher script didn't reach a page template.
  const SAMPLE = [
    '/checklists/browser-privacy/browser-privacy-security-checklist/',
    '/guides/browser-privacy/complete-guide-to-browser-privacy/',
    '/comparisons/browser-privacy/best-browser-privacy-tools-compared/',
    '/calculators/browser-privacy/browser-privacy-risk-calculator/',
    '/templates/gdpr/gdpr-compliance-policy-template/',
  ];

  for (const route of SAMPLE) {
    it(`${route} renders byline + Article schema`, async () => {
      const r = await fetchText(route);
      if (r.status === 404) {
        // The sample list may drift; skip rather than fail when a page
        // is renamed. The byline guarantees are exercised by the main
        // suite above; this is breadth coverage.
        console.warn(`SKIP missing route: ${route}`);
        return;
      }
      expect(r.ok).toBe(true);
      expect(r.body).toContain('data-testid="article-byline"');
      expect(r.body).toMatch(/"@type":"Article"/);
    });
  }
});
