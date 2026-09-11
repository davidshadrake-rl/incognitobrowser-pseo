'use client';

import { useId, useState, type ReactNode } from 'react';
import { Badge } from './ui/Badge';
import { Icon } from './ui/Icon';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { EditorialNote } from './EditorialNote';
import { CheckYoursNow } from './CheckYoursNow';
import { TYPE_ICON, diagramForNiche } from '@/lib/visuals';
import type { ProofRoute } from '@/lib/proof-route';

interface Placeholder {
  key: string;
  label: string;
  defaultValue: string;
}

export interface TemplateSection {
  heading: string;
  content: string;
  placeholders?: Placeholder[];
}

interface TemplateData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  description: string;
  templateType: string;
  sections: TemplateSection[];
  useCases: string[];
}

/** One box in the Customize panel, filling every spot in the text that names the same thing. */
export interface TemplateField {
  /**
   * What the box's value is stored under: the key of the placeholder the JSON
   * declares for its spots, or else the spot's own name, as fieldKeyOf gives it.
   */
  key: string;
  label: string;
  /** Grey example text for the empty box. */
  example: string;
  /** How many spots in the text this box fills. */
  uses: number;
  /** The names (as fieldKeyOf gives them) of the spots this box fills: more than one when a placeholder matches two spellings. */
  names: string[];
}

// A fillable spot is any bracketed span on one line: [YOUR_NAME], [Your Name],
// [RECIPIENT NAME], [City, State, ZIP Code]. The templates use all of these.
const SPOT = /\[([^[\]\n]{1,120})\]/g;

/** A spot's name with case, spaces and punctuation dropped, so [Your Name], [YOUR_NAME] and [your name] are all "yourname". */
export function fieldKeyOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A spot that says how to answer but not what: [If applicable], [If Known],
// [Specify], [Number], [Last 4 digits only].
const HINT = /^(?:if\b.*|specify|number|optional|last \d+ digits(?: only)?)$/i;

// "Customer ID: " written before a spot, from the start of its line; one
// list bullet, dash or checkbox mark in front of it is not part of it.
const LINE_LABEL = /^[ \t]*(?:[^\w\s:[\]][ \t]*)?([^:[\]]{1,40}):[ \t]*$/;

interface Spot {
  /** Where the spot starts in the text. */
  at: number;
  /** The spot as written, brackets included. */
  text: string;
  /** What the spot stands for: its own words, or for a hint, the label before it on its line ("Customer ID"). */
  name: string;
  /** The hint's own words ("If applicable"), when the name came from the line label. */
  hint?: string;
}

/**
 * The fillable spots in some text, in reading order. Checkbox marks ("[ ]",
 * "[x]", a bracketed tick) are part of the letter, not spots to fill.
 */
function spotsIn(content: string): Spot[] {
  const spots: Spot[] = [];
  for (const m of content.matchAll(SPOT)) {
    if (fieldKeyOf(m[1]).length < 2) continue;
    const at = m.index ?? 0;
    const words = m[1].trim();
    const lineLabel = HINT.test(words)
      ? content.slice(content.lastIndexOf('\n', at - 1) + 1, at).match(LINE_LABEL)?.[1].trim()
      : undefined;
    spots.push(lineLabel && /[A-Za-z]/.test(lineLabel)
      ? { at, text: m[0], name: lineLabel, hint: words }
      : { at, text: m[0], name: m[1] });
  }
  return spots;
}

// When an all-caps spot name is re-cased for its label, these keep their capitals.
const ACRONYMS = new Set(['os', 'id', 'dob', 'zip', 'kyc', 'url', 'ip', 'isp', 'ssn', 'dpo', 'hr', 'foia', 'vpn', 'gdpr', 'ccpa', 'sms', 'pin', 'dns', 'uk', 'eu']);

/** A box label for a spot the JSON doesn't describe, from the spot's own text: "RECIPIENT_NAME" → "Recipient Name", "OS" stays "OS". */
function labelOf(spot: string): string {
  const text = spot.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (text !== text.toUpperCase()) return text.charAt(0).toUpperCase() + text.slice(1);
  return text.replace(/[A-Z]+/g, (w) => (ACRONYMS.has(w.toLowerCase()) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
}

// The JSON's example value, for the field's grey placeholder text. Some are
// written as "[Your Name]"; the brackets read as a token, not an example.
function exampleText(defaultValue: string) {
  return defaultValue.replace(/^\[(.*)\]$/, '$1');
}

/**
 * The boxes a template needs: one per thing its spots name, in reading order.
 *
 * A spot the JSON declares a placeholder for takes that placeholder's label
 * and example. The JSON is matched by key or label, ignoring case and
 * punctuation, so `your_address` / "Your Address" finds [Your Address] and
 * `your_name` finds [YOUR_NAME]. Every spot one placeholder matches shares
 * its box: with `your_email` labelled "Your Email Address", [Your Email] and
 * [Your Email Address] are one box, not two boxes with the same label that
 * each fill half the letter. Declared placeholders the text never uses get
 * no box, since typing in one would change nothing.
 *
 * A spot the JSON doesn't declare gets a box of its own, labelled from its
 * own words. A hint such as "Customer ID: [If applicable]" is labelled from
 * the words before it on its line, with the hint as its example.
 */
export function templateFields(sections: TemplateSection[]): TemplateField[] {
  const declared = sections.flatMap((s) => s.placeholders || []);
  // A key match wins over a label match; a label may carry a hint in brackets
  // ("Company Name (e.g., Google, Mozilla, Apple)") that the text's spot doesn't.
  const declaredFor = (name: string) => declared.find((p) => fieldKeyOf(p.key) === name)
    ?? declared.find((p) => fieldKeyOf(p.label) === name || fieldKeyOf(p.label.replace(/\s*\(.*\)\s*$/, '')) === name);
  const fields = new Map<string, TemplateField>();
  for (const section of sections) {
    for (const spot of spotsIn(section.content)) {
      const name = fieldKeyOf(spot.name);
      const p = declaredFor(name);
      // An undeclared name never equals a declared key (it would have matched
      // that placeholder), so the two kinds of box can't collide.
      const key = p ? fieldKeyOf(p.key) : name;
      const known = fields.get(key);
      if (known) {
        known.uses += 1;
        if (!known.names.includes(name)) known.names.push(name);
        continue;
      }
      fields.set(key, p
        ? { key, label: p.label, example: exampleText(p.defaultValue), uses: 1, names: [name] }
        : { key, label: labelOf(spot.name), example: spot.hint ? labelOf(spot.hint) : '', uses: 1, names: [name] });
    }
  }
  return Array.from(fields.values());
}

/** What the visitor typed for a field, or '' if nothing (or only spaces) yet, or no field. */
function valueFor(values: Record<string, string>, key: string | undefined): string {
  // Own keys only: a spot called [Constructor] must not pick up Object.prototype.constructor.
  const v = key !== undefined && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
  return v.trim() ? v : '';
}

/** Fields the visitor hasn't filled in yet. Every spot in the text has a field, so none left means no brackets left. */
export function unfilledFields(fields: TemplateField[], values: Record<string, string>): TemplateField[] {
  return fields.filter((f) => !valueFor(values, f.key));
}

/** A run of the text as written, or a spot with what the visitor typed in its box ('' while the box is empty). */
type Piece = string | { spot: Spot; value: string };

/** The text cut at its spots, each spot paired with its box's value. The preview and the copied text both come from this. */
function piecesOf(content: string, values: Record<string, string>, fields: TemplateField[]): Piece[] {
  const keyByName = new Map(fields.flatMap((f) => f.names.map((name) => [name, f.key] as const)));
  const pieces: Piece[] = [];
  let last = 0;
  for (const spot of spotsIn(content)) {
    pieces.push(content.slice(last, spot.at), { spot, value: valueFor(values, keyByName.get(fieldKeyOf(spot.name))) });
    last = spot.at + spot.text.length;
  }
  pieces.push(content.slice(last));
  return pieces;
}

/**
 * Put the visitor's values into the text, using the boxes templateFields
 * gave for it. A spot left empty keeps its brackets, as written, so it
 * still stands out in the copied letter.
 */
export function fillTemplate(content: string, values: Record<string, string>, fields: TemplateField[]): string {
  return piecesOf(content, values, fields).map((p) => (typeof p === 'string' ? p : p.value || p.spot.text)).join('');
}

export function TemplatePage({ data, nicheName, proofRoute }: { data: TemplateData; nicheName: string; proofRoute?: ProofRoute | null }) {
  const fields = templateFields(data.sections);

  // Fields start empty, with the JSON's example as grey placeholder text.
  // Pre-filled examples looked like answers, so a letter went out signed
  // "Your Full Name" and dated "MM/DD/YYYY" without anything flagging it.
  const [values, setValues] = useState<Record<string, string>>({});
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const idPrefix = useId();

  const emptyCount = unfilledFields(fields, values).length;

  // The preview does the same substitution as fillTemplate, but an unfilled
  // spot is drawn highlighted so it's easy to spot before copying. Spots are
  // found in the template's own text, so a value the visitor types that
  // happens to contain brackets is never highlighted.
  const renderPreview = (content: string): ReactNode[] =>
    piecesOf(content, values, fields).map((piece, i) => (typeof piece === 'string' ? piece : piece.value || (
      <mark key={i} className="bg-warn-dim text-warn rounded-[2px] px-0.5">{piece.spot.text}</mark>
    )));

  const getFullText = () => {
    return data.sections.map(s => `${s.heading}\n\n${fillTemplate(s.content, values, fields)}`).join('\n\n---\n\n');
  };

  const handleCopy = async () => {
    const text = getFullText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts or older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        try {
          ta.select();
          // execCommand reports a refused copy by returning false, not by throwing.
          if (!document.execCommand('copy')) throw new Error('copy refused');
        } finally {
          document.body.removeChild(ta);
        }
      }
      setCopyState('copied');
      setTimeout(() => setCopyState(s => (s === 'copied' ? 'idle' : s)), 2000);
    } catch {
      // Permission denied or no clipboard at all. This used to fail silently,
      // which looked like the button did nothing; now the page says so.
      setCopyState('failed');
    }
  };

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Templates', href: '/templates' },
        { label: nicheName, href: `/templates/${data.niche}` },
        { label: data.title },
      ]} />

      <PageHero
        icon={TYPE_ICON.template}
        kicker={`${nicheName} · template`}
        title={data.title}
        badges={
          <>
            <Badge label={data.templateType} />
            <Badge label={`${data.sections.length} sections`} />
          </>
        }
        diagram={diagramForNiche(data.niche)}
      />

      <p className="prose-ib text-lede mb-8">{data.description}</p>

      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      {fields.length > 0 && (
        <div className="bg-s0 border border-b1 rounded-[12px] p-5 mb-8">
          <h2 className="font-mono text-h3 font-semibold text-t1 mb-1">Customize your template</h2>
          <p className="text-meta text-t3 mb-3">What you type here fills in the template below. Anything you leave empty stays in [BRACKETS], highlighted, so you can spot it.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {fields.map(f => {
              const fieldId = `${idPrefix}-${f.key}`;
              return (
                <div key={f.key}>
                  <label htmlFor={fieldId} className="block text-row font-medium text-t2 mb-1">{f.label}</label>
                  <input
                    id={fieldId}
                    type="text"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    placeholder={f.example || undefined}
                    aria-describedby={f.uses > 1 ? `${fieldId}-uses` : undefined}
                    className="w-full px-3 py-2 rounded-[8px] text-row"
                  />
                  {/* A box can fill several spots (your name above the letter and again under
                      the signature); saying so shows one value lands in all of them. */}
                  {f.uses > 1 && <p id={`${fieldId}-uses`} className="text-meta text-t3 mt-1">Fills {f.uses} places in the template.</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="font-mono text-h2 font-semibold text-t1">Template preview</h2>
          <div className="flex items-center gap-3 flex-wrap">
            {fields.length > 0 && (
              <span className={`text-meta ${emptyCount > 0 ? 'text-warn' : 'text-t3'}`} data-empty-fields={emptyCount}>
                {emptyCount === 0
                  ? 'All fields filled in'
                  : `${emptyCount} of ${fields.length} ${fields.length === 1 ? 'field' : 'fields'} still empty`}
              </span>
            )}
            <button type="button" onClick={handleCopy} className="btn-primary text-xs">
              {copyState === 'copied' ? 'Copied' : 'Copy to clipboard'}
            </button>
            <span role="status" className="sr-only">{copyState === 'copied' ? 'Copied to clipboard' : ''}</span>
          </div>
        </div>
        {copyState === 'failed' && (
          <p role="alert" className="text-row text-danger mb-3">
            Your browser didn&rsquo;t allow the copy. Select the text below and copy it yourself.
          </p>
        )}
        <div className="border border-b1 rounded-[12px] divide-y divide-hair bg-s0">
          {data.sections.map((section, i) => (
            <div key={i} className="p-5">
              <h3 className="text-kicker uppercase text-t3 mb-2">{section.heading}</h3>
              <div className="prose-ib text-[15px] whitespace-pre-wrap">
                {renderPreview(section.content)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.useCases.length > 0 && (
        <section className="bg-s0 border border-b1 rounded-[16px] p-5">
          <h2 className="font-mono text-h3 font-semibold text-t1 mb-3">When to use this template</h2>
          <ul className="space-y-2">
            {data.useCases.map((uc, i) => (
              <li key={i} className="flex items-start gap-2 prose-ib text-row">
                <Icon name="check" size={14} className="text-t3 mt-0.5 shrink-0" />
                {uc}
              </li>
            ))}
          </ul>
        </section>
      )}

      <EditorialNote reviewed={(data as unknown as { reviewed?: boolean }).reviewed} />
    </article>
  );
}
