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
  'ad-blocker-test': '/resources/tools/ad-tracking/ad-blocker-test/',
  'dns-leak-test': '/resources/tools/vpn-privacy/dns-leak-test/',
  'screenshot-leak-checker': '/resources/tools/social-media-privacy/screenshot-leak-checker/',
  'email-pixel-detector': '/resources/tools/email-privacy/email-tracking-pixel-detector/',
  'link-unwrapper': '/resources/tools/ad-tracking/link-unwrapper/',
};

/**
 * The /resources/ basePath only applies to static-export deploys
 * (WordPress / Cloudflare Pages / the DO droplet). Server-mode deploys
 * (Vercel + local Next dev) don't use basePath — their pages live at root.
 *
 * To target the right URL we strip /resources/ for server-mode environments
 * and keep it for static-export environments.
 */
/** Engines that exist only on the Pro deployment (mirror of lib/tiers PRO_ENGINES). */
export const PRO_ENGINES = new Set(['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer']);

/** Pro tools are tested against E2E_PRO_BASE_URL; without it their tests skip. */
export function hasProTarget(): boolean {
  return !!process.env.E2E_PRO_BASE_URL;
}

function isServerModeBase(baseUrl: string): boolean {
  const b = baseUrl.toLowerCase();
  return !b || b.includes('localhost') || b.includes('127.0.0.1') || b.includes('vercel.app');
}

export function toolUrl(engine: keyof typeof TOOL_PATHS): string {
  const path = TOOL_PATHS[engine];
  if (!path) throw new Error(`Unknown tool engine: ${String(engine)}`);

  // Pro engines are not built on the free site: route them to the Pro deployment (absolute URL).
  if (PRO_ENGINES.has(engine)) {
    const proBase = (process.env.E2E_PRO_BASE_URL || '').replace(/\/$/, '');
    if (!proBase) throw new Error(`${String(engine)} is a Pro engine — set E2E_PRO_BASE_URL (tests skip without it)`);
    return proBase + (isServerModeBase(proBase) ? path.replace(/^\/resources/, '') : path);
  }

  // Server-mode environments (no basePath applied): local dev + Vercel deploys
  return isServerModeBase(process.env.E2E_BASE_URL || '') ? path.replace(/^\/resources/, '') : path;
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
