/**
 * The three tools that must never post what they are shown.
 *
 * The cookie scanner's "Paste" box invites a live `Cookie:` header copied out
 * of DevTools — which is to say a set of session cookies, usually for someone
 * ELSE's site, pasted into a page served from a company box. Its "This Page"
 * button reads document.cookie. The metadata viewer reads photographs. On a
 * company deploy the difference between a privacy tool and a data-breach
 * vector is entirely whether any of that reaches a socket, so this file pins
 * the property rather than trusting a comment:
 *
 *   A. pro_paste_not_posted_to_api
 *      The pasted string reaches exactly one sink — a pure, network-free
 *      function in the same file — and the tool's whole network surface is the
 *      URL-scan call, which takes the URL box and nothing else.
 *   B. pro_this_page_not_posted_to_api
 *      Same, for document.cookie; plus the page's HttpOnly claim is locked to
 *      the mechanism that makes it true.
 *   C. pro_metadata_multi_file_gated_single_still_works
 *      Picking several files trips the overlay while file 1 is still read and
 *      shown free, the size cap is real (its value is READ from the source,
 *      never assumed here), and neither the tool nor lib/exif.ts can reach the
 *      network with image bytes.
 *   D. pro_paste_parser_robustness
 *      The guards a parser fed arbitrary pasted text needs: an input cap, an
 *      attribute filter, and a bound on how many rows one paste can render.
 *
 * DELIBERATELY NOT DUPLICATED HERE, because it is already enforced:
 *   - That /event cannot carry free text: lib/event-schema.ts validateEvent is
 *     an allowlist of enums and slugs, and tests/event-schema.test.ts:14,46
 *     already asserts free text and unknown fields are rejected. This file
 *     asserts only that no cookie or image data becomes a track() argument in
 *     the first place.
 *   - That these two components never use dangerouslySetInnerHTML:
 *     tests/xss-protection.test.ts:145-171 covers both by name (and now fails
 *     loudly if either path stops resolving).
 *   - That a gated handler never reaches the server: checks/pentest-gate-inventory.mjs
 *     grades every useUpgradeGate handler. That check looks at the three GATED
 *     actions; this one looks at the FREE paths beside them, which is where the
 *     pasted cookies and the photographs actually are.
 *   - That the metadata tool has some file-size check at all:
 *     tests/input-validation.test.ts:77. What is new here is the VALUE, checked
 *     against the number the alert copy promises.
 *
 * Ids are snake_case because they are the owner's CI list and get referenced
 * by name; the rest of this directory is kebab-case.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { read, stripComments, lineAt, lineText } from './sast-lib.mjs';

const COOKIE_TOOL = 'components/tools/CookieAnalyzerTool.tsx';
const META_TOOL = 'components/tools/MetadataViewerTool.tsx';
const EXIF_LIB = 'lib/exif.ts';

/**
 * Ways a browser can put bytes on the wire, as they are written in this repo.
 * `raw` marks the transports: one of those appearing in a file that holds
 * pasted session cookies is a different kind of event from a new call to the
 * first-party counter, so they are graded differently below.
 */
const NETWORK_CALLS = [
  { re: /\bfetch\s*\(/g, name: 'fetch(', raw: true },
  { re: /\bnew\s+XMLHttpRequest\b/g, name: 'new XMLHttpRequest', raw: true },
  { re: /\bnavigator\s*\.\s*sendBeacon\s*\(/g, name: 'navigator.sendBeacon(', raw: true },
  { re: /\bnew\s+WebSocket\s*\(/g, name: 'new WebSocket(', raw: true },
  { re: /\bnew\s+EventSource\s*\(/g, name: 'new EventSource(', raw: true },
  { re: /\bnew\s+Request\s*\(/g, name: 'new Request(', raw: true },
  { re: /\bimportScripts\s*\(/g, name: 'importScripts(', raw: true },
  { re: /\bSCAN_API_BASE\b/g, name: 'SCAN_API_BASE', raw: true },
  { re: /\bscanUrl\s*(?:<[^>]*>)?\s*\(/g, name: 'scanUrl(', raw: false },
  { re: /\bstartDnsLeak\s*\(/g, name: 'startDnsLeak(', raw: false },
  { re: /\btrack\s*\(/g, name: 'track(', raw: false },
];

/** An API path written as a literal. Run over the strings-kept copy. */
const API_PATH_LITERAL = /['"`]\/(?:api|event|scan-url|challenge|dns-leak|stats)\b/g;

/** Read a file into its three useful forms, or Skip saying what is missing. */
function load(ctx, rel) {
  if (!existsSync(join(ctx.repoRoot, rel))) {
    throw new Skip(`${rel} is missing — this check grades that file and graded nothing`);
  }
  const src = read(ctx.repoRoot, rel);
  return {
    rel,
    src,
    // Comments and string literals blanked: for call shapes.
    code: stripComments(src),
    // Comments blanked, literals kept: for path and URL literals.
    text: stripComments(src, { strings: false }),
  };
}

function markers(code, list) {
  const out = [];
  for (const m of list) {
    m.re.lastIndex = 0;
    let hit;
    while ((hit = m.re.exec(code))) out.push({ name: m.name, raw: m.raw, index: hit.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * The statement an `if (...)` controls, brace-less form included.
 *
 * `if (picked.length > 1) noteBatchAttempt();` has no block of its own, and
 * brace-matching from the `if` walks forward into the NEXT block in the
 * function — which is how the first version of this check reported that the
 * multi-file branch returns before reading the file, twice, in a file where it
 * does no such thing. A check that reads the wrong block is worse than no
 * check: it teaches whoever reads the report to ignore it.
 */
function consequentOf(code, from) {
  const paren = code.indexOf('(', from);
  if (paren < 0) return '';
  let depth = 0;
  let i = paren;
  for (; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) { i++; break; }
  }
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] === '{') return bodyFrom(code, i);
  const end = code.indexOf(';', i);
  return code.slice(i, end === -1 ? code.length : end + 1);
}

/** The block opened by the first `{` at or after `from`, as text. */
function bodyFrom(code, from) {
  const open = code.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

/** The body of a function declared in this file as `function NAME` or `const NAME =`. */
function localFunctionBody(code, name) {
  const decl = new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?(?:function|const|let)\\s+${name}\\b`).exec(code);
  if (!decl) return null;
  return bodyFrom(code, decl.index);
}

/**
 * The call whose argument list starts at `openIdx` — used to read what a
 * sensitive identifier was handed to. Returns the callee name and the argument
 * text, or null when the character is not an open paren.
 */
function calleeBefore(code, openIdx) {
  const m = /([A-Za-z_$][\w$.]*)\s*$/.exec(code.slice(Math.max(0, openIdx - 80), openIdx));
  return m ? m[1] : null;
}

/**
 * Where a sensitive value (the paste buffer, document.cookie) goes.
 *
 * `ok` shapes are local: the state declaration, the textarea's own value, an
 * emptiness guard, and a call to a function declared in the same file whose
 * body holds no network marker. Anything else is reported — including "could
 * not tell", because a silent pass on an unreadable data flow is the failure
 * this suite exists for.
 */
function classifyUse(code, index, ident) {
  const before = code.slice(Math.max(0, index - 120), index);
  const after = code.slice(index + ident.length, index + ident.length + 60);
  if (/\[\s*$/.test(before) && /^\s*,\s*set[A-Z]/.test(after)) return { kind: 'ok', why: 'state declaration' };
  if (/value=\{\s*$/.test(before)) return { kind: 'ok', why: 'rendered back into its own input' };
  if (/^\s*\.\s*(?:trim|length)\b/.test(after)) return { kind: 'ok', why: 'emptiness / length guard' };
  if (/\(\s*$/.test(before)) {
    const openIdx = index - (before.length - before.lastIndexOf('('));
    const callee = calleeBefore(code, openIdx);
    if (callee) {
      const body = localFunctionBody(code, callee.split('.').pop());
      if (body === null) return { kind: 'unresolved', why: `passed to ${callee}(), which is not declared in this file` };
      const net = markers(body, NETWORK_CALLS);
      if (net.length) return { kind: 'network', why: `passed to ${callee}(), whose body contains ${net.map((n) => n.name).join(', ')}` };
      return { kind: 'ok', why: `passed to ${callee}(), a local function with no network call in it` };
    }
  }
  return { kind: 'unresolved', why: `used in a shape this check cannot read: …${code.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, ' ').trim()}…` };
}

/** Grade every network marker in a file against an allowlist of callee names. */
function gradeNetworkSurface({ rel, src, code, text }, allow, subject) {
  const findings = [];
  const found = markers(code, NETWORK_CALLS);
  for (const hit of found) {
    if (allow.includes(hit.name)) continue;
    findings.push(finding({
      severity: hit.raw ? 'high' : 'medium',
      file: rel,
      line: lineAt(src, hit.index),
      title: `${rel} gained a network call (${hit.name}) beside ${subject}`,
      detail: `This file handles ${subject}. Its entire network surface was ${allow.length ? allow.join(', ') : 'nothing at all'}, which is what makes "it stays in your browser" a fact about the code rather than a promise in the copy. ${hit.name} is new, and every byte it can carry was chosen inside this file.`,
      evidence: `${rel}:${lineAt(src, hit.index)}  ${lineText(src, hit.index).slice(0, 160)}`,
      remediation: `Keep the handling local, or — if the call is genuinely needed — prove at the call site that it cannot be reached from ${subject}, and say so here in the allowlist.`,
    }));
  }
  API_PATH_LITERAL.lastIndex = 0;
  let lit;
  while ((lit = API_PATH_LITERAL.exec(text))) {
    findings.push(finding({
      severity: 'medium',
      file: rel,
      line: lineAt(src, lit.index),
      title: `${rel} names an API path directly`,
      detail: 'An endpoint path written into this file is a request waiting for a caller. The tool reaches the server through lib/scan-client only, where the origin gate and the proof-of-work live.',
      evidence: `${rel}:${lineAt(src, lit.index)}  ${lineText(src, lit.index).slice(0, 160)}`,
      remediation: 'Route anything that must reach the server through lib/scan-client.',
    }));
  }
  return { findings, checked: found.length };
}

/** Findings for a sensitive identifier's every use in a file. */
function gradeUses({ rel, src, code }, ident, label) {
  const findings = [];
  let checked = 0;
  // `ident` is a plain source spelling ("customInput", "document.cookie"); the
  // dot is the only regex character it can contain, so escape that and nothing
  // else. An over-eager escape here silently matched nothing and turned this
  // check into a SKIP that read like the feature had been removed.
  const re = new RegExp(`\\b${ident.replace(/\./g, '\\.')}\\b`, 'g');
  let m;
  while ((m = re.exec(code))) {
    checked++;
    const use = classifyUse(code, m.index, ident);
    if (use.kind === 'ok') continue;
    findings.push(finding({
      severity: use.kind === 'network' ? 'critical' : 'medium',
      file: rel,
      line: lineAt(src, m.index),
      title: use.kind === 'network'
        ? `${label} now flows into a network call`
        : `Cannot prove ${label} stays in the browser at ${rel}:${lineAt(src, m.index)}`,
      detail: use.kind === 'network'
        ? `${label} is live session state, routinely for a site that is not ours and a person who is not the visitor. Posting it anywhere turns this page into a collection point, and on a company deploy into a breach with our name on it.`
        : `Every use of ${label} in this file was a local shape this check can read; this one is not, so it could not be graded. That is reported rather than assumed harmless — assuming is how a data flow like this one stops being watched.`,
      evidence: `${rel}:${lineAt(src, m.index)}  ${lineText(src, m.index).slice(0, 160)}  — ${use.why}`,
      remediation: 'Keep the value in a local, pure function, or make the flow readable from outside (a named local handler, one call, no indirection).',
    }));
  }
  return { findings, checked };
}

// ───────────────────────── A. the Paste box ──────────────────────────────

const pasteNotPosted = check({
  id: 'pro_paste_not_posted_to_api',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A cookie string pasted into the scanner reaches only pure local functions: no fetch, XHR, sendBeacon, WebSocket or /event call can carry it.',
  async run(ctx) {
    const f = load(ctx, COOKIE_TOOL);
    const findings = [];
    let checked = 0;

    // The paste buffer is whatever the textarea's value is bound to: name it
    // from the markup rather than hardcoding `customInput`, so a rename cannot
    // quietly empty this check.
    const ta = /<textarea[\s\S]{0,400}?value=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(f.code);
    if (!ta) throw new Skip(`${COOKIE_TOOL}: no <textarea value={…}> found — the Paste mode is gone or restructured, and this check graded nothing`);
    const pasteVar = ta[1];
    checked++;

    const surface = gradeNetworkSurface(f, ['scanUrl('], 'cookie strings pasted by the visitor');
    findings.push(...surface.findings);
    checked += surface.checked;

    const uses = gradeUses(f, pasteVar, `the pasted cookie string (${pasteVar})`);
    findings.push(...uses.findings);
    checked += uses.checked;

    // The one allowed network call must take the URL box, not the paste box.
    NETWORK_CALLS.find((n) => n.name === 'scanUrl(').re.lastIndex = 0;
    const scan = /\bscanUrl\s*(?:<[^>]*>)?\s*\(([^)]*)\)/.exec(f.code);
    if (scan) {
      checked++;
      if (new RegExp(`\\b${pasteVar}\\b`).test(scan[1])) {
        findings.push(finding({
          severity: 'critical', file: COOKIE_TOOL, line: lineAt(f.src, scan.index),
          title: 'The pasted cookie string is being sent to the scan API',
          detail: 'scanUrl() POSTs its argument to /scan-url. The paste box holds session cookies the visitor copied out of a browser, frequently for another company\'s site.',
          evidence: `${COOKIE_TOOL}:${lineAt(f.src, scan.index)}  ${lineText(f.src, scan.index).slice(0, 160)}`,
          remediation: 'Send the URL input only.',
        }));
      }
    }

    return { findings, checked };
  },
});

// ─────────────────────── B. the This Page button ─────────────────────────

const thisPageNotPosted = check({
  id: 'pro_this_page_not_posted_to_api',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'This Page reads document.cookie into a pure local parser and nowhere else, and the page\'s HttpOnly claim is still backed by the mechanism that makes it true.',
  async run(ctx) {
    const f = load(ctx, COOKIE_TOOL);
    const findings = [];
    let checked = 0;

    const uses = gradeUses(f, 'document.cookie', 'this browser\'s cookies (document.cookie)');
    if (uses.checked === 0) {
      throw new Skip(`${COOKIE_TOOL}: no document.cookie read — the This Page mode is gone, and this check graded nothing`);
    }
    findings.push(...uses.findings);
    checked += uses.checked;

    const surface = gradeNetworkSurface(f, ['scanUrl('], "this browser's own cookies");
    findings.push(...surface.findings);
    checked += surface.checked;

    // ---- the HttpOnly claim, locked to the reason it is true -------------
    //
    // "HttpOnly cookies are hidden from scripts, so they don't appear here" is
    // true for exactly one reason: document.cookie omits them (RFC 6265 §8.6).
    // The claim survives a rewrite only while the source does, so grade both
    // together — a new cookie source with the old sentence under it is a copy
    // claim the code no longer backs.
    const copy = f.text.replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
    checked++;
    if (!/HttpOnly[\s\S]{0,140}?(?:hidden|do not appear|don't appear|never appear|not visible)/i.test(copy)) {
      findings.push(finding({
        severity: 'medium', file: COOKIE_TOOL, line: null,
        title: 'The This Page mode no longer tells the visitor that HttpOnly cookies are invisible to it',
        detail: 'Without that sentence the mode reads as a complete list of this page\'s cookies. It is not one, and cannot be: the session cookie that matters most is precisely the one a script cannot see. A privacy tool that silently under-reports is worse than none.',
        evidence: `${COOKIE_TOOL}: no copy matching /HttpOnly …(hidden|don't appear|never appear|not visible)/ near the This Page control`,
        remediation: 'Restore the sentence beside the Scan Cookies button.',
      }));
    }
    const otherSources = [
      { re: /\bcookieStore\b/, name: 'cookieStore' },
      { re: /\bchrome\s*\.\s*cookies\b/, name: 'chrome.cookies' },
      { re: /\bbrowser\s*\.\s*cookies\b/, name: 'browser.cookies' },
    ];
    for (const s of otherSources) {
      checked++;
      if (!s.re.test(f.code)) continue;
      findings.push(finding({
        severity: 'medium', file: COOKIE_TOOL, line: null,
        title: `This Page now reads cookies from ${s.name} as well as document.cookie`,
        detail: 'The page\'s HttpOnly sentence is a statement about document.cookie. A second source changes what the list contains, so either the sentence is now wrong or it needs to be re-derived from the new source.',
        evidence: `${COOKIE_TOOL}: ${s.name} appears in the source`,
        remediation: 'Keep document.cookie as the single source, or rewrite the copy to describe what the new source can and cannot see.',
      }));
    }

    // ---- the list-mode type cannot claim what it cannot know -------------
    const iface = /export\s+interface\s+CookieInfo\s*\{([\s\S]*?)\n\}/.exec(f.src);
    if (iface) {
      checked++;
      const claimed = ['httpOnly', 'secure', 'sameSite'].filter((k) => new RegExp(`\\b${k}\\s*[?]?\\s*:`).test(iface[1]));
      if (claimed.length) {
        findings.push(finding({
          severity: 'high', file: COOKIE_TOOL, line: lineAt(f.src, iface.index),
          title: `CookieInfo now carries ${claimed.join(', ')} — fields neither This Page nor Paste can observe`,
          detail: 'document.cookie returns name=value pairs only; a pasted Cookie: header has no attributes either. A field for HttpOnly or Secure in the list-mode type can only be filled with a guess, and it will be rendered next to real findings as though it were one.',
          evidence: `${COOKIE_TOOL}:${lineAt(f.src, iface.index)}  interface CookieInfo declares ${claimed.join(', ')}`,
          remediation: 'Keep attribute columns on URLScanResult, where the server really saw the Set-Cookie header.',
        }));
      }
    }

    return { findings, checked };
  },
});

// ──────────────────── C. the metadata viewer's gate ──────────────────────

/** Evaluate a byte-size expression made only of numbers, * + and parens. */
function evalSize(expr) {
  const clean = expr.replace(/_/g, '').trim();
  if (!/^[\d\s*+()]+$/.test(clean)) return null;
  try {
    const v = Function(`"use strict";return (${clean});`)();
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const metadataGate = check({
  id: 'pro_metadata_multi_file_gated_single_still_works',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Picking more than one photo shows the upgrade overlay while the first file is still read and shown free; the size cap is real and matches its copy; no image byte can reach the network.',
  async run(ctx) {
    const f = load(ctx, META_TOOL);
    const exif = load(ctx, EXIF_LIB);
    const findings = [];
    let checked = 0;

    // ---- 1. no network, in either file ----------------------------------
    for (const file of [f, exif]) {
      const surface = gradeNetworkSurface(file, [], 'photographs the visitor chose');
      findings.push(...surface.findings);
      checked += surface.checked + 1;
    }

    // The one remote URL in the tool: the "View GPS on map" button. It is an
    // egress — the photo's coordinates, in a URL, to openstreetmap.org — but a
    // user-initiated one behind a button that says so. Grade it as what it is:
    // fine while a click is required, a finding the moment it is not.
    const urls = [...f.text.matchAll(/https?:\/\/[^\s'"`)]+/g)];
    for (const u of urls) {
      checked++;
      const line = lineAt(f.src, u.index);
      const around = f.code.slice(Math.max(0, u.index - 200), u.index + 40);
      const userInitiated = /window\s*\.\s*open\s*\($/.test(around.slice(0, around.indexOf('\n', 195) === -1 ? around.length : undefined).replace(/\s+$/, '')) || /window\s*\.\s*open\s*\(\s*`?$/.test(f.code.slice(Math.max(0, u.index - 40), u.index));
      if (userInitiated && /openGpsOnMap/.test(f.code) && /onClick=\{\s*openGpsOnMap\s*\}/.test(f.code)) continue;
      findings.push(finding({
        severity: 'high', file: META_TOOL, line,
        title: 'Image-derived data can leave the browser without a click',
        detail: 'The only place a photograph\'s contents may leave this page is the "View GPS on map" button, where the visitor asks for it and the button says what it does. A remote URL anywhere else — or the map link moved out of its onClick handler — sends the most sensitive field this tool extracts to a third party on the tool\'s own initiative.',
        evidence: `${META_TOOL}:${line}  ${lineText(f.src, u.index).slice(0, 160)}`,
        remediation: 'Keep remote URLs behind an explicit, labelled user action, opened with noopener,noreferrer.',
      }));
    }

    // ---- 2. the gate fires on >1 file, and file 1 is still read free -----
    const decl = /\bconst\s+handleFile\s*=/.exec(f.code);
    if (!decl) throw new Skip(`${META_TOOL}: no handleFile — the file picker was restructured and this check graded nothing`);
    const body = bodyFrom(f.code, decl.index);
    checked++;

    // `const { guard: guardBatch, … } = useUpgradeGate(…)` names the guard, and
    // `const noteBatchAttempt = guardBatch(() => {})` names the wrapped no-op
    // the multi-file branch actually calls. Derive the second FROM the first:
    // a loose `const X = <anything>(() =>` pattern matched `const summary =
    // useMemo(() =>` instead and reported a gate that is right there.
    const gateName = (/\bguard\s*:\s*([A-Za-z_$][\w$]*)/.exec(f.code) || [])[1];
    const noteName = gateName
      ? (new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${gateName}\\s*\\(`).exec(f.code) || [])[1]
      : undefined;
    const multi = /if\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*length\s*>\s*1\s*\)/.exec(body);
    checked++;
    if (!multi) {
      findings.push(finding({
        severity: 'high', file: META_TOOL, line: lineAt(f.src, decl.index),
        title: 'Picking several photos no longer trips the upgrade overlay',
        detail: 'metadata-multi-file is one of the three declared gates (lib/card-copy.ts GATE_COPY). Its overlay is also the only place the page explains that batch cleaning happens in the app — without it, picking a folder silently reads one file and drops the rest.',
        evidence: `${META_TOOL}: handleFile contains no \`if (<files>.length > 1)\` branch`,
        remediation: 'Restore the guarded call on the multi-file branch.',
      }));
    } else {
      const guardBlock = consequentOf(body, multi.index);
      const callsGate = [gateName, noteName].filter(Boolean).some((n) => new RegExp(`\\b${n}\\s*\\(`).test(guardBlock));
      if (!callsGate) {
        findings.push(finding({
          severity: 'high', file: META_TOOL, line: lineAt(f.src, decl.index + multi.index),
          title: 'The multi-file branch no longer calls the upgrade gate',
          detail: 'The branch exists but does not go through useUpgradeGate, so picking several files does nothing visible at all.',
          evidence: `${META_TOOL}: \`${multi[0]}\` with no call to ${[gateName, noteName].filter(Boolean).join(' / ') || 'a guard'} in it`,
          remediation: 'Call the guarded no-op on that branch.',
        }));
      }
      // The free half: the branch must NOT abandon the first file.
      checked++;
      if (/\breturn\b/.test(guardBlock)) {
        findings.push(finding({
          severity: 'high', file: META_TOOL, line: lineAt(f.src, decl.index + multi.index),
          title: 'Picking several photos now blocks the first one too',
          detail: 'The overlay copy is "One photo at a time is free … Check them here one at a time — free, no limit" (lib/card-copy.ts). Returning out of handleFile on the multi-file branch makes that sentence false: the visitor is shown an upgrade ask and gets nothing, which is the one thing the owner\'s gate design rules out.',
          evidence: `${META_TOOL}: the \`${multi[0]}\` branch returns before the file is read`,
          remediation: 'Show the gate and keep reading picked[0].',
        }));
      }
    }
    // …and the read really does happen outside that branch.
    checked++;
    if (!/\breadImageMetadata\s*\(/.test(body)) {
      findings.push(finding({
        severity: 'high', file: META_TOOL, line: lineAt(f.src, decl.index),
        title: 'handleFile no longer reads the chosen file',
        detail: 'The first photo is free by design. If handleFile does not call readImageMetadata, nothing is shown for it.',
        evidence: `${META_TOOL}: handleFile body has no readImageMetadata( call`,
        remediation: 'Read picked[0] unconditionally.',
      }));
    }

    // ---- 3. the size cap: read the real value, then check the copy ------
    const cap = /file\s*\.\s*size\s*>\s*([^)]+)\)/.exec(body);
    checked++;
    if (!cap) {
      findings.push(finding({
        severity: 'medium', file: META_TOOL, line: lineAt(f.src, decl.index),
        title: 'The metadata viewer no longer caps the file it will read',
        detail: 'readImageMetadata walks every block in the buffer on the main thread. Without a cap, one enormous file freezes the tab — and on a phone, kills it.',
        evidence: `${META_TOOL}: handleFile has no \`file.size > …\` guard`,
        remediation: 'Cap the file before calling arrayBuffer(), and say the limit in the message.',
      }));
    } else {
      const bytes = evalSize(cap[1]);
      const promised = /Maximum size is\s*(\d+)\s*MB/i.exec(f.src);
      if (bytes === null) {
        findings.push(finding({
          severity: 'low', file: META_TOOL, line: lineAt(f.src, decl.index + cap.index),
          title: 'The metadata viewer\'s size cap is no longer a readable constant',
          detail: 'The cap is graded by reading its value out of the source and comparing it with the number the message promises. An expression this check cannot evaluate means neither half is being graded.',
          evidence: `${META_TOOL}:${lineAt(f.src, decl.index + cap.index)}  file.size > ${cap[1].trim().slice(0, 60)}`,
          remediation: 'Keep the cap a plain numeric expression, e.g. `const MAX_FILE_SIZE = 50 * 1024 * 1024;`.',
        }));
      } else if (promised && bytes !== Number(promised[1]) * 1024 * 1024) {
        findings.push(finding({
          severity: 'medium', file: META_TOOL, line: lineAt(f.src, decl.index + cap.index),
          title: `The size cap (${(bytes / 1024 / 1024).toFixed(2)} MB) is not the ${promised[1]} MB the message promises`,
          detail: 'The visitor is told a number and the code enforces a different one, so a file inside the stated limit is refused with a message that says it is not.',
          evidence: `${META_TOOL}: file.size > ${cap[1].trim()} = ${bytes} bytes, while the message says "Maximum size is ${promised[1]}MB"`,
          remediation: 'Derive the message from the constant.',
        }));
      }
      // Before the buffer is materialised, not after.
      const ab = body.indexOf('arrayBuffer');
      checked++;
      if (ab !== -1 && ab < cap.index) {
        findings.push(finding({
          severity: 'medium', file: META_TOOL, line: lineAt(f.src, decl.index + cap.index),
          title: 'The size cap is checked after the file has already been read into memory',
          detail: 'arrayBuffer() materialises the whole file. A cap applied afterwards has already paid the cost it exists to avoid.',
          evidence: `${META_TOOL}: arrayBuffer() appears before the file.size guard inside handleFile`,
          remediation: 'Check file.size first.',
        }));
      }
      // A refused file must not leave the previous photo's verdict on screen.
      const capBlock = consequentOf(body, body.lastIndexOf('if', cap.index));
      checked++;
      if (!/set(?:Meta|Scanned|Error|FileFields)\s*\(/.test(capBlock)) {
        findings.push(finding({
          severity: 'low', file: META_TOOL, line: lineAt(f.src, decl.index + cap.index),
          title: 'A file refused for its size leaves the previous photo\'s verdict on screen',
          detail: 'The catch branch a few lines below clears meta, fileFields and the thumbnail for exactly this reason — its comment says leaving the last file\'s verdict beside this file would read as this file\'s result. The size branch alerts and returns without clearing anything, so the old photo\'s GPS row stays under the new file\'s name.',
          evidence: `${META_TOOL}:${lineAt(f.src, decl.index + cap.index)}  the file.size branch calls neither setMeta, setScanned, setError nor setFileFields before returning`,
          remediation: 'Clear the result the same way the catch branch does, and show the limit through setError rather than alert().',
        }));
      }
    }

    // ---- 4. the gate is still the declared one ---------------------------
    checked++;
    if (!/gate:\s*'metadata-multi-file'/.test(f.src)) {
      findings.push(finding({
        severity: 'medium', file: META_TOOL, line: null,
        title: 'The metadata tool\'s gate id is not metadata-multi-file',
        detail: 'GATE_IDS (lib/event-schema.ts) is the allowlist /event validates against; an id outside it is dropped, so the gate counters silently stop counting. tests/event-schema.test.ts keeps GATE_IDS and GATE_COPY in step with each other; this keeps the component in step with them.',
        evidence: `${META_TOOL}: no \`gate: 'metadata-multi-file'\``,
        remediation: 'Use one of the three declared gate ids.',
      }));
    }

    return { findings, checked };
  },
});

// ─────────────────── D. the parser fed arbitrary text ────────────────────

const pasteParserRobustness = check({
  id: 'pro_paste_parser_robustness',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The Paste parser has the guards arbitrary pasted text needs: an input size cap, an attribute filter so Path=/Expires= are not counted as cookies, and a bound on how many rows one paste can render.',
  async run(ctx) {
    const f = load(ctx, COOKIE_TOOL);
    const findings = [];
    let checked = 0;

    const parser = localFunctionBody(f.code, 'parseCookieList');
    if (parser === null) throw new Skip(`${COOKIE_TOOL}: parseCookieList is gone — this check graded nothing`);
    const parserLine = lineAt(f.src, f.code.indexOf(parser));

    // ---- D1. an input size cap ------------------------------------------
    checked++;
    const capped = /\.\s*slice\s*\(\s*0\s*,/.test(parser)
      || /\blength\s*>\s*[\d_]/.test(parser)
      || /maxLength=/.test(f.code);
    if (!capped) {
      findings.push(finding({
        severity: 'medium', file: COOKIE_TOOL, line: parserLine,
        title: 'The Paste box accepts unbounded input and parses all of it',
        detail: 'parseCookieList splits the whole string and builds one object per piece, and the results list then renders one card per object. A 1 MB paste — well within what a clipboard holds, and a plausible accident when someone copies a whole DevTools panel — becomes about 70,000 cookie objects and roughly a quarter of a million DOM nodes on the main thread. The parse itself is fast; the render is what stops the tab. Nothing leaves the browser, so this costs the visitor their own tab and no one else anything, which is why it is graded medium and not high.',
        evidence: `${COOKIE_TOOL}:${parserLine}  parseCookieList has no length cap, and the <textarea> has no maxLength`,
        remediation: 'Cap the input (a few hundred KB is generous for a Cookie: header) and say so in the box, the way URLAnalyzerTool caps at 2048 characters.',
      }));
    }

    // ---- D2. cookie attributes are not cookies ---------------------------
    checked++;
    const ATTRS = ['path', 'expires', 'max-age', 'domain', 'secure', 'httponly', 'samesite', 'partitioned'];
    const filtersAttrs = ATTRS.filter((a) => parser.toLowerCase().includes(a)).length >= 2;
    if (!filtersAttrs) {
      findings.push(finding({
        severity: 'medium', file: COOKIE_TOOL, line: parserLine,
        title: 'Cookie attributes are counted and scored as cookies',
        detail: 'The box invites a string "from DevTools > Application > Cookies", and what people copy from there is routinely a Set-Cookie line. parseCookieList splits on [;\\n] and keeps every piece, so `sid=abc; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=None` is reported as EIGHT cookies: Domain, Path, Expires, Max-Age, Secure, HttpOnly and SameSite are each listed as an unknown cookie of medium risk beside the one real one. The score survives (unknown cookies cost no points) but the headline count, the console tally and the "N cookies" the visitor is shown are all wrong, and the advice they act on is drawn from that list. This Page mode is unaffected: document.cookie never returns attributes.',
        evidence: `${COOKIE_TOOL}:${parserLine}  parseCookieList mentions none of ${ATTRS.join(', ')} — every semicolon-separated piece becomes a cookie`,
        remediation: 'Drop pieces whose name matches a cookie attribute, the way lib/scanner.ts already does when it parses a real Set-Cookie header.',
      }));
    }

    // ---- D3. a bound on what one paste can render ------------------------
    checked++;
    // The bare `cookies` state, not `urlResult.cookies` — a URL scan's list is
    // bounded by what the server returns, the pasted one by what was pasted.
    const renderCap = /(?<![.\w])cookies\s*\.\s*slice\s*\(/.test(f.code) || /\bvisibleCookies\b/.test(f.code);
    if (!renderCap) {
      const at = f.code.search(/(?<![.\w])cookies\s*\.\s*map\s*\(/);
      findings.push(finding({
        severity: 'medium', file: COOKIE_TOOL, line: at === -1 ? parserLine : lineAt(f.src, at),
        title: 'Every parsed cookie is rendered, however many there are',
        detail: 'The list-mode panel maps straight over `cookies`, so the number of cards is whatever the paste produced. This is the half of the unbounded-input problem that is actually felt: the parse of a 1 MB paste takes about 25 ms, the render of its 70,000 cards does not.',
        evidence: `${COOKIE_TOOL}:${at === -1 ? parserLine : lineAt(f.src, at)}  ${at === -1 ? 'cookies.map(...) not found' : lineText(f.src, at).slice(0, 120)} — no .slice() before it`,
        remediation: 'Render the first N and say how many more were found.',
      }));
    }

    return { findings, checked };
  },
});

export default [pasteNotPosted, thisPageNotPosted, metadataGate, pasteParserRobustness];
