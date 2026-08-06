'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapEvent } from '@/types';
import { MAP_WINDOW_DAYS } from '@/lib/mapWindows';

interface Filters {
  county: string;
  location: string;
  type: string;
  search: string;
}

interface MapPayload {
  events: MapEvent[];
  /** Notices in the window, which is more than `events` when the cap bit. */
  total: number;
}

interface MapEventsState extends MapPayload {
  loading: boolean;
  error: boolean;
  /** Retry the fetch in place. The map's error state used to reload the page. */
  retry: () => void;
}

/**
 * How long an answer is reused before it is asked for again.
 *
 * The same minute the server's own map cache holds an entry for
 * (MAP_CACHE_TTL_MS in lib/db), so this cannot serve rows the server would
 * already have replaced. The feed lands every ten minutes, so a minute of slop
 * is well inside the interval at which anything changes.
 */
const CACHE_TTL_MS = 60_000;

/**
 * How many answers are kept.
 *
 * Three windows for the current filters, plus a little room for the last filter
 * set the reader was on, so going back to it is instant too. Each entry holds up
 * to 3,000 events, which is why this is not larger.
 */
const MAX_ENTRIES = 8;

/**
 * Module scope, not a ref.
 *
 * The map view stays mounted across view switches, so a ref would survive the
 * same trips this does; module scope additionally survives a remount, and it is
 * what lets a prefetch started for one window be read by the effect that later
 * asks for it.
 */
const cache = new Map<string, { at: number; payload: MapPayload }>();

/** In flight, so three prefetches and a read do not become four requests. */
const inFlight = new Map<string, Promise<MapPayload>>();

function cacheKey(filters: Filters, windowDays: number): string {
  return `${filters.county}|${filters.location}|${filters.type}|${filters.search}|${windowDays}`;
}

function readCache(key: string): MapPayload | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Re-inserted so the eviction below drops the least recently *used* entry
  // rather than the oldest one written: the window the reader keeps coming back
  // to should not be the one thrown away.
  cache.delete(key);
  cache.set(key, hit);
  return hit.payload;
}

function writeCache(key: string, payload: MapPayload): void {
  cache.delete(key);
  cache.set(key, { at: Date.now(), payload });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** Drops everything. Exported for tests, which must not inherit each other's rows. */
export function clearMapEventCache(): void {
  cache.clear();
  inFlight.clear();
}

function requestUrl(filters: Filters, windowDays: number): string {
  const params = new URLSearchParams({
    county: filters.county,
    location: filters.location,
    type: filters.type,
    search: filters.search,
    // The window is part of the query, not something the client trims off a
    // fixed number of rows after they arrive.
    dagar: String(windowDays),
  });
  return `/api/map?${params}`;
}

/**
 * One request, shared by everyone who wants the same window.
 *
 * Not given the AbortController of whichever effect happened to ask first:
 * a prefetch and a read can want the same key, and a switch away from a window
 * used to abort work the next switch back would only have to redo. The result
 * lands in the cache regardless of who is still listening.
 */
function load(filters: Filters, windowDays: number): Promise<MapPayload> {
  const key = cacheKey(filters, windowDays);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = fetch(requestUrl(filters, windowDays))
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!Array.isArray(data.events)) throw new Error('Malformed response');
      const payload: MapPayload = {
        events: data.events,
        // Older deployments answered without it; the length is then the truth.
        total: typeof data.total === 'number' ? data.total : data.events.length,
      };
      writeCache(key, payload);
      return payload;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/** Run a low-priority job, on the browsers that have a word for that. */
function whenIdle(job: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const idle = window.requestIdleCallback;
  if (typeof idle === 'function') {
    const handle = idle(() => job(), { timeout: 2_000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(job, 400);
  return () => window.clearTimeout(handle);
}

/**
 * The map's events, loaded when the map is opened and kept while the reader
 * moves between the periods on offer.
 *
 * The server used to embed these in every page render, so a visitor who only
 * ever used the list view still paid for ~500 serialised events. Fetching them
 * on demand keeps that cost with the view that needs it.
 *
 * Switching period used to cost a round trip every time, including back to a
 * period whose rows were still in the tab. Three things changed that, in the
 * order they matter:
 *
 *  1. Answers are cached for a minute, so a period the reader has already seen
 *     comes back synchronously, with no request and no loading overlay.
 *  2. Once the open window has settled, the other two are fetched during idle
 *     time, so the *first* switch is usually served from the cache as well.
 *  3. A request is shared by key, so a prefetch and a read of the same window
 *     are one request, and switching away no longer aborts work the next switch
 *     back would have to redo.
 */
export function useMapEvents(
  filters: Filters,
  isActive: boolean,
  windowDays: number
): MapEventsState {
  const [state, setState] = useState<MapPayload & { loading: boolean; error: boolean }>({
    events: [],
    total: 0,
    loading: false,
    error: false,
  });
  const [attempt, setAttempt] = useState(0);

  const key = cacheKey(filters, windowDays);
  // Which filter set we have already shown, so re-opening the map does not
  // refetch data we still hold.
  const loadedKeyRef = useRef<string | null>(null);

  const retry = useCallback(() => {
    loadedKeyRef.current = null;
    cache.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);

  const { county, location, type, search } = filters;

  useEffect(() => {
    if (!isActive || loadedKeyRef.current === key) return;

    const scoped = { county, location, type, search };

    // Already in hand: no request, no overlay, no frame where the map is blank.
    const cached = readCache(key);
    if (cached) {
      loadedKeyRef.current = key;
      setState({ ...cached, loading: false, error: false });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: false }));

    load(scoped, windowDays)
      .then((payload) => {
        if (cancelled) return;
        loadedKeyRef.current = key;
        setState({ ...payload, loading: false, error: false });
      })
      .catch((err) => {
        // This effect being superseded is not a failure to report.
        if (cancelled) return;
        console.error('Failed to load map events:', err);
        setState({ events: [], total: 0, loading: false, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [isActive, key, county, location, type, search, windowDays, attempt]);

  /*
   * The periods the reader has not asked for yet.
   *
   * Fetched only once the one they *are* looking at has arrived, and only in
   * idle time, so this cannot compete with the request whose answer is on
   * screen. Two extra queries against a cache the server already holds per
   * filter set, against a rate limit of sixty a minute.
   *
   * Deliberately not conditional on a fast connection: the readers this helps
   * most are the ones on a slow one, and the payload is the same rows the map
   * would fetch anyway the moment they touch the control.
   */
  const settled = !state.loading && !state.error && loadedKeyRef.current === key;

  useEffect(() => {
    if (!isActive || !settled) return;

    const scoped = { county, location, type, search };
    const pending = MAP_WINDOW_DAYS.filter(
      (days) => days !== windowDays && !readCache(cacheKey(scoped, days))
    );
    if (pending.length === 0) return;

    return whenIdle(() => {
      for (const days of pending) {
        // Failures are silent on purpose: nothing on screen depends on this,
        // and the read that eventually wants these rows reports its own error.
        load(scoped, days).catch(() => {});
      }
    });
  }, [isActive, settled, county, location, type, search, windowDays]);

  return { ...state, retry };
}
