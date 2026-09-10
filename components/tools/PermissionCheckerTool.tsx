'use client';

import { useState, useEffect } from 'react';
import { useReportResult } from './ResultContext';
import { ConsoleFrame, statusFromSeverity, type ConsoleRow, type Status } from './ConsoleFrame';

interface PermissionResult {
  name: string;
  displayName: string;
  state: 'granted' | 'denied' | 'prompt' | 'unsupported';
  risk: string;
  recommendation: string;
}

const PERMISSIONS_TO_CHECK: { name: string; displayName: string; risk: string; recommendation: string }[] = [
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

function getStateLabel(state: string) {
  switch (state) {
    case 'granted': return 'GRANTED';
    case 'denied': return 'BLOCKED';
    case 'prompt': return 'ASK';
    default: return 'N/A';
  }
}

/** granted is the BAD state for a permission (a site already holds access), not a pass. */
const ROW_STATUS: Record<PermissionResult['state'], Status> = {
  granted: 'danger',
  denied: 'ok',
  prompt: 'warn',
  unsupported: 'info',
};

export function PermissionCheckerTool() {
  const [results, setResults] = useState<PermissionResult[]>([]);
  const report = useReportResult();
  useEffect(() => {
    if (!results.length) { report(null); return; }
    const g = results.filter((r) => r.state === 'granted').length;
    const d = results.filter((r) => r.state === 'denied').length;
    const p = results.filter((r) => r.state === 'prompt').length;
    const supported = results.length - results.filter((r) => r.state === 'unsupported').length;
    if (supported === 0) {
      // Safari/Firefox reject most Permissions API names: every query threw.
      // Reporting green here told those visitors "you are protected" beside a
      // panel that checked nothing (found 2026-09-08).
      report({
        severity: 'info',
        headline: 'This browser does not expose permission states to web pages',
        stats: [{ label: 'Checked', value: '0' }, { label: 'Unsupported', value: String(results.length) }],
      });
      return;
    }
    report({
      severity: g > 0 ? 'amber' : 'green',
      headline: g ? `This site already holds ${g} of ${supported} permissions` : `No permission is granted to this site; ${p} would prompt`,
      stats: [{ label: 'Granted', value: String(g) }, { label: 'Denied', value: String(d) }, { label: 'Would prompt', value: String(p) }, { label: 'Checked', value: String(supported) }],
    });
  }, [results, report]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

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
    setScanning(false);
    setScanned(true);
  };

  const granted = results.filter(r => r.state === 'granted').length;
  const denied = results.filter(r => r.state === 'denied').length;
  const prompt = results.filter(r => r.state === 'prompt').length;
  const supported = results.filter(r => r.state !== 'unsupported').length;

  return (
    <div className="space-y-6">
      <div className="bg-s0 border border-b1 rounded-lg p-6 text-center">
        <p className="text-t2 mb-4">
          Check which browser permissions websites can access on your device.
        </p>
        <button
          onClick={checkPermissions}
          disabled={scanning}
          className="btn-primary px-8 py-3"
        >
          {scanning ? 'Checking...' : scanned ? 'Re-check Permissions' : 'Check Permissions'}
        </button>
        <p className="mt-3 text-xs text-t3">
          This reads your browser&apos;s permission states. Nothing is changed or sent anywhere.
        </p>
      </div>

      {scanned && (
        <ConsoleFrame
          engine="permission-checker"
          status={statusFromSeverity(supported === 0 ? 'info' : granted > 0 ? 'amber' : 'green')}
          checks={results.length}
          processing="client"
          statTiles={
            supported === 0
              ? [{ label: 'Checked', value: '0' }, { label: 'Unsupported', value: String(results.length) }]
              : [
                  { label: 'Granted', value: String(granted) },
                  { label: 'Denied', value: String(denied) },
                  { label: 'Would prompt', value: String(prompt) },
                  { label: 'Checked', value: String(supported) },
                ]
          }
          groups={[
            {
              name: 'Permissions',
              rows: results.map((r): ConsoleRow => ({
                status: ROW_STATUS[r.state],
                name: r.displayName,
                value: getStateLabel(r.state),
                detail: `${r.risk} ${r.recommendation}`,
              })),
            },
          ]}
        >
        <>
          {/* Settings deep-link info */}
          <div className="bg-s0 border border-info/30 rounded-lg p-4">
            <p className="text-sm text-info font-medium mb-2">How to revoke a permission</p>
            <p className="text-xs text-t2 mb-2">
              Browsers intentionally don&apos;t expose a programmatic way to revoke permissions (it would be abused).
              Open your site settings via the browser address bar or the shortcut below:
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                { label: 'Chrome / Brave / Edge', url: 'chrome://settings/content' },
                { label: 'Firefox', url: 'about:preferences#privacy' },
                { label: 'Safari', url: 'Settings → Websites' },
              ].map((link) => (
                <span key={link.label} className="px-2 py-1 bg-white/5 rounded font-mono text-t2">
                  <span className="text-white">{link.label}:</span> {link.url}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-t3">
              Tip: in Chromium-based browsers, click the padlock icon in the address bar for per-site controls.
            </p>
          </div>
        </>
        </ConsoleFrame>
      )}
    </div>
  );
}
