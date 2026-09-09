'use client';

import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import { useReportResult, type ToolResult } from '@/components/tools/ResultContext';
import {
  MAX_HOPS,
  MAX_INPUT_LENGTH,
  analyzeLink,
  type ClassifiedParam,
  type LinkAnalysis,
  type LinkResult,
} from '@/lib/link-unwrapper';

const EXAMPLES: { label: string; url: string }[] = [
  {
    label: 'Google redirect with a Facebook click ID',
    url:
      'https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fdeals%2Fspring%3Futm_source%3Dnewsletter%26utm_medium%3Demail%26utm_campaign%3Dspring_sale%26fbclid%3DIwAR2kQ9x7Lm3pZ8vN1cT4wY6uH0sB2dF5gJ8&sa=D&source=editors&ust=1710000000000',
  },
  {
    label: 'Safe Links wrapping a Mailchimp email link',
    url:
      'https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fwebinar%3Fmc_cid%3D9f2e1a77b4%26mc_eid%3D4b1c8d0e77&data=05%7C02%7C&sdata=Q2xpY2tlZA%3D%3D&reserved=0',
  },
  {
    label: 'A clean link',
    url: 'https://en.wikipedia.org/wiki/UTM_parameters',
  },
];

const SEVERITY_STYLES: Record<LinkAnalysis['severity'], { border: string; text: string; bg: string; label: string }> = {
  red: { border: 'border-danger/30', text: 'text-danger', bg: 'bg-danger-dim', label: 'Exposed' },
  amber: { border: 'border-warn/30', text: 'text-warn', bg: 'bg-warn-dim', label: 'Partial' },
  green: { border: 'border-ok/30', text: 'text-ok', bg: 'bg-ok-dim', label: 'Clean' },
};

const CLASS_STYLES: Record<ClassifiedParam['cls'], { pill: string; label: string }> = {
  identity: { pill: 'bg-danger/20 text-danger', label: 'Identity' },
  campaign: { pill: 'bg-warn/20 text-warn', label: 'Campaign' },
  kept: { pill: 'bg-white/10 text-t2', label: 'Kept' },
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function toToolResult(a: LinkAnalysis): ToolResult {
  return {
    severity: a.severity,
    headline: a.headline,
    detail: a.detail,
    stats: a.stats,
    shareText: a.shareText,
  };
}

export function LinkUnwrapperTool() {
  const report = useReportResult();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<LinkResult | null>(null);
  const [copied, setCopied] = useState(false);

  const run = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setResult(null);
      return;
    }
    setResult(analyzeLink(trimmed));
    setCopied(false);
  }, []);

  // Result bus: report whenever the analysis changes; clear on error or empty input.
  useEffect(() => {
    report(result && result.ok ? toToolResult(result) : null);
  }, [result, report]);

  const handleChange = (value: string) => {
    setInput(value);
    if (!value.trim()) setResult(null);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    e.preventDefault();
    const next = text.trim().slice(0, MAX_INPUT_LENGTH);
    setInput(next);
    run(next);
  };

  const loadExample = (url: string) => {
    setInput(url);
    run(url);
  };

  const copyClean = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const analysis = result && result.ok ? result : null;
  const error = result && !result.ok ? result.error : null;
  const sev = analysis ? SEVERITY_STYLES[analysis.severity] : null;

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        <label htmlFor="link-unwrapper-input" className="block text-sm font-medium text-t2 mb-2">
          Paste a link from an email, text message, ad or social post
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="link-unwrapper-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_INPUT_LENGTH}
            value={input}
            onChange={(e) => handleChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => e.key === 'Enter' && run(input)}
            placeholder="https://www.google.com/url?q=https%3A%2F%2Fexample.com%2F%3Ffbclid%3D..."
            className="flex-1 min-w-0 px-4 py-3 bg-s0 border border-b1 rounded-md text-white placeholder-white/20 font-mono text-sm"
          />
          <button onClick={() => run(input)} className="btn-primary px-6" type="button">
            Unwrap
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-t3">Try an example:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => loadExample(ex.url)}
              className="px-2 py-1 rounded border border-b1 text-t2 hover:text-white hover:border-b2 transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-t3">
          Parsed entirely in your browser. The link is never fetched, so nothing is logged by the sender, the redirect
          service or the destination.
        </p>
      </div>

      {error && (
        <div className="bg-s0 border border-danger/30 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-danger mb-1">Could not read that link</h3>
          <p className="text-sm text-t2">{error}</p>
        </div>
      )}

      {analysis && sev && (
        <div className="space-y-4">
          {/* Verdict */}
          <div className={`bg-s0 border ${sev.border} rounded-lg p-6`}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className={`text-xs uppercase tracking-wide font-semibold ${sev.text} mb-1`}>{sev.label}</div>
                <h3 className="text-lg font-bold text-white">{analysis.headline}</h3>
                <p className="mt-1 text-sm text-t2">{analysis.detail}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {analysis.stats.map((s) => (
                <div key={s.label} className="bg-s0 border border-b1 rounded-md p-3">
                  <div className="text-xs text-t2 mb-1">{s.label}</div>
                  <div
                    className={`text-2xl font-bold ${
                      s.label === 'Identity IDs' && analysis.identityCount > 0 ? 'text-danger' : 'text-white'
                    }`}
                  >
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Redirect chain */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-1">Redirect chain</h3>
            <p className="text-xs text-t3 mb-4">
              {analysis.redirectCount > 0
                ? `Each hop is a service that records your click before forwarding you. Decoded ${analysis.redirectCount} ${
                    analysis.redirectCount === 1 ? 'layer' : 'layers'
                  } by parsing alone.`
                : 'No redirect wrapper detected. The link points straight at its destination.'}
            </p>
            <ol className="space-y-2">
              {analysis.hops.map((hop, i) => {
                const isLast = i === analysis.hops.length - 1;
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className={`shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                        isLast ? 'bg-white text-s0' : 'bg-white/10 text-t2'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white">{hop.host}</span>
                        {hop.wrapper && (
                          <span className="text-xs px-2 py-0.5 rounded bg-warn/20 text-warn">{hop.wrapper} redirect</span>
                        )}
                        {isLast && !hop.wrapper && (
                          <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-t2">Destination</span>
                        )}
                      </div>
                      <code className="block text-xs text-t2/80 font-mono break-all">{truncate(hop.url, 400)}</code>
                    </div>
                  </li>
                );
              })}
            </ol>
            {analysis.opaqueWrapper && (
              <p className="mt-4 text-xs text-warn">
                {analysis.opaqueWrapper.vendor} wraps this link in a form that cannot be fully decoded without fetching it.
                {analysis.opaqueWrapper.wrappedHost
                  ? ` It points at ${analysis.opaqueWrapper.wrappedHost}.`
                  : ' The destination stays hidden.'}
              </p>
            )}
            {analysis.hiddenDestination && (
              <p className="mt-4 text-xs text-warn">
                {analysis.hiddenDestination.host} is a shortener or mail gateway: it only reveals the real destination when
                the link is opened, and it logs every click. Trackers waiting on the other side are unknown.
              </p>
            )}
            {analysis.hitHopLimit && (
              <p className="mt-4 text-xs text-warn">
                Stopped after {MAX_HOPS} hops. The last URL is itself another redirect wrapper.
              </p>
            )}
          </div>

          {/* Tracking parameters */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-1">Tracking parameters on the destination</h3>
            <p className="text-xs text-t3 mb-4">
              Identity-level parameters single out a person or a click. Campaign-level parameters describe the mailing or
              ad. Unknown parameters are kept and no claim is made about them.
            </p>
            {analysis.params.length === 0 ? (
              <p className="text-sm text-ok">No query or fragment parameters at all.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-t3 border-b border-b1">
                      <th className="py-2 pr-3 font-medium">Parameter</th>
                      <th className="py-2 pr-3 font-medium">Class</th>
                      <th className="py-2 pr-3 font-medium">Vendor</th>
                      <th className="py-2 font-medium">What it reveals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.params.map((p, i) => {
                      const cs = CLASS_STYLES[p.cls];
                      return (
                        <tr key={`${p.where}-${p.key}-${i}`} className="border-b border-hair align-top">
                          <td className="py-2 pr-3">
                            <code className="font-mono text-white break-all">{p.key}</code>
                            {p.where === 'fragment' && (
                              <span className="ml-1 text-[10px] uppercase text-t3">fragment</span>
                            )}
                            <div className="text-xs text-t3 font-mono break-all">
                              {p.value ? truncate(p.value, 60) : '(empty)'}
                            </div>
                          </td>
                          <td className="py-2 pr-3">
                            <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${cs.pill}`}>{cs.label}</span>
                          </td>
                          <td className="py-2 pr-3 text-t2 whitespace-nowrap">{p.vendor ?? '—'}</td>
                          <td className="py-2 text-t2">
                            {p.reveals ?? 'Not a known tracking parameter. Kept as-is.'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Clean URL */}
          <div className="bg-s0 border border-ok/30 rounded-lg p-6">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-ok">Clean link</h3>
              <button
                type="button"
                onClick={() => copyClean(analysis.cleanUrl)}
                className="btn-primary text-xs px-3 py-2 min-h-0"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <code className="block bg-s0 p-4 rounded-md text-xs text-ok font-mono break-all">
              {analysis.cleanUrl}
            </code>
            <p className="mt-3 text-xs text-t2">
              What changed: removed {analysis.removedCount} tracking{' '}
              {analysis.removedCount === 1 ? 'parameter' : 'parameters'}, kept {analysis.keptCount}, peeled{' '}
              {analysis.redirectCount} redirect {analysis.redirectCount === 1 ? 'layer' : 'layers'}.
              {analysis.charsRemoved > 0 ? ` ${analysis.charsRemoved} characters shorter than what you pasted.` : ' Nothing to strip.'}
            </p>
            <a
              href={analysis.cleanUrl}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="inline-block mt-3 text-xs text-t2 underline hover:text-white"
            >
              Open the clean link in a new tab
            </a>
          </div>

          {/* What this means */}
          <div className="bg-s0 border border-info/30 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-info mb-3">What this means</h3>
            <p className="text-sm text-t2">
              A redirect wrapper lets the sender or the platform record that you, specifically, clicked, and when. Click
              IDs such as fbclid or gclid then let the destination hand that click back to the ad network, which matches
              it to your account and to whatever you do next on the site. Campaign tags are less personal but still tell
              the site which mailing list or ad brought you. Opening the clean link instead breaks that chain.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
