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
 * tracker-free, fingerprint protection, all platforms…), worded any way we
 * have seen ("virtual private network", "proxy", "canvas and WebGL readouts",
 * "we don't collect", "source code on GitHub"), and against claims next to
 * them that brand.json doesn't back either (hiding your IP, encrypting or
 * rerouting traffic, anonymity, malware protection).
 *
 * One allowance: a sentence may deny a claim ("Does not include a VPN", "Not
 * open source"), but only in a form that governs it (see deniedAt), and, in a
 * sentence that also names another product, only with our product as the
 * denial's subject: "Brave has no VPN, but Incognito Pro does" and "Unlike
 * Incognito Pro, Brave has no VPN" make the claim (see deniesForUs).
 *
 * A sentence is about our product when it names it, sits in its own row,
 * answers an FAQ question about it, or follows a sentence about it with no
 * other product named in between ("Unlike Brave, it …" still follows: a
 * product set off as an aside doesn't count). On a page that compares us,
 * "Pro", a bare "Incognito" and text that points at us without a name ("our
 * own browser", "which we make") all name us, and a question in prose is read
 * as a statement when the sentence after it names us ("Want a VPN too?
 * Incognito Pro has you covered."). An FAQ question about our product that
 * names a never-claim must be answered with a denial, however the question is
 * put ("Why does Incognito Browser include a VPN?"); a follow-up question that
 * names no product carries the product over ("Is Incognito Browser free?" then
 * "Does the subscription add a VPN?"); a question that names no product,
 * answered by naming us, puts the claim on us ("Which of these includes a
 * VPN?" / "Incognito Pro."); and only a real denial answers one ("No need for
 * a separate app", "No doubt" and "Nope — Incognito Pro includes one" deny
 * nothing).
 *
 * The patterns are the second layer. The first is an allowlist, because no
 * word list can cover every way to claim a VPN ("Keeps you safe on public
 * Wi-Fi by securing every connection"):
 *   - ABOUT_US_STRINGS covers EVERY string in data/comparisons that mentions
 *     us, wherever it sits — our own row whole (tagline, pricing, platforms,
 *     pros, cons, cell notes, bestFor), and every other sentence that mentions
 *     us, in the intro, the meta description, the verdict, another product's
 *     cell note, an FAQ question or answer, a keyword or a pro tip. Each entry
 *     pins file, field and text, and names the data/brand.json facts it states
 *     or the never-claims it denies; anything else fails until someone reviews
 *     it, so a new sentence about us cannot ship unreviewed however it is
 *     worded;
 *   - METHODOLOGY_ABOUT_US does the same for the one page outside
 *     data/comparisons that talks about our product, and METHODOLOGY_ALLOWED
 *     for its sentences that name a never-claim without claiming it.
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
    // What a VPN is or does under another name (Wave 2c verifier, 2026-09-11).
    { pattern: /\bvirtual\s+private\s+networks?\b|\bprox(?:y|ies)\b|\btunnel(?:s|ed|ing|led|ling)?\b/i, deniable: true },
    // Wordings no denial can undo: honest copy says "no VPN", not "no built-in VPN".
    {
      pattern:
        /\bbuilt[- ]in\s+VPNs?\b|\bVPNs?(?:\s*:\s*|\s+)(?:it's\s+|it\s+is\s+|is\s+|are\s+|comes\s+)?(?:built[- ]in|included|bundled)\b|\b(?:includes|comes\s+with|ships\s+with|bundles|adds)\s+(?:a\s+|an\s+|its\s+own\s+)?(?:free\s+|built[- ]in\s+)?VPNs?\b/i,
      deniable: false,
    },
  ],
  // Naming the Tor Browser product, as pages that compare it do, isn't a claim about us.
  Tor: [{ pattern: /\bTor\b(?!\s+(?:Browser|Project)\b)|\bonion\b/i, deniable: true }],
  'open source': [
    { pattern: /\bopen[- ]?source/i, deniable: true },
    // "Its source code is public on GitHub". A negation inside the phrase ("source code is not public") is no claim.
    {
      pattern:
        /\bsource\s+code\b(?:(?!\bnot\b|n't\b|\bnever\b)[^.;]){0,40}?\b(?:public|published|available|open|on\s+GitHub)\b|\b(?:public|published|open)\s+(?:source\s+)?code\b|\bGitHub\b/i,
      deniable: true,
    },
  ],
  'no data collection / collects nothing': [
    {
      pattern:
        /\b(?:no|zero|without(?:\s+any)?)\s+(?:personal\s+|user\s+)?data\s+(?:collection|collected|retention|logging|logs|stored|storage)\b|\bcollects?\s+(?:no|nothing|zero)\b|\b(?:doesn't|does\s+not|don't|do\s+not|didn't|did\s+not|never|won't|will\s+not)\s+(?:\w+\s+)?collect\b|\bnothing\s+(?:is\s+)?(?:collected|stored|logged)\b|\bzero[- ](?:data|logs?|knowledge|retention)\b|\bno[- ]logs?\b|\bnever\s+leaves?\s+(?:your|the)\s+(?:device|phone|computer)\b/i,
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
  'anti-fingerprinting or fingerprint protection': [
    { pattern: /fingerprint/i, deniable: true },
    // Fingerprint protection without the word: the vocabulary of tests/comparison-score's
    // NEVER_CLAIM_CRITERION, and what it achieves ("sites can't recognise your phone").
    {
      pattern:
        /\bcanvas\b|\bwebgl\b|\baudio\s*(?:context|api|stack|readouts?)\b|\binstalled\s+fonts\b|\bfont\s+(?:lists?|enumeration|detection)\b|\bscreen\s+(?:resolution|size)\b|\brecogni[sz](?:e|es|ed|ing)\s+(?:you|your\s+(?:device|phone|browser))\b|\bidentif(?:y|ies|ying)\s+(?:you|your\s+(?:device|phone|browser))\b|\btell(?:s|ing)?\s+(?:you|your\s+(?:device|phone|browser))\s+apart\b/i,
      deniable: true,
    },
  ],
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
        /\b(?:hides?|hiding|masks?|masking|changes?|changing|conceals?|concealing|spoofs?|spoofing)\s+(?:your\s+|my\s+|our\s+|their\s+|the\s+|its\s+|a\s+user's\s+|users'\s+)?(?:real\s+)?IP\b|\bIP\s+(?:address(?:es)?\s+)?(?:is\s+|are\s+)?(?:hidden|masked|concealed|changed)\b/i,
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
  'routes your traffic through another server': [
    {
      pattern:
        /\b(?:re)?rout(?:es?|ing)\s+(?:all\s+)?(?:of\s+)?(?:your\s+|the\s+|its\s+)?(?:\w+\s+)?(?:traffic|connections?|browsing|requests)\b|\b(?:traffic|connections?|requests)\s+(?:is\s+|are\s+)?(?:re)?routed\b/i,
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
/**
 * A word that starts something new rather than another denied item, so the
 * denied list ends before it. An honest denial lists bare nouns ("No VPN, Tor
 * and fingerprint protection"); "no ads, no limits and a fast VPN", "No ads,
 * no limits, just a fast VPN" and "no ads, and a VPN" put the claim after one
 * of these, so the denial does not reach it (Wave 3 verifier, 2026-09-11).
 */
const LIST_END = String.raw`(?:an?|the|its|his|her|their|our|your|my|this|that|these|those|just|plus|also|only|still|even|instead|rather|with)`;
const DENIED_NOUN_ITEM = String.raw`(?!${LIST_END}\b)${NOUN_ITEM}`;
const DENIED_VERB_ITEM = String.raw`(?!${LIST_END}\b)${VERB_ITEM}`;
/**
 * The other half of the same rule, said the other way round: an item of a
 * denied list has to LOOK like a bare noun phrase ("No VPN, Tor and
 * fingerprint protection"), whatever word it starts with. Listing the words
 * that end a list left one open each round — "and a fast VPN", then "and
 * hiding your IP from every site" (Wave 4 verifier, 2026-09-11) — so the last
 * item is checked for what it is instead: a determiner or possessive, an
 * adverb that turns the sentence, a gerund with an object ("hiding your IP",
 * and not the noun "fingerprinting protection"), a finite verb, a pronoun or
 * a number all end the list, so the denial does not reach what follows.
 */
const DETERMINER = String.raw`(?:an?|the|its|his|her|their|our|your|my|this|that|these|those|some|any|every|each|another|both|either)`;
const ADVERB_TURN = String.raw`(?:just|plus|also|only|still|even|instead|rather|with|too|now|always|really|simply|truly|finally)`;
const ITEM_VERB = String.raw`(?:${VERB}|gives?|gave|provides?|delivers?|brings?|throws?|unlocks?|means?|routes?|tunnels?|wipes?|erases?|deletes?)`;
const GERUND_PHRASE = String.raw`[\w'-]+ing\s+(?:${DETERMINER}|you|me|us|them|him|all|every)`;
const NOT_A_NOUN_ITEM = new RegExp(`^(?:${DETERMINER}|${ADVERB_TURN}|${GERUND_PHRASE}|${ITEM_VERB}|${STOP_WORD}|\\d)\\b`, 'i');
/** The last item of a denied list: what follows the last comma, "and" or "or" before the claim, and the claim itself. */
const lastItem = (lead: string, term: string) =>
  `${(lead.split(new RegExp(LIST_SEP, 'gi')).pop() ?? '').trimStart()}${term}`.trim();
/** "no …", "without …", "doesn't claim …": what follows is a list of things it lacks. */
const NOUN_DENIAL = String.raw`(?:\b(?:no|not|nor|neither|without|lacks?|lacking|none\s+of)\s+|\b(?:doesn't|does\s+not|don't|do\s+not)\s+)(?:(?:claim|claims|include|includes|have|has|offer|offers|list|lists|document|documents|support|supports|provide|provides|mention|mentions|come\s+with)\s+)?(?:any\s+|an?\s+|the\s+|its\s+)?`;
/** "does not …", "it can't …": what follows is a list of things it doesn't do. */
const VERB_DENIAL = String.raw`(?:\b(?:does|do|did|will)\s+not\s+|\b(?:doesn't|don't|didn't|won't)\s+|\b(?:it|this\s+browser|the\s+app)\s+(?:can't|cannot|can\s+not)\s+|\bnever\s+)`;
/** The claim is in a list governed by a denial: "no iOS, desktop or web version", "no protection against canvas, … or screen fingerprinting". */
const DENIED_LIST = new RegExp(`${NOUN_DENIAL}(?:${DENIED_NOUN_ITEM}${LIST_SEP})*(?!${LIST_END}\\b)(?:${NOUN_WORD}\\s+){0,3}$`, 'i');
const DENIED_VERB_LIST = new RegExp(`${VERB_DENIAL}(?:${DENIED_VERB_ITEM}${LIST_SEP})*(?!${LIST_END}\\b)(?:${ANY_WORD}\\s+){0,3}$`, 'i');
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

/**
 * Does the sentence deny the claim matched at [start, end)? 'denied' when a
 * denial governs it, 'listed' when it is one of the criteria a page is
 * compared on (neither claimed nor denied), else null.
 */
function deniedAt(sentence: string, start: number, end: number): 'denied' | 'listed' | null {
  const lead = sentence.slice(0, start);
  const term = sentence.slice(start, end);
  // A negator among the three words before it, in its clause.
  const near = (lead.split(NEAR_BREAK).pop() ?? '').split(/\s+/).map((w) => w.replace(/[^\w']/g, '')).filter(Boolean);
  const window = near.slice(-3);
  if (window.some((w, i) => NEGATOR.test(w) && !NOT_A_DENIAL.test(window[i + 1] ?? ''))) return 'denied';
  // A denial governing a list it is in, within its clause.
  const clause = (lead.split(HARD_BREAK).pop() ?? '').slice(-240);
  if (CRITERIA_LIST.test(clause)) return 'listed';
  // The list has to reach the claim: its last item must read as a bare noun
  // phrase, not "a fast VPN" or "hiding your IP from every site".
  if (DENIED_LIST.test(clause) && !NOT_A_NOUN_ITEM.test(lastItem(clause, term))) return 'denied';
  if (!INFLECTED_VERB.test(term) && DENIED_VERB_LIST.test(clause)) return 'denied';
  // A denial after it.
  const after = sentence.slice(end).split(HARD_BREAK)[0];
  return !INFLECTED_VERB.test(term) && DENIED_AFTER.test(after) ? 'denied' : null;
}

// --- whose denial it is ----------------------------------------------------------

/** Where a sentence names our product and where it names the others. */
interface Speakers {
  ourAt: (s: string) => number[];
  theirAt: (s: string) => number[];
}

/** "unlike Brave", "compared with Brave", "than Brave": a product named for contrast, which is not whose claim it is. */
const CONTRAST_BEFORE = /\b(?:unlike|like|as\s+with|compared\s+(?:with|to)|than|versus|vs\.?|besides|apart\s+from|except(?:\s+for)?|other\s+than|similar\s+to)\s+(?:the\s+)?$/i;
const contrastAt = (s: string, i: number) => CONTRAST_BEFORE.test(s.slice(Math.max(0, i - 30), i));
/** "Unlike Brave, it …", "It, like Brave, …": a product set off as an aside, which doesn't change who the sentence is about. */
const ASIDE_BEFORE = /(?:^|[,(—–;:]\s*)(?:unlike|like|as\s+with|compared\s+(?:with|to)|besides)\s+(?:the\s+)?$/i;
const asideAt = (s: string, i: number) => ASIDE_BEFORE.test(s.slice(0, i));

/**
 * In a sentence naming both our product and another, is our product the
 * subject of the denial of the claim at [start, end)? The product named
 * nearest before the claim, not one named for contrast, or failing that the
 * first named after it. "Brave has no VPN, but Incognito Pro does", "Brave
 * lacks the VPN that Incognito Pro includes" and "Unlike Incognito Pro, Brave
 * has no VPN" deny it for Brave, so they claim it for us.
 */
function deniesForUs(sentence: string, start: number, end: number, who: Speakers): boolean {
  const named = [
    ...who.ourAt(sentence).map((i) => ({ i, ours: true })),
    ...who.theirAt(sentence).map((i) => ({ i, ours: false })),
  ].filter((x) => !contrastAt(sentence, x.i));
  const before = named.filter((x) => x.i < start).sort((a, b) => b.i - a.i)[0];
  const after = named.filter((x) => x.i >= end).sort((a, b) => a.i - b.i)[0];
  return (before ?? after)?.ours ?? false;
}

/**
 * The claims a sentence about our product makes: brand.json's never-claims
 * and the unbacked claims next to them. A question makes none, unless it is
 * read `asStatement` (an FAQ question about us). A deniable claim doesn't
 * count when the sentence denies it (deniedAt) and, if the sentence also names
 * another product (`who`), the denial is ours (deniesForUs).
 */
function claimsIn(raw: string, asStatement = false, who?: Speakers): string[] {
  const text = raw.replace(/’/g, "'");
  if (!asStatement && text.trim().endsWith('?')) return [];
  const sentence = asStatement ? text.replace(/\?\s*$/, '') : text;
  const both = !!who && who.ourAt(sentence).length > 0 && who.theirAt(sentence).length > 0;
  const rules = [NEVER_CLAIM, UNBACKED_FOR_US];
  const found: string[] = [];
  for (const table of rules) {
    for (const [claim, list] of Object.entries(table)) {
      for (const { pattern, deniable } of list) {
        const g = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        const made = [...sentence.matchAll(g)].some((m) => {
          if (!deniable) return true;
          const denial = deniedAt(sentence, m.index, m.index + m[0].length);
          if (denial === 'listed') return false;
          if (denial === null) return true;
          return both && !deniesForUs(sentence, m.index, m.index + m[0].length, who!);
        });
        if (made) found.push(claim);
      }
    }
  }
  return [...new Set(found)];
}

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
  features: Array<{ id: string }>;
};

const OURS_BY_NAME = /\bIncognito\s+(?:Browser|Pro|app)\b/i;
/** On a page that compares us, "Pro" on its own is Incognito Pro (DuckDuckGo's "Privacy Pro" is not). */
const BARE_PRO = /(?<!\b(?:Privacy|Incognito)\s)\bPro\b/;
/**
 * On a page that compares us, "Incognito" on its own is our product
 * ("Incognito, which we make, includes a VPN"). Not a private window
 * ("Incognito Mode", "an Incognito tab"), and not Chrome's.
 */
const BARE_INCOGNITO = /(?<!\bChrome\s)\bIncognito\b(?!\s+(?:mode|window|tab)s?\b)/i;
/**
 * Text that points at our product without naming it: "which we make", "our
 * own Android browser", "the browser we develop". On a page that compares us
 * it names us, so "Our own browser comes with a built-in VPN" is a claim.
 */
const POINTS_AT_US =
  /\b(?:which|that)\s+we\s+make\b|\bwe\s+(?:make|build|built|develop(?:ed|s)?|publish(?:ed)?|created?)\b|\bour\s+(?:own\s+)?(?:[\w'-]+\s+){0,3}(?:browsers?|apps?|products?)\b/i;
/** "Its Pro upgrade", "its subscription": ours on a page that compares us, unless another product is named first. */
const ITS_PRO = /\bits\s+(?:Pro|subscription|upgrade)\b/i;
/** Who a denial can be about, and the ways it can deny. */
const DENIAL_SUBJECT = String.raw`(?:it|they|incognito(?:\s+(?:browser|pro))?|pro|the\s+(?:app|browser)|this\s+(?:app|browser))`;
const DENIAL_VERB = String.raw`(?:does\s+not|doesn't|do\s+not|don't|did\s+not|didn't|is\s+not|isn't|are\s+not|aren't|was\s+not|wasn't|has\s+no|have\s+no|hasn't|haven't|cannot|can't|will\s+not|won't|never\b|lacks\b|offers\s+no|includes\s+no|comes\s+with\s+no)`;
/**
 * An FAQ answer that starts by denying: "No.", "No, it doesn't", "Not yet",
 * "There is no …", "It doesn't …". Only a real denial counts: "No need for a
 * separate app: Incognito Pro includes one", "No doubt: it does", "Not only",
 * "Not surprisingly, yes" and "None other than Incognito Pro" all start with
 * a denial word and deny nothing (Wave 3 verifier, 2026-09-11).
 */
const DENIAL_ANSWER = new RegExp(
  [
    // The denial word on its own: "No.", "No —", "Nope!", "None."
    String.raw`^\s*(?:no|nope|none|neither|never)\s*(?:[.,;:!—–]|$)`,
    // "No, it doesn't", "No. Incognito Browser is a browser", "No, there is no VPN".
    String.raw`^\s*no\s*[,.]?\s+(?:${DENIAL_SUBJECT}|there|and|but|that|that's|you|we)\b`,
    // "No VPN is included", "No fingerprint protection is documented".
    String.raw`^\s*n(?:o|either)\s+[\w'-]+(?:\s+[\w'-]+){0,3}\s+(?:is|are|was|were)\s+(?:included|offered|documented|listed|claimed|built[- ]in|available|supported|part\s+of)\b`,
    // "Not yet", "Not included", "Not on these criteria", "Not in the app".
    String.raw`^\s*not\s+(?:yet\b|included\b|offered\b|documented\b|listed\b|claimed\b|available\b|supported\b|in\b|on\b|at\b|for\b|from\b|with\b|by\b|unless\b|without\b|really\b|quite\b)`,
    // "There is no …", "There are no …".
    String.raw`^\s*there\s+(?:is|are|was|were)\s+no\b`,
    // "It does not …", "Incognito Browser doesn't …", "The app has no …".
    String.raw`^\s*${DENIAL_SUBJECT}\s+${DENIAL_VERB}`,
  ].join('|'),
  'i',
);
/**
 * What an answer says after its denial word. A denial opener excuses the
 * question's claim only if the answer does not go on to make it: "Nope —
 * Incognito Pro includes one.", "No, but Pro does." and "Not really: Incognito
 * Pro adds one." all open with a denial word and affirm the claim in the next
 * breath (Wave 4 verifier, 2026-09-11).
 */
const AFFIRMS = new RegExp(
  [
    String.raw`\byes\b|\byep\b|\bindeed\b`,
    // "it does", "Pro does", "the subscription does" — not "it doesn't" (negatedBefore drops those).
    String.raw`\b(?:it|they|we|you|that|this|ours|pro|incognito(?:\s+(?:browser|pro))?|the\s+(?:app|browser|subscription|upgrade|paid\s+[\w-]+|premium\s+[\w-]+))\s+(?:does|do|can|will|has|have)\b(?!\s+(?:not|never)\b)`,
    String.raw`\b(?:includes?|has|have|adds?|offers?|provides?|gives?|gets?\s+you|comes?\s+with|ships?\s+with|bundles?|brings?)\s+(?:one\b|it\b|them\b|that\b|those\b|an?\b|its\b|the\b|our\b|your\b|unlimited\b)`,
    String.raw`\bthere\s+(?:is|are)\s+(?:one\b|an?\b|its\b)`,
    String.raw`\byou\s+(?:can|do|will|get)\b`,
    String.raw`\bwith\s+(?:incognito\s+)?pro\b`,
  ].join('|'),
  'i',
);
/** Is the phrase at `at` denied by a negator in the three words before it, in its clause? */
function negatedBefore(text: string, at: number): boolean {
  const words = (text.slice(0, at).split(NEAR_BREAK).pop() ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\w']/g, ''))
    .filter(Boolean)
    .slice(-3);
  return words.some((w, i) => NEGATOR.test(w) && !NOT_A_DENIAL.test(words[i + 1] ?? ''));
}
/**
 * Does this FAQ answer deny the question's claim? It must open with a denial
 * (DENIAL_ANSWER) and not go on to affirm it. "No. It does not include a VPN."
 * denies; "Nope — Incognito Pro includes one." does not, and neither does "Not
 * really: Incognito Pro adds one."
 */
function deniesAnswer(answer: string): boolean {
  const text = answer.trim();
  const m = DENIAL_ANSWER.exec(text);
  if (!m) return false;
  const rest = text.slice(m.index + m[0].length);
  const affirms = new RegExp(AFFIRMS.source, `${AFFIRMS.flags}g`);
  return ![...rest.matchAll(affirms)].some((a) => !negatedBefore(rest, a.index));
}

/**
 * A bare "Ours" in an FAQ answer on a page that compares us: "Which of these
 * is open source?" / "Ours is, on GitHub." It is read as our product only
 * there, where the question is what it answers (Wave 4 verifier, 2026-09-11).
 */
const BARE_OURS = /\bours\b/i;

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

/** Who a comparison page's sentences can name: our product (by name, or a bare "Pro" when it compares us) and every other product. */
function speakersOf(d: ComparisonData): Speakers {
  const comparesUs = (d.products ?? []).some(looksOurs);
  const others = (d.products ?? []).filter((p) => !looksOurs(p)).map((p) => p.name ?? '').filter(Boolean);
  return speakers(others, comparesUs);
}
function speakers(others: string[], comparesUs: boolean): Speakers {
  const allOf = (s: string, re: RegExp) => [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].map((m) => m.index);
  return {
    ourAt: (s) => [
      ...allOf(s, OURS_BY_NAME),
      // On a page that compares us, a bare "Pro" or "Incognito", and text that
      // points at us without a name, are all us.
      ...(comparesUs ? [...allOf(s, BARE_PRO), ...allOf(s, BARE_INCOGNITO), ...allOf(s, POINTS_AT_US)] : []),
    ],
    theirAt: (s) => others.flatMap((n) => mentionsOf(s, n)),
  };
}

/**
 * Which FAQ questions ask about our product: one that names it, or one that
 * follows such a question and names no product at all, so the subject carries
 * over ("Is Incognito Browser free?" then "Does the app include a VPN?", "Does
 * the subscription add a VPN?", "Is the premium version open source?").
 *
 * The rule used to be a list of the ways a question can refer back ("it", "the
 * app", "Pro"), and every round of review found another synonym one step
 * outside it (Wave 4 verifier, 2026-09-11: "the subscription", "the paid
 * tier", "the premium version"). It is inverted here: a question that names no
 * product continues the one before it, whatever noun it uses, and only naming
 * another product ends the chain.
 */
function faqsAboutUs(d: ComparisonData, who: Speakers): boolean[] {
  let previous = false;
  return (d.faqs ?? []).map((q) => {
    const question = (q.question ?? '').replace(/’/g, "'");
    const others = who.theirAt(question).filter((i) => !asideAt(question, i));
    previous = who.ourAt(question).length > 0 || (previous && others.length === 0);
    return previous;
  });
}

interface Text { where: string; text: string; ours: boolean; answersUs?: boolean; asked?: boolean }

/** Every text in a comparison file except the editorial blocks; `ours` = about our product by position. */
function comparisonTexts(d: ComparisonData, faqUs: boolean[] = []): Text[] {
  const out: Text[] = [];
  const add = (where: string, text: unknown, ours = false, answersUs?: boolean, asked = false) => {
    if (typeof text === 'string' && text.trim()) out.push({ where, text, ours, answersUs, asked });
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
    add(`faqs[${i}].question`, q.question, false, undefined, true);
    add(`faqs[${i}].answer`, q.answer, false, faqUs[i] ?? false);
  });
  (d.pro_tips ?? []).forEach((s, i) => add(`pro_tips[${i}]`, s));
  return out;
}

/**
 * Every text in the file, with the sentences of it that are about our product:
 * in its own row, its cell notes or a bestFor naming it (`whole`, because
 * everything there is about it); naming it ("Incognito Browser", "Incognito
 * Pro", and on a page that compares it a bare "Pro" or "its Pro upgrade"); in
 * an FAQ answer to a question about it (faqsAboutUs); or following, in the same
 * text, a sentence about it with no other product named since ("…, which we
 * make, scores lowest. It adds a VPN."). Naming another product ends that,
 * unless it is set off as an aside ("Unlike Brave, it includes a VPN." still
 * follows).
 */
function aboutUsTexts(d: ComparisonData): Array<{ where: string; text: string; whole: boolean; sentences: Array<{ sentence: string; asStatement: boolean }> }> {
  const comparesUs = (d.products ?? []).some(looksOurs);
  const who = speakersOf(d);
  const out: Array<{ where: string; text: string; whole: boolean; sentences: Array<{ sentence: string; asStatement: boolean }> }> = [];
  for (const t of comparisonTexts(d, faqsAboutUs(d, who))) {
    let aboutUs = t.ours || t.answersUs === true;
    const sentences = sentencesOf(t.text);
    const mine: Array<{ sentence: string; asStatement: boolean }> = [];
    sentences.forEach((sentence, i) => {
      const us = who.ourAt(sentence);
      const them = who.theirAt(sentence).filter((j) => !asideAt(sentence, j));
      const its = comparesUs ? sentence.search(ITS_PRO) : -1;
      // A question in prose answered by the sentence after it is a statement:
      // "Want a VPN too? Incognito Pro has you covered." (Wave 3 verifier).
      const asked = sentence.trim().endsWith('?');
      const answeredAboutUs = asked && !t.asked && who.ourAt(sentences[i + 1] ?? '').length > 0;
      const ours = t.ours || us.length > 0 || (its >= 0 && !them.some((j) => j < its)) || (aboutUs && them.length === 0) || answeredAboutUs;
      if (ours) mine.push({ sentence, asStatement: answeredAboutUs });
      // The product named last carries over to the next sentence.
      if (!t.ours && (us.length || them.length)) aboutUs = Math.max(-1, ...us) > Math.max(-1, ...them);
    });
    out.push({ where: t.where, text: t.text, whole: t.ours, sentences: mine });
  }
  return out;
}

/** The same, sentence by sentence, for the claim check. */
function sentencesAboutUs(d: ComparisonData): Array<{ where: string; sentence: string; asStatement: boolean }> {
  const out: Array<{ where: string; sentence: string; asStatement: boolean }> = [];
  for (const t of aboutUsTexts(d)) for (const s of t.sentences) out.push({ where: t.where, ...s });
  return out;
}

/**
 * An FAQ question about our product (faqsAboutUs) that names a never-claim or
 * an unbacked claim, however it is put ("Does it include a VPN?", "Can I get
 * a VPN with it?", "Why does it include a VPN?"), must be answered with a
 * denial. "Yes", "With Incognito Pro, it does", "You can, with Pro" and
 * "There is" all make the claim.
 *
 * The claim and our product can also sit on opposite sides of the pair: a
 * question naming no product asks which of these does X, and the answer names
 * us ("Which of these includes a VPN?" / "Incognito Pro.", "None other than
 * Incognito Pro.", "Incognito Pro does."). The answer is the affirmation, so
 * the question's claim is ours whenever the answer names us before it names
 * anyone else (Wave 4 verifier, 2026-09-11).
 */
function faqClaimsNotDenied(d: ComparisonData): Array<{ where: string; claim: string; text: string }> {
  const who = speakersOf(d);
  const aboutUs = faqsAboutUs(d, who);
  const out: Array<{ where: string; claim: string; text: string }> = [];
  (d.faqs ?? []).forEach((q, i) => {
    const question = (q.question ?? '').replace(/’/g, "'");
    const answer = (q.answer ?? '').replace(/’/g, "'");
    // The answer points at us, and at us first: "Incognito Pro.", "Ours does."
    const comparesUs = (d.products ?? []).some(looksOurs);
    const named = [
      ...who.ourAt(answer),
      ...(comparesUs ? [...answer.matchAll(new RegExp(BARE_OURS.source, 'gi'))].map((m) => m.index) : []),
    ].filter((at) => !asideAt(answer, at));
    const theirs = who.theirAt(answer).filter((at) => !asideAt(answer, at));
    const answerIsUs =
      named.length > 0 &&
      Math.min(...named) < Math.min(Infinity, ...theirs) &&
      who.theirAt(question).filter((at) => !asideAt(question, at)).length === 0;
    if (!aboutUs[i] && !answerIsUs) return;
    if (deniesAnswer(answer)) return;
    for (const claim of claimsIn(question, true, who)) out.push({ where: `faqs[${i}]`, claim, text: `${q.question} ${q.answer}` });
  });
  return out;
}

/** Every claim the file makes about our product. */
function claimsAboutUs(d: ComparisonData): string[] {
  const who = speakersOf(d);
  return [
    ...sentencesAboutUs(d).flatMap(({ where, sentence, asStatement }) =>
      claimsIn(sentence, asStatement, who).map((claim) => `${where} [${claim}]: ${sentence}`),
    ),
    ...faqClaimsNotDenied(d).map(({ where, claim, text }) => `${where} [${claim}] (not answered with a denial): ${text}`),
  ];
}

// --- what a comparison is allowed to say about us -------------------------------
//
// No pattern can cover every way to make a claim: "Stops ads and trackers on
// every site", "Keeps you safe on public Wi-Fi by securing every connection",
// "Hides your location from the sites you visit", "Nothing you do is ever sent
// to us" and "Tor Browser-level privacy, without the slowdown" each passed
// every word list (Wave 3 verifier, 2026-09-11), and each new round of
// patterns left the next wording open. So what a comparison says about us is
// an allowlist instead, and the patterns above are the second layer, for text
// that names no product and can't be listed one string at a time.
//
// The allowlist covers EVERY string in data/comparisons that mentions us,
// wherever it sits (Wave 4 verifier, 2026-09-11: the same unpatternable claim
// passed in another product's cell note and on the methodology page). Its unit
// is:
//   - our own row, whole: its tagline, pricing, platforms, pros, cons, its
//     cell notes and the bestFor cards naming it — everything there is about
//     us whether or not it says our name;
//   - anywhere else — the intro, the meta description, the verdict summary,
//     another product's cell note, a bestFor reason, an FAQ question or
//     answer, a pro tip — each SENTENCE that mentions us: one that names
//     Incognito Browser or Incognito Pro, that says a bare "Pro" or
//     "Incognito" on a page that compares us, that points at us without a name
//     ("which we make"), or that carries us over from the sentence before it.
// Anything else fails until someone reviews it, so a new sentence about us
// cannot ship unreviewed however it is worded.

/**
 * One reviewed string about Incognito Browser, by file and field, with the
 * data/brand.json facts it states (features[].id, or the top-level platform,
 * pricing, play or dataSafety) and the brand.json never-claims it denies.
 * `states` may also be NAMED or RANKED, for a sentence that names our product
 * without saying what it does; `denies` may say UNDOCUMENTED, for a limit that
 * is nobody's claim ("Cookie-banner handling is not among its listed
 * features"). Every entry needs one of the two.
 */
interface AboutUsString { file: string; field: string; text: string; states: string[]; denies: string[] }

/** Something a string may deny that is not one of brand.json's never-claims. */
const UNDOCUMENTED = 'a feature it does not document';
/** Something a string may state that is not one of brand.json's features. */
const NAMED = 'names it as one of the products compared';
const RANKED = "where it ranks on this page's table";
const ASKED = 'a question in prose that the sentence naming it answers';

const ABOUT_US_STRINGS: AboutUsString[] = [
  // ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that stays in private mode and wipes history, cookies and sessions when you exit', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Built-in ad blocker, with a High Security Blocking option added in May 2026', states: ['ad-blocker'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'Always in private mode: history, cookies and sessions are wiped when you exit the app', states: ['wipe-on-exit'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Settings to turn images, JavaScript and cookies on or off', states: ['settings'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'Android only: there is no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'No fingerprinting protection and no VPN', states: [], denies: ['anti-fingerprinting or fingerprint protection', 'built-in VPN'] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics for analytics', states: ['dataSafety'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.cons[3]', text: 'Custom filter rules and per-site allowlists are not among its listed features', states: [], denies: ['a feature it does not document'] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'criterion "Ad Blocking" note for incognito-browser', text: 'Built-in ad blocker, with a High Security Blocking option since May 2026', states: ['ad-blocker'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'criterion "Cross-Site Tracking Prevention" note for incognito-browser', text: 'Wipes cookies and sessions on exit and lets you turn cookies off; no tracker blocking within a session is listed', states: ['wipe-on-exit', 'settings'], denies: ['tracker-free / no trackers'] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'criterion "Fingerprinting Protection" note for incognito-browser', text: 'Not claimed. Agent Cloaking changes the browser and device a site sees, which is not fingerprint protection', states: ['agent-cloaking'], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'criterion "Ease of Use" note for incognito-browser', text: 'Private mode is always on, so there is nothing to set up', states: ['wipe-on-exit'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'criterion "Customization Options" note for incognito-browser', text: 'Switches for images, JavaScript, cookies and High Security Blocking; custom rules and per-site allowlists aren\'t listed', states: ['settings', 'ad-blocker'], denies: ['a feature it does not document'] },
  // browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser with an ad blocker built in, instead of an add-on', states: ['platform', 'ad-blocker'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Built-in ad blocker, with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'Runs in private mode all the time; history, cookies and sessions are wiped when you exit', states: ['wipe-on-exit'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Settings to turn images, JavaScript and cookies on or off', states: ['settings'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.pros[3]', text: 'No add-ons to install or keep updated', states: [], denies: ['a feature it does not document'] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'A separate browser, not an extension for the browser you already use', states: [], denies: ['a feature it does not document'] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'Android only: no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'Tracker blocking and custom filter rules are not among its listed features', states: [], denies: ['tracker-free / no trackers', 'a feature it does not document'] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.cons[3]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'criterion "Ad Blocking" note for incognito-browser', text: 'Built-in ad blocker, with a High Security Blocking option since May 2026', states: ['ad-blocker'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'criterion "Tracker Blocking" note for incognito-browser', text: 'A tracker blocker is not among its listed features; cookies can be switched off and are wiped when you exit', states: ['settings', 'wipe-on-exit'], denies: ['tracker-free / no trackers'] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'criterion "Ease of Use" note for incognito-browser', text: 'No add-on to set up; private mode is always on', states: ['wipe-on-exit'], denies: ['a feature it does not document'] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'criterion "Customization" note for incognito-browser', text: 'Switches for images, JavaScript, cookies and High Security Blocking; custom rules and per-site allowlists aren\'t listed', states: ['settings', 'ad-blocker'], denies: ['a feature it does not document'] },
  // browser-privacy/best-browser-privacy-tools-compared.json
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that stays in private mode and wipes history, cookies and sessions when you exit', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Every tab is private; history, cookies and sessions are wiped when you exit', states: ['tabs', 'wipe-on-exit'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'Keeps no browsing history or cache on the device (downloads are kept)', states: ['no-history'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Built-in ad blocker with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.pros[3]', text: 'Settings to switch images, JavaScript and cookies on or off', states: ['settings'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'Android only: there is no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'No fingerprinting protection, tracker blocking or HTTPS-only mode is documented', states: [], denies: ['anti-fingerprinting or fingerprint protection', 'tracker-free / no trackers', 'a feature it does not document'] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'Does not include a VPN', states: [], denies: ['built-in VPN'] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.cons[3]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'criterion "Default Privacy Settings" note for incognito-browser', text: 'Private mode is always on; history, cookies and sessions are wiped on exit', states: ['wipe-on-exit'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'criterion "Ad & Tracker Blocking" note for incognito-browser', text: 'Built-in ad blocker with a High Security Blocking option; tracker blocking is not documented', states: ['ad-blocker'], denies: ['tracker-free / no trackers'] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'criterion "Fingerprinting Protection" note for incognito-browser', text: 'Not claimed. Agent Cloaking changes the browser and device a site sees, which is not fingerprint protection', states: ['agent-cloaking'], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'criterion "Data Collection Transparency" note for incognito-browser', text: 'Google Play\'s Data safety section: may collect app info, crash logs and diagnostics; none shared with third parties', states: ['dataSafety'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'criterion "Secure Connection Features" note for incognito-browser', text: 'No HTTPS-only or HTTPS-upgrade mode is documented', states: [], denies: ['a feature it does not document'] },
  // browser-privacy/best-privacy-browsers-compared.json
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that stays in private mode and wipes history, cookies and sessions when you exit', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.pros[0]', text: 'Runs in private mode all the time; history, cookies and sessions are wiped when you exit', states: ['wipe-on-exit'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.pros[1]', text: 'Built-in ad blocker, with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.pros[2]', text: 'Agent Cloaking changes the browser and device a site sees, and can load desktop sites', states: ['agent-cloaking'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.pros[3]', text: 'Settings to turn images, JavaScript and cookies on or off', states: ['settings'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.cons[0]', text: 'Android only: no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.cons[1]', text: 'Not open source', states: [], denies: ['open source'] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.cons[2]', text: 'Does not claim tracker or fingerprint protection', states: [], denies: ['tracker-free / no trackers', 'anti-fingerprinting or fingerprint protection'] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.cons[3]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'criterion "Built-in Ad Blocking" note for incognito-browser', text: 'Built-in ad blocker with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'criterion "Tracker Protection" note for incognito-browser', text: 'Automatic tracker blocking is not in the app\'s verified feature list; cookies are wiped when you exit', states: ['wipe-on-exit'], denies: ['tracker-free / no trackers'] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'criterion "Fingerprint Protection" note for incognito-browser', text: 'Not claimed. Agent Cloaking changes the browser and device a site sees, which is not fingerprint protection', states: ['agent-cloaking'], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'criterion "Open Source" note for incognito-browser', text: 'Not open source', states: [], denies: ['open source'] },
  // cookie-management/best-cookie-management-tracking-prevention-tools-compared.json
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that stays in private mode and wipes cookies when you exit', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Wipes cookies, history and sessions every time you exit', states: ['wipe-on-exit'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'A setting turns cookies off entirely', states: ['settings'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Built-in ad blocker, with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.pros[3]', text: 'Always in private mode, so there is nothing to set up', states: ['wipe-on-exit'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'The cookie setting is all or nothing; no third-party-only option is listed', states: ['settings'], denies: ['a feature it does not document'] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'No cookie-banner handling or report of what it blocks is listed', states: [], denies: ['a feature it does not document'] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'Wiping cookies on exit signs you out of sites each time', states: ['wipe-on-exit'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.cons[3]', text: 'Android only: no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.cons[4]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'criterion "Third-party Cookie Blocking" note for incognito-browser', text: 'A setting turns all cookies off (no third-party-only option is listed); cookies are wiped on exit', states: ['settings', 'wipe-on-exit'], denies: ['a feature it does not document'] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'criterion "Easy Setup" note for incognito-browser', text: 'Always in private mode; wiping cookies on exit needs no setup, but it means using a separate browser', states: ['wipe-on-exit'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'criterion "Cookie Consent Management" note for incognito-browser', text: 'Cookie-banner handling is not among its listed features', states: [], denies: ['a feature it does not document'] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'criterion "Website Compatibility" note for incognito-browser', text: 'Not among its listed features; wiping cookies on exit signs you out of sites each time', states: ['wipe-on-exit'], denies: ['a feature it does not document'] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'criterion "Privacy Transparency" note for incognito-browser', text: 'No report of blocked trackers or cookies is listed', states: [], denies: ['a feature it does not document'] },
  // device-fingerprinting/best-device-fingerprinting-tools-compared.json
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that stays in private mode and wipes history, cookies and sessions when you exit', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Every tab is private; history, cookies and sessions are wiped when you exit', states: ['tabs', 'wipe-on-exit'], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'Settings to switch JavaScript, images and cookies off', states: ['settings'], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Agent Cloaking can mask the browser and device a site sees', states: ['agent-cloaking'], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'No fingerprinting protection is documented', states: [], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'Android only: there is no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'criterion "Canvas Fingerprinting Protection" note for incognito-browser', text: 'Not documented', states: [], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'criterion "WebGL Fingerprinting Protection" note for incognito-browser', text: 'Not documented', states: [], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'criterion "Audio Fingerprinting Protection" note for incognito-browser', text: 'Not documented', states: [], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'criterion "Font Fingerprinting Protection" note for incognito-browser', text: 'Not documented', states: [], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'criterion "Screen Resolution Spoofing" note for incognito-browser', text: 'Not documented', states: [], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'criterion "User Agent Randomization" note for incognito-browser', text: 'Not documented. Agent Cloaking changes the browser and device a site sees, which is not fingerprint protection', states: ['agent-cloaking'], denies: ['anti-fingerprinting or fingerprint protection'] },
  // incognito-mode/best-incognito-mode-tools-compared.json
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that is always in private mode and wipes history, cookies and sessions when you exit', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Every tab is private; there is no normal mode to switch out of', states: ['tabs', 'wipe-on-exit'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'History, cookies and sessions are wiped when you exit the app', states: ['wipe-on-exit'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Keeps no browsing history or cache on the device (downloaded files are kept)', states: ['no-history'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.pros[3]', text: 'Built-in ad blocker with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'Android only: no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'No VPN: sites you visit still see your IP address, and your network and internet provider can see which sites you visit', states: [], denies: ['built-in VPN'] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'Does not claim tracker blocking or fingerprinting protection', states: [], denies: ['tracker-free / no trackers', 'anti-fingerprinting or fingerprint protection'] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.cons[3]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'criterion "Tracking Protection" note for incognito-browser', text: 'Wipes cookies and sessions when you exit, and cookies can be turned off; the ad blocker blocks ads. Tracker blocking is not claimed', states: ['wipe-on-exit', 'settings', 'ad-blocker'], denies: ['tracker-free / no trackers'] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'criterion "Fingerprinting Protection" note for incognito-browser', text: 'Not claimed. Agent Cloaking changes the browser and device a site sees, which is not fingerprint protection', states: ['agent-cloaking'], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'criterion "Ease of Use" note for incognito-browser', text: 'Always in private mode; no special window to open', states: ['wipe-on-exit'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'criterion "Extension Support" note for incognito-browser', text: 'Extensions are not among its listed features', states: [], denies: ['a feature it does not document'] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'bestFor[5].useCase', text: 'Never forgetting to go private on Android', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'bestFor[5].reason', text: 'Which we make: every tab is private, and history, cookies and sessions are wiped when you exit. It ranks last on this table\'s criteria', states: ['tabs', 'wipe-on-exit'], denies: [] },
  // search-history/best-search-history-privacy-tools-compared.json
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that keeps no browsing history and wipes cookies and sessions when you exit', states: ['platform', 'no-history', 'wipe-on-exit'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Keeps no browsing history or cache on the device (downloaded files are kept)', states: ['no-history'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'History, cookies and sessions are wiped when you exit the app', states: ['wipe-on-exit'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Choice of search engine, including DuckDuckGo, Google and Bing', states: ['search-engines'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.pros[3]', text: 'Built-in ad blocker with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'Android only: no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'Doesn\'t delete searches a search engine keeps on its servers, such as in your Google account', states: [], denies: ['a feature it does not document'] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'No VPN, so your internet provider and network can still see which sites you visit', states: [], denies: ['built-in VPN'] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.cons[3]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'criterion "Automatic History Deletion" note for incognito-browser', text: 'Keeps no browsing history and wipes it on exit; doesn\'t touch what a search engine logs on its servers', states: ['no-history', 'wipe-on-exit'], denies: ['a feature it does not document'] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'criterion "Cross-Device Sync Protection" note for incognito-browser', text: 'Keeps no browsing history on the device, so there is none to sync; it can\'t stop a signed-in search engine account syncing your searches', states: ['no-history'], denies: ['a feature it does not document'] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'criterion "Ad Tracking Prevention" note for incognito-browser', text: 'Built-in ad blocker, and cookies are wiped on exit; tracker blocking is not claimed, and your search engine still sees your searches', states: ['ad-blocker', 'wipe-on-exit'], denies: ['tracker-free / no trackers'] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'criterion "Ease of Setup" note for incognito-browser', text: 'Install from Google Play and start browsing', states: ['play', 'wipe-on-exit'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'criterion "Search Quality" note for incognito-browser', text: 'Depends on the search engine you choose (Google, DuckDuckGo, Bing and others)', states: ['search-engines'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'criterion "Mobile Support" note for incognito-browser', text: 'Android only; no iOS app', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'bestFor[4].useCase', text: 'Browsing on Android that leaves no history behind', states: ['platform', 'no-history'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'bestFor[4].reason', text: 'Which we make: it keeps no browsing history and wipes cookies and sessions when you exit, with your choice of search engine. It ranks last on this table\'s criteria', states: ['no-history', 'wipe-on-exit', 'search-engines'], denies: [] },
  // social-media-privacy/best-social-media-privacy-tools-compared.json
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.tagline', text: 'Android browser that stays in private mode and wipes cookies and sessions when you exit', states: ['platform', 'wipe-on-exit'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.pros[0]', text: 'Social sites\' cookies and sessions are wiped when you exit, so logins don\'t carry over', states: ['wipe-on-exit'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.pros[1]', text: 'A setting switches cookies off entirely', states: ['settings'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.pros[2]', text: 'Built-in ad blocker with a High Security Blocking option', states: ['ad-blocker'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.cons[0]', text: 'Tracker blocking, privacy alerts and social-platform guides are not among its listed features', states: [], denies: ['tracker-free / no trackers', 'a feature it does not document'] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.cons[1]', text: 'Protects browsing only, not social media apps', states: [], denies: ['a feature it does not document'] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.cons[2]', text: 'Android only: no iOS, desktop or web version', states: ['platform'], denies: ['works on all platforms / iOS / desktop'] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.cons[3]', text: 'Google Play\'s Data safety section says it may collect crash logs and diagnostics', states: ['dataSafety'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'criterion "Social Media Tracker Blocking" note for incognito-browser', text: 'Tracker blocking is not among its listed features; cookies and sessions are wiped when you exit', states: ['wipe-on-exit'], denies: ['tracker-free / no trackers'] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'criterion "Platform-Specific Privacy Settings" note for incognito-browser', text: 'Not among its listed features', states: [], denies: ['a feature it does not document'] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'criterion "Data Download Assistance" note for incognito-browser', text: 'Not among its listed features', states: [], denies: ['a feature it does not document'] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'criterion "Cross-Platform Protection" note for incognito-browser', text: 'Switching cookies off stops cookie-based tracking across sites; cookies are also wiped when you exit', states: ['settings', 'wipe-on-exit'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'criterion "Mobile App Protection" note for incognito-browser', text: 'Protects browsing only, not social media apps', states: [], denies: ['a feature it does not document'] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'criterion "Real-Time Privacy Alerts" note for incognito-browser', text: 'Not among its listed features', states: [], denies: ['a feature it does not document'] },

  // --- and what the rest of each page says about us: the sentences of the
  // intro, meta description, verdict summary, FAQ answers and keywords that
  // mention our product, plus our row's pricing and platforms ---------------
  // ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'intro', text: 'Tired of ads following you across the web?', states: [ASKED], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'intro', text: 'This page compares five ways to cut ad tracking: three browser extensions (uBlock Origin, Ghostery and Privacy Badger) and two browsers (DuckDuckGo and Incognito Browser), each scored on the same five criteria.', states: [NAMED], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'ad-tracking/best-ad-tracking-targeted-advertising-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, scores lowest: it has a built-in ad blocker and wipes cookies and history when you exit, but it documents no fingerprinting protection or tracker blocking.', states: [RANKED, 'ad-blocker', 'wipe-on-exit'], denies: ['anti-fingerprinting or fingerprint protection', 'tracker-free / no trackers'] },
  // browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'metaDescription', text: 'uBlock Origin, Ghostery, Privacy Badger and DuckDuckGo\'s add-on compared with Incognito Browser (which we make) on blocking, ease of use and customization.', states: [NAMED], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'verdict.summary', text: 'DuckDuckGo\'s extension and Incognito Browser, which we make, tie for the lowest score (DuckDuckGo\'s is listed first alphabetically).', states: [RANKED], denies: [] },
  { file: 'browser-extensions/best-browser-extensions-privacy-add-ons-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser is an Android browser with a built-in ad blocker, not an extension, and it doesn\'t list tracker blocking or custom filter rules.', states: ['platform', 'ad-blocker'], denies: ['tracker-free / no trackers', UNDOCUMENTED] },
  // browser-privacy/best-browser-privacy-tools-compared.json
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'metaDescription', text: 'How Brave, Firefox, Safari, Chrome and Incognito Browser (which we make) compare on privacy defaults, blocking, fingerprinting, transparency and HTTPS.', states: [NAMED], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'verdict.summary', text: 'On these five criteria Brave scores highest, followed by Firefox, Safari, Chrome and Incognito Browser.', states: [RANKED], denies: [] },
  { file: 'browser-privacy/best-browser-privacy-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, keeps every tab private and wipes history, cookies and sessions when you exit, but it documents no fingerprinting protection, tracker blocking or HTTPS-only mode, so it scores lowest here.', states: [RANKED, 'tabs', 'wipe-on-exit'], denies: ['anti-fingerprinting or fingerprint protection', 'tracker-free / no trackers', UNDOCUMENTED] },
  // browser-privacy/best-privacy-browsers-compared.json
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'metaDescription', text: 'Brave, Firefox and Incognito Browser (which we make) compared on ad blocking, tracker and fingerprint protection, and open source code, on one rubric.', states: [NAMED], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, scores lowest here: it has a built-in ad blocker and wipes history, cookies and sessions when you exit, but it is not open source, does not claim tracker or fingerprint protection, and runs only on Android.', states: [RANKED, 'ad-blocker', 'wipe-on-exit', 'platform'], denies: ['open source', 'tracker-free / no trackers', 'anti-fingerprinting or fingerprint protection', 'works on all platforms / iOS / desktop'] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'faqs[0].answer', text: 'Brave on Android does not support extensions, and extensions are not among Incognito Browser\'s listed features.', states: [], denies: [UNDOCUMENTED] },
  { file: 'browser-privacy/best-privacy-browsers-compared.json', field: 'faqs[1].answer', text: 'Incognito Browser keeps no browsing history and does not list a password manager among its features, so if you switch to it, keep your passwords in a separate password manager.', states: ['no-history'], denies: [UNDOCUMENTED] },
  // cookie-management/best-cookie-management-tracking-prevention-tools-compared.json
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'cookie-management/best-cookie-management-tracking-prevention-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, scores lowest: it wipes cookies when you exit and can turn them off, but it lists no cookie-banner handling or report of what it blocks.', states: [RANKED, 'wipe-on-exit', 'settings'], denies: [UNDOCUMENTED] },
  // device-fingerprinting/best-device-fingerprinting-tools-compared.json
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'metaDescription', text: 'Tor Browser, Brave, CanvasBlocker, Firefox with uBlock Origin and Incognito Browser (which we make) scored on the same six fingerprinting defences.', states: [NAMED], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, scores lowest: it documents no fingerprinting protection.', states: [RANKED], denies: ['anti-fingerprinting or fingerprint protection'] },
  { file: 'device-fingerprinting/best-device-fingerprinting-tools-compared.json', field: 'verdict.summary', text: 'Its Agent Cloaking changes the browser and device a site sees, which is not the same thing.', states: ['agent-cloaking'], denies: ['anti-fingerprinting or fingerprint protection'] },
  // incognito-mode/best-incognito-mode-tools-compared.json
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'metaDescription', text: 'Chrome, Firefox, Safari and Edge private modes compared with Tor Browser and Incognito Browser (which we make), each scored on the same rubric.', states: [NAMED], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'keywords[2]', text: 'incognito browser', states: [NAMED], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'intro', text: 'This page compares four built-in private modes with Tor Browser and Incognito Browser on the same four criteria, and each rating is worked out from the table.', states: [NAMED], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'incognito-mode/best-incognito-mode-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, scores lowest here: it is always in private mode and wipes history, cookies and sessions when you exit, but it doesn\'t claim tracker blocking or fingerprinting protection, has no extensions and runs only on Android.', states: [RANKED, 'wipe-on-exit', 'platform'], denies: ['tracker-free / no trackers', 'anti-fingerprinting or fingerprint protection', 'works on all platforms / iOS / desktop', UNDOCUMENTED] },
  // search-history/best-search-history-privacy-tools-compared.json
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'metaDescription', text: 'DuckDuckGo, Startpage, Brave, Google Activity Controls and Incognito Browser (which we make) compared on deleting and limiting your search history.', states: [NAMED], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'search-history/best-search-history-privacy-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, scores lowest: it keeps no browsing history and wipes cookies and sessions when you exit, but it runs only on Android, doesn\'t claim tracker blocking, and can\'t stop a signed-in search engine account from syncing your searches.', states: [RANKED, 'no-history', 'wipe-on-exit', 'platform'], denies: ['tracker-free / no trackers', 'works on all platforms / iOS / desktop', UNDOCUMENTED] },
  // social-media-privacy/best-social-media-privacy-tools-compared.json
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'metaDescription', text: 'DuckDuckGo\'s browser, Ghostery, Privacy Badger and Incognito Browser (which we make) compared on limiting tracking by Facebook, Instagram, TikTok and more.', states: [NAMED], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.pricing', text: 'Free; optional Incognito Pro subscription', states: ['pricing'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'incognito-browser.platforms[0]', text: 'Android', states: ['platform'], denies: [] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'verdict.summary', text: 'Incognito Browser, which we make, scores lowest: it can switch cookies off and wipes them when you exit, but it doesn\'t list tracker blocking or privacy alerts.', states: [RANKED, 'settings', 'wipe-on-exit'], denies: ['tracker-free / no trackers', UNDOCUMENTED] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'verdict.summary', text: 'None of the four offers guides to each platform\'s privacy settings or helps you download your data, so do those in each platform\'s own settings.', states: [], denies: [UNDOCUMENTED] },
  { file: 'social-media-privacy/best-social-media-privacy-tools-compared.json', field: 'faqs[0].answer', text: 'Incognito Browser, which we make, is free, with an optional Incognito Pro subscription.', states: ['pricing'], denies: [] },
];

/**
 * Every string in the file that mentions us, each needing a reviewed
 * ABOUT_US_STRINGS entry: our own row's fields whole, and every other
 * sentence that mentions us (see aboutUsTexts).
 */
function stringsAboutUs(d: ComparisonData): Array<{ field: string; text: string }> {
  return aboutUsTexts(d).flatMap((t) =>
    t.whole ? [{ field: t.where, text: t.text }] : t.sentences.map((s) => ({ field: t.where, text: s.sentence })),
  );
}

/** For the unit checks below: a page comparing us with these products. */
const SAMPLE_SPEAKERS = speakers(['Brave', 'Firefox', 'Tor Browser', 'DuckDuckGo', 'Google Activity Controls'], true);
const neverClaimsIn = (sentence: string) => claimsIn(sentence, false, SAMPLE_SPEAKERS);

// --- the methodology page ------------------------------------------------------

const METHODOLOGY_PAGE = path.join(process.cwd(), 'app', 'comparisons', 'methodology', 'page.tsx');

/**
 * The methodology page's words: its JSX text, plus every quoted string (the
 * metadata description and the section titles are attributes). The file
 * comment goes; class names and import paths are harmless noise.
 */
function methodologyStrings(): string[] {
  const src = fs.readFileSync(METHODOLOGY_PAGE, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const nodes = [...src.matchAll(/>([^<>{}]*)</g)].map((m) => m[1]);
  const quoted = [...src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]);
  return [...nodes, ...quoted]
    .map((s) => s.replace(/&apos;|&#39;/g, "'").replace(/&ldquo;|&rdquo;|&quot;/g, '"').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
const methodologyWords = () => methodologyStrings().join(' ');

/** A class list, an import path or a fragment of code: not something the page says. */
const NOT_PROSE = (s: string) =>
  s.split(/\s+/).length < 4 || /^[a-z0-9\s:._/-]+$/.test(s) || /[{}<>]|=>|\b(?:const|function|return|import|export)\b/.test(s);
/** The page's prose, string by string: each paragraph, heading and description a reader sees. */
const methodologyProse = () => methodologyStrings().filter((s) => !NOT_PROSE(s));

/**
 * Sentences on the methodology page that name one of brand.json's
 * never-claims without claiming it, each reviewed. Every other sentence there
 * about our product is checked like a comparison's, so "Incognito Pro, its
 * optional subscription, adds a VPN." can't be slipped in (Wave 3 verifier,
 * 2026-09-11). A test keeps each of these on the page, so none goes stale.
 */
const METHODOLOGY_ALLOWED: Array<{ sentence: string; why: string }> = [
  {
    sentence:
      'We include it only in comparisons of browsers and private-browsing modes, ad, tracker and cookie blocking, fingerprinting and search history, and leave it out of everything else, such as VPNs or email services.',
    why: 'Names fingerprinting and VPNs as page subjects, and says where we leave our product out; it claims neither.',
  },
];

/** Where the methodology page names our product, with no other product on the page to take over. */
const METHODOLOGY_SPEAKERS = speakers([], true);

/**
 * The same allowlist as data/comparisons', for the one other page that talks
 * about our product: every sentence of the methodology page's prose that names
 * it, reviewed against data/brand.json. The patterns miss a claim that uses
 * none of their words — "Incognito Pro, our subscription, keeps you safe on
 * public Wi-Fi." passed every one of them (Wave 4 verifier, 2026-09-11) — so a
 * sentence naming us there has to be listed before it can ship.
 */
const METHODOLOGY_ABOUT_US: Array<{ text: string; states: string[]; denies: string[]; why: string }> = [
  {
    text:
      'These pages are published by the makers of Incognito Browser, a private browser for Android. Some comparisons include it, so every product, ours included, is rated the same way: by code, from the table on the page.',
    states: ['platform', NAMED],
    denies: [],
    why: 'Says who publishes the pages and that our product is rated by the same code as the rest; the only fact about it is that it is an Android browser.',
  },
  {
    text:
      'The one rubric behind every comparison rating here: how table cells become points, what is not counted, how ties are broken, and how Incognito Browser, which we make, is scored.',
    states: [NAMED],
    denies: [],
    why: "The page's meta description: it names our product as one the rubric scores, and says nothing it does.",
  },
  { text: 'Incognito Browser is scored the same way', states: [NAMED], denies: [], why: 'A section heading, naming our product and the one rubric.' },
  {
    text:
      'We make Incognito Browser, and every comparison that includes it says so at the top of the page. It is scored with the same rubric as every other product.',
    states: [NAMED],
    denies: [],
    why: 'The disclosure rule itself (owner decision, 2026-09-10); it states no feature.',
  },
  {
    text:
      "The cells are our reading of each product's published features, and we have not independently verified them. We don't run lab tests of our own; where a cell follows a third-party lab result, the page says so. Criteria such as ease of use are our judgement, not a documented feature. Speed and performance are scored only where the page cites a third-party measurement. Products change, so check anything that matters to you with the product itself.",
    states: [NAMED],
    denies: [],
    why: 'About every product on every page, ours included ("our reading of each product\'s features"): what the cells are and what we have not done. It states no feature of ours.',
  },
];

/** Every paragraph, heading or description of the methodology page that names our product. */
function methodologyStringsAboutUs(): string[] {
  return methodologyProse().filter((s) => METHODOLOGY_SPEAKERS.ourAt(s).length > 0);
}

/** Every claim the methodology page makes about our product. */
function methodologyClaims(): string[] {
  const who = METHODOLOGY_SPEAKERS;
  const found: string[] = [];
  let aboutUs = false;
  const sentences = sentencesOf(methodologyWords());
  sentences.forEach((sentence, i) => {
    const us = who.ourAt(sentence);
    const asked = sentence.trim().endsWith('?');
    const answeredAboutUs = asked && who.ourAt(sentences[i + 1] ?? '').length > 0;
    const ours = us.length > 0 || aboutUs || answeredAboutUs;
    if (us.length) aboutUs = true;
    if (!ours || METHODOLOGY_ALLOWED.some((e) => sentence.includes(e.sentence))) return;
    for (const claim of claimsIn(sentence, answeredAboutUs, who)) found.push(`[${claim}]: ${sentence}`);
  });
  return found;
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
      // Each passed every test before the Wave 2c verifier (2026-09-11).
      // A denial whose subject is another product claims it for us.
      'Brave has no VPN, but Incognito Pro does.',
      'Brave lacks the VPN that Incognito Pro includes.',
      'Unlike Incognito Pro, Brave has no VPN.',
      "Unlike Incognito Browser, Brave doesn't include a VPN.",
      'Brave, unlike Incognito Pro, has no VPN.',
      'No VPN in Brave, unlike Incognito Pro.',
      'Unlike Brave, it includes a built-in VPN.',
      // Never-claims without the word that names them.
      'Incognito Pro adds a virtual private network.',
      'Routes your traffic through a proxy server.',
      'Tunnels your traffic to a server abroad.',
      'Routes your connection the way Tor Browser does.',
      "Spoofs canvas and WebGL readouts so sites can't recognise your phone.",
      "Sites can't tell your phone apart from anyone else's.",
      "We don't collect any of your data.",
      'Your data never leaves your phone.',
      'Its source code is public on GitHub.',
      // A denial at the start of a list doesn't reach past an item that starts
      // something new (Wave 3 verifier, 2026-09-11).
      'Incognito Pro means no ads, no limits and a fast VPN.',
      'No ads, no limits, just a fast VPN.',
      'Incognito Pro: no ads, and a VPN.',
      // A denied list reaches bare nouns, and stops at anything else (Wave 4 verifier).
      'Incognito Pro means no ads, no limits and hiding your IP from every site.',
      'Incognito Pro means no ads, no limits and built-in VPN access.',
      'With Incognito Pro there are no ads, no trackers and unlimited VPN bandwidth.',
      'Incognito Pro means no ads, no limits and it encrypts your traffic.',
      'No ads, no limits and its own VPN.',
      "It doesn't block ads, just hides your IP address.",
      'It does not log your browsing, and also encrypts your traffic.',
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
      // Our product as the denial's subject, with another product named.
      'Unlike Brave, Incognito Browser has no VPN.',
      'Incognito Browser, like Brave, has no VPN.',
      'No VPN in Incognito Browser, unlike Brave.',
      "It doesn't stop sites recognising your phone.",
      'It has no proxy or VPN.',
      'Its source code is not public.',
      'It does not route your traffic through another server.',
      // Honest denials list bare nouns, so the list still reaches them.
      'No VPN, Tor, proxy or fingerprint protection.',
      'It does not hide your IP, encrypt your traffic or route your browsing.',
      'No iOS, desktop or web version, and no VPN.',
      // Bare-noun items, however they are spelled (Wave 4 verifier).
      'No fingerprinting protection, tracker blocking or HTTPS-only mode is documented.',
      'No VPN, proxy or Tor routing is documented.',
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
    const faqs = (...qa: Array<[string, string]>) => page({ faqs: qa.map(([question, answer]) => ({ question, answer })) });
    // Each passed every test before the 2026-09-10 review.
    const summary = 'Brave scores highest. Incognito Browser, which we make, scores lowest. Its Pro upgrade adds a built-in VPN.';
    expect(claimsAboutUs(page({ verdict: { summary, bestFor: [] } }))).toHaveLength(1);
    const carried = 'Incognito Browser, which we make, scores lowest. It is open source.';
    expect(claimsAboutUs(page({ verdict: { summary: carried, bestFor: [] } }))).toHaveLength(1);
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', 'Yes. Pro includes one, so your internet provider sees nothing.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser open source?', 'Yes, its code is open source and public.']))).not.toEqual([]);
    // Our row under another slug is still ours.
    const alias = page({});
    alias.products![1] = { name: 'Incognito', slug: 'incognito-app', website: `${BRAND.playUrl}&hl=en`, tagline: 'Hides your IP address' };
    expect(claimsAboutUs(alias)).toHaveLength(1);
    // Each passed every test before the Wave 2c verifier (2026-09-11).
    // "Unlike Brave," sets Brave aside: "it" is still us.
    const aside = 'Incognito Browser, which we make, scores lowest. Unlike Brave, it includes a built-in VPN.';
    expect(claimsAboutUs(page({ verdict: { summary: aside, bestFor: [] } }))).not.toEqual([]);
    expect(claimsAboutUs(page({ verdict: { summary: 'Incognito Browser, which we make, scores lowest. It, like Brave, is open source.', bestFor: [] } }))).not.toEqual([]);
    // A denial whose subject is another product, in the summary.
    expect(claimsAboutUs(page({ verdict: { summary: 'Brave has no VPN, but Incognito Pro does.', bestFor: [] } }))).not.toEqual([]);
    // An FAQ about us answered with anything but a denial.
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', 'With Incognito Pro, it does.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Can I get a VPN with Incognito Browser?', 'You can, with Incognito Pro.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is there a VPN in Incognito Pro?', 'There is.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Why does Incognito Browser include a VPN?', "So your internet provider can't see the sites you visit."]))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes; Incognito Pro is an optional subscription.'], ['Does it include a VPN?', 'Yes, with Pro.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Does Incognito Browser block trackers?', 'It does.']))).not.toEqual([]);
    // Our row's own words, never-claims without the word that names them.
    const row = page({});
    row.products![1].pros = ['Incognito Pro adds a virtual private network', 'Routes your traffic through a proxy server', 'Its source code is public on GitHub'];
    row.products![1].cons = ["We don't collect any of your data", 'Your data never leaves your phone'];
    const flagged = claimsAboutUs(row).join('\n');
    for (const s of [...row.products![1].pros, ...row.products![1].cons]) expect(flagged, s).toContain(s);
    // Not about us: another product named since, a general FAQ, another product's "Pro".
    expect(claimsAboutUs(page({ verdict: { summary: 'Incognito Browser, which we make, scores lowest. Brave is open source.', bestFor: [] } }))).toEqual([]);
    expect(claimsAboutUs(faqs(['Does a VPN hide my IP?', 'Yes. A VPN hides your IP address from sites.']))).toEqual([]);
    expect(claimsAboutUs(faqs(['Does Brave include a VPN?', 'Yes, on paid plans.']))).toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser a VPN?', 'No. It does not include a VPN.']))).toEqual([]);
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', "It doesn't; it is a private browser."]))).toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes; Incognito Pro is an optional subscription.'], ['Does it include a VPN?', 'No.']))).toEqual([]);
    expect(claimsAboutUs(page({ intro: "DuckDuckGo's Privacy Pro subscription includes a VPN." }))).toEqual([]);
    expect(claimsAboutUs(page({ verdict: { summary: 'Unlike Brave, Incognito Browser has no VPN.', bestFor: [] } }))).toEqual([]);
  });

  it('closes the ways round it the Wave 3 verifier found', () => {
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
    const faqs = (...qa: Array<[string, string]>) => page({ faqs: qa.map(([question, answer]) => ({ question, answer })) });
    // A denial at the start of a list doesn't swallow what follows it.
    expect(claimsAboutUs(page({ verdict: { summary: 'Incognito Pro means no ads, no limits and a fast VPN.', bestFor: [] } }))).not.toEqual([]);
    const pros = page({});
    pros.products![1].pros = ['No ads, no limits, just a fast VPN'];
    expect(claimsAboutUs(pros)).not.toEqual([]);
    // Only a real denial answers an FAQ that asks about a never-claim.
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', 'No need for a separate app: Incognito Pro includes one.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Does Incognito Pro include a VPN?', 'No doubt: it does.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser open source?', 'Not surprisingly, yes.']))).not.toEqual([]);
    for (const a of ['No.', 'No, it does not.', 'No — it is a browser.', 'Nope.', 'Not yet.', 'Not included.', 'Not on these criteria.', 'There is no VPN.', "It doesn't include one.", 'Incognito Browser does not include a VPN.', 'No VPN is documented.', 'The app has no VPN.', 'No, there is nothing like it.']) {
      expect(DENIAL_ANSWER.test(a), a).toBe(true);
    }
    for (const a of ['No need for a separate app: Incognito Pro includes one.', 'No doubt: it does.', 'No doubt about it.', 'Not only that: it is built in.', 'Not surprisingly, yes.', 'None other than Incognito Pro.', 'No matter which plan you pick, it is there.', 'Not just a VPN, but a fast one.', 'Yes.', 'It includes one.']) {
      expect(DENIAL_ANSWER.test(a), a).toBe(false);
    }
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', 'No. It is a private browser.']))).toEqual([]);
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', 'Not yet: nothing like it is documented.']))).toEqual([]);
    // A follow-up question that says "the app", "this browser" or "Pro", not "it".
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Does the app include a VPN?', 'Yes, with Pro.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Is this browser open source?', 'Yes, on GitHub.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Does Pro add a VPN?', 'It does.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Does the app include a VPN?', 'No. It does not.']))).toEqual([]);
    expect(claimsAboutUs(faqs(['Is Brave free?', 'Yes.'], ['Does the app include a VPN?', 'Yes, on paid plans.']))).toEqual([]);
    // A question in prose, answered by the sentence after it.
    expect(claimsAboutUs(page({ verdict: { summary: 'Want a VPN too? Incognito Pro has you covered.', bestFor: [] } }))).not.toEqual([]);
    expect(claimsAboutUs(page({ intro: 'Want a VPN too? Brave has you covered.' }))).toEqual([]);
    // On a page that compares us, text that points at us without our full name.
    expect(claimsAboutUs(page({ verdict: { summary: 'Our own browser comes with a built-in VPN.', bestFor: [] } }))).not.toEqual([]);
    expect(claimsAboutUs(page({ verdict: { summary: 'Incognito, which we make, includes a VPN.', bestFor: [] } }))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Which browsers have a VPN?', 'Our browser has a built-in VPN, too.']))).not.toEqual([]);
    // Not our product: Chrome's private window, and a private window of ours.
    expect(claimsAboutUs(page({ intro: "Chrome Incognito Mode doesn't include a VPN, and neither does Brave's." }))).toEqual([]);
  });

  it('closes the ways round it the Wave 4 verifier found', () => {
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
    const faqs = (...qa: Array<[string, string]>) => page({ faqs: qa.map(([question, answer]) => ({ question, answer })) });
    // The claim in the question, our product in the answer.
    expect(claimsAboutUs(faqs(['Which of these includes a VPN?', 'Incognito Pro.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Which of these includes a VPN?', 'None other than Incognito Pro.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Which of these hides my IP from my internet provider?', 'Incognito Pro does.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Which of these is open source?', 'Ours is, on GitHub.']))).not.toEqual([]);
    // Not ours: another product answers it, or nobody does.
    expect(claimsAboutUs(faqs(['Which of these includes a VPN?', 'Brave does, on paid plans; Incognito Browser does not.']))).toEqual([]);
    expect(claimsAboutUs(faqs(['Which of these includes a VPN?', 'None of them.']))).toEqual([]);
    // A denial word followed by the claim denies nothing.
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', 'Nope — Incognito Pro includes one.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Do I need a separate VPN app?', 'Not really: Incognito Pro adds a VPN, so you do not need one.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Does Incognito Browser include a VPN?', 'No, but Pro does.']))).not.toEqual([]);
    expect(deniesAnswer('No. It does not include a VPN.')).toBe(true);
    expect(deniesAnswer('Nope — Incognito Pro includes one.')).toBe(false);
    expect(deniesAnswer('No. It is a private browser.')).toBe(true);
    // A follow-up question that names no product at all carries the subject over.
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Does the subscription add a VPN?', 'Yes, it does.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Does the paid tier include a VPN?', 'It does.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Is the premium version open source?', 'Yes, the code is public.']))).not.toEqual([]);
    expect(claimsAboutUs(faqs(['Is Incognito Browser free?', 'Yes.'], ['Does the subscription add a VPN?', 'No. It does not.']))).toEqual([]);
    expect(claimsAboutUs(faqs(['Is Brave free?', 'Yes.'], ['Does the subscription add a VPN?', 'Yes, it does.']))).toEqual([]);
    // A denied list reaches bare nouns only, so a gerund or a verb ends it.
    expect(claimsAboutUs(page({ verdict: { summary: 'Incognito Pro means no ads, no limits and hiding your IP from every site.', bestFor: [] } }))).not.toEqual([]);
    expect(claimsAboutUs(page({ verdict: { summary: 'Incognito Browser, which we make, has no fingerprinting protection, tracker blocking or HTTPS-only mode.', bestFor: [] } }))).toEqual([]);
  });

  it('an unpatternable claim about us is caught wherever it sits, because every string that mentions us is an allowlist entry', () => {
    // The allowlist used to cover our own row only, and the same sentence
    // passed in another product's cell note (Wave 4 verifier, 2026-09-11).
    const page = (over: Partial<ComparisonData>): ComparisonData => ({
      products: [
        { name: 'Brave', slug: 'brave', tagline: 'Browser' },
        { name: 'Incognito Browser', slug: 'incognito-browser', tagline: 'Android browser' },
      ],
      features: [{ name: 'Ad Blocking', description: 'Blocks ads', scores: { brave: { value: 'yes', note: 'Built in' }, 'incognito-browser': { value: 'yes', note: 'Built in' } } }],
      verdict: { summary: 'Brave scores highest.', bestFor: [] },
      faqs: [],
      ...over,
    });
    const claim = 'Incognito Browser, which we make, keeps you safe on public Wi-Fi, so this adds little.';
    const found = (d: ComparisonData) => stringsAboutUs(d).map((x) => x.text);
    // Our own row, whole; and the claim in every other place a comparison has.
    expect(found(page({}))).toContain('Android browser');
    const inCell = page({});
    inCell.features![0].scores!.brave = { value: 'yes', note: claim };
    expect(found(inCell)).toContain(claim);
    expect(found(page({ intro: `Five ad blockers compared. ${claim}` }))).toContain(claim);
    expect(found(page({ metaDescription: claim }))).toContain(claim);
    expect(found(page({ verdict: { summary: `Brave scores highest. ${claim}`, bestFor: [] } }))).toContain(claim);
    expect(found(page({ verdict: { summary: 'Brave scores highest.', bestFor: [{ useCase: 'Public Wi-Fi', product: 'Brave', reason: claim }] } }))).toContain(claim);
    expect(found(page({ faqs: [{ question: 'Which of these is safe on public Wi-Fi?', answer: claim }] }))).toContain(claim);
    expect(found(page({ pro_tips: [claim] }))).toContain(claim);
    // And the sentence after it, which is still about us.
    expect(found(page({ intro: `${claim} It also wipes cookies.` }))).toContain('It also wipes cookies.');
    // Not every string: what a page says about other products is left to the patterns.
    expect(found(page({ intro: 'Brave blocks ads and trackers by default.' }))).not.toContain('Brave blocks ads and trackers by default.');
  });

  it("nothing a comparison says about Incognito Browser makes one of brand.json's never-claims, or an unbacked claim next to them", () => {
    // Checked: every sentence sentencesAboutUs finds (its row, its cell notes,
    // a bestFor naming it, any sentence naming it, an FAQ answer to a question
    // about it, and the sentences that follow one about it), and FAQ questions
    // about it that name a claim, which must be answered with a denial. A
    // sentence may deny a claim ("no VPN", "not open source"), and where it
    // names another product too, only with ours as the subject; see deniedAt
    // and deniesForUs.
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

  it('every string in data/comparisons that mentions us is one somebody reviewed against data/brand.json, and no reviewed string has gone stale', () => {
    // Word lists can't cover every way to make a claim, so what a comparison
    // says about us is an allowlist: our row whole, and every other sentence
    // that mentions us. Change a word of one, move it to another field or
    // another page, or add a sentence about us anywhere — the intro, the meta
    // description, the verdict, another product's cell note, a bestFor reason,
    // an FAQ or a pro tip — and this fails until it is reviewed again (Wave 3
    // verifier, 2026-09-11; widened past our own row by the Wave 4 verifier).
    const dir = path.join(process.cwd(), 'data', 'comparisons');
    const reviewed = new Map(ABOUT_US_STRINGS.map((e) => [`${e.file} :: ${e.field} :: ${e.text}`, e]));
    const inData = new Set<string>();
    const unreviewed: string[] = [];
    for (const niche of fs.readdirSync(dir)) {
      for (const file of fs.readdirSync(path.join(dir, niche))) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, niche, file), 'utf-8')) as ComparisonData;
        for (const { field, text } of stringsAboutUs(data)) {
          const key = `${niche}/${file} :: ${field} :: ${text}`;
          inData.add(key);
          if (!reviewed.has(key)) unreviewed.push(key);
        }
      }
    }
    expect(unreviewed, 'add a reviewed ABOUT_US_STRINGS entry naming the brand.json facts it states or the never-claim it denies').toEqual([]);
    expect([...reviewed.keys()].filter((k) => !inData.has(k)), 'drop the ABOUT_US_STRINGS entries that are no longer in the data').toEqual([]);
  });

  it('every reviewed string about us names facts data/brand.json has', () => {
    const featureIds = new Set(BRAND.features.map((f) => f.id));
    const topLevel = new Set(['platform', 'pricing', 'play', 'dataSafety']);
    // What a string may state that is not a feature: that it names our
    // product, where it ranks on the page's own table, or that it is the
    // question the sentence naming us answers. None of them is a claim.
    const notAFact = new Set([NAMED, RANKED, ASKED]);
    const deniable = new Set([...BRAND.neverClaim, UNDOCUMENTED]);
    const problems: string[] = [];
    for (const e of ABOUT_US_STRINGS) {
      const where = `${e.file} ${e.field}`;
      if (!e.states.length && !e.denies.length) problems.push(`${where}: names no fact and denies nothing`);
      for (const f of e.states) if (!featureIds.has(f) && !topLevel.has(f) && !notAFact.has(f)) problems.push(`${where}: "${f}" is not in data/brand.json`);
      for (const c of e.denies) if (!deniable.has(c)) problems.push(`${where}: "${c}" is not one of brand.json's never-claims`);
      // A denial has to read like one.
      if (e.denies.length && !/\b(?:no|not|never|nothing|none|only|instead)\b|n't\b/i.test(e.text)) {
        problems.push(`${where}: says it denies ${e.denies.join(' + ')}, but the words deny nothing: "${e.text}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the methodology page makes none of brand.json's never-claims about our product either", () => {
    // It is the one page outside data/comparisons that talks about our product
    // and the comparisons, and it was never scanned (Wave 3 verifier).
    expect(methodologyClaims()).toEqual([]);
  });

  it('every sentence the methodology page is allowed to say a never-claim in is still on the page', () => {
    const words = methodologyWords();
    for (const e of METHODOLOGY_ALLOWED) {
      expect(words, e.sentence).toContain(e.sentence);
      expect(e.why.trim()).not.toBe('');
    }
  });

  it('every sentence the methodology page says our name in is one somebody reviewed, and none has gone stale', () => {
    // The same allowlist rule as data/comparisons: a claim in a wording no
    // pattern knows ("Incognito Pro, our subscription, keeps you safe on public
    // Wi-Fi.") fails here because nobody has reviewed it, not because a word
    // list caught it (Wave 4 verifier, 2026-09-11).
    const featureIds = new Set(BRAND.features.map((f) => f.id));
    const topLevel = new Set(['platform', 'pricing', 'play', 'dataSafety']);
    const deniable = new Set([...BRAND.neverClaim, UNDOCUMENTED]);
    const reviewed = new Map(METHODOLOGY_ABOUT_US.map((e) => [e.text, e]));
    const onPage = methodologyStringsAboutUs();
    expect(onPage.filter((s) => !reviewed.has(s)), 'add a reviewed METHODOLOGY_ABOUT_US entry for each').toEqual([]);
    expect([...reviewed.keys()].filter((s) => !onPage.includes(s)), 'drop the METHODOLOGY_ABOUT_US entries no longer on the page').toEqual([]);
    for (const e of METHODOLOGY_ABOUT_US) {
      expect(e.states.length + e.denies.length, e.text).toBeGreaterThan(0);
      expect(e.why.trim(), e.text).not.toBe('');
      for (const f of e.states) expect(featureIds.has(f) || topLevel.has(f) || f === NAMED || f === RANKED || f === ASKED, `${e.text}: ${f}`).toBe(true);
      for (const c of e.denies) expect([...deniable], e.text).toContain(c);
    }
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
