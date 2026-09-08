import type { MetadataRoute } from 'next';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';

export const dynamic = 'force-static';

/**
 * Free site: allow everything, point at the sitemap.
 * Pro deployment: crawlable but noindex. A robots Disallow would stop crawlers
 * from ever READING the noindex on pages the free site links to, so the
 * pages could still be indexed from links alone (audit 2026-09-08). The
 * meta noindex + the X-Robots-Tag header (next.config.ts) do the real work;
 * there is deliberately no sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  if (IS_PRO_DEPLOYMENT) {
    return { rules: { userAgent: '*', allow: '/' } };
  }
  return {
    // /adtest/* are deliberately ad-shaped bait files for the Ad-Blocker Test.
    rules: { userAgent: '*', allow: '/', disallow: '/adtest/' },
    sitemap: 'https://incognitobrowser.io/resources/sitemap.xml',
  };
}
