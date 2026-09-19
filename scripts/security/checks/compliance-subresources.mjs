/**
 * ePrivacy Art. 5(3): the site owes no consent banner only for as long as it
 * loads nothing from anyone else.
 *
 * Today that is true — the built export references exactly three hosts, and
 * all three are anchor hrefs a visitor chooses to follow (the droplet itself,
 * play.google.com, incognitobrowser.io). A link is not a load, so none of them
 * put anything on a third party's server without the visitor deciding to.
 *
 * One Google Fonts <link>, one YouTube embed, one analytics snippet changes
 * that. It would set the site's storage/consent posture from "exempt" to
 * "needs a banner", contradict the product's entire positioning, and — because
 * IN-APP-BRIDGE.md renders these pages inside the Android app's WebView — ship
 * a third-party beacon inside the app.
 *
 * WHERE THIS CHECK ACTUALLY EARNS ITS PLACE. The live CSP is
 * `default-src 'self'; … connect-src 'self'; font-src 'self' data:`
 * (scripts/droplet-htaccess.conf), so a fonts.googleapis.com stylesheet or an
 * XHR to an analytics endpoint is already refused by the browser at runtime.
 * This check is the second line for those. But `img-src 'self' data: blob:
 * https:` allows ANY https host, so an external tracking pixel is the one
 * third-party load the runtime control does not stop — for <img> this file is
 * the only control there is. Do not "simplify" it away as redundant with the
 * CSP; read that directive again first.
 *
 * DELIBERATELY NOT FLAGGED, and why:
 *   - anchor hrefs (<a href>). A link is a navigation the visitor chooses.
 *   - xmlns / schema.org @context. Namespace identifiers, never fetched. They
 *     live in <svg> attributes and JSON-LD script bodies, neither of which is
 *     scanned as a subresource here.
 *   - data:, blob:, about:, mailto:, tel:, incognitobrowser:// and #fragments.
 *   - public/adtest/*. The ad-blocker bait files are ad-shaped on purpose and
 *     are served from our own origin; they are same-origin loads, not
 *     third-party ones, and nothing here keys on a file's NAME.
 *   - data/sites/*.json, 500 scanned third-party sites (vercel.com among
 *     them). That is the product's subject matter. Only the emitted HTML and
 *     CSS of the export are read, and only their subresource attributes.
 *   - the RSC flight payload. <script> bodies are stripped before tag
 *     scanning, so escaped markup inside self.__next_f.push() cannot forge a
 *     hit; the script tags' own src attributes are read before the strip.
 *
 * The reviewer cut one sub-check that was in the design: regexing
 * out/_next/static/chunks/*.js for absolute https:// literals. It fires today
 * on staging.ufile.io in a chunk, which is an anchor href, not a fetch target,
 * and a regex cannot tell those apart. That destination is guarded properly by
 * cmp-upgrade-cta-destination instead.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

/** Every file under `dir` with one of `exts`, depth-first. */
function walk(dir, exts, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, acc);
    else if (exts.some((e) => entry.name.endsWith(e))) acc.push(p);
  }
  return acc;
}

/** Schemes that fetch nothing from a third party, plus the app's own scheme. */
const INERT = /^(?:data:|blob:|about:|javascript:|mailto:|tel:|sms:|#|incognitobrowser:)/i;

/**
 * Subresource attributes only. Each entry is [what it is, the tag regex, the
 * attribute to read]. <a href> is absent on purpose — see the header.
 */
const TAG_RULES = [
  ['script[src]', /<script\b[^>]*>/gi, 'src'],
  ['link[href]', /<link\b[^>]*>/gi, 'href'],
  ['img[src]', /<img\b[^>]*>/gi, 'src'],
  ['img[srcset]', /<img\b[^>]*>/gi, 'srcset'],
  ['iframe[src]', /<(?:iframe|frame|embed)\b[^>]*>/gi, 'src'],
  ['object[data]', /<object\b[^>]*>/gi, 'data'],
  ['media[src]', /<(?:video|audio|source|track)\b[^>]*>/gi, 'src'],
  ['use[href]', /<use\b[^>]*>/gi, 'href'],
  ['media[poster]', /<video\b[^>]*>/gi, 'poster'],
];

/** rel values that make a <link> a real load. `alternate`/`canonical` are not. */
const LOADING_REL = /\b(?:stylesheet|preconnect|dns-prefetch|preload|prefetch|modulepreload|icon|apple-touch-icon|manifest)\b/i;

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
}

/** Every subresource URL in one HTML document, with what kind of load it is. */
function subresourcesIn(html) {
  const found = [];
  // Script srcs come off the opening tags BEFORE bodies are stripped; then the
  // bodies go, so escaped markup inside the RSC flight payload cannot forge a
  // tag hit.
  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    const src = attr(tag, 'src');
    if (src) found.push(['script[src]', src]);
  }
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const [kind, rx, name] of TAG_RULES) {
    if (kind === 'script[src]') continue;
    for (const tag of markup.match(rx) || []) {
      if (kind === 'link[href]' && !LOADING_REL.test(attr(tag, 'rel') || '')) continue;
      const raw = attr(tag, name);
      if (!raw) continue;
      // srcset is a comma-separated candidate list, each "url descriptor".
      const urls = name === 'srcset' ? raw.split(',').map((c) => c.trim().split(/\s+/)[0]) : [raw];
      for (const u of urls) if (u) found.push([kind, u]);
    }
  }
  // url(...) inside inline <style> blocks.
  for (const block of markup.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []) {
    for (const m of block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) found.push(['css url()', m[1].trim()]);
  }
  return found;
}

/** The host of a URL, or null when it names no host (relative, or inert). */
function foreignHost(url, ownHosts) {
  const u = url.replace(/&amp;/g, '&').trim();
  if (!u || INERT.test(u)) return null;
  if (u.startsWith('//')) {
    const h = u.slice(2).split(/[/?#]/)[0].toLowerCase();
    return ownHosts.has(h) ? null : h;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // relative or root-relative: our own origin
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return null; }
  return ownHosts.has(host) ? null : host;
}

export default check({
  id: 'cmp-no-third-party-subresources',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['build-output'],
  describe: 'No third-party script, stylesheet, image, iframe or font in the built export — the property that keeps the site consent-exempt and stops a tracking pixel img-src would allow.',
  async run(ctx) {
    const out = join(ctx.repoRoot, 'out');
    // A missing export is not a pass. The every-commit suite runs after the
    // build in CI; on a laptop it says so rather than reporting green over
    // nothing — the exact failure this whole suite was written against.
    if (!existsSync(out) || !statSync(out).isDirectory()) {
      throw new Skip('no static export at out/ — run `npm run build` (or `npx next build`) first');
    }
    let ownHosts = new Set();
    try { ownHosts.add(new URL(ctx.origin).hostname.toLowerCase()); } catch { /* origin unparseable */ }

    const files = [...walk(out, ['.html'], []), ...walk(out, ['.css'], [])];
    if (!files.length) throw new Skip(`out/ exists but holds no .html or .css — an empty or half-written export`);

    const findings = [];
    const seen = new Map(); // host -> first sighting, so 1400 pages of the same chrome are one finding
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      const rel = relative(ctx.repoRoot, file);
      const hits = file.endsWith('.css')
        ? [...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)].map((m) => ['css url()', m[1].trim()])
        : subresourcesIn(text);
      for (const [kind, url] of hits) {
        const host = foreignHost(url, ownHosts);
        if (!host) continue;
        if (!seen.has(host)) seen.set(host, { kind, url, rel, count: 0 });
        seen.get(host).count += 1;
      }
    }
    for (const [host, s] of seen) {
      findings.push(finding({
        severity: 'high',
        title: `Third-party subresource: ${host}`,
        detail: `The export loads ${s.kind} from ${host}, a host that is not this site's own origin. A subresource is fetched without the visitor choosing to, which is what ePrivacy Art. 5(3) and the site's "we load nothing from anyone else" positioning turn on — and these pages also render inside the Android app's WebView. If it is an <img>, note that the live CSP's img-src allows any https host, so nothing stops it at runtime either.`,
        evidence: `${s.kind} -> ${s.url}\nfirst seen in ${s.rel}; ${s.count} occurrence(s) across ${files.length} built file(s)`,
        remediation: `Self-host the asset under public/, or drop it. If it is genuinely required, it needs a CSP directive in scripts/droplet-htaccess.conf and a consent decision — not a quiet addition.`,
        file: s.rel,
      }));
    }
    return { findings, checked: files.length };
  },
});
