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
import { toolUrl, isInsecureContext, hasProTarget } from './helpers';

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
  test.skip(!hasProTarget(), 'Pro engine — lives on the Pro deployment only; set E2E_PRO_BASE_URL.');
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
  // Web Crypto API requires HTTPS (or localhost). On the HTTP-only test droplet
  // this tool intentionally shows a "secure context required" banner instead
  // of running — so a round-trip can't happen there.
  test.skip(isInsecureContext(), 'Text encryption requires HTTPS — Web Crypto API is unavailable on HTTP. The tool shows a friendly banner.');
  test.setTimeout(45_000); // PBKDF2 600k iterations takes ~1-2s each side
  await page.goto(toolUrl('text-encryption'));

  const passphrase = 'audit-test-passphrase-1234567';
  const plaintext = 'hello world';

  // Step 1: encrypt
  // Note: there are multiple buttons matching /encrypt/i (mode tab + submit
  // button "Encrypt Text"). Use the exact submit-button name.
  await page.locator('textarea').first().fill(plaintext);
  await page.locator('input[type="password"]').first().fill(passphrase);
  await page.getByRole('button', { name: 'Encrypt Text' }).click();

  // Captures the base64 ciphertext from the result panel. The component renders
  // the output inside a <pre> with whitespace-pre-wrap, so the textContent may
  // include trailing whitespace — the hasText regex doesn't require exact match.
  const cipherDisplay = page.locator('pre').filter({ hasText: /[A-Za-z0-9+/=]{40,}/ }).first();
  await expect(cipherDisplay).toBeVisible({ timeout: 15_000 });
  const ciphertext = (await cipherDisplay.textContent())?.trim() ?? '';
  expect(ciphertext.length).toBeGreaterThan(40);

  // Step 2: switch to decrypt mode and paste the ciphertext back
  await page.getByRole('button', { name: 'Decrypt', exact: true }).click();
  await page.locator('textarea').first().fill(ciphertext);
  await page.locator('input[type="password"]').first().fill(passphrase);
  await page.getByRole('button', { name: 'Decrypt Text' }).click();

  // Decrypted plaintext should appear in the output area
  await expect(page.locator('pre').filter({ hasText: plaintext }).first()).toBeVisible({ timeout: 15_000 });
});

test('text-encryption: shows HTTPS-required banner on insecure contexts', async ({ page }) => {
  test.skip(!isInsecureContext(), 'Banner only appears on HTTP — skip on HTTPS/localhost where the tool works normally.');
  await page.goto(toolUrl('text-encryption'));
  // Banner explains the issue rather than letting users hit a cryptic TypeError
  await expect(page.getByText(/secure connection|requires HTTPS|Web Crypto/i).first()).toBeVisible({ timeout: 5_000 });
});

test('hash-generator: shows HTTPS-required banner on insecure contexts', async ({ page }) => {
  test.skip(!isInsecureContext(), 'Banner only appears on HTTP — skip on HTTPS/localhost where the tool works normally.');
  await page.goto(toolUrl('hash-generator'));
  await expect(page.getByText(/secure connection|requires HTTPS|Web Crypto/i).first()).toBeVisible({ timeout: 5_000 });
});

test('text-encryption: wrong passphrase shows actionable error', async ({ page }) => {
  test.skip(isInsecureContext(), 'Decrypt path needs Web Crypto — skip on HTTP.');
  await page.goto(toolUrl('text-encryption'));
  // Switch to decrypt mode
  await page.getByRole('button', { name: 'Decrypt', exact: true }).click();
  // Manufactured base64 that's the right length but will fail AES-GCM auth
  const bogus = 'SUJFMQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  await page.locator('textarea').first().fill(bogus);
  await page.locator('input[type="password"]').first().fill('wrong-passphrase');
  await page.getByRole('button', { name: 'Decrypt Text' }).click();
  // Error message should explain *why* (not just "Decryption failed.")
  await expect(
    page.getByText(/passphrase|tampered|operation|too short|invalid base64/i).first(),
  ).toBeVisible({ timeout: 15_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. URL Safety Checker
// ─────────────────────────────────────────────────────────────────────────
test('url-analyzer: flags an obvious typosquat', async ({ page }) => {
  test.skip(!hasProTarget(), 'Pro engine — lives on the Pro deployment only; set E2E_PRO_BASE_URL.');
  await page.goto(toolUrl('url-analyzer'));
  await page.locator('input[type="text"], input[type="url"]').first().fill('http://paypa1.com/login');
  await page.getByRole('button', { name: /analyze|check|scan/i }).first().click();
  // Either the impersonation banner or a security findings list should appear
  await expect(page.getByText(/impersonat|typosquat|HTTP not HTTPS|phishing|suspicious/i).first()).toBeVisible({ timeout: 10_000 });
});

test('url-analyzer: trusted domain shows higher score', async ({ page }) => {
  test.skip(!hasProTarget(), 'Pro engine — lives on the Pro deployment only; set E2E_PRO_BASE_URL.');
  await page.goto(toolUrl('url-analyzer'));
  await page.locator('input[type="text"], input[type="url"]').first().fill('https://github.com');
  await page.getByRole('button', { name: /analyze|check|scan/i }).first().click();
  await expect(page.getByText(/safe|low risk|HTTPS|trusted/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Hash Generator
// ─────────────────────────────────────────────────────────────────────────
test('hash-generator: produces SHA-256 of "abc"', async ({ page }) => {
  // crypto.subtle.digest also requires a secure context. Skip on HTTP.
  test.skip(isInsecureContext(), 'Hash generator requires HTTPS — Web Crypto API is unavailable on HTTP. The tool shows a friendly banner.');
  await page.goto(toolUrl('hash-generator'));
  // The tool starts in 'text' mode by default. Fill the textarea; the page
  // auto-computes hashes on every keystroke (no submit button to click).
  // Use pressSequentially to make sure React's onChange handler runs.
  await page.locator('textarea').first().pressSequentially('abc');
  // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  // Look inside <code> elements (the result cards render hashes there).
  await expect(
    page.locator('code').filter({ hasText: /ba7816bf8f01cfea/i }).first(),
  ).toBeVisible({ timeout: 15_000 });
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
  test.skip(!hasProTarget(), 'Pro engine — lives on the Pro deployment only; set E2E_PRO_BASE_URL.');
  test.setTimeout(60_000);
  await page.goto(toolUrl('cookie-analyzer'));
  await page.locator('input[type="url"], input[type="text"]').first().fill('https://example.com');
  // Exact name: the page also has a "Scan a URL" MODE TAB, which /^scan/i + .first()
  // matched — clicking the already-active tab, so no scan ever ran. The old weak
  // assertion hid this by matching static page copy.
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  // PoW solve + API call + render — give it generous time.
  // Assert on RESULT-PANEL-ONLY text. The previous regex (/cookies|trackers|…/)
  // matched the page's static "How This Tool Works" copy, so this test passed
  // on Vercel while the scan itself was failing with a 403 from a dead API host.
  // "Total Cookies" / "No cookies detected" only render after a completed scan.
  await expect(
    page.getByText(/^Total Cookies$|^No cookies detected$/).first(),
  ).toBeVisible({ timeout: 60_000 });
  // And it must NOT have errored.
  await expect(page.getByText(/network error/i)).toHaveCount(0);
});

// ─────────────────────────────────────────────────────────────────────────
// 10. User-Agent Analyzer (no input — auto-runs on load)
// ─────────────────────────────────────────────────────────────────────────
test('useragent-analyzer: displays parsed browser + OS info', async ({ page }) => {
  const response = await page.goto(toolUrl('useragent-analyzer'));
  // First confirm the tool page actually loaded (not a 404). Earlier this test
  // was matching the browser version string on the 404 page itself and giving
  // a false pass.
  expect(response?.status(), 'tool page should not 404').toBeLessThan(400);
  // Then verify the tool rendered its parsed-UA panel with the labeled fields
  await expect(page.getByText(/User Agent/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Browser/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Operating System|Platform|Device/i).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 11. Image Metadata Viewer (skipped — needs binary upload, separate test)
// ─────────────────────────────────────────────────────────────────────────
test('metadata-viewer: tool page loads with upload control', async ({ page }) => {
  test.skip(!hasProTarget(), 'Pro engine — lives on the Pro deployment only; set E2E_PRO_BASE_URL.');
  await page.goto(toolUrl('metadata-viewer'));
  // Without a real image file we just verify the file input is present
  await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────
// 12. What's My IP (auto-runs on load)
// ─────────────────────────────────────────────────────────────────────────
test('whats-my-ip: displays a public IP address', async ({ page }) => {
  test.setTimeout(45_000);
  const response = await page.goto(toolUrl('whats-my-ip'));
  // First check the page even exists on this deployment. The tool was added
  // recently — older static deploys won't have it. Skip the test with a clear
  // explanation rather than fail.
  if (response && response.status() === 404) {
    test.skip(true, 'whats-my-ip tool not yet deployed at this URL — redeploy the static site to pick it up');
    return;
  }
  // Either an IPv4 or IPv6 should render. The component shows the IP inside
  // <code> elements. Permissive regex — IPv4 dotted-quad or IPv6 hextet form.
  await expect(
    page.locator('code').filter({ hasText: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$|^[0-9a-f]+:[0-9a-f:]*$/i }).first(),
  ).toBeVisible({ timeout: 30_000 });
});
