'use client';

import { useState } from 'react';

interface URLAnalysis {
  url: string;
  score: number;
  risks: { severity: 'high' | 'medium' | 'low'; message: string }[];
  details: { label: string; value: string; safe: boolean }[];
  parts: { protocol: string; subdomain: string; domain: string; tld: string; port: string; path: string; search: string };
  isHTTPS: boolean;
  isShortener: boolean;
  suspectedImpersonation?: { brand: string; distance: number };
}

const SUSPICIOUS_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work', '.click',
  '.link', '.buzz', '.surf', '.icu', '.monster', '.rest',
]);

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
  'buff.ly', 'rb.gy', 'short.io', 'cutt.ly', 'tiny.cc',
]);

const TRUSTED_DOMAINS = new Set([
  'google.com', 'github.com', 'microsoft.com', 'apple.com', 'amazon.com',
  'wikipedia.org', 'mozilla.org', 'cloudflare.com', 'stackoverflow.com',
]);

// Popular brands commonly impersonated in phishing — compared with Levenshtein
// distance against the base domain to catch goog1e.com, paypa1.com, micros0ft.com, etc.
const POPULAR_BRANDS = [
  'google', 'microsoft', 'apple', 'amazon', 'facebook', 'instagram', 'twitter', 'linkedin',
  'paypal', 'stripe', 'chase', 'wellsfargo', 'bankofamerica', 'citibank',
  'netflix', 'spotify', 'dropbox', 'github', 'coinbase', 'binance', 'metamask',
];

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function splitHostname(hostname: string) {
  const parts = hostname.split('.');
  const tld = parts.length > 0 ? parts[parts.length - 1] : '';
  const domain = parts.length > 1 ? parts[parts.length - 2] : parts[0] || '';
  const subdomain = parts.length > 2 ? parts.slice(0, -2).join('.') : '';
  return { subdomain, domain, tld };
}

function analyzeURL(urlString: string): URLAnalysis {
  if (urlString.length > 2048) {
    return {
      url: urlString.substring(0, 100) + '...',
      score: 10,
      risks: [{ severity: 'high', message: 'URL is suspiciously long (over 2048 characters)' }],
      details: [{ label: 'Length', value: `${urlString.length} characters`, safe: false }],
      parts: { protocol: '', subdomain: '', domain: '', tld: '', port: '', path: '', search: '' },
      isHTTPS: false,
      isShortener: false,
    };
  }

  const risks: URLAnalysis['risks'] = [];
  const details: URLAnalysis['details'] = [];
  let score = 100;

  let parsed: URL;
  try {
    if (!urlString.match(/^https?:\/\//i)) urlString = 'https://' + urlString;
    parsed = new URL(urlString);
  } catch {
    return {
      url: urlString,
      score: 0,
      risks: [{ severity: 'high', message: 'Invalid URL format' }],
      details: [],
      parts: { protocol: '', subdomain: '', domain: '', tld: '', port: '', path: '', search: '' },
      isHTTPS: false,
      isShortener: false,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const fullURL = parsed.href;
  const { subdomain, domain, tld: tldBare } = splitHostname(hostname);
  const tld = '.' + tldBare;
  const baseDomain = domain && tldBare ? `${domain}.${tldBare}` : hostname;

  const parts = {
    protocol: parsed.protocol.replace(':', ''),
    subdomain,
    domain,
    tld,
    port: parsed.port,
    path: parsed.pathname,
    search: parsed.search,
  };

  const isHTTPS = parsed.protocol === 'https:';
  details.push({ label: 'Protocol', value: parts.protocol.toUpperCase(), safe: isHTTPS });
  if (!isHTTPS) {
    risks.push({ severity: 'high', message: 'Not using HTTPS — connection is unencrypted' });
    score -= 25;
  }

  details.push({ label: 'Domain', value: hostname, safe: true });

  // Subdomain depth
  const subdomainDepth = subdomain ? subdomain.split('.').length : 0;
  if (subdomainDepth > 2) {
    risks.push({ severity: 'medium', message: `Excessive subdomains (${subdomainDepth}) — may be spoofing a legitimate domain` });
    score -= 15;
  }

  details.push({ label: 'TLD', value: tld, safe: !SUSPICIOUS_TLDS.has(tld) });
  if (SUSPICIOUS_TLDS.has(tld)) {
    risks.push({ severity: 'medium', message: `TLD "${tld}" is commonly used in phishing/spam sites` });
    score -= 15;
  }

  // URL shortener
  const isShortener = URL_SHORTENERS.has(baseDomain);
  if (isShortener) {
    risks.push({ severity: 'medium', message: 'URL shortener detected — destination is hidden. Use the "Unfurl" button below.' });
    score -= 10;
    details.push({ label: 'Type', value: 'URL Shortener', safe: false });
  }

  // Trusted domain
  const isTrusted = TRUSTED_DOMAINS.has(baseDomain);
  if (isTrusted) {
    details.push({ label: 'Reputation', value: 'Known trusted domain', safe: true });
    score = Math.min(100, score + 5);
  }

  // Punycode / IDN attack
  if (hostname.startsWith('xn--') || hostname.includes('.xn--')) {
    risks.push({ severity: 'high', message: 'Domain uses Punycode (xn--...) — may be a homograph attack. Decode before trusting.' });
    score -= 30;
  }
  if (/[^\x00-\x7F]/.test(hostname)) {
    risks.push({ severity: 'high', message: 'Domain contains non-ASCII characters — possible homograph/IDN attack' });
    score -= 30;
  }

  // Typosquat / brand impersonation detection
  let suspectedImpersonation: URLAnalysis['suspectedImpersonation'];
  if (domain && !isTrusted) {
    // Strip common number-for-letter leet (0→o, 1→l, etc.) to catch leet typosquats
    const normalized = domain.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');
    let best: { brand: string; distance: number } | null = null;
    for (const brand of POPULAR_BRANDS) {
      if (normalized === brand) continue; // exact match — already caught by TRUSTED_DOMAINS if legit
      const d = levenshtein(normalized, brand);
      // Catch "close but not exact" — 1 edit on a 5+ char brand, or contains brand as substring
      const isSubstring = domain.includes(brand) && domain !== brand && brand.length >= 5;
      if ((d > 0 && d <= 2 && brand.length >= 5) || isSubstring) {
        if (!best || d < best.distance) best = { brand, distance: isSubstring ? 0 : d };
      }
    }
    if (best) {
      suspectedImpersonation = best;
      risks.push({
        severity: 'high',
        message: `Domain "${domain}.${tldBare}" looks like it impersonates "${best.brand}" (${best.distance === 0 ? 'contains brand name' : `${best.distance} edit${best.distance === 1 ? '' : 's'} away`}). Common phishing pattern.`,
      });
      score -= 30;
    }
  }

  // IP address literal
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    risks.push({ severity: 'high', message: 'URL uses an IP address instead of a domain name — common in phishing' });
    score -= 25;
  }

  // Suspicious patterns
  const pathAndSearch = parsed.pathname + parsed.search;
  details.push({ label: 'Path', value: pathAndSearch || '/', safe: true });

  if (parsed.username || /@/.test(fullURL.split('//')[1]?.split('/')[0] || '')) {
    risks.push({ severity: 'high', message: 'URL contains "@" before the domain — this is a redirect trick' });
    score -= 25;
  }

  if (/login|signin|account|verify|secure|update|confirm|bank/i.test(pathAndSearch) && !isTrusted) {
    risks.push({ severity: 'medium', message: 'Path contains login/account keywords — verify this is the real site' });
    score -= 10;
  }

  if (fullURL.length > 200) {
    risks.push({ severity: 'low', message: `URL is very long (${fullURL.length} chars) — could be hiding suspicious parameters` });
    score -= 5;
  }

  const paramCount = parsed.searchParams.size;
  if (paramCount > 5) {
    risks.push({ severity: 'low', message: `${paramCount} query parameters — may include tracking parameters` });
    score -= 5;
  }
  if (paramCount > 0) details.push({ label: 'Parameters', value: `${paramCount} params`, safe: paramCount <= 5 });

  if (parsed.port && !['80', '443', ''].includes(parsed.port)) {
    risks.push({ severity: 'medium', message: `Non-standard port ${parsed.port} — unusual for legitimate websites` });
    score -= 10;
    details.push({ label: 'Port', value: parsed.port, safe: false });
  }

  // If we have no reputation data and the URL is structurally clean, cap the ceiling.
  // A brand-new phishing domain with HTTPS and a clean path shouldn't score 100/100.
  if (!isTrusted && risks.length === 0) {
    score = Math.min(score, 75);
    risks.push({
      severity: 'low',
      message: 'Structural checks only — this tool does not query reputation databases. Verify unfamiliar sites through other channels before entering credentials.',
    });
  }

  score = Math.max(0, Math.min(100, score));

  return { url: fullURL, score, risks, details, parts, isHTTPS, isShortener, suspectedImpersonation };
}

export function URLAnalyzerTool() {
  const [url, setUrl] = useState('');
  const [analysis, setAnalysis] = useState<URLAnalysis | null>(null);
  const [unfurling, setUnfurling] = useState(false);
  const [unfurled, setUnfurled] = useState('');
  const [unfurlError, setUnfurlError] = useState('');

  const handleAnalyze = () => {
    if (!url.trim()) return;
    setAnalysis(analyzeURL(url.trim()));
    setUnfurled('');
    setUnfurlError('');
  };

  const unfurlShortener = async () => {
    if (!analysis) return;
    setUnfurling(true);
    setUnfurlError('');
    setUnfurled('');
    try {
      const res = await fetch('https://api.incognitobrowser.io/scan-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: analysis.url }),
      });
      const data = await res.json();
      // The scanner API returns 400 + redirectTo when it hits a 3xx response.
      // This is exactly what we want for shorteners.
      if (data.redirectTo) {
        setUnfurled(data.redirectTo);
      } else if (res.ok) {
        // Scanner followed no redirect — target is the final URL already.
        setUnfurled(`No redirect found — this may not be a shortener, or it resolves via JavaScript. Final URL: ${data.url ?? analysis.url}`);
      } else {
        setUnfurlError(data.error || 'Failed to unfurl');
      }
    } catch {
      setUnfurlError('Network error. Could not reach the unfurl service.');
    }
    setUnfurling(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <label className="block text-sm font-medium text-[#B8B8D4] mb-2">Enter a URL to analyze</label>
        <div className="flex gap-2">
          <input
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            placeholder="https://example.com/page"
            className="flex-1 px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20 font-mono text-sm"
          />
          <button onClick={handleAnalyze} className="btn-primary px-6">Analyze</button>
        </div>
        <p className="mt-2 text-xs text-[#B8B8D4]/60">
          Structural analysis only — no request is made to the URL itself.
        </p>
      </div>

      {analysis && (
        <div className="space-y-4">
          {/* Score */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-lg font-bold text-white">Safety Score</span>
              <span className="text-3xl font-bold" style={{
                color: analysis.score >= 70 ? '#22c55e' : analysis.score >= 40 ? '#eab308' : '#ef4444'
              }}>{analysis.score}/100</span>
            </div>
            <div className="h-3 bg-[#191b1c] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${analysis.score}%`,
                  backgroundColor: analysis.score >= 70 ? '#22c55e' : analysis.score >= 40 ? '#eab308' : '#ef4444',
                }}
              />
            </div>
          </div>

          {/* Visual URL breakdown */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">URL Breakdown</h3>
            <div className="font-mono text-sm break-all">
              <span className="text-blue-400">{analysis.parts.protocol}://</span>
              {analysis.parts.subdomain && (
                <span className="text-[#B8B8D4]" title="Subdomain">{analysis.parts.subdomain}.</span>
              )}
              <span
                className={analysis.suspectedImpersonation ? 'text-red-400 font-bold underline decoration-wavy' : 'text-white font-bold'}
                title={analysis.suspectedImpersonation ? `Looks like ${analysis.suspectedImpersonation.brand}` : 'Registered domain'}
              >
                {analysis.parts.domain}
              </span>
              <span
                className={SUSPICIOUS_TLDS.has(analysis.parts.tld) ? 'text-yellow-400' : 'text-white'}
                title={SUSPICIOUS_TLDS.has(analysis.parts.tld) ? 'Suspicious TLD' : 'TLD'}
              >
                {analysis.parts.tld}
              </span>
              {analysis.parts.port && <span className="text-yellow-400" title="Non-standard port">:{analysis.parts.port}</span>}
              <span className="text-[#B8B8D4]" title="Path">{analysis.parts.path}</span>
              <span className="text-[#B8B8D4]/60" title="Query string">{analysis.parts.search}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#B8B8D4]/60">
              <span><span className="inline-block w-2 h-2 bg-blue-400 rounded-full mr-1"></span>Protocol</span>
              <span><span className="inline-block w-2 h-2 bg-white rounded-full mr-1"></span>Registered domain</span>
              <span><span className="inline-block w-2 h-2 bg-yellow-400 rounded-full mr-1"></span>Flagged as suspicious</span>
              <span><span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-1"></span>Likely malicious</span>
            </div>
          </div>

          {/* Shortener unfurl */}
          {analysis.isShortener && (
            <div className="bg-[#0a0a0a] border border-yellow-500/20 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-yellow-400 mb-2">URL Shortener Detected</h3>
              <p className="text-xs text-[#B8B8D4] mb-3">
                Fetch the redirect destination through our server (your IP stays private):
              </p>
              <button onClick={unfurlShortener} disabled={unfurling} className="btn-primary text-xs px-3 py-2">
                {unfurling ? 'Unfurling...' : 'Unfurl'}
              </button>
              {unfurled && (
                <div className="mt-3 p-3 bg-[#191b1c] rounded text-xs text-green-400 font-mono break-all">
                  → {unfurled}
                </div>
              )}
              {unfurlError && <p className="mt-3 text-xs text-red-400">{unfurlError}</p>}
            </div>
          )}

          {/* Details */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">URL Details</h3>
            <div className="space-y-2">
              {analysis.details.map((d, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">{d.label}</span>
                  <span className={`text-sm font-mono ${d.safe ? 'text-green-400' : 'text-yellow-400'}`}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Findings */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Findings</h3>
            <div className="space-y-2">
              {analysis.risks.map((r, i) => (
                <div key={i} className={`flex items-start gap-2 p-3 rounded-md ${
                  r.severity === 'high' ? 'bg-red-500/10' :
                  r.severity === 'medium' ? 'bg-yellow-500/10' : 'bg-blue-500/10'
                }`}>
                  <span className={`text-sm shrink-0 ${
                    r.severity === 'high' ? 'text-red-400' :
                    r.severity === 'medium' ? 'text-yellow-400' : 'text-blue-400'
                  }`}>
                    {r.severity === 'high' ? '✗' : r.severity === 'medium' ? '⚠' : 'ℹ'}
                  </span>
                  <span className="text-sm text-[#B8B8D4]">{r.message}</span>
                  <span className={`text-xs ml-auto shrink-0 px-2 py-0.5 rounded ${
                    r.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                    r.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>{r.severity}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
