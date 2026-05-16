'use client';

import { useEffect, useState } from 'react';

// OWASP 2023+ recommends ≥600,000 iterations for PBKDF2-SHA256.
// We bump this explicitly so the tool doesn't look dated.
const PBKDF2_ITERATIONS = 600_000;
const MAGIC = new Uint8Array([0x49, 0x42, 0x45, 0x31]); // "IBE1" — our container version
const SALT_LEN = 16;
const IV_LEN = 12;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptBytes(plaintext: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource);
  const cipher = new Uint8Array(cipherBuf);
  const out = new Uint8Array(MAGIC.length + salt.length + iv.length + cipher.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + salt.length);
  out.set(cipher, MAGIC.length + salt.length + iv.length);
  return out;
}

async function decryptBytes(blob: Uint8Array, password: string): Promise<Uint8Array> {
  // Back-compat: old container (no MAGIC) was salt[16] + iv[12] + ciphertext.
  const hasMagic = blob.length > MAGIC.length && blob.slice(0, MAGIC.length).every((b, i) => b === MAGIC[i]);
  const base = hasMagic ? MAGIC.length : 0;
  if (blob.length < base + SALT_LEN + IV_LEN + 16) throw new Error('Ciphertext too short');
  const salt = blob.slice(base, base + SALT_LEN);
  const iv = blob.slice(base + SALT_LEN, base + SALT_LEN + IV_LEN);
  const cipher = blob.slice(base + SALT_LEN + IV_LEN);
  const key = await deriveKey(password, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, cipher as BufferSource);
  return new Uint8Array(plainBuf);
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack blowup on large payloads.
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  // Pre-validate to give a clear error rather than letting atob throw a cryptic
  // "Failed to decode" message that bubbles up as "Decryption failed".
  if (clean.length === 0) {
    throw new Error('No ciphertext provided.');
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(clean)) {
    throw new Error(
      'Ciphertext contains characters that are not valid base64. Make sure you copied the full encrypted output exactly.',
    );
  }
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    throw new Error('Ciphertext is not valid base64. Check for truncation or extra characters.');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Translate raw exceptions from the crypto path into actionable user-facing
 * messages. Web Crypto's `OperationError` is the same generic class for
 * wrong-passphrase, tampered-ciphertext, and bad-IV cases — so we have to
 * use context (which mode, which step) to infer what likely went wrong.
 */
function explainCryptoError(err: unknown, mode: 'encrypt' | 'decrypt'): string {
  if (err instanceof Error) {
    const msg = err.message || '';
    // Errors thrown by our own pre-validation (already user-friendly)
    if (msg.startsWith('No ciphertext provided') ||
        msg.startsWith('Ciphertext contains') ||
        msg.startsWith('Ciphertext is not valid base64') ||
        msg.startsWith('Ciphertext too short') ||
        msg === 'Enter text to process.' ||
        msg === 'Select a file to process.' ||
        msg === 'File too large. Maximum 100 MB.') {
      return msg;
    }
    // crypto.subtle generally throws OperationError for AES-GCM auth failures
    if (err.name === 'OperationError' || /OperationError/i.test(msg)) {
      return mode === 'decrypt'
        ? 'Decryption failed — the passphrase is wrong, the ciphertext was tampered with, or it was encrypted by a different tool. AES-GCM cannot distinguish these cases for security reasons. Double-check the passphrase and try again.'
        : 'Encryption failed at the crypto layer. This is usually a browser environment issue — try a different browser or a freshly opened tab.';
    }
    // The PBKDF2 import step occasionally fails on non-HTTPS pages (Web Crypto restricted)
    if (/InvalidAccess|secure context/i.test(msg)) {
      return 'Encryption requires a secure context (HTTPS). This page must be loaded over HTTPS, or use localhost for testing.';
    }
    // QuotaExceededError, NotSupportedError, etc. — show the name + message
    if (err.name && err.name !== 'Error') {
      return `${err.name}: ${msg || 'no detail available'}`;
    }
    return msg || (mode === 'decrypt' ? 'Decryption failed.' : 'Encryption failed.');
  }
  return mode === 'decrypt' ? 'Decryption failed (unknown reason).' : 'Encryption failed (unknown reason).';
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
type Mode = 'encrypt' | 'decrypt';
type Source = 'text' | 'file';

export function TextEncryptionTool() {
  const [mode, setMode] = useState<Mode>('encrypt');
  const [source, setSource] = useState<Source>('text');
  const [inputText, setInputText] = useState('');
  const [password, setPassword] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [copied, setCopied] = useState(false);

  // File mode
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadName, setDownloadName] = useState('');

  useEffect(() => () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  const handleProcess = async () => {
    setError('');
    setOutput('');
    if (downloadUrl) { URL.revokeObjectURL(downloadUrl); setDownloadUrl(''); }

    if (!password.trim()) { setError('Passphrase is required.'); return; }

    setProcessing(true);
    try {
      if (source === 'text') {
        if (!inputText.trim()) throw new Error('Enter text to process.');
        if (mode === 'encrypt') {
          const bytes = await encryptBytes(new TextEncoder().encode(inputText), password);
          setOutput(bytesToBase64(bytes));
        } else {
          const bytes = await decryptBytes(base64ToBytes(inputText.trim()), password);
          setOutput(new TextDecoder().decode(bytes));
        }
      } else {
        if (!inputFile) throw new Error('Select a file to process.');
        if (inputFile.size > MAX_FILE_SIZE) throw new Error('File too large. Maximum 100 MB.');
        const buf = new Uint8Array(await inputFile.arrayBuffer());
        const out = mode === 'encrypt' ? await encryptBytes(buf, password) : await decryptBytes(buf, password);
        const blob = new Blob([out as BlobPart], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        const base = inputFile.name.replace(/\.enc$/, '');
        setDownloadName(mode === 'encrypt' ? `${inputFile.name}.enc` : base);
      }
    } catch (err) {
      // Surface the actual reason so users can act on it instead of staring
      // at "Decryption failed." with no context.
      setError(explainCryptoError(err, mode));
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
      {/* Mode toggles */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex">
          {(['encrypt', 'decrypt'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setOutput(''); setError(''); }}
              className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                mode === m ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
              }`}
            >
              {m === 'encrypt' ? 'Encrypt' : 'Decrypt'}
            </button>
          ))}
        </div>
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex">
          {(['text', 'file'] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => { setSource(s); setOutput(''); setError(''); setInputText(''); setInputFile(null); }}
              className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
                source === s ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
              }`}
            >
              {s === 'text' ? 'Text' : 'File'}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 space-y-4">
        {source === 'text' ? (
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
        ) : (
          <div>
            <label className="block text-sm font-medium text-[#B8B8D4] mb-1">
              {mode === 'encrypt' ? 'File to encrypt' : 'Encrypted file to decrypt (.enc)'}
            </label>
            <input
              type="file"
              onChange={(e) => setInputFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-[#B8B8D4] file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-white/10 file:text-white hover:file:bg-white/20"
            />
            {inputFile && (
              <p className="mt-2 text-xs text-[#B8B8D4]">
                {inputFile.name} ({(inputFile.size / 1024).toLocaleString()} KB)
              </p>
            )}
          </div>
        )}

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
            AES-256-GCM with PBKDF2-SHA256 ({PBKDF2_ITERATIONS.toLocaleString()} iterations). A 4+ word random passphrase is strongly recommended.
          </p>
        </div>

        <button onClick={handleProcess} disabled={processing} className="btn-primary w-full py-3">
          {processing
            ? 'Processing...'
            : source === 'text'
              ? mode === 'encrypt' ? 'Encrypt Text' : 'Decrypt Text'
              : mode === 'encrypt' ? 'Encrypt File' : 'Decrypt File'}
        </button>
      </div>

      {error && (
        <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-4 text-sm text-red-400">{error}</div>
      )}

      {/* Text output */}
      {output && source === 'text' && (
        <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-green-400">
              {mode === 'encrypt' ? 'Encrypted Output' : 'Decrypted Text'}
            </h3>
            <button onClick={handleCopy} className="text-xs text-[#B8B8D4] hover:text-white active:bg-white/5 transition-colors px-3 py-2 border border-white/10 rounded min-h-[36px] min-w-[64px]">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="bg-[#191b1c] p-4 rounded-md text-sm text-white font-mono break-all whitespace-pre-wrap">{output}</pre>
          <p className="mt-3 text-xs text-[#B8B8D4]/60">
            {mode === 'encrypt'
              ? 'Share this text safely. The recipient needs the same passphrase to decrypt.'
              : 'Decrypted entirely in your browser. No data was sent to any server.'}
          </p>
        </div>
      )}

      {/* File output */}
      {downloadUrl && source === 'file' && (
        <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-green-400 mb-3">
            {mode === 'encrypt' ? 'Encrypted File Ready' : 'Decrypted File Ready'}
          </h3>
          <a
            href={downloadUrl}
            download={downloadName}
            className="inline-block px-4 py-2 border border-green-500/20 rounded text-green-400 hover:bg-green-500/10 text-sm"
          >
            Download {downloadName}
          </a>
          <p className="mt-3 text-xs text-[#B8B8D4]/60">
            {mode === 'encrypt'
              ? 'Encrypted as AES-256-GCM. Share the file + passphrase through separate channels.'
              : 'Decrypted entirely in your browser. Nothing was uploaded.'}
          </p>
        </div>
      )}

      {/* Info */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-white mb-3">Encryption Details</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="text-[#B8B8D4]">Algorithm</div><div className="text-white">AES-256-GCM</div>
          <div className="text-[#B8B8D4]">Key Derivation</div><div className="text-white">PBKDF2-SHA256</div>
          <div className="text-[#B8B8D4]">Iterations</div><div className="text-white">{PBKDF2_ITERATIONS.toLocaleString()}</div>
          <div className="text-[#B8B8D4]">Salt</div><div className="text-white">Random 128-bit</div>
          <div className="text-[#B8B8D4]">IV</div><div className="text-white">Random 96-bit</div>
          <div className="text-[#B8B8D4]">Container</div><div className="text-white">IBE1 magic + salt + iv + ciphertext</div>
          <div className="text-[#B8B8D4]">Processing</div><div className="text-white">100% client-side</div>
          <div className="text-[#B8B8D4]">Max file size</div><div className="text-white">100 MB</div>
        </div>
      </div>
    </div>
  );
}
