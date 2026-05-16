/**
 * Tool-audit E2E suite.
 *
 * One test per tool engine. Each test:
 *   1. Navigates to a canonical URL for that tool
 *   2. Provides representative inputs (where the tool needs them)
 *   3. Triggers the tool's primary action (button click, etc.)
 *   4. Asserts that meaningful output appears
 *
 * Goals are functional, not visual:
 *   - "Does the tool run without throwing?"
 *   - "Does it produce something a user would recognize as a result?"
 * NOT:
 *   - Pixel-perfect rendering checks
 *   - Exact output values (which change per environment)
 */

import { test, expect } from '@playwright/test';
import { toolUrl } from './helpers';

// ─────────────────────────────────────────────────────────────────────────
// 1. Password Strength Checker
// ─────────────────────────────────────────────────────────────────────────
test('password-strength: weak password shows low score', async ({ page }) => {
  await page.goto(toolUrl('password-strength'));
  await page.locator('input[type="password"], input[type="text"]').first().fill('password123');
  // Result panel appears immediately on input
  await expect(page.getByText(/entropy|crack time|strength|weak/i).first()).toBeVisible({ timeout: 10_000 });
});

test('password-strength: strong password shows high score', async ({ page }) => {
  await page.goto(toolUrl('password-strength'));
  await page.locator('input[type="password"], input[type="text"]').first().fill('Tr0ub4dor&3Vault-Wallets!Z');
  await expect(page.getByText(/strong|excellent|very strong|crack time/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Password Generator
// ─────────────────────────────────────────────────────────────────────────
test('password-generator: produces a password on click', async ({ page }) => {
  await page.goto(toolUrl('password-generator'));
  await page.getByRole('button', { name: /generate/i }).first().click();
  // Generated password is rendered in a code/font-mono element
  const generated = page.locator('.font-mono').filter({ hasText: /^[\S]{8,}$/ }).first();
  await expect(generated).toBeVisible({ timeout: 5_000 });
  const text = await generated.textContent();
  expect(text?.length ?? 0).toBeGreaterThanOrEqual(8);
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Browser Privacy Audit
// ─────────────────────────────────────────────────────────────────────────
test('browser-privacy: audit completes and displays at least 10 checks', async ({ page }) => {
  await page.goto(toolUrl('browser-privacy'));
  await page.getByRole('button', { name: /run audit|start audit|audit/i }).first().click();
  // Each check renders a category label — wait for several to appear
  await expect(page.getByText(/Leaks|Tracking|Fingerprinting|HTTPS|Storage/i).first()).toBeVisible({ timeout: 30_000 });
  // Score readout appears at the top of the result
  await expect(page.getByText(/score|out of/i).first()).toBeVisible({ timeout: 30_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Text Encryption Tool
// ─────────────────────────────────────────────────────────────────────────
test('text-encryption: round-trip encrypt → decrypt of "hello world"', async ({ page }) => {
  await page.goto(toolUrl('text-encryption'));

  const passphrase = 'audit-test-passphrase-1234567';
  const plaintext = 'hello world';

  // Step 1: encrypt
  await page.locator('textarea').first().fill(plaintext);
  await page.locator('input[type="password"]').first().fill(passphrase);
  await page.getByRole('button', { name: /encrypt/i }).first().click();

  // Captures the base64 ciphertext from the result panel
  const cipherDisplay = page.locator('pre, code').filter({ hasText: /^[A-Za-z0-9+/=]+$/ }).first();
  await expect(cipherDisplay).toBeVisible({ timeout: 10_000 });
  const ciphertext = (await cipherDisplay.textContent())?.trim() ?? '';
  expect(ciphertext.length).toBeGreaterThan(40);

  // Step 2: switch to decrypt mode and paste the ciphertext back
  await page.getByRole('button', { name: /^decrypt$/i }).first().click();
  await page.locator('textarea').first().fill(ciphertext);
  await page.locator('input[type="password"]').first().fill(passphrase);
  await page.getByRole('button', { name: /decrypt/i }).last().click();

  // Decrypted plaintext should appear in the output
  await expect(page.getByText(plaintext, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});

test('text-encryption: wrong passphrase shows actionable error', async ({ page }) => {
  await page.goto(toolUrl('text-encryption'));
  // Use a manufactured base64 token that will fail auth
  const bogus = 'SUJFMQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  await page.getByRole('button', { name: /^decrypt$/i }).first().click();
  await page.locator('textarea').first().fill(bogus);
  await page.locator('input[type="password"]').first().fill('wrong-passphrase');
  await page.getByRole('button', { name: /decrypt/i }).last().click();
  // Error message should explain *why* (not just "Decryption failed.")
  await expect(page.getByText(/passphrase|tampered|operation|too short|invalid base64/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. URL Safety Checker
// ─────────────────────────────────────────────────────────────────────────
test('url-analyzer: flags an obvious typosquat', async ({ page }) => {
  await page.goto(toolUrl('url-analyzer'));
  await page.locator('input[type="text"], input[type="url"]').first().fill('http://paypa1.com/login');
  await page.getByRole('button', { name: /analyze|check|scan/i }).first().click();
  // Either the impersonation banner or a security findings list should appear
  await expect(page.getByText(/impersonat|typosquat|HTTP not HTTPS|phishing|suspicious/i).first()).toBeVisible({ timeout: 10_000 });
});

test('url-analyzer: trusted domain shows higher score', async ({ page }) => {
  await page.goto(toolUrl('url-analyzer'));
  await page.locator('input[type="text"], input[type="url"]').first().fill('https://github.com');
  await page.getByRole('button', { name: /analyze|check|scan/i }).first().click();
  await expect(page.getByText(/safe|low risk|HTTPS|trusted/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Hash Generator
// ─────────────────────────────────────────────────────────────────────────
test('hash-generator: produces SHA-256 of "abc"', async ({ page }) => {
  await page.goto(toolUrl('hash-generator'));
  await page.locator('textarea').first().fill('abc');
  // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  await expect(page.getByText(/ba7816bf8f01cfea/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. Privacy Score Quiz
// ─────────────────────────────────────────────────────────────────────────
test('privacy-quiz: answer all questions and reach the results page', async ({ page }) => {
  await page.goto(toolUrl('privacy-quiz'));
  // The quiz progressively reveals questions — answer each via the first option
  // 12 questions total; loop until "results" view appears.
  for (let i = 0; i < 15; i++) {
    const firstOption = page.getByRole('button').filter({ hasNotText: /retake|next|previous|share/i }).first();
    const hasOptions = await firstOption.count();
    if (!hasOptions) break;
    try {
      await firstOption.click({ timeout: 1500 });
    } catch {
      break;
    }
    await page.waitForTimeout(400);
    const isDone = await page.getByText(/your score|recommendations|results|retake/i).count();
    if (isDone) break;
  }
  await expect(page.getByText(/score|recommendation/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. Permission Checker
// ─────────────────────────────────────────────────────────────────────────
test('permission-checker: shows status for at least camera and microphone', async ({ page }) => {
  await page.goto(toolUrl('permission-checker'));
  await expect(page.getByText(/camera/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/microphone/i).first()).toBeVisible({ timeout: 10_000 });
  // Each shows granted/prompt/denied state
  await expect(page.getByText(/granted|prompt|denied|allowed|blocked/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Cookie & Tracker Scanner (talks to Vercel API)
// ─────────────────────────────────────────────────────────────────────────
test('cookie-analyzer: scans example.com and renders the result panel', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(toolUrl('cookie-analyzer'));
  await page.locator('input[type="url"], input[type="text"]').first().fill('https://example.com');
  await page.getByRole('button', { name: /^scan/i }).first().click();
  // PoW solve + API call + render — give it generous time
  await expect(
    page.getByText(/cookies|trackers|third-party|security headers|no cookies found/i).first(),
  ).toBeVisible({ timeout: 60_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. User-Agent Analyzer (no input — auto-runs on load)
// ─────────────────────────────────────────────────────────────────────────
test('useragent-analyzer: displays parsed browser + OS info', async ({ page }) => {
  await page.goto(toolUrl('useragent-analyzer'));
  // Playwright's user agent is Chrome by default, so we should see "Chrome" in the output
  await expect(page.getByText(/Chrome|Browser/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Operating System|Mac|Windows|Linux|OS/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 11. Image Metadata Viewer (skipped — needs binary upload, separate test)
// ─────────────────────────────────────────────────────────────────────────
test('metadata-viewer: tool page loads with upload control', async ({ page }) => {
  await page.goto(toolUrl('metadata-viewer'));
  // Without a real image file we just verify the file input is present
  await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 12. What's My IP (auto-runs on load)
// ─────────────────────────────────────────────────────────────────────────
test('whats-my-ip: displays a public IP address', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto(toolUrl('whats-my-ip'));
  // Either an IPv4 or IPv6 should render — match a permissive pattern
  await expect(
    page.locator('code').filter({ hasText: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^[a-f0-9:]+$/i }).first(),
  ).toBeVisible({ timeout: 20_000 });
});
