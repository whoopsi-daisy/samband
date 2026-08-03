import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

// Rendered per request, not baked at build. The host comes from the
// environment the container starts with, which is not the one it was built in:
// prerendered, the sitemap named the fallback host while the canonical link on
// the same site named the configured one.
export const dynamic = 'force-dynamic';

/**
 * Two entries, because there are two pages.
 *
 * The views are query parameters on the same route, so listing them would be
 * listing one page four times under different addresses, which is exactly the
 * duplication a sitemap exists to avoid. Individual events are not listed
 * either: they come and go on a weekly cycle, and a sitemap of a hundred
 * thousand URLs that mostly 404 within the month helps nobody.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();

  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1,
    },
    {
      url: `${base}/om`,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
  ];
}
