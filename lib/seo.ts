import type { Metadata } from 'next';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';

const SITE_URL = 'https://incognitobrowser.io';
const BASE_PATH = '/resources';
const SITE_NAME = 'Incognito Browser';

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
  const url = `${SITE_URL}${BASE_PATH}${path}`;

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
 * Article JSON-LD with author attribution.
 *
 * Emit this on every editorially-promoted content page so Google can
 * resolve the byline to a Person entity (the author profile page at
 * /authors/<slug>) — that's the link Google's quality classifiers
 * follow to verify authorship.
 *
 * Returns null if the page has no author block (draft / unattributed).
 */
export function generateArticleSchema(opts: {
  headline: string;
  description: string;
  url: string;
  datePublished?: string;
  dateModified?: string;
  author: {
    name: string;
    profileUrl?: string;
    bio?: string;
    credentials?: string;
    sameAs?: string[];
  } | null | undefined;
  editor?: {
    name: string;
    profileUrl?: string;
    sameAs?: string[];
  } | null;
}) {
  if (!opts.author || !opts.author.name) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.headline,
    description: opts.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': opts.url },
    url: opts.url,
    ...(opts.datePublished ? { datePublished: opts.datePublished } : {}),
    ...(opts.dateModified ? { dateModified: opts.dateModified } : {}),
    author: {
      '@type': 'Person',
      name: opts.author.name,
      ...(opts.author.profileUrl ? { url: opts.author.profileUrl } : {}),
      ...(opts.author.bio ? { description: opts.author.bio } : {}),
      ...(opts.author.credentials ? { jobTitle: opts.author.credentials } : {}),
      ...(opts.author.sameAs && opts.author.sameAs.length > 0 ? { sameAs: opts.author.sameAs } : {}),
    },
    ...(opts.editor
      ? {
          editor: {
            '@type': 'Person',
            name: opts.editor.name,
            ...(opts.editor.profileUrl ? { url: opts.editor.profileUrl } : {}),
            ...(opts.editor.sameAs && opts.editor.sameAs.length > 0
              ? { sameAs: opts.editor.sameAs }
              : {}),
          },
        }
      : {}),
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
      item: `${SITE_URL}${BASE_PATH}${item.url}`,
    })),
  };
}
