/**
 * Template placeholder substitution tests.
 *
 * Regression guard for these bugs in TemplatePage and its data:
 *  - fillTemplate once used a {{KEY}} regex against content that uses [KEY]
 *    brackets, so nothing the visitor typed reached the letter;
 *  - only [KEY] / [UPPER_SNAKE] spots were fields, but 28 templates write
 *    their spots in Title Case or with spaces ([Your Name], [Date],
 *    [RECIPIENT NAME]). Those were neither fillable, highlighted nor counted,
 *    so the counter could read "All fields filled in" over a letter still
 *    full of brackets;
 *  - boxes were keyed by spot text, so a placeholder matching two spellings
 *    ([Your Email] by key, [Your Email Address] by label) showed two boxes
 *    with one label, each filling half the letter;
 *  - a hint ("Customer ID: [If applicable]") was its own label, so the box
 *    read "If applicable" and didn't say what to type;
 *  - 22 request letters wrote one [City, State, ZIP Code] under both the
 *    sender's and the company's address, so typing your own city wrote it
 *    into the company's address too.
 *
 * These tests call the component's own exported functions, so they exercise
 * the code the page runs, not a copy of it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TemplatePage,
  fieldKeyOf,
  fillTemplate,
  templateFields,
  unfilledFields,
  type TemplateSection,
} from '../components/TemplatePage';

interface Template {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  description: string;
  templateType: string;
  sections: TemplateSection[];
  useCases: string[];
}

function loadAllTemplates(): Template[] {
  const root = path.join(__dirname, '..', 'data', 'templates');
  const out: Template[] = [];
  for (const niche of fs.readdirSync(root)) {
    const nicheDir = path.join(root, niche);
    if (!fs.statSync(nicheDir).isDirectory()) continue;
    for (const file of fs.readdirSync(nicheDir)) {
      if (!file.endsWith('.json')) continue;
      out.push(JSON.parse(fs.readFileSync(path.join(nicheDir, file), 'utf-8')));
    }
  }
  return out;
}

/** Every bracketed span in some text, checkbox marks included: the test's own reading, independent of the component's. */
function bracketsIn(text: string): string[] {
  return text.match(/\[[^[\]\n]+\]/g) || [];
}
/** Checkbox marks such as "[ ]" and "[✓]" have fewer than two letters or digits. */
const isCheckbox = (span: string) => span.replace(/[^A-Za-z0-9]/g, '').length < 2;

const section = (content: string, placeholders: TemplateSection['placeholders'] = []): TemplateSection =>
  ({ heading: 'Letter', content, placeholders });

/** Fill some text through the boxes templateFields gives it, as the page does. */
const fill = (content: string, values: Record<string, string>, placeholders: TemplateSection['placeholders'] = []) =>
  fillTemplate(content, values, templateFields([section(content, placeholders)]));

/** A spot that only says how to answer, not what: the test's own reading, independent of the component's. */
const isBareHint = (label: string) => /^(if\b.*|specify|number|optional)$/i.test(label.trim());

/** Paragraphs of a section with a city / ZIP line in them: a letter's sender and recipient address blocks. */
const addressBlocks = (content: string) =>
  content.split(/\n[ \t]*\n/).filter((p) => bracketsIn(p).some((b) => /\bcity\b|\bzip\b|postcode|postal code/i.test(b)));

describe('fillTemplate', () => {
  it('substitutes a single placeholder value', () => {
    expect(fill('Email: [YOUR_EMAIL]', { youremail: 'a@b.com' })).toBe('Email: a@b.com');
  });

  it('substitutes all occurrences of the same spot (global replace)', () => {
    expect(fill('[X1] and [X1] and [X1]', { x1: 'hi' })).toBe('hi and hi and hi');
  });

  it('fills Title Case, spaced and snake_case spellings of one spot from one value', () => {
    const out = fill('[Your Name] / [YOUR NAME] / [YOUR_NAME] / [your_name]', { yourname: 'Ann' });
    expect(out).toBe('Ann / Ann / Ann / Ann');
  });

  it('fills every spelling a declared placeholder matches, by key or by label, from its one box', () => {
    const placeholders = [{ key: 'your_email', label: 'Your Email Address', defaultValue: '' }];
    expect(fill('[Your Email]\nWrite to [Your Email Address]', { youremail: 'a@b.com' }, placeholders))
      .toBe('a@b.com\nWrite to a@b.com');
  });

  it('fills spots written with punctuation', () => {
    expect(fill('[City, State, ZIP Code]', { [fieldKeyOf('City, State, ZIP Code')]: 'Austin, TX 78701' }))
      .toBe('Austin, TX 78701');
  });

  it('keeps the spot, as written, when the value is empty or only spaces', () => {
    expect(fill('Hello [Recipient Name]', { recipientname: '' })).toBe('Hello [Recipient Name]');
    expect(fill('Hello [Recipient Name]', { recipientname: '   ' })).toBe('Hello [Recipient Name]');
    expect(fill('Hello [Recipient Name]', {})).toBe('Hello [Recipient Name]');
  });

  it('keeps a spot none of the boxes fills as written', () => {
    expect(fillTemplate('Hello [Recipient Name]', { recipientname: 'Ann' }, [])).toBe('Hello [Recipient Name]');
  });

  it('copies a typed "$&" or "$1" as typed, not as a replacement pattern', () => {
    expect(fill('Pay [Amount]', { amount: '$&' })).toBe('Pay $&');
    expect(fill('Pay [Amount]', { amount: '$1 and $$' })).toBe('Pay $1 and $$');
  });

  it('leaves checkbox marks alone', () => {
    expect(fill('[ ] Access [✓] Delete [x] Correct', { x: 'no' })).toBe('[ ] Access [✓] Delete [x] Correct');
  });

  it('does not substitute {{KEY}} mustache syntax (old broken format)', () => {
    expect(fill('{{YOUR_EMAIL}}', { youremail: 'a@b.com' })).toBe('{{YOUR_EMAIL}}');
  });

  it('never fills a spot from an inherited object key', () => {
    expect(fill('[Constructor]', {})).toBe('[Constructor]');
  });
});

describe('templateFields', () => {
  it('gives every spot in the text a field, in reading order, whatever its spelling', () => {
    const fields = templateFields([section('[DATE]\n[Recipient Name]\n[City, State, ZIP Code]\nDear [RECIPIENT NAME],\n[OS]')]);
    expect(fields.map((f) => f.key)).toEqual(['date', 'recipientname', 'citystatezipcode', 'os']);
    expect(fields.map((f) => f.label)).toEqual(['Date', 'Recipient Name', 'City, State, ZIP Code', 'OS']);
    expect(fields.find((f) => f.key === 'recipientname')!.uses).toBe(2);
  });

  it('matches a declared placeholder by key or label, ignoring case and punctuation', () => {
    const fields = templateFields([section('[Your Name]\n[Your Address]\n[YOUR_EMAIL]\n[Company Name]', [
      { key: 'your_name', label: 'Your Full Name', defaultValue: '[Your Name]' },
      { key: 'addr', label: 'Your Address', defaultValue: '123 Main St' },
      { key: 'your_email', label: 'Email', defaultValue: 'you@example.com' },
      { key: 'company', label: 'Company Name (e.g., Google, Mozilla, Apple)', defaultValue: '' },
    ])]);
    expect(fields).toEqual([
      { key: 'yourname', label: 'Your Full Name', example: 'Your Name', uses: 1, names: ['yourname'] },
      { key: 'addr', label: 'Your Address', example: '123 Main St', uses: 1, names: ['youraddress'] },
      { key: 'youremail', label: 'Email', example: 'you@example.com', uses: 1, names: ['youremail'] },
      { key: 'company', label: 'Company Name (e.g., Google, Mozilla, Apple)', example: '', uses: 1, names: ['companyname'] },
    ]);
  });

  it('gives one box to every spot a declared placeholder matches, by key or by label', () => {
    // data-breach, device-fingerprinting and phishing showed two "Your Email
    // Address" (or "Your Position/Department") boxes, each filling one spelling.
    const fields = templateFields([section('[Your Email]\n[Your Position]\n\nReply to [Your Email Address]\n[Your Position/Department]', [
      { key: 'yourEmail', label: 'Your Email Address', defaultValue: '' },
      { key: 'your_position', label: 'Your Position/Department', defaultValue: '' },
    ])]);
    expect(fields).toEqual([
      { key: 'youremail', label: 'Your Email Address', example: '', uses: 2, names: ['youremail', 'youremailaddress'] },
      { key: 'yourposition', label: 'Your Position/Department', example: '', uses: 2, names: ['yourposition', 'yourpositiondepartment'] },
    ]);
  });

  it('labels a hint from the words before it on its line, with the hint as its example', () => {
    const fields = templateFields([section([
      'Account Number: [Last 4 digits only]',
      'Customer ID: [If applicable]',
      '- Patient ID/Account Number: [IF KNOWN]',
      '☐ Additional verification: [SPECIFY]',
      'Please reply within [Number] days.',
      'Account Holder: [Your Name]',
    ].join('\n'))]);
    expect(fields.map((f) => [f.label, f.example])).toEqual([
      ['Account Number', 'Last 4 digits only'],
      ['Customer ID', 'If applicable'],
      ['Patient ID/Account Number', 'If Known'],
      ['Additional verification', 'Specify'],
      ['Number', ''], // nothing before it on its line says what it is
      ['Your Name', ''], // names itself, so the words before it don't
    ]);
  });

  it('gives one hint under two labels two boxes', () => {
    const content = 'User ID: [If Known]\nAccount Number: [If Known]';
    const fields = templateFields([section(content)]);
    expect(fields.map((f) => f.label)).toEqual(['User ID', 'Account Number']);
    expect(fillTemplate(content, { [fields[0].key]: 'u-42' }, fields)).toBe('User ID: u-42\nAccount Number: [If Known]');
  });

  it('gives a declared placeholder the text never uses no field', () => {
    const fields = templateFields([section('Dear [Recipient Name],', [
      { key: 'unused_field', label: 'Something Else', defaultValue: 'x' },
    ])]);
    expect(fields.map((f) => f.key)).toEqual(['recipientname']);
  });

  it('makes no field for checkbox marks', () => {
    expect(templateFields([section('[ ] Access\n[✓] Delete\n[x] Correct')])).toEqual([]);
  });
});

describe('unfilledFields', () => {
  it('counts a field as empty until it has a non-blank value', () => {
    const fields = templateFields([section('[Your Name] [Date]')]);
    expect(unfilledFields(fields, {}).map((f) => f.key)).toEqual(['yourname', 'date']);
    expect(unfilledFields(fields, { yourname: '  ', date: 'today' }).map((f) => f.key)).toEqual(['yourname']);
    expect(unfilledFields(fields, { yourname: 'Ann', date: 'today' })).toEqual([]);
  });
});

describe('Every template in data/ is fully substitutable', () => {
  const templates = loadAllTemplates();

  it('loads at least a few template files', () => {
    expect(templates.length).toBeGreaterThan(10);
  });

  it('finds the Title Case spots the old [UPPER_SNAKE]-only scan missed', () => {
    // This letter showed one field ("Os") and read "All fields filled in"
    // once it was typed in, over [Your Name], [Date], [Company Name] and more.
    const t = templates.find((x) => x.slug === 'browser-privacy-request-letter-template')!;
    const fields = templateFields(t.sections);
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(fields.length).toBe(19);
    expect(byKey.get('yourname')?.label).toBe('Your Full Name'); // declared as your_name
    expect(byKey.get('youraddress')?.label).toBe('Your Address'); // declared as your_address
    expect(byKey.get('signaturename')?.label).toBe('Your Printed Name'); // declared as signature_name, matched by label
    expect(byKey.get('companycitystatezipcode')?.label).toBe('Company City, State, ZIP Code');
    for (const spot of ['Date', 'Company Name', 'City, State, ZIP Code', 'Your Signature', 'OS']) {
      expect(byKey.has(fieldKeyOf(spot)), spot).toBe(true);
    }
  });

  it('labels the online-banking hints by what they ask for', () => {
    const t = templates.find((x) => x.slug === 'online-banking-security-request-letter-template')!;
    const labelled = templateFields(t.sections).map((f) => [f.label, f.example]);
    expect(labelled).toContainEqual(['Customer ID', 'If applicable']);
    expect(labelled).toContainEqual(['Account Number', 'Last 4 digits only']);
  });

  it('checks the two address blocks of every request letter that has them', () => {
    // The 22 letters that once shared a city spot between the two blocks.
    const letters = templates.filter((t) => t.sections.some((s) => addressBlocks(s.content).length >= 2));
    expect(letters.length).toBeGreaterThanOrEqual(22);
  });

  for (const t of templates) {
    const fields = templateFields(t.sections);
    const spots = t.sections.flatMap((s) => bracketsIn(s.content)).filter((b) => !isCheckbox(b));

    it(`${t.niche}/${t.slug}: every bracketed spot in the text has a field`, () => {
      // The boxes between them fill each spot once; the next test shows that
      // with all of them filled, no spot is left.
      expect(fields.reduce((n, f) => n + f.uses, 0)).toBe(spots.length);
    });

    it(`${t.niche}/${t.slug}: "All fields filled in" only when no bracketed spot is left`, () => {
      // Everything filled: nothing unfilled, and no spot left in the letter.
      const all = Object.fromEntries(fields.map((f) => [f.key, `USER_${f.key}`]));
      expect(unfilledFields(fields, all)).toEqual([]);
      for (const s of t.sections) {
        expect(bracketsIn(fillTemplate(s.content, all, fields)).filter((b) => !isCheckbox(b))).toEqual([]);
      }
      // Any one field left empty: it is counted, and its spots, and only its, are still in the letter.
      for (const skip of fields) {
        const partial = { ...all, [skip.key]: '' };
        expect(unfilledFields(fields, partial).map((f) => f.key)).toEqual([skip.key]);
        const text = t.sections.map((s) => fillTemplate(s.content, partial, fields)).join('\n');
        expect(bracketsIn(text).filter((b) => !isCheckbox(b)).length, `${skip.key} still bracketed`).toBe(skip.uses);
      }
    });

    it(`${t.niche}/${t.slug}: no two boxes share a label, and every box says what to type`, () => {
      const labels = fields.map((f) => f.label.toLowerCase());
      expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
      expect(fields.map((f) => f.label).filter(isBareHint)).toEqual([]);
    });

    const blocks = t.sections.map((s) => addressBlocks(s.content)).find((b) => b.length >= 2);
    if (blocks) {
      it(`${t.niche}/${t.slug}: the sender's and the recipient's address blocks share no box`, () => {
        // Each box gets its own mark; a mark in both blocks is a value typed
        // for one address landing in the other.
        const marked = Object.fromEntries(fields.map((f, i) => [f.key, `<${i}>`]));
        const boxesIn = (block: string): string[] => fillTemplate(block, marked, fields).match(/<\d+>/g) ?? [];
        const [sender, ...others] = blocks.map(boxesIn);
        for (const recipient of others) {
          const shared = sender.filter((m) => recipient.includes(m));
          expect(shared.map((m) => fields[Number(m.slice(1, -1))].label)).toEqual([]);
        }
      });
    }

    it(`${t.niche}/${t.slug}: the page highlights every unfilled spot and counts every field`, () => {
      const html = renderToStaticMarkup(React.createElement(TemplatePage, { data: t, nicheName: t.niche, proofRoute: null }));
      expect((html.match(/<mark\b/g) || []).length).toBe(spots.length);
      if (fields.length > 0) {
        expect(html).toContain(`data-empty-fields="${fields.length}"`);
        expect(html).not.toContain('All fields filled in');
        expect((html.match(/<input\b/g) || []).length).toBe(fields.length);
      } else {
        expect(html).not.toContain('Customize your template');
        expect(html).not.toContain('data-empty-fields');
      }
    });
  }
});

// Informational: tracks data-quality debt. Spots the JSON's placeholders
// don't describe still get a field (labelled from the spot's own text), but
// content generation should declare everything so labels and examples are
// human-written.
describe('Template data quality (informational)', () => {
  const templates = loadAllTemplates();

  it('reports spots with no declared placeholder', () => {
    const orphanReport: string[] = [];
    for (const t of templates) {
      const declared = t.sections.flatMap((s) => s.placeholders || []);
      const described = new Set(declared.flatMap((p) => [fieldKeyOf(p.key), fieldKeyOf(p.label)]));
      const orphans = new Set(templateFields(t.sections).filter((f) => !described.has(f.key)).map((f) => f.label));
      if (orphans.size > 0) orphanReport.push(`${t.niche}/${t.slug}: ${Array.from(orphans).join(', ')}`);
    }
    // Non-blocking — just surface the debt in test output for visibility.
    if (orphanReport.length > 0) {
      console.warn(`\n[data-quality] ${orphanReport.length} templates with undeclared spots:\n  ${orphanReport.join('\n  ')}\n`);
    }
    expect(orphanReport.length).toBeGreaterThanOrEqual(0); // always passes
  });
});
