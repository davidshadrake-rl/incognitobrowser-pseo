import type { Metadata } from 'next';
import { IS_PRO_DEPLOYMENT, PRO_BASE_URL } from '@/lib/tiers';

const SITE_URL = 'https://incognitobrowser.io';
const BASE_PATH = '/resources';
const SITE_NAME = 'Incognito Browser';

/**
 * Public origin of THIS deployment. Canonicals, og:url and JSON-LD must name
 * the deployment the page is actually served from: a Pro page that
 * canonicalises to the free site points at a URL that does not exist there.
 */
const PUBLIC_ORIGIN = IS_PRO_DEPLOYMENT ? PRO_BASE_URL : `${SITE_URL}${BASE_PATH}`;

/** Absolute URL for a site path on this deployment. */
export function absoluteUrl(path: string): string {
  return `${PUBLIC_ORIGIN}${path === '/' ? '' : path}`;
}

interface SEOParams {
  title: string;
  description: string;
  path: string;
  type?: 'article' | 'website';
  noIndex?: boolean;
  /** ISO 8601 publication timestamp. Surfaces as og:article:published_time. */
  publishedAt?: string;
  /** ISO 8601 last-modified timestamp. Surfaces as og:article:modified_time. */
  modifiedAt?: string;
}

export function generateMetadata({ title, description, path, type = 'article', noIndex = false, publishedAt, modifiedAt }: SEOParams): Metadata {
  const url = absoluteUrl(path);

  // IMPORTANT: don't pre-append " | Incognito Browser" here — layout.tsx's
  // root metadata sets `title.template = "%s | Incognito Browser"` and
  // Next applies it automatically. Doing both produced
  // "Title | Incognito Browser | Incognito Browser" in v16.
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} | ${SITE_NAME}`,
      description,
      url,
      siteName: SITE_NAME,
      type,
      locale: 'en_US',
      ...(type === 'article' && publishedAt ? { publishedTime: publishedAt } : {}),
      ...(type === 'article' && modifiedAt ? { modifiedTime: modifiedAt } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_NAME}`,
      description,
    },
    // noindex,follow: don't surface in SERPs, but keep crawling internal links so
    // the link graph still propagates when pages get promoted to 'published'.
    // The Pro deployment is noindex sitewide (see lib/tiers.ts).
    robots: noIndex || IS_PRO_DEPLOYMENT ? { index: false, follow: true } : undefined,
  };
}

/**
 * Who content pages are credited to, in structured data. An organisation,
 * never a person: pages no longer show a byline, and Google's structured-data
 * guidelines say markup must not describe things readers cannot see on the
 * page. Its URL is the page that explains what "Editorially reviewed" means.
 */
const EDITORIAL_MASTHEAD = {
  '@type': 'Organization',
  name: 'Incognito Browser Editorial',
  url: `${SITE_URL}${BASE_PATH}/editorial-standards`,
} as const;

/**
 * Article JSON-LD, credited to the editorial masthead.
 *
 * Takes booleans rather than author/editor objects on purpose. It used to
 * take the objects and emitted the writer's pen name, the editor's real name
 * and their personal LinkedIn on 1,000+ pages; a signature that never sees a
 * name cannot put one back.
 *
 * Returns null for a page nobody has put their name to (draft / unattributed),
 * which the editorial gate already noindexes.
 */
export function generateArticleSchema(opts: {
  headline: string;
  description: string;
  url: string;
  datePublished?: string;
  dateModified?: string;
  /** The page has an author block — i.e. it went through the promote pipeline. */
  attributed: boolean;
}) {
  if (!opts.attributed) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.headline,
    description: opts.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': opts.url },
    url: opts.url,
    ...(opts.datePublished ? { datePublished: opts.datePublished } : {}),
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
    // No `editor`: schema.org types it as a Person, and there is no person to
    // name. The masthead covers both roles.
    author: EDITORIAL_MASTHEAD,
    publisher: {
      '@type': 'Organization',
      name: 'Incognito Browser',
      url: 'https://incognitobrowser.io',
    },
  };
}

export interface FAQItem {
  question: string;
  answer: string;
}

export function generateFAQSchema(faqs: FAQItem[], pageUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

export function generateHowToSchema(title: string, steps: Array<{ title: string; description: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    step: steps.map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: step.title,
      text: step.description,
    })),
  };
}

export function generateWebApplicationSchema(name: string, description: string, url: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name,
    description,
    url,
    applicationCategory: 'SecurityApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };
}

export function generateBreadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.url),
    })),
  };
}
