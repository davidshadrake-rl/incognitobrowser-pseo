/**
 * A page that hands someone a regulatory outcome carries a not-legal-advice
 * line.
 *
 * data/calculators/gdpr/gdpr-compliance-risk-calculator.json turns eight
 * dropdowns into "Potential Fine Range: €1M - €10M" or "Up to €20M or 4% of
 * revenue". That is a figure a small business could plan around, produced by a
 * weighted sum with no view of any actual facts. It now carries a good
 * disclaimer, and components/CalculatorPage.tsx renders it — this check is
 * what stops the next such calculator shipping without one.
 *
 * The statutory request-letter templates are the same problem with no slot to
 * fix it in: 23 of them tell the reader a controller must respond within a
 * stated number of days, or cite Article 17 / § 1798.105, and TemplatePage.tsx
 * has no disclaimer field at all. That is a statement of law, in a document
 * the reader is about to send to a company.
 *
 * FALSE POSITIVES ARE THE WHOLE DIFFICULTY HERE, and the first draft of this
 * check was full of them. What it deliberately does NOT fire on:
 *   - the word "penalty" or "liability" anywhere in a file. An HR policy
 *     template saying employees "will not face penalties" for reporting a
 *     phishing attempt, and a letter listing "reduced liability" as a benefit,
 *     are not regulatory outcomes. Both matched the first version.
 *   - identifiers in formula code. `loginPenalty`, `publicInterestPenalty` and
 *     friends are variable names in the scoring JavaScript; a case-insensitive
 *     word match on the whole file pulled in two more calculators through
 *     nothing but camelCase.
 *   So calculators are judged on their outputFields' human-facing LABELS and
 *   on money/percent-of-revenue literals in the formula's OUTPUT strings, and
 *   templates only when they are request letters that state a deadline or cite
 *   a statute by number. That scoping is what takes this from 33 noisy hits to
 *   a short list a person can act on.
 *   - guides, checklists and glossary entries that explain a law. Explaining
 *     the GDPR fine ceiling in an educational guide is editorial, not advice
 *     handed to a reader as their own number, and the repo's editorial gate
 *     already owns that copy.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

/** A human-facing output field that names a regulatory consequence. */
const OUTCOME_LABEL = /\b(?:fine|fines|penalty|penalties|liability|damages|prosecution)\b/i;
/** A currency figure or a percentage-of-revenue, in a string the page shows. */
const MONEY = /[€£$]\s?\d[\d.,]*\s*(?:K|M|B|million|billion)?/;
const PCT_REVENUE = /\d+\s?%\s+of\s+(?:annual\s+|global\s+|worldwide\s+)*(?:revenue|turnover)/i;
/**
 * A statutory deadline, or a statute cited by number.
 *
 * The deadline pattern is only a finding when the text ATTRIBUTES it to law
 * nearby. "Per CCPA Section 1798.130, you must respond within 45 days" is a
 * statement of law; "please contact me at [CONTACT_EMAIL] within 7 days" is
 * the letter-writer being polite, and the first version of this check could
 * not tell them apart.
 */
const DEADLINE = /\bwithin\s+(?:\d{1,3}|thirty|forty-five|sixty|ninety)\s*(?:\(\d+\)\s*)?(?:calendar\s+|business\s+|working\s+)?days\b/gi;
const ATTRIBUTED = /\b(?:GDPR|CCPA|CPRA|UK GDPR|Article\s+\d+|Section\s+1798\.\d+|statute|statutory|regulation|by law|legally|required to|obliged to|must respond|are required)\b/i;
const CITATION = /\b(?:Article\s+\d+|Section\s+1798\.\d+|§\s?1798\.\d+)\b/;

/** The first deadline in `text` that the surrounding sentence pins to a law. */
function attributedDeadline(text) {
  DEADLINE.lastIndex = 0;
  let m;
  while ((m = DEADLINE.exec(text)) !== null) {
    const window = text.slice(Math.max(0, m.index - 140), m.index + m[0].length + 60);
    if (ATTRIBUTED.test(window)) return m[0];
  }
  return null;
}
/** Any of the ways this repo already words the caveat. */
const NOT_ADVICE = /not legal advice|no legal advice|not a substitute for legal|consult (?:a lawyer|an attorney|counsel|legal counsel)/i;

export default check({
  id: 'cmp-legal-outcome-disclaimer',
  discipline: 'compliance',
  cadence: 'weekly',
  severity: 'low',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Pages that hand the reader a regulatory outcome — a fine figure, a statutory deadline, a cited article — carry a not-legal-advice line.',
  async run(ctx) {
    const calcDir = join(ctx.repoRoot, 'data/calculators');
    const tplDir = join(ctx.repoRoot, 'data/templates');
    if (!existsSync(calcDir) && !existsSync(tplDir)) throw new Skip('neither data/calculators nor data/templates exists — wrong repo, or a partial checkout');

    const findings = [];
    let checked = 0;

    // ---- calculators: the renderer has a disclaimer slot, so use it --------
    const rendererPath = join(ctx.repoRoot, 'components/CalculatorPage.tsx');
    const rendererHasSlot = existsSync(rendererPath) && /data-calculator-disclaimer/.test(readFileSync(rendererPath, 'utf-8'));

    for (const p of walk(calcDir)) {
      checked += 1;
      const rel = relative(ctx.repoRoot, p);
      let j;
      try { j = JSON.parse(readFileSync(p, 'utf-8')); } catch (err) { continue; }
      const labels = (j.outputFields || []).map((f) => `${f.label ?? ''} ${f.description ?? ''}`).join(' | ');
      const formula = String(j.formula || '');
      const why = [];
      if (OUTCOME_LABEL.test(labels)) why.push(`outputField label names "${labels.match(OUTCOME_LABEL)[0]}"`);
      if (MONEY.test(formula)) why.push(`formula returns the money literal "${formula.match(MONEY)[0].trim()}"`);
      if (PCT_REVENUE.test(formula)) why.push(`formula returns "${formula.match(PCT_REVENUE)[0]}"`);
      if (!why.length) continue;

      if (!NOT_ADVICE.test(String(j.disclaimer || ''))) {
        findings.push(finding({
          severity: 'low',
          title: `Calculator states a regulatory outcome with no not-legal-advice line: ${j.slug || rel}`,
          detail: `This calculator produces a number a reader can act on as if it were their exposure, from a weighted sum that sees none of the facts a regulator would weigh. The renderer already has a disclaimer slot and one calculator uses it well; this one has no disclaimer at all.`,
          evidence: `${rel}\n${why.join('; ')}\ndisclaimer field: ${j.disclaimer ? JSON.stringify(String(j.disclaimer).slice(0, 120)) : '(absent)'}`,
          remediation: `Add a "disclaimer" to the JSON in the style of data/calculators/gdpr/gdpr-compliance-risk-calculator.json — it says what the figure is, who really sets it, and what to do with the band instead.`,
          file: rel,
        }));
      } else if (!rendererHasSlot) {
        findings.push(finding({
          severity: 'low',
          title: 'Calculators carry disclaimers that the renderer no longer shows',
          detail: 'The disclaimer text exists in the data but components/CalculatorPage.tsx does not emit data-calculator-disclaimer, so nothing reaches the page. A disclaimer only in the JSON is a disclaimer nobody reads.',
          evidence: `${rel} has a disclaimer; components/CalculatorPage.tsx contains no data-calculator-disclaimer`,
          remediation: 'Restore the disclaimer block in CalculatorPage.tsx.',
          file: 'components/CalculatorPage.tsx',
        }));
      }
    }

    // ---- templates: statutory request letters ------------------------------
    // These are grouped into ONE finding on purpose. They fail for a single
    // structural reason — TemplatePage.tsx has no disclaimer slot — and 23
    // separate lines would read as 23 problems when it is one fix.
    const offenders = [];
    for (const p of walk(tplDir)) {
      checked += 1;
      const rel = relative(ctx.repoRoot, p);
      let j;
      try { j = JSON.parse(readFileSync(p, 'utf-8')); } catch { continue; }
      const isRequestLetter = /request-letter|deletion-request|erasure/.test(String(j.slug || ''))
        || /request letter|deletion request/i.test(String(j.templateType || ''));
      if (!isRequestLetter) continue;
      const all = JSON.stringify(j);
      const reasons = [];
      const dl = attributedDeadline(all);
      if (dl) reasons.push(`states a deadline the reader is told the law sets: "${dl}"`);
      if (CITATION.test(all)) reasons.push(`cites ${all.match(CITATION)[0]}`);
      if (!reasons.length) continue;
      if (NOT_ADVICE.test(all)) continue;
      offenders.push({ rel, reasons });
    }
    if (offenders.length) {
      const tplRenderer = join(ctx.repoRoot, 'components/TemplatePage.tsx');
      const hasSlot = existsSync(tplRenderer) && /disclaimer/i.test(readFileSync(tplRenderer, 'utf-8'));
      findings.push(finding({
        severity: 'low',
        title: `${offenders.length} statutory request-letter templates state law with no not-legal-advice line`,
        detail: `Each of these hands the reader a letter to send to a real company, telling them a controller must respond within a stated period or citing a statute by number. That is a statement of law being relied on, not editorial. ${hasSlot ? 'The template renderer has a disclaimer slot; these templates do not fill it.' : 'components/TemplatePage.tsx has no disclaimer slot at all, so there is currently nowhere to put one — which is why this is one structural fix rather than 23 edits.'} Note that data/templates/us-state-privacy/us-state-privacy-laws-policy-template.json already gets this right in its own description, so the house style exists.`,
        evidence: offenders.map((o) => `${o.rel} — ${o.reasons.join('; ')}`).join('\n'),
        remediation: `Add a disclaimer field to the template schema and render it in components/TemplatePage.tsx, then fill it for these ${offenders.length}. The wording in data/calculators/gdpr/gdpr-compliance-risk-calculator.json is the model.`,
        file: offenders[0].rel,
      }));
    }

    if (!checked) throw new Skip('no calculator or template JSON found to grade');
    return { findings, checked };
  },
});
