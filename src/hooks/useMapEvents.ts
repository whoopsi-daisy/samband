'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedEvent } from '@/types';

interface Filters {
  location: string;
  type: string;
  search: string;
}

interface MapEventsState {
  events: FormattedEvent[];
  loading: boolean;
  error: boolean;
  /** Retry the fetch in place. The map's error state used to reload the page. */
  retry: () => void;
}

// Loads the map's events the first time the map view is opened, and again
// whenever the filters change while it is open.
//
// The server used to embed these in every page render, so a visitor who only
// ever used the list view still paid for ~500 serialised events. Fetching them
// on demand keeps that cost with the view that needs it.
export function useMapEvents(filters: Filters, isActive: boolean, windowDays: number): MapEventsState {
  const [state, setState] = useState<Omit<MapEventsState, 'retry'>>({
    events: [],
    loading: false,
    error: false,
  });
  const [attempt, setAttempt] = useState(0);

  const filterKey = `${filters.location}|${filters.type}|${filters.search}|${windowDays}`;
  // Which filter set we have already loaded, so re-opening the map does not
  // refetch data we still hold.
  const loadedKeyRef = useRef<string | null>(null);

  const retry = useCallback(() => {
    loadedKeyRef.current = null;
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isActive || loadedKeyRef.current === filterKey) return;

    const controller = new AbortController();
    let cancelled = false;

    setState((prev) => ({ ...prev, loading: true, error: false }));

    const params = new URLSearchParams({
      location: filters.location,
      type: filters.type,
      search: filters.search,
      // The window is part of the query now, not something the client trims
      // off a fixed 500 rows after they arrive.
      dagar: String(windowDays),
    });

    fetch(`/api/map?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data.events)) throw new Error('Malformed response');
        loadedKeyRef.current = filterKey;
        setState({ events: data.events, loading: false, error: false });
      })
      .catch((err) => {
        // An abort is this effect being superseded, not a failure to report.
        if (cancelled || err.name === 'AbortError') return;
        console.error('Failed to load map events:', err);
        setState({ events: [], loading: false, error: true });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isActive, filterKey, filters.location, filters.type, filters.search, windowDays, attempt]);

  return { ...state, retry };
}
