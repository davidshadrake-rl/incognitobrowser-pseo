#!/usr/bin/env node
/**
 * Repairs collateral damage from scrub-product-mentions.mjs.
 *
 * The scrub's catch-all replaced "Incognito Browser" with "a privacy-focused
 * browser" EVERYWHERE, including structured slots where the brand IS the
 * entity being described — not promotional body text:
 *   - comparisons: products[].name (the product's row in its own comparison)
 *   - comparisons: verdict prose, when the product is one of the compared items
 *   - calculators: inputs[].options[].label where value === 'incognito-browser'
 *
 * Those are the legitimate brand placements (a comparison compares products
 * by name; a dropdown must let the user pick the product). Restore them.
 * Idempotent.  Usage: node scripts/restore-brand-in-structured-slots.mjs [--dry-run]
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DRY=process.argv.includes('--dry-run');
const BRAND='Incognito Browser';
const PH=/a privacy-focused browser/gi, PHB=/Privacy-focused browsers/g;
const walk=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);e.isDirectory()?walk(f,o):e.name.endsWith('.json')&&o.push(f);}return o;};
let stats={compName:0,compVerdict:0,calcLabel:0,files:0};
for(const f of walk(path.join(ROOT,'data','comparisons'))){
  const d=JSON.parse(fs.readFileSync(f,'utf8')); let ch=false;
  const prods=Array.isArray(d.products)?d.products:[];
  for(const p of prods){
    const isBrand = (p.id||p.slug||'').toLowerCase()==='incognito-browser' || (p.name||'').toLowerCase()==='a privacy-focused browser';
    if(isBrand && p.name!==BRAND){ p.name=BRAND; stats.compName++; ch=true; }
  }
  const brandCompared = prods.some(p=>p.name===BRAND);
  if(brandCompared){
    for(const k of ['verdict','intro']){
      const v=d[k]; if(typeof v==='string'){ const n=v.replace(PH,BRAND).replace(PHB,BRAND); if(n!==v){d[k]=n;stats.compVerdict++;ch=true;} }
      else if(v&&typeof v==='object'){ const s=JSON.stringify(v); const n=s.replace(PH,BRAND).replace(PHB,BRAND); if(n!==s){d[k]=JSON.parse(n);stats.compVerdict++;ch=true;} }
    }
  }
  if(ch){stats.files++; if(!DRY) fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n');}
}
for(const f of walk(path.join(ROOT,'data','calculators'))){
  const d=JSON.parse(fs.readFileSync(f,'utf8')); let ch=false;
  for(const inp of d.inputs||[]) for(const o of inp.options||[]) if(o.value==='incognito-browser'&&o.label!==BRAND){o.label=BRAND;stats.calcLabel++;ch=true;}
  if(ch){stats.files++; if(!DRY) fs.writeFileSync(f,JSON.stringify(d,null,2)+'\n');}
}
console.log(`${DRY?'[DRY] ':''}files=${stats.files} productNames=${stats.compName} verdict/intro=${stats.compVerdict} calcLabels=${stats.calcLabel}`);
