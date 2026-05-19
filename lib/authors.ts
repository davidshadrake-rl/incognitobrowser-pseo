import fs from 'fs';
import path from 'path';

const AUTHORS_DIR = path.join(process.cwd(), 'data', 'authors');

export interface AuthorProfile {
  slug: string;
  name: string;
  tagline?: string;
  bio: string;
  credentials?: string;
  profileUrl?: string;
  sameAs?: string[];
  areasOfExpertise?: string[];
}

export function getAuthor(slug: string): AuthorProfile | null {
  const fp = path.join(AUTHORS_DIR, `${slug}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8')) as AuthorProfile;
}

export function getAllAuthors(): AuthorProfile[] {
  if (!fs.existsSync(AUTHORS_DIR)) return [];
  return fs
    .readdirSync(AUTHORS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(AUTHORS_DIR, f), 'utf-8'))) as AuthorProfile[];
}

/**
 * Slug of the default byline used by the editorial promote pipeline.
 * Pseudonymous bylines are E-A-T-compatible as long as the persona has
 * a real profile page on the site, which `/authors/<slug>` provides.
 */
export const DEFAULT_AUTHOR_SLUG = 'darkpool-david';

/**
 * Article author JSON-LD fragment. Embedded inside the per-page Article
 * schema so Google can attribute content to a Person entity.
 */
export function authorJsonLd(profile: AuthorProfile) {
  return {
    '@type': 'Person',
    name: profile.name,
    url: profile.profileUrl,
    description: profile.bio,
    ...(profile.sameAs && profile.sameAs.length > 0 ? { sameAs: profile.sameAs } : {}),
    ...(profile.areasOfExpertise && profile.areasOfExpertise.length > 0
      ? { knowsAbout: profile.areasOfExpertise }
      : {}),
  };
}
