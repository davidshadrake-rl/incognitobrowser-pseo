/**
 * lib/proof-route — every content page must route to a real, listed free tool,
 * or show no card when no free tool fits its topic.
 *
 * Content pages exist only on the FREE deployment, so this suite pins the
 * tier explicitly: `npm run build` also runs vitest, and under
 * NEXT_PUBLIC_TIER=pro the module graph would otherwise resolve Pro engines.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getAllNiches } from '../lib/taxonomy';
import fs from 'node:fs';
import path from 'node:path';
import type { ProofRoute, ProofCopy } from '../lib/proof-route';

const PRO_ENGINES = ['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer'];
let proofToolFor: (niche: string) => ProofRoute | null;
let NO_FITTING_TOOL: Set<string>;
let PROOF_COPY: Record<string, ProofCopy>;

beforeAll(async () => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_TIER; // free tier: the only place content pages exist
  ({ proofToolFor, NO_FITTING_TOOL, PROOF_COPY } = await import('../lib/proof-route'));
});
afterEach(() => { vi.resetModules(); });

describe('proofToolFor', () => {
  it('routes every niche to a listed, published, free tool page that exists on disk, or to no card', () => {
    for (const n of getAllNiches()) {
      const r = proofToolFor(n.id);
      if (NO_FITTING_TOOL.has(n.id)) {
        expect(r, `${n.id} is listed as having no fitting tool`).toBeNull();
        continue;
      }
      expect(r, n.id).not.toBeNull();
      const [, , niche, slug] = r!.href.split('/');
      const fp = path.join('data', 'tools', niche, `${slug}.json`);
      expect(fs.existsSync(fp), r!.href).toBe(true);
      const j = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      expect(PRO_ENGINES, `${n.id} routed to a Pro engine`).not.toContain(j.toolEngine);
      expect(j.editorial?.status, `${r!.href} must be published`).toBe('published');
      expect(r!.engine).toBe(j.toolEngine);
    }
  });
  it('prefers a tool in the same niche, and falls back by theme', () => {
    expect(proofToolFor('vpn-privacy')?.sameNiche).toBe(true);
    expect(proofToolFor('password-security')?.engine).toBe('password-strength');
    // A niche whose only tool is a Pro engine must fall back to a free one.
    const fallback = proofToolFor('device-fingerprinting');
    expect(fallback?.sameNiche).toBe(false);
    expect(PRO_ENGINES).not.toContain(fallback?.engine);
  });
  it('shows no card where no free tool fits the topic (law, policy, AI, workplace, crypto)', () => {
    for (const n of ['gdpr', 'ccpa', 'privacy-policies', 'ai-privacy', 'workplace-privacy', 'crypto-privacy']) {
      expect(proofToolFor(n), n).toBeNull();
    }
  });
});

describe('proof card copy (CTO review 2026-09-10)', () => {
  const routed = () => getAllNiches().map((n) => proofToolFor(n.id)).filter((r): r is ProofRoute => !!r);

  it('names the tool by its neutral engine name, never a niche shell title', () => {
    for (const r of routed()) {
      expect(r.title, r.href).toBe(PROOF_COPY[r.engine].name);
      // 65 pages used to show the gaming niche's shell title for the user-agent tool.
      expect(r.title).not.toMatch(/Gaming|Medical|Banking|Student|Compliance/);
    }
    expect(proofToolFor('browser-privacy')?.title).toBe('User Agent Analyzer');
  });
  it('every free engine has card copy, and the button names the tool it opens', () => {
    for (const r of routed()) {
      expect(r.gives.length, r.engine).toBeGreaterThan(20);
      expect(r.needs.length, r.engine).toBeGreaterThan(10);
      expect(r.button, r.engine).toContain(r.title);
    }
  });
  it('makes none of the old promises: no "one tap", no "your own number", no reassurance slogans', () => {
    for (const c of Object.values(PROOF_COPY)) {
      const text = `${c.name} ${c.gives} ${c.needs} ${c.button}`.toLowerCase();
      expect(text, c.name).not.toMatch(/one tap|your own number|runs in your browser|free|upload|never leaves|nothing is sent|no account|no sign/);
    }
  });
  it('the owner\'s example: ad-tracking pages explain what the Ad-Blocker Test measures and what it needs', () => {
    const r = proofToolFor('ad-tracking')!;
    expect(r.engine).toBe('ad-blocker-test');
    expect(r.gives).toMatch(/50 test ad and tracker requests/);
    // Any browser-side blocker counts (Brave Shields, Safari content
    // blockers), so the card must not say only an extension will do. DNS
    // filters score 0 by design: every bait is a first-party request.
    expect(r.needs).toMatch(/an extension, or a browser with one built in/);
    expect(r.needs).not.toMatch(/extension installed/);
    expect(r.button).toBe('Open the Ad-Blocker Test');
  });
  it('the quiz card gives the number of questions the quiz really asks', () => {
    const src = fs.readFileSync(path.join('components', 'tools', 'PrivacyQuizTool.tsx'), 'utf-8');
    const questions = (src.match(/\bid: '[^']+', category: '/g) || []).length;
    expect(questions, 'question entries found in PrivacyQuizTool').toBeGreaterThan(5);
    expect(PROOF_COPY['privacy-quiz'].gives).toMatch(new RegExp(`\\b${questions} questions about\\b`));
  });
  it('the quiz card promises what the result shows: a score and the quiz\'s top recommendations', () => {
    // The quiz ranks answers scoring under 6 by impact × (10 − answer); it never
    // computes which change would raise the score most.
    const gives = PROOF_COPY['privacy-quiz'].gives;
    expect(gives).toMatch(/a score out of 100 and your top recommendations/);
    expect(gives).not.toMatch(/raise it most/);
    const src = fs.readFileSync(path.join('components', 'tools', 'PrivacyQuizTool.tsx'), 'utf-8');
    expect(src, 'the quiz result still has a "Top recommendations" heading').toMatch(/>\s*Top Recommendations\s*</i);
  });
});

/**
 * A free tool's result links to a Pro tool page. The link used to say "Pro
 * version of this check" and opened a different tool on 3 of 4 pages, so it
 * now names the page it opens; the name must be that page's real title.
 */
describe('proHandoffFor — the Pro link names the page it opens', () => {
  let proHandoffFor: (niche: string) => string | undefined;
  let PRO_HANDOFF_TITLE: Record<string, string>;
  let proHandoffTitle: (url: string | undefined) => string | undefined;
  beforeAll(async () => {
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_TIER;
    ({ proHandoffFor } = await import('../lib/proof-route'));
    ({ PRO_HANDOFF_TITLE, proHandoffTitle } = await import('../lib/cta-copy'));
  });

  it('every named Pro page exists, is a Pro engine, and the name is its title', () => {
    for (const [p, title] of Object.entries(PRO_HANDOFF_TITLE)) {
      const [, , niche, slug] = p.split('/');
      const j = JSON.parse(fs.readFileSync(path.join('data', 'tools', niche, `${slug}.json`), 'utf-8'));
      expect(PRO_ENGINES, p).toContain(j.toolEngine);
      expect(title, p).toBe(j.title);
    }
  });
  it('every niche with a free tool and a Pro tool gets a named Pro link (none silently dropped)', () => {
    const toolsRoot = path.join('data', 'tools');
    for (const niche of fs.readdirSync(toolsRoot)) {
      const files = fs.readdirSync(path.join(toolsRoot, niche)).filter((f) => f.endsWith('.json'));
      const engines = files.map((f) => JSON.parse(fs.readFileSync(path.join(toolsRoot, niche, f), 'utf-8')).toolEngine as string);
      const hasFree = engines.some((e) => !PRO_ENGINES.includes(e));
      const hasPro = engines.some((e) => PRO_ENGINES.includes(e));
      const url = proHandoffFor(niche);
      if (hasFree && hasPro) {
        expect(url, niche).toBeTruthy();
        expect(proHandoffTitle(url), niche).toBeTruthy();
      }
      if (url) expect(proHandoffTitle(url), niche).toBeTruthy();
    }
    expect(proHandoffTitle(proHandoffFor('ad-tracking'))).toBe('Cookie & Tracker Scanner');
  });
});
