'use client';

import { useState, useCallback, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from './Header';
import BottomNav from './BottomNav';
import Filters from './Filters';
import EventList from './EventList';
import EventMap from './EventMap';
import StatsView from './StatsView';
import Footer from './Footer';
import ScrollToTop from './ScrollToTop';
import MapModal from './MapModal';
import ErrorBoundary from './ErrorBoundary';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMapEvents } from '@/hooks/useMapEvents';
import { FormattedEvent, Statistics } from '@/types';

interface ClientAppProps {
  initialEvents: FormattedEvent[];
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
}

function ClientAppContent({
  initialEvents,
  hasMore,
  locations,
  types,
  stats,
  filters,
  initialView,
  highlightedEventId,
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
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', view);
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
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', 'list');
      params.set(key, value);
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

  // Map data loads on demand the first time the map view is opened.
  const map = useMapEvents(filters, currentView === 'map');

  return (
    <>
      <Header currentView={currentView} onViewChange={handleViewChange} onLogoClick={handleLogoClick} />

      <main id="main-content" tabIndex={-1}>
        {currentView === 'list' && (
          <>
            <Filters locations={locations} types={types} currentView={currentView} filters={filters} />
            <EventList
              initialEvents={initialEvents}
              initialHasMore={hasMore}
              filters={filters}
              currentView={currentView}
              onShowMap={handleShowMap}
              highlightedEventId={highlightedEventId}
              onLastCheckedChange={setLastChecked}
            />
          </>
        )}

        {/* Kept mounted across view switches so the Leaflet instance and its
            loaded tiles survive a trip to the list and back. */}
        <EventMap events={map.events} isActive={currentView === 'map'} loading={map.loading} error={map.error} />

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
