/**
 * The one function in this repo that reaches a native file write has exactly
 * one caller, and we know which.
 *
 * saveImageInApp (lib/in-app.ts:257) hands the app a base64 payload, a
 * filename and a MIME type. On the other side of that bridge the app decodes
 * it and writes it into MediaStore — the user's Pictures or Downloads
 * (IN-APP-BRIDGE.md §3). Nothing else in this codebase crosses from web into
 * the device's storage.
 *
 * Today the only caller is components/Scorecard.tsx, which passes a canvas the
 * page drew itself at a fixed size, with a filename derived from the tool
 * title. Because of that, every bound worth checking is already structural:
 * a size cap could not fail, a MIME check could not fail, a filename
 * sanitiser would have nothing to sanitise. That is a property of the CALL
 * SITE, not of the function, and it stops being true the moment a second
 * caller appears — wire it to a blob the visitor supplied (an uploaded photo
 * in the metadata tool, a fetched image, a data: URL from a scanned page) and
 * the size, the type and the filename all become attacker-influenced inputs
 * to a native write, with no validation anywhere on the web side.
 *
 * So the check is not "are the arguments safe". It is the allowlist: one
 * caller, named, and a new one has to be added deliberately. That is the same
 * mechanic as mast-pro-flag-grants-no-access, applied to the one surface here
 * that reaches the device.
 *
 * DELIBERATELY NOT FLAGGED: lib/in-app.ts itself (the definition, and the doc
 * comments that name it) and tests/ (tests/in-app.test.ts calls it against a
 * fake bridge, which is how the bridge contract is verified at all).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

const SOURCE_DIRS = ['app', 'components', 'lib'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const DEFINITION = 'lib/in-app.ts';

/** Prose about saveImageInApp is not a call to it; lib/in-app.ts is mostly prose about it. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'out') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export default check({
  id: 'mast-save-image-caller-allowlist',
  discipline: 'mast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'saveImageInApp — the only path from this codebase to a native MediaStore write — is called from the one component we have reviewed for it.',
  async run(ctx) {
    const dirs = SOURCE_DIRS.filter((d) => existsSync(join(ctx.repoRoot, d)));
    if (!dirs.length) throw new Skip(`none of ${SOURCE_DIRS.join(', ')} exist — nothing to walk`);

    const defPath = join(ctx.repoRoot, DEFINITION);
    if (!existsSync(defPath)) throw new Skip(`${DEFINITION} does not exist — the function this check tracks callers of is gone`);
    if (!/export\s+async\s+function\s+saveImageInApp/.test(readFileSync(defPath, 'utf-8'))) {
      // Renamed, inlined, or removed. Either way the allowlist below is now
      // guarding a name nothing uses, and reporting "no unexpected callers"
      // would be exactly the reassuring green this suite exists to stop.
      throw new Skip(`${DEFINITION} no longer exports saveImageInApp — this check would grade a name that does not exist`);
    }

    const allow = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts', 'security', 'data', 'mast-in-app-consumers.json'), 'utf-8'));
    const allowed = new Map((allow.saveImageCallers || []).map((e) => [e.path, e]));
    if (!allowed.size) throw new Skip('mast-in-app-consumers.json lists no saveImageCallers — an empty allowlist would make the real caller a finding');

    const files = dirs.flatMap((d) => walk(join(ctx.repoRoot, d))).filter((f) => SOURCE_EXT.test(f));
    const findings = [];
    let checked = 0;
    const callers = [];

    for (const abs of files) {
      const rel = relative(ctx.repoRoot, abs).split(sep).join('/');
      checked++;
      if (rel === DEFINITION) continue;
      const code = stripComments(readFileSync(abs, 'utf-8'));
      const m = /\bsaveImageInApp\s*\(/.exec(code);
      if (!m) continue;
      callers.push(rel);
      if (allowed.has(rel)) continue;
      const line = code.slice(0, m.index).split('\n').length;
      findings.push(finding({
        severity: 'medium', file: rel, line,
        title: `${rel} calls saveImageInApp and is not on the allowlist`,
        detail: 'saveImageInApp is the only path from this codebase to a native file write: the app decodes the base64 and saves it to MediaStore under the filename and MIME type the page chose. The existing caller is safe because of what it passes — a canvas the page drew at a fixed size — not because the function checks anything. A caller passing a visitor-supplied blob, an uploaded photo or a fetched image makes the size, the type and the filename attacker-influenced inputs to a write on the user\'s device.',
        evidence: `${rel}:${line}: ${code.split('\n')[line - 1].trim().slice(0, 160)}; allowlist: ${[...allowed.keys()].join(', ')}`,
        remediation: 'Before adding it to scripts/security/data/mast-in-app-consumers.json, say where the bytes, the filename and the MIME type come from. If any of them can be influenced by the visitor, bound them in saveImageInApp itself — the app team should be told too, because the native side treats this message as untrusted input by contract (IN-APP-BRIDGE.md §2).',
      }));
    }

    for (const [path, entry] of allowed) {
      checked++;
      if (!callers.includes(path)) {
        findings.push(finding({
          severity: 'info', file: path,
          title: `The saveImageInApp allowlist still names ${path}, which no longer calls it`,
          detail: 'A stale entry costs nothing today and quietly pre-approves the next thing that lands at that path. It also means the only reviewed caller has gone, so nobody is exercising the bridge write any more.',
          evidence: `scripts/security/data/mast-in-app-consumers.json lists ${path} (${entry.reason.slice(0, 80)}…); no saveImageInApp( call found there`,
          remediation: 'Remove the entry, or work out where the scorecard save went.',
        }));
      }
    }

    return { findings, checked };
  },
});
