import { Suspense } from 'react';
import { getEventsFromDb, getEventById, countEventsInDb, getFilterOptions, getStatsSummary } from '@/lib/db';
import { refreshEventsIfNeeded } from '@/lib/policeApi';
import { COUNTIES, resolveRegionFilters } from '@/lib/regions';
import {
  formatEventForUi,
  resolveDateRange,
  sanitizeLocation,
  sanitizeType,
  sanitizeSearch,
} from '@/lib/utils';
import ClientApp from '@/components/ClientApp';
import { parseView, readParam } from '@/lib/urlParams';

const EVENTS_PER_PAGE = 40;

/*
 * This page is dynamic, and deliberately so.
 *
 * There used to be an `export const revalidate = 600` here, commented as
 * matching the polisen.se fetch interval. It never did anything: the component
 * awaits `searchParams`, which opts the route out of static rendering entirely,
 * so there was no cached render for a revalidation window to apply to. Every
 * request already re-ran the queries, and the comment claimed a caching layer
 * that was not there for anyone reading the file afterwards.
 *
 * What actually keeps this cheap is the TTL memoisation in lib/cache: the
 * statistics, the filter options and the archive counts are computed once and
 * shared across requests, and both paths that change the data invalidate them
 * explicitly. That is the caching, and it lives where it can be seen.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  // Loosely typed on purpose: the same value can arrive under a Swedish name
  // or the English one a shared link still carries, and urlParams owns which.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function HomeContent({ searchParams }: PageProps) {
  // Await the searchParams
  const params = await searchParams;

  // Refresh events from API if needed
  await refreshEventsIfNeeded();

  // Sanitize and validate inputs
  const get = (name: string) => {
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  };

  // countyOf is the sanitiser for the county: it only ever returns one of the
  // twenty-one canonical names, and it forgives the spellings a hand-typed or
  // shared link might carry ("Skåne", "skane län", a municipality inside it).
  // resolveRegionFilters additionally folds a place that is really a county
  // into the county filter, so the two controls cannot both be set to the same
  // area and return the intersection.
  const region = resolveRegionFilters(
    readParam(get, 'county'),
    sanitizeLocation(readParam(get, 'location'))
  );

  // The two ends of a date range, as Swedish calendar days. Anything
  // unparseable is dropped rather than guessed at, and a range typed backwards
  // is swapped: someone who wrote it that way meant the span between them.
  const range = resolveDateRange(readParam(get, 'from'), readParam(get, 'to'));

  // What the controls show: the reader's own words, including the two dates as
  // they typed them.
  const filters = {
    county: region.county,
    location: region.location,
    type: sanitizeType(readParam(get, 'type')),
    search: sanitizeSearch(readParam(get, 'search')),
    from: range.from,
    to: range.to,
  };

  // What the queries compare against: the same range as the two instants that
  // bound it, which is a detail the UI has no use for.
  const queryFilters = { ...filters, since: range.since, until: range.until };

  const currentView = parseView(readParam(get, 'view'));

  // Paging past the first page is the list's own job, over /api/events. A
  // `?page=` here only ever produced a feed with an unreachable beginning.
  const events = getEventsFromDb(queryFilters, EVENTS_PER_PAGE, 0);
  const totalEvents = countEventsInDb(queryFilters);
  const hasMore = EVENTS_PER_PAGE < totalEvents;

  // Map events are deliberately NOT fetched here: the map loads them from
  // /api/map when it is opened. Embedding them added ~500 events to every
  // page payload, including for visitors who never leave the list view.

  // Format events for UI
  const formattedEvents = events.map(formatEventForUi);

  // Get filter options and stats
  /*
   * All twenty-one, always.
   *
   * The place dropdown beside it is derived from the data because there is no
   * canonical list of place names: the feed invents them, and only the database
   * knows which exist. Counties are not that. They are a fixed administrative
   * taxonomy, and querying which ones happen to have a row costs 117 ms over a
   * 338,000-row archive to return, every time, all twenty-one.
   *
   * It would also make the control less predictable rather than more: a list
   * that grows as data arrives means "why is Jämtland missing today" — a harder
   * question than "why does Jämtland show nothing", which the empty state
   * already answers with a way out.
   */
  const counties = [...COUNTIES];
  const locations = getFilterOptions('location_name');
  const types = getFilterOptions('type');
  const stats = getStatsSummary();

  // A shared link (?handelse=123). The first page covers well under a day, so the
  // linked event is usually not in it: look it up directly and hand it to the
  // list, which pins it above the feed. Resolving it here also means the page
  // can say the event no longer exists instead of quietly rendering the feed.
  const parsedEventId = parseInt(readParam(get, 'event'), 10);
  const highlightedEventId = Number.isNaN(parsedEventId) ? null : parsedEventId;
  const inFirstPage = formattedEvents.some((event) => event.id === highlightedEventId);
  const linkedRow = highlightedEventId !== null && !inFirstPage ? getEventById(highlightedEventId) : null;

  return (
    <ClientApp
      counties={counties}
      initialEvents={formattedEvents}
      totalEvents={totalEvents}
      hasMore={hasMore}
      locations={locations}
      types={types}
      stats={stats}
      filters={filters}
      initialView={currentView}
      highlightedEventId={highlightedEventId}
      linkedEvent={linkedRow ? formatEventForUi(linkedRow) : null}
      linkedEventMissing={highlightedEventId !== null && !inFirstPage && !linkedRow}
    />
  );
}

export default function Home(props: PageProps) {
  return (
    <Suspense
      fallback={
        <main id="main-content">
          <div className="loading-center">
            <div className="spinner" />
          </div>
        </main>
      }
    >
      <HomeContent {...props} />
    </Suspense>
  );
}
