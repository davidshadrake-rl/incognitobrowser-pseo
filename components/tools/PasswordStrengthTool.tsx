'use client';

import { useState, useCallback, useEffect } from 'react';
import { useReportResult, severityFromScore, type Severity } from './ResultContext';
import { ConsoleFrame, statusFromSeverity } from './ConsoleFrame';
import { Icon } from '@/components/ui/Icon';

export interface PasswordAnalysis {
  /** 0-100, read straight off `entropy` (see scoreFromBits). The word, the colour, the severity and the crack time all follow from it. */
  score: number;
  label: string;
  crackTime: string;
  /** Effective bits: what is left once common passwords and predictable runs are discounted. */
  entropy: number;
  /** Length × log2(pool): the brute-force figure before any discount. */
  rawEntropy: number;
  length: number;
  charsets: { name: string; found: boolean; count: number }[];
  warnings: string[];
  suggestions: string[];
  patterns: string[];
}

const COMMON_PASSWORDS = new Set([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', 'master',
  'dragon', 'login', 'princess', 'football', 'shadow', 'sunshine', 'trustno1',
  'iloveyou', 'batman', 'access', 'hello', 'charlie', 'donald', '123456789',
  'password1', 'qwerty123', 'letmein', 'welcome', 'admin', 'passw0rd',
  '1234567890', 'p@ssword', 'password123', 'changeme', 'secret', 'love',
  'michael', 'jennifer', 'jordan', 'hunter', 'ranger', 'buster', 'thomas',
  'robert', 'soccer', 'hockey', 'killer', 'george', 'andrew', 'andrea',
]);

const KEYBOARD_PATTERNS = [
  'qwerty', 'qwertz', 'azerty', 'asdf', 'zxcv', 'wasd',
  '1234', '2345', '3456', '4567', '5678', '6789', '7890',
  'abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi',
];

/**
 * Leet stand-ins read back as the letters they replace. One character for one,
 * so a word found in the normalised string sits at the same positions in the
 * password. '1' stands for both 'l' and 'i', so it is tried both ways.
 */
const LEET: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '$': 's', '5': 's', '!': 'i', '|': 'i', '3': 'e', '7': 't' };

function deleet(s: string, one: 'l' | 'i'): string {
  return s.replace(/[@40$5!|371]/g, (c) => (c === '1' ? one : LEET[c]));
}

/** Years (1900-2099) and written dates. No \b: in "Summer2024" the year touches a letter, and \b never matched there. */
const DATE_PATTERNS = [/(?:19|20)\d{2}/g, /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g];

/** Offline attack rate the crack time assumes (a modern GPU cluster against a fast hash). */
const GUESSES_PER_SEC = 1e10;

/**
 * One scale for everything. 1.25 points per effective bit puts the site-wide
 * severity cut-offs (50 / 80, severityFromScore) at 40 bits (under a minute at
 * GUESSES_PER_SEC) and 64 bits (about 30 years). The old score added length,
 * charset and entropy points and then subtracted pattern penalties, while the
 * crack time ignored the penalties and the word used its own 20/40/60/80
 * cut-offs, so "abcdefghijklmnop" showed red "falls in seconds" next to
 * "69k years" and "correcthorsebatterystaple" showed a yellow "Strong".
 */
function scoreFromBits(bits: number): number {
  return Math.max(0, Math.min(100, Math.round(bits * 1.25)));
}

/** The word for a score. Bands nest inside the severity bands, so the word and the colour never disagree. */
function labelFromScore(score: number): string {
  if (score < 25) return 'Very Weak';
  if (score < 50) return 'Weak';
  // The whole amber band, which starts at a crack time of about 40 seconds:
  // "Fair" read as acceptable next to "2 minutes".
  if (score < 80) return 'Needs work';
  if (score < 90) return 'Strong';
  return 'Very Strong';
}

function formatCrackTime(seconds: number): string {
  const n = (value: number, unit: string) => {
    const r = Math.round(value);
    return `${r} ${unit}${r === 1 ? '' : 's'}`;
  };
  if (seconds < 1) return 'Less than a second';
  if (seconds < 60) return n(seconds, 'second');
  if (seconds < 3600) return n(seconds / 60, 'minute');
  if (seconds < 86400) return n(seconds / 3600, 'hour');
  if (seconds < 31536000) return n(seconds / 86400, 'day');
  if (seconds < 31536000 * 1000) return n(seconds / 31536000, 'year');
  if (seconds < 31536000 * 1e6) return `${Math.round(seconds / 31536000 / 1000)}k years`;
  if (seconds < 31536000 * 1e9) return `${Math.round(seconds / 31536000 / 1e6)}M years`;
  return 'Centuries+';
}

/** The crack time as the end of a sentence: "would be cracked instantly", "… in 3 hours". */
export function crackPhrase(crackTime: string): string {
  if (crackTime === 'Instantly') return 'instantly';
  if (crackTime === 'Centuries+') return 'in centuries or more';
  return `in ${crackTime.charAt(0).toLowerCase()}${crackTime.slice(1)}`;
}

export function analyzePassword(password: string): PasswordAnalysis {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const patterns: string[] = [];
  // [start, end) of every predictable run the detectors below find.
  const spans: Array<[number, number]> = [];

  const length = password.length;
  if (length === 0) {
    return {
      score: 0, label: 'Empty', crackTime: '—', entropy: 0, rawEntropy: 0, length: 0,
      charsets: [], warnings: ['Enter a password to analyze'], suggestions: [], patterns: [],
    };
  }

  // Character set analysis
  const charsets = [
    { name: 'Lowercase', found: /[a-z]/.test(password), count: (password.match(/[a-z]/g) || []).length },
    { name: 'Uppercase', found: /[A-Z]/.test(password), count: (password.match(/[A-Z]/g) || []).length },
    { name: 'Digits', found: /[0-9]/.test(password), count: (password.match(/[0-9]/g) || []).length },
    { name: 'Symbols', found: /[^a-zA-Z0-9]/.test(password), count: (password.match(/[^a-zA-Z0-9]/g) || []).length },
  ];

  // Pool size matches the Password Generator so entropy comparisons agree between tools.
  // If a user generates at N bits and pastes here, they see the same N bits (unless
  // the random draw happened to contain one of the patterns below).
  let poolSize = 0;
  if (charsets[0].found) poolSize += 26; // lowercase
  if (charsets[1].found) poolSize += 26; // uppercase
  if (charsets[2].found) poolSize += 10; // digits
  if (charsets[3].found) poolSize += 26; // symbols (same set generator uses: !@#$%^&*()_+-=[]{}|;:,.<>?)

  // Brute-force entropy, before any pattern is discounted
  const bitsPerChar = Math.log2(Math.max(poolSize, 1));
  const rawEntropy = length * bitsPerChar;

  // Pattern detection
  const lower = password.toLowerCase();
  const variants = [...new Set([lower, deleet(lower, 'l'), deleet(lower, 'i')])];
  const common = COMMON_PASSWORDS.has(lower);
  const leetCommon = !common && variants.some((v) => COMMON_PASSWORDS.has(v));

  if (common) {
    patterns.push('Common password detected');
    warnings.push('This is one of the most commonly used passwords');
  }
  if (leetCommon) {
    patterns.push('Leet speak substitution of common password');
    warnings.push('Swapping letters for look-alike symbols is one of the first things attackers try');
  }

  // A common password inside a longer one ("Password2024!", "iloveyou123").
  // Only the whole-string match used to count, so those shapes were scored as
  // random characters and came out green. Entries under 4 characters would
  // match by chance. The pattern line doesn't quote the match: the field is
  // masked, and the match can be the visitor's own name.
  if (!common && !leetCommon) {
    let found = false;
    for (const word of COMMON_PASSWORDS) {
      if (word.length < 4) continue;
      for (const v of variants) {
        for (let i = v.indexOf(word); i !== -1; i = v.indexOf(word, i + 1)) {
          spans.push([i, i + word.length]);
          // A list word buried inside longer words ("…mastery…" in a long
          // passphrase) still costs its span, but naming it as a common
          // password under a green "Very Strong" reads as a contradiction.
          const buried = i > 0 && /[a-z]/.test(v[i - 1]) && /[a-z]/.test(v[i + word.length] ?? '');
          if (!buried) found = true;
        }
      }
    }
    if (found) {
      patterns.push('Contains a common password');
      warnings.push('Built on a common password: attackers try those first, with digits and symbols added');
    }

    // One word with a few digits or symbols around it ("Liverpool1!",
    // "Summer2024", "Tr0ub4dor&3") is the most common human password shape,
    // and word-list-plus-rules attacks try it early. The tool has no
    // dictionary, so the shape is the signal: a single run of 4-15 letters
    // (look-alike digits allowed inside it) with at most a few non-letters
    // around it. Long passphrases are several words, so they don't match.
    const shape = lower.match(/^([^a-z]{0,4})([a-z](?:[a-z]|[013457@$](?=[a-z])){2,13}[a-z])([^a-z]{0,6})$/);
    if (shape) {
      const start = shape[1].length;
      spans.push([start, start + shape[2].length]);
      patterns.push('One word with a few numbers or symbols added');
      warnings.push('A single word with digits or symbols tacked on is one of the first shapes attackers try');
    }
  }

  // Keyboard patterns
  for (const pat of KEYBOARD_PATTERNS) {
    if (lower.includes(pat)) {
      patterns.push(`Keyboard pattern: "${pat}"`);
      for (let i = lower.indexOf(pat); i !== -1; i = lower.indexOf(pat, i + 1)) spans.push([i, i + pat.length]);
    }
  }

  // Repeated characters
  const repeatMatch = password.match(/(.)\1{2,}/g);
  if (repeatMatch) {
    patterns.push(`Repeated characters: "${repeatMatch[0]}"`);
    for (const m of password.matchAll(/(.)\1{2,}/g)) spans.push([m.index, m.index + m[0].length]);
  }

  // Sequential letters: every ascending run of 3 or more
  let runStart = 0;
  let sequentialFound = false;
  for (let i = 1; i <= lower.length; i++) {
    if (i < lower.length && lower.charCodeAt(i) - lower.charCodeAt(i - 1) === 1) continue;
    if (i - runStart >= 3) {
      spans.push([runStart, i]);
      sequentialFound = true;
    }
    runStart = i;
  }
  if (sequentialFound) patterns.push('Sequential characters detected');

  // All same case
  if (length > 3 && password === password.toLowerCase()) {
    warnings.push('All lowercase — add uppercase letters');
  }
  if (length > 3 && password === password.toUpperCase() && /[a-zA-Z]/.test(password)) {
    warnings.push('All uppercase — mix in lowercase letters');
  }

  // Only numbers
  if (/^\d+$/.test(password)) {
    warnings.push('Only digits — very easy to brute force');
  }

  // Years and dates (not quoted back either: a birth date is personal)
  let dateFound = false;
  for (const re of DATE_PATTERNS) {
    for (const m of password.matchAll(re)) {
      spans.push([m.index, m.index + m[0].length]);
      dateFound = true;
    }
  }
  if (dateFound) {
    patterns.push('Contains a year or date');
    warnings.push('Years and dates are easily guessable');
  }

  // Suggestions
  if (length < 12) suggestions.push('Use at least 12 characters');
  if (length < 16) suggestions.push('16+ characters is recommended for high-security accounts');
  if (!charsets[3].found) suggestions.push('Add special characters (!@#$%^&*)');
  if (!charsets[1].found) suggestions.push('Mix in uppercase letters');
  if (!charsets[2].found && !charsets[3].found) suggestions.push('Add numbers or symbols');
  if (patterns.length > 0) suggestions.push('Avoid predictable patterns — use random characters or a passphrase');
  if (suggestions.length === 0) suggestions.push('Consider using a password manager for all your accounts');

  // Effective entropy: what an attacker who tries common passwords and patterns
  // first actually has to search. A common password is one of a short list. A
  // predictable run (common password inside, keyboard walk, sequence, repeat,
  // year or date) costs its first character plus its length, not a full
  // character's worth per position.
  let entropy: number;
  if (common || leetCommon) {
    entropy = Math.log2(COMMON_PASSWORDS.size);
  } else {
    // Overlapping runs merge ("qwerty" inside "qwerty123"). Runs that only touch
    // stay apart: "password" then "2024" are two guesses, not one.
    // Clamped: toLowerCase() can lengthen a few non-ASCII characters, so a span
    // found in `lower` may run past the end of the password itself.
    const runs: Array<[number, number]> = [];
    for (const [a, end] of [...spans].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
      const b = Math.min(end, length);
      if (b <= a) continue;
      const last = runs[runs.length - 1];
      if (last && a < last[1]) last[1] = Math.max(last[1], b);
      else runs.push([a, b]);
    }
    const covered = runs.reduce((n, [a, b]) => n + (b - a), 0);
    entropy = (length - covered) * bitsPerChar + runs.reduce((n, [a, b]) => n + bitsPerChar + Math.log2(b - a), 0);
    entropy = Math.min(entropy, rawEntropy);
  }

  const score = scoreFromBits(entropy);
  // Average case: half the space. Same effective bits as the score, so a red
  // result can no longer sit next to a crack time of thousands of years.
  const crackTime = common || leetCommon ? 'Instantly' : formatCrackTime(Math.pow(2, entropy) / GUESSES_PER_SEC / 2);

  return {
    score,
    label: labelFromScore(score),
    crackTime,
    entropy: Math.round(entropy * 10) / 10,
    rawEntropy: Math.round(rawEntropy * 10) / 10,
    length, charsets, warnings, suggestions, patterns,
  };
}

/** Result panel colours per severity (literal classnames so Tailwind's scanner finds them). */
const PANEL: Record<Severity, { box: string; text: string }> = {
  red: { box: 'border-danger/30 bg-danger-dim', text: 'text-danger' },
  amber: { box: 'border-warn/30 bg-warn-dim', text: 'text-warn' },
  green: { box: 'border-ok/30 bg-ok-dim', text: 'text-ok' },
  info: { box: 'border-b1 bg-s0', text: 'text-t1' },
};

export function PasswordStrengthTool() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [analysis, setAnalysis] = useState<PasswordAnalysis | null>(null);
  // The console stays mounted while typing, so it is told when the latest analysis ran.
  const [ranAt, setRanAt] = useState(0);
  const report = useReportResult();
  useEffect(() => {
    if (!analysis) { report(null); return; }
    report({
      severity: severityFromScore(analysis.score),
      score: analysis.score,
      headline: `This password would be cracked ${crackPhrase(analysis.crackTime)}`,
      shareText: `My password would be cracked ${crackPhrase(analysis.crackTime)}. Check yours:`,
      stats: [{ label: 'Cracked in', value: analysis.crackTime }, { label: 'Strength', value: `${analysis.score}/100` }, { label: 'Entropy', value: `${Math.round(analysis.entropy)} bits` }, { label: 'Length', value: String(analysis.length) }],
    });
  }, [analysis, report]);

  const handleAnalyze = useCallback((value: string) => {
    setPassword(value);
    if (value.length > 0) {
      setAnalysis(analyzePassword(value));
      setRanAt(Date.now());
    } else {
      setAnalysis(null);
    }
  }, []);

  // The one severity every surface below reads: panel colour, console dot, gauge, CTA.
  const severity = analysis ? severityFromScore(analysis.score) : 'info';
  const panel = PANEL[severity];

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        <label className="block text-sm font-medium text-t2 mb-2">Enter a password to analyze</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => handleAnalyze(e.target.value)}
            placeholder="Type or paste a password..."
            className="w-full px-4 py-3 bg-s0 border border-b1 rounded-md text-white placeholder-white/20 pr-24 font-mono"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-t2 hover:text-white transition-colors px-2 py-1 border border-b1 rounded"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Results */}
      {analysis && (
        <div className={`rounded-lg border p-6 text-center ${panel.box}`} data-cracked-in>
          <div className="text-xs uppercase tracking-wider text-t3 mb-1">Time an offline attacker needs to crack this password</div>
          <div className={`text-4xl sm:text-5xl font-bold ${panel.text}`}>{analysis.crackTime}</div>
          {/* Two sentences: the guessing rate belongs to the crack time, not to the entropy. */}
          <div className="text-xs text-t2 mt-2 space-y-0.5">
            <p>The crack time assumes 10 billion guesses a second.</p>
            <p>
              {Math.round(analysis.entropy)} bits of entropy
              {Math.round(analysis.entropy) < Math.round(analysis.rawEntropy)
                ? ` once the patterns below are discounted (${Math.round(analysis.rawEntropy)} by length alone)`
                : ''}
              .
            </p>
          </div>
        </div>
      )}
      {analysis && (
        <ConsoleFrame
          engine="password-strength"
          status={statusFromSeverity(severity)}
          verdict={analysis.label}
          runAt={ranAt}
          score={analysis.score}
          gaugeLabel="strength"
          statTiles={[
            // The crack time is already the headline of the panel above; not repeated here.
            { label: 'Strength', value: `${analysis.score}/100` },
            { label: 'Entropy', value: `${Math.round(analysis.entropy)} bits` },
            { label: 'Length', value: analysis.length },
          ]}
        >
        <div className="space-y-4">
          {/* Character breakdown */}
          <div className="bg-s0 border border-b1 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Character Breakdown</h3>
            <div className="grid grid-cols-2 gap-3">
              {analysis.charsets.map(cs => (
                <div key={cs.name} className="flex items-center justify-between">
                  <span className="text-sm text-t2">{cs.name}</span>
                  <span className={`text-sm font-mono ${cs.found ? 'text-ok' : 'text-danger'}`}>
                    {cs.found ? `${cs.count} found` : 'missing'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Patterns detected */}
          {analysis.patterns.length > 0 && (
            <div className="bg-s0 border border-danger/30 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-danger mb-3">Patterns Detected</h3>
              <ul className="space-y-2">
                {analysis.patterns.map((p, i) => (
                  <li key={i} className="flex items-start text-sm text-danger">
                    <Icon name="warn" size={14} className="mr-2 mt-0.5 text-danger" />{p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {analysis.warnings.length > 0 && (
            <div className="bg-s0 border border-warn/30 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-warn mb-3">Warnings</h3>
              <ul className="space-y-2">
                {analysis.warnings.map((w, i) => (
                  <li key={i} className="flex items-start text-sm text-warn">
                    <Icon name="warn" size={14} className="mr-2 mt-0.5" />{w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {analysis.suggestions.length > 0 && (
            <div className="bg-s0 border border-info/30 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-info mb-3">Recommendations</h3>
              <ul className="space-y-2">
                {analysis.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start text-sm text-info">
                    <Icon name="arrow" size={14} className="mr-2 mt-0.5 text-info" />{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        </ConsoleFrame>
      )}
    </div>
  );
}
