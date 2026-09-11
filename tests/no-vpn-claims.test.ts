/**
 * Guards the owner's 2026-09-10 decision: Incognito Pro is live, the VPN is
 * not. The site used to promise a "Built-in VPN" on 500+ pages (the result
 * CTA's benefit tiles, the report cards, the in-app copy, PRO_DEFINITION and
 * eight comparison rows). Nothing may claim that Incognito Browser or Pro
 * includes a VPN until the owner says it ships.
 *
 * Mentioning the visitor's OWN VPN is fine ("Your VPN is on, but…", "check
 * your VPN's DNS setting"), so the copy check is per sentence: a sentence may
 * not name our product and a VPN together.
 *
 * The comparisons get the same per-sentence check against every one of
 * data/brand.json's never-claims (VPN, Tor, open source, no data collection,
 * tracker-free, fingerprint protection, all platforms…), and against claims
 * next to them that brand.json doesn't back either (hiding your IP, encrypting
 * traffic, anonymity, malware protection). One allowance: a sentence may deny
 * a claim ("Does not include a VPN", "Not open source"), but only in a form
 * that governs it (see deniedAt). A sentence is about our product when it
 * names it, sits in its own row, answers an FAQ question that names it, or
 * follows a sentence about it with no other product named in between.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PRO_BENEFITS, ENGINE_COPY, DEFAULT_ENGINE_COPY, IN_APP_COPY, reportCardLine } from '@/lib/cta-copy';
import { PRO_DEFINITION } from '@/lib/tiers';

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

const OURS = /\bIncognito\b|\bPro\b/;
const VPN = /\bVPN\b/i;

// --- brand.json's never-claims, for the comparisons ---------------------------

/**
 * One entry per data/brand.json neverClaim (a test keeps the keys equal to
 * that list). A `deniable` pattern may appear in a sentence that denies it
 * ("not open source", "no VPN", "fingerprint protection is not documented");
 * the others are denials already ("collects no data", "tracker-free"), so
 * they never pass.
 */
type ClaimRules = Record<string, Array<{ pattern: RegExp; deniable: boolean }>>;

const NEVER_CLAIM: ClaimRules = {
  'built-in VPN': [
    { pattern: /\bVPNs?\b/i, deniable: true },
    // Wordings no denial can undo: honest copy says "no VPN", not "no built-in VPN".
    {
      pattern:
        /\bbuilt[- ]in\s+VPNs?\b|\bVPNs?(?:\s*:\s*|\s+)(?:it's\s+|it\s+is\s+|is\s+|are\s+|comes\s+)?(?:built[- ]in|included|bundled)\b|\b(?:includes|comes\s+with|ships\s+with|bundles|adds)\s+(?:a\s+|an\s+|its\s+own\s+)?(?:free\s+|built[- ]in\s+)?VPNs?\b/i,
      deniable: false,
    },
  ],
  // Naming the Tor Browser product, as pages that compare it do, isn't a claim about us.
  Tor: [{ pattern: /\bTor\b(?!\s+(?:Browser|Project)\b)|\bonion\b/i, deniable: true }],
  'open source': [{ pattern: /\bopen[- ]?source/i, deniable: true }],
  'no data collection / collects nothing': [
    {
      pattern:
        /\b(?:no|zero|without(?:\s+any)?)\s+(?:personal\s+|user\s+)?data\s+(?:collection|collected|retention|logging|logs|stored|storage)\b|\bcollects?\s+(?:no|nothing|zero)\b|\b(?:doesn't|does\s+not|never|won't)\s+collect\b|\bnothing\s+(?:is\s+)?(?:collected|stored|logged)\b|\bzero[- ](?:data|logs?|knowledge|retention)\b|\bno[- ]logs?\b/i,
      deniable: false,
    },
  ],
  'tracker-free / no trackers': [
    {
      pattern:
        /\btracker[- ]free\b|\b(?:no|zero)\s+(?:third[- ]party\s+)?trackers?\b(?!\s+(?:blocking|blocker|protection))|\bno\s+tracking\b(?!\s+(?:protection|prevention|blocking))|\bwithout\s+(?:any\s+)?(?:trackers|tracking)\b|\b(?:doesn't|does\s+not|never|won't)\s+track\b/i,
      deniable: false,
    },
    // brand.json lists an ad blocker, not a tracker blocker, so "blocks trackers" counts here too.
    { pattern: /\bblock(?:s|ing)?\s+(?:\S+\s+){0,2}?trackers\b|\btracker\s+(?:blocking|blocker)\b|\banti[- ]?tracking\b/i, deniable: true },
  ],
  'anti-fingerprinting or fingerprint protection': [{ pattern: /fingerprint/i, deniable: true }],
  'works on all platforms / iOS / desktop': [
    {
      pattern:
        /\ball\s+(?:major\s+|the\s+|your\s+)?(?:platforms|devices|operating\s+systems)\b|\bcross[- ]platform\b(?!\s+protection)|\bmulti[- ](?:device|platform)\b|\bdesktop\b(?!\s+(?:versions?|sites?|mode|view|pages?)\b)/i,
      deniable: true,
    },
    { pattern: /\biOS\b|\biPhones?\b|\biPads?\b|\bmacOS\b|\bMac\b|\bWindows\b|\bLinux\b|\bChromebooks?\b/, deniable: true },
  ],
  'voted best by Android Authority': [{ pattern: /\bAndroid\s+Authority\b|\bvoted\b|\baward[- ]winning\b/i, deniable: false }],
  'an aggregateRating in structured data': [{ pattern: /\baggregate\s*rating\b/i, deniable: false }],
};

/**
 * Claims next to the never-claims that data/brand.json doesn't back either,
 * checked only in what is said about our product: what a VPN, Tor or a
 * security suite does. (Its Data safety note, "data is encrypted in transit",
 * is about the app's own reporting, not your traffic, and doesn't match.)
 */
const UNBACKED_FOR_US: ClaimRules = {
  'hides or changes your IP address': [
    {
      pattern:
        /\b(?:hides?|hiding|masks?|masking|changes?|changing|conceals?|concealing|spoofs?|spoofing)\s+(?:your\s+|the\s+|its\s+|a\s+user's\s+|users'\s+)?(?:real\s+)?IP\b|\bIP\s+(?:address(?:es)?\s+)?(?:is\s+|are\s+)?(?:hidden|masked|concealed|changed)\b/i,
      deniable: true,
    },
  ],
  'encrypts your traffic': [
    {
      pattern:
        /\bencrypts?\s+(?:all\s+)?(?:of\s+)?(?:your\s+|the\s+)?(?:\w+\s+)?(?:traffic|connections?|browsing)\b|\b(?:traffic|connections?|browsing)\s+(?:is\s+|are\s+)?encrypted\b|\bencrypted\s+(?:traffic|connections?|tunnel|browsing)\b/i,
      deniable: true,
    },
  ],
  anonymous: [{ pattern: /\banonym(?:ous|ously|ity|i[sz]e[sd]?|i[sz]ing)\b/i, deniable: true }],
  'malware or phishing protection': [
    {
      pattern:
        /\b(?:malware|phishing|virus|scam|malicious[- ]site)s?\s+(?:protection|blocking|blocker|filter(?:ing)?|shield|detection)\b|\bblock(?:s|ing)?\s+(?:\S+\s+){0,2}?(?:malware|phishing|viruses|malicious)\b|\bprotect(?:s|ion)?\s+(?:you\s+)?(?:from|against)\s+(?:\S+\s+){0,2}?(?:malware|phishing|viruses|scams)\b/i,
      deniable: true,
    },
  ],
};

// --- when a sentence denies a claim --------------------------------------------
//
// A denial counts only in a form that governs the claim, so "Your ISP can't
// see your traffic thanks to the built-in VPN" and "Sites can't fingerprint
// you" are claims, while "No VPN, Tor or fingerprint protection" and "It does
// not hide your IP address or encrypt your traffic" are denials.

/** Punctuation and conjunctions that start a new clause; "and" and "or" also separate list items. */
const HARD_BREAK = /[.;:!?()—–]|\b(?:but|while|whereas|although|though|however|yet)\b/i;
const NEAR_BREAK = /[,.;:!?()—–]|\b(?:but|and|or|while|whereas|although|though|however|yet)\b/i;
/**
 * Words that deny what follows within three words ("No fingerprinting
 * protection", "does not include a VPN"). Not "can't" or "won't": "sites
 * can't fingerprint you" is a claim ("it can't …" is handled below).
 */
const NEGATOR = /^(?:no|not|nor|never|none|neither|without|lacks?|lacking)$|^(?:doesn|don|didn|isn|aren|wasn|weren|hasn|haven)'t$/i;
/** "no need", "not only", "no matter": not denials. */
const NOT_A_DENIAL = /^(?:need|needs|matter|only|just|doubt)$/i;

const STOP_WORD = String.raw`(?:and|or|nor|but|yet|so|it|its|it's|they|we|you|this|that|which|who)`;
const VERB = String.raw`(?:is|are|was|were|be|been|has|have|had|comes?|came|includes?|adds?|offers?|blocks?|hides?|masks?|changes?|encrypts?|protects?|stops?|prevents?|runs?|works?|supports?|gets?|keeps?|makes?|lets?|can|will|does|do|did)`;
const NOUN_WORD = String.raw`(?!(?:${STOP_WORD}|${VERB})\b)[\w'-]+`;
const ANY_WORD = String.raw`(?!${STOP_WORD}\b)[\w'-]+`;
const NOUN_ITEM = String.raw`${NOUN_WORD}(?:\s+${NOUN_WORD}){0,3}`;
const VERB_ITEM = String.raw`${ANY_WORD}(?:\s+${ANY_WORD}){0,3}`;
const LIST_SEP = String.raw`(?:\s*,\s*(?:(?:and|or|nor)\s+)?|\s+(?:and|or|nor)\s+)`;
/** "no …", "without …", "doesn't claim …": what follows is a list of things it lacks. */
const NOUN_DENIAL = String.raw`(?:\b(?:no|not|nor|neither|without|lacks?|lacking|none\s+of)\s+|\b(?:doesn't|does\s+not|don't|do\s+not)\s+)(?:(?:claim|claims|include|includes|have|has|offer|offers|list|lists|document|documents|support|supports|provide|provides|mention|mentions|come\s+with)\s+)?(?:any\s+|an?\s+|the\s+|its\s+)?`;
/** "does not …", "it can't …": what follows is a list of things it doesn't do. */
const VERB_DENIAL = String.raw`(?:\b(?:does|do|did|will)\s+not\s+|\b(?:doesn't|don't|didn't|won't)\s+|\b(?:it|this\s+browser|the\s+app)\s+(?:can't|cannot|can\s+not)\s+|\bnever\s+)`;
/** The claim is in a list governed by a denial: "no iOS, desktop or web version", "no protection against canvas, … or screen fingerprinting". */
const DENIED_LIST = new RegExp(`${NOUN_DENIAL}(?:${NOUN_ITEM}${LIST_SEP})*(?:${NOUN_WORD}\\s+){0,3}$`, 'i');
const DENIED_VERB_LIST = new RegExp(`${VERB_DENIAL}(?:${VERB_ITEM}${LIST_SEP})*(?:${ANY_WORD}\\s+){0,3}$`, 'i');
/** A claim worded with an inflected verb ("blocks trackers") can't be governed by "does not". */
const INFLECTED_VERB = /^(?:blocks|hides|masks|changes|encrypts|protects|includes|adds|offers|comes|runs|works|collects|tracks|stops|prevents|keeps|makes|lets|gets|supports)\b/i;
/** Nouns that can finish the matched term's phrase before a denial after it ("fingerprint protection is not documented"). */
const PHRASE_END = String.raw`(?:protection|protections|blocking|blocker|blockers|resistance|defen[cs]es?|support|versions?|apps?|mode|routing|network|access|code|browser|integration|features?|tools?|options?|scripts?)`;
/** A denial after the claim, the claim being one of a list: "tracker blocking, privacy alerts and … are not among its listed features". */
const DENIED_AFTER = new RegExp(
  `^[\\w'-]*(?:\\s+${PHRASE_END}){0,2}(?:${LIST_SEP}${NOUN_ITEM})*(?:\\s+(?:(?:is|are|was|were)\\s+not|isn't|aren't|wasn't|weren't)\\s+(?:among|in|part\\s+of|documented|listed|claimed|included|offered|supported|available|built\\s+in)\\b|(?:\\s*,\\s*|\\s+)not\\s+(?:documented|listed|claimed|included|offered|supported|available)\\b)`,
  'i',
);
/** "…compared on ad blocking, fingerprint protection and open source": criteria being listed, not claimed. The claim must sit in the list. */
const CRITERIA_LIST = new RegExp(
  `\\b(?:compared?|compares|scored|rated|ranked|judged|assessed)\\s+on\\s+(?:${NOUN_ITEM}${LIST_SEP})*(?:${NOUN_WORD}\\s+){0,3}$`,
  'i',
);

/** Does the sentence deny the claim matched at [start, end)? */
function deniedAt(sentence: string, start: number, end: number): boolean {
  const lead = sentence.slice(0, start);
  const term = sentence.slice(start, end);
  // A negator among the three words before it, in its clause.
  const near = (lead.split(NEAR_BREAK).pop() ?? '').split(/\s+/).map((w) => w.replace(/[^\w']/g, '')).filter(Boolean);
  const window = near.slice(-3);
  if (window.some((w, i) => NEGATOR.test(w) && !NOT_A_DENIAL.test(window[i + 1] ?? ''))) return true;
  // A denial governing a list it is in, within its clause.
  const clause = (lead.split(HARD_BREAK).pop() ?? '').slice(-240);
  if (DENIED_LIST.test(clause) || CRITERIA_LIST.test(clause)) return true;
  if (!INFLECTED_VERB.test(term) && DENIED_VERB_LIST.test(clause)) return true;
  // A denial after it.
  const after = sentence.slice(end).split(HARD_BREAK)[0];
  return !INFLECTED_VERB.test(term) && DENIED_AFTER.test(after);
}

/**
 * The claims a sentence about our product makes: brand.json's never-claims
 * and the unbacked claims next to them. A question makes none, unless it is
 * read `asStatement` (an FAQ question answered "Yes"). A deniable claim
 * doesn't count when the sentence denies it (deniedAt).
 */
function claimsIn(raw: string, asStatement = false): string[] {
  const text = raw.replace(/’/g, "'");
  if (!asStatement && text.trim().endsWith('?')) return [];
  const sentence = asStatement ? text.replace(/\?\s*$/, '') : text;
  const rules = [NEVER_CLAIM, UNBACKED_FOR_US];
  const found: string[] = [];
  for (const table of rules) {
    for (const [claim, list] of Object.entries(table)) {
      for (const { pattern, deniable } of list) {
        const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        if ([...sentence.matchAll(g)].some((m) => !deniable || !deniedAt(sentence, m.index, m.index + m[0].length))) found.push(claim);
      }
    }
  }
  return [...new Set(found)];
}
const neverClaimsIn = (sentence: string) => claimsIn(sentence);

// --- which sentences are about our product --------------------------------------

interface ComparisonProduct {
  name?: string;
  slug?: string;
  website?: string;
  tagline?: string;
  pricing?: string;
  platforms?: unknown;
  pros?: string[];
  cons?: string[];
}
interface ComparisonData {
  products?: ComparisonProduct[];
  features?: Array<{ name?: string; description?: string; scores?: Record<string, { value?: string; note?: string } | null> | null }>;
  verdict?: { summary?: string; bestFor?: Array<{ useCase?: string; product?: string; reason?: string }> };
  faqs?: Array<{ question?: string; answer?: string }>;
  title?: string;
  metaDescription?: string;
  keywords?: string[];
  intro?: string;
  pro_tips?: string[];
}

const BRAND = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'brand.json'), 'utf-8')) as {
  neverClaim: string[];
  playPackage: string;
  playUrl: string;
  website: string;
  sameAs: string[];
};

const OURS_BY_NAME = /\bIncognito\s+(?:Browser|Pro)\b/i;
/** On a page that compares us, "Pro" on its own is Incognito Pro (DuckDuckGo's "Privacy Pro" is not). */
const BARE_PRO = /(?<!\b(?:Privacy|Incognito)\s)\bPro\b/;
/** "Its Pro upgrade", "its subscription": ours on a page that compares us, unless another product is named first. */
const ITS_PRO = /\bits\s+(?:Pro|subscription|upgrade)\b/i;
/** An FAQ answer that says yes. */
const AFFIRMATIVE = /^\s*(?:yes|yeah|yep|correct|absolutely|sure|indeed|of\s+course|it\s+(?:does|is|can|has))\b/i;

const normUrl = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');

/**
 * Is this row our product, whatever its slug? By our slug, a name starting
 * "Incognito" (not "Incognito Mode"), or a website that is ours, our Play
 * listing (by package) or one of brand.json's sameAs profiles.
 */
function looksOurs(p: ComparisonProduct): boolean {
  if (p.slug === 'incognito-browser') return true;
  if (/^incognito\b(?!\s+mode\b)/i.test((p.name ?? '').trim())) return true;
  const site = normUrl(p.website ?? '');
  if (!site) return false;
  const ours = [BRAND.website, BRAND.playUrl, ...BRAND.sameAs].map(normUrl);
  return (
    site.includes(BRAND.playPackage.toLowerCase()) ||
    /(?:^|\/\/|\.)incognitobrowser\.io(?:[/:?#]|$)/.test(site) ||
    ours.some((u) => site === u || site.startsWith(`${u}/`) || site.startsWith(`${u}?`))
  );
}

/** Words too common to stand for a product on their own (as in tests/comparison-score.test.ts). */
const GENERIC_NAME_WORD =
  /^(?:have|free|best|apple|google|microsoft|privacy|identity|screen|sliding|canvas|incognito|browser|browsers|mode|extension|extensions|protection|security|awareness|email|mail|time|tool|tools|apps?|platform|management|services?|cameras?|sensor|router|wallet|cash|controls|view|private|browsing|search|engine|essentials|premium|plus|gold)$/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a sentence names a product: its full name, its name without a bracketed part, or a distinctive first or last word. */
function mentionsOf(sentence: string, name: string): number[] {
  const bare = name.replace(/\s*\([^)]*\)/g, '').trim();
  const aliases = new Set([name, bare]);
  const words = bare.split(/\s+/);
  for (const w of [words[0], words[words.length - 1]]) if (w.length >= 4 && !GENERIC_NAME_WORD.test(w)) aliases.add(w);
  return [...aliases].flatMap((a) => [...sentence.matchAll(new RegExp(`(?<![\\w-])${escapeRe(a)}(?![\\w-])`, 'g'))].map((m) => m.index));
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());

interface Text { where: string; text: string; ours: boolean; question?: string }

/** Every text in a comparison file except the editorial blocks; `ours` = about our product by position. */
function comparisonTexts(d: ComparisonData): Text[] {
  const out: Text[] = [];
  const add = (where: string, text: unknown, ours = false, question?: string) => {
    if (typeof text === 'string' && text.trim()) out.push({ where, text, ours, question });
  };
  add('title', d.title);
  add('metaDescription', d.metaDescription);
  (d.keywords ?? []).forEach((k, i) => add(`keywords[${i}]`, k));
  add('intro', d.intro);
  const ourRows = (d.products ?? []).filter(looksOurs);
  const isOurKey = (key: string) => ourRows.some((p) => key === p.slug || key === p.name);
  for (const p of d.products ?? []) {
    const ours = looksOurs(p);
    add(`${p.slug}.tagline`, p.tagline, ours);
    add(`${p.slug}.pricing`, p.pricing, ours);
    (Array.isArray(p.platforms) ? p.platforms : [p.platforms]).forEach((s, i) => add(`${p.slug}.platforms[${i}]`, s, ours));
    (p.pros ?? []).forEach((s, i) => add(`${p.slug}.pros[${i}]`, s, ours));
    (p.cons ?? []).forEach((s, i) => add(`${p.slug}.cons[${i}]`, s, ours));
  }
  for (const f of d.features ?? []) {
    add(`criterion "${f.name}" description`, f.description);
    for (const [key, cell] of Object.entries(f.scores ?? {})) add(`criterion "${f.name}" note for ${key}`, cell?.note, isOurKey(key));
  }
  add('verdict.summary', d.verdict?.summary);
  (d.verdict?.bestFor ?? []).forEach((b, i) => {
    const ours = ourRows.some((p) => b.product === p.name);
    add(`bestFor[${i}].useCase`, b.useCase, ours);
    add(`bestFor[${i}].reason`, b.reason, ours);
  });
  (d.faqs ?? []).forEach((q, i) => {
    add(`faqs[${i}].question`, q.question);
    add(`faqs[${i}].answer`, q.answer, false, q.question ?? '');
  });
  (d.pro_tips ?? []).forEach((s, i) => add(`pro_tips[${i}]`, s));
  return out;
}

/**
 * Every sentence in the file that is about our product: in its own row, its
 * cell notes or a bestFor naming it; naming it ("Incognito Browser",
 * "Incognito Pro", and on a page that compares it a bare "Pro" or "its Pro
 * upgrade"); in an FAQ answer whose question names it; or following, in the
 * same text, a sentence about it with no other product named since ("…, which
 * we make, scores lowest. It adds a VPN."). Naming another product ends that.
 */
function sentencesAboutUs(d: ComparisonData): Array<{ where: string; sentence: string }> {
  const comparesUs = (d.products ?? []).some(looksOurs);
  const others = (d.products ?? []).filter((p) => !looksOurs(p)).map((p) => p.name ?? '').filter(Boolean);
  const ourAt = (s: string) => [
    ...[...s.matchAll(new RegExp(OURS_BY_NAME.source, 'gi'))].map((m) => m.index),
    ...(comparesUs ? [...s.matchAll(new RegExp(BARE_PRO.source, 'g'))].map((m) => m.index) : []),
  ];
  const theirAt = (s: string) => others.flatMap((n) => mentionsOf(s, n));
  const out: Array<{ where: string; sentence: string }> = [];
  for (const t of comparisonTexts(d)) {
    let aboutUs = t.ours || (t.question !== undefined && ourAt(t.question).length > 0);
    for (const sentence of sentencesOf(t.text)) {
      const us = ourAt(sentence);
      const them = theirAt(sentence);
      const its = comparesUs ? sentence.search(ITS_PRO) : -1;
      const ours = t.ours || us.length > 0 || (its >= 0 && !them.some((i) => i < its)) || (aboutUs && them.length === 0);
      if (ours) out.push({ where: t.where, sentence });
      // The product named last carries over to the next sentence.
      if (!t.ours && (us.length || them.length)) aboutUs = Math.max(-1, ...us) > Math.max(-1, ...them);
    }
  }
  return out;
}

/** An FAQ question asking whether our product makes a claim, answered "Yes": the answer makes it. */
function affirmedClaims(d: ComparisonData): Array<{ where: string; claim: string; text: string }> {
  const comparesUs = (d.products ?? []).some(looksOurs);
  const out: Array<{ where: string; claim: string; text: string }> = [];
  (d.faqs ?? []).forEach((q, i) => {
    const question = q.question ?? '';
    const namesUs = OURS_BY_NAME.test(question) || (comparesUs && BARE_PRO.test(question));
    if (!namesUs || !AFFIRMATIVE.test(q.answer ?? '')) return;
    for (const claim of claimsIn(question, true)) out.push({ where: `faqs[${i}]`, claim, text: `${question} ${q.answer}` });
  });
  return out;
}

/** Every claim the file makes about our product. */
function claimsAboutUs(d: ComparisonData): string[] {
  return [
    ...sentencesAboutUs(d).flatMap(({ where, sentence }) => claimsIn(sentence).map((claim) => `${where} [${claim}]: ${sentence}`)),
    ...affirmedClaims(d).map(({ where, claim, text }) => `${where} [${claim}] (answered yes): ${text}`),
  ];
}

describe('no VPN claims for Incognito Browser or Pro', () => {
  it('the CTA copy never names our product and a VPN in the same sentence', () => {
    const copy = strings([
      PRO_BENEFITS, ENGINE_COPY, DEFAULT_ENGINE_COPY, IN_APP_COPY,
      reportCardLine('B', 'green', { trackingCookies: 2, trackers: 3 }),
    ]);
    const offenders = copy
      .flatMap((s) => s.split(/(?<=[.!?])\s+/))
      .filter((sentence) => OURS.test(sentence) && VPN.test(sentence));
    expect(offenders).toEqual([]);
  });

  it('there is no VPN benefit tile', () => {
    expect(Object.keys(PRO_BENEFITS)).not.toContain('vpn');
    for (const e of Object.values(ENGINE_COPY)) expect(e.benefits as string[]).not.toContain('vpn');
  });

  it('PRO_DEFINITION does not mention a VPN', () => {
    expect(PRO_DEFINITION).not.toMatch(VPN);
  });

  it("the never-claim patterns below cover exactly brand.json's neverClaim list", () => {
    expect(Object.keys(NEVER_CLAIM).sort()).toEqual([...BRAND.neverClaim].sort());
  });

  it('the never-claim check catches claims and lets denials through', () => {
    const claims = [
      'Incognito Browser includes a built-in VPN.',
      'Incognito Browser adds Tor routing.',
      'Incognito Browser is open source.',
      'Incognito Browser has anti-fingerprinting built in.',
      'Incognito Browser collects no data.',
      'Incognito Browser is tracker-free.',
      'Incognito Browser blocks ads and trackers.',
      'Incognito Browser works on all platforms.',
      'Incognito Browser runs on iOS and desktop.',
      "Incognito Browser isn't free, but it includes a VPN.",
      'Compared with Brave, Incognito Browser has stronger fingerprint protection.',
      'Incognito Browser has no ads; tracker blocking is built in.',
      'Incognito Browser was voted best by Android Authority.',
      // A negator that doesn't govern the claim (review 2026-09-10).
      "Your ISP can't see your traffic thanks to the built-in VPN.",
      "No need for a separate VPN: it's built in.",
      'Rated on privacy, it includes a built-in VPN.',
      "Sites can't fingerprint you.",
      'Blocks trackers on every site, and fingerprinting is not documented.',
      'Tracker blocking comes standard, and fingerprinting is not documented.',
      "It doesn't block ads and blocks trackers.",
      'It has no ads and it blocks trackers.',
      'Incognito Pro comes with a VPN.',
      'Its VPN is built in.',
      // Unbacked claims next to the never-claims.
      'Hides your IP address from websites.',
      'Encrypts all your browsing traffic.',
      'Blocks malware and phishing sites.',
      'Browse anonymously.',
    ];
    const denials = [
      'Incognito Browser does not include a VPN.',
      'Android only: there is no iOS, desktop or web version.',
      'It is not open source, does not claim tracker or fingerprint protection, and runs only on Android.',
      'No fingerprinting protection and no VPN.',
      "Automatic tracker blocking is not in the app's verified feature list; cookies are wiped when you exit.",
      'Tracker blocking, privacy alerts and social-platform guides are not among its listed features.',
      'Tracker blocking, privacy alerts, and social-platform guides are not among its listed features.',
      'Agent Cloaking changes the browser and device a site sees, and can load desktop sites.',
      "Google Play's Data safety section says it may collect crash logs and diagnostics.",
      'Brave, Firefox and Incognito Browser (which we make) compared on ad blocking, fingerprint protection and open source.',
      'Tor Browser, Brave and Incognito Browser (which we make) scored on the same six fingerprinting defences.',
      'Is Incognito Browser available on iPhone?',
      'No VPN, Tor and fingerprint protection.',
      'No protection against canvas, WebGL, audio, font or screen fingerprinting is documented.',
      "It doesn't list tracker blocking, custom filter rules or performance data.",
      'It does not hide your IP address or encrypt your traffic.',
      "It can't block fingerprinting.",
      'No VPN: sites you visit still see your IP address.',
      'Neither makes you anonymous.',
      'Its Agent Cloaking changes the browser and device a site sees, which is not fingerprint protection.',
    ];
    for (const s of claims) expect(neverClaimsIn(s), s).not.toEqual([]);
    for (const s of denials) expect(neverClaimsIn(s), s).toEqual([]);
  });

  it('knows which sentences are about our product: its row, its name, a bare "Pro", an FAQ that asks about it, and what follows', () => {
    const page = (over: Partial<ComparisonData>): ComparisonData => ({
      products: [
        { name: 'Brave', slug: 'brave', tagline: 'Browser' },
        { name: 'Incognito Browser', slug: 'incognito-browser', tagline: 'Android browser' },
      ],
      features: [],
      verdict: { summary: 'x', bestFor: [] },
      faqs: [],
      ...over,
    });
    // Each passed every test before the 2026-09-10 review.
    const summary = 'Brave scores highest. Incognito Browser, which we make, scores lowest. Its Pro upgrade adds a built-in VPN.';
    expect(claimsAboutUs(page({ verdict: { summary, bestFor: [] } }))).toHaveLength(1);
    const carried = 'Incognito Browser, which we make, scores lowest. It is open source.';
    expect(claimsAboutUs(page({ verdict: { summary: carried, bestFor: [] } }))).toHaveLength(1);
    expect(claimsAboutUs(page({ faqs: [{ question: 'Does Incognito Browser include a VPN?', answer: 'Yes. Pro includes one, so your internet provider sees nothing.' }] }))).not.toEqual([]);
    expect(claimsAboutUs(page({ faqs: [{ question: 'Is Incognito Browser open source?', answer: 'Yes, its code is open source and public.' }] }))).not.toEqual([]);
    // Our row under another slug is still ours.
    const alias = page({});
    alias.products![1] = { name: 'Incognito', slug: 'incognito-app', website: `${BRAND.playUrl}&hl=en`, tagline: 'Hides your IP address' };
    expect(claimsAboutUs(alias)).toHaveLength(1);
    // Not about us: another product named since, a general FAQ, another product's "Pro".
    expect(claimsAboutUs(page({ verdict: { summary: 'Incognito Browser, which we make, scores lowest. Brave is open source.', bestFor: [] } }))).toEqual([]);
    expect(claimsAboutUs(page({ faqs: [{ question: 'Does a VPN hide my IP?', answer: 'Yes. A VPN hides your IP address from sites.' }] }))).toEqual([]);
    expect(claimsAboutUs(page({ faqs: [{ question: 'Is Incognito Browser a VPN?', answer: 'No. It does not include a VPN.' }] }))).toEqual([]);
    expect(claimsAboutUs(page({ intro: "DuckDuckGo's Privacy Pro subscription includes a VPN." }))).toEqual([]);
  });

  it("nothing a comparison says about Incognito Browser makes one of brand.json's never-claims, or an unbacked claim next to them", () => {
    // Checked: every sentence sentencesAboutUs finds (its row, its cell notes,
    // a bestFor naming it, any sentence naming it, an FAQ answer to a question
    // naming it, and the sentences that follow one about it), and FAQ
    // questions about a claim answered "Yes". A sentence may deny a claim
    // ("no VPN", "not open source"); see deniedAt.
    const dir = path.join(process.cwd(), 'data', 'comparisons');
    const offenders: string[] = [];
    for (const niche of fs.readdirSync(dir)) {
      for (const file of fs.readdirSync(path.join(dir, niche))) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, niche, file), 'utf-8')) as ComparisonData;
        for (const claim of claimsAboutUs(data)) offenders.push(`${niche}/${file} ${claim}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no content file links to a look-alike domain (the parked incognitobrowser.com, or other companies\' incognito.* sites)', () => {
    // 57 related links pointed at these; they shipped in page HTML and confuse
    // which site is ours for anyone, including AI crawlers, resolving the name.
    const BAD = /incognito-?browser\.(com|org|app)|\/\/(www\.)?incognito\.(com|org)/i;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.json') && BAD.test(fs.readFileSync(p, 'utf-8'))) offenders.push(path.relative(process.cwd(), p));
      }
    };
    walk(path.join(process.cwd(), 'data'));
    expect(offenders).toEqual([]);
  });

  it('Incognito Browser rows point at the real domain, never the parked incognitobrowser.com or another company', () => {
    const dir = path.join(process.cwd(), 'data', 'comparisons');
    const offenders: string[] = [];
    for (const niche of fs.readdirSync(dir)) {
      for (const file of fs.readdirSync(path.join(dir, niche))) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, niche, file), 'utf-8')) as {
          products?: Array<{ slug?: string; website?: string }>;
        };
        for (const p of data.products ?? []) {
          if (p.slug === 'incognito-browser' && p.website && p.website.replace(/\/$/, '') !== 'https://incognitobrowser.io') {
            offenders.push(`${niche}/${file}: ${p.website}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
