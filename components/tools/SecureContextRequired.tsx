'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';

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
  // Avoid hydration mismatch: check on mount, not during SSR
  const [isInsecure, setIsInsecure] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');

  useEffect(() => {
    const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function';
    setIsInsecure(!hasCrypto);
    setCurrentUrl(window.location.href.replace(/^http:/i, 'https:'));
  }, []);

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
        On the production site, this tool works normally. All cryptography still happens
        100% in your browser — the HTTPS requirement is a browser security policy, not a
        server one.
      </p>
    </div>
  );
}

/**
 * Hook variant — returns whether the context is secure.
 * Use in tools that need to conditionally disable input/buttons.
 */
export function useIsSecureContext(): boolean {
  const [secure, setSecure] = useState(true); // assume secure to avoid SSR hydration mismatch
  useEffect(() => {
    setSecure(typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function');
  }, []);
  return secure;
}
