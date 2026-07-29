import { NextResponse } from 'next/server';
import { getDatabase, getLastFetchTime } from '@/lib/db';

// Liveness/readiness probe for the container healthcheck and any external
// monitoring. Kept free of rate limiting so a probe can never lock itself out.
export const dynamic = 'force-dynamic';

// A fetch is expected every 10 minutes; allow a generous margin before the app
// is called unhealthy, so a single failed poll or a slow polisen.se does not
// restart a container that is otherwise serving fine.
const STALE_AFTER_MINUTES = 60;

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

    return NextResponse.json(
      {
        status: stale ? 'degraded' : 'ok',
        events: count,
        lastFetch: lastFetch?.toISOString() ?? null,
        lastFetchAgeMinutes: ageMinutes,
      },
      { status: stale ? 503 : 200 }
    );
  } catch (error) {
    console.error('Health check failed:', error);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
