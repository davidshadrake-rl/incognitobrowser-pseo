'use client';

import { useState } from 'react';

interface Question {
  id: string;
  category: string;
  text: string;
  options: { label: string; score: number }[];
}

const QUESTIONS: Question[] = [
  {
    id: 'browser',
    category: 'Browsing',
    text: 'Which browser do you primarily use?',
    options: [
      { label: 'Brave / Tor Browser', score: 10 },
      { label: 'Firefox (with privacy settings)', score: 8 },
      { label: 'Safari', score: 5 },
      { label: 'Chrome / Edge (default settings)', score: 2 },
    ],
  },
  {
    id: 'search',
    category: 'Browsing',
    text: 'What search engine do you use?',
    options: [
      { label: 'DuckDuckGo / Startpage', score: 10 },
      { label: 'Brave Search', score: 8 },
      { label: 'Bing', score: 3 },
      { label: 'Google', score: 1 },
    ],
  },
  {
    id: 'vpn',
    category: 'Network',
    text: 'Do you use a VPN?',
    options: [
      { label: 'Always on (reputable paid VPN)', score: 10 },
      { label: 'Sometimes / for specific tasks', score: 6 },
      { label: 'Free VPN only', score: 3 },
      { label: 'Never', score: 0 },
    ],
  },
  {
    id: 'passwords',
    category: 'Accounts',
    text: 'How do you manage passwords?',
    options: [
      { label: 'Dedicated password manager + unique passwords', score: 10 },
      { label: 'Browser-built-in password manager', score: 6 },
      { label: 'A few passwords I rotate', score: 3 },
      { label: 'Same password everywhere', score: 0 },
    ],
  },
  {
    id: '2fa',
    category: 'Accounts',
    text: 'Do you use two-factor authentication?',
    options: [
      { label: 'Hardware key (YubiKey, etc.)', score: 10 },
      { label: 'Authenticator app on all accounts', score: 8 },
      { label: 'SMS 2FA on some accounts', score: 4 },
      { label: 'No 2FA', score: 0 },
    ],
  },
  {
    id: 'email',
    category: 'Communication',
    text: 'What email provider do you use?',
    options: [
      { label: 'ProtonMail / Tutanota', score: 10 },
      { label: 'Self-hosted / custom domain', score: 8 },
      { label: 'iCloud Mail', score: 4 },
      { label: 'Gmail / Outlook / Yahoo', score: 1 },
    ],
  },
  {
    id: 'messaging',
    category: 'Communication',
    text: 'What messaging app do you primarily use?',
    options: [
      { label: 'Signal', score: 10 },
      { label: 'WhatsApp (E2E encrypted)', score: 6 },
      { label: 'Telegram (secret chats)', score: 5 },
      { label: 'SMS / Facebook Messenger / Discord', score: 1 },
    ],
  },
  {
    id: 'social',
    category: 'Social Media',
    text: 'How do you handle social media privacy?',
    options: [
      { label: "Don't use social media / anonymous accounts only", score: 10 },
      { label: 'Private accounts, minimal personal info', score: 7 },
      { label: 'Default privacy settings', score: 3 },
      { label: 'Public profiles with personal details', score: 0 },
    ],
  },
  {
    id: 'dns',
    category: 'Network',
    text: 'What DNS resolver do you use?',
    options: [
      { label: 'Encrypted DNS (DoH/DoT) — Quad9, NextDNS', score: 10 },
      { label: 'Cloudflare (1.1.1.1) or Google (8.8.8.8)', score: 6 },
      { label: "Don't know / ISP default", score: 1 },
      { label: "What's DNS?", score: 0 },
    ],
  },
  {
    id: 'updates',
    category: 'Device',
    text: 'How quickly do you install security updates?',
    options: [
      { label: 'Immediately / auto-update enabled', score: 10 },
      { label: 'Within a week', score: 7 },
      { label: 'When I remember', score: 3 },
      { label: 'Rarely / updates are annoying', score: 0 },
    ],
  },
  {
    id: 'permissions',
    category: 'Device',
    text: 'How do you handle app permissions?',
    options: [
      { label: 'Review and minimize all permissions regularly', score: 10 },
      { label: 'Selective — deny camera/mic to most apps', score: 7 },
      { label: 'Accept most permissions', score: 3 },
      { label: 'Always allow everything', score: 0 },
    ],
  },
  {
    id: 'cookies',
    category: 'Browsing',
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

export function PrivacyQuizTool() {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [finished, setFinished] = useState(false);

  const handleAnswer = (questionId: string, score: number) => {
    const newAnswers = { ...answers, [questionId]: score };
    setAnswers(newAnswers);

    if (currentQ < QUESTIONS.length - 1) {
      setTimeout(() => setCurrentQ(currentQ + 1), 300);
    } else {
      setTimeout(() => setFinished(true), 300);
    }
  };

  const reset = () => {
    setAnswers({});
    setCurrentQ(0);
    setFinished(false);
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

        {/* Improvement tips */}
        <div className="bg-[#0a0a0a] border border-blue-500/20 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-blue-400 mb-3">Top Recommendations</h3>
          <ul className="space-y-2">
            {QUESTIONS.filter(q => (answers[q.id] || 0) < 6)
              .slice(0, 5)
              .map(q => (
                <li key={q.id} className="flex items-start text-sm text-[#B8B8D4]">
                  <span className="mr-2 text-blue-500 shrink-0">&#10132;</span>
                  <span>
                    <strong className="text-white">{q.category}:</strong>{' '}
                    {q.options[0].label} (you answered: {q.options.find(o => o.score === answers[q.id])?.label})
                  </span>
                </li>
              ))}
            {QUESTIONS.filter(q => (answers[q.id] || 0) < 6).length === 0 && (
              <li className="text-sm text-green-400">You&apos;re already doing great across all areas!</li>
            )}
          </ul>
        </div>

        <button onClick={reset} className="btn-primary w-full py-3">Retake Quiz</button>
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
