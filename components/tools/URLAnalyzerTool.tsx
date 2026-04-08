'use client';

import { useState } from 'react';

interface URLAnalysis {
  url: string;
  score: number;
  risks: { severity: 'high' | 'medium' | 'low'; message: string }[];
  details: { label: string; value: string; safe: boolean }[];
  isHTTPS: boolean;
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

function analyzeURL(urlString: string): URLAnalysis {
  const risks: URLAnalysis['risks'] = [];
  const details: URLAnalysis['details'] = [];
  let score = 100;

  let parsed: URL;
  try {
    // Add protocol if missing
    if (!urlString.match(/^https?:\/\//i)) {
      urlString = 'https://' + urlString;
    }
    parsed = new URL(urlString);
  } catch {
    return {
      url: urlString,
      score: 0,
      risks: [{ severity: 'high', message: 'Invalid URL format' }],
      details: [],
      isHTTPS: false,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const fullURL = parsed.href;

  // HTTPS check
  const isHTTPS = parsed.protocol === 'https:';
  details.push({
    label: 'Protocol',
    value: parsed.protocol.replace(':', '').toUpperCase(),
    safe: isHTTPS,
  });
  if (!isHTTPS) {
    risks.push({ severity: 'high', message: 'Not using HTTPS — connection is unencrypted' });
    score -= 25;
  }

  // Domain analysis
  details.push({ label: 'Domain', value: hostname, safe: true });

  // Subdomain depth
  const parts = hostname.split('.');
  const subdomainDepth = parts.length - 2;
  if (subdomainDepth > 2) {
    risks.push({ severity: 'medium', message: `Excessive subdomains (${subdomainDepth}) — may be spoofing a legitimate domain` });
    score -= 15;
  }

  // TLD check
  const tld = '.' + parts[parts.length - 1];
  details.push({ label: 'TLD', value: tld, safe: !SUSPICIOUS_TLDS.has(tld) });
  if (SUSPICIOUS_TLDS.has(tld)) {
    risks.push({ severity: 'medium', message: `TLD "${tld}" is commonly used in phishing/spam sites` });
    score -= 15;
  }

  // URL shortener
  const baseDomain = parts.slice(-2).join('.');
  if (URL_SHORTENERS.has(baseDomain)) {
    risks.push({ severity: 'medium', message: 'URL shortener detected — destination is hidden' });
    score -= 10;
    details.push({ label: 'Type', value: 'URL Shortener', safe: false });
  }

  // Trusted domain check
  if (TRUSTED_DOMAINS.has(baseDomain)) {
    details.push({ label: 'Reputation', value: 'Known trusted domain', safe: true });
    score = Math.min(100, score + 5);
  }

  // IP address instead of domain
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    risks.push({ severity: 'high', message: 'URL uses an IP address instead of a domain name — common in phishing' });
    score -= 25;
  }

  // Homograph attack detection (mixed scripts in domain)
  if (/[^\x00-\x7F]/.test(hostname)) {
    risks.push({ severity: 'high', message: 'Domain contains non-ASCII characters — possible homograph/IDN attack' });
    score -= 30;
  }

  // Suspicious patterns in path
  const path = parsed.pathname + parsed.search;
  details.push({ label: 'Path', value: path || '/', safe: true });

  if (/@/.test(fullURL.split('//')[1]?.split('/')[0] || '')) {
    risks.push({ severity: 'high', message: 'URL contains "@" before the domain — this is a redirect trick' });
    score -= 25;
  }

  if (/login|signin|account|verify|secure|update|confirm|bank/i.test(path) && !TRUSTED_DOMAINS.has(baseDomain)) {
    risks.push({ severity: 'medium', message: 'Path contains login/account keywords — verify this is the real site' });
    score -= 10;
  }

  // Extremely long URL
  if (fullURL.length > 200) {
    risks.push({ severity: 'low', message: `URL is very long (${fullURL.length} chars) — could be hiding suspicious parameters` });
    score -= 5;
  }

  // Excessive query parameters
  const paramCount = parsed.searchParams.size;
  if (paramCount > 5) {
    risks.push({ severity: 'low', message: `${paramCount} query parameters — may include tracking parameters` });
    score -= 5;
  }
  if (paramCount > 0) {
    details.push({ label: 'Parameters', value: `${paramCount} params`, safe: paramCount <= 5 });
  }

  // Port check
  if (parsed.port && !['80', '443', ''].includes(parsed.port)) {
    risks.push({ severity: 'medium', message: `Non-standard port ${parsed.port} — unusual for legitimate websites` });
    score -= 10;
    details.push({ label: 'Port', value: parsed.port, safe: false });
  }

  // data: URI
  if (parsed.protocol === 'data:') {
    risks.push({ severity: 'high', message: 'Data URI detected — can be used for phishing' });
    score -= 40;
  }

  score = Math.max(0, Math.min(100, score));

  if (risks.length === 0) {
    risks.push({ severity: 'low', message: 'No obvious risks detected. Still exercise caution with unfamiliar sites.' });
  }

  return { url: fullURL, score, risks, details, isHTTPS };
}

export function URLAnalyzerTool() {
  const [url, setUrl] = useState('');
  const [analysis, setAnalysis] = useState<URLAnalysis | null>(null);

  const handleAnalyze = () => {
    if (!url.trim()) return;
    setAnalysis(analyzeURL(url.trim()));
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <label className="block text-sm font-medium text-[#B8B8D4] mb-2">
          Enter a URL to analyze
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            placeholder="https://example.com/page"
            className="flex-1 px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20 font-mono text-sm"
          />
          <button onClick={handleAnalyze} className="btn-primary px-6">Analyze</button>
        </div>
        <p className="mt-2 text-xs text-[#B8B8D4]/60">
          This tool analyzes URL structure for phishing indicators. No requests are made to the URL.
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
                  backgroundColor: analysis.score >= 70 ? '#22c55e' : analysis.score >= 40 ? '#eab308' : '#ef4444'
                }}
              />
            </div>
          </div>

          {/* Details */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">URL Details</h3>
            <div className="space-y-2">
              {analysis.details.map((d, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">{d.label}</span>
                  <span className={`text-sm font-mono ${d.safe ? 'text-green-400' : 'text-yellow-400'}`}>
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Risks */}
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
