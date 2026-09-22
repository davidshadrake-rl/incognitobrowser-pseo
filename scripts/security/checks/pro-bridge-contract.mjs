/**
 * The Android WebView bridge: the one place page JavaScript reaches native code.
 *
 * Everything else in this repo stays inside a browser tab. `window.IncognitoBrowserApp`
 * does not: the app injects it with WebViewCompat.addWebMessageListener into an
 * origin allowlist copied out of IN-APP-BRIDGE.md, and on the far side of it
 * `saveImage` decodes base64 and writes a file into the user's MediaStore
 * (IN-APP-BRIDGE.md §3) while `upgrade` drives the purchase screen (§2).
 *
 * These five checks grade the WEB HALF of that boundary, which is the half this
 * repo controls. THEY CANNOT SEE THE NATIVE HALF. There is no APK here, no
 * Android source, and nothing to decompile, so every finding below says which
 * side it verified: "the page sends X unvalidated" is a fact about lib/in-app.ts;
 * "the app accepts X" is NOT something this suite can establish, and no finding
 * here claims it. That distinction is the point — a gap on the web side is real
 * whether or not the native side happens to catch it today, because the native
 * side is a different codebase on a different release cycle.
 *
 * WHAT THESE DELIBERATELY DO NOT RE-GRADE, because the repo already owns it
 * elsewhere and two checks firing on one line teaches people to ignore both:
 *   - Whether the setOf(…) allowlist names a re-registerable or a dead host:
 *     mast-bridge-origin-allowlist and inapp-bridge-origin-allowlist own that.
 *     pro_bridge_origin_allowlist_moves_together grades only the COUPLING those
 *     two do not look at — whether FREE_BASE_URL and PRO_BASE_URL can drift
 *     apart at deploy time.
 *   - Whether a forged bridge object unlocks Pro. That is the entitlement
 *     question (mast-pro-flag-grants-no-access, pentest-gate-inventory).
 *     pro_bridge_forged_app_object grades only what the BRIDGE hands a forged
 *     object, and says so.
 *   - That saveImageInApp has one reviewed caller:
 *     mast-save-image-caller-allowlist owns the caller list. This file grades
 *     the FUNCTION's own validation, which is a different property: the caller
 *     allowlist is what makes today's gap unreachable, not what closes it.
 *
 * Behavioural proof for all five lives in tests/pro-bridge.test.ts, which runs
 * the real exported functions against a recording bridge. These checks grade
 * the source so the every-commit suite blocks a regression at the shape level.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

const IN_APP = 'lib/in-app.ts';
const BRIDGE_COMPONENT = 'components/InAppBridge.tsx';
const DOC = 'IN-APP-BRIDGE.md';
const TIERS = 'lib/tiers.ts';
const DEPLOY = 'scripts/deploy.sh';

function readOr(repoRoot, rel) {
  const p = join(repoRoot, rel);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

/** Line number (1-indexed) of an offset in a source string. */
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * The body of a top-level function, from its signature to the first `}` in
 * column 0. Crude, and deliberately so: every function graded here is written
 * at the top level of lib/in-app.ts with a closing brace in column 0, and a
 * real parser would be a dependency this suite does not have. If the shape
 * ever stops matching, the caller Skips rather than grading an empty string.
 */
function topLevelBody(src, signatureRe) {
  const m = signatureRe.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const end = rest.indexOf('\n}');
  if (end === -1) return null;
  return { text: rest.slice(0, end + 2), line: lineOf(src, m.index) };
}

/**
 * Comments are prose about the code, not the code.
 *
 * A block comment is replaced by its own newlines, not by nothing, so a line
 * number computed over the stripped text is the line in the file. It used to
 * be deleted whole, and every `lineOf(…)` in this file that took an index from
 * the stripped text then pointed at the wrong line: the upgrade send in
 * lib/in-app.ts is on line 213 and the evidence said 77. Evidence a reader
 * cannot re-check is not evidence (harness.mjs, rule 2).
 */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * The body of the Kotlin `when (msg.optString("action")) { … }` block in
 * IN-APP-BRIDGE.md, found by counting braces from its opening `{`.
 *
 * This was a regex, `\{([\s\S]*?)\n\s*\}` — non-greedy to the first
 * newline-then-brace. Every branch in the contract was one line, so the first
 * such brace happened to be the real closing one. Give one branch a multi-line
 * body and the capture stopped at that branch's own `}`: the check graded a
 * truncated block, and an `else ->` after it was never seen. The 2026-09-22
 * audit pass demonstrated it live — a multi-line "upgrade" branch plus
 * `else -> handleUnknown(msg)` produced a spurious low "no branch for
 * saveImage" and a PASS, with the medium catch-all finding this check exists
 * to emit gone.
 *
 * Braces inside a `// …` comment or a "…" string are skipped for counting
 * only; the returned body is the raw text. Returns null when there is no block
 * at all, and `{ body: null }` when the block never closes — the caller Skips
 * on both, because grading a fragment is how the last parser passed.
 */
function whenBody(doc) {
  const m = /when\s*\(\s*msg\.optString\("action"\)\s*\)\s*\{/.exec(doc);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const line = lineOf(doc, m.index);
  let depth = 0;
  for (let i = open; i < doc.length; i++) {
    const ch = doc[i];
    if (ch === '/' && doc[i + 1] === '/') {
      const eol = doc.indexOf('\n', i);
      if (eol === -1) break;
      i = eol;
    } else if (ch === '"') {
      const close = doc.indexOf('"', i + 1);
      if (close === -1) break;
      i = close;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}' && --depth === 0) {
      return { body: doc.slice(open + 1, i), line };
    }
  }
  return { body: null, line };
}

/** The origins lib/tiers.ts serves from, with the paths kept — the path is what differs today. */
function tierBases(repoRoot) {
  const src = readOr(repoRoot, TIERS);
  if (!src) return null;
  const out = {};
  for (const name of ['PRO_BASE_URL', 'FREE_BASE_URL']) {
    const m = new RegExp(`${name}[^=]*=\\s*[\\s\\S]{0,200}?\\|\\|\\s*'([^']+)'`).exec(src);
    if (m) out[name] = m[1];
  }
  return out.PRO_BASE_URL && out.FREE_BASE_URL ? out : null;
}

// ---------------------------------------------------------------------------
// 1. saveImage: the filename and the MIME type cross into a native file write.
// ---------------------------------------------------------------------------
const saveImageCheck = check({
  id: 'pro_bridge_saveImage_filename_and_mime',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'saveImageInApp bounds the two values it hands the native MediaStore write: the filename (no traversal, no executable extension) and the MIME type (image/png|jpeg|webp only).',
  async run(ctx) {
    const src = readOr(ctx.repoRoot, IN_APP);
    if (!src) throw new Skip(`${IN_APP} does not exist — the function this check grades is gone, which is not a pass`);
    const fn = topLevelBody(src, /export\s+async\s+function\s+saveImageInApp/);
    if (!fn) {
      // Renamed, inlined, or reshaped. Grading a string we could not find would
      // report "no gaps" about nothing at all.
      throw new Skip(`${IN_APP} has no top-level saveImageInApp( … ) body this check can read — it would otherwise grade an empty string`);
    }
    const ownBody = stripComments(fn.text);

    // Since 2026-09-22 the validation is DELEGATED: saveImageInApp calls
    // safeImageFilename(filename, mime), refuses on null, and sends the
    // validated name. A check that grades only saveImageInApp's own body
    // reported "no validation at all" against a function that refuses every
    // shape it names — the same mistake pro_paste_parser_robustness made the
    // same day. So: if the body delegates AND gates the send on the result,
    // the validator's body is what gets graded, and the send must use the
    // validated name rather than the raw argument.
    const delegate = /const\s+(\w+)\s*=\s*(\w+)\(\s*filename\s*,\s*mime\s*\)/.exec(ownBody);
    const gated = delegate && new RegExp(`if\\s*\\(\\s*!${delegate[1]}\\s*\\)\\s*return\\s+false`).test(ownBody);
    const sendsValidated = delegate && new RegExp(`filename:\\s*${delegate[1]}\\b`).test(ownBody)
      && new RegExp(`saveImage!?\\(\\s*base64\\s*,\\s*${delegate[1]}\\s*,`).test(ownBody)
      && !/filename:\s*filename\b|saveImage!?\(\s*base64\s*,\s*filename\s*,/.test(ownBody);
    let body = ownBody;
    if (delegate && gated && sendsValidated) {
      const v = topLevelBody(src, new RegExp(`export\\s+function\\s+${delegate[2]}\\b`));
      if (v) body = stripComments(v.text) + '\n' + ownBody;
    }

    // Three named properties, each graded separately so the evidence says which
    // one is missing rather than "the function is unsafe". Both the quoted
    // split('/') and the regex split(/[\\/]/) forms count as a basename strip.
    const hasBasename = /\bbasename\b|replace\([^)]*[\\/][^)]*\)|split\(\s*['"`][\\/]|split\(\s*\/\[[^\]]*[\\/][^\]]*\]\/\)/.test(body) && /filename/.test(body);
    const hasExtensionRule = /filename[\s\S]{0,200}?\.(test|match)\(|\/\\?\.\((?:png|jpe?g|webp)|ext\.test\(/i.test(body);
    const mimeAllowlisted = /image\/(png|jpe?g|webp)[\s\S]{0,120}?(includes|has|test)\(|ALLOWED_MIME|ALLOWED_IMAGE_MIME|MIME_ALLOW/i.test(body);

    // What the function actually does with each value today, quoted verbatim so
    // a reader can re-check without running anything.
    const filenameUse = (body.match(/^.*filename.*$/gm) || []).map((l) => l.trim()).slice(0, 4);
    const mimeUse = (body.match(/^.*\bmime\b.*$/gm) || []).map((l) => l.trim()).slice(0, 4);

    const findings = [];
    const checked = 3;

    if (!hasBasename && !hasExtensionRule) {
      findings.push(finding({
        severity: 'medium', file: IN_APP, line: fn.line,
        title: 'saveImageInApp forwards the filename to the native save with no validation at all',
        detail: [
          'The filename is passed straight through to the app, which decodes the base64 and writes the file into MediaStore (IN-APP-BRIDGE.md §3). Nothing on the web side strips a path, rejects a traversal segment, or requires an image extension, so `../../Download/evil.html` and `payload.apk` leave this function exactly as they arrived.',
          'VERIFIED ON THE WEB SIDE ONLY. Whether the app rejects them cannot be established from this repo — there is no APK or Android source here. The native side is asked to treat this message as untrusted input (IN-APP-BRIDGE.md §2), but that is a request in a document, not a control this suite can observe.',
          'NOT EXPLOITABLE TODAY, which is why this is medium and not high: the one caller is components/Scorecard.tsx, and it builds the name with scorecardFilename() (lib/scorecard.ts:238), which lowercases and collapses everything outside [a-z0-9] to "-" and appends ".png". That containment is a property of the CALL SITE, enforced by mast-save-image-caller-allowlist, not of this function. It ends the moment a second caller passes a visitor-supplied name.',
        ].join(' '),
        evidence: `${IN_APP}:${fn.line} saveImageInApp — filename is used at: ${filenameUse.join(' | ') || '(no filename line found)'}; no basename strip and no extension rule in the body`,
        remediation: 'Bound it here, where the web side owns it: take the basename, reject anything containing "/", "\\" or "..", and require a /\\.(png|jpe?g|webp)$/i extension — returning false rather than silently renaming, so a caller that meant something else finds out. Tell the app team either way; a web-side fix does not reach an installed app that is already trusting the value.',
      }));
    }

    if (!mimeAllowlisted) {
      findings.push(finding({
        severity: 'medium', file: IN_APP, line: fn.line,
        title: 'saveImageInApp sends whatever MIME type the Blob carries, with no allowlist',
        detail: [
          'The MIME type is `blob.type || \'image/png\'`, so it is whatever the Blob was constructed with. IN-APP-BRIDGE.md §3 documents this message as carrying an image, and the app is told to save it to Pictures or Downloads; a `text/html` or `application/vnd.android.package-archive` value is not refused anywhere on the web side.',
          'VERIFIED ON THE WEB SIDE ONLY — the native handler is not in this repo and may well have its own allowlist. State both halves when reporting this: the page does not constrain it, and we do not know that the app does.',
          'Same containment as the filename: today the only Blob is a canvas.toBlob PNG from components/Scorecard.tsx, so this cannot currently be driven anywhere. That is the caller, not the function.',
        ].join(' '),
        evidence: `${IN_APP}:${fn.line} saveImageInApp — mime is used at: ${mimeUse.join(' | ') || '(no mime line found)'}; no image/png|jpeg|webp allowlist in the body`,
        remediation: 'Allowlist the three types the contract actually describes (image/png, image/jpeg, image/webp) and return false for anything else, so a future caller cannot widen the native write by handing in a differently typed Blob.',
      }));
    }

    return { findings, checked };
  },
});

// ---------------------------------------------------------------------------
// 2. Only two actions exist, and the DOCUMENTED contract ignores an unknown one.
//
// The id is pro_bridge_unknown_action_ignored, and the id stays — the owner's
// CI list names it. What the words below claim is narrower than the id reads:
// this check verifies the Kotlin snippet in IN-APP-BRIDGE.md and the sends in
// lib/in-app.ts. Whether the SHIPPED app ignores an unknown action cannot be
// observed from this repo (no APK, no native source), and no describe or title
// here says it can. The 2026-09-22 audit pass found the old wording — "the
// contract the app implements", "tells the app to handle" — reading as a claim
// about the app; it is a claim about a document the app team is asked to copy.
// ---------------------------------------------------------------------------
const unknownActionCheck = check({
  id: 'pro_bridge_unknown_action_ignored',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The page sends only the two documented bridge actions (upgrade, saveImage), and the documented contract ignores unknown actions: the Kotlin dispatch in IN-APP-BRIDGE.md §2 has those two named branches and no catch-all. Verified against the document and lib/in-app.ts only — there is no APK or Android source here, so whether the shipped app matches its contract is not something this check can see.',
  async run(ctx) {
    const src = readOr(ctx.repoRoot, IN_APP);
    const doc = readOr(ctx.repoRoot, DOC);
    if (!src) throw new Skip(`${IN_APP} does not exist — nothing sends bridge messages any more`);
    if (!doc) throw new Skip(`${DOC} does not exist — the dispatch contract this check grades is gone, which is not a pass`);

    const findings = [];
    let checked = 0;

    // (a) The sending side: every `action:` key this repo can put on the wire.
    //     Two shapes are told apart. A single-quoted literal is graded against
    //     the contract. Anything else after the key — a constant, a variable,
    //     a template — is a value this check cannot read, and that is a finding
    //     in its own right: the 2026-09-22 audit pass changed one send to
    //     `action: ACTION_UP` and this check reported "4 checked", no findings,
    //     because it counted only the literals it could see and Skipped only
    //     when there were none at all.
    const KNOWN = new Set(['upgrade', 'saveImage']);
    const code = stripComments(src);
    const keys = [...code.matchAll(/\baction\s*:/g)];
    const sent = [...code.matchAll(/\baction\s*:\s*'([^']+)'/g)];
    if (!keys.length) {
      throw new Skip(`${IN_APP} has no action: key at all — the message shape this check grades is not there`);
    }
    const literalAt = new Set(sent.map((m) => m.index));
    for (const k of keys) {
      checked++;
      if (literalAt.has(k.index)) continue;
      const n = lineOf(code, k.index);
      findings.push(finding({
        severity: 'medium', file: IN_APP, line: n,
        title: 'The page builds a bridge action from something other than a string literal, so this check cannot tell what it sends',
        detail: 'Every action that can reach the native dispatch has to be one of the two in IN-APP-BRIDGE.md §2, and the only way this check can know what the page sends is to read the literal. A computed value is precisely how a third capability reaches the native side without ever appearing in the document. Until this is a literal the sending half of this check is blind, and it says so rather than counting the literals it can see and passing.',
        evidence: `${IN_APP}:${n}: ${code.split('\n')[n - 1].trim().slice(0, 160)}`,
        remediation: "Send a single-quoted literal ('upgrade' or 'saveImage'). If this is a type annotation rather than a message, keep it out of the message-building code in lib/in-app.ts, or make it a literal union so it reads as the two names.",
      }));
    }
    for (const m of sent) {
      if (KNOWN.has(m[1])) continue;
      const n = lineOf(code, m.index);
      findings.push(finding({
        severity: 'medium', file: IN_APP, line: n,
        title: `The page sends a bridge action the contract does not define ("${m[1]}")`,
        detail: 'IN-APP-BRIDGE.md §2 documents exactly two actions. A third one is either a native capability that was added without the security note that should come with it, or a message an app built from the document would silently drop — and a handoff that silently drops is how "Save image" came to fail for every app user in the first place.',
        evidence: `${IN_APP}:${n}: action: '${m[1]}'; the contract defines ${[...KNOWN].join(', ')}`,
        remediation: 'Document the new action in IN-APP-BRIDGE.md with what the native side must validate, and add it to this check.',
      }));
    }

    // (b) The dispatch the document asks the app team to copy. A Kotlin `when`
    //     statement with only named branches ignores anything else by
    //     construction; an `else ->` is where "unknown action" stops being a
    //     no-op. The body is read to its real closing brace (see whenBody), so
    //     a branch that grows a multi-line block cannot hide what follows it.
    const when = whenBody(doc);
    if (!when) {
      throw new Skip(`${DOC} has no when(msg.optString("action")) { block — the dispatch this check grades is not in the document any more`);
    }
    if (when.body === null) {
      throw new Skip(`${DOC}:${when.line}: the when(msg.optString("action")) block never closes — this check will not grade a fragment of it`);
    }
    const whenLine = when.line;
    // Kotlin line comments are prose, not branches; a `"x" ->` or an `else ->`
    // inside one must neither count nor be counted.
    const dispatch = when.body.replace(/\/\/[^\n]*/g, '');
    const branches = [...dispatch.matchAll(/"([^"]+)"\s*->/g)].map((b) => b[1]);
    checked += branches.length + 1;

    for (const b of branches) {
      if (!KNOWN.has(b)) {
        findings.push(finding({
          severity: 'medium', file: DOC, line: whenLine,
          title: `The documented dispatch has a branch for an action §2 does not list ("${b}")`,
          detail: 'This block is what the app team is asked to copy. A branch in it is a native capability reachable from any page on an allowlisted origin, so it needs a row in the §2 table and a note on what the native side must validate before it needs code. Whether the shipped app has the branch is not visible from here; that the document tells it to is.',
          evidence: `${DOC}:${whenLine} when(msg.optString("action")) branches: ${branches.join(', ')}`,
          remediation: 'Either document the action properly or take the branch out of the snippet.',
        }));
      }
    }

    const elseBranch = /(^|\n)\s*else\s*->/.test(dispatch);
    if (elseBranch) {
      findings.push(finding({
        severity: 'medium', file: DOC, line: whenLine,
        title: 'The documented contract does not ignore unknown actions: the dispatch has an else -> branch',
        detail: 'With only named branches, an unrecognised action is ignored by construction, which is the property this check verifies: anything that gets script onto an allowlisted origin can post arbitrary JSON into this listener. An `else ->` turns "unknown" into "handled", and whatever it does becomes reachable from any page on that origin. This check cannot tell a no-op else from a handler, so it treats every else as one.',
        evidence: `${DOC}:${whenLine} when(msg.optString("action")) contains an else -> branch: ${dispatch.replace(/\s+/g, ' ').trim().slice(0, 200)}`,
        remediation: 'Drop the else branch. A Kotlin `when` statement with only named branches already ignores everything else, and that is the property the document should carry.',
      }));
    }

    for (const want of KNOWN) {
      if (!branches.includes(want)) {
        findings.push(finding({
          severity: 'low', file: DOC, line: whenLine,
          title: `The documented contract has no branch for "${want}", which the page sends`,
          detail: 'The page still sends this action (lib/in-app.ts). An app built from the current document would drop it, which is a broken handoff rather than a vulnerability — but it is the same class of silent failure as the blob: download that started this file.',
          evidence: `${DOC}:${whenLine} branches: ${branches.join(', ')}; ${IN_APP} sends: ${sent.map((s) => s[1]).join(', ')}`,
          remediation: 'Put the branch back, or stop sending the action.',
        }));
      }
    }

    return { findings, checked };
  },
});

// ---------------------------------------------------------------------------
// 3. The upgrade tap can only ever produce one custom scheme.
// ---------------------------------------------------------------------------
const upgradeSchemeCheck = check({
  id: 'pro_bridge_upgrade_scheme_allowlist',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The only non-http(s) URL the upgrade path can navigate a WebView to is incognitobrowser://upgrade, built from a constant scheme and encoded parameters.',
  async run(ctx) {
    const src = readOr(ctx.repoRoot, IN_APP);
    if (!src) throw new Skip(`${IN_APP} does not exist — the upgrade navigation this check grades is gone`);
    const code = stripComments(src);
    const findings = [];
    let checked = 0;

    // (a) The scheme is a constant, and it is the one the contract names.
    checked++;
    const constM = /export\s+const\s+APP_UPGRADE_URL\s*=\s*'([^']+)'/.exec(code);
    if (!constM) {
      throw new Skip(`${IN_APP} no longer declares APP_UPGRADE_URL as a string literal — the constant this check pins is not there to pin`);
    }
    if (constM[1] !== 'incognitobrowser://upgrade') {
      findings.push(finding({
        severity: 'high', file: IN_APP, line: lineOf(code, constM.index),
        title: `The app deep link is no longer incognitobrowser://upgrade (it is ${constM[1]})`,
        detail: 'IN-APP-BRIDGE.md §2 tells the app team to catch exactly this URL in shouldOverrideUrlLoading. A WebView hands an unrecognised scheme to the OS, so changing it either breaks the fallback upgrade path for every app build without the message listener, or points it at whatever else on the device claims the new scheme.',
        evidence: `${IN_APP}:${lineOf(code, constM.index)}: APP_UPGRADE_URL = '${constM[1]}'; ${DOC} §2 documents incognitobrowser://upgrade`,
        remediation: 'Change it in step with the app team and the document — IN-APP-BRIDGE.md:92 says this constant is the one thing to change, and that a release is needed.',
      }));
    }

    // (b) No other custom scheme is reachable from the upgrade path. intent://
    //     is the one that matters on Android: it is a general "start any
    //     Activity" URL, and a WebView that follows one hands the OS a payload
    //     the page chose.
    //     Quote-prefixed only, and `data:` is deliberately absent: blobToBase64
    //     strips a `data:` prefix and blobToDataUrl builds one for the
    //     press-and-hold image, both legitimate and neither a navigation. A
    //     check that fired on those would be wrong on the day it was written.
    const DANGEROUS = /['"`](intent|file|javascript|content|market|android-app):/gi;
    for (const rel of [IN_APP, BRIDGE_COMPONENT]) {
      const text = readOr(ctx.repoRoot, rel);
      if (!text) continue;
      const stripped = stripComments(text);
      checked++;
      for (const m of stripped.matchAll(DANGEROUS)) {
        const n = lineOf(stripped, m.index);
        findings.push(finding({
          severity: 'high', file: rel, line: n,
          title: `${rel} contains a ${m[1]}: URL literal on the in-app navigation path`,
          detail: 'Inside the app these files decide where a tap goes. intent:// starts an arbitrary Activity, file:// reaches the device filesystem, and javascript:/data: run in the page. The only custom scheme this boundary is supposed to produce is the app\'s own upgrade deep link.',
          evidence: `${rel}:${n}: ${stripped.split('\n')[n - 1].trim().slice(0, 160)}`,
          remediation: 'Remove it. If a second native entry point is genuinely needed, it belongs in the bridge message protocol (an action in IN-APP-BRIDGE.md §2), not in a URL the WebView follows.',
        }));
      }
    }

    // (c) The parameters cannot escape into the scheme. appUpgradeUrl must
    //     build its query with URLSearchParams — form-encoding percent-escapes
    //     ":", "/" and "#", so a data-upgrade-* attribute cannot smuggle a
    //     second URL into the string. A template literal over raw values could.
    const fn = topLevelBody(code, /export\s+function\s+appUpgradeUrl/);
    checked++;
    if (!fn) {
      throw new Skip(`${IN_APP} has no top-level appUpgradeUrl( … ) body — the builder this check grades cannot be read`);
    }
    if (!/new URLSearchParams/.test(fn.text)) {
      findings.push(finding({
        severity: 'high', file: IN_APP, line: fn.line,
        title: 'appUpgradeUrl no longer percent-encodes the upgrade context',
        detail: 'from, topic, result, tool and benefit come off data-upgrade-* attributes in the DOM (components/InAppBridge.tsx). URLSearchParams form-encodes every one of them, which is what stops a value containing "#intent://…" or "&" from changing the URL the WebView is handed. Concatenating them instead makes the deep link page-controlled.',
        evidence: `${IN_APP}:${fn.line} appUpgradeUrl builds its query without URLSearchParams: ${fn.text.replace(/\s+/g, ' ').trim().slice(0, 200)}`,
        remediation: 'Build the query with URLSearchParams and keep the scheme a constant prefix.',
      }));
    }

    // (d) Nothing else in the file navigates. One assignment, and it assigns
    //     the builder's output.
    for (const m of code.matchAll(/location\.href\s*=\s*([^;\n]+)/g)) {
      checked++;
      const value = m[1].trim();
      if (/^appUpgradeUrl\(/.test(value)) continue;
      const n = lineOf(code, m.index);
      findings.push(finding({
        severity: 'high', file: IN_APP, line: n,
        title: 'The in-app path navigates to something other than appUpgradeUrl()',
        detail: 'This is the only assignment that moves a WebView inside the app. Anything but the constant-prefixed builder means a navigation target that is not the app\'s own upgrade screen.',
        evidence: `${IN_APP}:${n}: location.href = ${value.slice(0, 160)}`,
        remediation: 'Route every in-app navigation through appUpgradeUrl(), or hand it to the bridge as a documented action.',
      }));
    }

    return { findings, checked };
  },
});

// ---------------------------------------------------------------------------
// 4. FREE_BASE_URL and PRO_BASE_URL must move together.
// ---------------------------------------------------------------------------
const originCouplingCheck = check({
  id: 'pro_bridge_origin_allowlist_moves_together',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The free and Pro base URLs are derived from one origin and both appear in the bridge allowlist, so a deploy cannot move one without the other and leave the in-app link rewriter pointing at a host we no longer serve.',
  async run(ctx) {
    const bases = tierBases(ctx.repoRoot);
    if (!bases) throw new Skip(`could not read FREE_BASE_URL and PRO_BASE_URL defaults out of ${TIERS} — with no origins to compare, this check would grade nothing`);
    const doc = readOr(ctx.repoRoot, DOC);
    if (!doc) throw new Skip(`${DOC} does not exist — the allowlist half of this check cannot run`);
    const component = readOr(ctx.repoRoot, BRIDGE_COMPONENT);
    if (!component) throw new Skip(`${BRIDGE_COMPONENT} does not exist — the link rewriter this check reasons about is gone`);

    const findings = [];
    let checked = 0;

    let freeOrigin, proOrigin;
    try {
      freeOrigin = new URL(bases.FREE_BASE_URL).origin;
      proOrigin = new URL(bases.PRO_BASE_URL).origin;
    } catch {
      throw new Skip(`FREE_BASE_URL / PRO_BASE_URL are not parseable URLs (${bases.FREE_BASE_URL}, ${bases.PRO_BASE_URL})`);
    }

    // (a) The rewriter's source of truth is those two constants and nothing
    //     else. This is what makes the coupling meaningful: if the set were
    //     hand-written, the constants could move without it and the check
    //     below would be grading the wrong thing.
    checked++;
    const derivedFromTiers = /SISTER_ORIGINS[\s\S]{0,200}?\[\s*FREE_BASE_URL\s*,\s*PRO_BASE_URL\s*\]/.test(component);
    if (!derivedFromTiers) {
      findings.push(finding({
        severity: 'high', file: BRIDGE_COMPONENT,
        title: 'The in-app link rewriter no longer derives its origin set from FREE_BASE_URL and PRO_BASE_URL',
        detail: 'components/InAppBridge.tsx adds ?inapp=1&pro=1 to any link whose origin is in SISTER_ORIGINS. While that set is built from the two tier constants it can only ever name the two hosts this repo serves. A hand-written or widened set is a list of origins we will decorate app-session flags onto, maintained separately from the origins we actually deploy to.',
        evidence: `${BRIDGE_COMPONENT}: SISTER_ORIGINS is not built from [FREE_BASE_URL, PRO_BASE_URL]; current source: ${(component.match(/const SISTER_ORIGINS[\s\S]{0,240}/) || ['(not found)'])[0].replace(/\s+/g, ' ').slice(0, 220)}`,
        remediation: 'Derive it from lib/tiers.ts again. The set must not be able to name an origin the build does not serve.',
      }));
    }

    // (b) The deploy derives both from ONE variable. This is the coupling in
    //     the only place it can actually be broken: lib/tiers.ts reads
    //     NEXT_PUBLIC_FREE_URL and NEXT_PUBLIC_PRO_URL independently, so the
    //     defaults agreeing in source proves nothing about a company deploy.
    const deploy = readOr(ctx.repoRoot, DEPLOY);
    checked++;
    if (!deploy) {
      findings.push(finding({
        severity: 'low', file: DEPLOY,
        title: 'The deploy script that couples the two base URLs is missing',
        detail: 'lib/tiers.ts reads NEXT_PUBLIC_FREE_URL and NEXT_PUBLIC_PRO_URL as two independent environment variables. The only thing keeping them on one host is scripts/deploy.sh setting both from $SITE_ORIGIN. Without that script, nothing enforces the coupling at build time.',
        evidence: `${DEPLOY} not found; ${TIERS} defaults are ${bases.FREE_BASE_URL} and ${bases.PRO_BASE_URL}`,
        remediation: 'Whatever replaces it must set both variables from one origin value.',
      }));
    } else {
      const free = /NEXT_PUBLIC_FREE_URL="?\$\{?([A-Z_]+)\}?/.exec(deploy);
      const pro = /NEXT_PUBLIC_PRO_URL="?\$\{?([A-Z_]+)\}?/.exec(deploy);
      if (!free || !pro) {
        findings.push(finding({
          severity: 'medium', file: DEPLOY,
          title: 'The deploy no longer sets both base URLs from a shell variable',
          detail: 'One of NEXT_PUBLIC_FREE_URL / NEXT_PUBLIC_PRO_URL is hard-coded or absent in the build command. A hard-coded host survives a cutover that changes the other one, which is exactly the drift this check exists for.',
          evidence: `${DEPLOY}: NEXT_PUBLIC_FREE_URL=${free ? '$' + free[1] : '(not set from a variable)'}, NEXT_PUBLIC_PRO_URL=${pro ? '$' + pro[1] : '(not set from a variable)'}`,
          remediation: 'Set both from the same origin variable in the same command.',
        }));
      } else if (free[1] !== pro[1]) {
        findings.push(finding({
          severity: 'high', file: DEPLOY, line: lineOf(deploy, free.index),
          title: `The deploy builds the free and Pro base URLs from two different variables ($${free[1]} and $${pro[1]})`,
          detail: 'They can now be set to different hosts, and a cutover that changes one is a cutover that leaves the other behind. When the two origins differ, components/InAppBridge.tsx stops short-circuiting on same-origin and starts rewriting cross-origin links: every link from one site to the other gets ?inapp=1&pro=1 appended. If the stale half is a host we no longer control — a released subdomain, a parked name — the app is appending its session flags to links into someone else\'s site, and the WebView follows them with the bridge injected on whichever of the two origins is still allowlisted.',
          evidence: `${DEPLOY}:${lineOf(deploy, free.index)}: NEXT_PUBLIC_FREE_URL from $${free[1]}, NEXT_PUBLIC_PRO_URL from $${pro[1]}`,
          remediation: 'Derive both from one variable. If the two sites genuinely need separate hostnames, that is an app release: both origins must land in the IN-APP-BRIDGE.md allowlist together, and neither may be a host being released.',
        }));
      }
    }

    // (c) Both origins are in the allowlist the app copies. Membership of ONE
    //     origin is inapp-bridge-origin-allowlist's finding, not ours; what is
    //     ours is the pair — an allowlist naming one of the two is the
    //     asymmetric state this check is named after.
    const setOf = /setOf\(([\s\S]*?)\)/.exec(doc);
    if (!setOf) throw new Skip(`${DOC} has no setOf( … ) block — the allowlist pairing cannot be graded`);
    const listed = new Set([...setOf[1].matchAll(/"([^"]+)"/g)].map((m) => {
      try { return new URL(m[1]).origin; } catch { return m[1]; }
    }));
    const setOfLine = lineOf(doc, setOf.index);
    checked++;
    const freeListed = listed.has(freeOrigin);
    const proListed = listed.has(proOrigin);
    if (freeOrigin !== proOrigin && freeListed !== proListed) {
      findings.push(finding({
        severity: 'high', file: DOC, line: setOfLine,
        title: `The bridge allowlist names one half of the pair (${freeListed ? freeOrigin : proOrigin}) and not the other (${freeListed ? proOrigin : freeOrigin})`,
        detail: 'The two deployments link to each other, and inside the app those links carry ?inapp=1&pro=1 across. With only one origin allowlisted, the bridge exists on one side of that hop and not the other: taps on the unlisted side fall through to the deep link or to an ordinary web page, and the asymmetry is invisible from either site. The pair must be listed together or not at all.',
        evidence: `${DOC}:${setOfLine} setOf(…) = [${[...listed].join(', ')}]; ${TIERS} serves free=${freeOrigin}, pro=${proOrigin}`,
        remediation: 'Add the missing origin and ship an app release with both. A released app keeps whatever allowlist it shipped with.',
      }));
    }

    // (d) Today's state, recorded rather than graded: one origin, two paths.
    //     This is a deploy requirement, not a defect, and it is info so it
    //     never blocks a commit — but it is the thing that will be forgotten.
    checked++;
    if (freeOrigin === proOrigin) {
      findings.push(finding({
        severity: 'info', file: BRIDGE_COMPONENT,
        title: 'The free and Pro sites share one origin today, so the in-app link rewriter is dormant — a company cutover switches it on',
        detail: 'Both constants are paths on the same host, so SISTER_ORIGINS holds a single origin and the rewriter\'s first clause (`u.origin === location.origin`) returns on every link: no link is rewritten anywhere today, and nothing exercises that branch. Give the two sites separate hostnames — the move to incognitobrowser.io, or a pro. subdomain — and the branch goes live on the first deploy, appending ?inapp=1&pro=1 to every cross-site link inside the app. Check it then: both origins in the IN-APP-BRIDGE.md allowlist, both under our control, and an app release carrying both.',
        evidence: `${TIERS}: FREE_BASE_URL=${bases.FREE_BASE_URL}, PRO_BASE_URL=${bases.PRO_BASE_URL} → one origin ${freeOrigin}; ${BRIDGE_COMPONENT} guards with u.origin === location.origin || !SISTER_ORIGINS.has(u.origin)`,
        remediation: 'No action now. At cutover, re-run this check with the new values and confirm the pair moved together.',
      }));
    }

    return { findings, checked };
  },
});

// ---------------------------------------------------------------------------
// 5. A page script can set window.IncognitoBrowserApp. What does the bridge do?
// ---------------------------------------------------------------------------
const forgedObjectCheck = check({
  id: 'pro_bridge_forged_app_object',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'low',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A forged window.IncognitoBrowserApp cannot make the page navigate to the app deep link, and what it does receive is bounded to the documented handoff fields.',
  async run(ctx) {
    const src = readOr(ctx.repoRoot, IN_APP);
    if (!src) throw new Skip(`${IN_APP} does not exist — there is no bridge consumer to grade`);
    const code = stripComments(src);
    const findings = [];
    let checked = 0;

    // (a) The deep-link fallback stays behind source === 'param'. This is the
    //     one thing a forged object must NOT be able to trigger: an object any
    //     page script can set would otherwise drive a navigation to a custom
    //     scheme the OS resolves.
    checked++;
    if (!/source === 'param'/.test(code)) {
      findings.push(finding({
        severity: 'high', file: IN_APP,
        title: 'The app deep-link fallback is no longer gated on the ?inapp=1 source',
        detail: 'openAppUpgrade falls back to incognitobrowser://upgrade only when the page was opened by the app with ?inapp=1. Any page script can assign window.IncognitoBrowserApp, and doing so already makes inAppSource() report "bridge"; if the fallback stops checking which source it is, a forged object becomes a way to make the browser follow a custom-scheme URL.',
        evidence: `${IN_APP}: no \`source === 'param'\` guard found before the location.href assignment`,
        remediation: 'Restore the guard. A bridge-detected build takes the postMessage/openUpgrade path or nothing.',
      }));
    }

    // (b) The message body is a fixed field list. A forged object receives
    //     whatever the page sends it, so what the page sends is the exposure.
    checked++;
    const payload = /JSON\.stringify\(\{\s*v:\s*1,\s*action:\s*'upgrade'[^}]*\}/.exec(code);
    if (payload && !/\bpage,\s*\.\.\.ctx\b/.test(payload[0])) {
      findings.push(finding({
        severity: 'low', file: IN_APP, line: lineOf(code, payload.index),
        title: 'The upgrade message body has changed shape',
        detail: 'The fields the bridge receives are the exposure when the object is forged by a page script rather than injected by the app. Today they are the documented handoff fields plus location.pathname — nothing a same-origin script could not already read. Anything added here is something a forged object also gets.',
        evidence: `${IN_APP}:${lineOf(code, payload.index)}: ${payload[0].replace(/\s+/g, ' ').slice(0, 180)}`,
        remediation: 'Keep it to the fields in IN-APP-BRIDGE.md §2. If a field is added, say what a forged bridge learns from it.',
      }));
    }

    // (c) Recorded, not graded: forging is possible by construction, and the
    //     consequence on THIS side is small. The entitlement consequence is a
    //     different group's finding and is deliberately not restated here.
    checked++;
    findings.push(finding({
      severity: 'info', file: IN_APP,
      title: 'window.IncognitoBrowserApp is duck-typed, so any same-origin script can impersonate the app to the page',
      detail: 'appBridge() accepts any object with the right method names, and it cannot do better: a page has no way to ask whether a global came from the WebView. What a forged object gets from this file is bounded — the upgrade context (from, topic, result, tool, benefit, pathname) and, if the visitor presses Save image, the base64 of a scorecard the same script could have rendered from the DOM itself. It also flips <html data-inapp> to "bridge", which changes labels. What it must NOT do is trigger the custom-scheme navigation, which (a) above pins. The separate question — whether a forged object unlocks anything paid — belongs to the entitlement checks (mast-pro-flag-grants-no-access, pentest-gate-inventory) and is not restated here.',
      evidence: `${IN_APP}: appBridge() returns any \`typeof b === 'object'\` value at window.IncognitoBrowserApp; openAppUpgrade calls b.postMessage / b.openUpgrade on it and saveImageInApp passes it the image base64`,
      remediation: 'Nothing to fix on the web side. Keep it true that a forged object receives only what a same-origin script already has, and keep the deep-link fallback gated on ?inapp=1.',
    }));

    return { findings, checked };
  },
});

export default [saveImageCheck, unknownActionCheck, upgradeSchemeCheck, originCouplingCheck, forgedObjectCheck];
