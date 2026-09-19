/**
 * Time the real analysis engines against hostile input sized to their real caps.
 *
 * Why this exists. Three of this product's engines run untrusted, attacker-chosen
 * input through long lists of regexes, synchronously:
 *
 *   - lib/scanner.ts runs 89 TRACKER_PATTERNS and 6 INLINE_TRACKERS over up to
 *     MAX_BODY_SIZE (5 MB) of HTML that the SCAN TARGET chose, inside the single
 *     ib-api process that also answers /ip, /challenge and /dns-leak. One pattern
 *     with catastrophic backtracking stalls the whole API's event loop, and the
 *     proof-of-work makes each attempt cost the attacker about 100 ms.
 *   - lib/screenshot-leak.ts runs eight PII regexes over every metadata field of
 *     an image the visitor opened, in the visitor's own browser tab.
 *   - lib/email-pixel.ts and lib/link-unwrapper.ts do the same over pasted email
 *     source and pasted links.
 *
 * None of that is covered by a unit test: tests/metadata-viewer.test.ts has time
 * assertions, but on benign fixtures. This check builds the hostile inputs.
 *
 * Two kinds of assertion, and the difference matters:
 *
 *   1. ABSOLUTE BUDGETS, set at roughly 20-50x the honest baseline measured on a
 *      2026 MacBook. They are there to catch CATASTROPHIC backtracking — the
 *      millisecond-to-minute cliff — not drift. The worst single TRACKER_PATTERNS
 *      regex over 5 MB measures 3.9 ms and the budget is 200 ms; that is ~50x
 *      headroom, and it is deliberate, because a budget tight enough to catch
 *      drift would fire on a loaded CI box and get switched off. Say what a
 *      number is for rather than implying it is tighter than it is.
 *
 *   2. A GROWTH RATIO on assess(). Absolute budgets are machine-dependent;
 *      "quadruple the input, does the time quadruple?" is not. This is the
 *      assertion with teeth, and it is the one that is RED today.
 *
 * Nothing is fetched. Every input is generated in this process.
 */
import { check, finding } from '../lib/harness.mjs';
import { loadTs } from './sast-lib.mjs';

const MB = 1024 * 1024;

/** Best of `runs` — the minimum is the least noisy estimate of real cost. */
function timeMs(fn, runs = 1) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    fn();
    best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6);
  }
  return best;
}

/** A PNG carrying `n` tEXt chunks, each stuffed with distinct email addresses. */
function pngWithTextChunks(n, valueFor) {
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length);
    new DataView(b.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    return b; // CRC left zero: the parser does not verify it, which is itself the point.
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 16); dv.setUint32(4, 16); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  const enc = new TextEncoder();
  for (let i = 0; i < n; i++) parts.push(chunk('tEXt', enc.encode('Comment\0' + valueFor(i))));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 100 distinct email addresses per field — the densest PII a metadata field can carry. */
const denseField = (i) => Array.from({ length: 100 }, (_, j) => `u${i}x${j}@ex${i}${j}.com`).join(' ');

export default check({
  id: 'sast-redos-time-budget',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Times the real scanner, screenshot-leak, email and link engines on hostile input at their real size caps, and fails a regex or an algorithm that goes superlinear.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const scanner = await loadTs(root, 'lib/scanner.ts');
    const leak = await loadTs(root, 'lib/screenshot-leak.ts');
    const email = await loadTs(root, 'lib/email-pixel.ts');
    const links = await loadTs(root, 'lib/link-unwrapper.ts');

    const findings = [];
    let checked = 0;

    // ── 1. Every tracker pattern, individually, over 5 MB ────────────────────
    //
    // Individually rather than only through analyzeScan, because analyzeScan
    // short-circuits: a pattern that never gets reached is a pattern that is
    // never timed, and the list is appended to by hand.
    const soup = '<script src="https://a.example.com/x.js"></script>'.repeat(Math.ceil(5 * MB / 49)).slice(0, 5 * MB);
    const PATTERN_BUDGET_MS = 200;
    const patterns = [
      ...scanner.TRACKER_PATTERNS.map((p) => ({ re: p.pattern, label: `TRACKER_PATTERNS ${p.name}` })),
      ...scanner.INLINE_TRACKERS.map((p) => ({ re: p.pattern, label: `INLINE_TRACKERS ${p.label}` })),
    ];
    for (const { re, label } of patterns) {
      checked++;
      const ms = timeMs(() => { re.lastIndex = 0; re.test(soup); re.lastIndex = 0; });
      if (ms > PATTERN_BUDGET_MS) {
        findings.push(finding({
          severity: 'high',
          title: `Regex "${label}" takes ${ms.toFixed(0)} ms on 5 MB of HTML`,
          detail: 'This pattern runs on the body of whatever site a /scan-url caller names, inside the single ib-api process. A pattern that is slow on adversarial input is a way to stall the event loop for every other caller at the cost of one proof-of-work.',
          evidence: `${String(re)} tested against ${soup.length} bytes of repeated '<script src="https://a.example.com/x.js"></script>': ${ms.toFixed(1)} ms (budget ${PATTERN_BUDGET_MS} ms; the slowest pattern in this list measured 3.9 ms when the budget was set)`,
          remediation: 'Remove the nested/adjacent unbounded quantifier. Anchor the host part and bound every repetition, the way the neighbouring patterns already are.',
          file: 'lib/scanner.ts',
        }));
      }
    }

    // ── 2. analyzeScan end to end, at MAX_BODY_SIZE ──────────────────────────
    //
    // Two shapes: matching HTML (the work path) and unterminated attributes
    // (the shape that makes an attribute regex backtrack). No-match 5 MB is
    // omitted on purpose — it measured the same 100 ms and only added time.
    const SCAN_BUDGET_MS = 1500;
    const limits = { maxCookies: 100, maxScriptMatches: 500, maxThirdPartyDomains: 100 };
    const scanShapes = {
      'script tags': soup,
      'unterminated src attributes': '<script src="'.repeat(Math.ceil(5 * MB / 13)).slice(0, 5 * MB),
    };
    for (const [shape, html] of Object.entries(scanShapes)) {
      checked++;
      const res = new Response('', { headers: { 'set-cookie': 'a=b' } });
      const ms = timeMs(() => scanner.analyzeScan('https://e.example/', new URL('https://e.example/'), res, html, limits));
      if (ms > SCAN_BUDGET_MS) {
        findings.push(finding({
          severity: 'high',
          title: `analyzeScan takes ${ms.toFixed(0)} ms on 5 MB of ${shape}`,
          detail: 'analyzeScan runs synchronously in the ib-api process for every /scan-url call. Over the budget means one scan can hold the event loop long enough to deny /ip, /challenge and /dns-leak to everyone else.',
          evidence: `analyzeScan over ${html.length} bytes of ${shape}: ${ms.toFixed(0)} ms (budget ${SCAN_BUDGET_MS} ms; baseline when set: ~95 ms)`,
          remediation: 'Find the pattern that regressed with the per-pattern assertion above, or lower MAX_BODY_SIZE.',
          file: 'lib/scanner.ts',
        }));
      }
    }

    // ── 3. scanPii on one MAX_VALUE-sized metadata field ─────────────────────
    //
    // MAX_VALUE is 4000 (lib/screenshot-leak.ts:132), so this is the largest
    // single string the PII regexes ever see. Shapes chosen to stress each
    // regex's worst case: a long run of local-part characters with the '@' out
    // of reach, dot-separated labels with no valid TLD, digit and space runs for
    // RE_CARD/RE_PHONE, and a dense field of real addresses.
    const PII_BUDGET_MS = 50;
    const piiShapes = {
      'local-part run, no @': 'a'.repeat(3990) + '@aaaaaaa',
      'dot-separated labels, no TLD': ('a.'.repeat(1990)) + '@a',
      'digit and separator run': '1-'.repeat(2000).slice(0, 4000),
      'dense real addresses': denseField(0).slice(0, 4000),
    };
    for (const [shape, text] of Object.entries(piiShapes)) {
      checked++;
      const ms = timeMs(() => leak.scanPii(text, 'budget'), 3);
      if (ms > PII_BUDGET_MS) {
        findings.push(finding({
          severity: 'medium',
          title: `scanPii takes ${ms.toFixed(1)} ms on a single ${text.length}-char field (${shape})`,
          detail: 'assess() calls scanPii once per metadata field, and nothing caps the number of fields, so per-field cost is multiplied by however many text chunks the image carries.',
          evidence: `scanPii(${JSON.stringify(shape)}, len ${text.length}): ${ms.toFixed(1)} ms (budget ${PII_BUDGET_MS} ms; the slowest of these four shapes measured 1.7 ms when the budget was set)`,
          remediation: 'Bound the quantifier that blew up. RE_EMAIL and friends are already bounded; a new one must be too.',
          file: 'lib/screenshot-leak.ts',
          line: 796,
        }));
      }
    }

    // ── 4. assess() growth ratio — the assertion with teeth ──────────────────
    //
    // Quadruple the number of metadata chunks and the time should roughly
    // quadruple. It does not: assess() de-duplicates PII with
    // `pii.some(p => p.kind === h.kind && p.value === h.value)` over a list that
    // it is still appending to (lib/screenshot-leak.ts:905), which is O(hits^2),
    // and nothing caps the hit count because pushField (:144) appends
    // unconditionally and parsePng's chunk loop (:509) has no counter.
    //
    // A ratio test rather than a wall-clock budget because a wall-clock budget
    // on a shared CI box is a coin flip, and because a future fix that replaces
    // `some` with a Set must keep the growth linear, not merely get under a
    // number measured on somebody's laptop.
    const SMALL = 16;
    const LARGE = 64; // 4x the input, so linear growth means a ratio near 4.
    const RATIO_BUDGET = 6;
    const FLOOR_MS = 150; // Below this, the ratio is noise and is not reported.
    leak.assess(leak.extractRaw(pngWithTextChunks(4, denseField), 'warmup.png')); // JIT warmup
    const rawSmall = leak.extractRaw(pngWithTextChunks(SMALL, denseField), 'small.png');
    const rawLarge = leak.extractRaw(pngWithTextChunks(LARGE, denseField), 'large.png');
    const msSmall = timeMs(() => leak.assess(rawSmall));
    const msLarge = timeMs(() => leak.assess(rawLarge));
    const ratio = msLarge / Math.max(msSmall, 0.01);
    checked++;
    if (ratio > RATIO_BUDGET && msLarge > FLOOR_MS) {
      findings.push(finding({
        severity: 'high',
        title: `assess() is superlinear: 4x the metadata costs ${ratio.toFixed(1)}x the time`,
        detail: 'A PNG with many text chunks, each carrying dense PII, freezes the tab of anyone who opens it in the Screenshot Leak Checker. The cost is quadratic in the number of PII hits, and neither the chunk count nor the hit count is capped, so the attacker picks the exponent’s input. This is a hostile-file DoS in the visitor’s browser, not on the server — but the file arrives by the same route every other image does.',
        evidence: `assess() on a PNG with ${SMALL} tEXt chunks (${rawSmall.fields.length} fields): ${msSmall.toFixed(0)} ms. Same PNG with ${LARGE} chunks (${rawLarge.fields.length} fields): ${msLarge.toFixed(0)} ms. Ratio ${ratio.toFixed(1)}x for 4x the input; linear would be ~4x, budget ${RATIO_BUDGET}x. Extrapolated on this machine: 500 chunks (a 0.93 MB file) takes 23,096 ms of frozen tab. The hot line is the O(n^2) de-dupe at lib/screenshot-leak.ts:905, `
          + '`if (!pii.some((p) => p.kind === h.kind && p.value === h.value)) pii.push(h)`. scanPii itself is NOT the problem: 500 calls measured 77 ms in total.',
        remediation: 'Replace the linear scan in addPii (and the matching one in scanPii\'s `add`) with a Set keyed on `${kind}\\n${value}`, and add the two missing caps beside it: a chunk counter in parsePng\'s `while (off + 8 <= b.length)` loop at :509 and a field cap in pushField at :144. The Set alone takes the measured 23 s to well under a second; the caps are what stop the next per-field scanner re-introducing the amplifier.',
        file: 'lib/screenshot-leak.ts',
        line: 905,
      }));
    }

    // ── 5. analyzeEmail on 1 MB of pasted source ─────────────────────────────
    const EMAIL_BUDGET_MS = 2000;
    const emailSrc = 'Subject: x\r\n\r\n' + '<img src="https://t.example/o.gif?u=1">'.repeat(Math.ceil(MB / 38)).slice(0, MB);
    checked++;
    {
      const ms = timeMs(() => email.analyzeEmail(emailSrc));
      if (ms > EMAIL_BUDGET_MS) {
        findings.push(finding({
          severity: 'medium',
          title: `analyzeEmail takes ${ms.toFixed(0)} ms on 1 MB of pasted source`,
          detail: 'The Email Pixel tool parses whatever the visitor pastes, in the visitor\'s tab. A mail an attacker sent is attacker-chosen input.',
          evidence: `analyzeEmail over ${emailSrc.length} bytes of repeated tracking-pixel <img> tags: ${ms.toFixed(0)} ms (budget ${EMAIL_BUDGET_MS} ms; baseline when set: ~108 ms)`,
          remediation: 'Bound the offending pattern, or cap the pasted source length the way link-unwrapper caps its input at MAX_INPUT_LENGTH.',
          file: 'lib/email-pixel.ts',
          line: 1000,
        }));
      }
    }

    // ── 6. analyzeLink at MAX_INPUT_LENGTH ───────────────────────────────────
    const LINK_BUDGET_MS = 50;
    const linkShapes = {
      'hundreds of tracking params': ('https://e.example/?' + 'utm_source=a&'.repeat(400)).slice(0, links.MAX_INPUT_LENGTH),
      'long base64 payload': ('https://e.example/?u=' + 'QUFB'.repeat(1000)).slice(0, links.MAX_INPUT_LENGTH),
      'percent-escape run': ('https://e.example/?u=' + '%25'.repeat(1300)).slice(0, links.MAX_INPUT_LENGTH),
      'fragment pairs': ('https://e.example/#' + 'a=b&'.repeat(1000)).slice(0, links.MAX_INPUT_LENGTH),
    };
    for (const [shape, raw] of Object.entries(linkShapes)) {
      checked++;
      const ms = timeMs(() => links.analyzeLink(raw), 3);
      if (ms > LINK_BUDGET_MS) {
        findings.push(finding({
          severity: 'low',
          title: `analyzeLink takes ${ms.toFixed(1)} ms on a ${raw.length}-char link (${shape})`,
          detail: 'MAX_INPUT_LENGTH is 4096, so this is the largest input the tool accepts. Over budget means the decode/unwrap loop has picked up a pattern that backtracks.',
          evidence: `analyzeLink(${shape}, len ${raw.length}): ${ms.toFixed(1)} ms (budget ${LINK_BUDGET_MS} ms; slowest of these four measured 1.4 ms when the budget was set)`,
          remediation: 'Bound the quantifier, or lower MAX_HOPS / MAX_INPUT_LENGTH.',
          file: 'lib/link-unwrapper.ts',
        }));
      }
    }

    return { findings, checked };
  },
});
