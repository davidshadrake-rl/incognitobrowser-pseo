'use client';

/**
 * Result bus — how a tool tells the page "the visitor has just seen their
 * own exposure". Engines call `useReportResult()` whenever their result
 * changes; the result card (components/tools/ResultCard.tsx) reads it and
 * answers at the top of the result. Outside a provider (previews, tests)
 * reporting is a no-op, so engines never depend on the page.
 *
 * The provider also knows two things the card needs:
 *   - the ask: which tool and page this is, and the words written for the
 *     result (the page the visitor came from, else this page's own funnel);
 *   - the run: whether this result followed the visitor's own action, so the
 *     card may bring itself on screen (lib/place-result.ts), and whether they
 *     have scrolled away since, so it never pulls them back.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFromPageFunnel } from '@/lib/from-page-funnel';
import { isV2, type PageFunnel, type PageFunnelV2 } from '@/lib/funnel-types';

export type Severity = 'red' | 'amber' | 'green' | 'info';

/** A result's letter grade. 'A+' is the privacy quiz's top grade. */
export type ToolGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface ToolResult {
  /** red = exposed / failing; amber = partial; green = protected; info = neutral output (generators, converters). */
  severity: Severity;
  /** One line, the visitor's own number: "Your browser is 1 in 2.3M", "cnn.com sets 12 tracking cookies". */
  headline: string;
  /** Optional second line. */
  detail?: string;
  /** 0–100 when the tool produces a score. */
  score?: number;
  /** What `score` is: a score out of 100 (the default when omitted) or a percentage ("72% blocked"). */
  scoreUnit?: '/100' | '%';
  /** Letter grade when the tool produces one. */
  grade?: ToolGrade;
  /** Up to 4 label/value pairs for the scorecard image. */
  stats?: Array<{ label: string; value: string }>;
  /** Text used when sharing; defaults to headline. */
  shareText?: string;
}

/** The page the result belongs to. */
export interface ResultAsk {
  engine: string;
  niche?: string;
  /** The page title, drawn on the share image. */
  title: string;
  /** This page's own funnel (data/funnels.json), if it has one. */
  funnel?: PageFunnel | null;
}

/** One result the visitor asked for (or one that arrived on its own, on page load). */
export interface ResultRun {
  id: number;
  /** The result followed the visitor's own click, key, file or drop. */
  byVisitor: boolean;
  /** The text field they were typing in when the result came, if any. */
  typingField: HTMLElement | null;
}

interface AskState {
  ask: ResultAsk | null;
  run: ResultRun | null;
  /** The page funnel whose words answer this result: the page they came from, else this page's own. */
  answer: PageFunnelV2 | null;
  /** Still looking up the page they came from. */
  pending: boolean;
  /** True when the visitor has scrolled on their own since the action that caused this run. */
  scrolledAway: () => boolean;
  /** Claims the one placement a run gets. False if it was already taken. */
  claimPlacement: (runId: number) => boolean;
}

const ReportContext = createContext<((r: ToolResult | null) => void) | null>(null);
const ResultContext = createContext<ToolResult | null>(null);
const AskContext = createContext<AskState | null>(null);

const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ']);
const TEXT_INPUT = /^(text|search|url|email|password|number|tel)$/i;

function isTypingField(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLTextAreaElement) return true;
  return t instanceof HTMLInputElement && TEXT_INPUT.test(t.type || 'text');
}

export function ResultProvider({ children, ask = null }: { children: ReactNode; ask?: ResultAsk | null }) {
  const [result, setResult] = useState<ToolResult | null>(null);
  const [run, setRun] = useState<ResultRun | null>(null);

  // The visitor's last action, and whether they scrolled after it.
  const action = useRef<{ t: number; scrollY: number; target: EventTarget | null } | null>(null);
  const handScroll = useRef(0);
  const scrolledAwayRef = useRef(false);
  const lastRunAction = useRef(0);
  const runSeq = useRef(0);
  const placed = useRef(new Set<number>());

  useEffect(() => {
    const onAction = (e: Event) => {
      if (e.type === 'keydown' && SCROLL_KEYS.has((e as KeyboardEvent).key) && !isTypingField(e.target)) {
        handScroll.current = Date.now();
        return;
      }
      action.current = { t: Date.now(), scrollY: window.scrollY, target: e.target };
      scrolledAwayRef.current = false;
    };
    const onHand = () => { handScroll.current = Date.now(); };
    // Only a scroll the visitor made by hand counts: the card's own scrollBy
    // and scroll anchoring fire `scroll` with no wheel, touch or key before it.
    const onScroll = () => {
      const a = action.current;
      if (!a || Date.now() - handScroll.current > 1000) return;
      if (Math.abs(window.scrollY - a.scrollY) > 100) scrolledAwayRef.current = true;
    };
    const opts = { capture: true, passive: true } as const;
    for (const t of ['pointerdown', 'keydown', 'input', 'change', 'drop']) document.addEventListener(t, onAction, opts);
    for (const t of ['wheel', 'touchmove']) window.addEventListener(t, onHand, opts);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      for (const t of ['pointerdown', 'keydown', 'input', 'change', 'drop']) document.removeEventListener(t, onAction, opts);
      for (const t of ['wheel', 'touchmove']) window.removeEventListener(t, onHand, opts);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const report = useCallback((r: ToolResult | null) => {
    setResult(r);
    if (!r) return;
    const a = action.current;
    // A result after a new action is a new run; the same run re-reporting
    // (a live score settling, stats arriving) keeps its id and its placement.
    if (a && a.t > lastRunAction.current) {
      lastRunAction.current = a.t;
      runSeq.current += 1;
      setRun({ id: runSeq.current, byVisitor: true, typingField: isTypingField(a.target) ? a.target : null });
    } else if (runSeq.current === 0) {
      runSeq.current = 1;
      setRun({ id: 1, byVisitor: false, typingField: null });
    }
  }, []);

  const fromPage = useFromPageFunnel(ask?.engine ?? '');
  const own = ask?.funnel && isV2(ask.funnel) ? ask.funnel : null;

  const askState = useMemo<AskState>(() => ({
    ask,
    run,
    answer: fromPage.funnel ?? own,
    pending: fromPage.pending,
    scrolledAway: () => scrolledAwayRef.current,
    claimPlacement: (id: number) => {
      if (placed.current.has(id)) return false;
      placed.current.add(id);
      return true;
    },
  }), [ask, run, fromPage.funnel, fromPage.pending, own]);

  return (
    <ReportContext.Provider value={report}>
      <AskContext.Provider value={askState}>
        <ResultContext.Provider value={result}>{children}</ResultContext.Provider>
      </AskContext.Provider>
    </ReportContext.Provider>
  );
}

/** For engines: call with the current result (or null to clear). No-op outside a provider. */
export function useReportResult(): (r: ToolResult | null) => void {
  const report = useContext(ReportContext);
  return report ?? (() => {});
}

/** For the page: the latest reported result. */
export function useToolResult(): ToolResult | null {
  return useContext(ResultContext);
}

/** For the result card: the page, the run and the words that answer it. Null outside a provider. */
export function useResultAsk(): AskState | null {
  return useContext(AskContext);
}

// Pure, so a server page can use them too (lib/severity.ts).
export { severityFromScore, severityFromGrade } from '@/lib/severity';
