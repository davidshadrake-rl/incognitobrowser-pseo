import type { MetadataRoute } from 'next';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';

export const dynamic = 'force-static';

/**
 * Free site: allow everything, point at the sitemap.
 * Pro deployment: disallow everything — it's a product surface (gate coming),
 * noindex sitewide, and must not compete with the free site for the same content.
 */
export default function robots(): MetadataRoute.Robots {
  if (IS_PRO_DEPLOYMENT) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://incognitobrowser.io/resources/sitemap.xml',
  };
}
