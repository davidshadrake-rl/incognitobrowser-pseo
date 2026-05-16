/**
 * Shared test helpers for the tool-audit E2E suite.
 *
 * Each tool engine has multiple URL paths (one per niche it was deployed to).
 * For audit purposes we just need ONE working URL per engine — we pick a
 * canonical one here.
 */

export const TOOL_PATHS: Record<string, string> = {
  'password-strength': '/resources/tools/password-security/password-strength-checker/',
  'password-generator': '/resources/tools/password-security/secure-password-generator/',
  'browser-privacy': '/resources/tools/browser-privacy/browser-privacy-audit/',
  'text-encryption': '/resources/tools/encrypted-messaging/text-encryption-tool/',
  'url-analyzer': '/resources/tools/phishing/url-safety-checker/',
  'hash-generator': '/resources/tools/crypto-privacy/hash-generator/',
  'privacy-quiz': '/resources/tools/digital-footprint/privacy-score-quiz/',
  'permission-checker': '/resources/tools/webcam-privacy/permission-checker/',
  'cookie-analyzer': '/resources/tools/ad-tracking/cookie-tracker-scanner/',
  'useragent-analyzer': '/resources/tools/gaming-privacy/useragent-analyzer/',
  'metadata-viewer': '/resources/tools/dating-privacy/image-metadata-checker/',
  'whats-my-ip': '/resources/tools/vpn-privacy/whats-my-ip/',
};

/**
 * The /resources/ basePath is set in next.config.ts for the static export
 * deploy (WordPress). When tests run against the local dev server (server-mode
 * build, no basePath) we strip it.
 */
export function toolUrl(engine: keyof typeof TOOL_PATHS): string {
  const path = TOOL_PATHS[engine];
  if (!path) throw new Error(`Unknown tool engine: ${String(engine)}`);
  const baseUrl = process.env.E2E_BASE_URL || '';
  // Local dev (Next server mode) doesn't apply basePath, so /resources/ is wrong.
  // The remote URLs (DO droplet, Cloudflare Pages) DO use /resources/.
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    return path.replace(/^\/resources/, '');
  }
  return path;
}

/**
 * True when the test target is served over plain HTTP. Browsers block
 * crypto.subtle (Web Crypto API) outside secure contexts, so tools that
 * depend on it (text encryption, hash generator) physically cannot work.
 *
 * Localhost is special-cased by browsers as "secure enough" — Web Crypto
 * works there even on HTTP.
 */
export function isInsecureContext(): boolean {
  const baseUrl = process.env.E2E_BASE_URL || '';
  if (!baseUrl) return false; // local dev defaults — localhost is treated as secure
  if (baseUrl.startsWith('https://')) return false;
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return false;
  return true;
}
