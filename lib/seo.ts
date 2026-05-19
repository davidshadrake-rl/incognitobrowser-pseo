import type { Metadata } from 'next';

const SITE_URL = 'https://incognitobrowser.io';
const BASE_PATH = '/resources';
const SITE_NAME = 'Incognito Browser';

interface SEOParams {
  title: string;
  description: string;
  path: string;
  type?: 'article' | 'website';
  noIndex?: boolean;
}

export function generateMetadata({ title, description, path, type = 'article', noIndex = false }: SEOParams): Metadata {
  const url = `${SITE_URL}${BASE_PATH}${path}`;
  const fullTitle = `${title} | ${SITE_NAME}`;

  return {
    title: fullTitle,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      type,
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
    },
    // noindex,follow: don't surface in SERPs, but keep crawling internal links so
    // the link graph still propagates when pages get promoted to 'published'.
    robots: noIndex ? { index: false, follow: true } : undefined,
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
  } | null | undefined;
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
    },
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
