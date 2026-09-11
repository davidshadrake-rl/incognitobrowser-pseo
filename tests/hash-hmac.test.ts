/**
 * Hash Generator, HMAC mode (CTO review 2026-09-10, unclear-UI audit).
 *
 * The HMAC checkbox and key field used to call setTimeout(rehash), and rehash
 * still held the previous render's mode and key. Ticking HMAC left plain SHA
 * values under "HMAC-SHA-*" labels, and typing "secret" produced HMACs keyed
 * with "secre", so webhook signatures made with the tool did not verify. The
 * fix computes from committed state in an effect and labels each card from
 * the mode the values were computed in.
 *
 * The digest maths is pinned to published vectors (FIPS 180 "abc", RFC 2202 /
 * RFC 4231 test case 2); the wiring is pinned by reading the component source,
 * as tests/input-validation.test.ts does, because the suite has no DOM.
 */
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { ALGORITHMS, computeDigests, digestLabel, isComputing, type SettledRun } from '../components/tools/HashGeneratorTool';

const bytes = (s: string) => new TextEncoder().encode(s) as BufferSource;

describe('computeDigests', () => {
  it('plain mode: SHA-1/256/384/512 of "abc" match FIPS 180 and are flagged as plain', async () => {
    const d = await computeDigests(bytes('abc'), null);
    expect(d.hmac).toBe(false);
    expect(d.values).toEqual({
      'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
      'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'SHA-384': 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
      'SHA-512': 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    });
  });

  it('HMAC mode: key "Jefe" matches RFC 2202 / RFC 4231 test case 2 and is flagged as HMAC', async () => {
    const d = await computeDigests(bytes('what do ya want for nothing?'), 'Jefe');
    expect(d.hmac).toBe(true);
    expect(d.values).toEqual({
      'SHA-1': 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
      'SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      'SHA-384': 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
      'SHA-512': '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    });
  });

  it('uses the whole key it is given ("secret", not "secre")', async () => {
    const full = await computeDigests(bytes('hello'), 'secret');
    expect(full.values['SHA-256']).toBe(createHmac('sha256', 'secret').update('hello').digest('hex'));
    expect(full.values['SHA-256']).not.toBe(createHmac('sha256', 'secre').update('hello').digest('hex'));
  });

  it('never returns plain SHA values when a key is given', async () => {
    const plain = await computeDigests(bytes('abc'), null);
    const keyed = await computeDigests(bytes('abc'), 'k');
    for (const a of ALGORITHMS) expect(keyed.values[a]).not.toBe(plain.values[a]);
  });
});

describe('card labels', () => {
  it('say HMAC exactly when the values are HMACs', () => {
    expect(ALGORITHMS.map((a) => digestLabel(a, true))).toEqual(['HMAC-SHA-1', 'HMAC-SHA-256', 'HMAC-SHA-384', 'HMAC-SHA-512']);
    expect(ALGORITHMS.map((a) => digestLabel(a, false))).toEqual(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);
  });
});

describe('"Computing..." (review follow-up)', () => {
  // A rejected digest used to leave "Computing..." on screen for good under the
  // error: only a success recorded which input the values belonged to.
  const src = bytes('abc');
  const run = (over: Partial<SettledRun>): SettledRun => ({ source: src, key: null, digests: null, error: '', ...over });

  it('ends when the run fails, not only when it succeeds', async () => {
    vi.stubGlobal('crypto', {}); // a plain-HTTP page: no crypto.subtle
    try {
      await expect(computeDigests(src, null)).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(isComputing(src, null, false, run({ error: 'This browser could not compute the hashes.' }))).toBe(false);
  });

  it('stays on while the visible input has no finished run of its own', () => {
    expect(isComputing(src, null, false, null)).toBe(true);
    // An older input (a different buffer) or another key does not count.
    expect(isComputing(src, null, false, run({ source: bytes('abc') }))).toBe(true);
    expect(isComputing(src, 'k2', false, run({ key: 'k1' }))).toBe(true);
  });

  it('is off with no input, or while HMAC mode waits for a key', () => {
    expect(isComputing(null, null, false, null)).toBe(false);
    expect(isComputing(src, '', true, null)).toBe(false);
  });
});

describe('HashGeneratorTool wiring', () => {
  // Code only: the component's comments describe the old bug by name.
  const src = readFileSync(path.join(__dirname, '..', 'components/tools/HashGeneratorTool.tsx'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('does not recompute from a timer that closes over stale state', () => {
    expect(src).not.toMatch(/setTimeout\(\s*rehash/);
    expect(src).not.toMatch(/\brehash\b/);
  });

  it('recomputes in an effect keyed on the input, the key and whether a key is still needed', () => {
    expect(src).toMatch(/computeDigests\(source, key\)/);
    expect(src).toMatch(/\}, \[source, key, needsKey\]\);/);
  });

  it('labels each card from the computed values, not from the checkbox', () => {
    expect(src).toMatch(/label=\{digestLabel\(algo, shown\.hmac\)\}/);
    expect(src).not.toMatch(/label=\{hmacMode \?/);
  });

  it('records a failed run against its input, and reads "computing" from isComputing', () => {
    expect(src).toMatch(/setSettled\(\{ source, key, digests: null, error:/);
    expect(src).toMatch(/const computing = isComputing\(source, key, needsKey, settled\);/);
  });
});
