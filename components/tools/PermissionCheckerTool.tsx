'use client';

import { useState, useEffect } from 'react';
import { copyText } from '@/lib/clipboard';
import { useReportResult, type Severity, type ToolResult } from './ResultContext';
import { ConsoleFrame, statusFromSeverity, type ConsoleRow, type Status } from './ConsoleFrame';

export interface PermissionResult {
  name: string;
  displayName: string;
  state: 'granted' | 'denied' | 'prompt' | 'unsupported';
  risk: string;
  recommendation: string;
}

/** Also the count ENGINE_META (registry.tsx) advertises for this engine. */
export const PERMISSIONS_TO_CHECK: { name: string; displayName: string; risk: string; recommendation: string }[] = [
  {
    name: 'geolocation',
    displayName: 'Location',
    risk: 'Tracks your physical location. Can be used to build a profile of where you go.',
    recommendation: 'Only grant to maps and weather apps. Deny by default.',
  },
  {
    name: 'notifications',
    displayName: 'Notifications',
    risk: 'Can send push notifications. Often abused for spam and malvertising.',
    recommendation: 'Deny for most websites. Only allow for essential services.',
  },
  {
    name: 'camera',
    displayName: 'Camera',
    risk: 'Can access your webcam. Malicious sites could capture photos/video.',
    recommendation: 'Deny by default. Only grant temporarily for video calls.',
  },
  {
    name: 'microphone',
    displayName: 'Microphone',
    risk: 'Can record audio. Could be used to eavesdrop on conversations.',
    recommendation: 'Deny by default. Only grant temporarily when needed.',
  },
  {
    name: 'clipboard-read',
    displayName: 'Clipboard Read',
    risk: 'Can read your clipboard contents including passwords and sensitive data.',
    recommendation: 'Deny for all sites. Clipboard data is highly sensitive.',
  },
  {
    name: 'clipboard-write',
    displayName: 'Clipboard Write',
    risk: 'Can write to your clipboard. Could replace copied content with malicious data.',
    recommendation: 'Allow only for trusted productivity tools.',
  },
  {
    name: 'accelerometer',
    displayName: 'Accelerometer',
    risk: 'Device motion data. Can be used for fingerprinting or inferring activity.',
    recommendation: 'Deny unless needed for specific web apps.',
  },
  {
    name: 'gyroscope',
    displayName: 'Gyroscope',
    risk: 'Device orientation data. Contributes to device fingerprinting.',
    recommendation: 'Deny unless needed for specific web apps.',
  },
  {
    name: 'magnetometer',
    displayName: 'Magnetometer',
    risk: 'Compass data. Can reveal device hardware details.',
    recommendation: 'Deny unless needed for navigation apps.',
  },
  {
    name: 'midi',
    displayName: 'MIDI Devices',
    risk: 'Can detect connected MIDI devices. Used for fingerprinting.',
    recommendation: 'Deny unless you use web-based music software.',
  },
  {
    name: 'screen-wake-lock',
    displayName: 'Screen Wake Lock',
    risk: 'Low risk. Prevents screen from turning off.',
    recommendation: 'Generally safe. Allow for video/reading apps if desired.',
  },
];

/**
 * Permissions Chromium browsers report as 'granted' to every site without
 * ever asking: clipboard write for the active tab, the motion sensors and
 * screen wake lock. Counting them as "this site already holds N permissions"
 * blamed the site for the browser's defaults and turned a clean result amber,
 * so they get their own label and stay out of the verdict.
 */
const ALLOWED_BY_DEFAULT = new Set(['clipboard-write', 'accelerometer', 'gyroscope', 'magnetometer', 'screen-wake-lock']);

type RowKind = 'allowed' | 'default' | 'blocked' | 'asks' | 'unsupported';

function rowKind(r: PermissionResult): RowKind {
  if (r.state === 'granted') return ALLOWED_BY_DEFAULT.has(r.name) ? 'default' : 'allowed';
  if (r.state === 'denied') return 'blocked';
  if (r.state === 'prompt') return 'asks';
  return 'unsupported';
}

/**
 * Only an allowed permission that normally asks first is a warning, and it is
 * the same warning the header shows, so rows and header always agree. "Asks
 * first" is the browser's normal, safe default: neutral, not a warning.
 */
const ROW_STATUS: Record<RowKind, Status> = {
  allowed: 'warn',
  default: 'info',
  blocked: 'ok',
  asks: 'info',
  unsupported: 'info',
};

const ROW_VALUE: Record<RowKind, string> = {
  allowed: 'Allowed',
  default: 'Allowed by default',
  blocked: 'Blocked',
  asks: 'Asks first',
  unsupported: 'Not reported',
};

export interface PermissionSummary {
  /** Allowed, and normally needs the visitor's OK. The only thing that turns the result amber. */
  allowed: number;
  allowedByDefault: number;
  blocked: number;
  asks: number;
  supported: number;
  severity: Severity;
  headline: string;
  stats: NonNullable<ToolResult['stats']>;
}

/** The one reading of a permission scan: report(), the header and the glance tiles all use it. */
export function summarizePermissions(results: PermissionResult[]): PermissionSummary {
  const kinds = results.map(rowKind);
  const count = (k: RowKind) => kinds.filter((x) => x === k).length;
  const allowed = count('allowed');
  const allowedByDefault = count('default');
  const blocked = count('blocked');
  const asks = count('asks');
  const supported = results.length - count('unsupported');
  if (supported === 0) {
    // Safari/Firefox reject most Permissions API names: every query threw.
    // Reporting green here told those visitors "you are protected" beside a
    // panel that checked nothing (found 2026-09-08).
    return {
      allowed, allowedByDefault, blocked, asks, supported,
      severity: 'info',
      headline: 'This browser does not expose permission states to web pages',
      stats: [{ label: 'Checked', value: '0' }, { label: 'Unsupported', value: String(results.length) }],
    };
  }
  return {
    allowed, allowedByDefault, blocked, asks, supported,
    severity: allowed > 0 ? 'amber' : 'green',
    headline: allowed > 0
      ? `This site already has ${allowed} permission${allowed === 1 ? '' : 's'} that normally ${allowed === 1 ? 'needs' : 'need'} your OK`
      : `This site has none of the permissions that need your OK; ${asks} would ask first`,
    stats: [
      { label: 'Allowed', value: String(allowed) },
      { label: 'Blocked', value: String(blocked) },
      { label: 'Asks first', value: String(asks) },
      { label: 'Allowed by default', value: String(allowedByDefault) },
    ],
  };
}

/**
 * Web pages cannot link to or open chrome:// and about: pages, so these are
 * copy buttons: the visitor pastes the address into their own address bar.
 * Safari's settings have no address to paste, so it gets the menu path.
 */
const SETTINGS_PATHS: Array<{ browser: string; address?: string; menu?: string }> = [
  { browser: 'Chrome, Brave or Edge', address: 'chrome://settings/content' },
  { browser: 'Firefox', address: 'about:preferences#privacy' },
  { browser: 'Safari', menu: 'Safari menu → Settings → Websites' },
];

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(address))) return; // insecure context / denied: the address stays selectable on screen
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <code className="font-mono text-white break-all select-all">{address}</code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 px-2 py-0.5 border border-b2 rounded text-t1 hover:border-white"
        aria-label={`Copy ${address}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

export function PermissionCheckerTool() {
  const [results, setResults] = useState<PermissionResult[]>([]);
  const report = useReportResult();
  useEffect(() => {
    if (!results.length) { report(null); return; }
    const s = summarizePermissions(results);
    report({ severity: s.severity, headline: s.headline, stats: s.stats });
  }, [results, report]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  // The console stays mounted across re-checks, so it is told when each run finished.
  const [runAt, setRunAt] = useState(0);

  const checkPermissions = async () => {
    setScanning(true);
    const permResults: PermissionResult[] = [];

    for (const perm of PERMISSIONS_TO_CHECK) {
      try {
        const status = await navigator.permissions.query({ name: perm.name as PermissionName });
        permResults.push({
          ...perm,
          state: status.state as 'granted' | 'denied' | 'prompt',
        });
      } catch {
        permResults.push({
          ...perm,
          state: 'unsupported',
        });
      }
    }

    setResults(permResults);
    setRunAt(Date.now());
    setScanning(false);
    setScanned(true);
  };

  const summary = summarizePermissions(results);

  return (
    <div className="space-y-6">
      <div className="bg-s0 border border-b1 rounded-lg p-6 text-center">
        <p className="text-t2 mb-4">
          See what this site can access on your device: camera, microphone, location and {PERMISSIONS_TO_CHECK.length - 3} more permissions.
        </p>
        <button
          onClick={checkPermissions}
          disabled={scanning}
          className="btn-primary px-8 py-3"
        >
          {scanning ? 'Checking...' : scanned ? 'Check again' : 'Check permissions'}
        </button>
        <p className="mt-3 text-xs text-t3">
          Your browser only answers for the site you are on. Other sites can have different permissions: check those in your browser&apos;s site settings.
        </p>
      </div>

      {scanned && (
        <ConsoleFrame
          engine="permission-checker"
          status={statusFromSeverity(summary.severity)}
          verdict={summary.supported === 0 ? 'Not supported' : undefined}
          checks={results.length}
          checksNoun={['permission', 'permissions']}
          runAt={runAt || undefined}
          statTiles={summary.stats}
          groups={[
            {
              name: 'What this site can access',
              rows: results.map((r): ConsoleRow => {
                const kind = rowKind(r);
                return {
                  status: ROW_STATUS[kind],
                  name: r.displayName,
                  value: ROW_VALUE[kind],
                  detail: kind === 'default'
                    ? `Your browser allows this for every site by default, so it shows as allowed without you ever saying yes. ${r.risk}`
                    : `${r.risk} ${r.recommendation}`,
                };
              }),
            },
          ]}
        >
        <>
          {/* How to change a permission. A web page cannot open browser
              settings, so the addresses are copy buttons, not links. */}
          <div className="bg-s0 border border-info/30 rounded-lg p-4">
            <p className="text-sm text-info font-medium mb-2">How to remove a permission</p>
            <p className="text-xs text-t2 mb-3">
              Web pages can&apos;t change or open your browser&apos;s settings. Copy the address for your browser, paste it into the address bar and press Enter, then find this site in the list.
            </p>
            <ul className="space-y-2 text-xs">
              {SETTINGS_PATHS.map((p) => (
                <li key={p.browser} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-t2">{p.browser}:</span>
                  {p.address ? <CopyAddress address={p.address} /> : <span className="text-white">{p.menu}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-t3">
              Faster for one site: click the icon at the left end of the address bar while you are on that site.
            </p>
          </div>
        </>
        </ConsoleFrame>
      )}
    </div>
  );
}
