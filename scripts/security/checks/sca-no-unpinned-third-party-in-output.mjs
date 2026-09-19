/**
 * No off-origin third-party code in the built static sites.
 *
 * This is the part of software composition that SCA structurally cannot see,
 * because it never enters package-lock.json: a Plausible, GA, Hotjar or
 * Cloudflare-CDN snippet pasted into app/layout.tsx and propagated to every one
 * of the ~1,400 exported pages. It is unversioned, unpinned, unauditable code
 * executing on every visit, and `npm audit` has nothing to say about it.
 *
 * On the static sites the CSP does not come from Next at all — next.config.ts's
 * headers() returns [] when isStatic, because there is no server to attach
 * headers to. It comes from Apache (HEADERS-WP.md). So a CSP that drifts out of
 * sync with the HTML is the only thing standing between a pasted snippet and
 * execution, and a CSP living in a .conf file is exactly the sort of thing a
 * guard in this repo has failed to open before.
 *
 * Verified clean at the time of writing: zero off-origin subresources in the
 * built HTML, zero off-origin dynamic imports in the emitted chunks.
 *
 * DELIBERATELY NOT FLAGGED, because each of these would be a false positive
 * that gets the whole check switched off:
 *   - <link rel="canonical"> and rel="alternate". Every exported page carries an
 *     absolute canonical URL; they are metadata, not subresources, and matching
 *     them would produce ~1,400 findings on a clean build.
 *   - <a href>. Editorial copy and the comparison pages link out to real
 *     companies by design, and the 500 scanned sites under data/ are rendered
 *     into the pages as content.
 *   - public/adtest/**. Those files are ad-blocker BAIT — they are ad-shaped on
 *     purpose, with names like adengine.js and admanager.js, so that the tools
 *     can detect whether a blocker ate them. Scanning them for ad-network URLs
 *     would be reading a decoy as a breach.
 *
 * It also carries the one licence assertion worth having (see below).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { prodClosure, readJson, walkFiles } from './sca-lib.mjs';

/** Tags that actually load code or styles. rel values outside this list are metadata. */
const SUBRESOURCE_REL = new Set(['stylesheet', 'preload', 'modulepreload', 'prefetch']);

/** Strong copyleft only. LGPL is excluded on purpose: @img/sharp-libvips is
 *  LGPL-3.0-or-later, it is not redistributed (sharp is an unreachable optional
 *  dependency of next with images.unoptimized set), and flagging it would make
 *  this check fire on every single run forever — which is how a check gets
 *  switched off and takes the real assertions with it. */
const DENIED_LICENCE = /(^|[\s(])A?GPL-\d/i;

function offOrigin(url, origin) {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (!/^https?:\/\//i.test(url)) return null; // relative — same origin by construction
  try {
    const u = new URL(url);
    const o = new URL(origin);
    return u.host === o.host ? null : url;
  } catch {
    return null;
  }
}

export default check({
  id: 'sca-no-unpinned-third-party-in-output',
  discipline: 'sca',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['build-output'],
  describe: 'Third-party JS pasted into the static export never reaches package-lock.json; this reads the built HTML and chunks instead.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const roots = ['out', 'out-pro'].map((d) => join(ctx.repoRoot, d)).filter((d) => existsSync(d));
    if (!roots.length) {
      throw new ctx.Skip('no built output at out/ or out-pro/ — run `npx next build` with BUILD_TARGET=static first');
    }

    const isBait = (p) => p.includes(`${'/'}adtest${'/'}`);
    const html = roots.flatMap((r) => walkFiles(r, (p) => extname(p) === '.html' && !isBait(p)));
    const js = roots.flatMap((r) => walkFiles(r, (p) => extname(p) === '.js' && !isBait(p)));

    if (!html.length) {
      throw new ctx.Skip(`found ${roots.join(', ')} but no .html in it — that is not a completed static export`);
    }

    const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const linkRe = /<link\b[^>]*>/gi;
    const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1] || '';
    const seen = new Map(); // one finding per distinct URL, not per page

    for (const file of html) {
      const src = readFileSync(file, 'utf-8');
      checked += 1;
      const rel = relative(ctx.repoRoot, file);

      for (const m of src.matchAll(scriptRe)) {
        const url = offOrigin(m[1], ctx.origin);
        if (!url) continue;
        const integrity = attr(m[0], 'integrity');
        if (!seen.has(url)) seen.set(url, { url, kind: 'script', integrity, files: [] });
        seen.get(url).files.push(rel);
      }

      for (const m of src.matchAll(linkRe)) {
        const relAttr = attr(m[0], 'rel').toLowerCase().split(/\s+/);
        if (!relAttr.some((r) => SUBRESOURCE_REL.has(r))) continue;
        const url = offOrigin(attr(m[0], 'href'), ctx.origin);
        if (!url) continue;
        const integrity = attr(m[0], 'integrity');
        if (!seen.has(url)) seen.set(url, { url, kind: `link rel=${relAttr.join(' ')}`, integrity, files: [] });
        seen.get(url).files.push(rel);
      }
    }

    for (const hit of seen.values()) {
      findings.push(finding({
        severity: hit.integrity ? 'low' : 'medium',
        title: `Off-origin ${hit.kind} in the static export: ${hit.url.slice(0, 120)}`,
        detail: hit.integrity
          ? 'It carries an integrity hash, so the contents are pinned — but it is still code loaded from a host this project does not control, on every page that references it, and the Apache CSP has to allow it for it to work at all.'
          : 'No integrity attribute, so whatever that host serves on the day executes on the page. It is not in package-lock.json, so nothing in SCA will ever report a vulnerability in it.',
        evidence: `${hit.files.length} page(s), e.g. ${hit.files.slice(0, 3).join(', ')} → ${hit.url}`,
        remediation: 'Install it from npm and let it be bundled, so the lockfile pins it and the audit sees it. If it genuinely has to be remote, add an integrity attribute and make sure the Apache CSP names the host explicitly.',
        file: hit.files[0],
      }));
    }

    // Dynamic imports in the emitted chunks. A bundled snippet can still reach
    // off-origin at runtime, and it would never appear in the HTML.
    const dynRe = /import\s*\(\s*["'](https?:\/\/[^"']+)["']/g;
    const dynSeen = new Set();
    for (const file of js) {
      const src = readFileSync(file, 'utf-8');
      checked += 1;
      for (const m of src.matchAll(dynRe)) {
        const url = offOrigin(m[1], ctx.origin);
        if (!url || dynSeen.has(url)) continue;
        dynSeen.add(url);
        findings.push(finding({
          severity: 'medium',
          title: `Emitted chunk dynamically imports off-origin code: ${url.slice(0, 120)}`,
          detail: 'A runtime import of a remote module. It is invisible in the HTML, absent from the lockfile, and unpinnable by integrity.',
          evidence: `${relative(ctx.repoRoot, file)} contains import("${url}")`,
          remediation: 'Bundle the module from npm instead.',
          file: relative(ctx.repoRoot, file),
        }));
      }
    }

    // The licence guard. Only one outcome would actually matter for a public
    // repo that ships a redistributed client bundle: strong copyleft arriving
    // in the production closure. Read straight from the installed package.json
    // files; no dependency, no service call.
    let lock;
    try {
      lock = readJson(join(ctx.repoRoot, 'package-lock.json'));
    } catch {
      lock = null;
    }
    if (lock) {
      for (const entry of prodClosure(lock).values()) {
        const pj = join(ctx.repoRoot, entry.path, 'package.json');
        if (!existsSync(pj)) continue; // not installed on this machine; not a finding
        checked += 1;
        let licence;
        try {
          const meta = readJson(pj);
          licence = meta.license || (Array.isArray(meta.licenses) ? meta.licenses.map((l) => l.type).join(' OR ') : meta.licenses?.type);
        } catch { continue; }
        if (!licence || typeof licence !== 'string') continue;
        if (!DENIED_LICENCE.test(licence) || /LGPL/i.test(licence)) continue;
        findings.push(finding({
          severity: 'medium',
          title: `Strong-copyleft licence in the production closure: ${entry.name} (${licence})`,
          detail: 'This repo is public and the static sites redistribute the emitted client bundle to every visitor. A GPL/AGPL package in the tree that ships is a licence obligation nobody here has agreed to.',
          evidence: `${entry.path}/package.json declares "license": "${licence}" and the entry is in the --omit=dev closure (dev=${Boolean(entry.dev)}, devOptional=${Boolean(entry.devOptional)}).`,
          remediation: 'Replace it, or confirm in writing that it is not redistributed and move it to devDependencies.',
          file: `${entry.path}/package.json`,
        }));
      }
    }

    return { findings, checked };
  },
});
