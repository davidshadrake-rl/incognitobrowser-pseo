/**
 * Masks an IP for anything that leaves the page (the shareable scorecard PNG,
 * share text). The page itself shows the full address — that is the proof the
 * visitor came for — but a privacy brand must not hand people an image that
 * broadcasts their real IP under a "Check yours free" caption (found in the
 * 2026-09-08 audit: the IP was the largest element on the card).
 *
 * IPv4 keeps the first three octets ("185.192.16.xxx"); IPv6 keeps the first
 * three groups, which identify the network but not the host.
 */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return 'unknown';
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.xxx`;
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((g, i, a) => g !== '' || i === 0 || i === a.length - 1);
    return `${groups.slice(0, 3).join(':')}:…`;
  }
  return ip;
}
