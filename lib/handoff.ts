/**
 * The desktop hand-off message behind "Email me the link" (ResultCta).
 *
 * Kept as pure functions so the exact bytes that reach a mail client are
 * unit-tested. Two things broke this on Windows (2026-09-08): bare "\n" line
 * breaks in the body (RFC 6068 §5 requires CRLF; Outlook drops the body) and
 * machines with no registered mailto handler (handled in the component with a
 * blur-detection fallback — nothing this module can do about that one).
 */

export const HANDOFF_SUBJECT = 'Incognito Pro (Android)';

/** Windows hands mailto: URLs through ShellExecute, which truncates around 2083 chars. Stay well under. */
export const MAILTO_MAX_LENGTH = 2000;

export function stripHash(href: string): string {
  return href.split('#')[0];
}

/**
 * The page link that goes into anything a visitor sends onward: origin + path
 * only. The query string is dropped as well as the hash — a crafted link
 * (`?ref=CALL 0800…`) would otherwise be pasted, verbatim, into the email
 * body the visitor sends to themselves (security audit 2026-09-08).
 */
export function pageLinkFor(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return stripHash(href).split('?')[0];
  }
}

export function handoffMailBody(play: string, pageHref: string): string {
  return `Get Incognito Pro on Google Play: ${play}\r\n\r\nThe check I ran: ${pageLinkFor(pageHref)}`;
}

export function handoffMailto(play: string, pageHref: string): string {
  return `mailto:?subject=${encodeURIComponent(HANDOFF_SUBJECT)}&body=${encodeURIComponent(handoffMailBody(play, pageHref))}`;
}
