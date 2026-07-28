import { Suspense } from 'react';
import { getEventsFromDb, getEventById, countEventsInDb, getFilterOptions, getStatsSummary } from '@/lib/db';
import { refreshEventsIfNeeded } from '@/lib/policeApi';
import { formatEventForUi, sanitizeLocation, sanitizeType, sanitizeSearch } from '@/lib/utils';
import ClientApp from '@/components/ClientApp';

const EVENTS_PER_PAGE = 40;
const ALLOWED_VIEWS = ['list', 'map', 'stats'];

// Revalidate every 10 minutes to match the polisen.se API fetch interval
export const revalidate = 600;

interface PageProps {
  searchParams: Promise<{
    view?: string;
    location?: string;
    type?: string;
    search?: string;
    event?: string;
  }>;
}

async function HomeContent({ searchParams }: PageProps) {
  // Await the searchParams
  const params = await searchParams;

  // Refresh events from API if needed
  await refreshEventsIfNeeded();

  // Sanitize and validate inputs
  const filters = {
    location: params.location ? sanitizeLocation(params.location) : '',
    type: params.type ? sanitizeType(params.type) : '',
    search: params.search ? sanitizeSearch(params.search) : '',
  };

  let currentView = params.view || 'list';
  if (!ALLOWED_VIEWS.includes(currentView)) {
    currentView = 'list';
  }

  // Paging past the first page is the list's own job, over /api/events. A
  // `?page=` here only ever produced a feed with an unreachable beginning.
  const events = getEventsFromDb(filters, EVENTS_PER_PAGE, 0);
  const totalEvents = countEventsInDb(filters);
  const hasMore = EVENTS_PER_PAGE < totalEvents;

  // Map events are deliberately NOT fetched here — the map loads them from
  // /api/map when it is opened. Embedding them added ~500 events to every
  // page payload, including for visitors who never leave the list view.

  // Format events for UI
  const formattedEvents = events.map(formatEventForUi);

  // Get filter options and stats
  const locations = getFilterOptions('location_name');
  const types = getFilterOptions('type');
  const stats = getStatsSummary();

  // A shared link (?event=123). The first page covers well under a day, so the
  // linked event is usually not in it — look it up directly and hand it to the
  // list, which pins it above the feed. Resolving it here also means the page
  // can say the event no longer exists instead of quietly rendering the feed.
  const parsedEventId = params.event ? parseInt(params.event, 10) : NaN;
  const highlightedEventId = Number.isNaN(parsedEventId) ? null : parsedEventId;
  const inFirstPage = formattedEvents.some((event) => event.id === highlightedEventId);
  const linkedRow = highlightedEventId !== null && !inFirstPage ? getEventById(highlightedEventId) : null;

  return (
    <ClientApp
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
