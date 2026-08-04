import { NextResponse } from 'next/server';
import { getDatabase, getLastFetchTime, countTrailingEmptyFetches } from '@/lib/db';

// Liveness/readiness probe for the container healthcheck and any external
// monitoring. Kept free of rate limiting so a probe can never lock itself out.
export const dynamic = 'force-dynamic';

// A fetch is expected every 10 minutes; allow a generous margin before the app
// is called unhealthy, so a single failed poll or a slow polisen.se does not
// restart a container that is otherwise serving fine.
const STALE_AFTER_MINUTES = 60;

/**
 * Consecutive empty-but-successful fetches before the feed counts as stalled.
 *
 * This probe used to ask only how long ago the last fetch was, and an upstream
 * returning `[]` answers that question perfectly: the fetch happened, it
 * succeeded, freshness is zero minutes. So a feed that had silently stopped
 * carrying events looked *healthier* than one that was merely slow, and nothing
 * in the system would ever have said otherwise.
 *
 * Six is an hour at the ten-minute cadence. A national incident feed does not
 * go an hour with nothing in it; if it does, that is worth a look either way.
 */
const EMPTY_FETCHES_BEFORE_STALLED = 6;

export async function GET() {
  try {
    const db = getDatabase();
    const { count } = db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };

    const lastFetch = getLastFetchTime();
    const ageMinutes = lastFetch
      ? Math.round((Date.now() - lastFetch.getTime()) / 60000)
      : null;

    // A database that has never been fetched into is still "starting", not
    // broken: report healthy so a fresh container passes its first probes.
    const stale = ageMinutes !== null && ageMinutes > STALE_AFTER_MINUTES;

    const emptyFetches = countTrailingEmptyFetches();
    const stalled = emptyFetches >= EMPTY_FETCHES_BEFORE_STALLED;
    const degraded = stale || stalled;

    return NextResponse.json(
      {
        status: degraded ? 'degraded' : 'ok',
        events: count,
        lastFetch: lastFetch?.toISOString() ?? null,
        lastFetchAgeMinutes: ageMinutes,
        // Named, so a monitor can tell the two apart: "we cannot reach them"
        // and "they are answering with nothing" call for different responses.
        reason: stale ? 'stale' : stalled ? 'empty-feed' : null,
        consecutiveEmptyFetches: emptyFetches,
      },
      { status: degraded ? 503 : 200 }
    );
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
