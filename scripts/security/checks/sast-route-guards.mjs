/**
 * Three source-level assertions about the API routes and the one filesystem
 * read behind the static pages. They share a file because they share the
 * parsing, not because they are the same idea.
 *
 *   sast-route-guard-order    — every abuse gate runs BEFORE any work
 *   sast-request-body-bound   — every body-buffering handler bounds the body first
 *   sast-fs-path-from-params  — a route param cannot reach a filesystem path
 *
 * The common thread is that all three defences are held in place by nothing but
 * the order of plain `if` statements in a function, and nothing in the 3,020
 * existing tests pins any of it. tests/api-security.test.ts:246-290 is
 * presence-only — the case titled "checks origin before issuing a challenge"
 * asserts only that the string appears in the file, not that it appears first.
 * tests/hardening.test.ts pins clearTimeout ordering and stops there. So a
 * refactor that hoists `await request.json()` above the origin gate, or drops
 * the `dynamicParams = false` line from a new pSEO category, breaks a real
 * defence and no test goes red.
 */
import { readFileSync } from 'node:fs';
import { check, finding } from '../lib/harness.mjs';
import { walk, read, stripComments, lineAt, lineText } from './sast-lib.mjs';

const routesData = () => JSON.parse(readFileSync(new URL('../data/sast-routes.json', import.meta.url), 'utf-8'));

/**
 * The POST handler's byte range. Offsets are compared only within this window,
 * because `isOriginAllowed` also appears in the OPTIONS handler above it and a
 * whole-file comparison would happily accept a POST with no gate at all.
 */
function postHandler(stripped) {
  const start = stripped.search(/export\s+async\s+function\s+POST\s*\(/);
  if (start === -1) return null;
  const after = stripped.slice(start + 10);
  const nextExport = after.search(/\nexport\s/);
  const end = nextExport === -1 ? stripped.length : start + 10 + nextExport;
  return { start, end, body: stripped.slice(start, end) };
}

/** First offset of `re` inside the handler, as an absolute file offset, or Infinity. */
function firstAt(handler, re) {
  re.lastIndex = 0;
  const m = re.exec(handler.body);
  return m ? handler.start + m.index : Infinity;
}

const GATE_PATTERNS = {
  origin: /isOriginAllowed\s*\(/,
  rateLimit: /await\s+rateLimit\s*\(/,
  pow: /verifySolution\s*\(/,
  // The single-use claim: SET NX on the proof-of-work signature. This is the
  // one that was found FAILING OPEN today — the replay check has to be both
  // present and above the work, or a solved challenge is reusable.
  powReplay: /['"`]?pow:|redis\.set\s*\(/,
};

const WORK_PATTERNS = {
  // Two ways to read a body: the Web API directly, or lib/request-body.ts's
  // capped reader. The second is the ONLY sanctioned one since 2026-09-22 —
  // the direct calls buffer without limit, and a chunked request skips the
  // Content-Length pre-check this file used to insist on, so that pattern was
  // the bug. Both are matched here so a route reading either way counts as
  // "buffers a body"; which one it used decides what is asserted next.
  'the request body is read': /await\s+(?:request\s*\.\s*(?:json|text|formData|arrayBuffer|blob)|readCappedRequestText)\s*\(/,
  'the request body is read unbounded': /await\s+request\s*\.\s*(?:json|text|formData|arrayBuffer|blob)\s*\(/,
  'an outbound fetch is made': /(^|[^.\w$])fetch\s*\(/,
};

function loadRoutes(root) {
  const onDisk = walk(root, 'app', ['.ts']).filter((f) => f.endsWith('/route.ts'));
  const expected = routesData().routes;
  return { onDisk, expected };
}

// ───────────────────────────────────────────────────────────────────────────

const guardOrder = check({
  id: 'sast-route-guard-order',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Asserts the origin gate, the rate limit and (on /scan-url) the proof-of-work and its single-use claim all run before the handler reads a body or makes an outbound fetch.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const { onDisk, expected } = loadRoutes(root);
    const findings = [];
    let checked = 0;

    // A route file nobody wrote down. This is the case that matters most: the
    // check cannot assert gates on a route it does not know the shape of, so
    // rather than guessing it demands that a person name it.
    for (const rel of onDisk) {
      if (!expected.some((r) => r.path === rel)) {
        checked++;
        findings.push(finding({
          severity: 'high',
          title: `New API route not declared: ${rel}`,
          detail: 'Every route handler in this app is an unauthenticated public endpoint on a box that also serves the team\'s WordPress. A new one has to be written down with the gates it is expected to run, or nothing is checking it at all.',
          evidence: `${rel} exists on disk; scripts/security/data/sast-routes.json names ${expected.length} routes and not this one.`,
          remediation: 'Add an entry to scripts/security/data/sast-routes.json with its endpoint, its `gates` and whether it buffers a body.',
          file: rel,
        }));
      }
    }
    for (const r of expected) {
      if (!onDisk.includes(r.path)) {
        checked++;
        findings.push(finding({
          severity: 'low',
          title: `Declared route is gone: ${r.path}`,
          detail: 'The expectation file names a route that no longer exists, so it is asserting nothing. An expectation list that nobody prunes stops being an expectation.',
          evidence: `scripts/security/data/sast-routes.json declares ${r.endpoint} at ${r.path}; no such file under app/.`,
          remediation: 'Remove the entry, or point it at the route\'s new path.',
          file: 'scripts/security/data/sast-routes.json',
        }));
      }
    }

    for (const r of expected) {
      if (!onDisk.includes(r.path)) continue;
      const src = read(root, r.path);
      const stripped = stripComments(src);
      const handler = postHandler(stripped);
      if (!handler) {
        checked++;
        findings.push(finding({
          severity: 'medium',
          title: `No POST handler found in ${r.path}`,
          detail: 'The check parses the POST handler to compare offsets inside it. No handler means either the route changed method — in which case the expectations are wrong — or the parse broke, and either way nothing was verified here.',
          evidence: `${r.path}: no \`export async function POST(\` after comment stripping.`,
          remediation: 'Update scripts/security/data/sast-routes.json, or fix the handler.',
          file: r.path,
        }));
        continue;
      }

      // Where the handler first does something an attacker gets value from.
      const workAt = [];
      for (const [label, re] of Object.entries(WORK_PATTERNS)) {
        const at = firstAt(handler, new RegExp(re.source, 'g'));
        if (at !== Infinity) workAt.push({ label, at });
      }

      for (const gate of r.gates) {
        checked++;
        const at = firstAt(handler, new RegExp(GATE_PATTERNS[gate].source, 'g'));
        if (at === Infinity) {
          findings.push(finding({
            severity: 'high',
            title: `${r.endpoint} has lost its ${gate} gate`,
            detail: `${r.note}`,
            evidence: `${r.path}: /${GATE_PATTERNS[gate].source}/ does not appear anywhere in the POST handler (lines ${lineAt(src, handler.start)}-${lineAt(src, handler.end)}).`,
            remediation: 'Restore the gate, or — if it was removed on purpose — change the `gates` list in scripts/security/data/sast-routes.json and say why in its `note`.',
            file: r.path,
            line: lineAt(src, handler.start),
          }));
          continue;
        }
        for (const w of workAt) {
          if (at > w.at) {
            findings.push(finding({
              severity: 'high',
              title: `${r.endpoint}: the ${gate} gate runs AFTER ${w.label}`,
              detail: `${r.note} An attacker who never satisfies the gate still pays for everything above it.`,
              evidence: `${r.path}: ${w.label} at line ${lineAt(src, w.at)} (\`${lineText(src, w.at).slice(0, 90)}\`), but the ${gate} gate is not until line ${lineAt(src, at)} (\`${lineText(src, at).slice(0, 90)}\`).`,
              remediation: `Move the ${gate} gate back above line ${lineAt(src, w.at)}.`,
              file: r.path,
              line: lineAt(src, at),
            }));
          }
        }
      }

      // A dropped `await` on rateLimit leaves `rl` a Promise, so `!rl.allowed`
      // is truthy and the route returns 429 to everyone — it fails closed and
      // loudly, which is why this is one assertion here rather than its own
      // check. Still worth pinning: it is a one-character edit.
      const bare = /(^|[^.\w$])rateLimit\s*\(/g;
      let m;
      while ((m = bare.exec(handler.body))) {
        const at = handler.start + m.index + (m[1] ? m[1].length : 0);
        const before = stripped.slice(Math.max(0, at - 12), at);
        if (!/await\s+$/.test(before)) {
          checked++;
          findings.push(finding({
            severity: 'medium',
            title: `${r.endpoint}: rateLimit() called without await`,
            detail: 'rateLimit returns a Promise. Without await, `rl.allowed` is undefined, the handler answers 429 to every caller and the endpoint is dead rather than merely ungated.',
            evidence: `${r.path}:${lineAt(src, at)}  ${lineText(src, at).slice(0, 140)}`,
            remediation: 'Add the await.',
            file: r.path,
            line: lineAt(src, at),
          }));
        }
      }
    }

    return { findings, checked };
  },
});

// ───────────────────────────────────────────────────────────────────────────

const bodyBound = check({
  id: 'sast-request-body-bound',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Asserts every route handler that buffers a request body checks content-length against a numeric cap first, and re-checks the length after reading.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const { onDisk, expected } = loadRoutes(root);
    const findings = [];
    let checked = 0;

    for (const rel of onDisk) {
      const decl = expected.find((r) => r.path === rel);
      const src = read(root, rel);
      const stripped = stripComments(src);
      const handler = postHandler(stripped);
      if (!handler) continue;

      const readAt = firstAt(handler, new RegExp(WORK_PATTERNS['the request body is read'].source, 'g'));
      const buffers = readAt !== Infinity;
      checked++;

      // A route whose declaration and behaviour disagree: either the
      // expectation is stale or a body read was just added without a bound.
      if (decl && decl.bodyCap !== buffers) {
        findings.push(finding({
          severity: 'low',
          title: `${decl.endpoint}: bodyCap declaration is out of date`,
          detail: 'The expectation file says this handler does (or does not) buffer a body, and the source now disagrees. Either way the declaration is no longer describing the code.',
          evidence: `scripts/security/data/sast-routes.json says bodyCap=${decl.bodyCap}; ${rel} ${buffers ? `reads a body at line ${lineAt(src, readAt)}` : 'reads no body'}.`,
          remediation: 'Update the entry.',
          file: 'scripts/security/data/sast-routes.json',
        }));
      }
      if (!buffers) continue;

      // Read through the capped helper: the bound lives inside
      // readCappedRequestText, which stops pulling at the cap and cancels the
      // stream, so the two assertions below (Content-Length before, .length
      // after) do not apply — they describe the OLD pattern, which was
      // unbounded on a chunked request. What must hold instead is that the
      // handler does not ALSO read the body the unbounded way somewhere else.
      const rawReadAt = firstAt(handler, new RegExp(WORK_PATTERNS['the request body is read unbounded'].source, 'g'));
      const viaCappedHelper = rawReadAt !== readAt;
      if (viaCappedHelper) {
        if (rawReadAt !== Infinity) {
          findings.push(finding({
            severity: 'medium',
            title: `${decl ? decl.endpoint : rel} reads the body through the capped helper AND directly`,
            detail: 'The capped read bounds what it reads; the direct call next to it does not. Whichever runs second either fails (body already consumed) or, if it runs first, buffers without limit — a chunked request carries no Content-Length and request.text() has no cap.',
            evidence: `${rel}:${lineAt(src, rawReadAt)}  ${lineText(src, rawReadAt).slice(0, 120)}`,
            remediation: 'Remove the direct request.text()/json() call; readCappedRequestText is the only sanctioned body read (lib/request-body.ts).',
            file: rel,
            line: lineAt(src, rawReadAt),
          }));
        }
        continue;
      }

      // Direct, unbounded read. This is no longer an acceptable shape at all —
      // tests/request-body-cap.test.ts bans it on every route — so the two
      // assertions below are a floor for a route that slipped past that, not
      // a sanctioned pattern.
      // The declared-length check has to come BEFORE the read, and has to
      // compare against a number rather than merely mention the header.
      //
      // Searched with string literals INTACT (comments still stripped), because
      // the thing being looked for is the literal 'content-length' handed to
      // headers.get(). The first version of this ran against fully stripped
      // source and reported all four already-bounded routes as unbounded —
      // four false positives on day one, which is exactly the outcome that gets
      // a check switched off. Comments have to go, though: every one of these
      // four routes explains the check in prose directly above it.
      const withStrings = stripComments(src, { strings: false });
      const clRe = /content-length['"`]?\s*\)?\s*\)?[\s\S]{0,260}?>\s*(?:[A-Za-z_$][\w$]*|\d)/gi;
      const clAt = firstAt({ start: handler.start, body: withStrings.slice(handler.start, handler.end) }, clRe);
      // And the post-read check, because Content-Length can lie and a chunked
      // request omits it entirely.
      const postRe = /\.length\s*>\s*[A-Za-z_$][\w$]*|\.length\s*>\s*\d/g;
      const postAt = firstAt(handler, postRe);

      if (clAt === Infinity || clAt > readAt) {
        findings.push(finding({
          severity: 'medium',
          title: `${decl ? decl.endpoint : rel} buffers a request body with no declared-length check first`,
          detail: 'The only bound outside the handler is the Apache `<If "%{HTTP:Content-Length} -gt 1048576">` rule (API-ON-DROPLET.md:180), which matches on a header a chunked-transfer request simply omits. The runbook records that LimitRequestBody and RewriteRule are both inert behind ProxyPass, so that one directive is the entire perimeter — and it is not in this process.',
          evidence: `${rel}:${lineAt(src, readAt)}  ${lineText(src, readAt).slice(0, 120)}  — ${clAt === Infinity ? 'no content-length comparison against a numeric cap found in the handler' : `the content-length check is at line ${lineAt(src, clAt)}, after the read`}.`,
          remediation: 'Do not add a Content-Length check — that was the pattern that failed. Read through readCappedRequestText (lib/request-body.ts), which stops pulling at the cap; every route does since 2026-09-22.',
          file: rel,
          line: lineAt(src, readAt),
        }));
      }
      if (postAt === Infinity || postAt < readAt) {
        findings.push(finding({
          severity: 'medium',
          title: `${decl ? decl.endpoint : rel} does not re-check the body length after reading it`,
          detail: 'Content-Length is a claim the client makes. A chunked request carries none, and a lying one is trivial, so the check that actually binds is the one on the string that came back.',
          evidence: `${rel}:${lineAt(src, readAt)}  ${lineText(src, readAt).slice(0, 120)}  — ${postAt === Infinity ? 'no `.length > cap` comparison found after the read' : `the only length comparison is at line ${lineAt(src, postAt)}, before the read`}.`,
          remediation: 'A post-read length check binds what is ACCEPTED, not what is ALLOCATED — the body is already resident when it runs. Read through readCappedRequestText (lib/request-body.ts) instead.',
          file: rel,
          line: lineAt(src, readAt),
        }));
      }
    }

    return { findings, checked };
  },
});

// ───────────────────────────────────────────────────────────────────────────

const fsPath = check({
  id: 'sast-fs-path-from-params',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Asserts every dynamic page route pre-renders a fixed set of params, and that lib/content.ts validates each segment before joining it onto DATA_DIR.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const findings = [];
    let checked = 0;

    // (a) Every dynamic page route must pre-render a fixed set of params.
    // 16/16 pass today, so this is a pure regression guard — and the thing it
    // guards against is routine here: this repo adds pSEO categories, and a new
    // app/<category>/[niche]/[slug]/page.tsx that forgets the line hands an
    // arbitrary slug straight to the path.join in lib/content.ts in the server
    // build. Files under app/api or route.ts are not page routes and are skipped.
    const pages = walk(root, 'app', ['.tsx'])
      .filter((f) => f.endsWith('/page.tsx') && /\[[^\]]+\]/.test(f));
    for (const rel of pages) {
      checked++;
      const stripped = stripComments(read(root, rel));
      if (!/export\s+const\s+dynamicParams\s*=\s*false/.test(stripped)) {
        findings.push(finding({
          severity: 'medium',
          title: `Dynamic route without dynamicParams = false: ${rel}`,
          detail: 'Without it, Next will render this route on demand for any param value a visitor invents, in the server build. Those params flow into getContentItem/getGlossaryItem, which join them onto DATA_DIR. The segment guard in lib/content.ts is what stands behind that, and defence in depth means not relying on one of the two.',
          evidence: `${rel}: no \`export const dynamicParams = false\` (the other ${pages.length - 1} dynamic page routes all have it).`,
          remediation: 'Add `export const dynamicParams = false;` beside generateStaticParams.',
          file: rel,
        }));
      }
    }

    // (b) lib/content.ts validates segments before joining. Asserted as
    // "every path.join(DATA_DIR, ...) with a non-literal segment is preceded in
    // the same function by a safeSegments() call" rather than by grepping for
    // the regex, so renaming SAFE_SEGMENT does not silently pass.
    const rel = 'lib/content.ts';
    const src = read(root, rel);
    const stripped = stripComments(src);
    if (!/const\s+SAFE_SEGMENT\s*=/.test(stripped) || !/function\s+safeSegments\s*\(/.test(stripped)) {
      checked++;
      findings.push(finding({
        severity: 'high',
        title: 'lib/content.ts has lost its path-segment validator',
        detail: 'getContentItem does `path.join(DATA_DIR, contentType, ...pathParts) + \'.json\'` and then readFileSync. path.join normalises `..` as it goes, so a segment of `../../..` walks out of DATA_DIR with only the .json suffix left in the way.',
        evidence: `${rel}: SAFE_SEGMENT and/or safeSegments() not found.`,
        remediation: 'Restore the slug-shape guard and call it from every function that joins caller segments onto DATA_DIR.',
        file: rel,
      }));
    } else {
      // Every function that joins onto DATA_DIR with a variable segment must
      // call safeSegments before the join.
      const fnRe = /export\s+function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g;
      const bounds = [];
      let m;
      while ((m = fnRe.exec(stripped))) bounds.push({ name: m[1], at: m.index });
      bounds.push({ name: '(eof)', at: stripped.length });
      const joinRe = /path\.join\s*\(\s*DATA_DIR\s*,([^)]*)\)/g;
      while ((m = joinRe.exec(stripped))) {
        const args = m[1];
        // A join whose every extra segment is a string literal cannot traverse.
        const literalOnly = args.split(',').every((a) => a.trim() === '' || /^(['"`]).*\1$/.test(a.trim()));
        if (literalOnly) continue;
        checked++;
        const fn = bounds.filter((b) => b.at <= m.index).pop();
        const next = bounds.find((b) => b.at > m.index) || { at: stripped.length };
        const region = stripped.slice(fn ? fn.at : 0, next.at);
        const guardAt = region.indexOf('safeSegments(');
        const joinInRegion = m.index - (fn ? fn.at : 0);
        if (guardAt === -1 || guardAt > joinInRegion) {
          findings.push(finding({
            severity: 'high',
            title: `${fn ? fn.name : '(top level)'}() joins a caller segment onto DATA_DIR without validating it first`,
            detail: 'path.join normalises `..` as it goes, so an unvalidated segment walks straight out of the content tree and the only thing left between the caller and an arbitrary file read is the .json suffix.',
            evidence: `${rel}:${lineAt(src, m.index)}  ${lineText(src, m.index).slice(0, 140)}  — ${guardAt === -1 ? 'no safeSegments() call in this function' : 'safeSegments() appears only after the join'}.`,
            remediation: 'Call safeSegments() on every caller-supplied segment before the join, and return the same "not found" value when it fails.',
            file: rel,
            line: lineAt(src, m.index),
          }));
        }
      }
    }

    return { findings, checked };
  },
});

export default [guardOrder, bodyBound, fsPath];
