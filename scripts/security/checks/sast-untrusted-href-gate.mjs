/**
 * A string the product got from somewhere hostile must never come back out as a
 * non-http href.
 *
 * Why this check and not another grep. This is the app's largest XSS surface and
 * nothing pins it. components/tools/LinkUnwrapperTool.tsx:189 renders
 * `href={analysis.cleanUrl}` with target="_blank" — a string derived from
 * whatever the visitor pasted, after this library has unwrapped it through up to
 * five redirect layers, base64-decoded it and rebuilt it. React escapes text; it
 * does NOT stop `javascript:` in an href. Three separate conditions keep that
 * safe today and none of them is asserted anywhere:
 *
 *   lib/link-unwrapper.ts:175  parseHttpUrl gates on http:/https: and a hostname
 *   lib/link-unwrapper.ts:544  cleanUrl is rebuilt from u.origin + pathname + …
 *   lib/link-unwrapper.ts:564  normalizeInput rejects the NON_WEB scheme list
 *
 * Delete any one and a pasted `javascript:` link becomes a clickable
 * `javascript:` href. That is the same "two external conditions away" shape the
 * SAST review flagged for lib/content.ts, except here the input really is
 * attacker-chosen.
 *
 * It is a BEHAVIOURAL check, not a source pattern, on purpose. Grepping for
 * `u.protocol === 'http:'` would pass the day somebody renames the constant and
 * would say nothing about whether the gate still WORKS. This calls the real
 * exported functions with hostile links and looks at what comes back. It is also
 * why the check reads honestly: every input below is one somebody could paste
 * today, including ones routed through the real Proofpoint, Safe Links, Google
 * and Bing decoders so the post-decode path is exercised and not just
 * normalizeInput's front door.
 *
 * Mutation-tested, and worth recording what that showed. Removing decodeTarget's
 * `/^https?:\/\//i` prefix test on its own does NOT make this check fire —
 * parseHttpUrl catches the payload a line later, which is defence in depth
 * working as intended. Removing parseHttpUrl's protocol gate as well produces 72
 * findings, including finalUrl = "javascript:alert(1)". So this check is
 * insensitive to any single layer and sensitive to the loss of the pair, which
 * is the right shape: it asserts the PROPERTY, not one implementation of it.
 *
 * Deliberately NOT here: the Icon `title` prop. It has three call sites, all
 * literal, it is already escaped at components/ui/Icon.tsx:87, and
 * tests/xss-protection.test.ts:113 pins the escape. A provenance analyzer for it
 * could only ever pass.
 */
import { check, finding } from '../lib/harness.mjs';
import { loadTs } from './sast-lib.mjs';

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const b64url = (s) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Anything that is not an http(s) URL is a finding if it reaches a rendered href. */
const isWebUrl = (s) => /^https?:\/\//i.test(String(s));

const PAYLOADS = [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

/** Links a visitor could paste. Each names the gate it is aimed at. */
function hostileLinks() {
  const cases = [];
  for (const p of PAYLOADS) {
    cases.push({ raw: p, aimedAt: 'normalizeInput NON_WEB scheme reject' });
    cases.push({ raw: p.toUpperCase().replace(/^([A-Z]+):/, (m) => m.toLowerCase()), aimedAt: 'scheme case folding' });
    cases.push({ raw: `  ${p}  `, aimedAt: 'leading/trailing whitespace' });
    cases.push({ raw: `<${p}>`, aimedAt: 'angle-bracket stripping (mail clients wrap links this way)' });
    // Through the real wrapper decoders, so decodeTarget/parseHttpUrl are the
    // gate under test rather than normalizeInput.
    cases.push({ raw: `https://www.google.com/url?q=${encodeURIComponent(p)}`, aimedAt: 'Google /url?q= decoder' });
    cases.push({ raw: `https://eu.safelinks.protection.outlook.com/?url=${encodeURIComponent(p)}`, aimedAt: 'Microsoft Safe Links decoder' });
    cases.push({ raw: `https://l.facebook.com/l.php?u=${encodeURIComponent(p)}`, aimedAt: 'Facebook link shim decoder' });
    cases.push({ raw: `https://urldefense.proofpoint.com/v2/url?u=${p.replace(/\//g, '_').replace(/:/g, '-')}`, aimedAt: 'Proofpoint v2 decoder' });
    cases.push({ raw: `https://www.bing.com/ck/a?u=a1${b64url(p)}`, aimedAt: 'Bing base64url decoder' });
    cases.push({ raw: `https://out.reddit.com/?url=${encodeURIComponent(p)}`, aimedAt: 'Reddit outbound decoder' });
    cases.push({ raw: `https://example.test/redirect?url=${encodeURIComponent(p)}`, aimedAt: 'generic redirect decoder' });
    // Two wrapper layers, so the hop loop has to hold the gate at every hop.
    cases.push({
      raw: `https://www.google.com/url?q=${encodeURIComponent(`https://l.instagram.com/?u=${encodeURIComponent(p)}`)}`,
      aimedAt: 'gate still holds after two decode hops',
    });
  }
  cases.push({ raw: '//evil.example/javascript:alert(1)', aimedAt: 'protocol-relative input gets https:, not the path scheme' });
  cases.push({ raw: 'https://e.example/#javascript:alert(1)', aimedAt: 'payload in the fragment stays in the fragment' });
  return cases;
}

export default check({
  id: 'sast-untrusted-href-gate',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Feeds javascript:/data:/vbscript:/file: payloads through the real link-unwrapper and email-pixel decoders and fails if any non-http string surfaces as something the UI renders into an href or src.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const links = await loadTs(root, 'lib/link-unwrapper.ts');
    const email = await loadTs(root, 'lib/email-pixel.ts');

    const findings = [];
    let checked = 0;

    for (const { raw, aimedAt } of hostileLinks()) {
      checked++;
      let r;
      try { r = links.analyzeLink(raw); } catch (err) {
        findings.push(finding({
          severity: 'medium',
          title: 'analyzeLink threw on a hostile link',
          detail: 'The tool calls this on every paste. An exception here is a broken tool, and a broken tool is how people end up opening the raw link instead.',
          evidence: `analyzeLink(${JSON.stringify(raw)}) threw: ${String((err && err.message) || err)}`,
          remediation: 'Handle the input, or reject it through normalizeInput.',
          file: 'lib/link-unwrapper.ts',
        }));
        continue;
      }
      if (!r.ok) continue; // Rejected outright — the front door held.

      // Every field the tool renders into an href. LinkUnwrapperTool.tsx:189
      // uses cleanUrl; the hop list and finalUrl are shown and copyable.
      const surfaced = [
        ['cleanUrl', r.cleanUrl],
        ['finalUrl', r.finalUrl],
        ['startUrl', r.startUrl],
        ...(r.hops || []).map((h, i) => [`hops[${i}].url`, h && h.url]),
      ].filter(([, v]) => typeof v === 'string' && v.length);

      for (const [field, value] of surfaced) {
        if (!isWebUrl(value)) {
          findings.push(finding({
            severity: 'high',
            title: `analyzeLink surfaces a non-http string as ${field}`,
            detail: 'components/tools/LinkUnwrapperTool.tsx:189 renders `href={analysis.cleanUrl}` with target="_blank". React escapes text but does not stop a javascript: href, so a non-http string reaching one of these fields is a one-click script execution in the visitor\'s own origin.',
            evidence: `analyzeLink(${JSON.stringify(raw)}) — aimed at the ${aimedAt} — returned ${field} = ${JSON.stringify(value)}`,
            remediation: 'Route the value through parseHttpUrl (lib/link-unwrapper.ts:174) before it leaves this module, and rebuild it from u.origin + u.pathname the way analyzeParams already does at :544.',
            file: 'lib/link-unwrapper.ts',
          }));
        }
      }
    }

    // The email tool renders pixel and link URLs it found in pasted mail source.
    // toHttpUrl is its one gate; assert it rejects every non-web scheme and
    // still accepts an ordinary one, so "reject everything" cannot pass either.
    for (const p of [...PAYLOADS, 'cid:embedded-part-1', 'about:blank']) {
      checked++;
      const u = email.toHttpUrl(p);
      if (u) {
        findings.push(finding({
          severity: 'high',
          title: `email-pixel toHttpUrl accepted ${p.split(':')[0]}:`,
          detail: 'The Email Pixel tool lists the URLs it found in pasted mail source, and a mail an attacker sent is attacker-chosen input.',
          evidence: `toHttpUrl(${JSON.stringify(p)}) returned ${JSON.stringify(u.href)} instead of null`,
          remediation: 'Keep the http:/https: protocol test in toHttpUrl (lib/email-pixel.ts:576).',
          file: 'lib/email-pixel.ts',
          line: 576,
        }));
      }
    }
    for (const good of ['https://ok.example/a.gif', 'http://ok.example/a.gif']) {
      checked++;
      if (!email.toHttpUrl(good)) {
        findings.push(finding({
          severity: 'medium',
          title: 'email-pixel toHttpUrl rejects an ordinary http URL',
          detail: 'A gate that rejects everything passes the negative cases and silently breaks the tool. This is the control that stops the assertions above being vacuous.',
          evidence: `toHttpUrl(${JSON.stringify(good)}) returned null`,
          remediation: 'Fix the protocol test.',
          file: 'lib/email-pixel.ts',
          line: 576,
        }));
      }
    }
    // Same control for the link tool: an ordinary link must still come out whole.
    checked++;
    {
      const ok = links.analyzeLink('https://example.test/a/b?x=1');
      if (!ok.ok || ok.cleanUrl !== 'https://example.test/a/b?x=1') {
        findings.push(finding({
          severity: 'medium',
          title: 'analyzeLink no longer passes an ordinary link through unchanged',
          detail: 'The hostile cases above all end in "rejected", so without this control the whole check would still pass if analyzeLink started rejecting everything.',
          evidence: `analyzeLink('https://example.test/a/b?x=1') returned ${JSON.stringify(ok.ok ? ok.cleanUrl : ok.error)}`,
          remediation: 'Investigate — either the tool is broken or the expectation moved.',
          file: 'lib/link-unwrapper.ts',
        }));
      }
    }

    return { findings, checked };
  },
});
