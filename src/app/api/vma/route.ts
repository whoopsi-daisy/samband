import { NextRequest, NextResponse } from 'next/server';
import { getVmaAlerts, liveAlerts } from '@/lib/vmaApi';
import { checkRateLimit, rateLimitResponse, addRateLimitHeaders } from '@/lib/rateLimit';

/**
 * Current warnings, from Sveriges Radio's VMA API.
 *
 * Proxied rather than fetched from the browser: it keeps connect-src closed,
 * one request serves every reader through the cache in vmaApi, and SR gets
 * one caller instead of one per visitor.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult);
  }

  const { alerts, failed } = await getVmaAlerts();

  const response = NextResponse.json({
    // Everything the API returned, for the page.
    alerts,
    // The subset that is a live emergency, for the ribbon.
    live: liveAlerts(alerts),
    // So the page can say "we could not reach SR" rather than "all clear",
    // which are very different things to tell someone.
    failed,
    checkedAt: new Date().toISOString(),
  });

  // A warning that arrives late is a warning that failed. Nothing between here
  // and the reader may hold a copy; the one-minute cache in vmaApi is what
  // keeps this from hammering SR.
  response.headers.set('Cache-Control', 'no-store');
  return addRateLimitHeaders(response, rateLimitResult);
}
