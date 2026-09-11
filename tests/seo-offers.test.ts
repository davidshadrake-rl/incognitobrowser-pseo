/**
 * lib/seo generateWebApplicationSchema — no price for Pro.
 *
 * `offers` puts a price (0) in a tool page's JSON-LD. Pro is the paid app
 * tier and no page may state a price for it, so the schema drops the offer on
 * every page of the Pro deployment and on any free-site page that names a Pro
 * engine. The tier is baked in at module load (lib/tiers reads
 * NEXT_PUBLIC_TIER), so each case reloads the modules under its own env.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Schema = Record<string, unknown> & { offers?: { '@type': string; price: string; priceCurrency: string } };
type Generate = (name: string, description: string, url: string, engine?: string) => Schema;

const PRO_ENGINES = ['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer'];
const ORIGINAL_TIER = process.env.NEXT_PUBLIC_TIER;

async function load(tier: 'free' | 'pro'): Promise<Generate> {
  vi.resetModules();
  if (tier === 'pro') process.env.NEXT_PUBLIC_TIER = 'pro';
  else delete process.env.NEXT_PUBLIC_TIER;
  const { generateWebApplicationSchema } = await import('../lib/seo');
  return generateWebApplicationSchema as Generate;
}

afterEach(() => {
  vi.resetModules();
  if (ORIGINAL_TIER === undefined) delete process.env.NEXT_PUBLIC_TIER;
  else process.env.NEXT_PUBLIC_TIER = ORIGINAL_TIER;
});

const args = ['A tool', 'What it does.', 'https://example.test/tools/x/y'] as const;

describe('generateWebApplicationSchema offers', () => {
  it('the Pro deployment: no offer on any tool page, whatever the engine', async () => {
    const generate = await load('pro');
    for (const engine of [undefined, 'cookie-analyzer', 'whats-my-ip', 'privacy-quiz']) {
      const schema = generate(...args, engine);
      expect(schema, String(engine)).not.toHaveProperty('offers');
      expect(schema['@type']).toBe('WebApplication');
    }
  });

  it('the free deployment: a free offer for a page with no engine or a free engine', async () => {
    const generate = await load('free');
    for (const engine of [undefined, 'whats-my-ip', 'privacy-quiz', 'password-strength']) {
      expect(generate(...args, engine).offers, String(engine)).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    }
  });

  it('the free deployment: no offer for a page that names a Pro engine', async () => {
    const generate = await load('free');
    expect(generate(...args, 'cookie-analyzer')).not.toHaveProperty('offers');
    for (const engine of PRO_ENGINES) expect(generate(...args, engine), engine).not.toHaveProperty('offers');
  });
});
