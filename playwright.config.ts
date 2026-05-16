import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the privacy-tools E2E audit.
 *
 * Run with:
 *   npm run test:e2e             — all tools, against E2E_BASE_URL or default
 *   npm run test:e2e:droplet     — runs against the DigitalOcean test droplet
 *   npm run test:e2e:local       — spawns `npm run dev` and tests against it
 *
 * Test files live in e2e/ and follow the naming convention <tool>.spec.ts.
 * Each tool has its own spec file with: navigate → fill inputs → click → assert.
 */

const DEFAULT_BASE_URL = process.env.E2E_BASE_URL || 'http://206.189.186.34';

export default defineConfig({
  testDir: './e2e',
  /* Run tests sequentially within a file but parallelize files */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in code */
  forbidOnly: !!process.env.CI,
  /* Retry once on flaky network/CDN responses */
  retries: process.env.CI ? 2 : 0,
  /* Sensible default workers — Playwright auto-detects */
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  /* Settings inherited by every test */
  use: {
    baseURL: DEFAULT_BASE_URL,
    /* Capture screenshot on failure for debugging */
    screenshot: 'only-on-failure',
    /* Trace on retry — useful for diagnosing why a test failed once but passed second time */
    trace: 'on-first-retry',
    /* Larger viewport so all tool UI is visible without scroll-into-view */
    viewport: { width: 1280, height: 900 },
    /* Some tools need clipboard access (password gen, hash gen, etc.) */
    permissions: ['clipboard-read', 'clipboard-write'],
    /* Give pages a generous timeout — the cookie scanner hits a real third-party */
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  /* Test against Chrome by default. Add more browsers here if you want
     cross-browser coverage — adds time so we don't enable Firefox/Webkit
     by default. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* If running against localhost, automatically start the dev server.
     Doesn't apply when E2E_BASE_URL points at an external URL. */
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
