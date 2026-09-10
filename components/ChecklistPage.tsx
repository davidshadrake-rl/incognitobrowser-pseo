'use client';

import { useState, useEffect } from 'react';
import { Badge } from './ui/Badge';
import { Icon } from './ui/Icon';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { EditorialNote } from './EditorialNote';
import { CheckYoursNow } from './CheckYoursNow';
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

export function ChecklistPage({ data, nicheName, proofRoute }: { data: ChecklistData; nicheName: string; proofRoute?: ProofRoute | null }) {
  const storageKey = `checklist-${data.niche}-${data.slug}`;
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) setChecked(JSON.parse(saved));
  }, [storageKey]);

  const toggleItem = (id: string) => {
    const updated = { ...checked, [id]: !checked[id] };
    setChecked(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
  };

  const totalItems = data.sections.reduce((sum, s) => sum + s.items.length, 0);
  const completedItems = Object.values(checked).filter(Boolean).length;
  const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

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
            <Badge label={data.difficulty} variant={data.difficulty} />
            <Badge label={data.estimatedTime} />
            <Badge label={`${completedItems}/${totalItems} completed`} />
          </>
        }
        figure={{ value: totalItems, label: 'items' }}
        diagram={diagramForNiche(data.niche)}
      />

      {data.intro && <p className="prose-ib text-lede mb-8">{data.intro}</p>}

      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex justify-between text-row text-t2 mb-1">
          <span>Progress</span>
          <span className="tnum">{progress}%</span>
        </div>
        <div className="w-full bg-s1 rounded-full h-3">
          <div
            className="bg-t1 h-3 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Sections: native <details>, first open — no JS collapse (DESIGN-SPEC §9). */}
      {data.sections.map((section, si) => (
        <details key={si} className="panel" open={si === 0}>
          <summary>
            <span className="folio">{String(si + 1).padStart(2, '0')}</span>
            <span>{section.title}</span>
            <span className="text-meta text-t3">({section.items.length})</span>
            <Icon name="chevron" size={16} />
          </summary>
          <div className="panel-body space-y-3">
            {section.items.map((item) => {
              const isChecked = !!checked[item.id];
              return (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                    isChecked ? 'bg-ok-dim border-ok/30' : 'bg-s0 border-b1'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleItem(item.id)}
                    className="h-5 w-5 rounded border-b2 mt-0.5 shrink-0 cursor-pointer"
                    aria-label={`Mark ${item.task} as done`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={`font-medium ${isChecked ? 'line-through text-t3' : 'text-t1'}`}>
                        {item.task}
                      </span>
                      <Badge label={item.priority} variant={item.priority} />
                    </span>
                    <span className="block mt-2 prose-ib text-row">
                      <b className="text-t3 font-medium not-italic">Why — </b>
                      {item.why}
                    </span>
                    <span className="block mt-1 prose-ib text-row">
                      <b className="text-t3 font-medium not-italic">How — </b>
                      {item.howTo}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </details>
      ))}

      {progress === 100 && (
        <div className="mt-8 bg-ok-dim border border-ok/30 rounded-lg p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2 text-ok">
            <Icon name="check" size={28} />
            <span className="text-kicker uppercase">All done</span>
          </div>
          <p className="text-ok mt-1">You&apos;ve completed every item on this checklist.</p>
        </div>
      )}

      <EditorialNote reviewed={(data as unknown as { reviewed?: boolean }).reviewed} />
    </article>
  );
}
