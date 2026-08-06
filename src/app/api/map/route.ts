import { NextRequest, NextResponse } from 'next/server';
import { getMapEvents } from '@/lib/db';
import { formatEventForMap, sanitizeLocation, sanitizeType, sanitizeSearch } from '@/lib/utils';
import { resolveRegionFilters } from '@/lib/regions';
import { jsonResponse } from '@/lib/apiResponse';
import { checkRateLimit, rateLimitResponse, addRateLimitHeaders } from '@/lib/rateLimit';
import { logger } from '@/lib/log';
import { DEFAULT_MAP_WINDOW_DAYS, MAX_MAP_WINDOW_DAYS } from '@/lib/mapWindows';

const log = logger('api:map');

// Events for the map view, fetched when the user actually opens the map.
//
// These used to be embedded in the home page's payload on every request, which
// meant ~500 events were serialised into the HTML even for visitors who never
// left the list view. The query behind getMapEvents is cached per filter set
// and dropped whenever a fetch changes the rows.

// The longest window the map offers is MAX_MAP_WINDOW_DAYS, derived from the
// control itself in lib/mapWindows. It used to be a 30 restated here with its
// own copy of the reasoning, which is a thing that drifts the first time the
// control gains a period.

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult);
  }

  const searchParams = request.nextUrl.searchParams;

  // How far back the map is looking. Bounded so a runaway or hand-typed value
  // cannot ask the database for the whole archive.
  const days = Number(searchParams.get('dagar'));
  const windowDays = Number.isFinite(days)
    ? Math.min(Math.max(Math.round(days), 1), MAX_MAP_WINDOW_DAYS)
    : DEFAULT_MAP_WINDOW_DAYS;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // countyOf is the sanitiser for the county: only ever one of the twenty-one
  // canonical names, and forgiving of the spellings a shared link may carry.
  // resolveRegionFilters also folds a place that is really a county into the
  // county filter, so this endpoint and the page it feeds agree on what a
  // request for one means.
  const region = resolveRegionFilters(
    searchParams.get('county'),
    searchParams.get('location') ? sanitizeLocation(searchParams.get('location')!) : ''
  );

  const filters = {
    county: region.county || undefined,
    location: region.location || undefined,
    type: searchParams.get('type') ? sanitizeType(searchParams.get('type')!) : undefined,
    search: searchParams.get('search') ? sanitizeSearch(searchParams.get('search')!) : undefined,
  };

  try {
    const { rows, total } = getMapEvents(filters, since);
    // `total` is every notice in the window; `events` may be fewer, because the
    // query is capped. The map says so rather than presenting a slice as the
    // whole period, which is what "500 händelser den senaste månaden" did.
    const response = jsonResponse(request, { events: rows.map(formatEventForMap), total });
    // Deliberately uncacheable over HTTP. The payload carries relative times
    // and a "new events" banner depends on this endpoint answering with the
    // current rows, so a browser or proxy holding a copy would show a feed
    // that quietly stopped moving.
    response.headers.set('Cache-Control', 'no-store');
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error) {
    log.error('could not read map events', error);
    return NextResponse.json({ error: 'Failed to fetch map events' }, { status: 500 });
  }
}
