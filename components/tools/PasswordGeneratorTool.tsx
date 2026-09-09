'use client';

import { copyText } from '@/lib/clipboard';

import { useCallback, useState, useEffect } from 'react';
import { useReportResult } from './ResultContext';
import { Icon } from '@/components/ui/Icon';

type Mode = 'password' | 'passphrase' | 'pin';

interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  excludeSimilar: boolean;
  customChars: string; // extra chars the user wants available (added to pool)
}

const CHARS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

// Chars frequently confused with each other: 0/O, 1/l/I. Stripped in ambiguous mode.
const AMBIGUOUS = /[O0Il1]/g;
// Symbols that look alike in many monospace fonts — stripped in similar mode.
const SIMILAR_SYMBOLS = new Set(['{', '}', '[', ']', '(', ')', '/', '\\', "'", '"', '`', '~', ',', ';', ':', '.', '<', '>']);

/** Unbiased rejection-sampling pick from a string of chars. */
function unbiasedPick(chars: string): string {
  const bound = Math.floor(0x100000000 / chars.length) * chars.length;
  const buf = new Uint32Array(1);
  // Rejection sample to avoid modulo bias
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < bound) return chars[buf[0] % chars.length];
  }
}

function generatePassword(options: GeneratorOptions): string {
  const pools: string[] = [];

  if (options.lowercase) {
    let chars = CHARS.lowercase;
    if (options.excludeAmbiguous) chars = chars.replace(AMBIGUOUS, '');
    pools.push(chars);
  }
  if (options.uppercase) {
    let chars = CHARS.uppercase;
    if (options.excludeAmbiguous) chars = chars.replace(AMBIGUOUS, '');
    pools.push(chars);
  }
  if (options.numbers) {
    let chars = CHARS.numbers;
    if (options.excludeAmbiguous) chars = chars.replace(AMBIGUOUS, '');
    pools.push(chars);
  }
  if (options.symbols) {
    let chars = CHARS.symbols;
    if (options.excludeSimilar) chars = chars.split('').filter((c) => !SIMILAR_SYMBOLS.has(c)).join('');
    pools.push(chars);
  }
  if (options.customChars) {
    pools.push(options.customChars);
  }

  if (pools.length === 0) return '';
  const allChars = pools.join('');

  // Place one char from each required pool first, then fill the rest and shuffle.
  const picks = pools.slice(0, options.length).map((p) => unbiasedPick(p));
  while (picks.length < options.length) picks.push(unbiasedPick(allChars));

  // Fisher–Yates shuffle with unbiased indices.
  for (let i = picks.length - 1; i > 0; i--) {
    const boundIdx = i + 1;
    const bound = Math.floor(0x100000000 / boundIdx) * boundIdx;
    const buf = new Uint32Array(1);
    let j: number;
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < bound) { j = buf[0] % boundIdx; break; }
    }
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.join('');
}

function generatePin(length: number): string {
  return Array.from({ length }, () => unbiasedPick(CHARS.numbers)).join('');
}

const PASSPHRASE_WORDS = [
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

function generatePassphraseSecure(wordCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const bound = Math.floor(0x100000000 / PASSPHRASE_WORDS.length) * PASSPHRASE_WORDS.length;
    const buf = new Uint32Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < bound) { words.push(PASSPHRASE_WORDS[buf[0] % PASSPHRASE_WORDS.length]); break; }
    }
  }
  return words.join('-');
}

function calcEntropy(options: GeneratorOptions): number {
  let poolSize = 0;
  if (options.lowercase) poolSize += options.excludeAmbiguous ? 24 : 26;
  if (options.uppercase) poolSize += options.excludeAmbiguous ? 24 : 26;
  if (options.numbers) poolSize += options.excludeAmbiguous ? 8 : 10;
  if (options.symbols) {
    let sym = CHARS.symbols;
    if (options.excludeSimilar) sym = sym.split('').filter((c) => !SIMILAR_SYMBOLS.has(c)).join('');
    poolSize += sym.length;
  }
  if (options.customChars) poolSize += new Set(options.customChars.split('')).size;
  if (poolSize === 0) return 0;
  return Math.round(options.length * Math.log2(poolSize));
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
    customChars: '',
  });
  const [mode, setMode] = useState<Mode>('password');
  const [wordCount, setWordCount] = useState(5);
  const [pinLength, setPinLength] = useState(6);
  const [password, setPassword] = useState('');
  const report = useReportResult();
  useEffect(() => {
    if (!password) { report(null); return; }
    report({ severity: 'info', headline: `A ${password.length}-character password, generated on your device`, stats: [{ label: 'Length', value: String(password.length) }] });
  }, [password, report]);
  const [history, setHistory] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(() => {
    let pw: string;
    if (mode === 'password') pw = generatePassword(options);
    else if (mode === 'passphrase') pw = generatePassphraseSecure(wordCount);
    else pw = generatePin(pinLength);
    setPassword(pw);
    setHistory((prev) => [pw, ...prev].slice(0, 10));
    setCopied(false);
  }, [options, mode, wordCount, pinLength]);

  const handleCopy = async (text: string) => {
    if (!(await copyText(text))) return; // insecure context / denied: the password stays selectable on screen
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const entropy =
    mode === 'password'
      ? calcEntropy(options)
      : mode === 'passphrase'
        ? Math.round(wordCount * Math.log2(PASSPHRASE_WORDS.length))
        : Math.round(pinLength * Math.log2(10));

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="bg-s0 border border-b1 rounded-lg p-2 flex gap-1">
        {(['password', 'passphrase', 'pin'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setPassword('');
            }}
            className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${
              mode === m ? 'bg-white/10 text-white' : 'text-t2 hover:text-white'
            }`}
          >
            {m === 'password' ? 'Random Password' : m === 'passphrase' ? 'Passphrase' : 'PIN'}
          </button>
        ))}
      </div>

      {/* Options */}
      <div className="bg-s0 border border-b1 rounded-lg p-6 space-y-4">
        {mode === 'password' ? (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-t2">Length: {options.length}</label>
                <span className="text-xs text-t3">{entropy} bits of entropy</span>
              </div>
              <input
                type="range"
                min={8}
                max={64}
                value={options.length}
                onChange={(e) => setOptions({ ...options, length: Number(e.target.value) })}
                className="w-full accent-white"
              />
              <div className="flex justify-between text-xs text-t2/40"><span>8</span><span>64</span></div>
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
                    className="rounded border-white/20 bg-s0 accent-white"
                  />
                  <span className="text-sm text-t2">{label}</span>
                </label>
              ))}
            </div>

            <div>
              <label className="text-sm font-medium text-t2 block mb-1">
                Extra characters to include (optional)
              </label>
              <input
                type="text"
                value={options.customChars}
                onChange={(e) => setOptions({ ...options, customChars: e.target.value })}
                placeholder="e.g. 漢字 or additional symbols"
                className="w-full px-3 py-2 bg-s0 border border-b1 rounded-md text-sm text-white placeholder-white/20 font-mono"
              />
              <p className="mt-1 text-xs text-t3">
                These get added to the pool. Some systems reject Unicode — use with care.
              </p>
            </div>
          </>
        ) : mode === 'passphrase' ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-t2">Words: {wordCount}</label>
              <span className="text-xs text-t3">{entropy} bits of entropy</span>
            </div>
            <input
              type="range"
              min={3}
              max={10}
              value={wordCount}
              onChange={(e) => setWordCount(Number(e.target.value))}
              className="w-full accent-white"
            />
            <div className="flex justify-between text-xs text-t2/40"><span>3</span><span>10</span></div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-t2">PIN length: {pinLength}</label>
              <span className="text-xs text-t3">{entropy} bits of entropy</span>
            </div>
            <input
              type="range"
              min={4}
              max={12}
              value={pinLength}
              onChange={(e) => setPinLength(Number(e.target.value))}
              className="w-full accent-white"
            />
            <div className="flex justify-between text-xs text-t2/40"><span>4</span><span>12</span></div>
            <p className="mt-2 text-xs text-t3">
              For phone unlocks, 2FA backup codes, or anywhere only digits are accepted.
            </p>
          </div>
        )}

        <button onClick={generate} className="btn-primary w-full py-3">
          Generate {mode === 'password' ? 'Password' : mode === 'passphrase' ? 'Passphrase' : 'PIN'}
        </button>
      </div>

      {/* Generated output */}
      {password && (
        <div className="bg-s0 border border-ok/30 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ok">
              Generated {mode === 'password' ? 'Password' : mode === 'passphrase' ? 'Passphrase' : 'PIN'}
            </h3>
            <button
              onClick={() => handleCopy(password)}
              className="text-xs text-t2 hover:text-white active:bg-white/5 transition-colors px-3 py-2 border border-b1 rounded min-h-[36px] min-w-[64px]"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="bg-s0 p-4 rounded-md font-mono text-lg text-white break-all select-all">
            {password}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-t2">
            <span>{password.length} characters</span>
            <span>{entropy} bits entropy</span>
          </div>
        </div>
      )}

      {history.length > 1 && (
        <div className="bg-s0 border border-b1 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-white mb-3">Recent ({history.length})</h3>
          <p className="text-xs text-t3 mb-2">Tap to copy</p>
          <div className="space-y-2">
            {history.slice(1).map((pw, i) => (
              // Entire row is the tap target — big mobile-friendly hit area.
              // Native <button> so keyboard focus/Enter work too.
              <button
                key={i}
                onClick={() => handleCopy(pw)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 -mx-1 rounded hover:bg-white/5 transition-colors text-left cursor-pointer"
                aria-label={`Copy password ${pw.substring(0, 8)}...`}
              >
                <code className="text-xs text-t2 font-mono truncate flex-1">{pw}</code>
                <Icon name="list" size={14} className="text-t3 group-hover:text-white" title="Copy" />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-t3 text-center">
        Generated using the Web Crypto API with unbiased rejection sampling. Nothing leaves your browser.
      </p>
    </div>
  );
}
