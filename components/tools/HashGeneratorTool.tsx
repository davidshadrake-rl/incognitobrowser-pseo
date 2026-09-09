'use client';

import { copyText } from '@/lib/clipboard';

import { useState, useEffect } from 'react';
import { SecureContextRequired } from './SecureContextRequired';
import { useReportResult } from './ResultContext';

type Algorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

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

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export function HashGeneratorTool() {
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const report = useReportResult();
  useEffect(() => {
    const n = Object.keys(results).length;
    if (!n) { report(null); return; }
    report({ severity: 'info', headline: `${n} hashes computed on your device`, stats: [{ label: 'Algorithms', value: String(n) }] });
  }, [results, report]);
  const [copied, setCopied] = useState('');
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null);
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null);
  const [hmacMode, setHmacMode] = useState(false);
  const [hmacKey, setHmacKey] = useState('');
  const [computing, setComputing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const algorithms: Algorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

  const compute = async (bytes: BufferSource) => {
    setComputing(true);
    setError('');
    try {
      const r: Record<string, string> = {};
      if (hmacMode) {
        if (!hmacKey) {
          setResults({});
          setError('HMAC mode requires a key.');
          setComputing(false);
          return;
        }
        const keyBytes = new TextEncoder().encode(hmacKey);
        for (const algo of algorithms) {
          r[algo] = await hmacBytes(bytes, keyBytes, algo);
        }
      } else {
        for (const algo of algorithms) {
          r[algo] = await hashBytes(bytes, algo);
        }
      }
      setResults(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hash failed');
      setResults({});
    }
    setComputing(false);
  };

  const onTextChange = (text: string) => {
    setInputText(text);
    setFileBytes(null);
    setFileInfo(null);
    if (!text) { setResults({}); return; }
    compute(new TextEncoder().encode(text) as BufferSource);
  };

  const ingestFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setError('File too large. Maximum size is 50MB.');
      return;
    }
    setError('');
    setFileInfo({ name: file.name, size: file.size });
    setInputText('');
    const buffer = await file.arrayBuffer();
    setFileBytes(buffer);
    compute(buffer);
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

  // Re-compute when HMAC toggle or key changes, if we have input.
  const rehash = () => {
    if (fileBytes) compute(fileBytes);
    else if (inputText) compute(new TextEncoder().encode(inputText) as BufferSource);
  };

  const handleCopy = async (algo: string, hash: string) => {
    if (!(await copyText(hash))) return; // insecure context / denied: the value stays selectable on screen
    setCopied(algo);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleVerify = (algo: string) => {
    const expected = prompt(`Paste the expected ${algo} hash to verify:`);
    if (expected === null) return;
    const actual = results[algo];
    if (expected.trim().toLowerCase() === actual) {
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
      <div className="bg-s0 border border-b1 rounded-lg p-2 flex">
        <button
          onClick={() => setInputMode('text')}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            inputMode === 'text' ? 'bg-white/10 text-white' : 'text-t2 hover:text-white'
          }`}
        >
          Text Input
        </button>
        <button
          onClick={() => setInputMode('file')}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            inputMode === 'file' ? 'bg-white/10 text-white' : 'text-t2 hover:text-white'
          }`}
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
            onChange={(e) => { setHmacMode(e.target.checked); setTimeout(rehash, 0); }}
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
              onChange={(e) => { setHmacKey(e.target.value); setTimeout(rehash, 0); }}
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
            <label className="block text-sm font-medium text-t2 mb-2">Upload or Drop File</label>
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

      {error && (
        <div className="bg-s0 border border-danger/30 rounded-lg p-4 text-sm text-danger">{error}</div>
      )}

      {/* Results */}
      {Object.keys(results).length > 0 && (
        <div className="space-y-3">
          {computing && <p className="text-xs text-t2">Computing...</p>}
          {algorithms.map(algo => (
            <div key={algo} className="bg-s0 border border-b1 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">{hmacMode ? `HMAC-${algo}` : algo}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleVerify(algo)}
                    className="text-xs text-t2 hover:text-white active:bg-white/5 transition-colors px-3 py-2 border border-b1 rounded min-h-[36px] min-w-[64px]"
                  >
                    Verify
                  </button>
                  <button
                    onClick={() => handleCopy(algo, results[algo])}
                    className="text-xs text-t2 hover:text-white active:bg-white/5 transition-colors px-3 py-2 border border-b1 rounded min-h-[36px] min-w-[64px]"
                  >
                    {copied === algo ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <code className="block bg-s0 p-3 rounded text-xs text-ok font-mono break-all select-all">
                {results[algo]}
              </code>
              <div className="mt-1 text-xs text-t2/40">
                {results[algo].length * 4} bits ({results[algo].length} hex chars)
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-t3 text-center">
        Uses the Web Crypto API. Files are hashed as raw bytes — binary safe. All processing is local.
      </p>
    </div>
  );
}
