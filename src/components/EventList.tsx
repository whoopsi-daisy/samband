'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import EventCard from './EventCard';
import { FormattedEvent } from '@/types';
import { swedishDayKey } from '@/lib/utils';

// Auto-refresh interval: 10 minutes (matches server-side fetch interval)
const AUTO_REFRESH_INTERVAL = 10 * 60 * 1000;

// Rows per page, matching EVENTS_PER_PAGE on the server. Only used to decide
// whether "there is more" is worth a sentence or is just the next tap.
const PAGE_SIZE = 40;

/**
 * Why a request the reader asked for did not happen. Every one of these paths
 * used to `return` silently, so tapping "visa fler" with no connection did
 * nothing at all — no message, no change, no way to tell it had failed.
 */
type FetchFailure = 'offline' | 'rate-limited' | 'failed';

const FAILURE_TEXT: Record<FetchFailure, string> = {
  offline: 'Du verkar vara offline. Det som redan hämtats finns kvar.',
  'rate-limited': 'För många förfrågningar just nu. Vänta en stund och försök igen.',
  failed: 'Kunde inte hämta fler händelser just nu.',
};

function classifyFailure(res?: Response, body?: { error?: string }): FetchFailure {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (res?.status === 429) return 'rate-limited';
  // The service worker answers API calls with this shape when the network is
  // gone but the browser has not flipped navigator.onLine yet.
  if (res?.status === 503 || body?.error === 'Offline') return 'offline';
  return 'failed';
}

interface EventListProps {
  initialEvents: FormattedEvent[];
  /** Every event matching the current filters, not just the first page. */
  initialTotal: number;
  initialHasMore: boolean;
  filters: {
    location: string;
    type: string;
    search: string;
  };
  currentView: string;
  onShowMap?: (lat: number, lng: number, location: string) => void;
  highlightedEventId: number | null;
  /** A ?event= link whose event is not in the first page — pinned above the feed. */
  linkedEvent: FormattedEvent | null;
  /** A ?event= link whose event no longer exists. */
  linkedEventMissing: boolean;
  onLastCheckedChange?: (date: Date) => void;
  onClearFilters?: () => void;
}

export default function EventList({
  initialEvents,
  initialTotal,
  initialHasMore,
  filters,
  currentView,
  onShowMap,
  highlightedEventId,
  linkedEvent,
  linkedEventMissing,
  onLastCheckedChange,
  onClearFilters,
}: EventListProps) {
  const [events, setEvents] = useState<FormattedEvent[]>(initialEvents);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<FetchFailure | null>(null);
  const [newEventsCount, setNewEventsCount] = useState(0);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const lastRefreshRef = useRef<number>(Date.now());
  const eventsRef = useRef<FormattedEvent[]>(events);
  eventsRef.current = events;

  useEffect(() => {
    onLastCheckedChange?.(lastChecked);
  }, [lastChecked, onLastCheckedChange]);

  // Stable key so a filter change resets the list
  const filterKey = useMemo(
    () => `${filters.location}|${filters.type}|${filters.search}`,
    [filters.location, filters.type, filters.search]
  );

  useEffect(() => {
    setEvents(initialEvents);
    setTotal(initialTotal);
    setHasMore(initialHasMore);
    setPage(1);
    setNewEventsCount(0);
    lastRefreshRef.current = Date.now();
  }, [filterKey, initialEvents, initialTotal, initialHasMore]);

  // Poll for new incidents every 10 minutes while the list is open and visible
  useEffect(() => {
    const checkForNewEvents = async () => {
      if (currentView !== 'list' || document.hidden) return;

      try {
        const params = new URLSearchParams({
          page: '1',
          location: filters.location,
          type: filters.type,
          search: filters.search,
        });

        const res = await fetch(`/api/events?${params}`);
        const data = await res.json();
        if (data.error || !data.events) return;

        const currentFirstId = eventsRef.current[0]?.id;
        const newFirstId = data.events[0]?.id;

        setLastChecked(new Date());
        lastRefreshRef.current = Date.now();

        if (currentFirstId !== newFirstId && data.events.length > 0) {
          const currentIds = new Set(eventsRef.current.map((e) => e.id));
          const fresh = data.events.filter((e: FormattedEvent) => !currentIds.has(e.id));
          if (fresh.length > 0) setNewEventsCount(fresh.length);
        }
      } catch {
        // Silently fail — don't interrupt the user
      }
    };

    const intervalId = setInterval(checkForNewEvents, AUTO_REFRESH_INTERVAL);

    const handleVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastRefreshRef.current > AUTO_REFRESH_INTERVAL) {
        checkForNewEvents();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentView, filters]);

  // Scroll the deep-linked incident into view. Not when it is the pinned card:
  // that one already sits at the top of the page.
  useEffect(() => {
    if (highlightedEventId === null || linkedEvent) return;
    const timeoutId = setTimeout(() => {
      document
        .querySelector(`[data-event-id="${highlightedEventId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [highlightedEventId, linkedEvent]);

  const fetchPage = useCallback(
    async (pageNumber: number) => {
      const params = new URLSearchParams({
        page: String(pageNumber),
        location: filters.location,
        type: filters.type,
        search: filters.search,
      });
      const res = await fetch(`/api/events?${params}`);
      const data = await res.json();
      if (!res.ok || data.error || !Array.isArray(data.events)) {
        throw Object.assign(new Error('fetch failed'), { failure: classifyFailure(res, data) });
      }
      return data as { events: FormattedEvent[]; hasMore: boolean; total?: number };
    },
    [filters]
  );

  const refreshEvents = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const data = await fetchPage(1);
      setEvents(data.events);
      if (typeof data.total === 'number') setTotal(data.total);
      setHasMore(data.hasMore);
      setPage(1);
      setNewEventsCount(0);
      lastRefreshRef.current = Date.now();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      // The list already on screen stays; the banner says why it did not move.
      setFailure((err as { failure?: FetchFailure }).failure ?? 'failed');
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    setFailure(null);
    const nextPage = page + 1;

    try {
      const data = await fetchPage(nextPage);
      // Deduplicate: pages can overlap if data shifted between requests
      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newUnique = data.events.filter((e) => !existingIds.has(e.id));
        return [...prev, ...newUnique];
      });
      if (typeof data.total === 'number') setTotal(data.total);
      setHasMore(data.hasMore);
      setPage(nextPage);
    } catch (err) {
      setFailure((err as { failure?: FetchFailure }).failure ?? 'failed');
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, fetchPage]);

  // Coming back online is the answer to the message above, so clear it.
  useEffect(() => {
    const onOnline = () => setFailure((prev) => (prev === 'offline' ? null : prev));
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // Group incidents into Swedish calendar days
  const dayGroups = useMemo(() => {
    const weekdays = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

    // Grouped on the Swedish calendar day, not the reader's — see
    // swedishDayKey for why that distinction is load-bearing here.
    const dayKey = swedishDayKey;

    // "2026-07-28" -> the calendar day as a number of days, for Idag/Igår.
    const dayNumber = (key: string) => Date.parse(`${key}T12:00:00Z`) / 86400000;
    const today = dayKey(new Date());

    const thisYear = today.slice(0, 4);

    const label = (key: string) => {
      const diffDays = Math.round(dayNumber(today) - dayNumber(key));
      if (diffDays === 0) return 'Idag';
      if (diffDays === 1) return 'Igår';
      // Noon UTC, so the weekday cannot be pushed across a boundary by an
      // offset or by DST.
      const at = new Date(`${key}T12:00:00Z`);
      const head = `${weekdays[at.getUTCDay()]} ${at.getUTCDate()} ${months[at.getUTCMonth()]}`;
      // The archive reaches back to 2016, where a heading of "Måndag 4 apr"
      // repeats once a decade with nothing to tell the two apart.
      return key.slice(0, 4) === thisYear ? head : `${head} ${key.slice(0, 4)}`;
    };

    const groups: { key: string; label: string; events: FormattedEvent[] }[] = [];
    let current: { key: string; label: string; events: FormattedEvent[] } | null = null;
    for (const ev of events) {
      const key = dayKey(new Date(ev.date.iso || ev.datetime));
      if (!current || current.key !== key) {
        current = { key, label: label(key), events: [] };
        groups.push(current);
      }
      current.events.push(ev);
    }
    return groups;
  }, [events]);

  // A link to an event that is not in the first page — the usual case for a
  // shared link, since the first page covers well under a day.
  const linkedBanner = linkedEvent ? (
    <section className="linked-event" aria-label="Delad händelse">
      <div className="linked-event-head">
        <span className="section-label">Länkad händelse</span>
        <Link className="clear-all" href="/">
          Visa hela flödet
        </Link>
      </div>
      <div className="panel event-list">
        <EventCard event={linkedEvent} onShowMap={onShowMap} isHighlighted />
      </div>
    </section>
  ) : linkedEventMissing ? (
    <div className="notice" role="status">
      Händelsen i länken finns inte kvar. Nedan visas flödet i stället.
    </div>
  ) : null;

  if (events.length === 0) {
    const hasFilters = Boolean(filters.location || filters.type || filters.search);
    return (
      <>
        {linkedBanner}
        <section className="empty">
          <span className="empty-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4.3-4.3" />
            </svg>
          </span>
          <p className="empty-title">Inga träffar</p>
          <p className="empty-text">
            {hasFilters
              ? 'Ingen händelse matchar det du sökt eller filtrerat på. Prova ett bredare sökord, eller ta bort ett filter.'
              : 'Det finns inga händelser att visa just nu. Listan fylls på när polisen publicerar nästa notis.'}
          </p>
          {/* An empty result used to describe the way out without offering it. */}
          {hasFilters && onClearFilters && (
            <div className="empty-actions">
              <button type="button" className="btn" onClick={onClearFilters}>
                Rensa alla filter
              </button>
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      {linkedBanner}

      {newEventsCount > 0 && (
        <div className="new-events">
          <button type="button" onClick={refreshEvents} disabled={loading} className="new-events-btn">
            {loading ? (
              <>
                <span className="spinner-sm" />
                Laddar…
              </>
            ) : (
              <>
                <span className="dot dot--sm" />
                {newEventsCount} {newEventsCount === 1 ? 'ny händelse' : 'nya händelser'}
              </>
            )}
          </button>
        </div>
      )}

      {/* "40 händelser visas" left the reader with no idea whether that was all
          of them or the first page of nine hundred. */}
      <div className="feed-lede" role="status">
        <span>
          Visar <strong>{events.length.toLocaleString('sv-SE')}</strong> av{' '}
          <strong>{Math.max(total, events.length).toLocaleString('sv-SE')}</strong>{' '}
          {total === 1 ? 'händelse' : 'händelser'}
        </span>
        <span className="feed-live">
          <span className="dot dot--sm dot--ok" aria-hidden="true" />
          Live
        </span>
      </div>

      <section>
        {dayGroups.map((group, groupIndex) => (
          <div key={group.key}>
            <div className="day-heading">
              <span className="section-label">{group.label}</span>
              <span className="day-heading-count">{group.events.length}</span>
            </div>
            {/* Only the newest day's first row carries the accent rail. */}
            <div className={`panel event-list${groupIndex === 0 ? ' event-list--newest' : ''}`}>
              {group.events.map((event, index) => (
                <EventCard
                  key={event.id ?? `${group.key}-${index}`}
                  event={event}
                  onShowMap={onShowMap}
                  // Guard the null case: an event with no id must never match a
                  // null highlight, or every row deep-links to itself at once.
                  isHighlighted={event.id !== null && event.id === highlightedEventId}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="load-more">
        {/* Whatever went wrong, say so here rather than leaving the button to
            spin and settle back with nothing changed. */}
        {failure && (
          <p className="notice notice--alert" role="alert">
            {FAILURE_TEXT[failure]}
          </p>
        )}
        {hasMore && (
          <>
            <button className="btn-quiet" type="button" onClick={loadMore} disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner-sm" />
                  Laddar…
                </>
              ) : failure ? (
                'Försök igen'
              ) : (
                'Visa fler'
              )}
            </button>
            {/* The remaining count used to sit in the button's own label, which
                read as an invitation to reach the end of the archive forty rows
                at a time. With an import loaded that is thousands of taps. Say
                how much there is, and point at the way that actually reaches
                it. */}
            {total > events.length + PAGE_SIZE && (
              <p className="load-more-hint">
                {total.toLocaleString('sv-SE')} händelser matchar. Sök eller filtrera för att nå längre
                bak i arkivet.
              </p>
            )}
          </>
        )}
        {!hasMore && (
          <p className="all-loaded-message" role="status">
            Du har nått slutet — alla {events.length.toLocaleString('sv-SE')} händelser visas.
          </p>
        )}
      </div>
    </>
  );
}
