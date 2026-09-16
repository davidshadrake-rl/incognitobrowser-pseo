'use client';

/**
 * One lazily loaded component per tool engine, for checks that run inside a
 * content page (components/FunnelCheck.tsx).
 *
 * components/tools/registry.tsx imports every engine at the top of the module,
 * so anything that imports it ships all 17. A guide that embeds one check
 * should download that check and nothing else, and only when the visitor
 * presses the button — hence a separate map of next/dynamic imports, each
 * a literal path the bundler can split on.
 *
 * ssr: false because every engine reads the browser (the IP it's on, the user
 * agent, cookies, a file the visitor picks); there is nothing to prerender.
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

const loading = () => <p className="text-row text-t3 py-6" role="status">Loading the check…</p>;

export const ENGINE_LOADERS: Record<string, ComponentType> = {
  'password-strength': dynamic(() => import('./PasswordStrengthTool').then((m) => m.PasswordStrengthTool), { ssr: false, loading }),
  'password-generator': dynamic(() => import('./PasswordGeneratorTool').then((m) => m.PasswordGeneratorTool), { ssr: false, loading }),
  'browser-privacy': dynamic(() => import('./BrowserPrivacyTool').then((m) => m.BrowserPrivacyTool), { ssr: false, loading }),
  'text-encryption': dynamic(() => import('./TextEncryptionTool').then((m) => m.TextEncryptionTool), { ssr: false, loading }),
  'url-analyzer': dynamic(() => import('./URLAnalyzerTool').then((m) => m.URLAnalyzerTool), { ssr: false, loading }),
  'hash-generator': dynamic(() => import('./HashGeneratorTool').then((m) => m.HashGeneratorTool), { ssr: false, loading }),
  'privacy-quiz': dynamic(() => import('./PrivacyQuizTool').then((m) => m.PrivacyQuizTool), { ssr: false, loading }),
  'permission-checker': dynamic(() => import('./PermissionCheckerTool').then((m) => m.PermissionCheckerTool), { ssr: false, loading }),
  'cookie-analyzer': dynamic(() => import('./CookieAnalyzerTool').then((m) => m.CookieAnalyzerTool), { ssr: false, loading }),
  'useragent-analyzer': dynamic(() => import('./UserAgentAnalyzerTool').then((m) => m.UserAgentAnalyzerTool), { ssr: false, loading }),
  'metadata-viewer': dynamic(() => import('./MetadataViewerTool').then((m) => m.MetadataViewerTool), { ssr: false, loading }),
  'whats-my-ip': dynamic(() => import('./WhatsMyIpTool').then((m) => m.WhatsMyIpTool), { ssr: false, loading }),
  'ad-blocker-test': dynamic(() => import('./AdBlockerTestTool').then((m) => m.AdBlockerTestTool), { ssr: false, loading }),
  'dns-leak-test': dynamic(() => import('./DnsLeakTestTool').then((m) => m.DnsLeakTestTool), { ssr: false, loading }),
  'screenshot-leak-checker': dynamic(() => import('./ScreenshotLeakCheckerTool').then((m) => m.ScreenshotLeakCheckerTool), { ssr: false, loading }),
  'email-pixel-detector': dynamic(() => import('./EmailPixelDetectorTool').then((m) => m.EmailPixelDetectorTool), { ssr: false, loading }),
  'link-unwrapper': dynamic(() => import('./LinkUnwrapperTool').then((m) => m.LinkUnwrapperTool), { ssr: false, loading }),
};

