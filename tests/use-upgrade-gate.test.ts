/**
 * components/useUpgradeGate.tsx's gating decision, kept as a small pure
 * function (shouldGate) precisely so it can be tested without rendering the
 * hook — this repo has no DOM test environment or React testing library
 * (vitest.config.ts runs environment: 'node'). Stubs `document` the same
 * way tests/in-app.test.ts does for lib/in-app.ts's inAppPro().
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeElement {
  attrs = new Set<string>();
  hasAttribute(k: string) { return this.attrs.has(k); }
}

function stubDocument(ibPro: boolean) {
  const root = new FakeElement();
  if (ibPro) root.attrs.add('data-ib-pro');
  vi.stubGlobal('document', { documentElement: root });
}

describe('shouldGate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is true (the overlay shows) unless the app says this visitor already has Pro', async () => {
    vi.resetModules();
    stubDocument(false);
    const { shouldGate } = await import('../components/useUpgradeGate');
    expect(shouldGate()).toBe(true);
  });

  it('is false (the overlay is skipped) once the app has flagged the visitor as Pro', async () => {
    vi.resetModules();
    stubDocument(true);
    const { shouldGate } = await import('../components/useUpgradeGate');
    expect(shouldGate()).toBe(false);
  });

  it('is true when there is no document at all (server render)', async () => {
    vi.resetModules();
    vi.stubGlobal('document', undefined);
    const { shouldGate } = await import('../components/useUpgradeGate');
    expect(shouldGate()).toBe(true);
  });
});
