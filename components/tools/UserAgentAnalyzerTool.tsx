'use client';

import { useEffect, useState } from 'react';
import { useReportResult } from './ResultContext';

interface UADetails {
  raw: string;
  browser: { name: string; version: string };
  engine: { name: string; version: string };
  os: { name: string; version: string };
  device: string;
  is64bit: boolean;
  isMobile: boolean;
  privacyConcerns: string[];
  uniquenessFactors: string[];
}

interface ClientHints {
  brands: string;
  fullVersion: string;
  platformVersion: string;
  architecture: string;
  bitness: string;
  model: string;
  wow64: string;
}

function parseUserAgent(ua: string): UADetails {
  const result: UADetails = {
    raw: ua,
    browser: { name: 'Unknown', version: '' },
    engine: { name: 'Unknown', version: '' },
    os: { name: 'Unknown', version: '' },
    device: 'Desktop',
    is64bit: false,
    isMobile: false,
    privacyConcerns: [],
    uniquenessFactors: [],
  };

  // Browser detection (order matters — Edge/Opera/Brave identify as Chrome)
  if (/Edg\/(\d+[\.\d]*)/.test(ua)) {
    result.browser = { name: 'Microsoft Edge', version: ua.match(/Edg\/(\d+[\.\d]*)/)![1] };
  } else if (/OPR\/(\d+[\.\d]*)/.test(ua)) {
    result.browser = { name: 'Opera', version: ua.match(/OPR\/(\d+[\.\d]*)/)![1] };
  } else if (/Brave/i.test(ua)) {
    const m = ua.match(/Chrome\/(\d+[\.\d]*)/);
    result.browser = { name: 'Brave', version: m ? m[1] : '' };
  } else if (/Chrome\/(\d+[\.\d]*)/.test(ua) && !/Chromium/.test(ua)) {
    result.browser = { name: 'Chrome', version: ua.match(/Chrome\/(\d+[\.\d]*)/)![1] };
  } else if (/Firefox\/(\d+[\.\d]*)/.test(ua)) {
    result.browser = { name: 'Firefox', version: ua.match(/Firefox\/(\d+[\.\d]*)/)![1] };
  } else if (/Safari\/(\d+[\.\d]*)/.test(ua) && /Version\/(\d+[\.\d]*)/.test(ua)) {
    result.browser = { name: 'Safari', version: ua.match(/Version\/(\d+[\.\d]*)/)![1] };
  }

  // Engine
  if (/AppleWebKit\/(\d+[\.\d]*)/.test(ua)) {
    result.engine = { name: 'WebKit/Blink', version: ua.match(/AppleWebKit\/(\d+[\.\d]*)/)![1] };
  } else if (/Gecko\/(\d+)/.test(ua)) {
    result.engine = { name: 'Gecko', version: ua.match(/Gecko\/(\d+)/)![1] };
  }

  // OS
  if (/Windows NT (\d+\.\d+)/.test(ua)) {
    const ver = ua.match(/Windows NT (\d+\.\d+)/)![1];
    const winVer: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    result.os = { name: 'Windows', version: winVer[ver] || ver };
  } else if (/Mac OS X (\d+[._]\d+[._]?\d*)/.test(ua)) {
    result.os = { name: 'macOS', version: ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/)![1].replace(/_/g, '.') };
  } else if (/Android (\d+[\.\d]*)/.test(ua)) {
    result.os = { name: 'Android', version: ua.match(/Android (\d+[\.\d]*)/)![1] };
    result.isMobile = true;
    result.device = 'Mobile';
  } else if (/iPhone|iPad/.test(ua)) {
    const ver = ua.match(/OS (\d+_\d+[_\d]*)/);
    result.os = { name: 'iOS', version: ver ? ver[1].replace(/_/g, '.') : '' };
    result.isMobile = true;
    result.device = /iPad/.test(ua) ? 'Tablet' : 'Mobile';
  } else if (/Linux/.test(ua)) {
    result.os = { name: 'Linux', version: '' };
  } else if (/CrOS/.test(ua)) {
    result.os = { name: 'Chrome OS', version: '' };
  }

  result.is64bit = /x86_64|x64|Win64|WOW64|aarch64|arm64/.test(ua);

  // Privacy concerns
  if (result.browser.name === 'Chrome') {
    result.privacyConcerns.push('Chrome sends telemetry data to Google by default');
    result.privacyConcerns.push('Consider switching to Brave, Firefox, or Incognito Browser');
  }
  if (result.browser.name === 'Microsoft Edge') {
    result.privacyConcerns.push('Edge sends diagnostic data to Microsoft');
  }

  const mainVer = parseInt(result.browser.version, 10);
  const MIN_VERSION: Record<string, number> = { Chrome: 130, Firefox: 130, 'Microsoft Edge': 130, Safari: 17 };
  const threshold = MIN_VERSION[result.browser.name];
  if (threshold && mainVer && mainVer < threshold) {
    result.privacyConcerns.push(`${result.browser.name} ${mainVer} is outdated — update for security patches`);
  }

  result.uniquenessFactors.push(`Browser: ${result.browser.name} ${result.browser.version}`);
  result.uniquenessFactors.push(`OS: ${result.os.name} ${result.os.version}`);
  result.uniquenessFactors.push(`Platform: ${result.device}`);
  result.uniquenessFactors.push(`Architecture: ${result.is64bit ? '64-bit' : '32-bit'}`);
  result.uniquenessFactors.push(`UA string length: ${ua.length} chars`);

  return result;
}

export function UserAgentAnalyzerTool() {
  // Read navigator.userAgent AFTER mount. Reading it at module load made the
  // server render ('' / no result) differ from the client's first render (a
  // full result tree) — a React hydration error, a visible flash, and the
  // result-bus effect firing twice on every single visit.
  const [ua, setUa] = useState('');
  const [details, setDetails] = useState<UADetails | null>(null);
  useEffect(() => {
    const u = navigator.userAgent;
    setUa(u);
    setDetails(parseUserAgent(u));
  }, []);
  const [useCustom, setUseCustom] = useState(false);
  const [customUA, setCustomUA] = useState('');
  const [hints, setHints] = useState<ClientHints | null>(null);
  const report = useReportResult();
  useEffect(() => {
    if (!details) { report(null); return; }
    const n = details.uniquenessFactors.length;
    report({
      severity: details.privacyConcerns.length >= 3 ? 'amber' : 'info',
      headline: `Your browser announces ${details.browser.name} ${details.browser.version} on ${details.os.name}${details.os.version ? ' ' + details.os.version : ''} to every site`,
      // stats[0] is the scorecard's big figure — the browser name alone; the
      // full "Microsoft Edge 128.0.2739.42" string does not fit at 120px.
      stats: [{ label: 'Browser', value: details.browser.name }, { label: 'Version', value: details.browser.version }, { label: 'OS', value: details.os.name }, { label: 'Uniqueness factors', value: String(n) }],
    });
  }, [details, report]);

  // Fetch high-entropy Client Hints on mount (Chromium only, async).
  useEffect(() => {
    const navAny = navigator as unknown as {
      userAgentData?: {
        getHighEntropyValues: (hints: string[]) => Promise<{
          brands?: { brand: string; version: string }[];
          uaFullVersion?: string;
          platformVersion?: string;
          architecture?: string;
          bitness?: string;
          model?: string;
          wow64?: boolean;
        }>;
      };
    };
    if (!navAny.userAgentData?.getHighEntropyValues) return;

    navAny.userAgentData
      .getHighEntropyValues(['uaFullVersion', 'platformVersion', 'architecture', 'bitness', 'model', 'wow64'])
      .then((uaData) => {
        setHints({
          brands: (uaData.brands ?? []).map((b) => `${b.brand} ${b.version}`).join(', ') || '—',
          fullVersion: uaData.uaFullVersion || '—',
          platformVersion: uaData.platformVersion || '—',
          architecture: uaData.architecture || '—',
          bitness: uaData.bitness || '—',
          model: uaData.model || '—',
          wow64: uaData.wow64 ? 'yes' : 'no',
        });
      })
      .catch(() => { /* hint API rejected — ignore */ });
  }, []);

  const analyzeCustom = () => {
    if (customUA.trim()) {
      setDetails(parseUserAgent(customUA.trim()));
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-white mb-2">Your User Agent</h3>
        <code className="block bg-[#191b1c] p-4 rounded-md text-xs text-[#B8B8D4] font-mono break-all">
          {ua}
        </code>
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => setUseCustom(e.target.checked)}
              className="accent-white"
            />
            <span className="text-xs text-[#B8B8D4]">Analyze a different user agent</span>
          </label>
        </div>
        {useCustom && (
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={customUA}
              onChange={(e) => setCustomUA(e.target.value)}
              placeholder="Paste a user agent string..."
              className="flex-1 px-3 py-2 bg-[#191b1c] border border-white/10 rounded-md text-sm text-white placeholder-white/20 font-mono"
            />
            <button onClick={analyzeCustom} className="btn-primary px-4 text-sm">Analyze</button>
          </div>
        )}
      </div>

      {details && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="text-xs text-[#B8B8D4] mb-1">Browser</div>
              <div className="text-lg font-bold text-white">{details.browser.name}</div>
              <div className="text-xs text-[#B8B8D4]">v{details.browser.version}</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="text-xs text-[#B8B8D4] mb-1">Operating System</div>
              <div className="text-lg font-bold text-white">{details.os.name}</div>
              <div className="text-xs text-[#B8B8D4]">{details.os.version}</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="text-xs text-[#B8B8D4] mb-1">Device</div>
              <div className="text-lg font-bold text-white">{details.device}</div>
              <div className="text-xs text-[#B8B8D4]">{details.is64bit ? '64-bit' : '32-bit'}</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="text-xs text-[#B8B8D4] mb-1">Rendering Engine</div>
              <div className="text-lg font-bold text-white">{details.engine.name}</div>
              <div className="text-xs text-[#B8B8D4]">v{details.engine.version}</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="text-xs text-[#B8B8D4] mb-1">Mobile</div>
              <div className="text-lg font-bold text-white">{details.isMobile ? 'Yes' : 'No'}</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="text-xs text-[#B8B8D4] mb-1">UA Length</div>
              <div className="text-lg font-bold text-white">{details.raw.length}</div>
              <div className="text-xs text-[#B8B8D4]">characters</div>
            </div>
          </div>

          {/* Client Hints (UA-CH) */}
          {hints && (
            <div className="bg-[#0a0a0a] border border-orange-500/20 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-orange-400 mb-1">High-Entropy Client Hints</h3>
              <p className="text-xs text-[#B8B8D4] mb-3">
                Chrome is phasing out the classic UA string and exposing these details via the{' '}
                <code className="text-orange-400">userAgentData</code> API. Sites actively request these to
                fingerprint you:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                <div className="text-[#B8B8D4]">Brands: <span className="text-white">{hints.brands}</span></div>
                <div className="text-[#B8B8D4]">Full version: <span className="text-white">{hints.fullVersion}</span></div>
                <div className="text-[#B8B8D4]">Platform version: <span className="text-white">{hints.platformVersion}</span></div>
                <div className="text-[#B8B8D4]">Architecture: <span className="text-white">{hints.architecture}</span></div>
                <div className="text-[#B8B8D4]">Bitness: <span className="text-white">{hints.bitness}</span></div>
                <div className="text-[#B8B8D4]">Device model: <span className="text-white">{hints.model || '(empty)'}</span></div>
              </div>
            </div>
          )}

          {details.privacyConcerns.length > 0 && (
            <div className="bg-[#0a0a0a] border border-yellow-500/20 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-yellow-400 mb-3">Privacy Concerns</h3>
              <ul className="space-y-2">
                {details.privacyConcerns.map((c, i) => (
                  <li key={i} className="flex items-start text-sm text-yellow-300">
                    <span className="mr-2 text-yellow-500 shrink-0">&#9888;</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Fingerprint Factors</h3>
            <p className="text-xs text-[#B8B8D4] mb-3">
              These details from your user agent contribute to your browser fingerprint:
            </p>
            <div className="space-y-2">
              {details.uniquenessFactors.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-[#B8B8D4]">
                  <span className="text-blue-400">&#8226;</span>{f}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0a0a0a] border border-blue-500/20 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-blue-400 mb-3">What This Means</h3>
            <p className="text-sm text-[#B8B8D4]">
              Your user agent string reveals your browser, OS, and device information to every website you visit.
              Combined with other browser properties, this creates a &quot;fingerprint&quot; that can track you
              without cookies. Consider using a privacy-focused browser that reduces or randomizes this data.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
