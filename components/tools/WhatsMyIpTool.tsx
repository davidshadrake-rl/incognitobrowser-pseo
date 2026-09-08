'use client';

import { useEffect, useState } from 'react';
import { useReportResult } from './ResultContext';

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
    await new Promise<void>((resolve) => {
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
  const d = (await res.json()) as {
    ip: string; version: 'v4' | 'v6'; local: boolean;
    city: string | null; region: string | null; country: string | null; timezone: string | null;
  };
  const out: IpInfo = {};
  if (d.version === 'v6') out.ipv6 = d.ip; else out.ipv4 = d.ip;
  if (d.city) out.city = d.city;
  if (d.region) out.region = d.region;
  if (d.country) out.country = d.country;
  if (d.timezone) out.timezone = d.timezone;
  if (d.local) out.isLocal = true;
  return out;
}

export function WhatsMyIpTool() {
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null);
  const [webrtc, setWebrtc] = useState<WebRtcResult | null>(null);
  const report = useReportResult();
  useEffect(() => {
    if (!ipInfo) { report(null); return; }
    const seen = [ipInfo.ipv4, ipInfo.ipv6].filter(Boolean) as string[];
    const leaked = (webrtc?.publicIPs || []).filter((ip) => !seen.includes(ip));
    const where = [ipInfo.city, ipInfo.country].filter(Boolean).join(', ');
    report({
      severity: leaked.length ? 'red' : 'info',
      headline: leaked.length ? `WebRTC leaks your real IP ${leaked[0]} around your VPN` : `Every site sees ${ipInfo.ipv4 || ipInfo.ipv6 || 'your IP'}${where ? ` in ${where}` : ''}`,
      shareText: leaked.length ? 'My browser leaks my real IP through WebRTC. Check yours:' : 'Every site I visit sees my IP and location. Check yours:',
      stats: [{ label: 'IP', value: ipInfo.ipv4 || ipInfo.ipv6 || '?' }, { label: 'Location', value: where || 'unknown' }, { label: 'Network', value: ipInfo.org || ipInfo.asn || 'unknown' }, { label: 'WebRTC IPs', value: String(webrtc?.publicIPs.length ?? 0) }],
    });
  }, [ipInfo, webrtc, report]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
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

  const hasIp = ipInfo && (ipInfo.ipv4 || ipInfo.ipv6);
  const publicIpLeak =
    webrtc && hasIp && webrtc.publicIPs.some((ip) => ip === ipInfo?.ipv4 || ip === ipInfo?.ipv6);
  const realIpLeakedViaWebrtc = webrtc && webrtc.publicIPs.length > 0;

  return (
    <div className="space-y-6">
      {/* Refresh button */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-[#B8B8D4]">
          Your public IP, location, and WebRTC leak status. The IP is read from the request our own server sees — nothing is sent to third-party lookup services.
        </div>
        <button
          onClick={() => setRefreshTick((t) => t + 1)}
          disabled={loading}
          className="text-xs px-3 py-1.5 border border-white/10 text-[#B8B8D4] hover:text-white hover:border-white/30 rounded transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-8 text-center text-[#B8B8D4]">
          Looking up your IP and probing for leaks…
        </div>
      )}

      {error && !loading && (
        <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-sm text-red-400">{error}</div>
      )}

      {!loading && !error && ipInfo && (
        <>
          {/* Hero — your public IP */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <div className="text-xs uppercase tracking-wider text-[#B8B8D4]/60 mb-2">Your Public IP</div>
            <div className="space-y-2">
              {ipInfo.ipv4 && (
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <code className="text-2xl text-white font-mono break-all select-all">{ipInfo.ipv4}</code>
                  <span className="text-xs text-[#B8B8D4]">IPv4</span>
                </div>
              )}
              {ipInfo.ipv6 && (
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <code className="text-base text-white/80 font-mono break-all select-all">{ipInfo.ipv6}</code>
                  <span className="text-xs text-[#B8B8D4]">IPv6</span>
                </div>
              )}
              {ipInfo.isLocal && (
                <p className="text-xs text-yellow-400/80">Running locally — no public IP is visible to this server, so a loopback address is shown.</p>
              )}
              {!ipInfo.ipv4 && !ipInfo.ipv6 && (
                <p className="text-sm text-yellow-400">Could not detect your public IP. Refresh, or check that this page is allowed to reach the IP service.</p>
              )}
            </div>
          </div>

          {/* Geolocation + ISP */}
          {(ipInfo.city || ipInfo.country || ipInfo.org) && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Network &amp; Location</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {ipInfo.city && (
                  <>
                    <div className="text-[#B8B8D4]">City</div>
                    <div className="text-white">{ipInfo.city}{ipInfo.region ? `, ${ipInfo.region}` : ''}</div>
                  </>
                )}
                {ipInfo.country && (
                  <>
                    <div className="text-[#B8B8D4]">Country</div>
                    <div className="text-white">{ipInfo.country}</div>
                  </>
                )}
                {ipInfo.timezone && (
                  <>
                    <div className="text-[#B8B8D4]">Timezone</div>
                    <div className="text-white">{ipInfo.timezone}</div>
                  </>
                )}
                {ipInfo.org && (
                  <>
                    <div className="text-[#B8B8D4]">ISP / Org</div>
                    <div className="text-white font-mono text-xs break-all">{ipInfo.org}</div>
                  </>
                )}
                {ipInfo.asn && (
                  <>
                    <div className="text-[#B8B8D4]">ASN</div>
                    <div className="text-white font-mono text-xs">{ipInfo.asn}</div>
                  </>
                )}
              </div>
              {ipInfo.isHosting && (
                <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded text-xs text-blue-400">
                  📡 You appear to be connecting through a hosting/cloud provider — this typically means you&apos;re using a VPN, proxy, or are on a server. Your real ISP IP is hidden from sites you visit.
                </div>
              )}
            </div>
          )}

          {/* WebRTC leak check */}
          {webrtc && (
            <div className={`bg-[#0a0a0a] border ${
              publicIpLeak || realIpLeakedViaWebrtc
                ? 'border-red-500/30'
                : webrtc.privateIPs.length > 0
                  ? 'border-yellow-500/30'
                  : 'border-green-500/20'
            } rounded-lg p-6`}>
              <h3 className="text-sm font-semibold text-white mb-2">WebRTC Leak Test</h3>
              {webrtc.error ? (
                <p className="text-sm text-[#B8B8D4]">
                  WebRTC is unavailable or blocked. <span className="text-green-400">Good — sites can&apos;t use it to leak your IP.</span>
                </p>
              ) : (
                <>
                  {realIpLeakedViaWebrtc && (
                    <div className="text-sm text-red-400 mb-3">
                      ⚠️ <strong>WebRTC is leaking public IPs:</strong> {webrtc.publicIPs.join(', ')}
                      <p className="mt-1 text-[#B8B8D4]">
                        Even when using a VPN, sites can read these via WebRTC unless your VPN patches the API. Use a browser that patches WebRTC, or a VPN that specifically blocks this.
                      </p>
                    </div>
                  )}
                  {webrtc.privateIPs.length > 0 && (
                    <div className="text-sm text-yellow-400 mb-3">
                      Private/LAN IPs exposed: <code className="text-xs">{webrtc.privateIPs.slice(0, 3).join(', ')}{webrtc.privateIPs.length > 3 ? '…' : ''}</code>
                      <p className="mt-1 text-[#B8B8D4]">
                        These are RFC1918 addresses from your local network. Less severe than public-IP leaks, but they still help fingerprint you.
                      </p>
                    </div>
                  )}
                  {webrtc.mdnsCount > 0 && (
                    <p className="text-xs text-green-400/80 mb-2">
                      ✓ Browser is masking {webrtc.mdnsCount} local IP{webrtc.mdnsCount === 1 ? '' : 's'} as mDNS (.local) — good privacy posture.
                    </p>
                  )}
                  {!realIpLeakedViaWebrtc && webrtc.privateIPs.length === 0 && (
                    <p className="text-sm text-green-400">✓ No WebRTC leak detected. Sites cannot use this vector to discover your IPs.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Info */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-2">What can sites do with this?</h3>
            <ul className="space-y-2 text-sm text-[#B8B8D4]">
              <li>• <strong className="text-white">Approximate your location</strong> (city-level accuracy from IP geolocation).</li>
              <li>• <strong className="text-white">Identify your ISP</strong> and infer whether you&apos;re on residential, mobile, or business connection.</li>
              <li>• <strong className="text-white">Block or restrict you</strong> based on country (geo-fencing).</li>
              <li>• <strong className="text-white">Track you across sessions</strong> when combined with browser fingerprinting.</li>
              <li>• <strong className="text-white">Defeat your VPN</strong> if WebRTC leaks your real IP.</li>
            </ul>
            <p className="mt-3 text-xs text-[#B8B8D4]/60">
              To hide your IP from sites: use a reputable VPN or Tor browser. Verify your VPN doesn&apos;t leak by re-running this tool while connected.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
