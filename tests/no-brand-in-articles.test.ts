/**
 * Brand leftovers, in the two places the wave-3 verifier found them.
 *
 * 1. Articles never name our app or point at it. The five article types
 *    (guides, checklists, templates, calculators, glossary) are written for
 *    the reader, not for the product: nothing in them may say "Incognito
 *    Browser" or "Incognito Pro", link to /incognito-browser or
 *    /tools/incognito-browser, or name incognitobrowser.io or the
 *    com.androidbull package. The author, editor and editorial blocks are
 *    exempt: a byline legitimately carries an incognitobrowser.io profile URL.
 *    Everything else needs an entry in KEPT below, with a reason.
 *
 * 2. A tool's tips never pair our app with a claim data/brand.json forbids.
 *    The browser-privacy notes used to read "Use a browser that patches
 *    WebRTC…", "Use a privacy browser that randomizes your canvas
 *    fingerprint…" and then "Incognito Browser gives you built-in privacy
 *    protections with no setup" — three lines that together promise the
 *    fingerprint protection brand.json says we never claim, on 11 pages. So
 *    the never-claim patterns run twice over data/tools: over any single
 *    string that names our app (rule A), and over the other lines of a tips
 *    or mistakes list that names our app, where an unattributed "use a
 *    privacy browser that…" reads as us (rule B). Naming the browser that
 *    actually does it — Tor Browser, Mullvad Browser, Brave, Firefox — is the
 *    way to give that advice, so a line that names one passes.
 *
 *    Rule B is per list, not per page: a tips list recommends browsers, while
 *    the mistakes beside it warn about them ("Assuming incognito/private mode
 *    makes you anonymous"), which is not a claim about ours.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ARTICLE_TYPES = ['guides', 'checklists', 'templates', 'calculators', 'glossary'] as const;

/** Our app, by name, by URL path, by site and by Play package. */
const BRAND = /incognito-browser|incognitobrowser\.|androidbull|\bIncognito (Browser|Pro)\b/i;

/** Bylines, not body copy: their profile URLs are meant to be ours. */
const BYLINE_BLOCKS = ['author', 'editor', 'editorial'];

interface Str {
  file: string;
  /** JSON path, e.g. `sections[2].items[1].id`. */
  path: string;
  /** The same path with the indexes dropped, e.g. `sections[].items[].id`. */
  field: string;
  value: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Every string in `data/<dir>`, minus the byline blocks, with where it sits. */
function stringsIn(dir: string): Str[] {
  const out: Str[] = [];
  for (const file of walk(path.join(ROOT, 'data', dir)).sort()) {
    const rel = path.relative(ROOT, file);
    const visit = (value: unknown, at: string) => {
      if (typeof value === 'string') {
        out.push({ file: rel, path: at, field: at.replace(/\[\d+\]/g, '[]'), value });
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, `${at}[${i}]`));
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (!at && BYLINE_BLOCKS.includes(k)) continue;
          visit(v, at ? `${at}.${k}` : k);
        }
      }
    };
    visit(JSON.parse(fs.readFileSync(file, 'utf8')), '');
  }
  return out;
}

const ARTICLE_STRINGS = ARTICLE_TYPES.flatMap((t) => stringsIn(t));

/**
 * The brand strings the corpus still carries on purpose. Each is unrendered
 * or generic English; anything else is a leftover. Fix one of these and
 * delete its entry in the same commit — the second test keeps the list honest.
 */
const KEPT: Array<{ file: string; field: string; value: RegExp; why: string }> = [
  // Two saved-tick ids (wave 3, batch 7). Renaming them resets one tick per
  // visitor, so the owner decides; ChecklistPage does render them into the DOM.
  {
    file: 'data/checklists/search-history/search-history-privacy-privacy-hardening-checklist.json',
    field: 'sections[].items[].id',
    value: /^incognito-browser$/,
    why: 'checklist item id kept so saved ticks survive',
  },
  {
    file: 'data/checklists/search-history/search-history-privacy-security-checklist.json',
    field: 'sections[].items[].id',
    value: /^incognito-browser$/,
    why: 'checklist item id kept so saved ticks survive',
  },
  // Keywords are not rendered and not indexed; the incognito-mode topic keeps
  // the phrase because that is what the topic is called (wave 3, batch 1).
  ...[
    'data/guides/incognito-mode/advanced-incognito-mode-techniques.json',
    'data/guides/incognito-mode/complete-guide-to-incognito-mode.json',
    'data/guides/incognito-mode/incognito-mode-for-beginners.json',
    'data/checklists/incognito-mode/incognito-mode-security-checklist.json',
  ].map((file) => ({ file, field: 'keywords[]', value: /^incognito browser/i, why: 'unrendered keyword for the incognito-mode topic' })),
  // Generic English: an "incognito browser window" is any browser's private window.
  {
    file: 'data/guides/password-security/advanced-password-security-management-techniques.json',
    field: 'steps[].warning',
    value: /private\/incognito browser window/i,
    why: 'any browser’s private window, not our app',
  },
];

const isKept = (s: Str) => KEPT.some((k) => k.file === s.file && k.field === s.field && k.value.test(s.value));

describe('articles never name or point at our app', () => {
  it('no guide, checklist, template, calculator or glossary entry mentions it', () => {
    const found = ARTICLE_STRINGS.filter((s) => BRAND.test(s.value) && !isKept(s)).map((s) => `${s.file} ${s.path}: ${s.value}`);
    expect(found.sort()).toEqual([]);
  });

  it('lists the ids and fields kept on purpose, so a fix retires its entry', () => {
    const kept = ARTICLE_STRINGS.filter((s) => BRAND.test(s.value) && isKept(s)).map((s) => `${s.file} ${s.path}: ${s.value}`);
    expect(kept.sort()).toEqual([
      'data/checklists/incognito-mode/incognito-mode-security-checklist.json keywords[4]: incognito browser',
      'data/checklists/search-history/search-history-privacy-privacy-hardening-checklist.json sections[2].items[1].id: incognito-browser',
      'data/checklists/search-history/search-history-privacy-security-checklist.json sections[2].items[1].id: incognito-browser',
      'data/guides/incognito-mode/advanced-incognito-mode-techniques.json keywords[2]: incognito browser tips',
      'data/guides/incognito-mode/complete-guide-to-incognito-mode.json keywords[2]: incognito browser',
      'data/guides/incognito-mode/incognito-mode-for-beginners.json keywords[2]: incognito browser',
      'data/guides/password-security/advanced-password-security-management-techniques.json steps[3].warning: Always test new passwords in a private/incognito browser window before logging out of the original session.',
    ]);
  });
});

// --- data/tools: never-claims in the notes --------------------------------------

interface BrandFile {
  neverClaim: string[];
}
const BRAND_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brand.json'), 'utf8')) as BrandFile;

/**
 * One entry per data/brand.json neverClaim, in the wording tips use. These
 * are the patterns of tests/no-vpn-claims.test.ts, without its denial
 * machinery: a tip gives advice, so there is nothing here to deny, and a tool
 * page is no place to start.
 */
const NEVER_CLAIM: Record<string, RegExp> = {
  'built-in VPN': /\bVPNs?\b|\bvirtual\s+private\s+networks?\b|\bprox(?:y|ies)\b|\btunnel(?:s|ed|ing|led|ling)?\b/i,
  // Naming the Tor Browser product, as pages that compare it do, isn't a claim about us.
  Tor: /\bTor\b(?!\s+(?:Browser|Project)\b)|\bonion\b/i,
  'open source': /\bopen[- ]?source|\bGitHub\b/i,
  'no data collection / collects nothing':
    /\b(?:no|zero|without(?:\s+any)?)\s+(?:personal\s+|user\s+)?data\s+(?:collection|collected|retention|logging|logs|stored|storage)\b|\bcollects?\s+(?:no|nothing|zero)\b|\b(?:doesn't|does\s+not|don't|do\s+not|never|won't)\s+(?:\w+\s+)?collect\b|\bnothing\s+(?:is\s+)?(?:collected|stored|logged)\b|\bzero[- ](?:data|logs?|knowledge|retention)\b|\bno[- ]logs?\b/i,
  'tracker-free / no trackers':
    /\btracker[- ]free\b|\b(?:no|zero)\s+(?:third[- ]party\s+)?trackers?\b|\bno\s+tracking\b|\bwithout\s+(?:any\s+)?(?:trackers|tracking)\b|\b(?:doesn't|does\s+not|never|won't)\s+track\b|\bblock(?:s|ing)?\s+(?:\S+\s+){0,2}?trackers\b|\btracker\s+(?:blocking|blocker)\b|\banti[- ]?tracking\b/i,
  'anti-fingerprinting or fingerprint protection':
    /fingerprint|\bcanvas\b|\bwebgl\b|\binstalled\s+fonts\b|\bfont\s+(?:lists?|enumeration|detection)\b|\brecogni[sz](?:e|es|ed|ing)\s+(?:you|your\s+(?:device|phone|browser))\b|\btell(?:s|ing)?\s+(?:you|your\s+(?:device|phone|browser))\s+apart\b/i,
  'works on all platforms / iOS / desktop':
    /\ball\s+(?:major\s+|the\s+|your\s+)?(?:platforms|devices|operating\s+systems)\b|\bcross[- ]platform\b|\bmulti[- ](?:device|platform)\b|\bdesktop\b(?!\s+(?:versions?|sites?|mode|view|pages?)\b)|\biOS\b|\biPhones?\b|\biPads?\b|\bmacOS\b|\bMac\b|\bWindows\b|\bLinux\b|\bChromebooks?\b/,
  'voted best by Android Authority': /\bAndroid\s+Authority\b|\bvoted\b|\baward[- ]winning\b/i,
  'an aggregateRating in structured data': /\baggregate\s*rating\b/i,
};

/** Our app by name. Plain "incognito mode" is Chrome's feature, not us. */
const OURS = /\bIncognito\s+(?:Browser|Pro)\b/i;
/** A line that says which product does the thing is advice, not a hint about ours. */
const NAMES_A_PRODUCT = /\b(?:Tor Browser|Tor Project|Mullvad|Brave|Firefox|LibreWolf|Chromium|Chrome|Safari|Edge|Vivaldi|Opera|DuckDuckGo|uBlock|Bitwarden|1Password)\b/;

const claimsIn = (text: string) =>
  Object.entries(NEVER_CLAIM)
    .filter(([, re]) => re.test(text))
    .map(([claim]) => claim);

/** Rule B: what a list that names our app implies through its other lines. */
const unattributedClaims = (list: string[]): string[] =>
  list.some((t) => OURS.test(t))
    ? list.filter((t) => !OURS.test(t) && !NAMES_A_PRODUCT.test(t)).flatMap((t) => claimsIn(t).map((c) => `${c}: ${t}`))
    : [];

const TOOL_STRINGS = stringsIn('tools');
const TOOL_FILES = walk(path.join(ROOT, 'data', 'tools'))
  .sort()
  .map((file) => ({
    file: path.relative(ROOT, file),
    data: JSON.parse(fs.readFileSync(file, 'utf8')) as { educational?: { tips?: string[]; commonMistakes?: string[] } },
  }));

describe("tool notes stay inside data/brand.json's never-claims", () => {
  it("the patterns cover exactly brand.json's neverClaim list", () => {
    expect(Object.keys(NEVER_CLAIM).sort()).toEqual([...BRAND_JSON.neverClaim].sort());
  });

  it('catches the tips that were live, and lets their replacement through', () => {
    const live = [
      'Enable Do Not Track in your browser settings, even though not all sites honor it',
      'Use a browser that patches WebRTC to prevent IP address leaks, especially when using a VPN',
      'Use a privacy browser that randomizes your canvas fingerprint to prevent unique identification',
      'Regularly clear cookies and site data to reduce persistent tracking',
      'Incognito Browser gives you built-in privacy protections with no setup',
    ];
    expect(unattributedClaims(live)).toEqual([
      'built-in VPN: Use a browser that patches WebRTC to prevent IP address leaks, especially when using a VPN',
      'anti-fingerprinting or fingerprint protection: Use a privacy browser that randomizes your canvas fingerprint to prevent unique identification',
    ]);
    // The same advice, attributed: the browsers that actually do it are named.
    expect(
      unattributedClaims([
        'Fingerprinting is fought two ways: Tor Browser and Mullvad Browser make every user look alike, while Brave randomizes the canvas and WebGL readings each site gets',
        'Incognito Browser runs every tab in private mode and wipes history, cookies and sessions when you close it',
      ]),
    ).toEqual([]);
    // Rule A: one string that both names us and makes the claim.
    expect(claimsIn('Incognito Browser blocks trackers and bundles a free VPN')).toEqual(['built-in VPN', 'tracker-free / no trackers']);
  });

  it('no string that names our app makes a never-claim', () => {
    const found = TOOL_STRINGS.filter((s) => OURS.test(s.value) && claimsIn(s.value).length).map(
      (s) => `${s.file} ${s.path}: [${claimsIn(s.value).join(', ')}] ${s.value}`,
    );
    expect(found).toEqual([]);
  });

  it('no tips or mistakes list that names our app leaves a never-claim to an unnamed "privacy browser"', () => {
    const found: string[] = [];
    for (const { file, data } of TOOL_FILES) {
      for (const key of ['tips', 'commonMistakes'] as const) {
        for (const claim of unattributedClaims(data.educational?.[key] ?? [])) found.push(`${file} educational.${key}: ${claim}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('the engine copy in components/tools/registry.tsx still matches its canonical page, so the duplicate-notes rule keeps working', () => {
    // Read as text, not imported: the registry pulls in every tool component.
    const src = fs.readFileSync(path.join(ROOT, 'components', 'tools', 'registry.tsx'), 'utf8').replace(/\\/g, '');
    const block = src.match(/export const ENGINE_CANONICAL[\s\S]*?\n};/)?.[0] ?? '';
    const canonical = [...block.matchAll(/'([^']+)':\s*\{ niche: '([^']+)', slug: '([^']+)' \}/g)];
    expect(canonical.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const [, engine, niche, slug] of canonical) {
      const file = `data/tools/${niche}/${slug}.json`;
      const data = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as {
        educational: { tips?: string[]; commonMistakes?: string[] };
      };
      for (const key of ['tips', 'commonMistakes'] as const) {
        for (const line of data.educational[key] ?? []) {
          if (!src.includes(line)) missing.push(`${engine} ${key}: ${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
