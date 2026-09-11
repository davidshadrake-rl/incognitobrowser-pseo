'use client';

import { useState, useEffect } from 'react';
import { scanUrl } from '@/lib/scan-client';
import { useReportResult, type Severity } from './ResultContext';
import { Icon } from '@/components/ui/Icon';
import { ConsoleFrame, statusFromSeverity } from './ConsoleFrame';

export interface URLAnalysis {
  url: string;
  score: number;
  risks: { severity: 'high' | 'medium' | 'low'; message: string }[];
  /** Structural checks run on this URL (the trusted-domain skips don't count). */
  checks: number;
  /** Checks that found nothing. Each check adds at most one risk, so this is checks - risks. */
  passed: number;
  /** A caveat about the result, not a finding: never counted as a risk. */
  note?: string;
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

export function analyzeURL(urlString: string): URLAnalysis {
  if (urlString.length > 2048) {
    return {
      url: urlString.substring(0, 100) + '...',
      score: 10,
      risks: [{ severity: 'high', message: 'URL is suspiciously long (over 2048 characters)' }],
      checks: 1,
      passed: 0,
      details: [{ label: 'Length', value: `${urlString.length} characters`, safe: false }],
      parts: { protocol: '', subdomain: '', domain: '', tld: '', port: '', path: '', search: '' },
      isHTTPS: false,
      isShortener: false,
    };
  }

  const risks: URLAnalysis['risks'] = [];
  const details: URLAnalysis['details'] = [];
  let score = 100;
  // One per structural check below; each check pushes at most one risk, so
  // checks - risks.length is the number that passed (the console's "Passes").
  let checks = 0;

  let parsed: URL;
  try {
    if (!urlString.match(/^https?:\/\//i)) urlString = 'https://' + urlString;
    parsed = new URL(urlString);
  } catch {
    return {
      url: urlString,
      score: 0,
      risks: [{ severity: 'high', message: 'Invalid URL format' }],
      checks: 1,
      passed: 0,
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
  checks++;
  if (!isHTTPS) {
    risks.push({ severity: 'high', message: 'Not using HTTPS — connection is unencrypted' });
    score -= 25;
  }

  details.push({ label: 'Domain', value: hostname, safe: true });

  // Subdomain depth
  const subdomainDepth = subdomain ? subdomain.split('.').length : 0;
  checks++;
  if (subdomainDepth > 2) {
    risks.push({ severity: 'medium', message: `Excessive subdomains (${subdomainDepth}) — may be spoofing a legitimate domain` });
    score -= 15;
  }

  details.push({ label: 'TLD', value: tld, safe: !SUSPICIOUS_TLDS.has(tld) });
  checks++;
  if (SUSPICIOUS_TLDS.has(tld)) {
    risks.push({ severity: 'medium', message: `TLD "${tld}" is commonly used in phishing/spam sites` });
    score -= 15;
  }

  // URL shortener
  const isShortener = URL_SHORTENERS.has(baseDomain);
  checks++;
  if (isShortener) {
    risks.push({ severity: 'medium', message: 'URL shortener detected — the destination is hidden. Press "Show where it leads" below to see it.' });
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
  checks++;
  if (hostname.startsWith('xn--') || hostname.includes('.xn--')) {
    risks.push({ severity: 'high', message: 'Domain uses Punycode (xn--...) — may be a homograph attack. Decode before trusting.' });
    score -= 30;
  }
  checks++;
  if (/[^\x00-\x7F]/.test(hostname)) {
    risks.push({ severity: 'high', message: 'Domain contains non-ASCII characters — possible homograph/IDN attack' });
    score -= 30;
  }

  // Typosquat / brand impersonation detection
  let suspectedImpersonation: URLAnalysis['suspectedImpersonation'];
  if (domain && !isTrusted) {
    checks++;
    // Strip common number-for-letter leet (0→o, 1→l, etc.) to catch leet typosquats
    const normalized = domain.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');
    let best: { brand: string; distance: number } | null = null;
    for (const brand of POPULAR_BRANDS) {
      if (domain === brand) continue; // the brand's own name — already caught by TRUSTED_DOMAINS if legit
      // A pure leet swap (paypa1 -> paypal) normalises to exactly the brand. This
      // used to `continue` on the normalised name, so the textbook typosquats
      // were never flagged; count the edits in the name as typed instead.
      const d = normalized === brand ? levenshtein(domain, brand) : levenshtein(normalized, brand);
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
  checks++;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    risks.push({ severity: 'high', message: 'URL uses an IP address instead of a domain name — common in phishing' });
    score -= 25;
  }

  // Suspicious patterns
  const pathAndSearch = parsed.pathname + parsed.search;
  details.push({ label: 'Path', value: pathAndSearch || '/', safe: true });

  checks++;
  if (parsed.username || /@/.test(fullURL.split('//')[1]?.split('/')[0] || '')) {
    risks.push({ severity: 'high', message: 'URL contains "@" before the domain — this is a redirect trick' });
    score -= 25;
  }

  if (!isTrusted) {
    checks++;
    if (/login|signin|account|verify|secure|update|confirm|bank/i.test(pathAndSearch)) {
      risks.push({ severity: 'medium', message: 'Path contains login/account keywords — verify this is the real site' });
      score -= 10;
    }
  }

  checks++;
  if (fullURL.length > 200) {
    risks.push({ severity: 'low', message: `URL is very long (${fullURL.length} chars) — could be hiding suspicious parameters` });
    score -= 5;
  }

  const paramCount = parsed.searchParams.size;
  checks++;
  if (paramCount > 5) {
    risks.push({ severity: 'low', message: `${paramCount} query parameters — may include tracking parameters` });
    score -= 5;
  }
  if (paramCount > 0) details.push({ label: 'Parameters', value: `${paramCount} params`, safe: paramCount <= 5 });

  checks++;
  if (parsed.port && !['80', '443', ''].includes(parsed.port)) {
    risks.push({ severity: 'medium', message: `Non-standard port ${parsed.port} — unusual for legitimate websites` });
    score -= 10;
    details.push({ label: 'Port', value: parsed.port, safe: false });
  }

  // If we have no reputation data and the URL has no high or medium finding, cap the ceiling.
  // A brand-new phishing domain with HTTPS and a clean path shouldn't score 100/100.
  // Minor findings do not lift the cap: when it applied only with no findings
  // at all, the same unknown site read "Pass" at 95 with one minor finding
  // and "Not verified" at 75 with none, so a cleaner link got a worse verdict.
  // The caveat is a note, not a risk: as a risk it made a clean link read
  // "This link has 1 warning signs" and counted as a finding in the tally.
  let note: string | undefined;
  if (!isTrusted && !risks.some((r) => r.severity !== 'low')) {
    score = Math.min(score, 75);
    note = 'Structural checks only — this tool does not query reputation databases. Verify unfamiliar sites through other channels before entering credentials.';
  }

  score = Math.max(0, Math.min(100, score));

  return { url: fullURL, score, risks, checks, passed: checks - risks.length, note, details, parts, isHTTPS, isShortener, suspectedImpersonation };
}

/**
 * The verdict word and its colour, read from the findings like the tally
 * beside the gauge. They used to follow the score, which the "structural
 * checks only" cap holds at 75: a clean unknown link read "Warning" next to
 * "Warns 0", and a short link (score 90, one warning) read "Pass".
 * Low-severity findings are "Minor" in the tally and do not change the word.
 */
export function urlVerdict(a: URLAnalysis): { word: 'Fail' | 'Warning' | 'Not verified' | 'Pass'; severity: Severity } {
  if (a.risks.some((r) => r.severity === 'high')) return { word: 'Fail', severity: 'red' };
  if (a.risks.some((r) => r.severity === 'medium')) return { word: 'Warning', severity: 'amber' };
  // No fail or warning, but only the link's structure was checked (see `note`).
  if (a.note) return { word: 'Not verified', severity: 'amber' };
  return { word: 'Pass', severity: 'green' };
}

export function URLAnalyzerTool() {
  const [url, setUrl] = useState('');
  const [analysis, setAnalysis] = useState<URLAnalysis | null>(null);
  const report = useReportResult();
  useEffect(() => {
    if (!analysis) { report(null); return; }
    const high = analysis.risks.filter((r) => r.severity === 'high').length;
    const medium = analysis.risks.filter((r) => r.severity === 'medium').length;
    report({
      // The same rule as the console header, so the CTA and the header agree.
      severity: urlVerdict(analysis).severity,
      score: analysis.score,
      // Warning signs are the medium findings, the tally's "Warns"; minor ones are not counted as warnings.
      headline: analysis.suspectedImpersonation ? `This link imitates ${analysis.suspectedImpersonation.brand}` : high ? `This link shows ${high} high-risk phishing sign${high === 1 ? '' : 's'}` : medium ? `This link has ${medium} warning sign${medium === 1 ? '' : 's'}` : `No phishing signs found in this link`,
      stats: [{ label: 'Safety score', value: `${analysis.score}/100` }, { label: 'High risk', value: String(high) }, { label: 'Warnings', value: String(medium) }, { label: 'HTTPS', value: analysis.isHTTPS ? 'yes' : 'no' }],
    });
  }, [analysis, report]);
  const [unfurling, setUnfurling] = useState(false);
  const [unfurled, setUnfurled] = useState('');
  const [unfurlError, setUnfurlError] = useState('');
  // The console stays mounted across analyses, so it is told when each one ran.
  const [runAt, setRunAt] = useState(0);

  const handleAnalyze = () => {
    if (!url.trim()) return;
    setAnalysis(analyzeURL(url.trim()));
    setRunAt(Date.now());
    setUnfurled('');
    setUnfurlError('');
  };

  const unfurlShortener = async () => {
    if (!analysis) return;
    setUnfurling(true);
    setUnfurlError('');
    setUnfurled('');
    try {
      // Goes through the shared scanner client: fetches + solves the PoW
      // challenge, then POSTs with the proof. The old direct fetch had no
      // proof (rejected) AND targeted a hostname that does not resolve.
      const { res, data } = await scanUrl(analysis.url);
      // The scanner API returns 400 + redirectTo when it hits a 3xx response.
      // This is exactly what we want for shorteners.
      if (data.redirectTo) {
        setUnfurled(data.redirectTo);
      } else if (res.ok) {
        // Scanner followed no redirect — target is the final URL already.
        setUnfurled(`This link didn't redirect. It may not be a short link, or it redirects with JavaScript, which our server doesn't run. Address: ${data.url ?? analysis.url}`);
      } else {
        setUnfurlError(data.error || 'Could not find where this link leads.');
      }
    } catch {
      setUnfurlError('Could not reach our server. Check your connection and try again.');
    }
    setUnfurling(false);
  };

  return (
    <div className="space-y-6">
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        <label className="block text-sm font-medium text-t2 mb-2">Enter a URL to analyze</label>
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
            className="flex-1 px-4 py-3 bg-s0 border border-b1 rounded-md text-white placeholder-white/20 font-mono text-sm"
          />
          <button onClick={handleAnalyze} className="btn-primary px-6">Analyze</button>
        </div>
        <p className="mt-2 text-xs text-t3">
          Checks how the link is built: protocol, domain, look-alike letters, raw IP addresses, shorteners and more.
        </p>
      </div>

      {analysis && (
        <ConsoleFrame
          engine="url-analyzer"
          status={statusFromSeverity(urlVerdict(analysis).severity)}
          verdict={urlVerdict(analysis).word}
          checks={analysis.checks}
          runAt={runAt || undefined}
          score={analysis.score}
          gaugeLabel="safety"
          // Passes are checks that found nothing. Low-severity findings are
          // "Minor": they used to be counted as "Passes", so a link with three
          // minor risks read as passing three checks.
          tally={{
            fails: analysis.risks.filter((r) => r.severity === 'high').length,
            warns: analysis.risks.filter((r) => r.severity === 'medium').length,
            minor: analysis.risks.filter((r) => r.severity === 'low').length,
            passes: analysis.passed,
          }}
        >
        <div className="space-y-4">
          {/* Visual URL breakdown */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">URL Breakdown</h3>
            <div className="font-mono text-sm break-all">
              <span className="text-info">{analysis.parts.protocol}://</span>
              {analysis.parts.subdomain && (
                <span className="text-t2" title="Subdomain">{analysis.parts.subdomain}.</span>
              )}
              <span
                className={analysis.suspectedImpersonation ? 'text-danger font-bold underline decoration-wavy' : 'text-white font-bold'}
                title={analysis.suspectedImpersonation ? `Looks like ${analysis.suspectedImpersonation.brand}` : 'Registered domain'}
              >
                {analysis.parts.domain}
              </span>
              <span
                className={SUSPICIOUS_TLDS.has(analysis.parts.tld) ? 'text-warn' : 'text-white'}
                title={SUSPICIOUS_TLDS.has(analysis.parts.tld) ? 'Suspicious TLD' : 'TLD'}
              >
                {analysis.parts.tld}
              </span>
              {analysis.parts.port && <span className="text-warn" title="Non-standard port">:{analysis.parts.port}</span>}
              <span className="text-t2" title="Path">{analysis.parts.path}</span>
              <span className="text-t3" title="Query string">{analysis.parts.search}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-t3">
              <span><span className="inline-block w-2 h-2 bg-info rounded-full mr-1"></span>Protocol</span>
              <span><span className="inline-block w-2 h-2 bg-white rounded-full mr-1"></span>Registered domain</span>
              <span><span className="inline-block w-2 h-2 bg-warn rounded-full mr-1"></span>Flagged as suspicious</span>
              <span><span className="inline-block w-2 h-2 bg-danger rounded-full mr-1"></span>Likely malicious</span>
            </div>
          </div>

          {/* Shortener unfurl */}
          {analysis.isShortener && (
            <div className="bg-s0 border border-warn/30 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-warn mb-2">URL Shortener Detected</h3>
              <p className="text-xs text-t2 mb-3">
                See where this short link leads before you open it. Our server opens the link and shows you the address it redirects to.
              </p>
              <button onClick={unfurlShortener} disabled={unfurling} className="btn-primary text-xs px-3 py-2">
                {unfurling ? 'Checking...' : 'Show where it leads'}
              </button>
              {unfurled && (
                <div className="mt-3 p-3 bg-s0 rounded text-xs text-ok font-mono break-all">
                  → {unfurled}
                </div>
              )}
              {unfurlError && <p className="mt-3 text-xs text-danger">{unfurlError}</p>}
            </div>
          )}

          {/* Details */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">URL Details</h3>
            <div className="space-y-2">
              {analysis.details.map((d, i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <span className="text-sm text-t2 shrink-0">{d.label}</span>
                  {/* Phishing URLs are exactly the long ones: let the path wrap instead of overflowing the card. */}
                  <span className={`text-sm font-mono min-w-0 break-all text-right ${d.safe ? 'text-ok' : 'text-warn'}`}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Findings */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Findings</h3>
            <div className="space-y-2">
              {analysis.risks.map((r, i) => (
                <div key={i} className={`flex items-start gap-2 p-3 rounded-md ${
                  r.severity === 'high' ? 'bg-danger-dim' :
                  r.severity === 'medium' ? 'bg-warn-dim' : 'bg-info-dim'
                }`}>
                  <span className={`text-sm shrink-0 ${
                    r.severity === 'high' ? 'text-danger' :
                    r.severity === 'medium' ? 'text-warn' : 'text-info'
                  }`}>
                    <Icon name={r.severity === 'high' ? 'x' : r.severity === 'medium' ? 'warn' : 'info'} size={14} className="mt-0.5" />
                  </span>
                  <span className="text-sm text-t2">{r.message}</span>
                  {/* Same words as the tally beside the gauge. */}
                  <span className={`text-xs ml-auto shrink-0 px-2 py-0.5 rounded ${
                    r.severity === 'high' ? 'bg-danger/20 text-danger' :
                    r.severity === 'medium' ? 'bg-warn/20 text-warn' : 'bg-info/20 text-info'
                  }`}>{r.severity === 'high' ? 'fail' : r.severity === 'medium' ? 'warn' : 'minor'}</span>
                </div>
              ))}
              {analysis.risks.length === 0 && (
                <p className="flex items-start gap-2 text-sm text-ok">
                  <Icon name="check" size={14} className="mt-0.5" /> None of the {analysis.checks} checks found a problem.
                </p>
              )}
              {analysis.note && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-info-dim">
                  <span className="text-sm shrink-0 text-info"><Icon name="info" size={14} className="mt-0.5" /></span>
                  <span className="text-sm text-t2">{analysis.note}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        </ConsoleFrame>
      )}
    </div>
  );
}
