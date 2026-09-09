'use client';

import { maskIp } from '@/lib/privacy-mask';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SCAN_API_BASE } from '@/lib/scan-client';
import { useReportResult, type ToolResult } from '@/components/tools/ResultContext';
import {
  classifyDnsLeak,
  ispRangeOf,
  type DnsLeakBaseline,
  type DnsLeakClassification,
  type DnsLeakStorage,
  type ResolverSummary,
} from '@/lib/dns-leak';

/**
 * DNS Leak Test — our own resolver detection, no third parties.
 *
 * Flow:
 *   1. POST /dns-leak/start → { id, hostnames[] } (server records the public IP)
 *   2. Make the browser resolve every hostname. Two resolution paths, in
 *      parallel, each capped at 4 s:
 *        - fetch('https://<host>/p.gif', { mode: 'no-cors' }) — on the Vercel
 *          deploy the CSP connect-src blocks this before any lookup happens,
 *          so it fails instantly there; kept for deploys with a looser CSP.
 *        - new Image().src — img-src allows https:, so this is the path that
 *          actually triggers the DNS lookup on Vercel.
 *      The requests are EXPECTED to fail (nothing listens on 443 at the
 *      droplet). Only the DNS lookup matters: whichever resolver asks our
 *      authoritative nameserver is the resolver the visitor really uses.
 *   3. Wait 1.5 s, POST /dns-leak/result, poll up to 3 more times 1.5 s apart
 *      until the observation count stops growing.
 *   4. Classify (lib/dns-leak.ts) and report to the result bus.
 *
 * We cannot know whether a VPN is on, so the visitor tells us. A VPN-off run
 * is stored locally as a baseline (public IP + resolver IPs) so the VPN-on run
 * can recognise the ISP's resolver network. Nothing else is persisted; the
 * server side expires after 10 minutes.
 */

interface StartResponse {
  id: string;
  zone: string;
  hostnames: string[];
  ttlSeconds: number;
  storage: DnsLeakStorage;
}

interface ResultResponse {
  id: string;
  publicIp: string | null;
  resolvers: ResolverSummary[];
  observations: number;
  storage: DnsLeakStorage;
}

type Phase = 'idle' | 'starting' | 'probing' | 'collecting' | 'done' | 'error';

const BASELINE_KEY = 'dnsleak:baseline:v1';
const PROBE_TIMEOUT_MS = 4000;
const SETTLE_MS = 1500;
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const BASELINE_EVENT = 'dnsleak:baseline-change';

function parseBaseline(raw: string | null): DnsLeakBaseline | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DnsLeakBaseline>;
    if (!v || !Array.isArray(v.resolverIps)) return null;
    return {
      publicIp: typeof v.publicIp === 'string' ? v.publicIp : null,
      resolverIps: v.resolverIps.filter((x): x is string => typeof x === 'string'),
      savedAt: typeof v.savedAt === 'number' ? v.savedAt : undefined,
    };
  } catch {
    return null;
  }
}

/** localStorage as an external store: snapshot is the raw string (stable by value), null on the server. */
function getBaselineSnapshot(): string | null {
  try {
    return localStorage.getItem(BASELINE_KEY);
  } catch {
    return null;
  }
}
function getServerBaselineSnapshot(): string | null {
  return null;
}
function subscribeBaseline(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(BASELINE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(BASELINE_EVENT, onChange);
  };
}
function readBaseline(): DnsLeakBaseline | null {
  return parseBaseline(getBaselineSnapshot());
}
function writeBaseline(b: DnsLeakBaseline | null): void {
  try {
    if (b) localStorage.setItem(BASELINE_KEY, JSON.stringify(b));
    else localStorage.removeItem(BASELINE_KEY);
  } catch {
    /* storage unavailable — the baseline is a convenience only */
  }
  try {
    window.dispatchEvent(new Event(BASELINE_EVENT));
  } catch {
    /* ignore */
  }
}

function apiError(res: Response, what: string): Error {
  return new Error(
    res.status === 403
      ? `This page is not allowed to ${what} (origin not allowlisted).`
      : res.status === 429
        ? 'Too many tests from your network — wait a minute and try again.'
        : `Could not ${what} (${res.status}).`,
  );
}

async function startTest(): Promise<StartResponse> {
  const res = await fetch(`${SCAN_API_BASE}/dns-leak/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  if (!res.ok) throw apiError(res, 'start a DNS leak test');
  return (await res.json()) as StartResponse;
}

async function fetchResult(id: string): Promise<ResultResponse> {
  const res = await fetch(`${SCAN_API_BASE}/dns-leak/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    cache: 'no-store',
  });
  if (!res.ok) throw apiError(res, 'read the DNS leak result');
  return (await res.json()) as ResultResponse;
}

/** Make the browser resolve `host`. Resolves when both paths settle or time out; never rejects. */
function probeHostname(host: string): Promise<void> {
  const url = `https://${host}/p.gif`;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const viaFetch = fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal }).then(
    () => undefined,
    () => undefined,
  );
  const viaImage = new Promise<void>((resolve) => {
    const img = new Image();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      resolve();
    };
    const t = setTimeout(done, PROBE_TIMEOUT_MS);
    img.onload = () => { clearTimeout(t); done(); };
    img.onerror = () => { clearTimeout(t); done(); };
    img.src = `${url}?t=${Date.now()}`;
  });
  return Promise.all([viaFetch, viaImage]).then(() => clearTimeout(abortTimer));
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: '',
  starting: 'Creating a unique test on our server…',
  probing: 'Asking your browser to resolve 6 unique hostnames…',
  collecting: 'Waiting for our nameserver to report which resolver asked…',
  done: '',
  error: '',
};

function formatTime(ts: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return '—';
  }
}

function verdictTitle(c: DnsLeakClassification): string {
  switch (c.verdict) {
    case 'leak':
      return 'DNS leak detected';
    case 'no-leak':
      return 'No DNS leak detected';
    case 'baseline':
      return 'Baseline recorded';
    default:
      return 'Inconclusive';
  }
}

function severityClasses(s: DnsLeakClassification['severity']): { border: string; text: string } {
  switch (s) {
    case 'red':
      return { border: 'border-red-500/30', text: 'text-red-400' };
    case 'green':
      return { border: 'border-green-500/20', text: 'text-green-400' };
    case 'amber':
      return { border: 'border-yellow-500/30', text: 'text-yellow-400' };
    default:
      return { border: 'border-blue-500/20', text: 'text-blue-400' };
  }
}

export function DnsLeakTestTool() {
  const report = useReportResult();
  const [vpnOn, setVpnOn] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [classification, setClassification] = useState<DnsLeakClassification | null>(null);
  const [testedWithVpnOn, setTestedWithVpnOn] = useState(true);
  // The VPN-off baseline lives in localStorage. useSyncExternalStore keeps it in
  // sync (no setState-in-effect) and renders null during SSR, so no hydration mismatch.
  const baselineRaw = useSyncExternalStore(subscribeBaseline, getBaselineSnapshot, getServerBaselineSnapshot);
  const baseline = useMemo(() => parseBaseline(baselineRaw), [baselineRaw]);

  const running = phase === 'starting' || phase === 'probing' || phase === 'collecting';

  const runTest = useCallback(async () => {
    setPhase('starting');
    setError('');
    setResult(null);
    setClassification(null);
    const vpn = vpnOn;
    setTestedWithVpnOn(vpn);
    try {
      const start = await startTest();

      setPhase('probing');
      await Promise.allSettled(start.hostnames.map((h) => probeHostname(h)));

      setPhase('collecting');
      await sleep(SETTLE_MS);
      let latest = await fetchResult(start.id);
      if (latest.storage === 'redis') {
        for (let i = 0; i < MAX_POLLS; i++) {
          await sleep(POLL_INTERVAL_MS);
          const next = await fetchResult(start.id);
          const grew = next.observations > latest.observations;
          latest = next;
          // Keep polling while the count is still growing, or while nothing has
          // arrived yet (slow resolvers). Stop as soon as a non-zero count stalls.
          if (!grew && next.observations > 0) break;
        }
      }

      const currentBaseline = vpn ? readBaseline() : null;
      const c = classifyDnsLeak({
        publicIp: latest.publicIp,
        resolvers: latest.resolvers,
        vpnOn: vpn,
        storage: latest.storage,
        baseline: currentBaseline,
      });

      if (!vpn && latest.resolvers.length > 0) {
        const b: DnsLeakBaseline = {
          publicIp: latest.publicIp,
          resolverIps: latest.resolvers.map((r) => r.ip),
          savedAt: Date.now(),
        };
        writeBaseline(b);
      }

      setResult(latest);
      setClassification(c);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The DNS leak test failed.');
      setPhase('error');
    }
  }, [vpnOn]);

  // Result bus: severity red = leaking, amber = inconclusive, green = no leak, info = baseline.
  useEffect(() => {
    if (!classification || !result) {
      report(null);
      return;
    }
    // stats[0] is the scorecard's big figure: a one-word verdict, never the raw
    // address (IPv6 overflows the card; a real IP has no place in a share image).
    const verdict = classification.severity === 'red' ? 'Leaking' : classification.severity === 'green' ? 'No leak' : classification.severity === 'amber' ? 'Inconclusive' : 'Baseline';
    const stats: ToolResult['stats'] = [
      { label: 'Verdict', value: verdict },
      { label: 'Public IP', value: maskIp(result.publicIp) },
      { label: 'Resolvers seen', value: String(result.resolvers.length) },
      { label: 'Resolver networks', value: classification.networks.length ? classification.networks.join(', ') : '—' },
      { label: 'VPN', value: testedWithVpnOn ? 'on' : 'off' },
    ];
    report({
      severity: classification.severity,
      headline: classification.headline,
      detail: classification.detail,
      stats,
      shareText: `${verdictTitle(classification)}: ${classification.headline}`,
    });
  }, [classification, result, testedWithVpnOn, report]);

  const clearBaseline = () => {
    writeBaseline(null);
  };

  const sev = classification ? severityClasses(classification.severity) : null;
  const baselineRange = baseline?.publicIp ? ispRangeOf(baseline.publicIp) : null;

  return (
    <div className="space-y-6">
      <div className="text-sm text-[#B8B8D4]">
        Your browser is asked to resolve six hostnames that exist only for this test, under a domain we run the
        nameserver for. Whichever DNS resolver asks our nameserver for them is the resolver you are really using —
        no third-party leak-test service is involved, and the record expires after ten minutes.
      </div>

      {/* Controls */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-[#B8B8D4]/60 mb-2">Is your VPN on right now?</div>
          <p className="text-xs text-[#B8B8D4] mb-3">
            We cannot detect this ourselves. For the clearest answer, run once with the VPN <strong className="text-white">off</strong> to record your ISP&apos;s resolver, then again with it <strong className="text-white">on</strong>.
          </p>
          <div className="inline-flex rounded border border-white/10 overflow-hidden" role="group" aria-label="VPN state">
            <button
              type="button"
              aria-pressed={!vpnOn}
              onClick={() => setVpnOn(false)}
              disabled={running}
              className={`px-4 py-2 text-sm transition-colors disabled:opacity-50 ${
                !vpnOn ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
              }`}
            >
              VPN is OFF
            </button>
            <button
              type="button"
              aria-pressed={vpnOn}
              onClick={() => setVpnOn(true)}
              disabled={running}
              className={`px-4 py-2 text-sm border-l border-white/10 transition-colors disabled:opacity-50 ${
                vpnOn ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
              }`}
            >
              VPN is ON
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={runTest}
            disabled={running}
            className="px-5 py-2.5 bg-white text-black text-sm font-semibold rounded hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {running ? 'Testing…' : 'Run DNS leak test'}
          </button>
          {running && <span className="text-sm text-[#B8B8D4]">{PHASE_LABEL[phase]}</span>}
        </div>

        {baseline && (
          <div className="text-xs text-[#B8B8D4] border-t border-white/10 pt-3 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <span className="text-white">VPN-off baseline saved</span>
              {baseline.savedAt ? ` at ${formatTime(baseline.savedAt)}` : ''}:{' '}
              ISP network {baselineRange ?? 'unknown'}, {baseline.resolverIps.length} resolver
              {baseline.resolverIps.length === 1 ? '' : 's'} recorded. Stored only in this browser.
            </div>
            <button type="button" onClick={clearBaseline} className="underline hover:text-white">
              Clear baseline
            </button>
          </div>
        )}
      </div>

      {phase === 'error' && error && (
        <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-sm text-red-400">{error}</div>
      )}

      {phase === 'done' && classification && result && sev && (
        <>
          {/* Verdict */}
          <div className={`bg-[#0a0a0a] border ${sev.border} rounded-lg p-6`}>
            <div className="text-xs uppercase tracking-wider text-[#B8B8D4]/60 mb-2">Verdict</div>
            <h3 className={`text-lg font-semibold ${sev.text} mb-2`}>{verdictTitle(classification)}</h3>
            <p className="text-sm text-white">{classification.headline}</p>
            <p className="mt-2 text-sm text-[#B8B8D4]">{classification.detail}</p>
            {classification.reason === 'no-backend' && (
              <p className="mt-3 text-xs text-yellow-400/80">
                Inconclusive because the test backend is not configured on this deployment — no resolver could be recorded, so no verdict is possible.
              </p>
            )}
            {classification.reason === 'no-observations' && (
              <p className="mt-3 text-xs text-yellow-400/80">
                Inconclusive because no DNS query reached our nameserver — the test zone may not be delegated yet, or a resolver cached a wildcard; try again in a minute.
              </p>
            )}
          </div>

          {/* Public IP */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <div className="text-xs uppercase tracking-wider text-[#B8B8D4]/60 mb-2">Your public IP</div>
            {result.publicIp ? (
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <code className="text-2xl text-white font-mono break-all select-all">{result.publicIp}</code>
                <span className="text-xs text-[#B8B8D4]">
                  network {ispRangeOf(result.publicIp) ?? '—'} · VPN {testedWithVpnOn ? 'on' : 'off'}
                </span>
              </div>
            ) : (
              <p className="text-sm text-[#B8B8D4]">
                Not available — {result.storage === 'none' ? 'the test backend is not configured on this deployment' : 'the test record expired or no public IP was visible to the server'}.
              </p>
            )}
          </div>

          {/* Resolvers */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">
              Resolvers that asked our nameserver ({result.resolvers.length})
            </h3>
            {result.resolvers.length === 0 ? (
              <p className="text-sm text-[#B8B8D4]">None recorded for this test.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-[#B8B8D4]/60">
                      <th className="py-2 pr-4 font-normal">Resolver IP</th>
                      <th className="py-2 pr-4 font-normal">Network</th>
                      <th className="py-2 pr-4 font-normal">Queries</th>
                      <th className="py-2 font-normal">First seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.resolvers.map((r) => (
                      <tr key={r.ip} className="border-t border-white/10">
                        <td className="py-2 pr-4"><code className="font-mono text-white break-all">{r.ip}</code></td>
                        <td className="py-2 pr-4 font-mono text-xs text-[#B8B8D4]">{r.network}</td>
                        <td className="py-2 pr-4 text-[#B8B8D4]">{r.count}</td>
                        <td className="py-2 text-[#B8B8D4]">{formatTime(r.firstSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-[#B8B8D4]/60">
              Networks are shown as address ranges, not provider names — we do not run geo or ASN lookups on anyone.
              {result.observations > 0 && ` ${result.observations} quer${result.observations === 1 ? 'y' : 'ies'} reached our nameserver in total.`}
            </p>
          </div>

          {/* What to do */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-2">
              {classification.verdict === 'leak' ? 'How to stop the leak' : 'What a DNS leak would mean'}
            </h3>
            <ul className="space-y-2 text-sm text-[#B8B8D4]">
              <li>• <strong className="text-white">Every site name you visit</strong> goes to the resolver first. If that resolver belongs to your ISP, your browsing destinations are visible to it even when your traffic is inside a VPN tunnel.</li>
              <li>• <strong className="text-white">The fix is a VPN that owns the DNS path.</strong> The VPN in Incognito Pro answers every lookup from its own resolver inside the tunnel, so nothing reaches your ISP&apos;s resolver.</li>
              <li>• <strong className="text-white">Check the operating system too.</strong> Browser-only VPN extensions leave system DNS untouched, and some VPN clients lose their DNS override after updates.</li>
              <li>• <strong className="text-white">IPv6 counts.</strong> A tunnel that only carries IPv4 lets IPv6 lookups leave through your ISP.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
