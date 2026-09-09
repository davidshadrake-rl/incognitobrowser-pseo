/**
 * Copy text with a fallback that works where the async Clipboard API does not:
 * insecure contexts (the http:// droplet origin, where `navigator.clipboard`
 * is undefined and a bare writeText() throws), older WebViews, and browsers
 * that deny the permission. Resolves true only when the text was copied, so a
 * caller can show "Copied" honestly and otherwise tell the user to select it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
