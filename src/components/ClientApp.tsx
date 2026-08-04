'use client';

import { useState, useCallback, Suspense, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from './Header';
import BottomNav from './BottomNav';
import Filters from './Filters';
import EventList from './EventList';
import EventMap, { MAP_WINDOW_DAYS } from './EventMap';
import StatsView from './StatsView';
import VmaView from './VmaView';
import VmaRibbon from './VmaRibbon';
import Footer from './Footer';
import ScrollToTop from './ScrollToTop';
import RadioCheck from './RadioCheck';
import MapModal from './MapModal';
import ErrorBoundary from './ErrorBoundary';
import { VIEWS } from './views';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMapEvents } from '@/hooks/useMapEvents';
import { useVma } from '@/hooks/useVma';
import { FormattedEvent, Statistics } from '@/types';
import { QUERY, ViewId, readParam, toSwedishParams, viewSlug } from '@/lib/urlParams';
import { isCountyName } from '@/lib/regions';

interface ClientAppProps {
  initialEvents: FormattedEvent[];
  /** Every event matching the current filters, not just the first page. */
  totalEvents: number;
  hasMore: boolean;
  counties: string[];
  locations: string[];
  types: string[];
  stats: Statistics;
  filters: {
    county: string;
    location: string;
    type: string;
    search: string;
  };
  initialView: string;
  highlightedEventId: number | null;
  /** A ?handelse= link whose event is not in the first page. */
  linkedEvent: FormattedEvent | null;
  /** A ?handelse= link whose event no longer exists. */
  linkedEventMissing: boolean;
}

/**
 * What each view is, in the reader's words. Shown as the page heading so that
 * arriving on any of the three states up front says what is being looked at
 * rather than opening straight onto a control strip.
 */
const VIEW_INTRO: Record<string, { title: string; lede: string; quietTitle?: boolean }> = {
  list: {
    title: 'Senaste händelserna',
    lede: 'Polisens händelsenotiser från hela Sverige, nyast först. Tryck på en händelse för att läsa hela texten.',
  },
  map: {
    title: 'Händelser på karta',
    lede: 'Var polisen skrev sina anmälningar den senaste tiden. Tryck på en punkt för att se vad som hänt där.',
  },
  vma: {
    title: 'Viktigt meddelande till allmänheten',
    lede: 'Varningar från Sveriges Radio när det finns omedelbar fara för liv, hälsa eller egendom.',
  },
  stats: {
    title: 'Statistik',
    // Off the page, not out of it. Every block below is an h2, so deleting the
    // h1 outright would leave the view with no top-level heading at all: a
    // screen reader's heading list would start midway down and the browser tab
    // would be the only thing naming the page.
    quietTitle: true,
    // No lede: every block on this view opens with its own, and a page-level
    // one on top of "Den senaste tiden" said the same thing twice before the
    // reader reached a single number.
    lede: '',
  },
};

function ClientAppContent({
  initialEvents,
  totalEvents,
  hasMore,
  counties,
  locations,
  types,
  stats,
  filters,
  initialView,
  highlightedEventId,
  linkedEvent,
  linkedEventMissing,
}: ClientAppProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentView, setCurrentView] = useState(initialView);

  /*
   * Follow the URL when something other than a click changes it.
   *
   * Kept as state rather than read from the URL directly so that pressing a
   * view button switches immediately instead of after the server round trip
   * that navigation starts. The cost of that is this effect: every view is the
   * same route with a different query, so the component never unmounts, and
   * seeding the state once from the prop meant it was seeded on first load and
   * never again. Back out of the statistics and the URL said the feed while the
   * page still showed the statistics, which is the browser's own control
   * appearing not to work.
   *
   * Same pattern, and the same reason, as the filter selects in Filters.tsx.
   */
  useEffect(() => setCurrentView(initialView), [initialView]);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [mapModal, setMapModal] = useState<{
    isOpen: boolean;
    lat: number;
    lng: number;
    location: string;
  }>({ isOpen: false, lat: 0, lng: 0, location: '' });

  const handleViewChange = useCallback(
    (view: string) => {
      setCurrentView(view);
      // toSwedishParams on every write, so a link shared under the old English
      // names is rewritten the first time the reader touches anything.
      const params = toSwedishParams(new URLSearchParams(searchParams.toString()));
      params.set(QUERY.view, viewSlug(view as ViewId));
      router.push(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const handleShowMap = useCallback((lat: number, lng: number, location: string) => {
    setMapModal({ isOpen: true, lat, lng, location });
  }, []);

  const handleCloseMapModal = useCallback(() => {
    setMapModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleFacetClick = useCallback(
    (key: 'type' | 'location' | 'county', value: string) => {
      setCurrentView('list');
      const params = toSwedishParams(new URLSearchParams(searchParams.toString()));
      params.set(QUERY.view, viewSlug('list'));

      /*
       * "Vanligaste platser" lists the location strings the notices carry, and
       * a great many of them are the county alone, so a row there can read
       * "Blekinge län". Sent as a place it would set a second filter beside the
       * county one and return only the notices where an officer typed the
       * county. The filters collapse it on read either way; doing it here means
       * the URL that gets shared says what was actually applied.
       */
      const facet = key === 'location' && isCountyName(value) ? 'county' : key;
      if (facet === 'county') params.delete(QUERY.location);
      params.set(QUERY[facet], value);

      router.push(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const handleTypeClick = useCallback(
    (type: string) => handleFacetClick('type', type),
    [handleFacetClick]
  );

  const handleLocationClick = useCallback(
    (location: string) => handleFacetClick('location', location),
    [handleFacetClick]
  );

  const handleCountyClick = useCallback(
    (county: string) => handleFacetClick('county', county),
    [handleFacetClick]
  );

  // Navigate home: reset view to list and clear all filters
  const handleLogoClick = useCallback(() => {
    setCurrentView('list');
    router.push('/', { scroll: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [router]);

  const focusSearch = useCallback(() => {
    const searchInput = document.querySelector('.search-input') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // The number keys address the nav by position, so they cannot drift out of
  // step with it the way three hard-coded handlers did.
  const selectViewByIndex = useCallback(
    (index: number) => {
      const view = VIEWS[index];
      if (view) handleViewChange(view.id);
    },
    [handleViewChange]
  );

  const shortcutHandlers = useMemo(
    () => ({
      onSearch: focusSearch,
      onEscape: handleCloseMapModal,
      onSelectView: selectViewByIndex,
      onScrollTop: scrollToTop,
    }),
    [focusSearch, handleCloseMapModal, selectViewByIndex, scrollToTop]
  );

  useKeyboardShortcuts(shortcutHandlers);

  /*
   * Clears the filters, and only the filters.
   *
   * This built a fresh query from nothing, which also threw away the map's
   * period and the county map's type: "Rensa alla" sits under an empty feed and
   * offers to widen the search, and it was silently resetting what the reader
   * was looking at as well. The same control inside Filters already deleted
   * only the four filter parameters; these two now agree.
   */
  const clearFilters = useCallback(() => {
    const params = toSwedishParams(new URLSearchParams(searchParams.toString()));
    params.set(QUERY.view, viewSlug(currentView as ViewId));
    params.delete(QUERY.county);
    params.delete(QUERY.location);
    params.delete(QUERY.type);
    params.delete(QUERY.search);
    router.push(`/?${params.toString()}`, { scroll: false });
  }, [currentView, router, searchParams]);

  /*
   * How far back the map is looking, and which type the county map is showing.
   *
   * Both read from the URL rather than from component state. They were state,
   * on the reasoning that they are ways of looking at the filters rather than
   * part of what is being looked at, and that distinction is not one a reader
   * makes: neither survived a refresh, the back button or a shared link, so a
   * map set to the last month snapped back to the last day and a link to what
   * someone was looking at did not show it.
   *
   * Reading them straight from `searchParams` rather than mirroring them into
   * state is what makes back and forward work: the URL is the only copy, so
   * history navigation cannot leave a control disagreeing with it.
   */
  const mapWindowDays = useMemo(() => {
    const days = Number(readParam((name) => searchParams.get(name), 'mapDays'));
    return MAP_WINDOW_DAYS.includes(days) ? days : 1;
  }, [searchParams]);

  const regionType = useMemo(() => {
    const value = readParam((name) => searchParams.get(name), 'regionType');
    // Only a type the breakdown actually offers. A stale or hand-typed one
    // would otherwise leave the select showing a value it has no option for.
    return stats.regionTypes.types.includes(value) ? value : '';
  }, [searchParams, stats.regionTypes.types]);

  // Narrowing a view is not navigation, so neither of these gets its own
  // history entry: `replace`, as the filter controls already do.
  const setMapWindowDays = useCallback(
    (days: number) => {
      const params = toSwedishParams(new URLSearchParams(searchParams.toString()));
      if (days === 1) params.delete(QUERY.mapDays);
      else params.set(QUERY.mapDays, String(days));
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const handleRegionTypeChange = useCallback(
    (type: string) => {
      const params = toSwedishParams(new URLSearchParams(searchParams.toString()));
      if (type) params.set(QUERY.regionType, type);
      else params.delete(QUERY.regionType);
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Map data loads on demand the first time the map view is opened.
  const map = useMapEvents(filters, currentView === 'map', mapWindowDays);

  const showList = useCallback(() => handleViewChange('list'), [handleViewChange]);
  const showVma = useCallback(() => handleViewChange('vma'), [handleViewChange]);

  // Warnings load on every view, not just the VMA one: the ribbon has to be
  // able to appear over the feed and the map too.
  const vma = useVma();

  const intro = VIEW_INTRO[currentView] ?? VIEW_INTRO.list;

  /**
   * Name the tab after the view.
   *
   * The views are client state rather than routes, so every one of them shared
   * the one title from the metadata: four open tabs, four identical labels, and
   * a browser history where every entry read "Sambandscentralen: polishändelser
   * i realtid" whichever view it went back to. The document title is the label
   * on the tab, the history entry and the bookmark, and it is the first thing a
   * screen reader reads on arrival.
   */
  useEffect(() => {
    document.title = `${intro.title} · Sambandscentralen`;
  }, [intro.title]);

  return (
    <>
      {/* Above the header, so it is the first thing on the page whatever view
          the reader is on and wherever they navigate next. */}
      <VmaRibbon alerts={vma.live} onOpen={showVma} />
      <RadioCheck />
      <Header currentView={currentView} onViewChange={handleViewChange} onLogoClick={handleLogoClick} />

      <main id="main-content" tabIndex={-1}>
        <div className="view-header">
          <h1 className={intro.quietTitle ? 'sr-only' : undefined}>{intro.title}</h1>
          {intro.lede && <p>{intro.lede}</p>}
        </div>

        {/* The map reads the same filters as the list, so the controls belong
            on both. Without them a filter set on the list silently narrowed the
            map, with nothing on screen saying so or able to undo it. */}
        {(currentView === 'list' || currentView === 'map') && (
          <Filters
            counties={counties}
            locations={locations}
            types={types}
            currentView={currentView}
            filters={filters}
          />
        )}

        {currentView === 'list' && (
          <EventList
            initialEvents={initialEvents}
            initialTotal={totalEvents}
            initialHasMore={hasMore}
            filters={filters}
            currentView={currentView}
            onShowMap={handleShowMap}
            highlightedEventId={highlightedEventId}
            linkedEvent={linkedEvent}
            linkedEventMissing={linkedEventMissing}
            onLastCheckedChange={setLastChecked}
            onClearFilters={clearFilters}
          />
        )}

        {/* Kept mounted across view switches so the Leaflet instance and its
            loaded tiles survive a trip to the list and back. */}
        <EventMap
          events={map.events}
          total={map.total}
          isActive={currentView === 'map'}
          windowDays={mapWindowDays}
          onWindowChange={setMapWindowDays}
          loading={map.loading}
          error={map.error}
          onRetry={map.retry}
          onShowList={showList}
          isFiltered={Boolean(filters.county || filters.location || filters.type || filters.search)}
        />

        {currentView === 'vma' && (
          <VmaView
            alerts={vma.alerts}
            live={vma.live}
            failed={vma.failed}
            loading={vma.loading}
            onRetry={vma.refresh}
          />
        )}

        {currentView === 'stats' && (
          <StatsView
            stats={stats}
            onTypeClick={handleTypeClick}
            onLocationClick={handleLocationClick}
            onCountyClick={handleCountyClick}
            regionType={regionType}
            onRegionTypeChange={handleRegionTypeChange}
          />
        )}
      </main>

      <Footer lastChecked={lastChecked} />
      <BottomNav currentView={currentView} onViewChange={handleViewChange} />
      <ScrollToTop />

      <MapModal
        isOpen={mapModal.isOpen}
        lat={mapModal.lat}
        lng={mapModal.lng}
        location={mapModal.location}
        onClose={handleCloseMapModal}
      />
    </>
  );
}

export default function ClientApp(props: ClientAppProps) {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <main id="main-content">
            <div className="loading-center">
              <div className="spinner" />
            </div>
          </main>
        }
      >
        <ClientAppContent {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
