'use client';

import { useSyncExternalStore } from 'react';
import { Icon } from '@/components/ui/Icon';

// Neither value changes while the page is open, so there is nothing to subscribe to.
const subscribeNoop = () => () => {};
const hasSubtleCrypto = () => typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function';
const httpsHref = () => window.location.href.replace(/^http:/i, 'https:');

/**
 * Renders a friendly notice when the browser's Web Crypto API is unavailable —
 * which happens on plain HTTP pages (only HTTPS + localhost get crypto.subtle).
 *
 * Used by tools that need crypto.subtle (hash generator, text encryption, etc.)
 * so users on an insecure context see something actionable instead of a raw
 * TypeError later when they click Encrypt.
 *
 * Returns `null` when the context IS secure (the tool renders normally).
 */
export function SecureContextRequired({ toolName }: { toolName: string }) {
  // Avoid hydration mismatch: the server snapshot (secure, no URL) is also what
  // hydration renders; the real check runs on the client straight after.
  const isInsecure = !useSyncExternalStore(subscribeNoop, hasSubtleCrypto, () => true);
  const currentUrl = useSyncExternalStore(subscribeNoop, httpsHref, () => '');

  if (!isInsecure) return null;

  return (
    <div className="bg-s0 border border-warn/30 rounded-lg p-6 mb-6">
      <h3 className="text-sm font-semibold text-warn mb-2 flex items-center gap-2">
        <Icon name="lock" size={16} /> This tool requires a secure connection
      </h3>
      <p className="text-sm text-t2 mb-4">
        The {toolName} uses the browser&apos;s Web Crypto API, which is only available on
        HTTPS pages (or on <code className="text-white">localhost</code>). This page is
        served over plain HTTP, so the cryptography functions are blocked by your browser
        for security reasons.
      </p>
      {currentUrl.startsWith('https:') && (
        <a
          href={currentUrl}
          className="inline-block btn-primary text-xs"
        >
          Try over HTTPS
        </a>
      )}
      <p className="text-xs text-t3 mt-4">
        Over HTTPS, this tool works normally.
      </p>
    </div>
  );
}

/**
 * Hook variant — returns whether the context is secure.
 * Use in tools that need to conditionally disable input/buttons.
 */
export function useIsSecureContext(): boolean {
  return useSyncExternalStore(subscribeNoop, hasSubtleCrypto, () => true); // assume secure on the server to avoid a hydration mismatch
}
