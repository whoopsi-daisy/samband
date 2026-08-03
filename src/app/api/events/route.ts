import { NextRequest, NextResponse } from 'next/server';
import { getEventsFromDb, countEventsInDb } from '@/lib/db';
import { refreshEventsIfNeeded } from '@/lib/policeApi';
import { formatEventForUi, sanitizeLocation, sanitizeType, sanitizeSearch } from '@/lib/utils';
import { checkRateLimit, rateLimitResponse, addRateLimitHeaders } from '@/lib/rateLimit';

const EVENTS_PER_PAGE = 40;

/**
 * How deep the feed can be paged.
 *
 * `page` was taken as given, and the union query asks each source for
 * `limit + offset` rows before sorting them together, so the cost of a request
 * rose with the number in the URL. Against a 338,000-row archive, page=1 answers
 * in 150ms and page=8000 in 950ms.
 *
 * better-sqlite3 is synchronous, so that time is not spent waiting on a socket:
 * it is the event loop, blocked. Five concurrent requests at page=99999999 took
 * /api/health from 6ms to 4.2s, which is past the container healthcheck's 5s
 * timeout and inside the margin that gets a healthy container restarted. No
 * login needed, and one IP's 60 requests a minute is 54 seconds of it.
 *
 * 500 pages is 20,000 events deep, well past anything the feed's own
 * infinite scroll reaches, and it holds the worst case near 200ms. Reaching
 * further back is what the filters and the search are for, and they answer from
 * an index rather than by counting past the rows they skip.
 */
const MAX_PAGE = 500;

export async function GET(request: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult);
  }

  // Refresh events if needed
  await refreshEventsIfNeeded();

  const searchParams = request.nextUrl.searchParams;
  const requested = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const page = Math.min(requested, MAX_PAGE);
  const offset = (page - 1) * EVENTS_PER_PAGE;

  const filters = {
    location: searchParams.get('location') ? sanitizeLocation(searchParams.get('location')!) : undefined,
    type: searchParams.get('type') ? sanitizeType(searchParams.get('type')!) : undefined,
    search: searchParams.get('search') ? sanitizeSearch(searchParams.get('search')!) : undefined,
  };

  try {
    const events = getEventsFromDb(filters, EVENTS_PER_PAGE, offset);
    const total = countEventsInDb(filters);
    const formattedEvents = events.map(formatEventForUi);

    const response = NextResponse.json({
      events: formattedEvents,
      // False at the cap, or the feed's infinite scroll would ask for page 501,
      // be handed page 500 again, and append the same forty rows for ever.
      hasMore: page < MAX_PAGE && offset + EVENTS_PER_PAGE < total,
      total,
    });
    // See the note in the map route: "N nya händelser" refreshes through here,
    // and a cached page 1 would refresh the feed into exactly what it already
    // showed.
    response.headers.set('Cache-Control', 'no-store');
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}
