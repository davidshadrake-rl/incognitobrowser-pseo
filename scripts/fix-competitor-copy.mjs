#!/usr/bin/env node
/**
 * Removes competitor recommendations from tool copy and reframes them
 * as product pitches. On a marketing site that exists to funnel to
 * Incognito Browser, recommending Brave/Firefox/third-party extensions
 * in the tool tips is a conversion leak.
 *
 * Rules are exact-string replacements (safe, reversible). Only claims
 * the product genuinely makes (tracker/cookie blocking, built-in
 * privacy) are asserted — no VPN/UA-minimizer overclaims.
 *
 * Idempotent. Usage: node scripts/fix-competitor-copy.mjs [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.resolve(__dirname, '..', 'data', 'tools');
const DRY = process.argv.includes('--dry-run');

const REPLACEMENTS = [
  [
    'Consider using Incognito Browser or Brave for built-in privacy protections',
    'Incognito Browser gives you built-in privacy protections with no setup',
  ],
  [
    'Consider using a browser like Brave or Incognito Browser that blocks tracking cookies by default',
    'Incognito Browser blocks tracking cookies by default',
  ],
  [
    'Privacy-focused browsers like Brave and Firefox often reduce UA string detail',
    'A privacy-focused browser can reduce the detail your user agent reveals',
  ],
  // Fingerprint-audit tips that push third-party extensions instead of the product:
  [
    'Install a canvas fingerprint randomizer extension to prevent unique identification',
    'Use a privacy browser that randomizes your canvas fingerprint to prevent unique identification',
  ],
  [
    'Use a WebRTC blocker to prevent IP address leaks, especially when using a VPN',
    'Use a browser that patches WebRTC to prevent IP address leaks, especially when using a VPN',
  ],
  [
    'Consider Firefox\'s resistFingerprinting or a canvas-blocker extension.',
    'A privacy browser that resists fingerprinting stops sites recognizing you this way.',
  ],
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

let filesChanged = 0;
let totalReplacements = 0;

for (const fp of walk(TOOLS)) {
  let src = fs.readFileSync(fp, 'utf-8');
  let changed = false;
  for (const [from, to] of REPLACEMENTS) {
    if (src.includes(from)) {
      src = src.split(from).join(to);
      totalReplacements++;
      changed = true;
    }
  }
  if (changed) {
    filesChanged++;
    if (!DRY) fs.writeFileSync(fp, src);
    console.log(`${DRY ? '[DRY] ' : ''}${path.relative(TOOLS, fp)}`);
  }
}

console.log(`\n${DRY ? '[DRY] ' : ''}Files changed: ${filesChanged} | Replacements: ${totalReplacements}`);
