'use client';

import { copyText } from '@/lib/clipboard';

import { useState, useEffect, useMemo } from 'react';
import { SecureContextRequired } from './SecureContextRequired';
import { useReportResult } from './ResultContext';
import { ValueCard } from './ValueCard';

export type Algorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export const ALGORITHMS: Algorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

async function digest(algorithm: Algorithm, data: BufferSource): Promise<string> {
  const buffer = await crypto.subtle.digest(algorithm, data);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashBytes(bytes: BufferSource, algorithm: Algorithm): Promise<string> {
  return digest(algorithm, bytes);
}

async function hmacBytes(bytes: BufferSource, keyBytes: Uint8Array, algorithm: Algorithm): Promise<string> {
  // SHA-1 -> 'HMAC' with hash: 'SHA-1', same for SHA-256/384/512
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, bytes);
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** One computed set of values. It carries the mode it was computed in, so the card labels are read from the values themselves and can never disagree with them. */
export interface Digests {
  hmac: boolean;
  values: Record<Algorithm, string>;
}

/** Plain SHA digests of `bytes`, or HMACs keyed with `hmacKey` (UTF-8) when one is given. */
export async function computeDigests(bytes: BufferSource, hmacKey: string | null): Promise<Digests> {
  const keyBytes = hmacKey === null ? null : new TextEncoder().encode(hmacKey);
  const hex = await Promise.all(ALGORITHMS.map((a) => (keyBytes ? hmacBytes(bytes, keyBytes, a) : hashBytes(bytes, a))));
  const values = {} as Record<Algorithm, string>;
  ALGORITHMS.forEach((a, i) => { values[a] = hex[i]; });
  return { hmac: keyBytes !== null, values };
}

export function digestLabel(algo: Algorithm, hmac: boolean): string {
  return hmac ? `HMAC-${algo}` : algo;
}

/** The last run that finished, success or failure, and the exact input and key it ran on. */
export interface SettledRun {
  source: BufferSource;
  key: string | null;
  /** null when the run failed. */
  digests: Digests | null;
  error: string;
}

/**
 * True while the visible input has no finished run yet. A failed run counts as
 * finished: before, a rejected digest (no crypto.subtle on a plain-HTTP page)
 * left "Computing..." on screen for good under the error.
 */
export function isComputing(source: BufferSource | null, key: string | null, needsKey: boolean, settled: SettledRun | null): boolean {
  return !!source && !needsKey && !(settled && settled.source === source && settled.key === key);
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// Segmented control. The selected side is filled and outlined (the pressed-chip
// look from the A-Z catalogue); the old 10% white tint was too faint to tell
// which side was on.
const SEG_ON = 'border-b2 bg-s2 text-white';
const SEG_OFF = 'border-transparent text-t2 hover:text-white hover:bg-s1';

type InputMode = 'text' | 'file';

export function HashGeneratorTool() {
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [inputText, setInputText] = useState('');
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null);
  const [hmacMode, setHmacMode] = useState(false);
  const [hmacKey, setHmacKey] = useState('');
  const [settled, setSettled] = useState<SettledRun | null>(null);
  const [copied, setCopied] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const report = useReportResult();

  // The bytes behind the visible tab. Text and file are kept apart, so switching
  // tabs never throws away what was typed or chosen; only the visible one is hashed.
  const source = useMemo<BufferSource | null>(
    () => (inputMode === 'text' ? (inputText ? (new TextEncoder().encode(inputText) as BufferSource) : null) : fileBytes),
    [inputMode, inputText, fileBytes],
  );
  const needsKey = hmacMode && !hmacKey;
  const key = hmacMode ? hmacKey : null;

  // Recompute from the committed state whenever the input, the mode or the key
  // changes. The checkbox and key handlers used to call setTimeout(rehash), and
  // rehash still held the previous render's mode and key: ticking HMAC left plain
  // SHA values under HMAC-* labels, and typing "secret" gave HMACs keyed with
  // "secre". `cancelled` drops a slow digest (a big file) that finishes after a
  // newer one has started.
  useEffect(() => {
    if (!source || needsKey) return;
    let cancelled = false;
    computeDigests(source, key).then(
      (digests) => { if (!cancelled) setSettled({ source, key, digests, error: '' }); },
      // Recorded against its input like a success, so "Computing..." ends here too.
      () => { if (!cancelled) setSettled({ source, key, digests: null, error: 'This browser could not compute the hashes.' }); },
    );
    return () => { cancelled = true; };
  }, [source, key, needsKey]);

  // Nothing is shown without input, or while HMAC mode is still waiting for a key.
  const shown = source && !needsKey ? settled?.digests ?? null : null;
  const computing = isComputing(source, key, needsKey, settled);
  // Once nothing is computing, `settled` is the visible input's own run.
  const hashError = source && !needsKey && !computing ? settled?.error ?? '' : '';

  useEffect(() => {
    if (!shown) { report(null); return; }
    const n = ALGORITHMS.length;
    report({ severity: 'info', headline: `${n} hashes computed`, stats: [{ label: 'Algorithms', value: String(n) }] });
  }, [shown, report]);

  const switchMode = (mode: InputMode) => {
    if (mode === inputMode) return;
    setInputMode(mode);
    setSettled(null);
    setError('');
  };

  const onTextChange = (text: string) => {
    setInputText(text);
    if (!text) setSettled(null);
  };

  const ingestFile = async (file: File) => {
    // Old values must not sit next to the new file's name while it is hashed.
    setSettled(null);
    if (file.size > MAX_FILE_SIZE) {
      setFileBytes(null);
      setFileInfo(null);
      setError('File too large. Maximum size is 50MB.');
      return;
    }
    setError('');
    setFileInfo({ name: file.name, size: file.size });
    setFileBytes(await file.arrayBuffer());
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await ingestFile(file);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setInputMode('file');
      await ingestFile(file);
    }
  };

  const handleCopy = async (algo: string, hash: string) => {
    if (!(await copyText(hash))) return; // insecure context / denied: the value stays selectable on screen
    setCopied(algo);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleVerify = (algo: Algorithm) => {
    if (!shown) return;
    const label = digestLabel(algo, shown.hmac);
    const expected = prompt(`Paste the expected ${label} value to verify:`);
    if (expected === null) return;
    if (expected.trim().toLowerCase() === shown.values[algo]) {
      alert('Match! The hashes are identical.');
    } else {
      alert('No match. The hashes are different.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Show a friendly notice if Web Crypto isn't available (HTTP page).
          The component renders nothing on HTTPS so it's invisible in prod. */}
      <SecureContextRequired toolName="Hash Generator" />

      {/* Mode toggle */}
      <div className="bg-s0 border border-b1 rounded-lg p-2 flex gap-1" role="group" aria-label="What to hash">
        <button
          type="button"
          aria-pressed={inputMode === 'text'}
          onClick={() => switchMode('text')}
          className={`flex-1 py-2 rounded border text-sm font-medium transition-colors ${inputMode === 'text' ? SEG_ON : SEG_OFF}`}
        >
          Text Input
        </button>
        <button
          type="button"
          aria-pressed={inputMode === 'file'}
          onClick={() => switchMode('file')}
          className={`flex-1 py-2 rounded border text-sm font-medium transition-colors ${inputMode === 'file' ? SEG_ON : SEG_OFF}`}
        >
          File Input
        </button>
      </div>

      {/* HMAC toggle */}
      <div className="bg-s0 border border-b1 rounded-lg p-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hmacMode}
            onChange={(e) => setHmacMode(e.target.checked)}
            className="accent-white"
          />
          <span className="text-sm text-white font-medium">HMAC mode</span>
          <span className="text-xs text-t2">(keyed hash for signing — webhooks, API auth)</span>
        </label>
        {hmacMode && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-t2 mb-1">HMAC key (secret)</label>
            <input
              type="text"
              value={hmacKey}
              onChange={(e) => {
                setHmacKey(e.target.value);
                // A value keyed with the old key must not reappear when typing starts again.
                if (!e.target.value) setSettled(null);
              }}
              placeholder="Enter the shared secret..."
              className="w-full px-3 py-2 bg-s0 border border-b1 rounded-md text-sm text-white placeholder-white/20 font-mono"
            />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        {inputMode === 'text' ? (
          <div>
            <label className="block text-sm font-medium text-t2 mb-2">Text to Hash</label>
            <textarea
              value={inputText}
              onChange={(e) => onTextChange(e.target.value)}
              placeholder="Enter text to generate hashes..."
              rows={4}
              className="w-full px-4 py-3 bg-s0 border border-b1 rounded-md text-white placeholder-white/20 font-mono text-sm"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-t2 mb-2">File to Hash</label>
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              className={`border-2 border-dashed rounded-md p-6 text-center transition-colors ${
                dragging ? 'border-b2 bg-white/5' : 'border-b1'
              }`}
            >
              <p className="text-sm text-t2 mb-3">
                {dragging ? 'Drop to hash' : 'Drop a file here, or click to browse'}
              </p>
              <input
                type="file"
                onChange={onFileInput}
                className="w-full text-sm text-t2 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-white hover:file:bg-white/20"
              />
              {fileInfo && (
                <p className="mt-3 text-xs text-t2">
                  {fileInfo.name} ({(fileInfo.size / 1024).toLocaleString()} KB) — hashed as raw bytes
                </p>
              )}
            </div>
          </div>
        )}
        {inputText && inputMode === 'text' && (
          <p className="mt-2 text-xs text-t3">
            Input size: {new Blob([inputText]).size.toLocaleString()} bytes
          </p>
        )}
      </div>

      {(error || hashError) && (
        <div className="bg-s0 border border-danger/30 rounded-lg p-4 text-sm text-danger">{error || hashError}</div>
      )}

      {source && needsKey && (
        <div className="bg-s0 border border-b1 rounded-lg p-4 text-sm text-t2">Enter the HMAC key above to see the HMAC values.</div>
      )}

      {computing && <p className="text-xs text-t2">Computing...</p>}

      {/* Results. Labels come from the values' own mode, not the checkbox. */}
      {shown && (
        <div className="space-y-3">
          {ALGORITHMS.map((algo, i) => (
            <ValueCard
              key={algo}
              label={digestLabel(algo, shown.hmac)}
              value={shown.values[algo]}
              as="code"
              valueClassName="text-xs text-ok"
              actions={
                <>
                  <button
                    onClick={() => handleVerify(algo)}
                    className="text-xs text-t2 hover:text-white active:bg-white/5 transition-colors px-3 py-2 border border-b1 rounded min-h-[36px] min-w-[64px]"
                  >
                    Verify
                  </button>
                  <button
                    onClick={() => handleCopy(algo, shown.values[algo])}
                    className="text-xs text-t2 hover:text-white active:bg-white/5 transition-colors px-3 py-2 border border-b1 rounded min-h-[36px] min-w-[64px]"
                  >
                    {copied === algo ? 'Copied!' : 'Copy'}
                  </button>
                </>
              }
              statTiles={i === 0 ? [
                { label: 'Algorithms', value: ALGORITHMS.length },
                ...(shown.hmac ? [{ label: 'Mode', value: 'HMAC' }] : []),
              ] : undefined}
              meta={<span>{shown.values[algo].length * 4} bits ({shown.values[algo].length} hex chars)</span>}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-t3 text-center">
        Uses the Web Crypto API. Files are hashed as raw bytes — binary safe.
      </p>
    </div>
  );
}
