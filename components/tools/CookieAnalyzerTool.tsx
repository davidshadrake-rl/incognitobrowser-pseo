'use client';

import { useState, useEffect, useMemo } from 'react';
import { scanUrl } from '@/lib/scan-client';
import { lookupCookieName } from '@/lib/scanner';
import { useReportResult, severityFromScore, type Severity, type ToolResult } from './ResultContext';
import { Icon } from '@/components/ui/Icon';
import { ConsoleFrame, statusFromSeverity } from './ConsoleFrame';
import type { Grade } from '@/lib/site-grade';

export interface CookieInfo {
  name: string;
  value: string;
  category: 'tracking' | 'analytics' | 'functional' | 'unknown';
  risk: 'high' | 'medium' | 'low';
  description: string;
}

export interface URLScanResult {
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

/**
 * Cookie names come from lib/scanner's one list (KNOWN_COOKIES +
 * KNOWN_COOKIE_PATTERNS), so a pasted list, this page's cookies and a URL
 * scan all call the same cookie by the same name and the same category.
 *
 * This file kept its own shorter table until 2026-09-11. It held 26 names and
 * none of the advertising ones, so pasting "__gads=1; __gpi=2; __eoi=3;
 * _gcl_aw=4; _gcl_dc=5; cto_bundle=6; _pubcid=7; AMCV_x=8" — Google Ad
 * Manager, Google Ads, Criteo, PubCommon ID and Adobe Experience Cloud —
 * scored 100/100, "A · Excellent", "8 cookies, 0 tracking and 0 analytics".
 */
export function categorizeCookie(name: string, value: string): CookieInfo {
  const known = lookupCookieName(name);
  if (known) {
    return { name, value, category: known.category, risk: known.risk, description: known.description };
  }
  const lower = name.toLowerCase();
  // "ad" and "stat" as whole name parts (ad_id, _ads, stats), not inside
  // other words: "header", "admin", "download" and "status" are not trackers,
  // and a wrong "tracking" now costs the score 15 points. Ad-click ids are
  // safe to add whole: no other kind of cookie is called gclid or msclkid.
  if (
    lower.includes('track') || /(?:^|[^a-z])ads?(?:[^a-z]|$)/.test(lower) || lower.includes('pixel') ||
    lower.includes('campaign') || lower.includes('retarget') || lower.includes('doubleclick') ||
    /(?:^|[^a-z])(?:gclid|fbclid|msclkid|ttclid|click_?id)(?:[^a-z]|$)/.test(lower)
  ) {
    return { name, value, category: 'tracking', risk: 'high', description: 'Likely a tracking or advertising cookie based on naming' };
  }
  if (lower.includes('analytics') || /(?:^|[^a-z])stats?(?:[^a-z]|$)|statistic/.test(lower) || lower.includes('metric')) {
    return { name, value, category: 'analytics', risk: 'medium', description: 'Likely an analytics cookie based on naming' };
  }
  if (lower.includes('session') || lower.includes('csrf') || lower.includes('token') || lower.includes('auth')) {
    return { name, value, category: 'functional', risk: 'low', description: 'Likely a functional/security cookie based on naming' };
  }
  return { name, value, category: 'unknown', risk: 'medium', description: 'Unknown cookie — could be functional or tracking' };
}

/** "a=1; b=2" or one cookie per line -> categorised cookies. Blank pieces ("a=1;;") are not cookies. */
export function parseCookieList(input: string): CookieInfo[] {
  return input
    .split(/[;\n]/)
    .map((c) => {
      const [name, ...rest] = c.trim().split('=');
      return { name: name.trim(), value: rest.join('=').trim() };
    })
    .filter((c) => c.name)
    .map((c) => categorizeCookie(c.name, c.value));
}

/** The counts the score is made of. A URL scan has all of them; a cookie list only the cookie ones. */
export interface CookieScoreInput {
  highRiskItems: number;
  trackingCookies: number;
  analyticsCookies: number;
  totalTrackers: number;
  thirdPartyScripts: number;
}

export interface SecurityHeaders {
  isHTTPS: boolean;
  hasCSP: boolean;
  hasPermPolicy: boolean;
  hasHSTS: boolean;
}

/**
 * The one scoring rule, for every mode: 100, minus 10 per high-risk item,
 * 5 per tracking cookie, 3 per analytics cookie, 5 per tracker and 2 per
 * third-party script (20 at most); a URL scan also loses 20 without HTTPS
 * and 5 each without CSP or HSTS. A cookie list has no trackers, scripts or
 * headers, so only its cookie points apply.
 */
export function cookiePrivacyScore(s: CookieScoreInput, security?: SecurityHeaders): number {
  let score = 100;
  score -= s.highRiskItems * 10;
  score -= s.trackingCookies * 5;
  score -= s.analyticsCookies * 3;
  score -= s.totalTrackers * 5;
  score -= Math.min(20, s.thirdPartyScripts * 2);
  if (security) {
    if (!security.isHTTPS) score -= 20;
    if (!security.hasCSP) score -= 5;
    if (!security.hasHSTS) score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * The letter for a score. Its bands are cut where severityFromScore and
 * severityFromGrade cut theirs, so the letter and the colour can never
 * disagree: A and B are green (≥80), C is amber (≥50), D and F are red.
 *
 * They used to be cut at 85/70/50/30, so 79 rendered "B · Good" on an amber
 * Warning and 84 rendered the same letter on green, and a scan with a
 * high-risk tracking cookie (85) was called "A · Excellent".
 */
export function gradeFromScore(score: number): { letter: Grade; label: string } {
  if (score >= 90) return { letter: 'A', label: 'Excellent' };
  if (score >= 80) return { letter: 'B', label: 'Good' };
  if (score >= 50) return { letter: 'C', label: 'Fair' };
  if (score >= 30) return { letter: 'D', label: 'Poor' };
  return { letter: 'F', label: 'Very Poor' };
}

/**
 * Everything one result shows, computed once. The console (status, gauge,
 * grade) and the result bus (CTA, scorecard) both read this object, so they
 * cannot disagree: the severity is severityFromScore(score) and nothing else.
 * The bus used to say red for any tracking cookie while the console graded
 * the same scan 85, "A · Excellent", on green.
 */
export interface CookieReport {
  score: number;
  grade: { letter: Grade; label: string };
  severity: Severity;
  result: ToolResult;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function urlScanReport(r: Pick<URLScanResult, 'url' | 'summary' | 'security'>): CookieReport {
  const sm = r.summary;
  const score = cookiePrivacyScore(sm, r.security);
  const grade = gradeFromScore(score);
  const severity = severityFromScore(score);
  let host = '';
  try { host = new URL(r.url).hostname; } catch { host = 'This site'; }
  const found = sm.trackingCookies || sm.totalTrackers
    ? `${count(sm.trackingCookies, 'tracking cookie')} and ${count(sm.totalTrackers, 'tracker')} before you click anything`
    : 'no tracking cookies or trackers before you click anything';
  return {
    score,
    grade,
    severity,
    result: {
      severity,
      headline: `${host} scores ${score}/100: ${found}${r.security.isHTTPS ? '' : ', and no HTTPS'}`,
      score,
      grade: grade.letter,
      stats: [
        { label: 'Tracking cookies', value: String(sm.trackingCookies) },
        { label: 'Trackers', value: String(sm.totalTrackers) },
        { label: 'Third parties', value: String(sm.thirdPartyScripts) },
        { label: 'Cookies', value: String(sm.totalCookies) },
      ],
    },
  };
}

/** "This page" (the cookies this page's scripts can read) and "Paste" results, on the same scoring rule. */
export function cookieListReport(cookies: CookieInfo[], mode: 'browser' | 'paste'): CookieReport {
  const tracking = cookies.filter((c) => c.category === 'tracking').length;
  const analytics = cookies.filter((c) => c.category === 'analytics').length;
  const functional = cookies.filter((c) => c.category === 'functional').length;
  const score = cookiePrivacyScore({
    highRiskItems: cookies.filter((c) => c.risk === 'high').length,
    trackingCookies: tracking,
    analyticsCookies: analytics,
    totalTrackers: 0,
    thirdPartyScripts: 0,
  });
  const grade = gradeFromScore(score);
  const severity = severityFromScore(score);
  const headline = cookies.length === 0
    ? mode === 'browser' ? 'This page has no cookies its scripts can read' : 'No cookies found in the pasted text'
    : `${mode === 'browser' ? 'This page scores' : 'The pasted cookies score'} ${score}/100: ${count(cookies.length, 'cookie')}, ${tracking} tracking and ${analytics} analytics`;
  return {
    score,
    grade,
    severity,
    result: {
      severity,
      headline,
      score,
      grade: grade.letter,
      stats: [
        { label: 'Tracking', value: String(tracking) },
        { label: 'Analytics', value: String(analytics) },
        { label: 'Functional', value: String(functional) },
        { label: 'Cookies', value: String(cookies.length) },
      ],
    },
  };
}

function getCategoryColor(cat: string) {
  switch (cat) {
    case 'tracking': return 'text-danger bg-danger-dim';
    case 'analytics': return 'text-warn bg-warn-dim';
    case 'functional': return 'text-ok bg-ok-dim';
    default: return 'text-t2 bg-white/5';
  }
}

function getRiskColor(risk: string) {
  switch (risk) {
    case 'high': return 'text-danger';
    case 'medium': return 'text-warn';
    default: return 'text-ok';
  }
}

function getSecurityIcon(ok: boolean) {
  return <Icon name={ok ? 'check' : 'x'} size={14} className="inline-block align-[-2px]" title={ok ? 'yes' : 'no'} />;
}

function getSecurityColor(ok: boolean) {
  return ok ? 'text-ok' : 'text-danger';
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
  const report = useReportResult();
  // One report per view, built by the same functions the consoles below read,
  // so the CTA, the scorecard and the console always give the same verdict.
  const urlReport = useMemo(() => (urlResult ? urlScanReport(urlResult) : null), [urlResult]);
  const listReport = useMemo(
    () => (scanned && mode !== 'url' ? cookieListReport(cookies, mode === 'browser' ? 'browser' : 'paste') : null),
    [scanned, mode, cookies],
  );
  // One effect for all three modes. "This Page" and "Paste" used to render
  // their result panel without ever reporting — no CTA, no scorecard on 5
  // Pro pages (found 2026-09-08). The URL branch also read the host from the
  // input box, so typing a new URL without scanning relabelled the old result.
  useEffect(() => {
    const current = mode === 'url' ? urlReport : listReport;
    report(current ? current.result : null);
  }, [mode, urlReport, listReport, report]);
  const [urlError, setUrlError] = useState('');
  // "This Page" / "Paste" results stay mounted across re-scans, so their console is told when each ran.
  const [cookieRunAt, setCookieRunAt] = useState(0);

  // document.cookie lists only the cookies scripts may read: HttpOnly cookies never appear in it.
  const scanBrowserCookies = () => {
    setCookieRunAt(Date.now());
    setCookies(parseCookieList(document.cookie));
    setScanned(true);
  };

  const analyzePastedCookies = () => {
    if (!customInput.trim()) return;
    setCookies(parseCookieList(customInput));
    setCookieRunAt(Date.now());
    setScanned(true);
  };


  const scanURL = async () => {
    if (!urlInput.trim()) return;
    setUrlScanning(true);
    setUrlError('');
    setUrlResult(null);
    setScanned(false);

    try {
      // 1. Get + solve POW challenge (defends against scripted abuse)
      // Shared client: challenge → solve → POST /scan-url with the proof.
      const { res, data } = await scanUrl<URLScanResult>(urlInput.trim(), setScanStatus);
      if (!res.ok) {
        setUrlError(data.error || 'Failed to scan URL');
      } else {
        setUrlResult(data);
      }
    } catch (err) {
      // Say what actually went wrong. A 403 is OUR allowlist rejecting this
      // page's origin — not a bad URL. Blaming the URL sent people in circles.
      const msg = err instanceof Error ? err.message : '';
      setUrlError(
        /403/.test(msg)
          ? 'This page isn\u2019t allowed to use the scanner (origin not allowlisted).'
          : /challenge/i.test(msg)
            ? 'Could not verify your browser. Please try again.'
            : 'Could not reach the scanner. Check your connection or ad blocker and try again.',
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
    // Safari starts the download asynchronously; revoking synchronously yields "Failed – No file".
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Mode toggle. The selected mode is filled white: the old 10% tint was
          hard to tell apart from the unselected ones. */}
      <div className="bg-s0 border border-b1 rounded-lg p-2 flex gap-1" role="group" aria-label="What to scan">
        <button
          type="button"
          aria-pressed={mode === 'url'}
          onClick={() => { setMode('url'); setScanned(false); setUrlResult(null); setUrlError(''); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'url' ? 'bg-white text-black' : 'text-t2 hover:text-white hover:bg-white/5'
          }`}
        >
          Scan a URL
        </button>
        <button
          type="button"
          aria-pressed={mode === 'browser'}
          onClick={() => { setMode('browser'); setScanned(false); setUrlResult(null); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'browser' ? 'bg-white text-black' : 'text-t2 hover:text-white hover:bg-white/5'
          }`}
        >
          This Page
        </button>
        <button
          type="button"
          aria-pressed={mode === 'paste'}
          onClick={() => { setMode('paste'); setScanned(false); setUrlResult(null); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'paste' ? 'bg-white text-black' : 'text-t2 hover:text-white hover:bg-white/5'
          }`}
        >
          Paste
        </button>
      </div>

      {/* Input area */}
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        {mode === 'url' ? (
          <div>
            <label className="block text-sm font-medium text-t2 mb-2">
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
                className="flex-1 px-4 py-3 bg-s0 border border-b1 rounded-md text-white placeholder-white/20 font-mono text-sm"
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
              <div className="mt-2 flex items-center gap-2 text-xs text-t2/80">
                <span className="inline-block w-1.5 h-1.5 bg-info rounded-full animate-pulse" />
                {scanStatus === 'verifying' && 'Requesting verification token from the server…'}
                {scanStatus === 'solving' && 'Proving you’re a real browser (one-time CPU check, ~half a second)…'}
                {scanStatus === 'scanning' && 'Fetching the site and analysing cookies, trackers, and scripts…'}
              </div>
            )}
            <p className="mt-2 text-xs text-t3">
              Scan has our server load the page, then lists the cookies it sets and the tracking scripts in its HTML. The site sees a visit from our server.
            </p>
          </div>
        ) : mode === 'browser' ? (
          <div className="text-center">
            <p className="text-t2 mb-4">
              List the cookies this page&apos;s scripts can read and see which ones track you. HttpOnly cookies are hidden from scripts, so they don&apos;t appear here.
            </p>
            <button onClick={scanBrowserCookies} className="btn-primary px-8 py-3">
              Scan Cookies
            </button>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-t2 mb-2">
              Paste cookie string (from DevTools &gt; Application &gt; Cookies)
            </label>
            <textarea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="_ga=GA1.2.123; _fbp=fb.1.123; session=abc123"
              rows={4}
              className="w-full px-4 py-3 bg-s0 border border-b1 rounded-md text-white placeholder-white/20 font-mono text-sm mb-3"
            />
            <button onClick={analyzePastedCookies} className="btn-primary w-full py-3">
              Analyze Cookies
            </button>
          </div>
        )}
      </div>

      {/* URL scan error */}
      {urlError && (
        <div className="bg-s0 border border-danger/30 rounded-lg p-4 text-sm text-danger">
          {urlError}
        </div>
      )}

      {/* ===== URL SCAN RESULTS ===== */}
      {urlResult && urlReport && (() => {
        const { score, grade } = urlReport;
        return (
        <ConsoleFrame
          engine="cookie-analyzer"
          status={statusFromSeverity(urlReport.severity)}
          score={score}
          gaugeLabel={`grade ${grade.letter}`}
          tally={{
            fails: urlResult.summary.trackingCookies,
            warns: urlResult.summary.analyticsCookies,
            passes: urlResult.summary.functionalCookies,
          }}
          statTiles={[
            { label: 'Grade', value: `${grade.letter} · ${grade.label}` },
            { label: 'Cookies', value: urlResult.summary.totalCookies },
            { label: 'Trackers', value: urlResult.summary.totalTrackers },
            { label: '3rd party scripts', value: urlResult.summary.thirdPartyScripts },
          ]}
        >
        <div className="space-y-4">
          <p className="text-sm text-white font-medium truncate">{urlResult.url} <span className="text-t2 font-normal">HTTP {urlResult.status}</span></p>

          {/* Cookie breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-s0 border border-b1 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{urlResult.summary.totalCookies}</div>
              <div className="text-xs text-t2">Total Cookies</div>
            </div>
            <div className="bg-s0 border border-danger/30 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-danger">{urlResult.summary.trackingCookies}</div>
              <div className="text-xs text-t2">Tracking</div>
            </div>
            <div className="bg-s0 border border-warn/30 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-warn">{urlResult.summary.analyticsCookies}</div>
              <div className="text-xs text-t2">Analytics</div>
            </div>
            <div className="bg-s0 border border-ok/30 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-ok">{urlResult.summary.functionalCookies}</div>
              <div className="text-xs text-t2">Functional</div>
            </div>
          </div>

          {/* Security headers */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Security Headers</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.isHTTPS)}>{getSecurityIcon(urlResult.security.isHTTPS)}</span>
                <span className="text-sm text-t2">HTTPS</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.hasHSTS)}>{getSecurityIcon(urlResult.security.hasHSTS)}</span>
                <span className="text-sm text-t2">HSTS</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.hasCSP)}>{getSecurityIcon(urlResult.security.hasCSP)}</span>
                <span className="text-sm text-t2">Content Security Policy</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={getSecurityColor(urlResult.security.hasPermPolicy)}>{getSecurityIcon(urlResult.security.hasPermPolicy)}</span>
                <span className="text-sm text-t2">Permissions Policy</span>
              </div>
            </div>
          </div>

          {/* Tracking scripts detected */}
          {(urlResult.trackers.length > 0 || urlResult.inlineTrackers.length > 0) && (
            <div className="bg-s0 border border-danger/30 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-danger mb-3">
                Tracking Scripts Detected ({urlResult.trackers.length + urlResult.inlineTrackers.length})
              </h3>
              <div className="space-y-2">
                {urlResult.trackers.map((t, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-danger-dim rounded-md">
                    <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${getCategoryColor(t.category)}`}>
                      {t.category}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white">{t.name}</div>
                      <p className="text-xs text-t2/80">{t.description}</p>
                    </div>
                    <span className={`text-xs shrink-0 ${getRiskColor(t.risk)}`}>{t.risk}</span>
                  </div>
                ))}
                {urlResult.inlineTrackers.map((t, i) => (
                  <div key={`inline-${i}`} className="flex items-center gap-3 p-3 bg-danger-dim rounded-md">
                    <span className="text-xs px-2 py-0.5 rounded text-danger bg-danger-dim">inline</span>
                    <span className="text-sm text-white">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export */}
          <div className="bg-s0 border border-b1 rounded-lg p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white font-medium">Compliance report</p>
              <p className="text-xs text-t2">
                Export cookies, trackers, and third-party scripts to CSV for GDPR/CCPA audits.
              </p>
            </div>
            <button
              onClick={() => downloadCsv(urlResult)}
              className="text-sm px-4 py-2 border border-b1 rounded text-white hover:bg-white/5 shrink-0"
            >
              Export CSV
            </button>
          </div>

          {/* Cookies detail */}
          {urlResult.cookies.length > 0 && (
            <div className="bg-s0 border border-b1 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-3">Cookies ({urlResult.cookies.length})</h3>
              <div className="space-y-3">
                {urlResult.cookies.map((c, i) => (
                  <div key={i} className="border border-hair rounded-lg p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <code className="text-sm font-mono text-white min-w-0 break-all">{c.cookieName}</code>
                      <div className="flex gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded ${getCategoryColor(c.category)}`}>
                          {c.category}
                        </span>
                        <span className={`text-xs ${getRiskColor(c.risk)}`}>
                          {c.risk}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-t2/80 mb-2">{c.description}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className={`px-2 py-0.5 rounded ${c.secure ? 'bg-ok-dim text-ok' : 'bg-danger-dim text-danger'}`}>
                        {c.secure ? 'Secure' : 'Not Secure'}
                      </span>
                      <span className={`px-2 py-0.5 rounded ${c.httpOnly ? 'bg-ok-dim text-ok' : 'bg-warn-dim text-warn'}`}>
                        {c.httpOnly ? 'HttpOnly' : 'JS Accessible'}
                      </span>
                      <span className={`px-2 py-0.5 rounded ${
                        c.sameSite.toLowerCase() === 'strict' ? 'bg-ok-dim text-ok' :
                        c.sameSite.toLowerCase() === 'lax' ? 'bg-warn-dim text-warn' :
                        c.sameSite.toLowerCase() === 'none' ? 'bg-danger-dim text-danger' :
                        'bg-white/5 text-t2'
                      }`}>
                        SameSite: {c.sameSite}
                      </span>
                      {c.domain && (
                        <span className="px-2 py-0.5 rounded bg-white/5 text-t2">
                          {c.domain}
                        </span>
                      )}
                      {isThirdParty(c.domain, urlResult.url) && (
                        <span className="px-2 py-0.5 rounded bg-danger/20 text-danger" title="Cookie's domain differs from the site's domain">
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
            <div className="bg-s0 border border-b1 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-3">
                Third-Party Script Domains ({urlResult.thirdPartyDomains.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {urlResult.thirdPartyDomains.map((domain, i) => (
                  <span key={i} className="text-xs px-2 py-1 bg-white/5 rounded font-mono text-t2">
                    {domain}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-t3">
                Each third-party domain can potentially track your activity across websites.
              </p>
            </div>
          )}

          {/* Nothing found. Inline trackers count too: the box used to show
              beside a "Tracking Scripts Detected" list of inline pixels. */}
          {urlResult.summary.totalCookies === 0 && urlResult.trackers.length === 0 && urlResult.inlineTrackers.length === 0 && (
            <div className="bg-s0 border border-ok/30 rounded-lg p-6 text-center">
              <div className="text-ok text-lg font-semibold mb-2">No cookies or known trackers</div>
              <p className="text-sm text-t2">
                The first page load set no cookies and loaded no script this scanner recognises as a tracker.
                {urlResult.thirdPartyDomains.length > 0 && ` It still loads scripts from ${urlResult.thirdPartyDomains.length === 1 ? '1 other domain' : `${urlResult.thirdPartyDomains.length} other domains`}, listed above.`}
              </p>
            </div>
          )}
        </div>
        </ConsoleFrame>
        );
      })()}

      {/* ===== BROWSER / PASTE RESULTS ===== */}
      {scanned && mode !== 'url' && listReport && (
        <ConsoleFrame
          engine="cookie-analyzer"
          status={statusFromSeverity(listReport.severity)}
          score={listReport.score}
          gaugeLabel={`grade ${listReport.grade.letter}`}
          checks={cookies.length}
          checksNoun={['cookie', 'cookies']}
          runAt={cookieRunAt || undefined}
          tally={{ fails: tracking.length, warns: analytics.length, passes: functional.length }}
          statTiles={[
            { label: 'Grade', value: `${listReport.grade.letter} · ${listReport.grade.label}` },
            { label: 'Tracking', value: tracking.length },
            { label: 'Analytics', value: analytics.length },
            { label: 'Functional', value: functional.length },
          ]}
        >
          {cookies.length === 0 ? (
            <div className="bg-s0 border border-ok/30 rounded-lg p-6 text-center">
              <div className="text-ok text-lg font-semibold mb-2">No cookies detected</div>
              <p className="text-sm text-t2">
                {mode === 'browser'
                  ? 'This page has no cookies its scripts can read.'
                  : 'No valid cookies found in the input.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cookies.map((c, i) => (
                <div key={i} className="bg-s0 border border-b1 rounded-lg p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <code className="text-sm font-mono text-white min-w-0 break-all">{c.name}</code>
                    <div className="flex gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded ${getCategoryColor(c.category)}`}>
                        {c.category}
                      </span>
                      <span className={`text-xs ${getRiskColor(c.risk)}`}>
                        {c.risk} risk
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-t2/80 mb-1">{c.description}</p>
                  <div className="bg-s0 p-2 rounded text-xs font-mono text-t3 truncate">
                    {c.value || '(empty)'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ConsoleFrame>
      )}
    </div>
  );
}
