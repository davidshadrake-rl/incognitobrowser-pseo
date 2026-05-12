'use client';

import { useState } from 'react';

interface CookieInfo {
  name: string;
  value: string;
  category: 'tracking' | 'analytics' | 'functional' | 'unknown';
  risk: 'high' | 'medium' | 'low';
  description: string;
}

interface URLScanResult {
  url: string;
  status: number;
  cookies: {
    cookieName: string;
    name: string;
    category: string;
    risk: string;
    description: string;
    raw: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: string;
    domain: string;
    path: string;
    maxAge: string | null;
    expires: string | null;
  }[];
  trackers: {
    name: string;
    category: string;
    risk: string;
    description: string;
  }[];
  inlineTrackers: string[];
  thirdPartyDomains: string[];
  security: {
    isHTTPS: boolean;
    hasCSP: boolean;
    hasPermPolicy: boolean;
    hasHSTS: boolean;
  };
  summary: {
    totalCookies: number;
    trackingCookies: number;
    analyticsCookies: number;
    functionalCookies: number;
    totalTrackers: number;
    thirdPartyScripts: number;
    highRiskItems: number;
  };
}

const KNOWN_COOKIES: Record<string, { category: CookieInfo['category']; risk: CookieInfo['risk']; description: string }> = {
  '_ga': { category: 'analytics', risk: 'medium', description: 'Google Analytics — tracks user behavior across sessions' },
  '_gid': { category: 'analytics', risk: 'medium', description: 'Google Analytics — identifies unique users for 24 hours' },
  '_gat': { category: 'analytics', risk: 'low', description: 'Google Analytics — rate limiting' },
  '_fbp': { category: 'tracking', risk: 'high', description: 'Facebook Pixel — tracks you across websites for ad targeting' },
  '_fbc': { category: 'tracking', risk: 'high', description: 'Facebook — stores click identifier from Facebook ads' },
  'fr': { category: 'tracking', risk: 'high', description: 'Facebook — advertising and tracking cookie' },
  '_gcl_au': { category: 'tracking', risk: 'high', description: 'Google AdSense — experiments with ad efficiency' },
  'IDE': { category: 'tracking', risk: 'high', description: 'Google DoubleClick — used for targeted advertising' },
  'NID': { category: 'tracking', risk: 'medium', description: 'Google — stores preferences and ad personalization' },
  '_tt_enable_cookie': { category: 'tracking', risk: 'high', description: 'TikTok — checks if cookies can be placed' },
  '_ttp': { category: 'tracking', risk: 'high', description: 'TikTok — tracks activity for ad targeting' },
  'MUID': { category: 'tracking', risk: 'high', description: 'Microsoft/Bing — identifies unique web browsers' },
  '_uetsid': { category: 'tracking', risk: 'high', description: 'Microsoft Ads — tracks conversions' },
  '__stripe_mid': { category: 'functional', risk: 'low', description: 'Stripe — payment processing fraud prevention' },
  '__stripe_sid': { category: 'functional', risk: 'low', description: 'Stripe — session identifier for payments' },
  'csrf_token': { category: 'functional', risk: 'low', description: 'Security — prevents cross-site request forgery attacks' },
  'XSRF-TOKEN': { category: 'functional', risk: 'low', description: 'Security — CSRF protection token' },
  'session': { category: 'functional', risk: 'low', description: 'Session identifier — keeps you logged in' },
  'sessionid': { category: 'functional', risk: 'low', description: 'Session identifier — keeps you logged in' },
  '_hjid': { category: 'analytics', risk: 'medium', description: 'Hotjar — identifies unique visitors for behavior analytics' },
  '_hjSessionUser': { category: 'analytics', risk: 'medium', description: 'Hotjar — user session tracking' },
  'mp_': { category: 'analytics', risk: 'medium', description: 'Mixpanel — product analytics and user tracking' },
  'ajs_anonymous_id': { category: 'analytics', risk: 'medium', description: 'Segment — anonymous user identifier for analytics' },
  'intercom-': { category: 'analytics', risk: 'medium', description: 'Intercom — customer messaging platform tracking' },
  '__cf_bm': { category: 'functional', risk: 'low', description: 'Cloudflare — bot management, security' },
  'cf_clearance': { category: 'functional', risk: 'low', description: 'Cloudflare — proof of passing security challenge' },
};

function categorizeCookie(name: string, value: string): CookieInfo {
  if (KNOWN_COOKIES[name]) {
    return { name, value, ...KNOWN_COOKIES[name] };
  }
  for (const [pattern, info] of Object.entries(KNOWN_COOKIES)) {
    if (pattern.endsWith('_') && name.startsWith(pattern)) {
      return { name, value, ...info };
    }
    if (pattern.endsWith('-') && name.startsWith(pattern)) {
      return { name, value, ...info };
    }
  }
  const lower = name.toLowerCase();
  if (lower.includes('track') || lower.includes('ad') || lower.includes('pixel') || lower.includes('campaign')) {
    return { name, value, category: 'tracking', risk: 'high', description: 'Likely a tracking or advertising cookie based on naming' };
  }
  if (lower.includes('analytics') || lower.includes('stat') || lower.includes('metric')) {
    return { name, value, category: 'analytics', risk: 'medium', description: 'Likely an analytics cookie based on naming' };
  }
  if (lower.includes('session') || lower.includes('csrf') || lower.includes('token') || lower.includes('auth')) {
    return { name, value, category: 'functional', risk: 'low', description: 'Likely a functional/security cookie based on naming' };
  }
  return { name, value, category: 'unknown', risk: 'medium', description: 'Unknown cookie — could be functional or tracking' };
}

function getCategoryColor(cat: string) {
  switch (cat) {
    case 'tracking': return 'text-red-400 bg-red-500/10';
    case 'analytics': return 'text-yellow-400 bg-yellow-500/10';
    case 'functional': return 'text-green-400 bg-green-500/10';
    default: return 'text-[#B8B8D4] bg-white/5';
  }
}

function getRiskColor(risk: string) {
  switch (risk) {
    case 'high': return 'text-red-400';
    case 'medium': return 'text-yellow-400';
    default: return 'text-green-400';
  }
}

function getSecurityIcon(ok: boolean) {
  return ok ? '✓' : '✗';
}

function getSecurityColor(ok: boolean) {
  return ok ? 'text-green-400' : 'text-red-400';
}

export function CookieAnalyzerTool() {
  const [cookies, setCookies] = useState<CookieInfo[]>([]);
  const [scanned, setScanned] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [mode, setMode] = useState<'url' | 'browser' | 'paste'>('url');

  // URL scan state
  const [urlInput, setUrlInput] = useState('');
  const [urlScanning, setUrlScanning] = useState(false);
  // Per-phase status so users can see why a click costs ~2-4 seconds. The
  // proof-of-work step in particular looks suspiciously slow without context.
  const [scanStatus, setScanStatus] = useState<'' | 'verifying' | 'solving' | 'scanning'>('');
  const [urlResult, setUrlResult] = useState<URLScanResult | null>(null);
  const [urlError, setUrlError] = useState('');

  const scanBrowserCookies = () => {
    const raw = document.cookie;
    if (!raw) {
      setCookies([]);
      setScanned(true);
      return;
    }
    const parsed = raw.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return categorizeCookie(name, rest.join('='));
    });
    setCookies(parsed);
    setScanned(true);
  };

  const analyzePastedCookies = () => {
    if (!customInput.trim()) return;
    const parsed = customInput.split(/[;\n]/).filter(Boolean).map(c => {
      const [name, ...rest] = c.trim().split('=');
      return categorizeCookie(name.trim(), rest.join('=').trim());
    });
    setCookies(parsed);
    setScanned(true);
  };

  // API base URL — points at the Vercel-hosted scanner endpoint.
  // For local dev with `npm run dev`, override via NEXT_PUBLIC_SCAN_API in .env.local.
  const API_BASE =
    process.env.NEXT_PUBLIC_SCAN_API || 'https://api.incognitobrowser.io';

  /**
   * Fetch a fresh proof-of-work challenge, brute-force the solution in this tab,
   * and return the encoded Authorization header value.
   *
   * Uses the synchronous js-sha256 implementation rather than crypto.subtle —
   * the latter is async and per-call overhead made 100k iterations take ~30s
   * in real browsers. Sync sha256 does the same workload in ~200–500ms.
   *
   * We yield to the event loop every 5k iterations so the page stays responsive
   * (no spinner freeze) on slower devices.
   */
  const solveAltchaChallenge = async (): Promise<string> => {
    setScanStatus('verifying');
    const cRes = await fetch(`${API_BASE}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!cRes.ok) {
      throw new Error(`Challenge service returned ${cRes.status}`);
    }
    const c = (await cRes.json()) as {
      algorithm: string;
      salt: string;
      challenge: string;
      maxnumber: number;
      signature: string;
      expires: number;
    };

    setScanStatus('solving');
    const { sha256 } = await import('js-sha256');
    const target = c.challenge.toLowerCase();
    for (let n = 0; n <= c.maxnumber; n++) {
      if (sha256(c.salt + n) === target) {
        const solution = {
          algorithm: c.algorithm,
          salt: c.salt,
          number: n,
          signature: c.signature,
          expires: c.expires,
        };
        return `Altcha ${btoa(JSON.stringify(solution))}`;
      }
      // Yield to the event loop every 5000 iterations so the spinner animates
      // and the UI stays responsive on slower devices.
      if (n % 5000 === 0 && n > 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    throw new Error('Could not solve challenge within search space');
  };

  const scanURL = async () => {
    if (!urlInput.trim()) return;
    setUrlScanning(true);
    setUrlError('');
    setUrlResult(null);
    setScanned(false);

    try {
      // 1. Get + solve POW challenge (defends against scripted abuse)
      const authHeader = await solveAltchaChallenge();

      // 2. Now scan with the token in Authorization
      setScanStatus('scanning');
      const res = await fetch(`${API_BASE}/scan-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUrlError(data.error || 'Failed to scan URL');
      } else {
        setUrlResult(data);
      }
    } catch (err) {
      setUrlError(
        err instanceof Error && err.message.includes('challenge')
          ? 'Could not verify your browser. Please try again.'
          : 'Network error. Please check the URL and try again.',
      );
    }
    setUrlScanning(false);
    setScanStatus('');
  };

  const tracking = cookies.filter(c => c.category === 'tracking');
  const analytics = cookies.filter(c => c.category === 'analytics');
  const functional = cookies.filter(c => c.category === 'functional');

  // Extract the registrable domain from a URL (rough — no PSL lookup in-browser).
  const getBaseDomain = (hostname: string) => {
    const parts = hostname.toLowerCase().split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : hostname.toLowerCase();
  };

  // True when a cookie's Domain attribute doesn't belong to the scanned site.
  const isThirdParty = (cookieDomain: string | undefined, siteUrl: string) => {
    if (!cookieDomain) return false;
    try {
      const siteHost = new URL(siteUrl).hostname;
      const siteBase = getBaseDomain(siteHost);
      const cookieBase = getBaseDomain(cookieDomain.replace(/^\./, ''));
      return cookieBase !== siteBase;
    } catch {
      return false;
    }
  };

  const downloadCsv = (result: URLScanResult) => {
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows: string[] = [
      ['Type', 'Name', 'Category', 'Risk', 'Third-Party', 'Secure', 'HttpOnly', 'SameSite', 'Domain', 'Description'].map(escape).join(','),
    ];
    for (const c of result.cookies) {
      rows.push([
        'cookie',
        c.cookieName,
        c.category,
        c.risk,
        isThirdParty(c.domain, result.url) ? 'yes' : 'no',
        c.secure ? 'yes' : 'no',
        c.httpOnly ? 'yes' : 'no',
        c.sameSite,
        c.domain || '',
        c.description,
      ].map(escape).join(','));
    }
    for (const t of result.trackers) {
      rows.push([
        'tracker',
        t.name,
        t.category,
        t.risk,
        'yes',
        '', '', '', '',
        t.description,
      ].map(escape).join(','));
    }
    for (const d of result.thirdPartyDomains) {
      rows.push(['third-party-script', d, '', '', 'yes', '', '', '', d, ''].map(escape).join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    let host = 'scan';
    try { host = new URL(result.url).hostname; } catch {}
    a.download = `${host}-cookie-scan.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Calculate privacy grade for URL scan
  const getPrivacyGrade = (result: URLScanResult) => {
    const { summary, security } = result;
    let score = 100;
    score -= summary.highRiskItems * 10;
    score -= summary.trackingCookies * 5;
    score -= summary.analyticsCookies * 3;
    score -= summary.totalTrackers * 5;
    score -= Math.min(20, summary.thirdPartyScripts * 2);
    if (!security.isHTTPS) score -= 20;
    if (!security.hasCSP) score -= 5;
    if (!security.hasHSTS) score -= 5;
    score = Math.max(0, Math.min(100, score));

    if (score >= 85) return { letter: 'A', color: '#10b981', label: 'Excellent' };
    if (score >= 70) return { letter: 'B', color: '#22c55e', label: 'Good' };
    if (score >= 50) return { letter: 'C', color: '#eab308', label: 'Fair' };
    if (score >= 30) return { letter: 'D', color: '#f97316', label: 'Poor' };
    return { letter: 'F', color: '#ef4444', label: 'Very Poor' };
  };

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex">
        <button
          onClick={() => { setMode('url'); setScanned(false); setUrlResult(null); setUrlError(''); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'url' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Scan a URL
        </button>
        <button
          onClick={() => { setMode('browser'); setScanned(false); setUrlResult(null); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'browser' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          This Page
        </button>
        <button
          onClick={() => { setMode('paste'); setScanned(false); setUrlResult(null); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'paste' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Paste
        </button>
      </div>

      {/* Input area */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        {mode === 'url' ? (
          <div>
            <label className="block text-sm font-medium text-[#B8B8D4] mb-2">
              Enter a website URL to scan for cookies &amp; trackers
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !urlScanning && scanURL()}
                placeholder="https://example.com"
                className="flex-1 px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20 font-mono text-sm"
              />
              <button
                onClick={scanURL}
                disabled={urlScanning}
                className="btn-primary px-6 shrink-0"
              >
                {urlScanning ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    {scanStatus === 'verifying' ? 'Verifying' :
                     scanStatus === 'solving' ? 'Proving' :
                     scanStatus === 'scanning' ? 'Scanning' :
                     'Working'}
                  </span>
                ) : 'Scan'}
              </button>
            </div>
            {/* Per-phase status line: tells the user why a click costs 2–4s.
                Removes the "is it broken?" anxiety during the PoW step. */}
            {urlScanning && scanStatus && (
              <div className="mt-2 flex items-center gap-2 text-xs text-[#B8B8D4]/80">
                <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                {scanStatus === 'verifying' && 'Requesting verification token from the server…'}
                {scanStatus === 'solving' && 'Proving you’re a real browser (one-time CPU check, ~half a second)…'}
                {scanStatus === 'scanning' && 'Fetching the site and analysing cookies, trackers, and scripts…'}
              </div>
            )}
            <p className="mt-2 text-xs text-[#B8B8D4]/60">
              We fetch the URL server-side to read Set-Cookie headers and detect tracking scripts in the HTML. The target site will see a request from our server, not your browser.
            </p>
          </div>
        ) : mode === 'browser' ? (
          <div className="text-center">
            <p className="text-[#B8B8D4] mb-4">
              Scan cookies set by this page to see what&apos;s tracking you.
            </p>
            <button onClick={scanBrowserCookies} className="btn-primary px-8 py-3">
              Scan Cookies
            </button>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-[#B8B8D4] mb-2">
              Paste cookie string (from DevTools &gt; Application &gt; Cookies)
            </label>
            <textarea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="_ga=GA1.2.123; _fbp=fb.1.123; session=abc123"
              rows={4}
              className="w-full px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20 font-mono text-sm mb-3"
            />
            <button onClick={analyzePastedCookies} className="btn-primary w-full py-3">
              Analyze Cookies
            </button>
          </div>
        )}
      </div>

      {/* URL scan error */}
      {urlError && (
        <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
          {urlError}
        </div>
      )}

      {/* ===== URL SCAN RESULTS ===== */}
      {urlResult && (
        <div className="space-y-4">
          {/* Privacy grade + summary */}
          {(() => {
            const grade = getPrivacyGrade(urlResult);
            return (
              <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-5xl font-bold" style={{ color: grade.color }}>{grade.letter}</div>
                    <div className="text-xs text-[#B8B8D4] mt-1">{grade.label}</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm text-white font-medium mb-1 truncate">{urlResult.url}</div>
                    <div className="text-xs text-[#B8B8D4] mb-3">HTTP {urlResult.status}</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div className="text-lg font-bold text-white">{urlResult.summary.totalCookies}</div>
                        <div className="text-xs text-[#B8B8D4]">Cookies</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-white">{urlResult.summary.totalTrackers}</div>
                        <div className="text-xs text-[#B8B8D4]">Trackers</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-white">{urlResult.summary.thirdPartyScripts}</div>
                        <div className="text-xs text-[#B8B8D4]">3rd Party Scripts</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Cookie breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{urlResult.summary.totalCookies}</div>
              <div className="text-xs text-[#B8B8D4]">Total Cookies</div>
            </div>
            <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{urlResult.summary.trackingCookies}</div>
              <div className="text-xs text-[#B8B8D4]">Tracking</div>
            </div>
            <div className="bg-[#0a0a0a] border border-yellow-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">{urlResult.summary.analyticsCookies}</div>
              <div className="text-xs text-[#B8B8D4]">Analytics</div>
            </div>
            <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{urlResult.summary.functionalCookies}</div>
              <div className="text-xs text-[#B8B8D4]">Functional</div>
            </div>
          </div>

          {/* Security headers */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Security Headers</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.isHTTPS)}>{getSecurityIcon(urlResult.security.isHTTPS)}</span>
                <span className="text-sm text-[#B8B8D4]">HTTPS</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.hasHSTS)}>{getSecurityIcon(urlResult.security.hasHSTS)}</span>
                <span className="text-sm text-[#B8B8D4]">HSTS</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.hasCSP)}>{getSecurityIcon(urlResult.security.hasCSP)}</span>
                <span className="text-sm text-[#B8B8D4]">Content Security Policy</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.hasPermPolicy)}>{getSecurityIcon(urlResult.security.hasPermPolicy)}</span>
                <span className="text-sm text-[#B8B8D4]">Permissions Policy</span>
              </div>
            </div>
          </div>

          {/* Tracking scripts detected */}
          {(urlResult.trackers.length > 0 || urlResult.inlineTrackers.length > 0) && (
            <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-red-400 mb-3">
                Tracking Scripts Detected ({urlResult.trackers.length + urlResult.inlineTrackers.length})
              </h3>
              <div className="space-y-2">
                {urlResult.trackers.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-red-500/5 rounded-md">
                    <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${getCategoryColor(t.category)}`}>
                      {t.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white">{t.name}</div>
                      <p className="text-xs text-[#B8B8D4]/80">{t.description}</p>
                    </div>
                    <span className={`text-xs shrink-0 ${getRiskColor(t.risk)}`}>{t.risk}</span>
                  </div>
                ))}
                {urlResult.inlineTrackers.map((t, i) => (
                  <div key={`inline-${i}`} className="flex items-center gap-3 p-3 bg-red-500/5 rounded-md">
                    <span className="text-xs px-2 py-0.5 rounded text-red-400 bg-red-500/10">inline</span>
                    <span className="text-sm text-white">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white font-medium">Compliance report</p>
              <p className="text-xs text-[#B8B8D4]">
                Export cookies, trackers, and third-party scripts to CSV for GDPR/CCPA audits.
              </p>
            </div>
            <button
              onClick={() => downloadCsv(urlResult)}
              className="text-sm px-4 py-2 border border-white/10 rounded text-white hover:bg-white/5 shrink-0"
            >
              Export CSV
            </button>
          </div>

          {/* Cookies detail */}
          {urlResult.cookies.length > 0 && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Cookies ({urlResult.cookies.length})</h3>
              <div className="space-y-3">
                {urlResult.cookies.map((c, i) => (
                  <div key={i} className="border border-white/5 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <code className="text-sm font-mono text-white">{c.cookieName}</code>
                      <div className="flex gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${getCategoryColor(c.category)}`}>
                          {c.category}
                        </span>
                        <span className={`text-xs ${getRiskColor(c.risk)}`}>
                          {c.risk}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-[#B8B8D4]/80 mb-2">{c.description}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded ${c.secure ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        {c.secure ? 'Secure' : 'Not Secure'}
                      </span>
                      <span className={`px-2 py-0.5 rounded ${c.httpOnly ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                        {c.httpOnly ? 'HttpOnly' : 'JS Accessible'}
                      </span>
                      <span className={`px-2 py-0.5 rounded ${
                        c.sameSite.toLowerCase() === 'strict' ? 'bg-green-500/10 text-green-400' :
                        c.sameSite.toLowerCase() === 'lax' ? 'bg-yellow-500/10 text-yellow-400' :
                        c.sameSite.toLowerCase() === 'none' ? 'bg-red-500/10 text-red-400' :
                        'bg-white/5 text-[#B8B8D4]'
                      }`}>
                        SameSite: {c.sameSite}
                      </span>
                      {c.domain && (
                        <span className="px-2 py-0.5 rounded bg-white/5 text-[#B8B8D4]">
                          {c.domain}
                        </span>
                      )}
                      {isThirdParty(c.domain, urlResult.url) && (
                        <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400" title="Cookie's domain differs from the site's domain">
                          3rd-party
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Third-party domains */}
          {urlResult.thirdPartyDomains.length > 0 && (
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-3">
                Third-Party Script Domains ({urlResult.thirdPartyDomains.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {urlResult.thirdPartyDomains.map((domain, i) => (
                  <span key={i} className="text-xs px-2 py-1 bg-white/5 rounded font-mono text-[#B8B8D4]">
                    {domain}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-[#B8B8D4]/60">
                Each third-party domain can potentially track your activity across websites.
              </p>
            </div>
          )}

          {/* Clean site message */}
          {urlResult.summary.totalCookies === 0 && urlResult.trackers.length === 0 && (
            <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-6 text-center">
              <div className="text-green-400 text-lg font-semibold mb-2">Clean Site</div>
              <p className="text-sm text-[#B8B8D4]">
                No cookies or tracking scripts detected on the initial page load. This site appears to respect visitor privacy.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ===== BROWSER / PASTE RESULTS ===== */}
      {scanned && mode !== 'url' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{cookies.length}</div>
              <div className="text-xs text-[#B8B8D4]">Total Cookies</div>
            </div>
            <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{tracking.length}</div>
              <div className="text-xs text-[#B8B8D4]">Tracking</div>
            </div>
            <div className="bg-[#0a0a0a] border border-yellow-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">{analytics.length}</div>
              <div className="text-xs text-[#B8B8D4]">Analytics</div>
            </div>
            <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{functional.length}</div>
              <div className="text-xs text-[#B8B8D4]">Functional</div>
            </div>
          </div>

          {cookies.length === 0 ? (
            <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-6 text-center">
              <div className="text-green-400 text-lg font-semibold mb-2">No cookies detected</div>
              <p className="text-sm text-[#B8B8D4]">
                {mode === 'browser'
                  ? 'This page has no accessible cookies. This is good for privacy.'
                  : 'No valid cookies found in the input.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cookies.map((c, i) => (
                <div key={i} className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-sm font-mono text-white">{c.name}</code>
                    <div className="flex gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${getCategoryColor(c.category)}`}>
                        {c.category}
                      </span>
                      <span className={`text-xs ${getRiskColor(c.risk)}`}>
                        {c.risk} risk
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-[#B8B8D4]/80 mb-1">{c.description}</p>
                  <div className="bg-[#191b1c] p-2 rounded text-xs font-mono text-[#B8B8D4]/60 truncate">
                    {c.value || '(empty)'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
