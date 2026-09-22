/**
 * Every origin IN-APP-BRIDGE.md hands the Android app is still one of ours.
 *
 * IN-APP-BRIDGE.md is not documentation. It is the specification the app team
 * implements against, and the app team copies strings out of it into code that
 * ships to phones: the `setOf(…)` passed to WebViewCompat.addWebMessageListener
 * (§2), the host named in the "tell the page it is in the app" bullet (§1), and
 * the URLs in the test script (§5). An origin in that listener is not a fetch
 * destination — it is a native bridge injected into whatever page loads there,
 * carrying openUpgrade() and saveImage(base64, filename, mime), which writes a
 * caller-supplied file into the user's MediaStore.
 *
 * The failure this exists for happened three days ago. Commit ffa99bc removed
 * https://incognitobrowser-pseo.vercel.app and https://incognitobrowser-pro.vercel.app
 * from the live CSP connect-src because the owner is closing the Vercel account
 * and a released *.vercel.app subdomain is re-registerable by any other Vercel
 * user. The same two hosts sat in this document's bridge allowlist, where the
 * consequence is worse: whoever registers the name next gets a native file-write
 * primitive handed to their page in every app user's WebView. A CSP fix does not
 * reach an installed app, and nothing in the 3,020 tests read this file.
 *
 * WHAT THIS CHECK DOES NOT DO, deliberately:
 *   - It does not re-grade the wildcard and missing-live-origin cases inside
 *     setOf(…). pentest-inapp-bridge-origins owns those, and two checks firing
 *     on one line teaches people to ignore both. This one is the wider net: it
 *     grades every scheme-qualified origin anywhere in the document, including
 *     the §1 bullet and the §5 test URLs, which that check does not read.
 *   - It does not look at bare hostnames in backticks. §1 and the nip.io note
 *     discuss `nip.io`, `<ip>.nip.io` and `incognitobrowser.io/resources` as
 *     prose about third-party wildcard DNS. Grading those would make this check
 *     wrong on the day it was written, and a check that is wrong on day one is
 *     switched off by the end of the week.
 *   - It does not flag an origin on a line that is retiring it. §5's own Kotlin
 *     comment says the two vercel.app hosts "must not come back", and the
 *     2026-09-18 header says "Remove both" — a check that fires on the removal
 *     notice punishes writing the removal notice.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { tierOrigins } from './mast-shared.mjs';

const DOC = 'IN-APP-BRIDGE.md';

/**
 * A line that is taking an origin AWAY. The document has to be able to name a
 * host in order to tell the app team to delete it, and telling them to delete
 * it is the behaviour we want, not a finding.
 */
const RETIRING = /\b(remove|removed|earlier version|used to be|must not come back|no longer|do not use|never write|stop using|deprecat)/i;

/** Hosts a released subdomain makes dangerous, named so the check can refuse them by name. */
const RE_REGISTERABLE = /\b(vercel\.app|netlify\.app|pages\.dev|github\.io|herokuapp\.com|onrender\.com|surge\.sh)\b/i;

export default check({
  id: 'mast-bridge-origin-allowlist',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Every origin the WebView bridge contract hands the Android app is one lib/tiers.ts still serves from, and none is a subdomain someone else can re-register.',
  async run(ctx) {
    const path = join(ctx.repoRoot, DOC);
    if (!existsSync(path)) {
      // The contract vanishing is not "no origins to worry about": the app
      // still has whatever allowlist it last copied, and now nothing grades it.
      throw new Skip(`${DOC} does not exist — the bridge contract this check grades is gone, which is not a pass`);
    }
    const text = readFileSync(path, 'utf-8');
    const lines = text.split('\n');

    const allowed = tierOrigins(ctx.repoRoot);
    if (!allowed.size) {
      throw new Skip('could not read FREE_BASE_URL/PRO_BASE_URL defaults out of lib/tiers.ts — with no live origins to compare against, every finding would be noise');
    }
    const extras = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts', 'security', 'data', 'mast-bridge-hosts.json'), 'utf-8'));
    const reasons = new Map();
    for (const e of extras.extraOrigins || []) { allowed.add(e.origin); reasons.set(e.origin, e.reason); }

    const findings = [];
    let checked = 0;

    lines.forEach((line, i) => {
      // Scheme-qualified only. `incognitobrowser://upgrade` is the deep-link
      // fallback, not a web origin, so http(s) is the filter.
      const urls = line.match(/https?:\/\/[^\s"'`)<>\]]+/g) || [];
      // Markdown emphasis splits the words a retirement notice is made of —
      // "and **never** write a wildcard" is not the literal string "never
      // write". Strip the emphasis markers before asking what the line is
      // saying; keep them out of the URLs themselves.
      const prose = line.replace(/[*_]/g, '');
      for (const raw of urls) {
        // A pattern, not an origin. `https://*.nip.io` appears in §2's warning
        // never to write one; wildcards that reach the real setOf block are
        // graded, at critical, by pentest-inapp-bridge-origins.
        if (raw.includes('*')) continue;
        let origin;
        try { origin = new URL(raw).origin; } catch { continue; }
        checked++;
        // The re-registerable test runs BEFORE the allowlist short-circuit. It
        // used to run after, which exempted anything declared in
        // scripts/security/data/mast-bridge-hosts.json from the one test that
        // caught the vercel.app hosts — so one JSON edit could re-grant a
        // subdomain someone else can claim, and this check would say nothing.
        const reReg = RE_REGISTERABLE.test(origin);
        if (allowed.has(origin) && !reReg) continue;
        if (RETIRING.test(prose)) continue;  // the document is deleting it, not granting it
        const n = i + 1;
        findings.push(finding({
          severity: reReg ? 'high' : 'medium', file: DOC, line: n,
          title: reReg
            ? `The bridge contract names ${origin}, a subdomain someone else can register`
            : `The bridge contract names ${origin}, which this repo does not serve`,
          detail: reReg
            ? 'A released *.vercel.app / *.pages.dev style subdomain goes back into the pool. Whoever claims it next is handed window.IncognitoBrowserApp in every app user\'s WebView — openUpgrade(), which drives the purchase screen, and saveImage(base64, filename, mime), which writes an attacker-chosen file into the user\'s MediaStore. Removing it from the CSP does not reach an app that has already shipped the allowlist.'
            : 'The app team copies origins out of this document into the addWebMessageListener allowlist. An origin lib/tiers.ts does not serve is either an origin we no longer control — in which case it is a bridge handed to a stranger — or a typo that leaves the bridge missing where the pages really are.',
          evidence: `${DOC}:${n}: ${line.trim().slice(0, 180)}\n  lib/tiers.ts serves: ${[...allowed].filter((o) => !reasons.has(o)).join(', ')}${reasons.size ? `; allowed extra: ${[...reasons.keys()].join(', ')}` : ''}`,
          remediation: 'Remove it from the document and tell the app team — a released app keeps its allowlist until the next release, so a doc fix on its own changes nothing on the phones. If the origin is genuinely ours, add it to scripts/security/data/mast-bridge-hosts.json with the reason.',
        }));
      }
    });

    if (!checked) {
      // Zero origins in the bridge contract means the setOf block, the §1 host
      // and the §5 test URLs have all gone. That is the subject of the check
      // disappearing, not a clean bill of health.
      throw new Skip(`${DOC} contains no http(s) origins at all — the allowlist this check grades is not in the document any more`);
    }
    return { findings, checked };
  },
});
