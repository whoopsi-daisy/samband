/**
 * The address this deployment is served from.
 *
 * Needed absolutely, not relatively: share images, canonical links, the
 * sitemap and robots.txt all have to name a host, and nothing inside the
 * container knows one.
 *
 * SITE_URL, and deliberately not NEXT_PUBLIC_SITE_URL. Anything with that
 * prefix is inlined into the bundle when the app is built, and this app ships
 * as a prebuilt image: the operator setting it is doing so hours after the
 * build, on a machine that never ran one. It was read that way first, and
 * robots.txt and the sitemap came out naming the fallback host while the
 * canonical link on the same page named the right one. The prefixed name is
 * still accepted for anyone who does build their own.
 *
 * The fallback exists so a build never fails over it, but a deployment on a
 * different domain that leaves it unset publishes share cards pointing at
 * somewhere else, which nobody notices until a link is posted in public.
 * instrumentation warns about it at startup.
 */
const FALLBACK = 'https://samband.unicast.space';

function configured(): string | undefined {
  return process.env.SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
}

export function siteUrl(): string {
  const value = configured();
  if (!value) return FALLBACK;
  // Tolerate a trailing slash, and a host written without a scheme.
  const withScheme = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}

export function isSiteUrlConfigured(): boolean {
  return Boolean(configured());
}
