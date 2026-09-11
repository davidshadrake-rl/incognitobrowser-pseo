/**
 * Guards the owner's 2026-09-10 decision: Incognito Pro is live, the VPN is
 * not. The site used to promise a "Built-in VPN" on 500+ pages (the result
 * CTA's benefit tiles, the report cards, the in-app copy, PRO_DEFINITION and
 * eight comparison rows). Nothing may claim that Incognito Browser or Pro
 * includes a VPN until the owner says it ships.
 *
 * Mentioning the visitor's OWN VPN is fine ("Your VPN is on, but…", "check
 * your VPN's DNS setting"), so the copy check is per sentence: a sentence may
 * not name our product and a VPN together.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PRO_BENEFITS, ENGINE_COPY, DEFAULT_ENGINE_COPY, IN_APP_COPY, reportCardLine } from '@/lib/cta-copy';
import { PRO_DEFINITION } from '@/lib/tiers';

function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

const OURS = /\bIncognito\b|\bPro\b/;
const VPN = /\bVPN\b/i;

describe('no VPN claims for Incognito Browser or Pro', () => {
  it('the CTA copy never names our product and a VPN in the same sentence', () => {
    const copy = strings([
      PRO_BENEFITS, ENGINE_COPY, DEFAULT_ENGINE_COPY, IN_APP_COPY,
      reportCardLine('B', 'green', { trackingCookies: 2, trackers: 3 }),
    ]);
    const offenders = copy
      .flatMap((s) => s.split(/(?<=[.!?])\s+/))
      .filter((sentence) => OURS.test(sentence) && VPN.test(sentence));
    expect(offenders).toEqual([]);
  });

  it('there is no VPN benefit tile', () => {
    expect(Object.keys(PRO_BENEFITS)).not.toContain('vpn');
    for (const e of Object.values(ENGINE_COPY)) expect(e.benefits as string[]).not.toContain('vpn');
  });

  it('PRO_DEFINITION does not mention a VPN', () => {
    expect(PRO_DEFINITION).not.toMatch(VPN);
  });

  it("comparison rows for Incognito Browser make none of brand.json's never-claims in their pros or tagline", () => {
    // Cons may disclaim ("Doesn't encrypt network traffic like a VPN"), so they are not checked.
    const NEVER = /\bvpn\b|\btor\b|no (tracking|data)|data collection|fingerprint|all (platforms|devices|operating)|open[- ]source|zero[- ]knowledge/i;
    const dir = path.join(process.cwd(), 'data', 'comparisons');
    const offenders: string[] = [];
    for (const niche of fs.readdirSync(dir)) {
      for (const file of fs.readdirSync(path.join(dir, niche))) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, niche, file), 'utf-8')) as {
          products?: Array<{ slug?: string; tagline?: string; pros?: string[] }>;
        };
        for (const p of data.products ?? []) {
          if (p.slug !== 'incognito-browser') continue;
          for (const s of [p.tagline ?? '', ...(p.pros ?? [])]) {
            if (NEVER.test(s)) offenders.push(`${niche}/${file}: ${s}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no content file links to a look-alike domain (the parked incognitobrowser.com, or other companies\' incognito.* sites)', () => {
    // 57 related links pointed at these; they shipped in page HTML and confuse
    // which site is ours for anyone, including AI crawlers, resolving the name.
    const BAD = /incognito-?browser\.(com|org|app)|\/\/(www\.)?incognito\.(com|org)/i;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.json') && BAD.test(fs.readFileSync(p, 'utf-8'))) offenders.push(path.relative(process.cwd(), p));
      }
    };
    walk(path.join(process.cwd(), 'data'));
    expect(offenders).toEqual([]);
  });

  it('Incognito Browser rows point at the real domain, never the parked incognitobrowser.com or another company', () => {
    const dir = path.join(process.cwd(), 'data', 'comparisons');
    const offenders: string[] = [];
    for (const niche of fs.readdirSync(dir)) {
      for (const file of fs.readdirSync(path.join(dir, niche))) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, niche, file), 'utf-8')) as {
          products?: Array<{ slug?: string; website?: string }>;
        };
        for (const p of data.products ?? []) {
          if (p.slug === 'incognito-browser' && p.website && p.website.replace(/\/$/, '') !== 'https://incognitobrowser.io') {
            offenders.push(`${niche}/${file}: ${p.website}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
