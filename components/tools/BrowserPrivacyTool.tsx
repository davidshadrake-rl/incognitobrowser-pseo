'use client';

import { useState } from 'react';

interface PrivacyCheck {
  name: string;
  category: string;
  status: 'good' | 'warning' | 'bad' | 'info';
  value: string;
  detail: string;
}

// ------- Helpers (module-level; no React state) -------

// Short SHA-256 hex for fingerprint display.
async function fastHashHex(input: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

const PRIVATE_IP_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;

/** WebRTC STUN-based IP gathering. Returns {publicIPs, privateIPs}. Times out after 2.5s. */
async function detectWebRtcLeaks(): Promise<{ publicIPs: string[]; privateIPs: string[]; error?: string }> {
  if (typeof RTCPeerConnection === 'undefined') return { publicIPs: [], privateIPs: [], error: 'unsupported' };
  const publicIPs = new Set<string>();
  const privateIPs = new Set<string>();
  const mdnsSeen = new Set<string>();

  try {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
    });
    pc.createDataChannel('leak-test');

    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(() => { resolve(); }, 2500);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) { clearTimeout(timer); resolve(); return; }
        const cand = ev.candidate.candidate;
        // SDP candidate format: candidate:... 1 UDP 2122252543 192.0.2.1 54321 typ host/srflx
        const m = cand.match(/ ([a-f0-9.:]+) \d+ typ (host|srflx|prflx|relay)/i);
        if (!m) return;
        const [, ip, type] = m;
        // Chrome masks local IPs as mDNS (*.local) — flag but don't count as private.
        if (ip.endsWith('.local')) { mdnsSeen.add(ip); return; }
        if (type === 'srflx' || type === 'prflx') publicIPs.add(ip);
        else if (type === 'host') {
          if (PRIVATE_IP_RE.test(ip)) privateIPs.add(ip);
          else publicIPs.add(ip); // host-type with a non-private IP = public IP leak
        }
      };
    });

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    await done;
    pc.close();
  } catch (e) {
    return { publicIPs: [], privateIPs: [], error: e instanceof Error ? e.message : 'failed' };
  }

  return { publicIPs: [...publicIPs], privateIPs: [...privateIPs] };
}

/** Compute a hash of an OfflineAudioContext rendering — a classic fingerprint vector. */
async function audioFingerprintHash(): Promise<string> {
  try {
    const OfflineCtor = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
      || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineCtor) return '';
    const ctx = new OfflineCtor(1, 44100, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(10000, ctx.currentTime);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-50, ctx.currentTime);
    compressor.knee.setValueAtTime(40, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);
    osc.connect(compressor);
    compressor.connect(ctx.destination);
    osc.start(0);
    const buffer = await ctx.startRendering();
    const samples = buffer.getChannelData(0).slice(4500, 5000);
    let sum = 0;
    for (const s of samples) sum += Math.abs(s);
    return fastHashHex(sum.toString());
  } catch {
    return '';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'good': return '✓';
    case 'warning': return '⚠';
    case 'bad': return '✗';
    default: return 'ℹ';
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'good': return 'text-green-400';
    case 'warning': return 'text-yellow-400';
    case 'bad': return 'text-red-400';
    default: return 'text-blue-400';
  }
}

function getBorderColor(status: string) {
  switch (status) {
    case 'good': return 'border-green-500/20';
    case 'warning': return 'border-yellow-500/20';
    case 'bad': return 'border-red-500/20';
    default: return 'border-blue-500/20';
  }
}

export function BrowserPrivacyTool() {
  const [checks, setChecks] = useState<PrivacyCheck[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);

  const runAudit = async () => {
    setScanning(true);
    setChecks([]);

    // Start async tests in parallel before the synchronous block
    const webrtcPromise = detectWebRtcLeaks();
    const audioPromise = audioFingerprintHash();

    // Small delay for UX, then gather everything
    await new Promise((r) => setTimeout(r, 400));
    const webrtcResult = await webrtcPromise;
    const audioHash = await audioPromise;

    const runSync = async () => {
      const results: PrivacyCheck[] = [];

      // 1. Do Not Track
      const dnt = navigator.doNotTrack || (window as unknown as Record<string, unknown>).doNotTrack;
      results.push({
        name: 'Do Not Track',
        category: 'Tracking',
        status: dnt === '1' ? 'good' : 'warning',
        value: dnt === '1' ? 'Enabled' : 'Not enabled',
        detail: dnt === '1'
          ? 'Your browser is sending the DNT header requesting sites not track you.'
          : 'Enable Do Not Track in your browser settings. Note: sites are not required to honor this.',
      });

      // 2. Cookies
      results.push({
        name: 'Cookies',
        category: 'Tracking',
        status: navigator.cookieEnabled ? 'warning' : 'good',
        value: navigator.cookieEnabled ? 'Enabled' : 'Disabled',
        detail: navigator.cookieEnabled
          ? 'Cookies are enabled. Sites can store tracking data. Consider using a cookie blocker.'
          : 'Cookies are disabled. This improves privacy but may break some websites.',
      });

      // 3. JavaScript (always true since we're running JS)
      results.push({
        name: 'JavaScript',
        category: 'Fingerprinting',
        status: 'info',
        value: 'Enabled',
        detail: 'JavaScript is enabled (this tool requires it). JS enables fingerprinting techniques.',
      });

      // 4. Screen resolution
      const screenRes = `${screen.width}×${screen.height}`;
      const commonRes = ['1920×1080', '1366×768', '1536×864', '1440×900', '1280×720'];
      results.push({
        name: 'Screen Resolution',
        category: 'Fingerprinting',
        status: commonRes.includes(screenRes) ? 'info' : 'warning',
        value: screenRes,
        detail: commonRes.includes(screenRes)
          ? 'Your screen resolution is common, making you harder to fingerprint by this metric.'
          : 'Your screen resolution is uncommon, which could help uniquely identify your browser.',
      });

      // 5. Platform
      const platform = navigator.platform || 'Unknown';
      results.push({
        name: 'Platform',
        category: 'Fingerprinting',
        status: 'info',
        value: platform,
        detail: `Your reported platform is "${platform}". This contributes to your browser fingerprint.`,
      });

      // 6. Language
      const lang = navigator.language;
      const langs = navigator.languages?.length || 1;
      results.push({
        name: 'Language',
        category: 'Fingerprinting',
        status: langs > 3 ? 'warning' : 'info',
        value: `${lang} (+${langs - 1} others)`,
        detail: langs > 3
          ? `Multiple languages configured (${langs}). More languages = more unique fingerprint.`
          : `Primary language: ${lang}. This is a common configuration.`,
      });

      // 7. Timezone
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      results.push({
        name: 'Timezone',
        category: 'Fingerprinting',
        status: 'info',
        value: tz,
        detail: `Your timezone "${tz}" is visible to websites and contributes to fingerprinting.`,
      });

      // 8. Hardware concurrency
      const cores = navigator.hardwareConcurrency;
      results.push({
        name: 'CPU Cores',
        category: 'Fingerprinting',
        status: cores ? 'info' : 'good',
        value: cores ? `${cores} cores` : 'Hidden',
        detail: cores
          ? `Your CPU has ${cores} logical cores. This hardware detail helps fingerprint your device.`
          : 'CPU core count is hidden — good for privacy.',
      });

      // 9. Device memory
      const mem = (navigator as unknown as Record<string, unknown>).deviceMemory as number | undefined;
      results.push({
        name: 'Device Memory',
        category: 'Fingerprinting',
        status: mem ? 'warning' : 'good',
        value: mem ? `${mem} GB` : 'Hidden',
        detail: mem
          ? `Your device reports ${mem}GB of memory. This API leaks hardware information.`
          : 'Device memory API is not exposed — good for privacy.',
      });

      // 10. WebRTC real-IP leak test
      if (webrtcResult.error) {
        results.push({
          name: 'WebRTC IP Leak',
          category: 'Leaks',
          status: 'good',
          value: 'Blocked / unavailable',
          detail: 'WebRTC STUN gathering failed or is blocked. Your real IP cannot leak via this vector.',
        });
      } else {
        const hasPublic = webrtcResult.publicIPs.length > 0;
        const hasPrivate = webrtcResult.privateIPs.length > 0;
        let status: PrivacyCheck['status'] = 'good';
        const pieces: string[] = [];
        if (hasPublic) {
          status = 'bad';
          pieces.push(`Public IP(s): ${webrtcResult.publicIPs.join(', ')}`);
        }
        if (hasPrivate) {
          status = status === 'bad' ? 'bad' : 'warning';
          pieces.push(`Private IP(s): ${webrtcResult.privateIPs.slice(0, 3).join(', ')}${webrtcResult.privateIPs.length > 3 ? '…' : ''}`);
        }
        results.push({
          name: 'WebRTC IP Leak',
          category: 'Leaks',
          status,
          value: hasPublic ? 'Public IP exposed' : hasPrivate ? 'Private IP only' : 'No leaks',
          detail: hasPublic
            ? `WebRTC is leaking your real IP. Even behind a VPN, sites can see: ${pieces.join(' | ')}. Use a browser WebRTC blocker or a VPN that patches WebRTC.`
            : hasPrivate
              ? `Only RFC1918 addresses exposed (${pieces.join(' | ')}). Less severe but still a fingerprint signal.`
              : 'No IPs gathered — good.',
        });
      }

      // 11. Canvas fingerprint: hash the rendered pixels and report the fingerprint.
      // A short hash means canvas is disabled/blocked; a long/stable hash means
      // the browser produces a device-specific image that sites can use to track.
      let canvasHash = '';
      let canvasBlocked = false;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.textBaseline = 'top';
          ctx.font = '14px "Arial"';
          ctx.fillStyle = '#f60';
          ctx.fillRect(125, 1, 62, 20);
          ctx.fillStyle = '#069';
          ctx.fillText('Privacy 🔒 canvas', 2, 15);
          ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
          ctx.fillText('Privacy 🔒 canvas', 4, 17);
          const data = canvas.toDataURL();
          if (data === 'data:,' || data.length < 100) canvasBlocked = true;
          else canvasHash = await fastHashHex(data);
        }
      } catch {
        canvasBlocked = true;
      }
      results.push({
        name: 'Canvas Fingerprint',
        category: 'Fingerprinting',
        status: canvasBlocked ? 'good' : 'warning',
        value: canvasBlocked ? 'Blocked' : canvasHash.slice(0, 12),
        detail: canvasBlocked
          ? 'Canvas API returns empty data — blocked by your browser or extension.'
          : `Your browser produces a repeatable canvas fingerprint (hash: ${canvasHash.slice(0, 16)}…). Sites use this signature to recognize you across visits. Consider Firefox's resistFingerprinting or a canvas-blocker extension.`,
      });

      // 11b. Audio fingerprint
      results.push({
        name: 'Audio Fingerprint',
        category: 'Fingerprinting',
        status: audioHash ? 'warning' : 'good',
        value: audioHash ? audioHash.slice(0, 12) : 'Blocked',
        detail: audioHash
          ? `Your AudioContext produces a repeatable signal signature (hash: ${audioHash.slice(0, 16)}…) — another fingerprinting vector.`
          : 'AudioContext fingerprinting is blocked or unavailable.',
      });

      // 12. Third-party cookie support check
      results.push({
        name: 'User Agent',
        category: 'Fingerprinting',
        status: 'info',
        value: navigator.userAgent.length > 60 ? `${navigator.userAgent.substring(0, 57)}...` : navigator.userAgent,
        detail: `Your full user agent string is ${navigator.userAgent.length} characters long. Longer strings are more unique.`,
      });

      // 13. Touch support
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      results.push({
        name: 'Touch Support',
        category: 'Fingerprinting',
        status: 'info',
        value: hasTouch ? `Yes (${navigator.maxTouchPoints} points)` : 'No',
        detail: hasTouch
          ? `Touch is supported with ${navigator.maxTouchPoints} touch points. This narrows down your device type.`
          : 'No touch support detected. This indicates a desktop/laptop device.',
      });

      // 14. PDF viewer
      const hasPDF = navigator.pdfViewerEnabled !== undefined ? navigator.pdfViewerEnabled : true;
      results.push({
        name: 'PDF Viewer',
        category: 'Fingerprinting',
        status: 'info',
        value: hasPDF ? 'Built-in' : 'External',
        detail: 'The PDF viewer configuration contributes to your browser fingerprint.',
      });

      // Calculate score
      let s = 100;
      for (const check of results) {
        if (check.status === 'bad') s -= 15;
        if (check.status === 'warning') s -= 7;
      }
      s = Math.max(0, Math.min(100, s));

      setChecks(results);
      setScore(s);
      setScanning(false);
    };
    runSync();
  };

  const categories = [...new Set(checks.map(c => c.category))];

  return (
    <div className="space-y-6">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 text-center">
        <p className="text-[#B8B8D4] mb-4">
          Analyze your browser&apos;s privacy configuration and fingerprinting exposure.
        </p>
        <button
          onClick={runAudit}
          disabled={scanning}
          className="btn-primary px-8 py-3"
        >
          {scanning ? 'Scanning...' : 'Run Privacy Audit'}
        </button>
        <p className="mt-3 text-xs text-[#B8B8D4]/60">
          All checks run locally in your browser. Nothing is sent to any server.
        </p>
      </div>

      {score !== null && (
        <>
          {/* Score */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-lg font-bold text-white">Privacy Score</span>
              <span className="text-3xl font-bold" style={{
                color: score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444'
              }}>{score}/100</span>
            </div>
            <div className="h-3 bg-[#191b1c] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${score}%`,
                  backgroundColor: score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444'
                }}
              />
            </div>
            <div className="mt-3 flex gap-4 text-xs text-[#B8B8D4]">
              <span className="text-green-400">{checks.filter(c => c.status === 'good').length} Good</span>
              <span className="text-yellow-400">{checks.filter(c => c.status === 'warning').length} Warnings</span>
              <span className="text-red-400">{checks.filter(c => c.status === 'bad').length} Issues</span>
              <span className="text-blue-400">{checks.filter(c => c.status === 'info').length} Info</span>
            </div>
          </div>

          {/* Results by category */}
          {categories.map(cat => (
            <div key={cat}>
              <h3 className="text-sm font-semibold text-[#B8B8D4] uppercase tracking-wider mb-3">{cat}</h3>
              <div className="space-y-2">
                {checks.filter(c => c.category === cat).map((check, i) => (
                  <div key={i} className={`bg-[#0a0a0a] border ${getBorderColor(check.status)} rounded-lg p-4`}>
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`${getStatusColor(check.status)} text-sm`}>{getStatusIcon(check.status)}</span>
                        <span className="text-sm font-medium text-white">{check.name}</span>
                      </div>
                      <span className="text-sm font-mono text-[#B8B8D4]">{check.value}</span>
                    </div>
                    <p className="text-xs text-[#B8B8D4]/80 ml-6">{check.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
