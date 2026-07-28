import { NextRequest, NextResponse } from 'next/server';
import { getMapEvents } from '@/lib/db';
import { formatEventForUi, sanitizeLocation, sanitizeType, sanitizeSearch } from '@/lib/utils';
import { checkRateLimit, rateLimitResponse, addRateLimitHeaders } from '@/lib/rateLimit';

// Events for the map view, fetched when the user actually opens the map.
//
// These used to be embedded in the home page's payload on every request, which
// meant ~500 events were serialised into the HTML even for visitors who never
// left the list view. The query behind getMapEvents is cached per filter set
// and dropped whenever a fetch changes the rows.

export async function GET(request: NextRequest) {
  const rateLimitResult = checkRateLimit(request);
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(rateLimitResult);
  }

  const searchParams = request.nextUrl.searchParams;
  const filters = {
    location: searchParams.get('location') ? sanitizeLocation(searchParams.get('location')!) : undefined,
    type: searchParams.get('type') ? sanitizeType(searchParams.get('type')!) : undefined,
    search: searchParams.get('search') ? sanitizeSearch(searchParams.get('search')!) : undefined,
  };

  try {
    const events = getMapEvents(filters);
    const response = NextResponse.json({ events: events.map(formatEventForUi) });
    // Deliberately uncacheable over HTTP. The payload carries relative times
    // and a "new events" banner depends on this endpoint answering with the
    // current rows, so a browser or proxy holding a copy would show a feed
    // that quietly stopped moving.
    response.headers.set('Cache-Control', 'no-store');
    return addRateLimitHeaders(response, rateLimitResult);
  } catch (error) {
    console.error('Error fetching map events:', error);
    return NextResponse.json({ error: 'Failed to fetch map events' }, { status: 500 });
  }
}
