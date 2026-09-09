'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeEmail, EXAMPLE_EMAIL, type EmailAnalysis, type TrackedLink, type TrackingPixel } from '@/lib/email-pixel';
import { useReportResult, type ToolResult } from '@/components/tools/ResultContext';
import { Icon } from '@/components/ui/Icon';

const MAX_BYTES = 2 * 1024 * 1024;

function toToolResult(a: EmailAnalysis): ToolResult {
  const detail =
    a.severity === 'red'
      ? 'Opening this email tells the sender when, where and on what device you read it.'
      : a.severity === 'amber'
        ? 'No dedicated pixel, but the sender can still infer opens or log your clicks.'
        : 'Nothing in this email reports back to the sender when you open it.';
  return {
    severity: a.severity,
    headline: a.headline,
    detail,
    stats: a.stats,
    shareText: `${a.headline} — checked with a client-side email tracking-pixel detector.`,
  };
}

function severityClasses(severity: EmailAnalysis['severity']) {
  switch (severity) {
    case 'red':
      return { border: 'border-danger/30', text: 'text-danger', bg: 'bg-danger-dim', label: 'Tracked' };
    case 'amber':
      return { border: 'border-warn/30', text: 'text-warn', bg: 'bg-warn-dim', label: 'Partially tracked' };
    default:
      return { border: 'border-ok/30', text: 'text-ok', bg: 'bg-ok-dim', label: 'Clean' };
  }
}

function shorten(s: string, n = 110): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function PixelRow({ pixel }: { pixel: TrackingPixel }) {
  return (
    <div className="p-3 rounded-md bg-s0 border border-hair">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <span className={`text-sm font-medium ${pixel.vendor ? 'text-danger' : 'text-warn'}`}>
          {pixel.vendor ? `${pixel.vendor} open-tracking pixel` : 'Suspected pixel (unknown vendor)'}
        </span>
        <code className="text-xs text-t2 font-mono break-all">{pixel.host}</code>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {pixel.reasons.map((r, i) => (
          <span key={i} className="text-xs px-2 py-0.5 rounded bg-white/5 text-t2">{r}</span>
        ))}
      </div>
      <code className="block text-xs text-t3 font-mono break-all" title={pixel.src}>{shorten(pixel.src, 160)}</code>
    </div>
  );
}

function LinkRow({ link }: { link: TrackedLink }) {
  return (
    <div className="p-3 rounded-md bg-s0 border border-hair">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <span className="text-sm text-white">{link.text || '(no visible text)'}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${link.vendor ? 'bg-warn/20 text-warn' : 'bg-white/10 text-t2'}`}>
          {link.vendor ?? 'redirect wrapper'}
        </span>
      </div>
      <div className="text-xs font-mono break-all text-t2">
        <span className="text-t3">via </span>{link.host}
        <span className="text-t3"> → </span>
        {link.destination ? (
          <span className="text-ok" title={link.destination}>{link.destinationHost}</span>
        ) : (
          <span className="text-danger">destination hidden behind an opaque token</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {link.reasons.map((r, i) => (
          <span key={i} className="text-xs text-t3">{r}{i < link.reasons.length - 1 ? ' ·' : ''}</span>
        ))}
      </div>
    </div>
  );
}

export function EmailPixelDetectorTool() {
  const [raw, setRaw] = useState('');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<EmailAnalysis | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const report = useReportResult();

  // Push the current verdict to the page-level result bus whenever it changes; clear it on unmount.
  // (`report` is a stable callback inside the provider and a no-op outside it.)
  useEffect(() => {
    report(analysis ? toToolResult(analysis) : null);
    return () => report(null);
  }, [analysis, report]);

  const run = useCallback((source: string) => {
    setError('');
    if (!source.trim()) {
      setAnalysis(null);
      setError('Paste an email source or HTML body first.');
      return;
    }
    try {
      setAnalysis(analyzeEmail(source));
    } catch {
      setAnalysis(null);
      setError('Could not parse that input. Try pasting the raw source from "Show original" / "View source".');
    }
  }, []);

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      setError('');
      if (file.size > MAX_BYTES) {
        setError(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 2 MB. Large attachments do not affect the result; strip them and try again.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        setFileName(file.name);
        setRaw(text);
        run(text);
      };
      reader.onerror = () => setError('The file could not be read.');
      reader.readAsText(file);
    },
    [run],
  );

  const loadExample = () => {
    setFileName('');
    setRaw(EXAMPLE_EMAIL);
    run(EXAMPLE_EMAIL);
  };

  const clear = () => {
    setRaw('');
    setFileName('');
    setAnalysis(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sev = analysis ? severityClasses(analysis.severity) : null;

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        <label htmlFor="email-pixel-source" className="block text-sm font-medium text-t2 mb-2">
          Paste the raw email source or just the HTML body
        </label>
        <textarea
          id="email-pixel-source"
          value={raw}
          onChange={(e) => {
            // Same cap as the .eml path: the parser's regexes are quadratic on pathological input.
            setRaw(e.target.value.slice(0, 2 * 1024 * 1024));
            setFileName('');
          }}
          placeholder={'Delivered-To: you@example.com\nReceived: from ...\nContent-Type: multipart/alternative; boundary="..."\n\n...or paste only the <html> body.'}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          rows={10}
          className="w-full px-4 py-3 bg-s0 border border-b1 rounded-md text-white placeholder-white/20 font-mono text-xs leading-relaxed resize-y"
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={`mt-3 flex flex-wrap items-center justify-between gap-3 p-4 rounded-md border border-dashed transition-colors ${
            dragging ? 'border-b2 bg-white/5' : 'border-b1'
          }`}
        >
          <div className="text-xs text-t2">
            <span className="text-white font-medium">Or drop a .eml file here</span>
            <span className="text-t3"> — up to 2 MB.</span>
            {fileName && <span className="ml-2 font-mono text-ok">Loaded: {fileName}</span>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".eml,.txt,.html,.htm,.mht,message/rfc822,text/plain,text/html"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="sr-only"
            aria-label="Choose an .eml file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs px-3 py-2 border border-b1 rounded text-t2 hover:text-white hover:border-b2"
          >
            Choose .eml file
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => run(raw)} className="btn-primary px-6">Analyze email</button>
          <button
            type="button"
            onClick={loadExample}
            className="text-sm px-4 py-2 border border-b1 rounded text-t2 hover:text-white hover:border-b2"
          >
            Load example
          </button>
          {(raw || analysis) && (
            <button type="button" onClick={clear} className="text-sm px-4 py-2 text-t3 hover:text-white">
              Clear
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        <p className="mt-3 text-xs text-t3">
          Get the source with &ldquo;Show original&rdquo; (Gmail), &ldquo;View message source&rdquo; (Outlook) or &ldquo;Raw Source&rdquo; (Apple Mail).
          Everything is parsed in this browser tab — the email is never uploaded, and no image or link in it is ever requested.
        </p>
      </div>

      {analysis && sev && (
        <div className="space-y-4">
          {/* Verdict */}
          <div className={`bg-s0 border ${sev.border} rounded-lg p-6`}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className={`text-xs uppercase tracking-wide mb-1 ${sev.text}`}>Verdict · {sev.label}</div>
                <h3 className="text-lg font-bold text-white">{analysis.headline}</h3>
              </div>
              <Icon name={analysis.severity === 'red' ? 'x' : analysis.severity === 'amber' ? 'warn' : 'check'} size={28} className={sev.text} title={sev.label} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {analysis.stats.map((s) => (
                <div key={s.label} className="p-3 rounded-md bg-s0">
                  <div className="text-xs text-t3">{s.label}</div>
                  <div className="text-sm font-bold text-white break-words">{s.value}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-t3">
              {analysis.hasHeaders
                ? `Parsed a full message${analysis.htmlParts ? ` with ${analysis.htmlParts} HTML part${analysis.htmlParts === 1 ? '' : 's'}` : ' with no HTML part'}${
                    analysis.encodings.length ? ` (${analysis.encodings.join(', ')})` : ''
                  }.`
                : analysis.hasHtml
                  ? 'No headers found — analyzed as a bare HTML body.'
                  : 'No headers or HTML found — analyzed as plain text.'}
            </p>
          </div>

          {/* Tracking pixels */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">
              Tracking pixels found <span className={`ml-1 ${analysis.pixels.length ? 'text-danger' : 'text-ok'}`}>({analysis.pixels.length})</span>
            </h3>
            {analysis.pixels.length ? (
              <div className="space-y-2">
                {analysis.pixels.map((p) => (
                  <PixelRow key={p.src} pixel={p} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-t2">No image in this email is sized, hidden or hosted like an open-tracking beacon.</p>
            )}
            {analysis.nonPixelRemoteImages > 0 && (
              <p className="mt-3 text-xs text-warn/80">
                {analysis.nonPixelRemoteImages} other remote image{analysis.nonPixelRemoteImages === 1 ? '' : 's'} load from the sender&rsquo;s servers when displayed — each request can be logged as an open, even without a dedicated pixel.
              </p>
            )}
          </div>

          {/* Wrapped links */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-1">
              Wrapped links <span className={`ml-1 ${analysis.trackedLinks.length ? 'text-warn' : 'text-ok'}`}>({analysis.trackedLinks.length} of {analysis.totalLinks})</span>
            </h3>
            {analysis.trackedLinks.length ? (
              <>
                <p className="text-xs text-t3 mb-3">
                  Rerouted through:{' '}
                  {Array.from(new Set(analysis.trackedLinks.map((l) => l.vendor ?? 'unknown redirect service'))).join(', ')}
                </p>
                <div className="space-y-2">
                  {analysis.trackedLinks.map((l) => (
                    <LinkRow key={l.href} link={l} />
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-t2 mt-2">
                {analysis.totalLinks ? 'Every link points straight at its destination — no click-tracking redirects.' : 'No links in this email.'}
              </p>
            )}
          </div>

          {/* ESP */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Sender platform identified</h3>
            {analysis.esp.name ? (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-lg font-bold text-white">{analysis.esp.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-t2">
                    {analysis.esp.category === 'sales-tracker' ? 'sales tracking add-on' : analysis.esp.category === 'analytics' ? 'email analytics' : 'email marketing platform'}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      analysis.esp.confidence === 'high' ? 'bg-ok/20 text-ok' : analysis.esp.confidence === 'medium' ? 'bg-warn/20 text-warn' : 'bg-white/10 text-t2'
                    }`}
                  >
                    {analysis.esp.confidence} confidence
                  </span>
                </div>
                <div className="space-y-1">
                  {analysis.esp.evidence.map((e, i) => (
                    <code key={i} className="block text-xs text-t3 font-mono break-all">{e}</code>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-t2">
                No marketing platform signature found.
                {analysis.esp.evidence.length ? ` Sending software: ${analysis.esp.evidence[0]}` : ''}
                {!analysis.hasHeaders ? ' Paste the full source including headers for a firmer answer.' : ''}
              </p>
            )}
            {analysis.headerHints.length > 0 && (
              <details className="mt-4">
                <summary className="text-xs text-t3 cursor-pointer hover:text-white">
                  {analysis.headerHints.length} header hint{analysis.headerHints.length === 1 ? '' : 's'}
                </summary>
                <div className="mt-2 space-y-2">
                  {analysis.headerHints.map((h, i) => (
                    <div key={i} className="text-xs">
                      <span className="font-mono text-white">{h.header}</span>
                      <span className="text-t3"> — {h.note}</span>
                      {h.vendor && <span className="ml-1 text-warn">({h.vendor})</span>}
                      <code className="block font-mono text-t3 break-all">{h.value}</code>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* What this means */}
          <div className={`bg-s0 border border-b1 rounded-lg p-6`}>
            <h3 className="text-sm font-semibold text-white mb-3">What this means</h3>
            <ul className="space-y-2">
              {analysis.meaning.map((m, i) => (
                <li key={i} className={`flex items-start gap-2 p-3 rounded-md ${sev.bg}`}>
                  <Icon name={analysis.severity === 'green' ? 'check' : 'info'} size={14} className={`mt-0.5 ${sev.text}`} />
                  <span className="text-sm text-t2">{m}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Privacy note */}
          <div className="bg-s0 border border-b1 rounded-lg p-4">
            <p className="text-xs text-t3">
              <span className="text-white">Privacy note:</span> this analysis ran entirely in your browser. The email source was not uploaded, stored, or sent anywhere,
              and none of the pixels or links above were requested — so the sender has not been notified by this check.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
