'use client';

import { useEffect, useState } from 'react';

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
 * Fetch the public IP + geolocation/ASN from a free third-party API.
 * ipapi.co allows ~30 req/day without an API key. If you outgrow this, swap for
 * ipinfo.io (50k/month free) by changing the URL — both return compatible JSON.
 */
async function fetchPublicIpInfo(): Promise<IpInfo> {
  // Two parallel requests:
  //   1. ipify for the raw IP (super reliable, no rate limit, no metadata)
  //   2. ipapi.co for ISP/geolocation/VPN detection
  // We can return after both settle and merge what we got.
  const [ipResult, infoResult] = await Promise.allSettled([
    fetch('https://api.ipify.org?format=json').then((r) => r.json()),
    fetch('https://ipapi.co/json/').then((r) => r.json()),
  ]);

  const out: IpInfo = {};

  if (ipResult.status === 'fulfilled' && ipResult.value?.ip) {
    const ip = ipResult.value.ip as string;
    if (ip.includes(':')) out.ipv6 = ip;
    else out.ipv4 = ip;
  }

  if (infoResult.status === 'fulfilled') {
    const d = infoResult.value as Record<string, unknown>;
    // ipapi.co returns 'ip' which may be v4 or v6
    if (typeof d.ip === 'string' && !out.ipv4 && !out.ipv6) {
      if (d.ip.includes(':')) out.ipv6 = d.ip;
      else out.ipv4 = d.ip;
    }
    if (typeof d.city === 'string') out.city = d.city;
    if (typeof d.region === 'string') out.region = d.region;
    if (typeof d.country_name === 'string') out.country = d.country_name;
    if (typeof d.org === 'string') out.org = d.org;
    if (typeof d.asn === 'string') out.asn = d.asn;
    if (typeof d.timezone === 'string') out.timezone = d.timezone;
    // ipapi.co doesn't have explicit VPN flags on free tier — we can heuristically
    // detect hosting providers (Vercel, AWS, DigitalOcean) by ASN/org strings.
    const orgLower = (d.org as string | undefined)?.toLowerCase() || '';
    out.isHosting = /digitalocean|amazon|aws|google cloud|gcp|microsoft|azure|vercel|cloudflare|linode|hetzner|ovh|vultr/.test(orgLower);
  }

  return out;
}

export function WhatsMyIpTool() {
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null);
  const [webrtc, setWebrtc] = useState<WebRtcResult | null>(null);
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
          Your public IP, ISP, location, and WebRTC leak status. All checks run live in your browser.
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
              {!ipInfo.ipv4 && !ipInfo.ipv6 && (
                <p className="text-sm text-yellow-400">Could not detect your public IP. The lookup service may be rate-limited or blocked by your network.</p>
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
                        Even when using a VPN, sites can read these via WebRTC unless your VPN patches the API. Use a WebRTC blocker extension or switch to a VPN that specifically blocks this.
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
