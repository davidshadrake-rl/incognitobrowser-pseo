'use client';

import { useState, useEffect } from 'react';

interface PrivacyCheck {
  name: string;
  category: string;
  status: 'good' | 'warning' | 'bad' | 'info';
  value: string;
  detail: string;
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

  const runAudit = () => {
    setScanning(true);
    setChecks([]);

    // Small delay for UX
    setTimeout(() => {
      const results: PrivacyCheck[] = [];

      // 1. Do Not Track
      const dnt = navigator.doNotTrack || (window as Record<string, unknown>).doNotTrack;
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
      const mem = (navigator as Record<string, unknown>).deviceMemory as number | undefined;
      results.push({
        name: 'Device Memory',
        category: 'Fingerprinting',
        status: mem ? 'warning' : 'good',
        value: mem ? `${mem} GB` : 'Hidden',
        detail: mem
          ? `Your device reports ${mem}GB of memory. This API leaks hardware information.`
          : 'Device memory API is not exposed — good for privacy.',
      });

      // 10. WebRTC potential
      const hasRTC = typeof RTCPeerConnection !== 'undefined';
      results.push({
        name: 'WebRTC',
        category: 'Leaks',
        status: hasRTC ? 'warning' : 'good',
        value: hasRTC ? 'Available' : 'Blocked',
        detail: hasRTC
          ? 'WebRTC is available and can leak your real IP address even behind a VPN. Use a WebRTC blocker.'
          : 'WebRTC is blocked. Your real IP cannot be leaked via this vector.',
      });

      // 11. Canvas fingerprinting potential
      let canvasUnique = false;
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillText('Privacy test 🔒', 2, 2);
          const data = canvas.toDataURL();
          canvasUnique = data.length > 100;
        }
      } catch {
        canvasUnique = false;
      }
      results.push({
        name: 'Canvas Fingerprint',
        category: 'Fingerprinting',
        status: canvasUnique ? 'warning' : 'good',
        value: canvasUnique ? 'Detectable' : 'Protected',
        detail: canvasUnique
          ? 'Your browser generates a unique canvas fingerprint. Consider using canvas blocking extensions.'
          : 'Canvas fingerprinting appears to be blocked or randomized.',
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
    }, 800);
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
