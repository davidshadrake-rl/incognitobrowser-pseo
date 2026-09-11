/**
 * Tool engines, review follow-ups to the unclear-UI wave (CTO review,
 * 2026-09-10). Each block pins one reviewer finding:
 *
 *   - The deprecated ConsoleFrame `processing` prop is gone, from the frame
 *     and from every caller.
 *   - A percentage result carries its unit on the result bus, so the share
 *     card no longer draws "72 / 100" for "72% blocked".
 *   - Share lines are plain: no "first-party Ad-Blocker Test", no "checked
 *     with a client-side … detector".
 *   - The quiz's 'A+' is a real grade (no cast, not red), and the quiz has one
 *     share control: the scorecard's link, which keeps the #r= result.
 *   - The screenshot clean copy gets a neutral name, as its copy promises.
 *   - Text encryption's scoring copy quotes the iteration count the code runs.
 *   - Example runs (Link Unwrapper, Email Pixel Detector) never report a result.
 *
 * Pure functions where the engine exports them; otherwise the component
 * source is read, as tests/hash-hmac.test.ts does, because the suite has no DOM.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { severityFromGrade } from '../components/tools/ResultContext';
import { cleanFileName } from '../components/tools/ScreenshotLeakCheckerTool';
import { toToolResult as emailResult } from '../components/tools/EmailPixelDetectorTool';
import { QUIZ_CATEGORY_COUNT, QUIZ_QUESTION_COUNT } from '../components/tools/PrivacyQuizTool';
import { PBKDF2_ITERATIONS } from '../components/tools/TextEncryptionTool';
import { analyzeEmail, EXAMPLE_EMAIL } from '../lib/email-pixel';
import { shareLinkFor } from '../lib/scorecard';

const ROOT = path.join(__dirname, '..');
/** Source with comments stripped: several comments quote the old copy by name. */
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const TOOL_DIR = 'components/tools';
const toolFiles = fs.readdirSync(path.join(ROOT, TOOL_DIR)).filter((f) => f.endsWith('.tsx'));

describe('ConsoleFrame processing prop', () => {
  it('is no longer declared', () => {
    expect(code(`${TOOL_DIR}/ConsoleFrame.tsx`)).not.toMatch(/\bprocessing\??:/);
  });

  it('no tool passes it', () => {
    for (const f of toolFiles) expect(code(`${TOOL_DIR}/${f}`), f).not.toMatch(/\bprocessing=["{]/);
  });
});

describe('Ad-Blocker Test unit', () => {
  const src = code(`${TOOL_DIR}/AdBlockerTestTool.tsx`);
  it('reports its score as a percentage on the result bus and in the console', () => {
    expect(src).toMatch(/scoreUnit: '%'/);
    expect(src).toMatch(/scoreUnit="%"/);
  });
});

describe('plain share lines', () => {
  it('no share line describes the tool in jargon', () => {
    for (const f of toolFiles) {
      for (const line of code(`${TOOL_DIR}/${f}`).split('\n').filter((l) => /shareText:/.test(l))) {
        expect(line, f).not.toMatch(/first-party|client-side|checked with/i);
      }
    }
  });

  it('the email detector shares its headline and an invitation, nothing else', () => {
    const r = emailResult(analyzeEmail(EXAMPLE_EMAIL));
    expect(r.shareText).toBe(`${r.headline}. Check yours:`);
  });
});

describe('Privacy Score Quiz', () => {
  it("'A+' is green, like 'A' (it fell through to red)", () => {
    expect(severityFromGrade('A+')).toBe('green');
  });

  it('reports its grade without a type cast', () => {
    expect(code(`${TOOL_DIR}/PrivacyQuizTool.tsx`)).not.toMatch(/as ToolResult\[/);
  });

  it('has one share control: the scorecard link, which keeps the #r= result', () => {
    expect(code(`${TOOL_DIR}/PrivacyQuizTool.tsx`)).not.toMatch(/Copy shareable link|clipboard/);
    // 12 answers, base-36 digits 0-9 and 'a' for a 10.
    expect(shareLinkFor('https://incognitobrowser.io/tools/data-brokers/digital-privacy-score#r=a9876543210a'))
      .toMatch(/#r=a9876543210a$/);
  });

  it('the tool page quotes the counts the quiz has', () => {
    expect(QUIZ_QUESTION_COUNT).toBe(12);
    expect(QUIZ_CATEGORY_COUNT).toBe(6);
    const registry = code(`${TOOL_DIR}/registry.tsx`);
    expect(registry).not.toMatch(/five categories/);
    expect(registry).toMatch(/Points summed across \$\{QUIZ_CATEGORY_COUNT\} categories/);
  });
});

describe('Screenshot Leak Checker clean copy', () => {
  it('is saved under a neutral name, so "the original file name is left behind" is true', () => {
    expect(cleanFileName('png')).toBe('screenshot-clean.png');
    expect(cleanFileName('jpeg')).toBe('screenshot-clean.jpg');
    expect(cleanFileName('webp')).toBe('screenshot-clean.jpg'); // re-encoded as JPEG
    const src = code(`${TOOL_DIR}/ScreenshotLeakCheckerTool.tsx`);
    expect(src).toMatch(/const name = cleanFileName\(analysis\.format\);/);
    expect(src).not.toMatch(/file\.name\.replace/);
  });
});

describe('Text Encryption iterations', () => {
  it('the scoring copy reads the count from the tool', () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const registry = code(`${TOOL_DIR}/registry.tsx`);
    expect(registry).toMatch(/import \{ TextEncryptionTool, PBKDF2_ITERATIONS \} from '\.\/TextEncryptionTool';/);
    expect(registry).not.toMatch(/600,000|100,000/);
  });

  it('shows no Iterations result tile (a setting read like a result)', () => {
    expect(code(`${TOOL_DIR}/TextEncryptionTool.tsx`)).not.toMatch(/label: 'Iterations'/);
  });
});

describe('example runs are not the visitor\'s result', () => {
  it('Link Unwrapper: "Try an example" is flagged by the exact example URL and reports nothing', () => {
    const src = code(`${TOOL_DIR}/LinkUnwrapperTool.tsx`);
    expect(src).toMatch(/setFromExample\(EXAMPLES\.some\(\(ex\) => ex\.url === trimmed\)\)/);
    expect(src).toMatch(/report\(result && result\.ok && !fromExample \? toToolResult\(result\) : null\)/);
  });

  it('Email Pixel Detector: "Load example" is flagged by the exact example email and reports nothing', () => {
    const src = code(`${TOOL_DIR}/EmailPixelDetectorTool.tsx`);
    expect(src).toMatch(/run\(EXAMPLE_EMAIL\)/);
    expect(src).toMatch(/setFromExample\(source === EXAMPLE_EMAIL\)/);
    expect(src).toMatch(/report\(analysis && !fromExample \? toToolResult\(analysis\) : null\)/);
  });
});
