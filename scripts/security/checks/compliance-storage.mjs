/**
 * Cookieless, and every browser-storage key justified.
 *
 * The site sets no cookies and writes four storage keys, all of them things
 * the visitor asked for (their checklist ticks, their DNS baseline, and the
 * in-app/Pro flags for this tab). That is what keeps it exempt from the
 * ePrivacy Art. 5(3) consent requirement and what makes "we count clicks, not
 * people" a true sentence. Both properties are one commit away from being
 * false, and nothing in the repo notices.
 *
 * So: any response that starts setting a cookie is a finding, and any storage
 * write not carried in scripts/security/data/compliance-storage-allowlist.json
 * with a written justification is a finding. The point is not the write, it is
 * that somebody had to type a reason.
 *
 * WHAT THIS CHECK DELIBERATELY DOES NOT FLAG — this is the whole difficulty.
 * Reading and classifying OTHER sites' Set-Cookie headers is the product.
 * lib/scanner.ts parses them in four places, app/site/methodology/page.tsx
 * carries a long editorial passage about cookie classification, and the
 * tools' copy names cookies constantly. A naive grep for "Set-Cookie" fails
 * against the flagship feature on its first run and is muted within a week.
 * This check only looks at RESPONSE CONSTRUCTION: a cookie set on a response
 * WE send — `NextResponse.cookies.set(...)`, `cookies()` from next/headers,
 * or a literal 'Set-Cookie' written into a headers object we are building.
 * Reading `response.headers.get('set-cookie')` from a scanned site is not that
 * and never fires.
 *
 * On storage, the design's stated method (grep for literal
 * `localStorage.setItem`) finds two of the four keys. The other two are
 * written in lib/in-app.ts's bootInApp as `store.setItem(k, '1')`, where
 * `store` is a captured Storage and `k` is a parameter — the literal grep
 * cannot see the keys it claims to govern. So this matches any `.setItem(` on
 * a receiver that is a Storage or a plausible alias of one, and keys the
 * allowlist on file + the key expression as written. A computed key is
 * allowlisted by its expression, and the concrete keys it produces are
 * recorded beside it for whoever reads the file next.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, acc);
    else if (exts.some((e) => entry.name.endsWith(e))) acc.push(p);
  }
  return acc;
}

/**
 * Setting a cookie on a response we send. Each pattern is a construction, not
 * a mention: `.cookies.set(`, next/headers `cookies()`, and a 'Set-Cookie'
 * key written into an object or passed to headers.set/append. Reading a
 * scanned site's Set-Cookie (lib/scanner.ts) matches none of them.
 */
const COOKIE_WRITES = [
  [/\.cookies\s*\.\s*(?:set|delete)\s*\(/, 'response cookie write (.cookies.set/.delete)'],
  [/\bfrom\s+['"]next\/headers['"]/, "import from next/headers (cookies() lives here)"],
  [/\bheaders\s*(?:\(\s*\))?\s*\.\s*(?:set|append)\s*\(\s*['"`][Ss]et-[Cc]ookie['"`]/, "headers.set('Set-Cookie', …)"],
  [/['"`][Ss]et-[Cc]ookie['"`]\s*:/, "a 'Set-Cookie' key in a headers object literal"],
];

/**
 * A `.setItem(` call on something that is, or plausibly aliases, web storage.
 * Captures the receiver and the key expression as written.
 */
const SET_ITEM = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.\s*setItem\s*\(\s*([^,]+?)\s*,/g;
const STORAGE_RECEIVER = /(?:^|\.)(?:localStorage|sessionStorage|store|storage|ls|ss)$/i;

export default check({
  id: 'cmp-no-cookies-unlisted-storage',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'No route sets a cookie, and every localStorage/sessionStorage key carries a written "strictly necessary" justification — the two facts that keep this site consent-exempt.',
  async run(ctx) {
    const allowPath = join(ctx.repoRoot, 'scripts/security/data/compliance-storage-allowlist.json');
    if (!existsSync(allowPath)) throw new Skip(`missing ${relative(ctx.repoRoot, allowPath)} — the allowlist this check grades against`);
    const allow = JSON.parse(readFileSync(allowPath, 'utf-8'));

    const sources = [
      ...walk(join(ctx.repoRoot, 'app'), ['.ts', '.tsx']),
      ...walk(join(ctx.repoRoot, 'lib'), ['.ts', '.tsx']),
      ...walk(join(ctx.repoRoot, 'components'), ['.ts', '.tsx']),
    ].filter((p) => !/\.test\.tsx?$/.test(p));
    if (!sources.length) throw new Skip('found no app/, lib/ or components/ sources to read');

    const findings = [];
    let checked = 0;

    for (const file of sources) {
      const rel = relative(ctx.repoRoot, file);
      const lines = readFileSync(file, 'utf-8').split('\n');
      checked += 1;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        // Comments describe the world; code changes it. A line that is only a
        // comment is never a cookie write, and app/site/methodology explains
        // Set-Cookie classification at length.
        // The trailing "// …" strip requires a non-colon before the slashes so
        // it cannot eat an "https://…" in the middle of a line of real code.
        const code = line.replace(/(^|[^:])\/\/.*$/, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
        if (!code.trim()) continue;

        for (const [rx, what] of COOKIE_WRITES) {
          if (!rx.test(code)) continue;
          findings.push(finding({
            severity: 'medium',
            title: `A response sets a cookie: ${rel}`,
            detail: `This is ${what}. The site's stated position is that it sets no cookies, which is what makes it exempt from the ePrivacy Art. 5(3) consent requirement and what makes "we count clicks, not people" true. A cookie on a response falsifies both, and nothing else in the repo would notice.`,
            evidence: `${rel}:${i + 1}: ${line.trim().slice(0, 200)}`,
            remediation: 'If a cookie is genuinely required, it needs a consent decision and a privacy notice before it ships — not a code review. If it is not, remove it.',
            file: rel,
            line: i + 1,
          }));
        }

        SET_ITEM.lastIndex = 0;
        let m;
        while ((m = SET_ITEM.exec(code)) !== null) {
          const [, receiver, keyExpr] = m;
          if (!STORAGE_RECEIVER.test(receiver)) continue;
          const key = keyExpr.trim().replace(/^['"`]|['"`]$/g, '');
          const listed = (allow.writes || []).some((w) => w.where === rel && w.call === key && String(w.justification || '').length > 20);
          if (listed) continue;
          findings.push(finding({
            severity: 'medium',
            title: `Unlisted browser-storage write: ${rel} (${key})`,
            detail: `This write is not in scripts/security/data/compliance-storage-allowlist.json with a justification. Storage that is not strictly necessary — anything for analytics, personalisation or advertising — needs consent under ePrivacy Art. 5(3), and adding it silently is what turns today's exempt posture into a banner obligation nobody decided to take on.`,
            evidence: `${rel}:${i + 1}: ${line.trim().slice(0, 200)}\nreceiver=${receiver} key=${key}`,
            remediation: `If it is strictly necessary, add it to the allowlist with a justification written in the visitor's terms. If it is not, it needs a consent decision first.`,
            file: rel,
            line: i + 1,
          }));
        }
      }
    }

    // An allowlist entry whose call site has gone is dead paperwork, and dead
    // paperwork is how an allowlist stops describing the code it governs.
    const seenPairs = new Set();
    for (const file of sources) {
      const rel = relative(ctx.repoRoot, file);
      const text = readFileSync(file, 'utf-8');
      for (const w of allow.writes || []) {
        if (w.where !== rel) continue;
        if (new RegExp(`setItem\\s*\\(\\s*${w.call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`).test(text)
          || new RegExp(`setItem\\s*\\(\\s*['"\`]${w.call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]\\s*,`).test(text)) {
          seenPairs.add(`${w.where}::${w.call}`);
        }
      }
    }
    for (const w of allow.writes || []) {
      if (seenPairs.has(`${w.where}::${w.call}`)) continue;
      findings.push(finding({
        severity: 'low',
        title: `Storage allowlist names a write that no longer exists: ${w.where} (${w.call})`,
        detail: 'The allowlist is the record of what this site stores and why. An entry with no call site means the file has moved on and the record has not, which is how an allowlist quietly stops describing the code.',
        evidence: `compliance-storage-allowlist.json entry {where: "${w.where}", call: "${w.call}"} matches no setItem call in that file`,
        remediation: 'Remove the entry, or point it at where the write moved to.',
        file: 'scripts/security/data/compliance-storage-allowlist.json',
      }));
      checked += 1;
    }

    return { findings, checked };
  },
});
