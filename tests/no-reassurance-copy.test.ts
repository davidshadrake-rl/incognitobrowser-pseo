/**
 * Reassurance-copy guard (CTO review, 2026-09-10). Source-level, no build
 * needed, same pattern as tests/design-guards.test.ts.
 *
 * The review asked for every slogan about what the site does NOT do to go:
 * "No account, no upload", "runs entirely in your browser", "never logged",
 * the "local only" console tag and the like. They were removed from the UI,
 * the tool data and the generator that writes the tool data. This fails if
 * one comes back anywhere under app/, components/, lib/ or data/tools/, or
 * in the generator that writes data/tools.
 *
 * Copy that TELLS the visitor what will happen when they press something
 * (the cookie scanner's "the target site will see a request from our
 * server") is not a slogan and is not matched here. Methodology prose where
 * the phrase is the subject stays too — add it to ALLOW with its file, the
 * phrase and a fragment of the kept sentence, never by file alone, so the
 * slogan still fails everywhere else in that file.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'components', 'lib', 'data/tools'];
/** Single files outside DIRS: the generator's copy becomes data/tools on its next run. */
const FILES = ['scripts/generate-tool-data.ts'];
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.json'];

/** [label, pattern]: case-insensitive, with the obvious spelling variants. */
const SLOGANS: Array<[string, RegExp]> = [
  ['no account', /\bno accounts?\b/i],
  ['no signup', /\bno sign[- ]?ups?\b/i],
  ['no upload', /\bno uploads?\b/i],
  ['nothing is uploaded', /\bnothing (?:is|was|gets) uploaded\b/i],
  ['never leaves your device', /\bnever leaves your device\b/i],
  // "never logged" / "never logs the URLs you scan", not the imperative
  // "Never log the body" in the API routes' developer comments.
  ['never logged', /\bnever log(?:ged|s)\b/i],
  ['100% client-side', /100% client[- ]side/i],
  ['runs entirely in your browser', /\bruns? entirely in your browser\b/i],
  // The old processing chip's own label. Methodology prose that puts words
  // between them ("runs a series of checks directly in your browser") is kept.
  ['runs in your browser', /\bruns? in your browser\b/i],
  ['local only', /\blocal[- ]only\b/i],
  ['nothing is sent', /\bnothing is sent\b/i],
  ['no data leaves', /\bno data (?:leaves|is transmitted)\b/i],
  ['never transmitted', /\bnever transmitted\b/i],
  ['your IP stays private', /\byour IP stays private\b/i],
];

/**
 * The sweep's "keep" items that a pattern above matches. Each entry allows
 * one phrase on lines of one file that also contain `context`.
 */
const ALLOW: Array<{ file: string; phrase: string; context: string; why: string }> = [
  {
    file: 'components/tools/ScreenshotLeakCheckerTool.tsx',
    phrase: 'no upload',
    context: 'never leaves the device: no upload',
    why: 'Module doc comment describing the parser, never rendered.',
  },
  {
    file: 'lib/altcha.ts',
    phrase: 'no signup',
    context: 'without an auth wall',
    why: 'Code comment explaining why the scan endpoint needs proof-of-work, never rendered.',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(rel, out);
    } else if (EXTS.some((e) => entry.name.endsWith(e))) {
      out.push(rel);
    }
  }
  return out;
}

function allowed(file: string, phrase: string, line: string): boolean {
  const lower = line.toLowerCase();
  return ALLOW.some((a) => a.file === file && a.phrase === phrase && lower.includes(a.context.toLowerCase()));
}

function guardedFiles(): string[] {
  return [...DIRS.flatMap((d) => walk(d)), ...FILES.filter((f) => fs.existsSync(path.join(ROOT, f)))];
}

/** Every slogan hit in the guarded tree, as "file:line: [phrase] text". */
function offenders(): string[] {
  const found: string[] = [];
  for (const file of guardedFiles()) {
    fs.readFileSync(path.join(ROOT, file), 'utf-8').split('\n').forEach((line, i) => {
      for (const [phrase, re] of SLOGANS) {
        if (re.test(line) && !allowed(file, phrase, line)) {
          found.push(`${file}:${i + 1}: [${phrase}] ${line.trim().slice(0, 120)}`);
        }
      }
    });
  }
  return found;
}

describe('no reassurance slogans in site copy', () => {
  it('scans a realistic tree (app, components, lib, every tool data file and its generator)', () => {
    const files = guardedFiles();
    expect(files.filter((f) => f.startsWith('data/tools/')).length).toBeGreaterThanOrEqual(40);
    expect(files.filter((f) => f.startsWith('components/')).length).toBeGreaterThan(40);
    expect(files).toContain('scripts/generate-tool-data.ts');
  });

  it('finds none of the removed slogans outside the allow-list', () => {
    expect(offenders()).toEqual([]);
  });

  it('the patterns catch the strings the review quoted', () => {
    const quoted = [
      'No account, no upload.',
      'No signup.',
      'Free, no account, stays free.',
      'Asks our server once. Never logged.',
      'Drawn on your device. Nothing is uploaded.',
      'The file never leaves your device.',
      '100% client-side, nothing logged.',
      'Runs entirely in your browser.',
      'Runs in your browser.',
      'via our server · local only',
      'Nothing is sent to our servers.',
      'No data leaves your device.',
      'No data is transmitted.',
      'Your password is never transmitted.',
      'Your IP stays private.',
    ];
    for (const s of quoted) expect(SLOGANS.some(([, re]) => re.test(s)), s).toBe(true);
  });

  it('the patterns leave functional disclosures and methodology prose alone', () => {
    const kept = [
      'The target site will see a request from our server, not your browser.',
      'No consent banner is clicked; no cookies are sent.',
      'We never store or display cookie values — only names and attributes.',
      'Nothing is fetched: the images and links are only read as text.',
      'This tool runs a series of privacy checks directly in your browser.',
      'Verify the account settings before you upload a photo.',
      '// Never log the body — it is keyed to the visitor\'s IP.',
    ];
    for (const s of kept) expect(SLOGANS.some(([, re]) => re.test(s)), s).toBe(false);
  });

  it('allow-list entries are scoped to one sentence, not a whole file', () => {
    for (const a of ALLOW) {
      expect(a.context.length, `${a.file}: context must be a real fragment`).toBeGreaterThanOrEqual(10);
      expect(SLOGANS.some(([label]) => label === a.phrase), `${a.file}: unknown phrase "${a.phrase}"`).toBe(true);
    }
  });

  it('every allow-list entry still matches a line (a stale entry would excuse a future slogan)', () => {
    for (const a of ALLOW) {
      const re = SLOGANS.find(([label]) => label === a.phrase)![1];
      const abs = path.join(ROOT, a.file);
      const lines = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8').split('\n') : [];
      expect(lines.some((l) => re.test(l) && l.toLowerCase().includes(a.context.toLowerCase())), `${a.file}: "${a.phrase}" / "${a.context}" is no longer in the file; drop the entry`).toBe(true);
    }
  });
});
