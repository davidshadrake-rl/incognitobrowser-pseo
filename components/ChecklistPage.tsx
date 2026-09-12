'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { Badge, type BadgeVariant } from './ui/Badge';
import { Icon } from './ui/Icon';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { EditorialNote } from './EditorialNote';
import { CheckYoursNow } from './CheckYoursNow';
import { PageFunnel } from './PageFunnel';
import type { PageFunnel as Funnel } from '@/lib/funnels';
import { TYPE_ICON, diagramForNiche } from '@/lib/visuals';
import type { ProofRoute } from '@/lib/proof-route';

interface ChecklistItem {
  id: string;
  task: string;
  why: string;
  howTo: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

interface ChecklistData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
  estimatedTime: string;
  intro?: string;
  sections: ChecklistSection[];
}

/**
 * Green on this page means "done" (a ticked row), so no priority chip may use
 * the green 'ok' look — "low" used to, and read as already finished.
 */
const PRIORITY_VARIANT: Record<ChecklistItem['priority'], BadgeVariant> = {
  critical: 'danger',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
};

// Ticks live in localStorage under `checklist-<niche>-<slug>`, read through
// useSyncExternalStore: the server snapshot is "nothing ticked", so the static
// HTML matches the first client render.
const TICKS_EVENT = 'checklist-ticks';
/**
 * Ticks whose last save threw (blocked site data, some private modes, a full
 * quota), kept for the rest of the visit. A key is here only while storage is
 * failing for it, so a working browser always reads storage: a copy that
 * mirrored every write brought back ticks another tab had just reset.
 */
const unsavedTicks = new Map<string, string>();

function readTicks(key: string): string {
  const unsaved = unsavedTicks.get(key);
  if (unsaved !== undefined) return unsaved;
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeTicks(key: string, value: Record<string, boolean> | null): void {
  const raw = value ? JSON.stringify(value) : '';
  try {
    if (raw) localStorage.setItem(key, raw);
    else localStorage.removeItem(key);
    unsavedTicks.delete(key);
  } catch {
    unsavedTicks.set(key, raw);
  }
  window.dispatchEvent(new Event(TICKS_EVENT));
}
function subscribeTicks(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(TICKS_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(TICKS_EVENT, onChange);
  };
}
function parseTicks(raw: string): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function ChecklistPage({ data, nicheName, proofRoute, funnel }: { data: ChecklistData; nicheName: string; proofRoute?: ProofRoute | null; funnel?: Funnel | null }) {
  const storageKey = `checklist-${data.niche}-${data.slug}`;
  const raw = useSyncExternalStore(subscribeTicks, () => readTicks(storageKey), () => '');
  const checked = useMemo(() => parseTicks(raw), [raw]);

  // What the last Reset cleared, so a mis-tap on it (it sits next to "Expand
  // all") can be undone. Kept until the next tick; nothing times out.
  const [cleared, setCleared] = useState<{ raw: string; count: number } | null>(null);

  // Read the saved ticks at click time, not from the last render, so two quick clicks never undo each other.
  const toggleItem = (id: string) => {
    const current = parseTicks(readTicks(storageKey));
    writeTicks(storageKey, { ...current, [id]: !current[id] });
    setCleared(null);
  };

  // Count only ids that are in this checklist: a tick saved for an item that
  // was later renamed or removed must not count toward "done".
  const doneIn = (items: ChecklistItem[]) => items.filter((i) => checked[i.id]).length;
  const totalItems = data.sections.reduce((sum, s) => sum + s.items.length, 0);
  const completedItems = data.sections.reduce((sum, s) => sum + doneIn(s.items), 0);
  const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const resetTicks = () => {
    setCleared({ raw: readTicks(storageKey), count: completedItems });
    writeTicks(storageKey, null);
  };
  const undoReset = () => {
    if (cleared) writeTicks(storageKey, parseTicks(cleared.raw));
    setCleared(null);
  };
  // One button that turns into "Undo reset" in place, so keyboard focus stays on it.
  const undoable = completedItems === 0 && cleared !== null;

  // Native <details>, first open, so the list works without JS (DESIGN-SPEC §9).
  // The open state is mirrored here (onToggle) only so "Expand all" can open the rest.
  const [open, setOpen] = useState<boolean[]>(() => data.sections.map((_, i) => i === 0));
  const allOpen = open.every(Boolean);
  const setAll = (value: boolean) => setOpen(data.sections.map(() => value));

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Checklists', href: '/checklists' },
        { label: nicheName, href: `/checklists/${data.niche}` },
        { label: data.title },
      ]} />

      <PageHero
        icon={TYPE_ICON.checklist}
        kicker={`${nicheName} · checklist`}
        title={data.title}
        badges={
          <>
            <Badge label={data.difficulty} variant="difficulty" />
            <Badge label={data.estimatedTime} />
          </>
        }
        figure={{ value: totalItems, label: 'items' }}
        diagram={diagramForNiche(data.niche)}
      />

      {data.intro && <p className="prose-ib text-lede mb-8">{data.intro}</p>}

      {/* Progress: directly above the sections it counts, with the count in words. */}
      <div className="mb-4" data-checklist-progress={completedItems}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-row text-t2 mb-2">
          <span>
            <span className="tnum text-t1 font-medium">{`${completedItems} of ${totalItems}`}</span> done
          </span>
          <span className="flex items-center gap-4">
            {data.sections.length > 1 && (
              <button type="button" onClick={() => setAll(!allOpen)} className="underline underline-offset-4 hover:text-t1">
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
            {(completedItems > 0 || undoable) && (
              <button
                type="button"
                onClick={undoable ? undoReset : resetTicks}
                className="underline underline-offset-4 hover:text-t1"
                title={undoable ? 'Tick again the items you just cleared' : 'Untick every item on this checklist'}
              >
                {undoable ? 'Undo reset' : 'Reset'}
              </button>
            )}
          </span>
          <span className="sr-only" aria-live="polite">
            {undoable ? `Unticked ${cleared.count} ${cleared.count === 1 ? 'item' : 'items'}. Press Undo reset to tick them again.` : ''}
          </span>
        </div>
        <div
          className="w-full bg-s1 rounded-full h-2"
          role="progressbar"
          aria-label="Checklist items done"
          aria-valuemin={0}
          aria-valuemax={totalItems}
          aria-valuenow={completedItems}
          aria-valuetext={`${completedItems} of ${totalItems} done`}
        >
          <div className="bg-t1 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-meta text-t3 mt-2">
          {data.sections.length > 1
            ? `Tick each step as you finish it. The count covers all ${data.sections.length} sections below.`
            : 'Tick each step as you finish it.'}
        </p>
      </div>

      {data.sections.map((section, si) => {
        const done = doneIn(section.items);
        const sectionDone = done === section.items.length;
        return (
          <details
            key={si}
            className="panel"
            open={open[si]}
            onToggle={(e) => {
              const isOpen = e.currentTarget.open;
              setOpen((prev) => (prev[si] === isOpen ? prev : prev.map((v, i) => (i === si ? isOpen : v))));
            }}
          >
            <summary>
              <span className="folio">{String(si + 1).padStart(2, '0')}</span>
              <span>{section.title}</span>
              <span className={`text-meta tnum whitespace-nowrap ${sectionDone ? 'text-ok' : 'text-t3'}`}>
                {`${done}/${section.items.length} done`}
              </span>
              <Icon name="chevron" size={16} />
            </summary>
            <div className="panel-body space-y-3">
              {section.items.map((item) => {
                const isChecked = !!checked[item.id];
                const inputId = `${storageKey}-${item.id}`;
                return (
                  // Only the checkbox and the task line toggle the item: the
                  // whole card used to be one <label>, so selecting or tapping
                  // the Why/How text to read it ticked the item off.
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 p-4 border rounded-lg transition-colors ${
                      isChecked ? 'bg-ok-dim border-ok/30' : 'bg-s0 border-b1'
                    }`}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleItem(item.id)}
                      className="h-5 w-5 rounded border-b2 mt-0.5 shrink-0 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <label htmlFor={inputId} className={`font-medium cursor-pointer ${isChecked ? 'line-through text-t3' : 'text-t1'}`}>
                          {item.task}
                        </label>
                        <Badge label={item.priority} variant={PRIORITY_VARIANT[item.priority] ?? 'neutral'} title={`Priority: ${item.priority}`} />
                      </div>
                      <p className="mt-2 prose-ib text-row">
                        <b className="text-t3 font-medium not-italic">Why — </b>
                        {item.why}
                      </p>
                      <p className="mt-1 prose-ib text-row">
                        <b className="text-t3 font-medium not-italic">How — </b>
                        {item.howTo}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}

      {totalItems > 0 && completedItems === totalItems && (
        <div className="mt-8 bg-ok-dim border border-ok/30 rounded-lg p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2 text-ok">
            <Icon name="check" size={28} />
            <span className="text-kicker uppercase">All done</span>
          </div>
          <p className="text-ok mt-1">You&apos;ve completed every item on this checklist.</p>
        </div>
      )}

      {/* After the list, so the progress bar never reads as this tool's progress. */}
      {funnel
        ? <PageFunnel funnel={funnel} niche={data.niche} />
        : proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      <EditorialNote reviewed={(data as unknown as { reviewed?: boolean }).reviewed} />
    </article>
  );
}
