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
/**
 * A local out/ is only graded when its marker (scripts/write-build-marker.mjs)
 * says it is the FREE STATIC export at /resources — a leftover Pro export, a
 * partial build, or an iCloud conflict copy was otherwise judged with these
 * expectations and failed or passed for the wrong reasons (audit 2026-09-08).
 */
function localOutIsFreeStatic(): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(OUT_DIR, '.build-marker.json'), 'utf-8')) as { target?: string; tier?: string; basePath?: string };
    const ok = m.target === 'static' && m.tier === 'free' && m.basePath === '/resources';
    if (!ok) console.warn(`[rendered-pages] out/ marker is ${JSON.stringify(m)} — not the free static export; skipping.`);
    return ok;
  } catch {
    if (fs.existsSync(OUT_DIR)) console.warn('[rendered-pages] out/ has no .build-marker.json — run scripts/write-build-marker.mjs after the export; skipping.');
    return false;
  }
}
const HAS_TARGET = IS_LIVE || localOutIsFreeStatic();

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
    expect(r.body).toMatch(/User-agent:\s*\*/i);
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
      /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.androidbull\.incognito\.browser[^"]*"[\s\S]{0,400}?Download[^<]*Browser/
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
      // A missing sample page is a failure, not a skip. With the build marker
      // this suite only ever grades a complete free export (or a live site),
      // so a 404 here means the page really is gone — the old "skip when
      // renamed" branch turned a stale, partial build into a green run
      // (audit 2026-09-08). Rename the sample entry if a page moves.
      expect(r.status, `${route} must exist — update SAMPLE if the page was renamed`).not.toBe(404);
      expect(r.ok).toBe(true);
      expect(r.body).toContain('data-testid="article-byline"');
      expect(r.body).toMatch(/"@type":"Article"/);
    });
  }
});

describe.skipIf(!HAS_TARGET)('tool pages are indexable (regression guard)', () => {
  // Tools were excluded from the editorial backfill, so they had no editorial
  // block, isPublished() returned false, and EVERY tool page shipped to
  // production with noindex and no sitemap entry. Nothing caught it.
  it('a flagship tool page does NOT emit noindex', async () => {
    const r = await fetchText('/tools/vpn-privacy/whats-my-ip/');
    expect(r.ok).toBe(true);
    expect(r.body).not.toMatch(/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/);
  });

  it('the sitemap includes tool URLs', async () => {
    const r = await fetchText(ROUTES.sitemap);
    const n = (r.body.match(/\/tools\//g) || []).length;
    // 46 tool pages − 22 Pro-engine pages (Pro deployment only) − 6 drafted
    // quiz duplicates = 18 published free tool URLs.
    expect(n).toBeGreaterThanOrEqual(18);
  });

  it('a deliberately drafted duplicate quiz emits noindex and is absent from the sitemap', async () => {
    const r = await fetchText('/tools/email-privacy/privacy-score-quiz/');
    expect(r.status).toBe(200);
    expect(r.body).toMatch(/<meta[^>]+name="robots"[^>]+content="noindex,?\s*follow"/);
    const s = await fetchText(ROUTES.sitemap);
    expect(s.body).not.toMatch(/email-privacy\/privacy-score-quiz/);
  });
});

describe.skipIf(!HAS_TARGET)('website privacy report cards', () => {
  it('a report card page renders grade, itemised deductions, canonical, and is indexable', async () => {
    const r = await fetchText('/site/cnn.com/');
    expect(r.ok).toBe(true);
    expect(r.body).toMatch(/data-grade="[ABCDF]"/);
    expect(r.body).toMatch(/Every point, itemised/);
    expect(r.body).toMatch(/rel="canonical"[^>]*href="https:\/\/incognitobrowser\.io\/resources\/site\/cnn\.com\/?"/);
    expect(r.body).not.toMatch(/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/);
    expect(r.body).toMatch(/\/site\/methodology/);
  });

  it('a report card satisfies the pSEO internal-link rule (siblings + cross-category + hubs ≥ 12)', async () => {
    const r = await fetchText('/site/cnn.com/');
    const siblings = (r.body.match(/href="[^"]*\/site\/[a-z0-9.-]+\/?"/g) || []).length;
    const related = (r.body.match(/href="[^"]*\/(guides|checklists|comparisons|tools|templates|calculators)\/[^"]+"/g) || []).length;
    expect(siblings + related).toBeGreaterThanOrEqual(12);
    expect(r.body).toMatch(/View all [^<]+? resources →/); // niche names may contain &amp;
  });

  it('the index lists sites with grades and links to the methodology', async () => {
    const r = await fetchText('/site/');
    expect(r.ok).toBe(true);
    expect((r.body.match(/data-grade="/g) || []).length).toBeGreaterThan(100);
    expect(r.body).toMatch(/\/site\/methodology/);
  });

  it('the sitemap includes report cards', async () => {
    const r = await fetchText(ROUTES.sitemap);
    expect((r.body.match(/\/site\/[a-z0-9.-]+<\/loc>/g) || []).length).toBeGreaterThanOrEqual(400);
  });
});

/**
 * Free / Pro split (2026-09-08: "pro tools are still in the free privacy
 * tools catalogue" → clean division). Pro-engine tool pages live ONLY on the
 * Pro deployment. On the free site they must not be built, must not be in
 * the sitemap, and must not be linked from ANY page — a link to a page that
 * does not exist here is a 404 for users and a dead edge for crawlers.
 * The Pro path list is derived from data/ so the guard follows the data.
 */
describe.skipIf(!HAS_TARGET)('free/Pro split — Pro tools are absent from the free site', () => {
  const PRO_ENGINES = new Set(['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer']);
  const toolsRoot = path.join(process.cwd(), 'data', 'tools');
  const byNiche: Record<string, { slug: string; pro: boolean; published: boolean }[]> = {};
  for (const niche of fs.readdirSync(toolsRoot)) {
    const d = path.join(toolsRoot, niche);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')) as { toolEngine?: string; editorial?: { status?: string } };
      (byNiche[niche] ||= []).push({ slug: f.replace(/\.json$/, ''), pro: PRO_ENGINES.has(j.toolEngine || ''), published: j.editorial?.status === 'published' });
    }
  }
  const PRO_PATHS = Object.entries(byNiche).flatMap(([n, ts]) => ts.filter(t => t.pro).map(t => `/tools/${n}/${t.slug}`));
  const FREE_PATHS = Object.entries(byNiche).flatMap(([n, ts]) => ts.filter(t => !t.pro).map(t => `/tools/${n}/${t.slug}`));
  // Drafted free tools (the 6 quiz duplicates) render with noindex and stay out of the sitemap by design.
  const FREE_PUBLISHED_PATHS = Object.entries(byNiche).flatMap(([n, ts]) => ts.filter(t => !t.pro && t.published).map(t => `/tools/${n}/${t.slug}`));
  const proOnlyNiche = Object.entries(byNiche).find(([, ts]) => ts.length > 0 && ts.every(t => t.pro))?.[0];
  const mixedOrFreeNiche = Object.entries(byNiche).find(([, ts]) => ts.some(t => !t.pro))?.[0];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Same-site hrefs only: absolute links to the Pro deployment are the intended hand-off.
  const sameSiteHref = (p: string) => new RegExp(`href="(?:/resources)?${esc(p)}/?"`);

  it('derives the agreed 22 Pro tool paths and the free ones from data (free grew with the funnel tools)', () => {
    expect(PRO_PATHS.length).toBe(22);
    expect(FREE_PATHS.length).toBeGreaterThanOrEqual(24);
    // 6 privacy-quiz duplicates are deliberate drafts: built (noindex) but never listed.
    expect(FREE_PATHS.length - FREE_PUBLISHED_PATHS.length).toBe(6);
  });

  it('builds no Pro-engine tool page, and still builds every free one', async () => {
    for (const p of PRO_PATHS) {
      const r = await fetchText(p + '/');
      expect(r.status, `${p} must not exist on the free site`).toBe(404);
    }
    for (const p of FREE_PATHS) {
      const r = await fetchText(p + '/');
      expect(r.ok, `${p} must still exist on the free site`).toBe(true);
    }
  }, 120_000);

  it('keeps every Pro-engine URL out of the sitemap', async () => {
    const r = await fetchText(ROUTES.sitemap);
    expect(r.ok).toBe(true);
    for (const p of PRO_PATHS) expect(r.body, p).not.toMatch(new RegExp(`${esc(p)}/?</loc>`));
    for (const p of FREE_PUBLISHED_PATHS) expect(r.body, p).toMatch(new RegExp(`${esc(p)}/?</loc>`));
  });

  it('the tools catalogue lists free tools only', async () => {
    const r = await fetchText('/tools/');
    expect(r.ok).toBe(true);
    for (const p of PRO_PATHS) expect(r.body, `catalogue links ${p}`).not.toMatch(sameSiteHref(p));
    for (const p of FREE_PUBLISHED_PATHS) expect(r.body, `catalogue lost ${p}`).toMatch(sameSiteHref(p));
    // Drafted duplicates render (noindex) but must not be advertised here.
    for (const p of FREE_PATHS.filter((x) => !FREE_PUBLISHED_PATHS.includes(x))) expect(r.body, `catalogue advertises draft ${p}`).not.toMatch(sameSiteHref(p));
  });

  it('a niche whose only tools are Pro has no tool hub; a niche with a free tool keeps its hub', async () => {
    expect(proOnlyNiche, 'expected at least one Pro-only niche in data').toBeTruthy();
    expect(mixedOrFreeNiche).toBeTruthy();
    expect((await fetchText(`/tools/${proOnlyNiche}/`)).status).toBe(404);
    expect((await fetchText(`/tools/${mixedOrFreeNiche}/`)).ok).toBe(true);
  });

  it('report cards hand scanning off to the Pro deployment by absolute link, never a same-site Pro path', async () => {
    for (const route of ['/site/cnn.com/', '/site/', '/site/methodology/']) {
      const r = await fetchText(route);
      expect(r.ok, route).toBe(true);
      expect(r.body, route).toMatch(/href="https?:\/\/[^"]+\/tools\/ad-tracking\/cookie-tracker-scanner"/);
      expect(r.body, route).not.toMatch(sameSiteHref('/tools/ad-tracking/cookie-tracker-scanner'));
    }
  });

  it('no page anywhere in the site links to a Pro-engine tool page (whole-export link audit)', async () => {
    const offenders: string[] = [];
    const check = (name: string, html: string) => {
      for (const p of PRO_PATHS) if (sameSiteHref(p).test(html)) offenders.push(`${name} → ${p}`);
    };
    if (IS_LIVE) {
      // Live: audit the surfaces most likely to list tools plus one of each content type.
      const sample = ['/', '/tools/', '/site/', '/site/methodology/', '/site/cnn.com/', ROUTES.topicHub,
        `/topics/${proOnlyNiche}/`, ROUTES.publishedGuide, ROUTES.publishedChecklist, ...FREE_PATHS.slice(0, 3).map(p => p + '/')];
      for (const route of sample) {
        const r = await fetchText(route);
        expect(r.ok, route).toBe(true);
        check(route, r.body);
      }
    } else {
      // Static export: every HTML file in out/.
      const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []);
      const files = walk(OUT_DIR);
      expect(files.length).toBeGreaterThan(1000);
      for (const f of files) check(path.relative(OUT_DIR, f), fs.readFileSync(f, 'utf-8'));
    }
    expect(offenders, offenders.slice(0, 10).join('\n')).toEqual([]);
  }, 120_000);
});

/**
 * Wayfinding (2026-09-08): every index page carries the same search box,
 * clickable letter bar and server-rendered A–Z list (modelled on the
 * Privacy Glossary), so the full alphabetized catalogue is in the HTML for
 * crawlers and no-JS visitors, and the search is a client-side enhancement.
 */
describe.skipIf(!HAS_TARGET)('index pages: search + clickable A–Z catalogue', () => {
  const INDEXES: Array<[string, string, number]> = [
    ['/tools/', 'tools', 20], ['/guides/', 'guides', 40], ['/checklists/', 'checklists', 40], ['/comparisons/', 'comparisons', 40],
    ['/templates/', 'templates', 40], ['/calculators/', 'calculators', 40], ['/glossary/', 'terms', 50], ['/site/', 'websites', 400],
  ];
  for (const [route, noun, min] of INDEXES) {
    it(`${route} has a search box, letter links, and ≥${min} alphabetized entries in the HTML`, async () => {
      const r = await fetchText(route);
      expect(r.ok, route).toBe(true);
      expect(r.body).toMatch(new RegExp(`data-catalogue="${noun}" data-count="(\\d+)"`));
      expect(r.body).toMatch(/<input[^>]*type="search"/);
      expect((r.body.match(/href="#letter-[A-Z]"/g) || []).length).toBeGreaterThanOrEqual(5);
      expect((r.body.match(/catalogue-entry/g) || []).length).toBeGreaterThanOrEqual(min);
      expect(r.body).toMatch(/id="letter-[A-Z]"/);
      expect((r.body.match(/topic-chip/g) || []).length, `${route} topic chips`).toBeGreaterThanOrEqual(5);
    });
  }
  it('layout: search + letters at the top, page content in the middle, the A–Z list at the bottom', async () => {
    const tools = await fetchText('/tools/');
    const controls = tools.body.indexOf('data-catalogue="tools"');
    const featured = tools.body.indexOf('data-featured-tools');
    const list = tools.body.indexOf('id="a-to-z"');
    expect(controls).toBeGreaterThan(0);
    expect(featured).toBeGreaterThan(controls);
    expect(list).toBeGreaterThan(featured);
    const site = await fetchText('/site/');
    expect(site.body.indexOf('Most aggressive tracking')).toBeGreaterThan(site.body.indexOf('data-catalogue="websites"'));
    expect(site.body.indexOf('id="a-to-z"')).toBeGreaterThan(site.body.indexOf('Most aggressive tracking'));
    for (const route of ['/guides/', '/glossary/']) {
      const r = await fetchText(route);
      expect(r.body.indexOf('id="a-to-z"'), route).toBeGreaterThan(r.body.indexOf('href="#letter-'));
    }
  });
});

/**
 * Funnel surfaces (2026-09-08). The result moment must exist in the HTML:
 * report cards carry the funnel block; the tools catalogue on the free
 * site points at Incognito Pro for the Pro-only tools; Play links never
 * carry an unrendered template literal; the header serves phones.
 */
describe.skipIf(!HAS_TARGET)('funnel surfaces', () => {
  it('report cards render the result-moment funnel with a Play referrer that names the grade', async () => {
    const r = await fetchText('/site/cnn.com/');
    expect(r.ok).toBe(true);
    expect(r.body).toMatch(/data-report-card-funnel="[A-F]"/);
    expect(r.body).toMatch(/data-result-cta="(red|amber|green|info)"/);
    expect(r.body).toMatch(/data-scorecard="report-card"/);
    expect(r.body).not.toMatch(/\{grade/);
    expect(r.body).toMatch(/utm_medium%3Dcta[^"]*utm_content%3Dgrade-[A-F]/);
  });
  it('every Play link on sampled pages carries an attributed referrer and no template residue', async () => {
    for (const route of ['/', '/tools/', ROUTES.publishedGuide, '/site/google.com/']) {
      const r = await fetchText(route);
      const links = r.body.match(/href="https:\/\/play\.google\.com[^"]*"/g) || [];
      expect(links.length, route).toBeGreaterThan(0);
      for (const l of links) {
        expect(l, route).toMatch(/referrer=utm_source%3D(resources|pro)%26utm_medium%3D/);
        expect(l, route).not.toMatch(/[{}]/);
      }
    }
  });
  it('the free tools catalogue points at Incognito Pro for the Pro-only tools and features What\'s My IP', async () => {
    const r = await fetchText('/tools/');
    expect(r.body).toMatch(/href="https:\/\/[^"]+\/tools"[^>]*>Incognito Pro/);
    expect(r.body).toMatch(/WebRTC Leak Test/);
  });
  it('the header serves phones: a no-JS menu and an always-visible CTA', async () => {
    const r = await fetchText('/tools/');
    expect(r.body).toMatch(/<details[^>]*lg:hidden/);
    expect(r.body).toMatch(/Get app/);
  });
  it('content pages carry a "Check yours now" proof route to a free tool', async () => {
    for (const route of [ROUTES.publishedGuide, ROUTES.publishedChecklist]) {
      const r = await fetchText(route);
      expect(r.body, route).toMatch(/data-check-yours="[a-z0-9-]+"/);
      expect(r.body, route).toMatch(/href="[^"]*\/tools\/[a-z0-9-]+\/[a-z0-9-]+\/?"[^>]*>Run the check/);
    }
  });
});

/**
 * Funnel completeness (2026-09-08): reported live — the Privacy Score
 * Calculator's finished screen had the Pro CTA and the scorecard, but no
 * "What to do now" block, because its niche's checklists are still drafts
 * (digital-footprint, encrypted-messaging). nextStepsFor() now falls back
 * to a related niche's checklist, then to the tool's own tips, so this can
 * never silently disappear. This guard covers EVERY published free tool
 * page, not a sample, and would have caught the original gap.
 */
describe.skipIf(!HAS_TARGET)('every published free tool renders "What to do now"', () => {
  const PRO_ENGINES = ['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer'];
  const toolsRoot = path.join(process.cwd(), 'data', 'tools');
  const publishedFreeTools: string[] = [];
  for (const niche of fs.readdirSync(toolsRoot)) {
    const d = path.join(toolsRoot, niche);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8'));
      if (PRO_ENGINES.includes(j.toolEngine)) continue;
      if (j.editorial?.status !== 'published') continue;
      publishedFreeTools.push(`/tools/${niche}/${f.replace(/\.json$/, '')}`);
    }
  }

  it('found every published free tool page from data/tools (sanity check on the test itself)', () => {
    expect(publishedFreeTools.length).toBeGreaterThanOrEqual(20);
  });

  it.each(publishedFreeTools)('%s renders a non-empty next-steps block', async (route) => {
    const r = await fetchText(route + '/');
    expect(r.ok, route).toBe(true);
    expect(r.body, route).toMatch(/data-next-steps="[^"]+"/);
  });
});
