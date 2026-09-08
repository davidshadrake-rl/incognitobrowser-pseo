/**
 * lib/proof-route — every content page must route to a real, listed free tool.
 *
 * Content pages exist only on the FREE deployment, so this suite pins the
 * tier explicitly: `npm run build` also runs vitest, and under
 * NEXT_PUBLIC_TIER=pro the module graph would otherwise resolve Pro engines.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getAllNiches } from '../lib/taxonomy';
import fs from 'node:fs';
import path from 'node:path';

const PRO_ENGINES = ['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer'];
let proofToolFor: (niche: string) => { href: string; engine: string; sameNiche: boolean } | null;

beforeAll(async () => {
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_TIER; // free tier: the only place content pages exist
  ({ proofToolFor } = await import('../lib/proof-route'));
});
afterEach(() => { vi.resetModules(); });

describe('proofToolFor', () => {
  it('routes every niche to a listed, published, free tool page that exists on disk', () => {
    for (const n of getAllNiches()) {
      const r = proofToolFor(n.id);
      expect(r, n.id).not.toBeNull();
      const [, , niche, slug] = r!.href.split('/');
      const fp = path.join('data', 'tools', niche, `${slug}.json`);
      expect(fs.existsSync(fp), r!.href).toBe(true);
      const j = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      expect(PRO_ENGINES, `${n.id} routed to a Pro engine`).not.toContain(j.toolEngine);
      expect(j.editorial?.status, `${r!.href} must be published`).toBe('published');
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
});
