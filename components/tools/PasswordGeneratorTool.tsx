'use client';

import { useState, useCallback } from 'react';

interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  excludeSimilar: boolean;
}

const CHARS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

const AMBIGUOUS = 'O0Il1';
const SIMILAR = '{}[]()/\\\'"`~,;:.<>';

function generatePassword(options: GeneratorOptions): string {
  let charset = '';
  const required: string[] = [];

  if (options.lowercase) {
    let chars = CHARS.lowercase;
    if (options.excludeAmbiguous) chars = chars.replace(/[l]/g, '');
    charset += chars;
    required.push(chars);
  }
  if (options.uppercase) {
    let chars = CHARS.uppercase;
    if (options.excludeAmbiguous) chars = chars.replace(/[OI]/g, '');
    charset += chars;
    required.push(chars);
  }
  if (options.numbers) {
    let chars = CHARS.numbers;
    if (options.excludeAmbiguous) chars = chars.replace(/[01]/g, '');
    charset += chars;
    required.push(chars);
  }
  if (options.symbols) {
    let chars = CHARS.symbols;
    if (options.excludeSimilar) chars = chars.split('').filter(c => !SIMILAR.includes(c)).join('');
    charset += chars;
    required.push(chars);
  }

  if (charset.length === 0) return '';

  const arr = new Uint32Array(options.length);
  crypto.getRandomValues(arr);

  // Start by picking one from each required set
  const password = new Array(options.length);
  const positions = Array.from({ length: options.length }, (_, i) => i);

  // Shuffle positions
  for (let i = positions.length - 1; i > 0; i--) {
    const j = arr[i] % (i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  // Place one char from each required set
  for (let i = 0; i < required.length && i < options.length; i++) {
    const randomArr = new Uint32Array(1);
    crypto.getRandomValues(randomArr);
    password[positions[i]] = required[i][randomArr[0] % required[i].length];
  }

  // Fill remaining
  for (let i = 0; i < options.length; i++) {
    if (!password[i]) {
      password[i] = charset[arr[i] % charset.length];
    }
  }

  return password.join('');
}

function generatePassphrase(wordCount: number): string {
  const words = [
    'able', 'acid', 'aged', 'also', 'area', 'army', 'away', 'baby', 'back', 'ball',
    'band', 'bank', 'base', 'bath', 'beam', 'bear', 'beat', 'been', 'bell', 'belt',
    'best', 'bird', 'bite', 'blow', 'blue', 'boat', 'body', 'bomb', 'bond', 'bone',
    'book', 'born', 'boss', 'bowl', 'bulk', 'burn', 'busy', 'cafe', 'cage', 'cake',
    'call', 'calm', 'came', 'camp', 'card', 'care', 'case', 'cash', 'cast', 'cave',
    'chip', 'city', 'clan', 'clay', 'clip', 'club', 'clue', 'coal', 'coat', 'code',
    'coin', 'cold', 'come', 'cook', 'cool', 'cope', 'copy', 'core', 'cost', 'coup',
    'crew', 'crop', 'dark', 'data', 'dawn', 'dead', 'deal', 'dear', 'debt', 'deep',
    'deer', 'deny', 'desk', 'dial', 'dice', 'diet', 'dirt', 'disc', 'dish', 'dock',
    'does', 'done', 'door', 'dose', 'down', 'drag', 'draw', 'drew', 'drop', 'drug',
    'drum', 'dual', 'duke', 'dull', 'dump', 'dust', 'duty', 'each', 'earn', 'ease',
    'east', 'easy', 'edge', 'else', 'even', 'evil', 'exam', 'exit', 'face', 'fact',
    'fail', 'fair', 'fall', 'fame', 'farm', 'fast', 'fate', 'fear', 'feed', 'feel',
    'feet', 'fell', 'felt', 'file', 'fill', 'film', 'find', 'fine', 'fire', 'firm',
    'fish', 'flag', 'flat', 'fled', 'flew', 'flip', 'flow', 'foam', 'fold', 'folk',
    'fond', 'font', 'food', 'fool', 'ford', 'fork', 'form', 'fort', 'foul', 'four',
    'free', 'from', 'fuel', 'full', 'fund', 'fury', 'fuse', 'gain', 'game', 'gang',
    'gave', 'gaze', 'gear', 'gene', 'gift', 'girl', 'give', 'glad', 'glow', 'glue',
    'goal', 'goat', 'goes', 'gold', 'golf', 'gone', 'good', 'grab', 'gray', 'grew',
    'grid', 'grip', 'grow', 'gulf', 'guru', 'hack', 'half', 'hall', 'halt', 'hand',
    'hang', 'harm', 'harp', 'hate', 'have', 'head', 'heal', 'heap', 'heat', 'heel',
    'held', 'helm', 'help', 'herb', 'hero', 'hide', 'high', 'hike', 'hill', 'hint',
    'hire', 'hold', 'hole', 'holy', 'home', 'hood', 'hook', 'hope', 'horn', 'host',
    'hour', 'huge', 'hung', 'hunt', 'hurt', 'icon', 'idea', 'inch', 'info', 'iron',
    'isle', 'item', 'jack', 'jail', 'jazz', 'jean', 'join', 'joke', 'jump', 'jury',
    'just', 'keen', 'keep', 'kept', 'kick', 'kill', 'kind', 'king', 'kiss', 'knee',
    'knew', 'knit', 'knob', 'knot', 'know', 'lack', 'lady', 'laid', 'lake', 'lamp',
    'land', 'lane', 'last', 'late', 'lawn', 'lead', 'leaf', 'lean', 'left', 'lend',
    'lens', 'lent', 'less', 'lied', 'life', 'lift', 'like', 'lime', 'limp', 'line',
    'link', 'lion', 'list', 'live', 'load', 'loan', 'lock', 'logo', 'long', 'look',
    'lord', 'lose', 'loss', 'lost', 'loud', 'love', 'luck', 'lump', 'lung', 'lure',
  ];

  const arr = new Uint32Array(wordCount);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => words[n % words.length]).join('-');
}

function calcEntropy(options: GeneratorOptions): number {
  let poolSize = 0;
  if (options.lowercase) poolSize += 26;
  if (options.uppercase) poolSize += 26;
  if (options.numbers) poolSize += 10;
  if (options.symbols) poolSize += 26;
  if (options.excludeAmbiguous) poolSize -= 5;
  return Math.round(options.length * Math.log2(Math.max(poolSize, 1)));
}

export function PasswordGeneratorTool() {
  const [options, setOptions] = useState<GeneratorOptions>({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false,
    excludeSimilar: false,
  });
  const [mode, setMode] = useState<'password' | 'passphrase'>('password');
  const [wordCount, setWordCount] = useState(5);
  const [password, setPassword] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(() => {
    const pw = mode === 'password'
      ? generatePassword(options)
      : generatePassphrase(wordCount);
    setPassword(pw);
    setHistory(prev => [pw, ...prev].slice(0, 10));
    setCopied(false);
  }, [options, mode, wordCount]);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const entropy = mode === 'password'
    ? calcEntropy(options)
    : Math.round(wordCount * Math.log2(310)); // ~310 words in our list

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-2 flex">
        <button
          onClick={() => { setMode('password'); setPassword(''); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'password' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Random Password
        </button>
        <button
          onClick={() => { setMode('passphrase'); setPassword(''); }}
          className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
            mode === 'passphrase' ? 'bg-white/10 text-white' : 'text-[#B8B8D4] hover:text-white'
          }`}
        >
          Passphrase
        </button>
      </div>

      {/* Options */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 space-y-4">
        {mode === 'password' ? (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-[#B8B8D4]">Length: {options.length}</label>
                <span className="text-xs text-[#B8B8D4]/60">{entropy} bits of entropy</span>
              </div>
              <input
                type="range"
                min={8}
                max={64}
                value={options.length}
                onChange={(e) => setOptions({ ...options, length: Number(e.target.value) })}
                className="w-full accent-white"
              />
              <div className="flex justify-between text-xs text-[#B8B8D4]/40">
                <span>8</span><span>64</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'lowercase' as const, label: 'Lowercase (a-z)' },
                { key: 'uppercase' as const, label: 'Uppercase (A-Z)' },
                { key: 'numbers' as const, label: 'Numbers (0-9)' },
                { key: 'symbols' as const, label: 'Symbols (!@#$)' },
                { key: 'excludeAmbiguous' as const, label: 'No ambiguous (0OIl1)' },
                { key: 'excludeSimilar' as const, label: 'No similar symbols' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
                    className="rounded border-white/20 bg-[#191b1c] accent-white"
                  />
                  <span className="text-sm text-[#B8B8D4]">{label}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[#B8B8D4]">Words: {wordCount}</label>
              <span className="text-xs text-[#B8B8D4]/60">{entropy} bits of entropy</span>
            </div>
            <input
              type="range"
              min={3}
              max={10}
              value={wordCount}
              onChange={(e) => setWordCount(Number(e.target.value))}
              className="w-full accent-white"
            />
            <div className="flex justify-between text-xs text-[#B8B8D4]/40">
              <span>3</span><span>10</span>
            </div>
          </div>
        )}

        <button onClick={generate} className="btn-primary w-full py-3">
          Generate {mode === 'password' ? 'Password' : 'Passphrase'}
        </button>
      </div>

      {/* Generated password */}
      {password && (
        <div className="bg-[#0a0a0a] border border-green-500/20 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-green-400">Generated {mode === 'password' ? 'Password' : 'Passphrase'}</h3>
            <button
              onClick={() => handleCopy(password)}
              className="text-xs text-[#B8B8D4] hover:text-white transition-colors px-3 py-1 border border-white/10 rounded"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="bg-[#191b1c] p-4 rounded-md font-mono text-lg text-white break-all select-all">
            {password}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-[#B8B8D4]">
            <span>{password.length} characters</span>
            <span>{entropy} bits entropy</span>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-white mb-3">Recent ({history.length})</h3>
          <div className="space-y-2">
            {history.slice(1).map((pw, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <code className="text-xs text-[#B8B8D4] font-mono truncate flex-1">{pw}</code>
                <button
                  onClick={() => handleCopy(pw)}
                  className="text-xs text-[#B8B8D4] hover:text-white shrink-0"
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-[#B8B8D4]/60 text-center">
        Generated using the Web Crypto API (CSPRNG). Nothing leaves your browser.
      </p>
    </div>
  );
}
