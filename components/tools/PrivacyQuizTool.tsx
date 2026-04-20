'use client';

import { useState } from 'react';

interface Question {
  id: string;
  category: string;
  text: string;
  // Impact weight: how much this question matters to real-world privacy.
  // Higher = more critical. Used to rank recommendations.
  impact: number;
  options: { label: string; score: number }[];
}

const QUESTIONS: Question[] = [
  // Impact scale 1–10. Authentication & passwords have the highest real-world
  // blast radius if compromised, so they get priority in recommendations.
  { id: 'browser', category: 'Browsing', impact: 6,
    text: 'Which browser do you primarily use?',
    options: [
      { label: 'Brave / Tor Browser', score: 10 },
      { label: 'Firefox (with privacy settings)', score: 8 },
      { label: 'Safari', score: 5 },
      { label: 'Chrome / Edge (default settings)', score: 2 },
    ],
  },
  { id: 'search', category: 'Browsing', impact: 3,
    text: 'What search engine do you use?',
    options: [
      { label: 'DuckDuckGo / Startpage', score: 10 },
      { label: 'Brave Search', score: 8 },
      { label: 'Bing', score: 3 },
      { label: 'Google', score: 1 },
    ],
  },
  { id: 'vpn', category: 'Network', impact: 5,
    text: 'Do you use a VPN?',
    options: [
      { label: 'Always on (reputable paid VPN)', score: 10 },
      { label: 'Sometimes / for specific tasks', score: 6 },
      { label: 'Free VPN only', score: 3 },
      { label: 'Never', score: 0 },
    ],
  },
  { id: 'passwords', category: 'Accounts', impact: 10,
    text: 'How do you manage passwords?',
    options: [
      { label: 'Dedicated password manager + unique passwords', score: 10 },
      { label: 'Browser-built-in password manager', score: 6 },
      { label: 'A few passwords I rotate', score: 3 },
      { label: 'Same password everywhere', score: 0 },
    ],
  },
  { id: '2fa', category: 'Accounts', impact: 10,
    text: 'Do you use two-factor authentication?',
    options: [
      { label: 'Hardware key (YubiKey, etc.)', score: 10 },
      { label: 'Authenticator app on all accounts', score: 8 },
      { label: 'SMS 2FA on some accounts', score: 4 },
      { label: 'No 2FA', score: 0 },
    ],
  },
  { id: 'email', category: 'Communication', impact: 5,
    text: 'What email provider do you use?',
    options: [
      { label: 'ProtonMail / Tutanota', score: 10 },
      { label: 'Self-hosted / custom domain', score: 8 },
      { label: 'iCloud Mail', score: 4 },
      { label: 'Gmail / Outlook / Yahoo', score: 1 },
    ],
  },
  { id: 'messaging', category: 'Communication', impact: 4,
    text: 'What messaging app do you primarily use?',
    options: [
      { label: 'Signal', score: 10 },
      { label: 'WhatsApp (E2E encrypted)', score: 6 },
      { label: 'Telegram (secret chats)', score: 5 },
      { label: 'SMS / Facebook Messenger / Discord', score: 1 },
    ],
  },
  { id: 'social', category: 'Social Media', impact: 4,
    text: 'How do you handle social media privacy?',
    options: [
      { label: "Don't use social media / anonymous accounts only", score: 10 },
      { label: 'Private accounts, minimal personal info', score: 7 },
      { label: 'Default privacy settings', score: 3 },
      { label: 'Public profiles with personal details', score: 0 },
    ],
  },
  { id: 'dns', category: 'Network', impact: 3,
    text: 'What DNS resolver do you use?',
    options: [
      { label: 'Encrypted DNS (DoH/DoT) — Quad9, NextDNS', score: 10 },
      { label: 'Cloudflare (1.1.1.1) or Google (8.8.8.8)', score: 6 },
      { label: "Don't know / ISP default", score: 1 },
      { label: "What's DNS?", score: 0 },
    ],
  },
  { id: 'updates', category: 'Device', impact: 9,
    text: 'How quickly do you install security updates?',
    options: [
      { label: 'Immediately / auto-update enabled', score: 10 },
      { label: 'Within a week', score: 7 },
      { label: 'When I remember', score: 3 },
      { label: 'Rarely / updates are annoying', score: 0 },
    ],
  },
  { id: 'permissions', category: 'Device', impact: 5,
    text: 'How do you handle app permissions?',
    options: [
      { label: 'Review and minimize all permissions regularly', score: 10 },
      { label: 'Selective — deny camera/mic to most apps', score: 7 },
      { label: 'Accept most permissions', score: 3 },
      { label: 'Always allow everything', score: 0 },
    ],
  },
  { id: 'cookies', category: 'Browsing', impact: 3,
    text: 'How do you handle cookies?',
    options: [
      { label: 'Block all third-party, clear regularly', score: 10 },
      { label: 'Use a cookie auto-delete extension', score: 8 },
      { label: 'Reject cookies when prompted', score: 5 },
      { label: 'Accept all cookies', score: 0 },
    ],
  },
];

function getGrade(score: number): { letter: string; label: string; color: string } {
  if (score >= 90) return { letter: 'A+', label: 'Privacy Expert', color: '#10b981' };
  if (score >= 80) return { letter: 'A', label: 'Very Private', color: '#22c55e' };
  if (score >= 70) return { letter: 'B', label: 'Good Habits', color: '#84cc16' };
  if (score >= 55) return { letter: 'C', label: 'Room to Improve', color: '#eab308' };
  if (score >= 40) return { letter: 'D', label: 'At Risk', color: '#f97316' };
  return { letter: 'F', label: 'Very Exposed', color: '#ef4444' };
}

// Encode/decode answers in the URL hash so results are shareable.
// Format: "#r=<score1><score2>..." — each score is a single base36 digit (0–9,a).
function encodeAnswers(answers: Record<string, number>): string {
  return QUESTIONS.map((q) => (answers[q.id] ?? -1).toString(36)).join('');
}
function decodeAnswers(encoded: string): Record<string, number> | null {
  if (encoded.length !== QUESTIONS.length) return null;
  const out: Record<string, number> = {};
  for (let i = 0; i < QUESTIONS.length; i++) {
    const n = parseInt(encoded[i], 36);
    if (Number.isNaN(n) || n < 0 || n > 10) return null;
    out[QUESTIONS[i].id] = n;
  }
  return out;
}

// Lazy initializer: read shared results out of the URL hash at mount time,
// avoids the setState-in-effect rule and prevents a flash of question #1.
function restoreFromHash(): { answers: Record<string, number>; finished: boolean } {
  if (typeof window === 'undefined') return { answers: {}, finished: false };
  const match = window.location.hash.match(/r=([0-9a]+)/);
  if (!match) return { answers: {}, finished: false };
  const restored = decodeAnswers(match[1]);
  if (restored && Object.keys(restored).length === QUESTIONS.length) {
    return { answers: restored, finished: true };
  }
  return { answers: {}, finished: false };
}

export function PrivacyQuizTool() {
  const initial = restoreFromHash();
  const [answers, setAnswers] = useState<Record<string, number>>(initial.answers);
  const [currentQ, setCurrentQ] = useState(0);
  const [finished, setFinished] = useState(initial.finished);
  const [shared, setShared] = useState(false);

  const handleAnswer = (questionId: string, score: number) => {
    const newAnswers = { ...answers, [questionId]: score };
    setAnswers(newAnswers);

    if (currentQ < QUESTIONS.length - 1) {
      setTimeout(() => setCurrentQ(currentQ + 1), 300);
    } else {
      setTimeout(() => {
        setFinished(true);
        // Write answers to URL so refresh preserves results and the link is shareable.
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.hash = `r=${encodeAnswers(newAnswers)}`;
          window.history.replaceState(null, '', url.toString());
        }
      }, 300);
    }
  };

  const reset = () => {
    setAnswers({});
    setCurrentQ(0);
    setFinished(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = '';
      window.history.replaceState(null, '', url.toString());
    }
  };

  const shareLink = async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // ignore
    }
  };

  const totalScore = Math.round(
    (Object.values(answers).reduce((a, b) => a + b, 0) / (QUESTIONS.length * 10)) * 100
  );

  const categories = [...new Set(QUESTIONS.map(q => q.category))];
  const categoryScores = categories.map(cat => {
    const catQuestions = QUESTIONS.filter(q => q.category === cat);
    const catTotal = catQuestions.reduce((sum, q) => sum + (answers[q.id] || 0), 0);
    const catMax = catQuestions.length * 10;
    return { category: cat, score: Math.round((catTotal / catMax) * 100) };
  });

  if (finished) {
    const grade = getGrade(totalScore);
    return (
      <div className="space-y-6">
        {/* Overall score */}
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-8 text-center">
          <div className="text-6xl font-bold mb-2" style={{ color: grade.color }}>{grade.letter}</div>
          <div className="text-lg text-white mb-1">{grade.label}</div>
          <div className="text-3xl font-bold text-white mb-4">{totalScore}/100</div>
          <div className="h-3 bg-[#191b1c] rounded-full overflow-hidden max-w-xs mx-auto">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${totalScore}%`, backgroundColor: grade.color }}
            />
          </div>
        </div>

        {/* Category breakdown */}
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Category Breakdown</h3>
          <div className="space-y-3">
            {categoryScores.map(({ category, score }) => {
              const catGrade = getGrade(score);
              return (
                <div key={category}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[#B8B8D4]">{category}</span>
                    <span className="text-sm font-bold" style={{ color: catGrade.color }}>
                      {score}%
                    </span>
                  </div>
                  <div className="h-2 bg-[#191b1c] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${score}%`, backgroundColor: catGrade.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Improvement tips — ranked by impact × (how far the user is from the ideal) */}
        <div className="bg-[#0a0a0a] border border-blue-500/20 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-blue-400 mb-3">Top Recommendations</h3>
          <ul className="space-y-2">
            {QUESTIONS
              .filter((q) => (answers[q.id] || 0) < 6)
              .map((q) => ({ q, priority: q.impact * (10 - (answers[q.id] || 0)) }))
              .sort((a, b) => b.priority - a.priority)
              .slice(0, 5)
              .map(({ q }) => (
                <li key={q.id} className="flex items-start text-sm text-[#B8B8D4]">
                  <span className="mr-2 text-blue-500 shrink-0">&#10132;</span>
                  <span>
                    <strong className="text-white">{q.category}:</strong>{' '}
                    {q.options[0].label} (you answered: {q.options.find((o) => o.score === answers[q.id])?.label})
                  </span>
                </li>
              ))}
            {QUESTIONS.filter((q) => (answers[q.id] || 0) < 6).length === 0 && (
              <li className="text-sm text-green-400">You&apos;re already doing great across all areas!</li>
            )}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={reset} className="btn-primary py-3">Retake Quiz</button>
          <button
            onClick={shareLink}
            className="py-3 border border-white/10 rounded text-white hover:bg-white/5"
          >
            {shared ? 'Link copied!' : 'Copy shareable link'}
          </button>
        </div>
      </div>
    );
  }

  const q = QUESTIONS[currentQ];
  const progress = ((currentQ) / QUESTIONS.length) * 100;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[#B8B8D4]">Question {currentQ + 1} of {QUESTIONS.length}</span>
          <span className="text-xs text-[#B8B8D4]">{q.category}</span>
        </div>
        <div className="h-2 bg-[#191b1c] rounded-full overflow-hidden">
          <div
            className="h-full bg-white/30 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-6">{q.text}</h3>
        <div className="space-y-3">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleAnswer(q.id, opt.score)}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                answers[q.id] === opt.score
                  ? 'border-white/30 bg-white/10 text-white'
                  : 'border-white/10 bg-[#191b1c] text-[#B8B8D4] hover:border-white/20 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
