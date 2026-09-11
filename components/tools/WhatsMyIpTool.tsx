'use client';

import { maskIp } from '@/lib/privacy-mask';

import { useEffect, useState } from 'react';
import { useReportResult } from './ResultContext';
import { Icon } from '@/components/ui/Icon';
import { ConsoleFrame, statusFromSeverity } from './ConsoleFrame';
import { isIPv4, isIPv6, networkOf } from '@/lib/dns-leak';

interface IpInfo {
  ipv4?: string;
  ipv6?: string;
  city?: string;
  region?: string;
  country?: string;
  org?: string;
  asn?: string;
  timezone?: string;
  isVpn?: boolean;
  isProxy?: boolean;
  isHosting?: boolean;
  /** No proxy headers on the request (local dev) — IP shown is a loopback placeholder. */
  isLocal?: boolean;
}

interface WebRtcResult {
  publicIPs: string[];
  privateIPs: string[];
  mdnsCount: number;
  error?: string;
}

const PRIVATE_IP_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;

/** How each public address WebRTC revealed compares with the address our server saw. */
export interface WebRtcComparison {
  /** A different address from the one our server saw for the same IP version: the leak. */
  leaked: string[];
  /** The address our server saw, so sites already see it. */
  same: string[];
  /**
   * A different IPv4 in the same /24 as the one our server saw: the same
   * network, not a leak. Mobile carriers (and other large NATs) send each
   * connection out through any address in their pool, so WebRTC's STUN
   * request and the page's own request can leave from neighbouring
   * addresses. Flagged as "Leaking" inside the Incognito Browser app on a
   * mobile network (2026-09-10), with no VPN anywhere.
   */
  sameNetwork: string[];
  /** An IP version our server did not see on this visit, so there is nothing to compare it with. */
  unmatched: string[];
  /**
   * The IP version the server's address was compared as, after `::ffff:a.b.c.d`
   * is read as IPv4. The copy names this, not the raw field: /ip reports a mapped
   * address as 'v6', and the card said "over IPv6 only" for an IPv4 connection.
   * null when there was nothing real to compare with (local dev, no address).
   */
  seenVersion: 'v4' | 'v6' | 'both' | null;
}

/** `::ffff:1.2.3.4` is an IPv4 connection written in IPv6 notation. */
function unmapIPv4(ip: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip.trim());
  return m ? m[1] : ip.trim();
}

/** The /24 an IPv4 address sits in: its first three octets. */
function ipv4Block(ip: string): string {
  return ip.split('.').slice(0, 3).join('.');
}

/**
 * The one leak rule for this page — the verdict, the scorecard and the WebRTC
 * card all read it. A WebRTC address only counts as a leak when it differs
 * from the address our server saw, comparing IPv4 with IPv4 and IPv6 with
 * IPv6. Comparing across versions flagged every dual-stack visitor: the
 * server records one version per request, and WebRTC reports the other one
 * too, with no VPN anywhere.
 *
 * IPv6 compares by /64 network, not exact address: one device routinely holds
 * several addresses in its /64 (privacy extensions rotate the last half), so
 * WebRTC can list a sibling of the address the request used.
 *
 * IPv4 in the same /24 is `sameNetwork`, not a leak: a carrier NAT pool hands
 * the STUN request a neighbour of the address the page request used. A real
 * leak around a VPN is the visitor's own ISP address, which is never in the
 * VPN server's /24.
 */
export function compareWebRtcToServer(
  webrtcPublic: string[],
  server: { ipv4?: string; ipv6?: string; isLocal?: boolean },
): WebRtcComparison {
  // Local dev: the server saw a loopback placeholder, so there is nothing real to compare with.
  let seenV4 = server.isLocal ? undefined : server.ipv4 && unmapIPv4(server.ipv4);
  let seenV6 = server.isLocal ? undefined : server.ipv6 && unmapIPv4(server.ipv6);
  if (seenV6 && isIPv4(seenV6)) {
    seenV4 = seenV4 || seenV6;
    seenV6 = undefined;
  }
  const seenV6Net = seenV6 ? networkOf(seenV6) : null;
  const seenVersion = seenV4 && seenV6Net ? 'both' : seenV4 ? 'v4' : seenV6Net ? 'v6' : null;
  const out: WebRtcComparison = { leaked: [], same: [], sameNetwork: [], unmatched: [], seenVersion };
  for (const raw of webrtcPublic) {
    const ip = unmapIPv4(raw);
    if (isIPv4(ip)) {
      if (!seenV4) out.unmatched.push(raw);
      else if (ip === seenV4) out.same.push(raw);
      else if (ipv4Block(ip) === ipv4Block(seenV4)) out.sameNetwork.push(raw);
      else out.leaked.push(raw);
    } else if (isIPv6(ip)) {
      if (!seenV6Net) out.unmatched.push(raw);
      else if (networkOf(ip) === seenV6Net) out.same.push(raw);
      else out.leaked.push(raw);
    } else {
      out.unmatched.push(raw);
    }
  }
  return out;
}

/** Why the `unmatched` addresses could not be compared, naming the version the server's address was compared as. */
export function unmatchedNote(c: WebRtcComparison, isLocal?: boolean): string {
  const one = c.unmatched.length === 1;
  const it = one ? 'it' : 'them';
  const onVpn = `On a VPN, ${one ? 'this is a leak if it belongs' : 'these are a leak if they belong'} to your own provider rather than the VPN.`;
  if (isLocal) return 'This page is running locally, so there is no public IP to compare with.';
  if (c.seenVersion === 'v4' || c.seenVersion === 'v6') {
    return `Your connection reached our server over ${c.seenVersion === 'v4' ? 'IPv4' : 'IPv6'} only, so there is nothing to compare ${it} with. Without a VPN this is normal: your network has both kinds of address. ${onVpn}`;
  }
  if (c.seenVersion === null) return `Our server could not read your address on this visit, so there is nothing to compare ${it} with. ${onVpn}`;
  // Both versions seen: only an entry that is not an IP address at all is left unmatched.
  return `${one ? 'It is' : 'They are'} not a standard IP address, so there is nothing to compare ${it} with.`;
}

/**
 * WebRTC IP discovery. Browsers gather ICE candidates that include local + public
 * IPs even when the user is behind a VPN. This is the canonical "WebRTC leak"
 * test — if a VPN user sees their real ISP IP here, the VPN isn't patching WebRTC.
 */
async function discoverWebRtcIPs(): Promise<WebRtcResult> {
  if (typeof RTCPeerConnection === 'undefined') {
    return { publicIPs: [], privateIPs: [], mdnsCount: 0, error: 'WebRTC unavailable' };
  }
  const publicIPs = new Set<string>();
  const privateIPs = new Set<string>();
  let mdnsCount = 0;
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });
    pc.createDataChannel('ip-probe');
    // ICE gathering only starts on setLocalDescription(). The handler must be
    // attached first, but the wait must come AFTER the offer is applied —
    // awaiting here before the offer (as this once did) just times out with
    // zero candidates and reports "no leak" to everyone, including leaking VPNs.
    const gathered = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2500);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) { clearTimeout(t); resolve(); return; }
        const cand = ev.candidate.candidate;
        const m = cand.match(/ ([a-f0-9.:]+) \d+ typ (host|srflx|prflx|relay)/i);
        if (!m) return;
        const [, ip, type] = m;
        if (ip.endsWith('.local')) { mdnsCount++; return; }
        if (type === 'srflx' || type === 'prflx') publicIPs.add(ip);
        else if (type === 'host') {
          if (PRIVATE_IP_RE.test(ip)) privateIPs.add(ip);
          else publicIPs.add(ip);
        }
      };
    });
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await gathered;
    pc.close();
  } catch (e) {
    return {
      publicIPs: [],
      privateIPs: [],
      mdnsCount: 0,
      error: e instanceof Error ? e.message : 'WebRTC failed',
    };
  }
  return { publicIPs: [...publicIPs], privateIPs: [...privateIPs], mdnsCount };
}

/** The fields of the POST /ip response (app/ip/route.ts) this page reads. */
interface IpLookup {
  ip: string; version: 'v4' | 'v6'; local: boolean;
  city: string | null; region: string | null; country: string | null; timezone: string | null;
}

/**
 * The /ip response as the page stores it. /ip calls any address with a ':'
 * 'v6', but `::ffff:a.b.c.d` is an IPv4 connection written in IPv6 notation.
 * It is unmapped here, once, and stored as ipv4, so the hero, the leak copy,
 * the headline and the WebRTC comparison all read the same address. Stored
 * as sent, the hero showed "::ffff:203.0.113.7" labelled IPv6.
 */
export function ipInfoFromLookup(d: IpLookup): IpInfo {
  const out: IpInfo = {};
  const ip = unmapIPv4(d.ip);
  if (d.version === 'v6' && !isIPv4(ip)) out.ipv6 = ip; else out.ipv4 = ip;
  if (d.city) out.city = d.city;
  if (d.region) out.region = d.region;
  if (d.country) out.country = d.country;
  if (d.timezone) out.timezone = d.timezone;
  if (d.local) out.isLocal = true;
  return out;
}

/**
 * Fetch the public IP + geolocation from OUR OWN API (POST /ip).
 *
 * Previously this hit api.ipify.org + ipapi.co directly, which (a) shipped
 * every visitor's IP to two third parties from a privacy tool, and (b) was
 * blocked by our CSP connect-src on the Vercel build, so the tool timed out.
 *
 * /ip answers from the inbound request headers only (x-forwarded-for + the
 * geo headers Vercel attaches) — no outbound call, no external dependency.
 * ISP/ASN are intentionally not provided (would need an external database);
 * the UI is conditional on those fields so they simply don't render.
 *
 * API base resolution (shared convention with the cookie scanner):
 *   - server-mode / Vercel: '' → same-origin. No env var, no CORS.
 *   - static export (droplet / WordPress): NEXT_PUBLIC_SCAN_API, defaulted
 *     in next.config.ts to the Vercel API host for BUILD_TARGET=static.
 * Never fall back to a hardcoded hostname — the old default
 * ('https://api.incognitobrowser.io') doesn't resolve and silently broke
 * both tools on Vercel.
 */
const API_BASE = process.env.NEXT_PUBLIC_SCAN_API ?? '';

async function fetchPublicIpInfo(): Promise<IpInfo> {
  const res = await fetch(`${API_BASE}/ip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? 'This page is not allowed to query the IP service (origin not allowlisted).'
        : res.status === 429
          ? 'Too many lookups — wait a minute and refresh.'
          : `IP lookup failed (${res.status}).`,
    );
  }
  return ipInfoFromLookup((await res.json()) as IpLookup);
}

export function WhatsMyIpTool() {
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null);
  const [webrtc, setWebrtc] = useState<WebRtcResult | null>(null);
  const report = useReportResult();
  useEffect(() => {
    if (!ipInfo) { report(null); return; }
    const { leaked } = compareWebRtcToServer(webrtc?.publicIPs || [], ipInfo);
    const where = [ipInfo.city, ipInfo.country].filter(Boolean).join(', ');
    report({
      severity: leaked.length ? 'red' : 'info',
      // The tool can't tell whether a VPN is on, so the headline says what it saw, not "around your VPN".
      headline: leaked.length ? `WebRTC shows a different IP (${leaked[0]}) from the one sites see` : `Every site sees ${ipInfo.ipv4 || ipInfo.ipv6 || 'your IP'}${where ? ` in ${where}` : ''}`,
      shareText: leaked.length ? 'My browser shows sites a second IP through WebRTC. Check yours:' : 'Every site I visit sees my IP and location. Check yours:',
      // stats[0] is the scorecard's big figure: a verdict, not the raw address
      // (an IPv6 does not fit at 120px, and a privacy brand should not put the
      // visitor's real IP in an image it asks them to share — see lib/privacy-mask).
      stats: [
        { label: 'Verdict', value: leaked.length ? 'Leaking' : 'Visible to sites' },
        { label: 'IP', value: maskIp(ipInfo.ipv4 || ipInfo.ipv6) },
        { label: 'Location', value: where || 'unknown' },
        { label: 'WebRTC IPs', value: String(webrtc?.publicIPs.length ?? 0) },
      ],
    });
  }, [ipInfo, webrtc, report]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  // Loading starts true and Refresh sets it again before bumping the tick, so
  // the effect only has to settle it (setState in the effect body is a lint error).
  const refresh = () => {
    setLoading(true);
    setError('');
    setRefreshTick((t) => t + 1);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPublicIpInfo(), discoverWebRtcIPs()])
      .then(([info, rtc]) => {
        if (cancelled) return;
        setIpInfo(info);
        setWebrtc(rtc);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not fetch IP info');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshTick]);

  return (
    <div className="space-y-6">
      {/* Refresh button */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-t2">
          Your public IP, location, and WebRTC leak status.
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs px-3 py-1.5 border border-b1 text-t2 hover:text-white hover:border-b2 rounded transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="bg-s0 border border-b1 rounded-lg p-8 text-center text-t2">
          Looking up your IP and probing for leaks…
        </div>
      )}

      {error && !loading && (
        <div className="bg-s0 border border-danger/30 rounded-lg p-4 text-sm text-danger">{error}</div>
      )}

      {!loading && !error && ipInfo && (() => {
        const comparison = compareWebRtcToServer(webrtc?.publicIPs || [], ipInfo);
        const { leaked, same, sameNetwork, unmatched } = comparison;
        const where = [ipInfo.city, ipInfo.country].filter(Boolean).join(', ');
        return (
        <ConsoleFrame
          engine="whats-my-ip"
          status={statusFromSeverity(leaked.length ? 'red' : 'info')}
          verdict={leaked.length ? 'Leaking' : 'Visible to sites'}
          checks={2}
          statTiles={[
            { label: 'Verdict', value: leaked.length ? 'Leaking' : 'Visible to sites' },
            { label: 'IP', value: maskIp(ipInfo.ipv4 || ipInfo.ipv6) },
            { label: 'Location', value: where || 'unknown' },
            { label: 'WebRTC IPs', value: webrtc?.publicIPs.length ?? 0 },
          ]}
        >
        <>
          {/* Hero — your public IP */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <div className="text-xs uppercase tracking-wider text-t3 mb-2">Your Public IP</div>
            <div className="space-y-2">
              {ipInfo.ipv4 && (
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <code className="text-2xl text-white font-mono break-all select-all">{ipInfo.ipv4}</code>
                  <span className="text-xs text-t2">IPv4</span>
                </div>
              )}
              {ipInfo.ipv6 && (
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <code className="text-base text-white/80 font-mono break-all select-all">{ipInfo.ipv6}</code>
                  <span className="text-xs text-t2">IPv6</span>
                </div>
              )}
              {/* Not a score for this browser: "Exposed" read as the browser failing (tested inside the app, 2026-09-10). */}
              {(ipInfo.ipv4 || ipInfo.ipv6) && !ipInfo.isLocal && (
                <p className="text-xs text-t3">Every browser shows sites this address. Only a VPN, a proxy or Tor changes it.</p>
              )}
              {ipInfo.isLocal && (
                <p className="text-xs text-warn/80">Running locally — no public IP is visible to this server, so a loopback address is shown.</p>
              )}
              {!ipInfo.ipv4 && !ipInfo.ipv6 && (
                <p className="text-sm text-warn">Could not detect your public IP. Refresh, or check that this page is allowed to reach the IP service.</p>
              )}
            </div>
          </div>

          {/* Geolocation + ISP */}
          {(ipInfo.city || ipInfo.country || ipInfo.org) && (
            <div className="bg-s0 border border-b1 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Network &amp; Location</h3>
              <div className="grid grid-cols-2 gap-3 text-sm [&>div]:min-w-0 [&>div]:break-all">
                {ipInfo.city && (
                  <>
                    <div className="text-t2">City</div>
                    <div className="text-white">{ipInfo.city}{ipInfo.region ? `, ${ipInfo.region}` : ''}</div>
                  </>
                )}
                {ipInfo.country && (
                  <>
                    <div className="text-t2">Country</div>
                    <div className="text-white">{ipInfo.country}</div>
                  </>
                )}
                {ipInfo.timezone && (
                  <>
                    <div className="text-t2">Timezone</div>
                    <div className="text-white">{ipInfo.timezone}</div>
                  </>
                )}
                {ipInfo.org && (
                  <>
                    <div className="text-t2">ISP / Org</div>
                    <div className="text-white font-mono text-xs break-all">{ipInfo.org}</div>
                  </>
                )}
                {ipInfo.asn && (
                  <>
                    <div className="text-t2">ASN</div>
                    <div className="text-white font-mono text-xs">{ipInfo.asn}</div>
                  </>
                )}
              </div>
              {ipInfo.isHosting && (
                <div className="mt-4 p-3 bg-info-dim border border-info/30 rounded text-xs text-info flex items-start gap-2">
                  <Icon name="globe" size={14} className="mt-0.5" /> You appear to be connecting through a hosting/cloud provider — this typically means you&apos;re using a VPN, proxy, or are on a server. Your real ISP IP is hidden from sites you visit.
                </div>
              )}
            </div>
          )}

          {/* WebRTC leak check — same rule as the verdict (compareWebRtcToServer):
              only an address that differs from the one our server saw is a leak. */}
          {webrtc && (
            <div className={`bg-s0 border ${
              leaked.length > 0
                ? 'border-danger/30'
                : webrtc.privateIPs.length > 0
                  ? 'border-warn/30'
                  : unmatched.length > 0
                    ? 'border-b1'
                    : 'border-ok/30'
            } rounded-lg p-6`}>
              <h3 className="text-sm font-semibold text-white mb-2">WebRTC Leak Test</h3>
              {webrtc.error ? (
                <p className="text-sm text-t2">
                  WebRTC is unavailable or blocked. <span className="text-ok">Good — sites can&apos;t use it to leak your IP.</span>
                </p>
              ) : (
                <>
                  {leaked.length > 0 && (
                    <div className="text-sm text-danger mb-3">
                      <Icon name="warn" size={14} className="inline-block align-[-2px] mr-1" /> <strong>WebRTC shows a different public IP from the one sites see:</strong> {leaked.join(', ')}
                      <p className="mt-1 text-t2">
                        Sites saw you as {ipInfo.ipv4 || ipInfo.ipv6}, but any page can read {leaked.length === 1 ? 'this address' : 'these addresses'} through WebRTC. On a VPN, that is usually your real address leaking around the tunnel. Use a browser that blocks WebRTC leaks, or a VPN that patches it.
                      </p>
                    </div>
                  )}
                  {same.length > 0 && leaked.length === 0 && (
                    <div className="text-sm text-t2 mb-3">
                      <strong className="text-white">WebRTC shows the same IP sites already see:</strong> {same.join(', ')}
                      <p className="mt-1">
                        {/* Not while an address below is still unchecked: "no extra address leaks" then contradicted it. */}
                        {unmatched.length === 0 ? 'No extra address leaks through WebRTC. ' : ''}On a VPN, check that the IP at the top is your VPN&apos;s and not your own.
                      </p>
                    </div>
                  )}
                  {sameNetwork.length > 0 && leaked.length === 0 && (
                    <div className="text-sm text-t2 mb-3">
                      <strong className="text-white">WebRTC shows a neighbouring address on the same network:</strong> {sameNetwork.join(', ')}
                      <p className="mt-1">
                        Mobile carriers and other large networks share a block of public addresses, so a second connection can leave through a different address in the same block as the one at the top. That is the network sites already see, not a leak.
                      </p>
                    </div>
                  )}
                  {unmatched.length > 0 && (
                    <div className="text-sm text-t2 mb-3">
                      <strong className="text-white">WebRTC also shows {unmatched.length === 1 ? 'this address' : 'these addresses'}:</strong> {unmatched.join(', ')}
                      <p className="mt-1">{unmatchedNote(comparison, ipInfo.isLocal)}</p>
                    </div>
                  )}
                  {webrtc.privateIPs.length > 0 && (
                    <div className="text-sm text-warn mb-3">
                      Private/LAN IPs exposed: <code className="text-xs">{webrtc.privateIPs.slice(0, 3).join(', ')}{webrtc.privateIPs.length > 3 ? '…' : ''}</code>
                      <p className="mt-1 text-t2">
                        These are addresses on your local network, handed out by your router. Sites can&apos;t reach you with them, but they still help fingerprint your device.
                      </p>
                    </div>
                  )}
                  {webrtc.mdnsCount > 0 && (
                    <p className="text-xs text-ok/80 mb-2">
                      <Icon name="check" size={12} className="inline-block align-[-2px] mr-1" /> Browser is masking {webrtc.mdnsCount} local IP{webrtc.mdnsCount === 1 ? '' : 's'} as mDNS (.local) — good privacy posture.
                    </p>
                  )}
                  {webrtc.publicIPs.length === 0 && webrtc.privateIPs.length === 0 && (
                    <p className="text-sm text-ok"><Icon name="check" size={14} className="inline-block align-[-2px] mr-1" /> No WebRTC leak detected. Sites cannot use this vector to discover your IPs.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Info */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-2">What can sites do with this?</h3>
            <ul className="space-y-2 text-sm text-t2">
              <li>• <strong className="text-white">Approximate your location</strong> (city-level accuracy from IP geolocation).</li>
              <li>• <strong className="text-white">Identify your ISP</strong> and infer whether you&apos;re on residential, mobile, or business connection.</li>
              <li>• <strong className="text-white">Block or restrict you</strong> based on country (geo-fencing).</li>
              <li>• <strong className="text-white">Track you across sessions</strong> when combined with browser fingerprinting.</li>
              <li>• <strong className="text-white">Defeat your VPN</strong> if WebRTC leaks your real IP.</li>
            </ul>
            <p className="mt-3 text-xs text-t3">
              To hide your IP from sites: use a reputable VPN or Tor browser. Verify your VPN doesn&apos;t leak by re-running this tool while connected.
            </p>
          </div>
        </>
        </ConsoleFrame>
        );
      })()}
    </div>
  );
}
