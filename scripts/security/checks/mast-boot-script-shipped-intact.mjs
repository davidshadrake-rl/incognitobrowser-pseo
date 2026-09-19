/**
 * The built pages carry an in-app boot script that still BEHAVES.
 *
 * tests/in-app.test.ts runs IN_APP_BOOT_SCRIPT as the test toolchain
 * serialises it. Nothing has ever looked at the artifact. Those are two
 * different strings: the shipped one is SWC-minified
 * (`(function(a){try{let b=a.document.documentElement,…`), the test one is
 * whatever tsx/esbuild emitted for `bootInApp.toString()`, and under some
 * toolchains that includes a reference to a bundler helper (`__name`) which
 * does not exist on the page. Byte-comparing them is a guaranteed permanent
 * red, so this check does not: it executes the script it pulled out of the
 * HTML and grades what it did.
 *
 * That matters because IN_APP_BOOT_SCRIPT is a function serialised with
 * toString() and injected inline, and bootInApp wraps its whole body in
 * try/catch so it can never affect the page. A helper reference inside that
 * body throws a ReferenceError which its own catch swallows — no console
 * error, no visible symptom, and the script silently does nothing on every
 * page of both sites. Three things break at once when that happens: an app
 * user is told to "Get the Android app", the scorecard falls back to the
 * blob: download the app's download manager rejects, and — the security one —
 * inapp/pro stop being stripped from the address bar, so every link copied out
 * of the app carries them to whoever receives it.
 *
 * WHY THIS SKIPS MORE OFTEN THAN IT RUNS, and why that is correct: .gitignore
 * excludes /out/ and scripts/deploy.sh does `rm -rf out .next` before each
 * build, so on a clean tree there is nothing to grade. Worse, a leftover out/
 * is actively misleading — the one in this working tree right now is a stale
 * PRO export whose index.html is an error shell, and whose boot script
 * predates the 2026-09-18 confirmation guard. tests/rendered-pages.test.ts
 * solved exactly this after the 2026-09-08 audit by refusing to grade an
 * export that does not carry scripts/write-build-marker.mjs's marker, and this
 * check uses the same gate. Where it really earns its place is inside
 * scripts/deploy.sh's site() loop, where a fresh export of each of the two
 * builds exists and the marker has just been written — the same place the
 * page guards already run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { extractBootScript, gradeBootBehaviour } from './mast-shared.mjs';

/**
 * Pages to grade in an export. The home page and a tool page: the tool pages
 * are where the three gated Pro tools and the scorecard live, and the home
 * page is the one the app's own tile opens.
 */
const PAGES = ['index.html', 'tools/index.html'];

export default check({
  id: 'mast-boot-script-shipped-intact',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['build-output'],
  describe: 'The inline in-app boot script in the built HTML still runs, marks the page, strips the app\'s flags from the address bar, and refuses a bare ?pro=1.',
  async run(ctx) {
    const out = join(ctx.repoRoot, 'out');
    if (!existsSync(out)) throw new Skip('out/ does not exist — run `npx next build` (this check belongs in scripts/deploy.sh site(), after the export)');

    // The marker gate, from tests/rendered-pages.test.ts. A leftover export
    // from the other tier, a partial build or an iCloud conflict copy was
    // otherwise graded with someone else's expectations and passed or failed
    // for the wrong reasons (audit 2026-09-08). Unlike that test this one
    // accepts either tier — the boot script is identical in both builds — but
    // it still insists on knowing what it is looking at.
    let marker;
    try {
      marker = JSON.parse(readFileSync(join(out, '.build-marker.json'), 'utf-8'));
    } catch {
      throw new Skip('out/ has no .build-marker.json — refusing to grade an export that cannot say which build it is (run scripts/write-build-marker.mjs after the export)');
    }
    if (marker.target !== 'static') {
      throw new Skip(`out/ marker says target=${JSON.stringify(marker.target)}; this check grades the static export the droplet serves`);
    }

    /**
     * The PRO export's root index.html is not a page, so it is not graded.
     *
     * scripts/droplet-htaccess.conf sends `^resources-pro/?$` to
     * /resources-pro/tools/ with a 302 (verified live 2026-09-19: the root
     * answers 302, never 200), so what sits at that path is an RSC shell no
     * browser renders and no WebView ever boots. It legitimately carries no
     * boot script, and grading it reported a medium on every single run —
     * noise that teaches people to skim past this check's output.
     *
     * Narrow on purpose. The FREE root IS a real page — it answers 200 with
     * the 1073-character boot script in it — and is still graded, as is
     * tools/index.html in both tiers. Only the one path the server redirects
     * away from is excluded, and only in the tier where it is a shell.
     */
    const SHELL_IN_PRO = new Set(['index.html']);
    const gradable = marker.tier === 'pro' ? PAGES.filter((p) => !SHELL_IN_PRO.has(p)) : PAGES;

    const present = gradable.filter((p) => existsSync(join(out, p)));
    if (!present.length) throw new Skip(`out/ has none of ${gradable.join(', ')} — nothing to extract a boot script from`);

    const findings = [];
    let checked = 0;

    for (const page of present) {
      const rel = `out/${page}`;
      const html = readFileSync(join(out, page), 'utf-8');
      checked++;
      const src = extractBootScript(html);
      if (!src) {
        findings.push(finding({
          severity: 'medium', file: rel,
          title: `The built page ${page} ships no in-app boot script`,
          detail: 'app/layout.tsx injects it inline at the top of <body> so it settles before the first paint. A page without it never learns it is inside the app and never takes the app\'s flags out of the address bar.',
          evidence: `${rel} (marker ${JSON.stringify(marker)}): no inline <script> that both mentions data-inapp and calls history.replaceState. Note that Next's RSC flight payload also contains the string "data-inapp", which is why this looks for the IIFE and not for the text.`,
          remediation: 'Check app/layout.tsx still renders <script dangerouslySetInnerHTML={{ __html: IN_APP_BOOT_SCRIPT }} /> and that the export was not truncated.',
        }));
        continue;
      }
      const graded = gradeBootBehaviour(src, `${rel} (marker tier=${marker.tier})`, { file: rel });
      findings.push(...graded.findings);
      checked += graded.checked;
    }

    return { findings, checked };
  },
});
