'use client';

/**
 * Ad-Blocker Test — "which of 50 ad and tracker requests got through?"
 *
 * Fires 50 first-party bait requests (scripts + 1×1 GIFs served from THIS
 * site under /adtest/, at URL paths that generic EasyList / EasyPrivacy rules
 * block) and 12 cosmetic baits (class names generic element-hiding rules
 * target). Nothing is ever requested from an ad network; nothing leaves the
 * browser. The catalogue and scoring live in lib/adblock-bait.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReportResult, type ToolResult } from '@/components/tools/ResultContext';
import { Icon } from '@/components/ui/Icon';
import { ConsoleFrame, statusFromSeverity } from './ConsoleFrame';
import {
  NETWORK_BAITS,
  COSMETIC_BAITS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  CATEGORY_BLURBS,
  PROBE_TIMEOUT_MS,
  COSMETIC_SETTLE_MS,
  basePathFrom,
  baitUrl,
  scoreAdBlocking,
  headlineFor,
  verdictFor,
  summarizeByCategory,
  type NetworkBait,
  type CosmeticBait,
} from '@/lib/adblock-bait';

type Outcome = 'blocked' | 'allowed';
/** Why we decided: error/timeout = request never completed; neutralised = a 2xx came back but our marker never ran (stubbed by the blocker). */
type Reason = 'error' | 'timeout' | 'neutralised' | 'executed' | 'loaded';

interface ProbeResult {
  bait: NetworkBait;
  outcome: Outcome;
  reason: Reason;
  ms: number;
}

interface CosmeticResult {
  bait: CosmeticBait;
  hidden: boolean;
}

// ------- Probes (module-level; no React state) -------

type Markers = Record<string, number | undefined>;

function markers(): Markers {
  const w = window as unknown as { __adtest?: Markers };
  if (!w.__adtest) w.__adtest = {};
  return w.__adtest;
}

function resetMarkers() {
  (window as unknown as { __adtest?: Markers }).__adtest = {};
}

function executed(id: string): boolean {
  return markers()[id] === 1;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Script bait: allowed only if our marker ran; a network error, a timeout, or a load without the marker all count as blocked. */
function probeScript(bait: NetworkBait, url: string, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = now();
    const el = document.createElement('script');
    el.async = true;
    el.setAttribute('data-adtest', bait.id);
    let settled = false;
    const finish = (outcome: Outcome, reason: Reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.onload = null;
      el.onerror = null;
      el.remove();
      resolve({ bait, outcome, reason, ms: Math.round(now() - started) });
    };
    const timer = setTimeout(() => {
      finish(executed(bait.id) ? 'allowed' : 'blocked', executed(bait.id) ? 'executed' : 'timeout');
    }, timeoutMs);
    el.onload = () => {
      const ran = executed(bait.id);
      finish(ran ? 'allowed' : 'blocked', ran ? 'executed' : 'neutralised');
    };
    el.onerror = () => finish('blocked', 'error');
    el.src = url;
    document.head.appendChild(el);
  });
}

/** Image bait: onload = allowed; onerror or timeout = blocked. */
function probeImage(bait: NetworkBait, url: string, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = now();
    const img = new Image();
    let settled = false;
    const finish = (outcome: Outcome, reason: Reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve({ bait, outcome, reason, ms: Math.round(now() - started) });
    };
    const timer = setTimeout(() => finish('blocked', 'timeout'), timeoutMs);
    img.onload = () => finish('allowed', 'loaded');
    img.onerror = () => finish('blocked', 'error');
    img.src = url;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cosmetic baits: append off-screen 1×1 divs carrying the class names and see
 * whether a blocker's element-hiding CSS collapses them. Sampled after the
 * settle delay and once more a little later, because blockers pick up
 * dynamically-inserted nodes via a mutation observer.
 */
async function probeCosmetic(baits: readonly CosmeticBait[], settleMs: number): Promise<CosmeticResult[]> {
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.setAttribute('data-adtest', 'cosmetic');
  wrap.style.cssText = 'position:absolute;left:-9999px;top:0;width:2px;pointer-events:none;';
  const els = baits.map((b) => {
    const el = document.createElement('div');
    el.className = b.className;
    el.style.cssText = 'display:block;width:1px;height:1px;';
    el.textContent = ' ';
    wrap.appendChild(el);
    return el;
  });
  document.body.appendChild(wrap);
  const hidden = baits.map(() => false);
  const sample = () => {
    els.forEach((el, i) => {
      if (hidden[i]) return;
      if (el.offsetHeight === 0 || getComputedStyle(el).display === 'none') hidden[i] = true;
    });
  };
  try {
    await sleep(settleMs);
    sample();
    await sleep(Math.round(settleMs * 1.5));
    sample();
  } finally {
    wrap.remove();
  }
  return baits.map((bait, i) => ({ bait, hidden: hidden[i] }));
}

// ------- Presentation helpers -------

function reasonText(r: ProbeResult): string {
  switch (r.reason) {
    case 'error': return 'Request cancelled before it completed';
    case 'timeout': return `No response within ${PROBE_TIMEOUT_MS / 1000} s`;
    case 'neutralised': return 'A response arrived but the script never ran — replaced by a blocker stub';
    case 'executed': return 'Script downloaded and executed';
    default: return 'Image downloaded';
  }
}

export function AdBlockerTestTool() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [cosmetic, setCosmetic] = useState<CosmeticResult[]>([]);
  const [servedFrom, setServedFrom] = useState('');
  const report = useReportResult();
  const runIdRef = useRef(0);

  // A run that finishes after unmount must not touch state.
  useEffect(() => () => { runIdRef.current = -1; }, []);

  const run = useCallback(async () => {
    const runId = Date.now();
    runIdRef.current = runId;
    const base = basePathFrom(window.location.pathname);
    setPhase('running');
    setProgress(0);
    setResults([]);
    setCosmetic([]);
    setServedFrom(`${window.location.origin}${base}/adtest/`);
    resetMarkers();

    let completed = 0;
    const cosmeticPromise = probeCosmetic(COSMETIC_BAITS, COSMETIC_SETTLE_MS);
    const probes = NETWORK_BAITS.map((bait) => {
      const url = baitUrl(base, bait, runId);
      const p = bait.kind === 'script' ? probeScript(bait, url, PROBE_TIMEOUT_MS) : probeImage(bait, url, PROBE_TIMEOUT_MS);
      return p.then((r) => {
        completed += 1;
        if (runIdRef.current === runId) setProgress(completed);
        return r;
      });
    });

    const [network, cosmeticResults] = await Promise.all([Promise.all(probes), cosmeticPromise]);
    if (runIdRef.current !== runId) return; // superseded by a newer run or unmounted

    setResults(network);
    setCosmetic(cosmeticResults);
    setPhase('done');

    const blockedIds = network.filter((r) => r.outcome === 'blocked').map((r) => r.bait.id);
    const score = scoreAdBlocking(blockedIds.length, network.length);
    const hidden = cosmeticResults.filter((c) => c.hidden).length;
    const byCategory = summarizeByCategory(blockedIds, NETWORK_BAITS);
    const cleanCategories = byCategory.filter((c) => c.total > 0 && c.blocked === c.total).length;
    const result: ToolResult = {
      severity: score.severity,
      headline: headlineFor(score),
      detail: verdictFor(score, hidden, cosmeticResults.length),
      score: score.percent,
      stats: [
        { label: 'Blocked', value: `${score.blocked}/${score.total}` },
        { label: 'Allowed', value: `${score.allowed}` },
        { label: 'Elements hidden', value: `${hidden}/${cosmeticResults.length}` },
        { label: 'Categories', value: `${cleanCategories}/${byCategory.length} clean` },
      ],
      shareText: `${headlineFor(score)} — ${score.percent}% blocked on the first-party Ad-Blocker Test.`,
    };
    report(result);
  }, [report]);

  const total = NETWORK_BAITS.length;
  const blockedResults = results.filter((r) => r.outcome === 'blocked');
  const score = scoreAdBlocking(blockedResults.length, results.length);
  const hidden = cosmetic.filter((c) => c.hidden).length;
  const byCategory = summarizeByCategory(blockedResults.map((r) => r.bait.id), NETWORK_BAITS);
  const cleanCategories = byCategory.filter((c) => c.total > 0 && c.blocked === c.total).length;
  const running = phase === 'running';

  return (
    <div className="space-y-6">
      <div className="bg-s0 border border-b1 rounded-lg p-6 text-center">
        <p className="text-t2 mb-4">
          Fires {total} tiny bait requests at this site — scripts and 1×1 images at URL paths that generic
          filter lists (EasyList, EasyPrivacy) block — and counts how many your ad blocker stops.
          Nothing is loaded from any ad network.
        </p>
        <button
          onClick={run}
          disabled={running}
          className="btn-primary px-8 py-3"
        >
          {running ? `Testing… ${progress}/${total}` : phase === 'done' ? 'Run Again' : 'Run Ad-Blocker Test'}
        </button>
        <p className="mt-3 text-xs text-t3">
          Every request goes to this site only. Nothing about you or your result is sent or stored anywhere.
        </p>
      </div>

      {running && (
        <div className="bg-s0 border border-b1 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-t2">
            <span>Probing first-party bait requests…</span>
            <span className="font-mono">{progress}/{total}</span>
          </div>
          <div className="h-2 bg-s0 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-white/40 transition-all duration-200" style={{ width: `${(progress / total) * 100}%` }} />
          </div>
        </div>
      )}

      {phase === 'done' && (
        <ConsoleFrame
          engine="ad-blocker-test"
          status={statusFromSeverity(score.severity)}
          checks={score.total}
          processing="client"
          score={score.percent}
          gaugeLabel="blocked"
          statTiles={[
            { label: 'Blocked', value: `${score.blocked}/${score.total}` },
            { label: 'Allowed', value: score.allowed },
            { label: 'Elements hidden', value: `${hidden}/${cosmetic.length}` },
            { label: 'Categories', value: `${cleanCategories}/${byCategory.length} clean` },
          ]}
        >
        <>
          <h2 className="text-lg font-semibold text-white">
            Blocked {score.blocked} of {score.total} requests
          </h2>
          <p className="text-sm text-t2">
            Cosmetic filtering hid {hidden} of {cosmetic.length} ad elements
          </p>
          <p className="text-sm text-t2">{verdictFor(score, hidden, cosmetic.length)}</p>

          {/* Per-bait results by category */}
          {CATEGORY_ORDER.map((category) => {
            const rows = results.filter((r) => r.bait.category === category);
            const summary = byCategory.find((c) => c.category === category);
            if (rows.length === 0 || !summary) return null;
            const allBlocked = summary.blocked === summary.total;
            return (
              <div key={category}>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <h3 className="text-sm font-semibold text-t2 uppercase tracking-wider">{CATEGORY_LABELS[category]}</h3>
                  <span className={`text-xs font-mono ${allBlocked ? 'text-ok' : summary.blocked === 0 ? 'text-danger' : 'text-warn'}`}>
                    {summary.blocked} of {summary.total} blocked
                  </span>
                </div>
                <p className="text-xs text-t3 mb-3">{CATEGORY_BLURBS[category]}</p>
                <div className="bg-s0 border border-b1 rounded-lg overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-t3 border-b border-b1">
                        <th className="px-3 py-2 font-medium w-8"></th>
                        <th className="px-3 py-2 font-medium">Request</th>
                        <th className="px-3 py-2 font-medium">Path on this site</th>
                        <th className="px-3 py-2 font-medium">Filter rule it mirrors</th>
                        <th className="px-3 py-2 font-medium text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const blocked = r.outcome === 'blocked';
                        return (
                          <tr key={r.bait.id} className="border-b border-hair last:border-b-0 align-top">
                            <td className={`px-3 py-2 ${blocked ? 'text-ok' : 'text-danger'}`}><Icon name={blocked ? 'check' : 'x'} size={14} title={blocked ? 'blocked' : 'loaded'} /></td>
                            <td className="px-3 py-2">
                              <div className="text-white">{r.bait.label}</div>
                              <div className="text-t3">{r.bait.kind === 'script' ? 'script' : 'image'} · {reasonText(r)}</div>
                            </td>
                            <td className="px-3 py-2 font-mono text-t2 whitespace-nowrap">{r.bait.path}</td>
                            <td className="px-3 py-2 font-mono text-t3 whitespace-nowrap">{r.bait.rule}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <span
                                className={`font-mono px-2 py-0.5 rounded ${blocked ? 'text-ok bg-ok-dim' : 'text-danger bg-danger-dim'}`}
                                title={reasonText(r)}
                              >
                                {blocked ? (r.reason === 'neutralised' ? 'NEUTRALISED' : 'BLOCKED') : 'ALLOWED'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Cosmetic filtering */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h3 className="text-sm font-semibold text-t2 uppercase tracking-wider">Cosmetic filtering</h3>
              <span className={`text-xs font-mono ${hidden === cosmetic.length ? 'text-ok' : hidden === 0 ? 'text-danger' : 'text-warn'}`}>
                {hidden} of {cosmetic.length} hidden
              </span>
            </div>
            <p className="text-xs text-t3 mb-3">
              Page elements carrying class names that generic element-hiding rules target. A blocker with cosmetic filtering collapses them even when nothing is downloaded.
            </p>
            <div className="bg-s0 border border-b1 rounded-lg p-4 flex flex-wrap gap-2">
              {cosmetic.map((c) => (
                <span
                  key={c.bait.className}
                  title={`${c.bait.label} — ${c.bait.rule}`}
                  className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border ${c.hidden ? 'text-ok border-ok/30 bg-ok-dim' : 'text-danger border-danger/30 bg-danger-dim'}`}
                >
                  <Icon name={c.hidden ? 'check' : 'x'} size={12} /> .{c.bait.className}
                </span>
              ))}
            </div>
          </div>

          {/* Honesty + privacy notes */}
          <div className="bg-s0 border border-info/30 rounded-lg p-4 space-y-2">
            <p className="text-sm text-info font-medium">What this test did — and did not — load</p>
            <p className="text-xs text-t2">
              All {score.total} requests went to this site only, under <span className="font-mono text-white">{servedFrom}</span>.
              Nothing was loaded from any ad network or tracking company. Each bait is a first-party file whose URL path
              mirrors a generic EasyList / EasyPrivacy rule — the kind that matches on any domain — so a blocker with those
              lists cancels it before it leaves your browser. Scripts that arrived but never ran count as blocked (the
              blocker substituted a harmless stub).
            </p>
            <p className="text-xs text-t2">
              Blockers that work by domain alone — DNS filters like Pi-hole or NextDNS, and most VPN &ldquo;ad blocking&rdquo;
              features — cannot see URL patterns and will score low here even though they stop real ad domains. A browser
              extension such as uBlock Origin, or a browser with built-in shields, is what this test measures.
            </p>
            <p className="text-xs text-t3">
              Privacy: the test runs entirely in your browser. The bait files carry no identifiers, set no cookies, and your
              result is never transmitted or stored.
            </p>
          </div>
        </>
        </ConsoleFrame>
      )}
    </div>
  );
}
