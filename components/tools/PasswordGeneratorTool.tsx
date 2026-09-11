'use client';

import { copyText } from '@/lib/clipboard';

import { useCallback, useRef, useState, useEffect } from 'react';
import { useReportResult } from './ResultContext';
import { ValueCard } from './ValueCard';

type Mode = 'password' | 'passphrase' | 'pin';

/** One generated value, with the facts about it frozen at the moment it was made. */
interface Generated {
  id: number;
  value: string;
  mode: Mode;
  /** Entropy of THIS value's settings. The sliders can move afterwards without changing it. */
  entropy: number;
  /** Words in a passphrase (0 for the other modes). */
  words: number;
}

const MODE_NAME: Record<Mode, string> = { password: 'Password', passphrase: 'Passphrase', pin: 'PIN' };

/** The result line for a generated value, in the words of its own mode. */
function describe(g: Generated): string {
  if (g.mode === 'pin') return `A ${g.value.length}-digit random PIN`;
  if (g.mode === 'passphrase') return `A ${g.words}-word random passphrase`;
  return `A ${g.value.length}-character random password`;
}

// Segmented control. The selected side is filled and outlined (the pressed-chip
// look from the A-Z catalogue); the old 10% white tint was too faint to tell
// which mode was on.
const SEG_ON = 'border-b2 bg-s2 text-white';
const SEG_OFF = 'border-transparent text-t2 hover:text-white hover:bg-s1';

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
  // `current` is the value on screen; `history` holds only the older ones, so
  // "Recent (n)" counts exactly the rows it lists.
  const [current, setCurrent] = useState<Generated | null>(null);
  const [history, setHistory] = useState<Generated[]>([]);
  const nextId = useRef(1);
  const report = useReportResult();
  useEffect(() => {
    if (!current) { report(null); return; }
    report({ severity: 'info', headline: describe(current), stats: [{ label: 'Length', value: String(current.value.length) }] });
  }, [current, report]);
  // Which value the "Copied" confirmation belongs to (the main card or one Recent row).
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Entropy of what the current settings WILL generate. The card below shows the
  // entropy saved with the value it displays, which may come from older settings.
  const entropy =
    mode === 'password'
      ? calcEntropy(options)
      : mode === 'passphrase'
        ? Math.round(wordCount * Math.log2(PASSPHRASE_WORDS.length))
        : Math.round(pinLength * Math.log2(10));

  // Every character set unticked: there is nothing to draw from.
  const emptyPool = mode === 'password' && entropy === 0;

  const generate = useCallback(() => {
    let value: string;
    if (mode === 'password') value = generatePassword(options);
    else if (mode === 'passphrase') value = generatePassphraseSecure(wordCount);
    else value = generatePin(pinLength);
    if (!value) return;
    const next: Generated = { id: nextId.current++, value, mode, entropy, words: mode === 'passphrase' ? wordCount : 0 };
    if (current) setHistory((prev) => [current, ...prev].slice(0, 9));
    setCurrent(next);
    setCopiedId(null);
  }, [options, mode, wordCount, pinLength, entropy, current]);

  const handleCopy = async (g: Generated) => {
    if (!(await copyText(g.value))) return; // insecure context / denied: the password stays selectable on screen
    setCopiedId(g.id);
    setTimeout(() => setCopiedId((id) => (id === g.id ? null : id)), 2000);
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    // The value on screen belongs to the old mode; keep it reachable under Recent.
    if (current) setHistory((prev) => [current, ...prev].slice(0, 9));
    setCurrent(null);
  };

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="bg-s0 border border-b1 rounded-lg p-2 flex gap-1" role="group" aria-label="What to generate">
        {(['password', 'passphrase', 'pin'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => switchMode(m)}
            className={`flex-1 py-2 rounded border text-sm font-medium transition-colors ${mode === m ? SEG_ON : SEG_OFF}`}
          >
            {m === 'password' ? 'Random Password' : MODE_NAME[m]}
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

        <button onClick={generate} disabled={emptyPool} className="btn-primary w-full py-3">
          Generate {MODE_NAME[mode]}
        </button>
        {emptyPool && <p className="text-xs text-warn">Tick at least one character set to generate a password.</p>}
      </div>

      {/* Generated output. Every fact here comes from the saved value, not the live settings. */}
      {current && (
        <ValueCard
          label={`Generated ${MODE_NAME[current.mode]}`}
          value={current.value}
          valueClassName="text-lg"
          actions={
            <button
              onClick={() => handleCopy(current)}
              className="text-xs text-t2 hover:text-white active:bg-white/5 transition-colors px-3 py-2 border border-b1 rounded min-h-[36px] min-w-[64px]"
            >
              {copiedId === current.id ? 'Copied!' : 'Copy'}
            </button>
          }
          statTiles={[
            current.mode === 'passphrase' ? { label: 'Words', value: current.words } : { label: 'Length', value: current.value.length },
            { label: 'Entropy', value: `${current.entropy} bits` },
          ]}
        />
      )}

      {history.length > 0 && (
        <div className="bg-s0 border border-b1 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-white mb-3">Recent ({history.length})</h3>
          <p className="text-xs text-t3 mb-2">Tap a row to copy it</p>
          <div className="space-y-2">
            {history.map((g) => (
              // Entire row is the tap target — big mobile-friendly hit area.
              // Native <button> so keyboard focus/Enter work too.
              <button
                key={g.id}
                onClick={() => handleCopy(g)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 -mx-1 rounded hover:bg-white/5 transition-colors text-left cursor-pointer"
                aria-label={`Copy ${MODE_NAME[g.mode].toLowerCase()} ${g.value.substring(0, 8)}...`}
              >
                <code className="text-xs text-t2 font-mono truncate flex-1">{g.value}</code>
                <span className={`shrink-0 text-xs ${copiedId === g.id ? 'text-ok' : 'text-t3'}`}>
                  {copiedId === g.id ? 'Copied!' : 'Copy'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-t3 text-center">
        Generated using the Web Crypto API with unbiased rejection sampling.
      </p>
    </div>
  );
}
