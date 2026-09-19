/**
 * Two halves of the same problem: where the "Get Pro" button goes, and whether
 * anyone can still put it back.
 *
 * IN-APP-BRIDGE.md renders roughly 1,400 of these pages inside the Android
 * app's WebView. So an upgrade CTA is not a marketing link — it is a purchase
 * flow for a digital good, inside the app, and Google Play Billing has views
 * about where those may go. The footnote under the button ("Pro is part of the
 * free Incognito Browser app. Android only.") and the in-app label ("Upgrade
 * to Pro") both have to keep describing where the tap actually lands.
 *
 * Today components/UpgradeButtons.tsx:41 sets DEMO_UPGRADE_URL to another
 * product's staging paywall, by an owner decision on 2026-09-17, and every
 * upgrade button in the export points there. That is a legitimate decision. An
 * undated one is not: "temporary" with no end date is how a demo becomes the
 * product. So the rule is not "never" — it is "declared, owned, and expiring".
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

function loadExceptions(ctx) {
  const p = join(ctx.repoRoot, 'scripts/security/data/compliance-exceptions.json');
  if (!existsSync(p)) throw new Skip(`missing ${relative(ctx.repoRoot, p)} — the declared-exceptions file these checks grade against`);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

/** An ISO date in the past, today counting as still valid. */
function expired(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return 'not an ISO date (YYYY-MM-DD)';
  const today = new Date().toISOString().slice(0, 10);
  return iso < today ? `expired on ${iso} (today is ${today})` : null;
}

const hrefOf = (tag) => (/\bhref\s*=\s*"([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&amp;/g, '&');

/** The two destinations an upgrade CTA may have without anyone declaring anything. */
function sanctioned(href) {
  // An attributed Play listing: scripts/funnels/stats.ts reads the referrer,
  // so a Play link without one is a link that loses its own attribution.
  if (/^https:\/\/play\.google\.com\/store\/apps\/details\?/.test(href)) {
    return /[?&]referrer=/.test(href) ? true : 'play.google.com without a referrer= (install attribution is lost)';
  }
  if (href === 'incognitobrowser://upgrade') return true;
  return false;
}

const upgradeCta = check({
  id: 'cmp-upgrade-cta-destination',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['build-output'],
  describe: 'Every upgrade CTA in the built pages resolves to Google Play or the app\'s own upgrade screen, or to a declared exception with a named owner and an end date.',
  async run(ctx) {
    const out = join(ctx.repoRoot, 'out');
    if (!existsSync(out)) throw new Skip('no static export at out/ — run `npm run build` first');
    const exceptions = loadExceptions(ctx);
    const declared = new Map((exceptions.upgradeDestinations || []).map((d) => [String(d.host).toLowerCase(), d]));

    const files = walk(out, ['.html']);
    if (!files.length) throw new Skip('out/ holds no .html — an empty or half-written export');

    // Grouped by destination: 1,400 pages carrying the same button is one
    // decision to review, not 1,400 findings to scroll past.
    const byHref = new Map();
    let ctas = 0;
    for (const file of files) {
      const html = readFileSync(file, 'utf-8');
      // Only real anchor tags in the markup. Script bodies are stripped so the
      // RSC flight payload's escaped attributes cannot forge a CTA.
      const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      for (const tag of markup.match(/<a\b[^>]*\bdata-upgrade-from=[^>]*>/gi) || []) {
        ctas += 1;
        const href = hrefOf(tag);
        if (!byHref.has(href)) byHref.set(href, { count: 0, first: relative(ctx.repoRoot, file), tag });
        byHref.get(href).count += 1;
      }
    }
    if (!ctas) {
      // The export having no upgrade CTA at all is not a pass either: either
      // the funnel has vanished or this is a partial build.
      throw new Skip(`no data-upgrade-from anchors in ${files.length} built page(s) — a Pro funnel is meant to be on every page (see the per-page funnel note in MEMORY), so this is a partial export or a regression, not a clean result`);
    }

    const findings = [];
    for (const [href, seen] of byHref) {
      const verdict = sanctioned(href);
      if (verdict === true) continue;
      let host = '(relative or unparseable)';
      try { host = new URL(href).host.toLowerCase(); } catch { /* keep the placeholder */ }
      const entry = declared.get(host);
      const why = typeof verdict === 'string' ? verdict : `destination is not Google Play or incognitobrowser://upgrade`;

      if (!entry) {
        findings.push(finding({
          severity: 'high',
          title: `Upgrade CTA points at an undeclared destination: ${host}`,
          detail: `${why}. These pages render inside the Android app's WebView (IN-APP-BRIDGE.md), so this is a purchase CTA for a digital good leaving Google Play Billing, and the footnote under the button ("Pro is part of the free Incognito Browser app. Android only.") no longer describes where the tap goes. It may well be a decision someone made on purpose — but an undeclared, undated one, which is how a demo quietly becomes permanent.`,
          evidence: `href="${href}" on ${seen.count} upgrade CTA(s) across ${files.length} built page(s)\nfirst in ${seen.first}\n${seen.tag.slice(0, 240)}`,
          remediation: `Either point it back at the attributed Play link (components/UpgradeButtons.tsx: set DEMO_UPGRADE_URL to ''), or add an entry to scripts/security/data/compliance-exceptions.json → upgradeDestinations with host, owner, reason and an ISO expires date.`,
          file: seen.first,
        }));
        continue;
      }
      const stale = expired(entry.expires);
      if (stale || !entry.owner || !entry.reason) {
        findings.push(finding({
          severity: 'high',
          title: `Declared upgrade exception is ${stale ? 'expired' : 'incomplete'}: ${host}`,
          detail: stale
            ? `The exception that allows this destination has run out. The end date is the whole mechanism: past it, the CTA is simply pointing somewhere it should not.`
            : `The exception is missing an owner or a reason, so there is nobody to ask and nothing to review.`,
          evidence: `href="${href}" (${seen.count} CTA(s), first in ${seen.first})\nexception: ${JSON.stringify(entry)}\n${stale || 'owner/reason missing'}`,
          remediation: 'Roll the CTA back, or have the owner extend the exception with a new end date and the reason it still holds.',
          file: 'scripts/security/data/compliance-exceptions.json',
        }));
      }
    }
    return { findings, checked: ctas };
  },
});

/**
 * Turning a temporary override off must leave the suite green.
 *
 * The comment above DEMO_UPGRADE_URL promises "flip it back to '' — that one
 * line is the whole rollback". For a while that was false: tests/tiers.test.ts
 * asserted the constant equalled the demo URL unconditionally, and `npm run
 * build` and scripts/deploy.sh both run `npm test` first. So performing the
 * documented rollback failed the suite and blocked every deploy — the escape
 * hatch was welded shut, and whoever needed it under pressure would have had
 * to edit a test to ship. That has since been fixed (tests/tiers.test.ts now
 * branches on the switch's position, and tests/rendered-pages.test.ts does the
 * same); this check is what stops it coming back.
 *
 * MECHANISM. The design proposed running vitest twice with the module mocked.
 * That is 3,000-odd tests twice on every commit to prove a one-line rollback
 * is clean, and this is an every-commit check that must stay offline and fast.
 * The cheap equivalent, and the one the reviewer asked for: a source guard. An
 * override's CURRENT VALUE must not appear as a literal expectation in the
 * test suite outside a branch on the switch itself — because that literal is
 * precisely what breaks when the switch moves.
 *
 * It also insists the override is declared with an owner and an end date, for
 * the same reason as the CTA check above: undated is forever.
 *
 * Overrides are DISCOVERED, not listed, so this cannot go quiet by nobody
 * remembering to register one. An exported const whose name is marked as a
 * switch (DEMO_/TEMP_/OVERRIDE_ …) or whose comment block says so is one.
 */
const overrideRevertible = check({
  id: 'cmp-override-is-revertible',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A temporary override can actually be turned off: it is declared with an owner and an end date, and no test pins its current value where the rollback would break.',
  async run(ctx) {
    const exceptions = loadExceptions(ctx);
    const declared = new Map((exceptions.overrides || []).map((o) => [String(o.constant), o]));

    const sources = [
      ...walk(join(ctx.repoRoot, 'components'), ['.ts', '.tsx']),
      ...walk(join(ctx.repoRoot, 'lib'), ['.ts', '.tsx']),
      ...walk(join(ctx.repoRoot, 'app'), ['.ts', '.tsx']),
    ].filter((p) => !/\.test\.tsx?$/.test(p));
    if (!sources.length) throw new Skip('found no components/, lib/ or app/ sources to read');

    // A switch announces itself either in its name or in the comment block
    // written directly above it.
    const BY_NAME = /^(?:DEMO_|TEMP_|TEMPORARY_|OVERRIDE_|FORCE_|KILL_)|_(?:OVERRIDE|DEMO|KILL_SWITCH|TEMPORARY)$/;
    const BY_COMMENT = /\b(?:DEMO SWITCH|TEMP SWITCH|KILL SWITCH|the whole rollback|roll ?back this|revert this)\b/i;

    const overrides = [];
    for (const file of sources) {
      const rel = relative(ctx.repoRoot, file);
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const m = /^export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(.+?);?\s*$/.exec(lines[i]);
        if (!m) continue;
        const [, name, valueExpr] = m;
        // A switch has a hardcoded value someone flips by editing this line. A
        // constant computed from the environment (lib/tuning.ts's intEnv(…),
        // all thirty of them) is configuration, not an override, and treating
        // it as one buries the real finding under tuning noise — which is
        // exactly what this check did on its first run.
        const literal = /^(['"`])(.*)\1$/.exec(valueExpr.trim())?.[2]
          ?? (/^(?:true|false|null)$/.test(valueExpr.trim()) ? valueExpr.trim() : null);
        if (literal === null) continue;
        // Only the contiguous comment block immediately above counts. Read 30
        // lines back and one stray "kill switch" in a file-level note adopts
        // every declaration below it.
        let j = i - 1;
        const block = [];
        while (j >= 0 && /^\s*(?:\/\/|\*|\/\*)/.test(lines[j])) { block.unshift(lines[j]); j -= 1; }
        if (!BY_NAME.test(name) && !BY_COMMENT.test(block.join('\n'))) continue;
        overrides.push({ name, file: rel, line: i + 1, valueExpr: valueExpr.trim(), literal });
      }
    }
    if (!overrides.length) {
      // No switches in the tree is a real, checkable state — but say how many
      // files were read for it, so "0 findings" is not "0 looked at".
      return { findings: [], checked: sources.length };
    }

    const testFiles = walk(join(ctx.repoRoot, 'tests'), ['.ts', '.tsx']);
    const findings = [];

    for (const o of overrides) {
      const entry = declared.get(o.name);
      const stale = entry ? expired(entry.expires) : null;
      if (!entry) {
        findings.push(finding({
          severity: 'medium',
          title: `Override switch is on with no declared end date: ${o.name}`,
          detail: `${o.file} exports ${o.name}, a switch that changes shipped behaviour, and nothing records who turned it on, why, or when it comes off. Undated is forever: this is how a two-day demo is still live at the next audit, with everyone assuming somebody else owns it.`,
          evidence: `${o.file}:${o.line}: export const ${o.name} = ${o.valueExpr}\nnot present in scripts/security/data/compliance-exceptions.json → overrides[]`,
          remediation: `Turn it off, or add {constant, file, neutralValue, owner, reason, expires} to compliance-exceptions.json → overrides.`,
          file: o.file,
          line: o.line,
        }));
      } else if (stale) {
        findings.push(finding({
          severity: 'medium',
          title: `Override switch is past its declared end date: ${o.name}`,
          detail: `The owner set an end date for this switch and it has passed. Either it goes off, or someone decides again — in writing, with a new date.`,
          evidence: `${o.file}:${o.line}: export const ${o.name} = ${o.valueExpr}\nexception: ${JSON.stringify(entry)}\n${stale}`,
          remediation: `Set ${o.name} to ${JSON.stringify(entry.neutralValue ?? '')} , or have the owner extend the exception.`,
          file: o.file,
          line: o.line,
        }));
      }

      // The weld: a test that hardcodes the switch's current value as an
      // expectation. Flip the switch and that assertion fails, and because
      // `npm run build` and scripts/deploy.sh run the suite first, the
      // documented rollback blocks the deploy it is supposed to unblock.
      if (!o.literal || o.literal.length < 8) continue;
      for (const tf of testFiles) {
        const relT = relative(ctx.repoRoot, tf);
        const lines = readFileSync(tf, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          // Comments explain history — tests/tiers.test.ts documents this very
          // bug in prose above the fixed block. Only code counts. The trailing
          // "// …" strip must not eat "https://…": requiring a non-colon
          // before the slashes is the difference between this check working
          // and it silently matching nothing, which is how it first behaved.
          const code = lines[i].replace(/^\s*(?:\/\/|\*|\/\*).*$/, '').replace(/(^|[^:])\/\/.*$/, '$1');
          if (!code.includes(o.literal)) continue;
          if (!/\b(?:toBe|toEqual|toStrictEqual|toContain|toMatch)\s*\(/.test(code) && !/\bexpect\s*\(/.test(code)) continue;
          // A branch on the switch above the assertion is the correct pattern
          // (tests/rendered-pages.test.ts and tests/tiers.test.ts both use it),
          // so an assertion inside one is not a weld.
          const near = lines.slice(Math.max(0, i - 14), i).join('\n');
          if (new RegExp(`\\bif\\s*\\([^)]*${o.name}`).test(near) || new RegExp(`\\b${o.name}\\s*(?:\\?|&&)`).test(code)) continue;
          findings.push(finding({
            severity: 'medium',
            title: `A test pins ${o.name} to its current value: ${relT}:${i + 1}`,
            detail: `This assertion hardcodes the switch's present value outside any branch on the switch, so performing the documented one-line rollback fails the suite. Both \`npm run build\` and scripts/deploy.sh run the tests first, which means the rollback would block the deploy — the escape hatch welded shut. Which position the switch is in is an owner decision that changes day to day; a test should hold down the property (one switch decides every upgrade ask, in either position), not the position.`,
            evidence: `${relT}:${i + 1}: ${lines[i].trim().slice(0, 200)}\nswitch: ${o.file}:${o.line} export const ${o.name} = ${o.valueExpr}`,
            remediation: `Branch on the constant the way tests/tiers.test.ts's "UpgradeButtons demo switch" block does: assert one thing when it is set and another when it is ''.`,
            file: relT,
            line: i + 1,
          }));
        }
      }
    }
    return { findings, checked: overrides.length };
  },
});

export default [upgradeCta, overrideRevertible];
