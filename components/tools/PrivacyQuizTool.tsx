'use client';

import { useState, useEffect, useRef } from 'react';
import { useReportResult, severityFromScore, type ToolGrade } from './ResultContext';
import { Icon } from '@/components/ui/Icon';
import { ConsoleFrame, statusFromSeverity } from './ConsoleFrame';

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

/** Counts the tool page quotes (registry.tsx), read from the questions themselves. */
export const QUIZ_QUESTION_COUNT = QUESTIONS.length;
export const QUIZ_CATEGORY_COUNT = new Set(QUESTIONS.map((q) => q.category)).size;

function getGrade(score: number): { letter: ToolGrade; label: string; color: string } {
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
  // The short pause that lets the picked answer show before the next question.
  // Held so Back (or a second click) can cancel it instead of racing it.
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const handleAnswer = (questionId: string, score: number) => {
    const newAnswers = { ...answers, [questionId]: score };
    setAnswers(newAnswers);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);

    if (currentQ < QUESTIONS.length - 1) {
      advanceTimer.current = setTimeout(() => setCurrentQ(currentQ + 1), 300);
    } else {
      advanceTimer.current = setTimeout(() => {
        setFinished(true);
        // Answers go in the URL hash before the result is reported: a refresh keeps
        // the result, and the scorecard's share link (shareLinkFor) carries it.
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.hash = `r=${encodeAnswers(newAnswers)}`;
          window.history.replaceState(null, '', url.toString());
        }
      }, 300);
    }
  };

  // Back to the previous question; its answer stays selected and can be changed.
  const goBack = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setCurrentQ((q) => Math.max(0, q - 1));
  };

  const reset = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setAnswers({});
    setCurrentQ(0);
    setFinished(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = '';
      window.history.replaceState(null, '', url.toString());
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

  // Same stats object feeds both the result bus (funnel CTA/scorecard) and
  // the console's glance StatTile row below — computed once, never twice.
  const resultStats = [
    { label: 'Score', value: `${totalScore}/100` },
    ...categoryScores.slice(0, 3).map((c) => ({ label: c.category, value: `${c.score}%` })),
  ];

  const report = useReportResult();
  useEffect(() => {
    if (!finished) { report(null); return; }
    const g = getGrade(totalScore);
    report({
      severity: severityFromScore(totalScore),
      score: totalScore,
      // With its '+': the share card used to print "Grade A" right above "My privacy habits scored A+".
      grade: g.letter,
      headline: `Privacy habits: ${g.letter}, ${g.label}`,
      shareText: `My privacy habits scored ${g.letter} (${totalScore}/100). Take the quiz:`,
      stats: resultStats,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, totalScore, report]);

  if (finished) {
    return (
      <div className="space-y-6">
        <ConsoleFrame
          engine="privacy-quiz"
          status={statusFromSeverity(severityFromScore(totalScore))}
          verdict={`Grade ${getGrade(totalScore).letter}`}
          checks={QUESTIONS.length}
          checksNoun={['question', 'questions']}
          score={totalScore}
          gaugeLabel="privacy score"
          statTiles={resultStats}
        >
          <>
            {/* Category breakdown */}
            <div className="bg-s0 border border-b1 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Category Breakdown</h3>
              <div className="space-y-3">
                {categoryScores.map(({ category, score }) => {
                  const catGrade = getGrade(score);
                  return (
                    <div key={category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-t2">{category}</span>
                        <span className="text-sm font-bold" style={{ color: catGrade.color }}>
                          {score}%
                        </span>
                      </div>
                      {/* Track on s1: on s0 it matched the card, so a 0% category showed nothing at all. */}
                      <div className="h-2 bg-s1 rounded-full overflow-hidden">
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
            <div className="bg-s0 border border-info/30 rounded-lg p-6">
              <h3 className="text-sm font-semibold text-info mb-3">Top Recommendations</h3>
              <ul className="space-y-2">
                {QUESTIONS
                  .filter((q) => (answers[q.id] || 0) < 6)
                  .map((q) => ({ q, priority: q.impact * (10 - (answers[q.id] || 0)) }))
                  .sort((a, b) => b.priority - a.priority)
                  .slice(0, 5)
                  .map(({ q }) => (
                    <li key={q.id} className="flex items-start text-sm text-t2">
                      <Icon name="arrow" size={14} className="mr-2 mt-0.5 text-info" />
                      <span>
                        <strong className="text-white">{q.category}:</strong>{' '}
                        {q.options[0].label} (you answered: {q.options.find((o) => o.score === answers[q.id])?.label})
                      </span>
                    </li>
                  ))}
                {QUESTIONS.filter((q) => (answers[q.id] || 0) < 6).length === 0 && (
                  <li className="text-sm text-ok">You&apos;re already doing great across all areas!</li>
                )}
              </ul>
            </div>

            {/* No share button of its own: "Share your result" below the tool
                carries this result's #r= link, and a second copy button here
                was one share control too many. */}
            <button onClick={reset} className="btn-primary w-full py-3">Retake Quiz</button>
          </>
        </ConsoleFrame>
      </div>
    );
  }

  const q = QUESTIONS[currentQ];
  const progress = ((currentQ) / QUESTIONS.length) * 100;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="bg-s0 border border-b1 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-t2">Question {currentQ + 1} of {QUESTIONS.length}</span>
          <span className="text-xs text-t2">{q.category}</span>
        </div>
        {/* Track on s1 and fill on t2: the old s0 track matched the card and the bar was invisible. */}
        <div
          className="h-2 bg-s1 rounded-full overflow-hidden"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={QUESTIONS.length}
          aria-valuenow={currentQ}
        >
          <div
            className="h-full bg-t2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="bg-s0 border border-b1 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-6">{q.text}</h3>
        <div className="space-y-3">
          {q.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleAnswer(q.id, opt.score)}
              aria-pressed={answers[q.id] === opt.score}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                answers[q.id] === opt.score
                  ? 'border-b2 bg-s2 text-white'
                  : 'border-b1 bg-s0 text-t2 hover:border-white/20 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {/* After the options on purpose: the answer choices stay the first buttons in the card. */}
        {currentQ > 0 && (
          <button
            type="button"
            onClick={goBack}
            className="mt-4 inline-flex items-center gap-1 text-sm text-t2 hover:text-white transition-colors"
          >
            <Icon name="chevron" size={14} className="rotate-180" /> Back to question {currentQ}
          </button>
        )}
      </div>
    </div>
  );
}
