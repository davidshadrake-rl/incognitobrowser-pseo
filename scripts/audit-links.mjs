#!/usr/bin/env node
/**
 * Same-site link audit for a built deployment.
 *
 *   node scripts/audit-links.mjs <dir> --mode static|server [--base /resources] [--allow /robots.txt,...]
 *
 * Walks every .html under <dir>, extracts same-site hrefs (those starting
 * with "/"), and checks each resolves to a page in the same build:
 *   static: <dir>/<path>/index.html  or <dir>/<path>          (next export)
 *   server: <dir>/<path>.html        or <dir>/<path>/index.html (.next/server/app)
 * Absolute URLs (https://…) are ignored — cross-deployment hand-offs are
 * intentional. Exits 1 and prints the dangling targets with an example
 * source page for each. This is how "links to pages that do not exist on
 * this deployment" get caught on BOTH the free and the Pro build.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '');
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const mode = opt('--mode', 'static');
const base = opt('--base', mode === 'static' ? '/resources' : '');
const allow = new Set((opt('--allow', '/robots.txt,/sitemap.xml,/favicon.ico') || '').split(',').filter(Boolean));
if (!fs.existsSync(dir)) { console.error(`no such dir: ${dir}`); process.exit(2); }

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []);
const files = walk(dir);

const exists = (p) => {
  if (allow.has(p)) return true;
  if (p.startsWith('/_next/')) return true;
  if (mode === 'static') {
    return fs.existsSync(path.join(dir, p, 'index.html')) || (p !== '/' && fs.existsSync(path.join(dir, p)));
  }
  if (p === '/') return fs.existsSync(path.join(dir, 'index.html'));
  return fs.existsSync(path.join(dir, `${p}.html`)) || fs.existsSync(path.join(dir, p, 'index.html'));
};

const dangling = new Map(); // target -> { count, example }
let hrefs = 0;
for (const f of files) {
  const html = fs.readFileSync(f, 'utf-8');
  const re = /href="(\/[^"#?]*)(?:[#?][^"]*)?"/g;
  let m;
  while ((m = re.exec(html))) {
    hrefs++;
    let p = m[1];
    if (base && p.startsWith(base + '/')) p = p.slice(base.length);
    else if (base && p === base) p = '/';
    if (p.length > 1) p = p.replace(/\/$/, '');
    if (!exists(p)) {
      const cur = dangling.get(p) || { count: 0, example: path.relative(dir, f) };
      cur.count++;
      dangling.set(p, cur);
    }
  }
}

console.log(`audit-links: ${files.length} pages, ${hrefs} same-site hrefs, ${dangling.size} dangling targets (${mode}${base ? `, base ${base}` : ''})`);
if (dangling.size) {
  const rows = [...dangling.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [t, { count, example }] of rows.slice(0, 40)) console.log(`  ${String(count).padStart(5)}×  ${t}   e.g. ${example}`);
  if (rows.length > 40) console.log(`  … ${rows.length - 40} more`);
  process.exit(1);
}
