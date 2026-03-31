/**
 * Content Generation Script for pSEO
 *
 * Usage:
 *   npx tsx scripts/generate-content.ts --type checklists --niche browser-privacy
 *   npx tsx scripts/generate-content.ts --type glossary
 *   npx tsx scripts/generate-content.ts --type all
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 */

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const DATA_DIR = path.join(process.cwd(), 'data');
const SCHEMAS_DIR = path.join(process.cwd(), 'scripts', 'schemas');

// Load taxonomy
const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'taxonomy.json'), 'utf-8'));

const client = new Anthropic();

// Content type configurations: what to generate per niche
const contentConfigs: Record<string, {
  schemaFile: string;
  generatePrompt: (niche: any) => string[];
  outputPath: (niche: any, slug: string) => string;
}> = {
  checklists: {
    schemaFile: 'checklist.schema.json',
    generatePrompt: (niche) => [
      `${niche.name} Security Checklist`,
      `${niche.name} Privacy Hardening Checklist`,
    ],
    outputPath: (niche, slug) => path.join(DATA_DIR, 'checklists', niche.id, `${slug}.json`),
  },
  guides: {
    schemaFile: 'guide.schema.json',
    generatePrompt: (niche) => [
      `Complete Guide to ${niche.name}`,
      `${niche.name} for Beginners`,
      `Advanced ${niche.name} Techniques`,
    ],
    outputPath: (niche, slug) => path.join(DATA_DIR, 'guides', niche.id, `${slug}.json`),
  },
  comparisons: {
    schemaFile: 'comparison.schema.json',
    generatePrompt: (niche) => [
      `Best ${niche.name} Tools Compared`,
    ],
    outputPath: (niche, slug) => path.join(DATA_DIR, 'comparisons', niche.id, `${slug}.json`),
  },
  templates: {
    schemaFile: 'template.schema.json',
    generatePrompt: (niche) => [
      `${niche.name} Policy Template`,
      `${niche.name} Request Letter Template`,
    ],
    outputPath: (niche, slug) => path.join(DATA_DIR, 'templates', niche.id, `${slug}.json`),
  },
  calculators: {
    schemaFile: 'calculator.schema.json',
    generatePrompt: (niche) => [
      `${niche.name} Risk Calculator`,
    ],
    outputPath: (niche, slug) => path.join(DATA_DIR, 'calculators', niche.id, `${slug}.json`),
  },
};

// Glossary terms to generate (pulled from all niches)
const glossaryTerms = [
  'cookies', 'third-party-cookies', 'first-party-cookies', 'session-cookies',
  'browser-fingerprinting', 'canvas-fingerprinting', 'webrtc-leak', 'dns-leak',
  'vpn', 'proxy-server', 'tor-network', 'onion-routing',
  'end-to-end-encryption', 'ssl-tls', 'https', 'public-key-cryptography',
  'two-factor-authentication', 'multi-factor-authentication', 'password-hashing', 'zero-knowledge-proof',
  'data-broker', 'data-mining', 'behavioral-tracking', 'cross-site-tracking',
  'gdpr', 'ccpa', 'coppa', 'hipaa', 'right-to-be-forgotten', 'data-portability',
  'incognito-mode', 'private-browsing', 'do-not-track', 'global-privacy-control',
  'digital-footprint', 'metadata', 'ip-address', 'mac-address', 'user-agent',
  'phishing', 'spear-phishing', 'social-engineering', 'man-in-the-middle',
  'adware', 'spyware', 'ransomware', 'keylogger',
  'dark-patterns', 'consent-fatigue', 'privacy-policy', 'terms-of-service',
  'facial-recognition', 'biometric-data', 'geofencing', 'location-tracking',
  'sandbox', 'containerization', 'privacy-sandbox', 'federated-learning',
  'pixel-tracking', 'supercookie', 'etag-tracking', 'cname-cloaking',
  'differential-privacy', 'k-anonymity', 'data-minimization', 'purpose-limitation',
  'secure-dns', 'dns-over-https', 'dns-over-tls', 'encrypted-sni',
  'privacy-by-design', 'privacy-impact-assessment', 'data-protection-officer',
  'cookie-consent', 'legitimate-interest', 'data-subject-access-request',
  'ad-blocker', 'content-blocker', 'tracker-blocker', 'script-blocker',
  'webrtc', 'local-storage', 'session-storage', 'indexeddb',
  'referrer-policy', 'content-security-policy', 'permissions-policy',
  'private-relay', 'oblivious-http', 'mixnet',
  'surveillance-capitalism', 'data-economy', 'attention-economy',
  'warrant-canary', 'gag-order', 'national-security-letter',
  'penetration-testing', 'vulnerability-disclosure', 'bug-bounty',
  'homomorphic-encryption', 'secure-multi-party-computation', 'trusted-execution-environment',
  'decentralized-identity', 'self-sovereign-identity', 'verifiable-credentials',
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function generateContent(
  contentType: string,
  schema: object,
  title: string,
  niche: any,
  existingBlogUrls: string[]
): Promise<any> {
  const nicheContext = `
Niche: ${niche.name}
Description: ${niche.description}
Keywords: ${niche.keywords.join(', ')}
Related topics: ${niche.relatedNiches.join(', ')}
  `.trim();

  const relatedBlogPosts = existingBlogUrls
    .filter(url => {
      const slug = url.split('/').pop() || '';
      return niche.keywords.some((kw: string) =>
        slug.includes(kw.toLowerCase().replace(/\s+/g, '-'))
      );
    })
    .slice(0, 5);

  const prompt = `Generate a JSON object for a ${contentType} page titled "${title}" for the privacy niche "${niche.name}".

Context:
${nicheContext}

${relatedBlogPosts.length > 0 ? `Related existing blog posts on the site (link to these in relatedLinks):
${relatedBlogPosts.map(url => `- ${url}`).join('\n')}` : ''}

IMPORTANT RULES:
1. Output ONLY valid JSON, no markdown code blocks
2. Follow the schema exactly
3. All content must be factually accurate about privacy/security
4. Write for a general audience, not technical experts
5. Include actionable, practical advice
6. Reference Incognito Browser where relevant as a recommended tool
7. SEO: title under 70 chars, metaDescription under 160 chars
8. Make the slug URL-friendly (lowercase, hyphens, no special chars)
9. Set niche to "${niche.id}"

JSON Schema to follow:
${JSON.stringify(schema, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr);
}

async function generateGlossaryTerm(term: string, schema: object): Promise<any> {
  const prompt = `Generate a JSON object for a privacy glossary entry for the term "${term.replace(/-/g, ' ')}".

IMPORTANT RULES:
1. Output ONLY valid JSON, no markdown code blocks
2. Follow the schema exactly
3. Write the definition clearly for a general audience
4. Include practical real-world examples
5. Link to related terms using their slugs
6. Set slug to "${term}"

JSON Schema to follow:
${JSON.stringify(schema, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(jsonStr);
}

function loadExistingBlogUrls(): string[] {
  const csvPath = path.resolve(process.cwd(), '..', '..', 'incognito browser stuff', 'incognitobrowser_blog_posts.csv');
  if (!fs.existsSync(csvPath)) return [];
  return fs.readFileSync(csvPath, 'utf-8')
    .split('\n')
    .filter(line => line.startsWith('http'))
    .map(line => line.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const typeArg = args.indexOf('--type') !== -1 ? args[args.indexOf('--type') + 1] : 'all';
  const nicheArg = args.indexOf('--niche') !== -1 ? args[args.indexOf('--niche') + 1] : null;
  const dryRun = args.includes('--dry-run');

  console.log(`\n=== pSEO Content Generator ===`);
  console.log(`Type: ${typeArg}`);
  console.log(`Niche: ${nicheArg || 'all'}`);
  console.log(`Dry run: ${dryRun}\n`);

  const existingBlogUrls = loadExistingBlogUrls();
  console.log(`Loaded ${existingBlogUrls.length} existing blog URLs for internal linking\n`);

  const typesToGenerate = typeArg === 'all'
    ? [...Object.keys(contentConfigs), 'glossary']
    : [typeArg];

  let totalGenerated = 0;

  for (const contentType of typesToGenerate) {
    if (contentType === 'glossary') {
      // Glossary generation
      const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, 'glossary.schema.json'), 'utf-8'));
      console.log(`\n--- Generating Glossary (${glossaryTerms.length} terms) ---`);

      for (const term of glossaryTerms) {
        const outPath = path.join(DATA_DIR, 'glossary', `${term}.json`);
        if (fs.existsSync(outPath)) {
          console.log(`  [skip] ${term} (exists)`);
          continue;
        }

        if (dryRun) {
          console.log(`  [dry-run] Would generate: ${term}`);
          continue;
        }

        try {
          console.log(`  Generating: ${term}...`);
          const data = await generateGlossaryTerm(term, schema);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
          totalGenerated++;
          console.log(`  [done] ${term}`);

          // Rate limiting
          await new Promise(r => setTimeout(r, 500));
        } catch (err: any) {
          console.error(`  [error] ${term}: ${err.message}`);
        }
      }
      continue;
    }

    const config = contentConfigs[contentType];
    if (!config) {
      console.log(`Unknown content type: ${contentType}`);
      continue;
    }

    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, config.schemaFile), 'utf-8'));
    const niches = nicheArg
      ? taxonomy.niches.filter((n: any) => n.id === nicheArg)
      : taxonomy.niches;

    console.log(`\n--- Generating ${contentType} (${niches.length} niches) ---`);

    for (const niche of niches) {
      const titles = config.generatePrompt(niche);

      for (const title of titles) {
        const slug = slugify(title);
        const outPath = config.outputPath(niche, slug);

        if (fs.existsSync(outPath)) {
          console.log(`  [skip] ${niche.id}/${slug} (exists)`);
          continue;
        }

        if (dryRun) {
          console.log(`  [dry-run] Would generate: ${niche.id}/${slug}`);
          continue;
        }

        try {
          console.log(`  Generating: ${niche.id}/${slug}...`);
          const data = await generateContent(contentType, schema, title, niche, existingBlogUrls);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
          totalGenerated++;
          console.log(`  [done] ${niche.id}/${slug}`);

          // Rate limiting
          await new Promise(r => setTimeout(r, 500));
        } catch (err: any) {
          console.error(`  [error] ${niche.id}/${slug}: ${err.message}`);
        }
      }
    }
  }

  console.log(`\n=== Complete! Generated ${totalGenerated} content files ===\n`);
}

main().catch(console.error);
