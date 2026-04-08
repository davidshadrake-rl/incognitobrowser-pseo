'use client';

import { useState } from 'react';

interface CookieInfo {
  name: string;
  value: string;
  category: 'tracking' | 'analytics' | 'functional' | 'unknown';
  risk: 'high' | 'medium' | 'low';
  description: string;
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
  // Check exact matches
  if (KNOWN_COOKIES[name]) {
    return { name, value, ...KNOWN_COOKIES[name] };
  }

  // Check prefix matches
  for (const [pattern, info] of Object.entries(KNOWN_COOKIES)) {
    if (pattern.endsWith('_') && name.startsWith(pattern)) {
      return { name, value, ...info };
    }
    if (pattern.endsWith('-') && name.startsWith(pattern)) {
      return { name, value, ...info };
    }
  }

  // Heuristic categorization
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

export function CookieAnalyzerTool() {
  const [cookies, setCookies] = useState<CookieInfo[]>([]);
  const [scanned, setScanned] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [mode, setMode] = useState<'browser' | 'paste'>('browser');

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

  const tracking = cookies.filter(c => c.category === 'tracking');
  const analytics = cookies.filter(c => c.category === 'analytics');
  const functional = cookies.filter(c => c.category === 'functional');
  const unknown = cookies.filter(c => c.category === 'unknown');

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex">
        <button
          onClick={() => { setMode('browser'); setScanned(false); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'browser' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Scan This Page
        </button>
        <button
          onClick={() => { setMode('paste'); setScanned(false); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'paste' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Paste Cookies
        </button>
      </div>

      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        {mode === 'browser' ? (
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

      {scanned && (
        <>
          {/* Summary */}
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
