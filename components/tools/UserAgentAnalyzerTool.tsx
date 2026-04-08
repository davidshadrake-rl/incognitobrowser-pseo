'use client';

import { useState, useEffect } from 'react';

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

  // Browser detection
  if (/Edg\/(\d+[\.\d]*)/.test(ua)) {
    result.browser = { name: 'Microsoft Edge', version: ua.match(/Edg\/(\d+[\.\d]*)/)![1] };
  } else if (/OPR\/(\d+[\.\d]*)/.test(ua)) {
    result.browser = { name: 'Opera', version: ua.match(/OPR\/(\d+[\.\d]*)/)![1] };
  } else if (/Brave/.test(ua) || /brave/.test(ua)) {
    result.browser = { name: 'Brave', version: ua.match(/Chrome\/(\d+[\.\d]*)/)![1] };
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
    const ver = ua.match(/OS (\d+_\d+[_\d]*)/) ;
    result.os = { name: 'iOS', version: ver ? ver[1].replace(/_/g, '.') : '' };
    result.isMobile = true;
    result.device = /iPad/.test(ua) ? 'Tablet' : 'Mobile';
  } else if (/Linux/.test(ua)) {
    result.os = { name: 'Linux', version: '' };
  } else if (/CrOS/.test(ua)) {
    result.os = { name: 'Chrome OS', version: '' };
  }

  // 64-bit
  result.is64bit = /x86_64|x64|Win64|WOW64|aarch64|arm64/.test(ua);

  // Privacy concerns
  if (result.browser.name === 'Chrome') {
    result.privacyConcerns.push('Chrome sends telemetry data to Google by default');
    result.privacyConcerns.push('Consider switching to Brave, Firefox, or Incognito Browser');
  }
  if (result.browser.name === 'Microsoft Edge') {
    result.privacyConcerns.push('Edge sends diagnostic data to Microsoft');
  }

  // Outdated browser check
  const mainVer = parseInt(result.browser.version);
  if (result.browser.name === 'Chrome' && mainVer < 120) {
    result.privacyConcerns.push(`Chrome ${mainVer} may be outdated — update for security patches`);
  }
  if (result.browser.name === 'Firefox' && mainVer < 120) {
    result.privacyConcerns.push(`Firefox ${mainVer} may be outdated — update for security patches`);
  }

  // Uniqueness factors
  result.uniquenessFactors.push(`Browser: ${result.browser.name} ${result.browser.version}`);
  result.uniquenessFactors.push(`OS: ${result.os.name} ${result.os.version}`);
  result.uniquenessFactors.push(`Platform: ${result.device}`);
  result.uniquenessFactors.push(`Architecture: ${result.is64bit ? '64-bit' : '32-bit'}`);
  result.uniquenessFactors.push(`UA string length: ${ua.length} chars`);

  return result;
}

export function UserAgentAnalyzerTool() {
  const [ua, setUa] = useState('');
  const [details, setDetails] = useState<UADetails | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [customUA, setCustomUA] = useState('');

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      const current = navigator.userAgent;
      setUa(current);
      setDetails(parseUserAgent(current));
    }
  }, []);

  const analyzeCustom = () => {
    if (customUA.trim()) {
      setDetails(parseUserAgent(customUA.trim()));
    }
  };

  return (
    <div className="space-y-6">
      {/* Current UA display */}
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
          {/* Parsed info */}
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

          {/* Privacy concerns */}
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

          {/* Fingerprint factors */}
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

          {/* What this means */}
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
