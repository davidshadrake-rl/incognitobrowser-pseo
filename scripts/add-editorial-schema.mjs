#!/usr/bin/env node
/**
 * Adds `editorial` and `author` fields to all content schemas.
 *
 * - editorial.status: 'draft' | 'reviewed' | 'published' (required)
 * - editorial.reviewedAt, reviewedBy, notes: optional
 * - author: { name, bio, credentials, profileUrl } or null
 *
 * Idempotent: re-running won't double-add.
 *
 * Usage: node scripts/add-editorial-schema.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.join(__dirname, 'schemas');

const editorialProperty = {
  type: 'object',
  required: ['status'],
  properties: {
    status: {
      type: 'string',
      enum: ['draft', 'reviewed', 'published'],
      description:
        "Editorial gate. Only 'published' pages get indexed in robots meta + sitemap. Promotion requires a human reviewer.",
    },
    reviewedAt: { type: ['string', 'null'], format: 'date-time' },
    reviewedBy: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
};

const authorProperty = {
  oneOf: [
    { type: 'null' },
    {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        bio: { type: 'string' },
        credentials: { type: 'string' },
        profileUrl: { type: 'string', format: 'uri' },
      },
    },
  ],
  description:
    "Named human author. Required when editorial.status === 'published'. Renders as JSON-LD Person + Article author.",
};

const files = fs.readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith('.schema.json'));

for (const file of files) {
  const fp = path.join(SCHEMAS_DIR, file);
  const schema = JSON.parse(fs.readFileSync(fp, 'utf-8'));

  if (!schema.properties) {
    console.warn(`SKIP ${file}: no top-level properties`);
    continue;
  }

  let changed = false;

  if (!schema.properties.editorial) {
    schema.properties.editorial = editorialProperty;
    changed = true;
  }

  if (!schema.properties.author) {
    schema.properties.author = authorProperty;
    changed = true;
  }

  if (Array.isArray(schema.required) && !schema.required.includes('editorial')) {
    schema.required.push('editorial');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(schema, null, 2) + '\n');
    console.log(`UPDATED ${file}`);
  } else {
    console.log(`OK      ${file}`);
  }
}
