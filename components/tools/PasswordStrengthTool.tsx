'use client';

import { useState, useCallback } from 'react';

interface PasswordAnalysis {
  score: number; // 0-100
  label: string;
  crackTime: string;
  entropy: number;
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

function analyzePassword(password: string): PasswordAnalysis {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const patterns: string[] = [];

  const length = password.length;
  if (length === 0) {
    return {
      score: 0, label: 'Empty', crackTime: '—', entropy: 0, length: 0,
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
  // If a user generates at N bits and pastes here, they see the same N bits.
  let poolSize = 0;
  if (charsets[0].found) poolSize += 26; // lowercase
  if (charsets[1].found) poolSize += 26; // uppercase
  if (charsets[2].found) poolSize += 10; // digits
  if (charsets[3].found) poolSize += 26; // symbols (same set generator uses: !@#$%^&*()_+-=[]{}|;:,.<>?)

  // Entropy calculation
  const entropy = length * Math.log2(Math.max(poolSize, 1));

  // Pattern detection
  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lower)) {
    patterns.push('Common password detected');
    warnings.push('This is one of the most commonly used passwords');
  }

  // Keyboard patterns
  for (const pat of KEYBOARD_PATTERNS) {
    if (lower.includes(pat)) {
      patterns.push(`Keyboard pattern: "${pat}"`);
    }
  }

  // Repeated characters
  const repeatMatch = password.match(/(.)\1{2,}/g);
  if (repeatMatch) {
    patterns.push(`Repeated characters: "${repeatMatch[0]}"`);
  }

  // Sequential letters
  let sequential = 0;
  for (let i = 0; i < lower.length - 1; i++) {
    if (lower.charCodeAt(i + 1) - lower.charCodeAt(i) === 1) {
      sequential++;
      if (sequential >= 2) {
        patterns.push('Sequential characters detected');
        break;
      }
    } else {
      sequential = 0;
    }
  }

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

  // Date patterns
  if (/\b(19|20)\d{2}\b/.test(password) || /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(password)) {
    patterns.push('Date pattern detected');
    warnings.push('Dates are easily guessable');
  }

  // L33t speak detection
  const l33t = password.replace(/[0@$!1|3]/g, '');
  if (l33t.length < password.length * 0.7 && COMMON_PASSWORDS.has(lower.replace(/[@0$!1|3]/g, (c) => {
    const map: Record<string, string> = { '@': 'a', '0': 'o', '$': 's', '!': 'i', '1': 'l', '|': 'i', '3': 'e' };
    return map[c] || c;
  }))) {
    patterns.push('Leet speak substitution of common password');
  }

  // Suggestions
  if (length < 12) suggestions.push('Use at least 12 characters');
  if (length < 16) suggestions.push('16+ characters is recommended for high-security accounts');
  if (!charsets[3].found) suggestions.push('Add special characters (!@#$%^&*)');
  if (!charsets[1].found) suggestions.push('Mix in uppercase letters');
  if (!charsets[2].found && !charsets[3].found) suggestions.push('Add numbers or symbols');
  if (patterns.length > 0) suggestions.push('Avoid predictable patterns — use random characters or a passphrase');
  if (suggestions.length === 0) suggestions.push('Consider using a password manager for all your accounts');

  // Score calculation
  let score = 0;

  // Length scoring (up to 35 points)
  score += Math.min(35, length * 2.5);

  // Charset diversity (up to 25 points)
  const activeSets = charsets.filter(c => c.found).length;
  score += activeSets * 6.25;

  // Entropy bonus (up to 25 points)
  score += Math.min(25, entropy / 4);

  // Penalties
  if (COMMON_PASSWORDS.has(lower)) score = Math.min(score, 5);
  if (patterns.length > 0) score -= patterns.length * 8;
  if (repeatMatch) score -= 10;
  if (/^\d+$/.test(password)) score -= 15;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Crack time estimation (assuming 10 billion guesses/sec — modern GPU cluster)
  const guessesPerSec = 1e10;
  const totalGuesses = Math.pow(poolSize, length);
  const seconds = totalGuesses / guessesPerSec / 2; // average case

  let crackTime: string;
  if (COMMON_PASSWORDS.has(lower)) {
    crackTime = 'Instantly';
  } else if (seconds < 1) {
    crackTime = 'Less than a second';
  } else if (seconds < 60) {
    crackTime = `${Math.round(seconds)} seconds`;
  } else if (seconds < 3600) {
    crackTime = `${Math.round(seconds / 60)} minutes`;
  } else if (seconds < 86400) {
    crackTime = `${Math.round(seconds / 3600)} hours`;
  } else if (seconds < 31536000) {
    crackTime = `${Math.round(seconds / 86400)} days`;
  } else if (seconds < 31536000 * 1000) {
    crackTime = `${Math.round(seconds / 31536000)} years`;
  } else if (seconds < 31536000 * 1e6) {
    crackTime = `${Math.round(seconds / 31536000 / 1000)}k years`;
  } else if (seconds < 31536000 * 1e9) {
    crackTime = `${Math.round(seconds / 31536000 / 1e6)}M years`;
  } else {
    crackTime = 'Centuries+';
  }

  // Label
  let label: string;
  if (score <= 20) label = 'Very Weak';
  else if (score <= 40) label = 'Weak';
  else if (score <= 60) label = 'Fair';
  else if (score <= 80) label = 'Strong';
  else label = 'Very Strong';

  return { score, label, crackTime, entropy: Math.round(entropy * 10) / 10, length, charsets, warnings, suggestions, patterns };
}

function getScoreColor(score: number): string {
  if (score <= 20) return '#ef4444';
  if (score <= 40) return '#f97316';
  if (score <= 60) return '#eab308';
  if (score <= 80) return '#22c55e';
  return '#10b981';
}

export function PasswordStrengthTool() {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [analysis, setAnalysis] = useState<PasswordAnalysis | null>(null);

  const handleAnalyze = useCallback((value: string) => {
    setPassword(value);
    if (value.length > 0) {
      setAnalysis(analyzePassword(value));
    } else {
      setAnalysis(null);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <label className="block text-sm font-medium text-[#B8B8D4] mb-2">Enter a password to analyze</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => handleAnalyze(e.target.value)}
            placeholder="Type or paste a password..."
            className="w-full px-4 py-3 bg-[#191b1c] border border-white/10 rounded-md text-white placeholder-white/20 pr-24 font-mono"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#B8B8D4] hover:text-white transition-colors px-2 py-1 border border-white/10 rounded"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="mt-2 text-xs text-[#B8B8D4]/60">
          This tool runs entirely in your browser. No passwords are sent to any server.
        </p>
      </div>

      {/* Results */}
      {analysis && (
        <div className="space-y-4">
          {/* Score bar */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-lg font-bold" style={{ color: getScoreColor(analysis.score) }}>
                {analysis.label}
              </span>
              <span className="text-2xl font-bold text-white">{analysis.score}/100</span>
            </div>
            <div className="h-3 bg-[#191b1c] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${analysis.score}%`, backgroundColor: getScoreColor(analysis.score) }}
              />
            </div>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{analysis.length}</div>
              <div className="text-xs text-[#B8B8D4]">Characters</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{analysis.entropy}</div>
              <div className="text-xs text-[#B8B8D4]">Entropy (bits)</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-white">{analysis.charsets.filter(c => c.found).length}/4</div>
              <div className="text-xs text-[#B8B8D4]">Char Types</div>
            </div>
            <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-center">
              <div className="text-lg font-bold text-white leading-tight">{analysis.crackTime}</div>
              <div className="text-xs text-[#B8B8D4]">Crack Time</div>
            </div>
          </div>

          {/* Character breakdown */}
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
            <h3 className="text-sm font-semibold text-white mb-3">Character Breakdown</h3>
            <div className="grid grid-cols-2 gap-3">
              {analysis.charsets.map(cs => (
                <div key={cs.name} className="flex items-center justify-between">
                  <span className="text-sm text-[#B8B8D4]">{cs.name}</span>
                  <span className={`text-sm font-mono ${cs.found ? 'text-green-400' : 'text-red-400'}`}>
                    {cs.found ? `${cs.count} found` : 'missing'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Patterns detected */}
          {analysis.patterns.length > 0 && (
            <div className="bg-[#0a0a0a] border border-red-500/20 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-red-400 mb-3">Patterns Detected</h3>
              <ul className="space-y-2">
                {analysis.patterns.map((p, i) => (
                  <li key={i} className="flex items-start text-sm text-red-300">
                    <span className="mr-2 text-red-500">&#9888;</span>{p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {analysis.warnings.length > 0 && (
            <div className="bg-[#0a0a0a] border border-yellow-500/20 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-yellow-400 mb-3">Warnings</h3>
              <ul className="space-y-2">
                {analysis.warnings.map((w, i) => (
                  <li key={i} className="flex items-start text-sm text-yellow-300">
                    <span className="mr-2">&#9888;</span>{w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {analysis.suggestions.length > 0 && (
            <div className="bg-[#0a0a0a] border border-blue-500/20 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-blue-400 mb-3">Recommendations</h3>
              <ul className="space-y-2">
                {analysis.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start text-sm text-blue-300">
                    <span className="mr-2 text-blue-500">&#10132;</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
