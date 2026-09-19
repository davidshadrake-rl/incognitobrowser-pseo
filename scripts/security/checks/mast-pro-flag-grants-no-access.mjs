/**
 * `?pro=1` changes words. It must never decide what runs, and it must never
 * travel in a link we publish.
 *
 * Three places in this repo state the first half flatly — IN-APP-BRIDGE.md:26
 * ("Anyone can type it, so never use it to grant anything"), lib/in-app.ts:21
 * ("Copy only, never access"), lib/track.ts:42 — and the repo has already
 * broken it once. Until 2026-09-18 the boot script set <html data-ib-pro> on
 * the parameter alone, so one link with ?inapp=1&pro=1 hid every upgrade band
 * (app/globals.css:173) and opened all three Pro tool gates
 * (components/useUpgradeGate.tsx) for the rest of that tab, on the open web,
 * for whoever clicked it. lib/in-app.ts now requires the app's own bridge
 * object or a user agent that names the app before the mark is set.
 *
 * That fix is graded by pentest-gate-inventory (source) and by
 * mast-boot-script-shipped-intact / mast-live-inapp-page-probe (artifact and
 * live). This check grades the two things neither of them can see:
 *
 *   A. WHO READS THE MARK. An allowlist of the modules allowed to consume
 *      inAppPro() / shouldGate() / <html data-ib-pro>, held in
 *      scripts/security/data/mast-in-app-consumers.json with a stated role for
 *      each. The allowlist is the entire point: a new consumer fails the build
 *      until someone adds it deliberately, which forces "does this grant
 *      access?" to be asked at review time instead of at incident time. Three
 *      modules read it today and the boundary is only defensible while that
 *      stays true.
 *
 *   B. WHETHER WE PUBLISH THE FLAG OURSELVES. The boot script strips inapp and
 *      pro from the address bar so a shared link never carries them — and then
 *      a single hardcoded href in editorial copy, a canonical, or a sitemap
 *      entry would hand them to every visitor and every crawler anyway.
 *      scripts/audit-links.mjs checks that hrefs RESOLVE, not what query
 *      strings they carry, so nothing covers this.
 *
 * DELIBERATELY NOT SCANNED for part B: data/ (500 scanned third-party sites,
 * whose real URLs are not ours to police), public/adtest/ (ad-shaped bait
 * files, deliberately), and anything under tests/ or scripts/security/, which
 * must be able to write the flag in order to assert something about it.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

const SOURCE_DIRS = ['app', 'components', 'lib'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

/**
 * Comments are where this repo DISCUSSES the flag, at length and correctly.
 * app/layout.tsx:58 and every doc block in lib/in-app.ts name data-ib-pro in
 * prose. Grading prose would flag the explanation of the rule as a breach of
 * it, so comments come out before anything is matched.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'out') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export default check({
  id: 'mast-pro-flag-grants-no-access',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The app\'s visitor-supplied pro flag is read by an allowlisted set of modules only, and no page we build publishes a link that carries it.',
  async run(ctx) {
    const dirs = SOURCE_DIRS.filter((d) => existsSync(join(ctx.repoRoot, d)));
    if (!dirs.length) throw new Skip(`none of ${SOURCE_DIRS.join(', ')} exist — nothing to walk`);

    const allow = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts', 'security', 'data', 'mast-in-app-consumers.json'), 'utf-8'));
    const allowed = new Map((allow.proFlagConsumers || []).map((e) => [e.path, e]));
    if (!allowed.size) throw new Skip('mast-in-app-consumers.json lists no proFlagConsumers — an empty allowlist would make every consumer a finding');

    const files = dirs.flatMap((d) => walk(join(ctx.repoRoot, d))).filter((f) => SOURCE_EXT.test(f));
    if (!files.length) throw new Skip(`no source files under ${dirs.join(', ')}`);

    const findings = [];
    let checked = 0;
    const seen = new Set();

    for (const abs of files) {
      const rel = relative(ctx.repoRoot, abs).split(sep).join('/');
      const code = stripComments(readFileSync(abs, 'utf-8'));
      checked++;

      // ---- A. who reads the mark ---------------------------------------
      const reads = [];
      if (/\bimport\s+[^;]*\binAppPro\b[^;]*from/.test(code) || /\binAppPro\s*\(/.test(code)) reads.push('inAppPro()');
      if (/\bimport\s+[^;]*\bshouldGate\b[^;]*from/.test(code) || /\bshouldGate\s*\(/.test(code)) reads.push('shouldGate()');
      if (/data-ib-pro/.test(code)) reads.push('<html data-ib-pro>');
      if (reads.length) {
        seen.add(rel);
        if (!allowed.has(rel)) {
          const line = code.split('\n').findIndex((l) => /inAppPro|shouldGate|data-ib-pro/.test(l)) + 1;
          findings.push(finding({
            severity: 'medium', file: rel, line: line || null,
            title: `${rel} reads the app's pro flag and is not on the allowlist`,
            detail: 'The mark behind inAppPro() originates in a query parameter anyone can type into a link. It is confirmed by the app\'s bridge object before it is acted on, which makes it safe for wording and for hiding upgrade asks — and unsafe for anything that grants access, costs the server work, or returns data the free tier does not hold. A new reader has to be examined against that line, not discovered later.',
            evidence: `${rel} uses ${reads.join(', ')}; scripts/security/data/mast-in-app-consumers.json lists only ${[...allowed.keys()].join(', ')}`,
            remediation: 'If this consumer only changes wording, add it to mast-in-app-consumers.json with the reason. If it decides whether something runs, it is an access-control decision resting on a URL parameter — say so out loud before adding it.',
          }));
        }
      }

      // ---- B. do we publish the flag ourselves -------------------------
      // Two shapes: a literal href/url carrying the flag, and an absolute link
      // with the flag in its query string. InAppBridge.tsx's
      // `u.searchParams.set('pro','1')` is deliberately not this shape — it
      // rewrites a link at click time, inside the app, and never ships a page
      // with the flag baked in.
      const link = /(?:href|url|canonical|loc)\s*[:=]\s*["'`][^"'`]*[?&](?:inapp|pro)=1/i.exec(code)
        || /["'`]https?:\/\/[^"'`\s]*[?&](?:inapp|pro)=1/i.exec(code);
      if (link) {
        const line = code.slice(0, link.index).split('\n').length;
        findings.push(finding({
          severity: 'medium', file: rel, line,
          title: `${rel} builds a link that carries the app's in-app flags`,
          detail: 'The boot script strips inapp and pro from the address bar precisely so a link copied out of the app never carries them. A link we publish with the flags baked in undoes that for every visitor and every crawler that follows it: they get the in-app labelling on the open web, and on any build where pro=1 alone is acted on, the upgrade asks hidden and the Pro tool gates open for the rest of the tab.',
          evidence: `${rel}:${line}: ${link[0].slice(0, 160)}`,
          remediation: 'Drop the parameters from the link. The app adds them when it opens a page; nothing we publish should.',
        }));
      }
    }

    // ---- C. the display-only mechanism is still the CSS ------------------
    // useUpgradeGate.tsx:24-27 says why this matters in its own words: the CSS
    // that hides the upgrade bands and the JavaScript that opens the gates key
    // off the SAME attribute on purpose, "and a second, different rule in
    // JavaScript is how the two drift apart". If the CSS rule goes, hiding has
    // either stopped happening or moved into code, and the allowlist above is
    // grading the wrong surface.
    const cssPath = join(ctx.repoRoot, 'app', 'globals.css');
    if (existsSync(cssPath)) {
      checked++;
      const css = readFileSync(cssPath, 'utf-8');
      if (!/html\[data-ib-pro\][^{]*\{[^}]*display:\s*none/.test(css)) {
        findings.push(finding({
          severity: 'low', file: 'app/globals.css',
          title: 'The pro flag no longer hides the upgrade bands in CSS',
          detail: 'One attribute, two consumers: a CSS rule that hides the bands and one attribute read in shouldGate(). That symmetry is deliberate. If the hiding has moved into JavaScript, there are now two rules that can disagree about who is a subscriber, which is the drift components/useUpgradeGate.tsx warns about by name.',
          evidence: 'app/globals.css: no `html[data-ib-pro] … { display: none }` rule found',
          remediation: 'Keep the hiding in CSS keyed off the same attribute shouldGate() reads.',
        }));
      }
    }

    // An allowlist entry whose file has stopped reading the flag is stale, and
    // stale entries are how an allowlist quietly stops being a boundary.
    for (const [path, entry] of allowed) {
      checked++;
      if (!seen.has(path)) {
        findings.push(finding({
          severity: 'info', file: path,
          title: `The pro-flag allowlist still names ${path}, which no longer reads the flag`,
          detail: 'Not a vulnerability. But an allowlist accumulates dead entries until nobody trusts it enough to question a live one, and this one is only useful while every line on it is load-bearing.',
          evidence: `scripts/security/data/mast-in-app-consumers.json lists ${path} (role: ${entry.role}); no reference to inAppPro/shouldGate/data-ib-pro found there`,
          remediation: 'Remove the entry.',
        }));
      }
    }

    return { findings, checked };
  },
});
