/**
 * A privacy notice exists, is linked from every page, and every tool that
 * calls the API says what it sends.
 *
 * This is the one compliance duty on this project that is unambiguously
 * binding and unambiguously unmet. GDPR/UK GDPR Art. 13 is a notice-AT-
 * COLLECTION duty, and this system collects: /ip and /scan-url receive the
 * visitor's IP, /event receives a page and an interaction, and
 * lib/dns-leak-store.ts persists the visitor's full public IP in Redis for
 * 600 seconds. The sites are globally reachable and actively court EU readers
 * — there are GDPR calculators and international-privacy hubs in this very
 * repo. There is no privacy notice page on either tier and no link to one in
 * the footer.
 *
 * None of that makes the processing unlawful or even unusual; it makes it
 * undisclosed, which is a different and much cheaper problem to fix.
 *
 * Two halves, because they fail independently:
 *   1. The site-wide notice: a route under app/ that renders it, present in
 *      the built export, and linked from the footer of every built page.
 *   2. Per-tool disclosure: each tool that talks to /api/ renders a line
 *      saying what leaves the browser. One of the four does today
 *      (CookieAnalyzerTool: "The site sees a visit from our server."), and
 *      URLAnalyzerTool has one too. The DNS-leak test — the tool that
 *      actually stores an IP — and the IP tool do not.
 *
 * THIS CHECK IS RED ON DAY ONE, and says so rather than being tuned until it
 * is green. The remedy is a page and a footer link, not a softer check.
 *
 * Scope note, because this is a repo full of privacy editorial: nothing here
 * greps prose for the word "privacy". It enumerates tool components by their
 * actual API dependency — an import of lib/scan-client, a reference to
 * NEXT_PUBLIC_SCAN_API, or a fetch of an /api/ path — so a tool that stops
 * calling the server stops being graded, and one that starts calling it is
 * picked up the same day.
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

/** A tool that sends something to our server, by dependency rather than by prose. */
const TALKS_TO_API = [
  /from\s+['"]@\/lib\/scan-client['"]/,
  /from\s+['"].*\/scan-client['"]/,
  /NEXT_PUBLIC_SCAN_API/,
  /fetch\s*\(\s*[`'"]\/api\//,
  /\$\{\s*API_BASE\s*\}|\$\{\s*SCAN_API_BASE\s*\}/,
];

export default check({
  id: 'cmp-collection-notice-present',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A privacy notice page exists and is linked from every built page, and every tool that sends something to the API discloses what it sends (GDPR Art. 13 notice at collection).',
  async run(ctx) {
    const registryPath = join(ctx.repoRoot, 'scripts/security/data/compliance-disclosures.json');
    if (!existsSync(registryPath)) throw new Skip(`missing ${relative(ctx.repoRoot, registryPath)} — the disclosure registry this check grades against`);
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    const byFile = new Map((registry.tools || []).map((t) => [t.file, t]));

    const findings = [];
    let checked = 0;

    // ---- 1. the site-wide notice -------------------------------------------
    const appDir = join(ctx.repoRoot, 'app');
    if (!existsSync(appDir)) throw new Skip('no app/ directory — this is not the site repo');
    const pages = walk(appDir, ['page.tsx']);
    const noticeRoute = pages.find((p) => /\/(privacy|privacy-notice|privacy-policy|data-collection)\//.test(p.replace(/\\/g, '/')));
    checked += 1;
    if (!noticeRoute) {
      findings.push(finding({
        severity: 'medium',
        title: 'No privacy notice page exists on either site',
        detail: `The API receives the visitor's IP on /ip, /scan-url and /event, and lib/dns-leak-store.ts persists their full public IP in Redis for 600 seconds. GDPR/UK GDPR Art. 13 requires that to be disclosed at the point of collection, and these sites are globally reachable and specifically address EU readers. There is nowhere on either site that says what is collected, why, for how long, or who runs it. This is not a hard fix — one page and one footer link — and it is the only clearly binding compliance duty on this project that is currently unmet.`,
        evidence: `searched ${pages.length} page routes under app/ for a privacy/privacy-notice/privacy-policy route: none found\nthe nearest thing is app/site/methodology/page.tsx, which explains how OTHER sites are scanned, not what we collect`,
        remediation: `Add app/privacy/page.tsx covering: the public IP received by /ip, /scan-url, /event and /dns-leak/start; the 600-second Redis retention in lib/dns-leak-store.ts; the counters behind /stats; that there are no cookies and no third-party loads; and who the controller is. Then link it from the footer in app/layout.tsx.`,
        file: 'app/layout.tsx',
      }));
    } else {
      // A page nobody can reach is not a notice. Assert the footer links it on
      // every built page — the export is where that is actually true or not.
      const out = join(ctx.repoRoot, 'out');
      const routeHref = `/${relative(appDir, noticeRoute).replace(/\\/g, '/').replace(/\/page\.tsx$/, '')}/`;
      if (!existsSync(out)) {
        findings.push(finding({
          severity: 'low',
          title: `Privacy notice route exists but no export to verify the footer link: ${routeHref}`,
          detail: 'The notice page is only a notice if every page links it. Without a build there is nothing to check that against.',
          evidence: `${relative(ctx.repoRoot, noticeRoute)} exists; out/ does not`,
          remediation: 'Run `npm run build` and re-run this check.',
          file: relative(ctx.repoRoot, noticeRoute),
        }));
      } else {
        const html = walk(out, ['.html']);
        const missing = html.filter((f) => !readFileSync(f, 'utf-8').includes(`${routeHref}"`));
        checked += html.length;
        if (missing.length) {
          findings.push(finding({
            severity: 'medium',
            title: `The privacy notice is not linked from ${missing.length} of ${html.length} built pages`,
            detail: 'Notice at collection means reachable from where the collection happens. A notice linked from some pages is a notice most visitors never see.',
            evidence: `${missing.length}/${html.length} built pages have no href to ${routeHref}\nfirst: ${relative(ctx.repoRoot, missing[0])}`,
            remediation: 'Put the link in the global footer in app/layout.tsx so it propagates to every page.',
            file: 'app/layout.tsx',
          }));
        }
      }
    }

    // ---- 2. per-tool disclosure --------------------------------------------
    const toolsDir = join(ctx.repoRoot, 'components/tools');
    if (!existsSync(toolsDir)) throw new Skip('no components/tools directory — the tool surface this check grades');
    const toolFiles = walk(toolsDir, ['.tsx']).filter((p) => /Tool\.tsx$/.test(p));
    if (!toolFiles.length) throw new Skip('components/tools holds no *Tool.tsx components');

    for (const file of toolFiles) {
      const rel = relative(ctx.repoRoot, file);
      const src = readFileSync(file, 'utf-8');
      if (!TALKS_TO_API.some((rx) => rx.test(src))) continue; // client-only tool: nothing leaves the browser
      checked += 1;
      const entry = byFile.get(rel);
      if (!entry) {
        findings.push(finding({
          severity: 'medium',
          title: `Tool sends data to the server with no registered disclosure: ${rel}`,
          detail: `This component calls the scan API, so something leaves the visitor's browser and reaches our server — at minimum their IP, and usually a URL they typed. Nothing in the tool tells them that. GDPR Art. 13 wants the disclosure where the collection happens, and it is also simply what this product says it stands for.`,
          evidence: `${rel} matches ${TALKS_TO_API.filter((rx) => rx.test(src)).length} API-dependency pattern(s) and has no entry in scripts/security/data/compliance-disclosures.json`,
          remediation: `Render one sentence near the control that starts the request, saying what is sent and what the server does with it — CookieAnalyzerTool.tsx's "Scan has our server load the page… The site sees a visit from our server." is the model. Then register it in compliance-disclosures.json.`,
          file: rel,
        }));
        continue;
      }
      if (!src.includes(entry.must)) {
        findings.push(finding({
          severity: 'medium',
          title: `Registered disclosure has gone from ${rel}`,
          detail: 'The disclosure this tool is on record as rendering is no longer in the file. Either it was reworded — in which case the registry has to follow — or a refactor dropped the only sentence telling the visitor what leaves their browser.',
          evidence: `${rel} no longer contains: "${entry.must}"`,
          remediation: 'Restore the sentence, or update `must` in compliance-disclosures.json to the new wording — after reading the new wording.',
          file: rel,
        }));
      }
    }

    // An entry for a file that no longer exists is stale paperwork.
    for (const t of registry.tools || []) {
      if (existsSync(join(ctx.repoRoot, t.file))) continue;
      checked += 1;
      findings.push(finding({
        severity: 'low',
        title: `Disclosure registry names a file that does not exist: ${t.file}`,
        detail: 'The registry is the record of what each tool tells the visitor. An entry with no file means it has stopped describing the code.',
        evidence: `compliance-disclosures.json entry for "${t.file}" — no such file`,
        remediation: 'Remove the entry, or point it at where the tool moved to.',
        file: 'scripts/security/data/compliance-disclosures.json',
      }));
    }

    return { findings, checked };
  },
});
