import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

// Rendered per request, not baked at build. The host comes from the
// environment the container starts with, which is not the one it was built in:
// prerendered, robots.txt named the fallback host while the canonical link on
// the same site named the configured one.
export const dynamic = 'force-dynamic';

/**
 * What a crawler may look at.
 *
 * The feed and the about page are the site. /stats is an operator's dashboard
 * behind a login, and /api answers with JSON that means nothing out of
 * context: neither belongs in a search result, and a 401 in an index is worse
 * than useless. Disallowing them is not a security measure, it is tidiness;
 * the login is the security measure.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/stats', '/api/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
