'use client';

import { useState } from 'react';

type Algorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

async function hashText(text: string, algorithm: Algorithm): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const buffer = await crypto.subtle.digest(algorithm, data);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function HashGeneratorTool() {
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [fileName, setFileName] = useState('');

  const algorithms: Algorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

  const generateHashes = async (text: string) => {
    if (!text) { setResults({}); return; }
    const r: Record<string, string> = {};
    for (const algo of algorithms) {
      r[algo] = await hashText(text, algo);
    }
    setResults(r);
  };

  const handleTextChange = (text: string) => {
    setInputText(text);
    generateHashes(text);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setInputText(text);
    generateHashes(text);
  };

  const handleCopy = async (algo: string, hash: string) => {
    await navigator.clipboard.writeText(hash);
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
      {/* Input mode toggle */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex">
        <button
          onClick={() => setInputMode('text')}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            inputMode === 'text' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Text Input
        </button>
        <button
          onClick={() => setInputMode('file')}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            inputMode === 'file' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          File Input
        </button>
      </div>

      {/* Input */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        {inputMode === 'text' ? (
          <div>
            <label className="block text-sm font-medium text-[#B8B8D4] mb-2">Text to Hash</label>
            <textarea
              value={inputText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Enter text to generate hashes..."
              rows={4}
              className="w-full px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20 font-mono text-sm"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-[#B8B8D4] mb-2">Upload File</label>
            <input
              type="file"
              onChange={handleFileUpload}
              className="w-full text-sm text-[#B8B8D4] file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-white hover:file:bg-white/20"
            />
            {fileName && (
              <p className="mt-2 text-xs text-[#B8B8D4]">File: {fileName}</p>
            )}
          </div>
        )}
        {inputText && (
          <p className="mt-2 text-xs text-[#B8B8D4]/60">
            Input size: {new Blob([inputText]).size.toLocaleString()} bytes
          </p>
        )}
      </div>

      {/* Results */}
      {Object.keys(results).length > 0 && (
        <div className="space-y-3">
          {algorithms.map(algo => (
            <div key={algo} className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">{algo}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleVerify(algo)}
                    className="text-xs text-[#B8B8D4] hover:text-white transition-colors px-2 py-1 border border-white/10 rounded"
                  >
                    Verify
                  </button>
                  <button
                    onClick={() => handleCopy(algo, results[algo])}
                    className="text-xs text-[#B8B8D4] hover:text-white transition-colors px-2 py-1 border border-white/10 rounded"
                  >
                    {copied === algo ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
              <code className="block bg-[#191b1c] p-3 rounded text-xs text-green-400 font-mono break-all select-all">
                {results[algo]}
              </code>
              <div className="mt-1 text-xs text-[#B8B8D4]/40">
                {results[algo].length * 4} bits ({results[algo].length} hex chars)
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-[#B8B8D4]/60 text-center">
        Uses the Web Crypto API. All hashing is performed locally in your browser.
      </p>
    </div>
  );
}
