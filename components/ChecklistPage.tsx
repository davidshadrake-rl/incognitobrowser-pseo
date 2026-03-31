'use client';

import { useState, useEffect } from 'react';
import { Badge } from './ui/Badge';
import { Breadcrumbs } from './ui/Breadcrumbs';

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

export function ChecklistPage({ data, nicheName }: { data: ChecklistData; nicheName: string }) {
  const storageKey = `checklist-${data.niche}-${data.slug}`;
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

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

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge label={data.difficulty} variant={data.difficulty} />
          <Badge label={data.estimatedTime} />
          <Badge label={`${completedItems}/${totalItems} completed`} />
        </div>
        {data.intro && <p className="text-[#B8B8D4]">{data.intro}</p>}
      </header>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex justify-between text-sm text-[#B8B8D4] mb-1">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-3">
          <div
            className="bg-white h-3 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      {data.sections.map((section, si) => (
        <section key={si} className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-white/10">{section.title}</h2>
          <div className="space-y-3">
            {section.items.map((item) => (
              <div
                key={item.id}
                className={`border rounded-lg transition-all ${
                  checked[item.id] ? 'bg-green-500/10 border-green-500/20' : 'bg-[#0a0a0a] border-white/10'
                }`}
              >
                <div className="flex items-start p-4">
                  <input
                    type="checkbox"
                    checked={!!checked[item.id]}
                    onChange={() => toggleItem(item.id)}
                    className="mt-1 h-5 w-5 rounded border-white/30"
                  />
                  <div className="ml-3 flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${checked[item.id] ? 'line-through text-white/40' : 'text-white'}`}>
                        {item.task}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge label={item.priority} variant={item.priority} />
                        <button
                          onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                          className="text-white/30 hover:text-white/60"
                        >
                          <svg className={`w-5 h-5 transition-transform ${expandedItem === item.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {expandedItem === item.id && (
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                          <strong className="text-blue-400">Why:</strong>
                          <span className="text-blue-300 ml-1">{item.why}</span>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded p-3">
                          <strong className="text-white">How to:</strong>
                          <span className="text-[#B8B8D4] ml-1">{item.howTo}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {progress === 100 && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
          <div className="text-4xl mb-2">&#127881;</div>
          <h3 className="text-lg font-semibold text-green-400">All done!</h3>
          <p className="text-green-300 mt-1">You&apos;ve completed every item on this checklist.</p>
        </div>
      )}
    </article>
  );
}
