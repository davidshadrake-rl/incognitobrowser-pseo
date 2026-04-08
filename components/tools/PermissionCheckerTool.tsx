'use client';

import { useState, useEffect } from 'react';

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

function getStateColor(state: string) {
  switch (state) {
    case 'granted': return 'text-red-400';
    case 'denied': return 'text-green-400';
    case 'prompt': return 'text-yellow-400';
    default: return 'text-[#B8B8D4]/40';
  }
}

function getStateBg(state: string) {
  switch (state) {
    case 'granted': return 'border-red-500/20';
    case 'denied': return 'border-green-500/20';
    case 'prompt': return 'border-yellow-500/20';
    default: return 'border-white/5';
  }
}

function getStateLabel(state: string) {
  switch (state) {
    case 'granted': return 'GRANTED';
    case 'denied': return 'BLOCKED';
    case 'prompt': return 'ASK';
    default: return 'N/A';
  }
}

export function PermissionCheckerTool() {
  const [results, setResults] = useState<PermissionResult[]>([]);
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
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 text-center">
        <p className="text-[#B8B8D4] mb-4">
          Check which browser permissions websites can access on your device.
        </p>
        <button
          onClick={checkPermissions}
          disabled={scanning}
          className="btn-primary px-8 py-3"
        >
          {scanning ? 'Checking...' : scanned ? 'Re-check Permissions' : 'Check Permissions'}
        </button>
        <p className="mt-3 text-xs text-[#B8B8D4]/60">
          This reads your browser&apos;s permission states. Nothing is changed or sent anywhere.
        </p>
      </div>

      {scanned && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{supported}</div>
              <div className="text-xs text-[#B8B8D4]">Checked</div>
            </div>
            <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{granted}</div>
              <div className="text-xs text-[#B8B8D4]">Granted</div>
            </div>
            <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{denied}</div>
              <div className="text-xs text-[#B8B8D4]">Blocked</div>
            </div>
            <div className="bg-[#0a0a0a] border border-yellow-500/20 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">{prompt}</div>
              <div className="text-xs text-[#B8B8D4]">Will Ask</div>
            </div>
          </div>

          {/* Detail list */}
          <div className="space-y-2">
            {results.filter(r => r.state !== 'unsupported').map((r, i) => (
              <div key={i} className={`bg-[#0a0a0a] border ${getStateBg(r.state)} rounded-lg p-4`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{r.displayName}</span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded ${getStateColor(r.state)} ${
                    r.state === 'granted' ? 'bg-red-500/10' :
                    r.state === 'denied' ? 'bg-green-500/10' : 'bg-yellow-500/10'
                  }`}>
                    {getStateLabel(r.state)}
                  </span>
                </div>
                <p className="text-xs text-[#B8B8D4]/80 mb-1">{r.risk}</p>
                <p className="text-xs text-blue-400/80">{r.recommendation}</p>
              </div>
            ))}
          </div>

          {results.some(r => r.state === 'unsupported') && (
            <div className="bg-[#0a0a0a] border border-white/5 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[#B8B8D4]/60 mb-2">Not Supported in This Browser</h3>
              <div className="flex flex-wrap gap-2">
                {results.filter(r => r.state === 'unsupported').map((r, i) => (
                  <span key={i} className="text-xs text-[#B8B8D4]/40 px-2 py-1 bg-white/5 rounded">
                    {r.displayName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
