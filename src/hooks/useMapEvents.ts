'use client';

import { useEffect, useRef, useState } from 'react';
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
}

// Loads the map's events the first time the map view is opened, and again
// whenever the filters change while it is open.
//
// The server used to embed these in every page render, so a visitor who only
// ever used the list view still paid for ~500 serialised events. Fetching them
// on demand keeps that cost with the view that needs it.
export function useMapEvents(filters: Filters, isActive: boolean): MapEventsState {
  const [state, setState] = useState<MapEventsState>({ events: [], loading: false, error: false });

  const filterKey = `${filters.location}|${filters.type}|${filters.search}`;
  // Which filter set we have already loaded, so re-opening the map does not
  // refetch data we still hold.
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isActive || loadedKeyRef.current === filterKey) return;

    const controller = new AbortController();
    let cancelled = false;

    setState((prev) => ({ ...prev, loading: true, error: false }));

    const params = new URLSearchParams({
      location: filters.location,
      type: filters.type,
      search: filters.search,
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
  }, [isActive, filterKey, filters.location, filters.type, filters.search]);

  return state;
}
