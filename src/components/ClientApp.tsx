'use client';

import { useState, useCallback, Suspense, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from './Header';
import BottomNav from './BottomNav';
import Filters from './Filters';
import EventList from './EventList';
import EventMap from './EventMap';
import StatsView from './StatsView';
import VmaView from './VmaView';
import VmaRibbon from './VmaRibbon';
import Footer from './Footer';
import ScrollToTop from './ScrollToTop';
import RadioCheck from './RadioCheck';
import MapModal from './MapModal';
import ErrorBoundary from './ErrorBoundary';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMapEvents } from '@/hooks/useMapEvents';
import { useVma } from '@/hooks/useVma';
import { FormattedEvent, Statistics } from '@/types';
import { QUERY, ViewId, toSwedishParams, viewSlug } from '@/lib/urlParams';

interface ClientAppProps {
  initialEvents: FormattedEvent[];
  /** Every event matching the current filters, not just the first page. */
  totalEvents: number;
  hasMore: boolean;
  locations: string[];
  types: string[];
  stats: Statistics;
  filters: {
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
    (key: 'type' | 'location', value: string) => {
      setCurrentView('list');
      const params = toSwedishParams(new URLSearchParams(searchParams.toString()));
      params.set(QUERY.view, viewSlug('list'));
      params.set(QUERY[key], value);
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

  const shortcutHandlers = useMemo(
    () => ({
      onSearch: focusSearch,
      onEscape: handleCloseMapModal,
      onListView: () => handleViewChange('list'),
      onMapView: () => handleViewChange('map'),
      onStatsView: () => handleViewChange('stats'),
      onScrollTop: scrollToTop,
    }),
    [focusSearch, handleCloseMapModal, handleViewChange, scrollToTop]
  );

  useKeyboardShortcuts(shortcutHandlers);

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams();
    params.set(QUERY.view, viewSlug(currentView as ViewId));
    router.push(`/?${params.toString()}`, { scroll: false });
  }, [currentView, router]);

  // How far back the map is looking. Not in the URL: it is a way of looking at
  // the current filters rather than part of what is being looked at.
  const [mapWindowDays, setMapWindowDays] = useState(1);

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
          <Filters locations={locations} types={types} currentView={currentView} filters={filters} />
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
          isFiltered={Boolean(filters.location || filters.type || filters.search)}
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
          <StatsView stats={stats} onTypeClick={handleTypeClick} onLocationClick={handleLocationClick} />
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
