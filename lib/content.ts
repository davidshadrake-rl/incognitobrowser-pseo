import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

export function getContentFiles(contentType: string, niche?: string): string[] {
  const dir = niche
    ? path.join(DATA_DIR, contentType, niche)
    : path.join(DATA_DIR, contentType);

  if (!fs.existsSync(dir)) return [];

  if (niche) {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  // If no niche, look in all subdirectories
  const niches = fs.readdirSync(dir).filter(f => {
    const fullPath = path.join(dir, f);
    return fs.statSync(fullPath).isDirectory();
  });

  const files: string[] = [];
  for (const nicheDir of niches) {
    const nicheFiles = fs.readdirSync(path.join(dir, nicheDir))
      .filter(f => f.endsWith('.json'))
      .map(f => `${nicheDir}/${f.replace('.json', '')}`);
    files.push(...nicheFiles);
  }
  return files;
}

export function getContentItem<T>(contentType: string, ...pathParts: string[]): T | null {
  const filePath = path.join(DATA_DIR, contentType, ...pathParts) + '.json';
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export function getAllContentItems<T>(contentType: string): Array<T & { _niche: string; _slug: string }> {
  const files = getContentFiles(contentType);
  const items: Array<T & { _niche: string; _slug: string }> = [];

  for (const file of files) {
    const parts = file.split('/');
    if (parts.length === 2) {
      const item = getContentItem<T>(contentType, parts[0], parts[1]);
      if (item) {
        items.push({ ...item, _niche: parts[0], _slug: parts[1] });
      }
    }
  }
  return items;
}

// For glossary (flat structure, no niche subdirectories)
export function getGlossaryFiles(): string[] {
  const dir = path.join(DATA_DIR, 'glossary');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

export function getGlossaryItem<T>(slug: string): T | null {
  const filePath = path.join(DATA_DIR, 'glossary', `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}
