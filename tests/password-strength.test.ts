/**
 * Password Strength Checker: one scale (CTO review 2026-09-10, unclear-UI audit).
 *
 * Three scales used to disagree. The word used 20/40/60/80 cut-offs, the
 * colour and the CTA headline used 50/80, and the crack time was plain brute
 * force that ignored the pattern penalties. "abcdefghijklmnop" showed a red
 * "This password falls in seconds." next to "69k years"; the xkcd passphrase
 * showed a yellow "66 STRONG" with "would not last a determined attack".
 * Everything now reads off the effective entropy (after patterns), so these
 * tests check the pieces agree for a spread of inputs.
 *
 * Review follow-up: on that one scale, the most common human password shapes
 * ("Password2024!", "Summer2024", "iloveyou123") came out green "You are
 * protected here", because a common password inside a longer one and a year
 * touching a letter were never discounted. Those shapes are pinned below.
 */
import { describe, expect, it } from 'vitest';
import { analyzePassword, crackPhrase } from '../components/tools/PasswordStrengthTool';
import { severityFromScore, type Severity } from '../components/tools/ResultContext';

/** Common human password shapes: a common password or a word, plus a year, digits or a symbol. */
const HUMAN_SHAPES = [
  'Password2024!',
  'P@ssw0rd2024',
  'Summer2024',
  'Summer2024!',
  'Winter2025!!',
  'iloveyou123',
  'Iloveyou2024!',
  'qwerty123456',
  'Letmein2024!',
  'Michael1985!',
  'Jennifer1990',
  'password1234567890abc',
  'Admin@123',
  'Hello1234!',
  'hunter2',
];

const SAMPLES = [
  'password123',
  'qwerty',
  'abcdefghijklmnop',
  'aaaaaaaaaaaaaaaaaaaa',
  '83920175',
  '123456789012',
  'Summer 2024',
  'Qwerty!2024x',
  'zaq12wsx',
  'x7#Kp2!vQ9',
  'Tr0ub4dor&3',
  'correcthorsebatterystaple',
  'Tr0ub4dor&3Vault-Wallets!Z',
  'x7#Kp2!vQ9mZ$w4Lr8@t',
  ...HUMAN_SHAPES,
];

/** The severity each word belongs to. The word is never allowed to cross a colour boundary. */
const WORD_SEVERITY: Record<string, Severity> = {
  'Very Weak': 'red',
  Weak: 'red',
  'Needs work': 'amber',
  Strong: 'green',
  'Very Strong': 'green',
};

describe('word, colour and crack time come from one scale', () => {
  for (const pw of SAMPLES) {
    it(JSON.stringify(pw), () => {
      const a = analyzePassword(pw);
      const severity = severityFromScore(a.score);
      expect(WORD_SEVERITY[a.label], `word "${a.label}" at score ${a.score}`).toBe(severity);
      // The red CTA headline is "This password falls in seconds." — a red result must never sit next to hours or years.
      if (severity === 'red') expect(a.crackTime).toMatch(/^(Instantly|Less than a second|\d+ seconds?)$/);
      // Green says "You are protected here." — only for crack times of years or more.
      if (severity === 'green') expect(a.crackTime).toMatch(/years?$|^Centuries\+$/);
    });
  }

  it('orders the same way on every axis: more effective bits never means a lower score', () => {
    const rows = SAMPLES.map(analyzePassword).sort((x, y) => x.entropy - y.entropy);
    for (let i = 1; i < rows.length; i++) expect(rows[i].score).toBeGreaterThanOrEqual(rows[i - 1].score);
  });
});

describe('the audit examples', () => {
  it('"abcdefghijklmnop" is red and falls in under a second, not "69k years"', () => {
    const a = analyzePassword('abcdefghijklmnop');
    expect(severityFromScore(a.score)).toBe('red');
    expect(a.crackTime).toBe('Less than a second');
    expect(a.entropy).toBeLessThan(a.rawEntropy);
  });

  it('"correcthorsebatterystaple" gets one verdict: the word, the colour and the crack time agree', () => {
    const a = analyzePassword('correcthorsebatterystaple');
    expect(severityFromScore(a.score)).toBe('green');
    expect(a.label).toBe('Very Strong');
    expect(a.crackTime).toBe('Centuries+');
  });

  it('a common password is instant, red, and scored from the size of the common list', () => {
    const a = analyzePassword('password123');
    expect(a.crackTime).toBe('Instantly');
    expect(severityFromScore(a.score)).toBe('red');
    expect(a.entropy).toBeLessThan(8);
  });

  it('the long mixed passphrase used by the e2e suite stays Very Strong', () => {
    const a = analyzePassword('Tr0ub4dor&3Vault-Wallets!Z');
    expect(a.label).toBe('Very Strong');
    expect(a.crackTime).toBe('Centuries+');
  });
});

describe('common human password shapes', () => {
  // Green is "You are protected here." in the result CTA.
  it.each(HUMAN_SHAPES)('%s is never green', (pw) => {
    expect(severityFromScore(analyzePassword(pw).score)).not.toBe('green');
  });

  it.each(['Password2024!', 'P@ssw0rd2024', 'iloveyou123', 'qwerty123456', 'Michael1985!', 'Jennifer1990'])(
    '%s, a common password plus a year or digits, is red',
    (pw) => {
      expect(severityFromScore(analyzePassword(pw).score)).toBe('red');
    },
  );

  it('finds a common password inside a longer one', () => {
    for (const pw of ['Password2024!', 'iloveyou123', 'qwerty123456', 'hunter2']) {
      expect(analyzePassword(pw).patterns, pw).toContain('Contains a common password');
    }
  });

  it('reads leet spellings back, inside a longer password and as a whole one', () => {
    expect(analyzePassword('P@ssw0rd2024').patterns).toContain('Contains a common password');
    expect(analyzePassword('1loveyou!').patterns).toContain('Contains a common password');
    const whole = analyzePassword('P@ssw0rd');
    expect(whole.patterns).toContain('Leet speak substitution of common password');
    expect(whole.crackTime).toBe('Instantly');
  });

  it('finds a year that touches letters (no word boundary needed)', () => {
    const a = analyzePassword('Summer2024');
    expect(a.patterns).toContain('Contains a year or date');
    expect(a.entropy).toBeLessThan(a.rawEntropy);
    expect(analyzePassword('Bob12/05/1990').patterns).toContain('Contains a year or date');
  });

  it('never quotes the matched word or date back (the field is masked; it can be a name or a birthday)', () => {
    for (const pw of ['Michael1985!', 'Bob12/05/1990', 'Jennifer1990']) {
      const text = analyzePassword(pw).patterns.join(' ').toLowerCase();
      for (const part of ['michael', '1985', '12/05/1990', 'jennifer', '1990']) expect(text, pw).not.toContain(part);
    }
  });

  it.each(['Liverpool1!', 'Tr0ub4dor&3', 'Dragonfly99', 'Sunflower!!', '1Chelsea!'])(
    '%s, one word with digits or symbols around it, is not green and says why',
    (pw) => {
      const a = analyzePassword(pw);
      expect(severityFromScore(a.score)).not.toBe('green');
      expect(a.patterns).toContain('One word with a few numbers or symbols added');
    },
  );

  it('the word-shape rule leaves passphrases and random strings alone', () => {
    for (const pw of ['correcthorsebatterystaple', 'Tr0ub4dor&3Vault-Wallets!Z', 'xK9#mQ2$vL7!pW4r']) {
      expect(analyzePassword(pw).patterns, pw).not.toContain('One word with a few numbers or symbols added');
    }
  });

  it('a list word buried inside a long passphrase costs its span but is not called a common password', () => {
    // "master" sits inside "mastery" with letters on both sides.
    expect(analyzePassword('quietmasterygardenlanternriver').patterns).not.toContain('Contains a common password');
  });

  it('a common password next to a year costs two runs, not one', () => {
    // "password" then "2024" touch but are separate choices for an attacker:
    // each run costs its first character (lower + digits = 36-symbol pool) plus log2 of its length.
    const bitsPerChar = Math.log2(36);
    expect(analyzePassword('password2024').entropy).toBeCloseTo(bitsPerChar + Math.log2(8) + bitsPerChar + Math.log2(4), 1);
  });
});

describe('the amber word', () => {
  it('is "Needs work": amber starts at a crack time of about 40 seconds', () => {
    const a = analyzePassword('zaq12wsx');
    expect(severityFromScore(a.score)).toBe('amber');
    expect(a.crackTime).toMatch(/minutes?$/);
    expect(a.label).toBe('Needs work');
  });

  it('no result is called "Fair" any more', () => {
    for (const pw of SAMPLES) expect(analyzePassword(pw).label).not.toBe('Fair');
  });
});

describe('entropy', () => {
  it('matches the brute-force figure when nothing predictable is found (parity with the Password Generator)', () => {
    const a = analyzePassword('x7#Kp2!vQ9mZ');
    expect(a.patterns).toEqual([]);
    expect(a.entropy).toBe(a.rawEntropy);
    // 12 characters from lower + upper + digits + symbols = 88-symbol pool.
    expect(a.rawEntropy).toBeCloseTo(12 * Math.log2(88), 1);
  });

  it('discounts a predictable run instead of charging a full character per position', () => {
    const a = analyzePassword('aaaaaaaaaaaaaaaaaaaa');
    expect(a.patterns.some((p) => p.startsWith('Repeated characters'))).toBe(true);
    expect(a.entropy).toBeLessThan(10);
  });
});

describe('crackPhrase', () => {
  it('reads as the end of "This password would be cracked …"', () => {
    expect(crackPhrase('Instantly')).toBe('instantly');
    expect(crackPhrase('Less than a second')).toBe('in less than a second');
    expect(crackPhrase('3 hours')).toBe('in 3 hours');
    expect(crackPhrase('69k years')).toBe('in 69k years');
    expect(crackPhrase('Centuries+')).toBe('in centuries or more');
  });

  it('never says "1 years" or "1 hours"', () => {
    const times = ['Summer2024', 'iloveyou2', 'x7#Kp2!vQ9', 'P@ssw0rd'].map((pw) => analyzePassword(pw).crackTime);
    for (const t of times) expect(t).not.toMatch(/^1 \w+s$/);
  });
});
