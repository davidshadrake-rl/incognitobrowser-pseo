'use client';

import { useState } from 'react';

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(plaintext: string, password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );
  // Combine salt + iv + ciphertext and base64 encode
  const combined = new Uint8Array(salt.length + iv.length + new Uint8Array(encrypted).length);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptText(ciphertext: string, password: string): Promise<string> {
  const decoder = new TextDecoder();
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const data = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  return decoder.decode(decrypted);
}

export function TextEncryptionTool() {
  const [mode, setMode] = useState<'encrypt' | 'decrypt'>('encrypt');
  const [inputText, setInputText] = useState('');
  const [password, setPassword] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleProcess = async () => {
    if (!inputText.trim() || !password.trim()) {
      setError('Both text and passphrase are required.');
      return;
    }
    setError('');
    setProcessing(true);
    try {
      if (mode === 'encrypt') {
        const result = await encryptText(inputText, password);
        setOutput(result);
      } else {
        const result = await decryptText(inputText.trim(), password);
        setOutput(result);
      }
    } catch {
      setError(mode === 'decrypt'
        ? 'Decryption failed. Check your passphrase and ciphertext.'
        : 'Encryption failed. Please try again.');
    }
    setProcessing(false);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex">
        <button
          onClick={() => { setMode('encrypt'); setOutput(''); setError(''); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'encrypt' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Encrypt
        </button>
        <button
          onClick={() => { setMode('decrypt'); setOutput(''); setError(''); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'decrypt' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Decrypt
        </button>
      </div>

      {/* Input area */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#B8B8D4] mb-1">
            {mode === 'encrypt' ? 'Plaintext' : 'Encrypted Text (Base64)'}
          </label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={mode === 'encrypt' ? 'Enter text to encrypt...' : 'Paste encrypted base64 text...'}
            rows={5}
            className="w-full px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20 font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#B8B8D4] mb-1">Passphrase</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter a strong passphrase..."
            className="w-full px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20"
          />
          <p className="mt-1 text-xs text-[#B8B8D4]/60">
            Uses AES-256-GCM encryption with PBKDF2 key derivation (100k iterations).
          </p>
        </div>

        <button
          onClick={handleProcess}
          disabled={processing}
          className="btn-primary w-full py-3"
        >
          {processing ? 'Processing...' : mode === 'encrypt' ? 'Encrypt Text' : 'Decrypt Text'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Output */}
      {output && (
        <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-green-400">
              {mode === 'encrypt' ? 'Encrypted Output' : 'Decrypted Text'}
            </h3>
            <button
              onClick={handleCopy}
              className="text-xs text-[#B8B8D4] hover:text-white transition-colors px-3 py-1 border border-white/10 rounded"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="bg-[#191b1c] p-4 rounded-md text-sm text-white font-mono break-all whitespace-pre-wrap">
            {output}
          </pre>
          <p className="mt-3 text-xs text-[#B8B8D4]/60">
            {mode === 'encrypt'
              ? 'Share this encrypted text safely. The recipient needs the same passphrase to decrypt.'
              : 'This text was decrypted entirely in your browser. No data was sent to any server.'}
          </p>
        </div>
      )}

      {/* Info */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-white mb-3">Encryption Details</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="text-[#B8B8D4]">Algorithm</div><div className="text-white">AES-256-GCM</div>
          <div className="text-[#B8B8D4]">Key Derivation</div><div className="text-white">PBKDF2-SHA256</div>
          <div className="text-[#B8B8D4]">Iterations</div><div className="text-white">100,000</div>
          <div className="text-[#B8B8D4]">Salt</div><div className="text-white">Random 128-bit</div>
          <div className="text-[#B8B8D4]">IV</div><div className="text-white">Random 96-bit</div>
          <div className="text-[#B8B8D4]">Processing</div><div className="text-white">100% client-side</div>
        </div>
      </div>
    </div>
  );
}
