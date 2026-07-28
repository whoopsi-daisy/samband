'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import EventCard from './EventCard';
import { FormattedEvent } from '@/types';

// Auto-refresh interval: 10 minutes (matches server-side fetch interval)
const AUTO_REFRESH_INTERVAL = 10 * 60 * 1000;

interface EventListProps {
  initialEvents: FormattedEvent[];
  initialHasMore: boolean;
  filters: {
    location: string;
    type: string;
    search: string;
  };
  currentView: string;
  onShowMap?: (lat: number, lng: number, location: string) => void;
  highlightedEventId: number | null;
  onLastCheckedChange?: (date: Date) => void;
}

export default function EventList({
  initialEvents,
  initialHasMore,
  filters,
  currentView,
  onShowMap,
  highlightedEventId,
  onLastCheckedChange,
}: EventListProps) {
  const [events, setEvents] = useState<FormattedEvent[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
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
    setHasMore(initialHasMore);
    setPage(1);
    setNewEventsCount(0);
    lastRefreshRef.current = Date.now();
  }, [filterKey, initialEvents, initialHasMore]);

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

  // Scroll the deep-linked incident into view
  useEffect(() => {
    if (highlightedEventId === null) return;
    const timeoutId = setTimeout(() => {
      document
        .querySelector(`[data-event-id="${highlightedEventId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [highlightedEventId]);

  const refreshEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: '1',
        location: filters.location,
        type: filters.type,
        search: filters.search,
      });

      const res = await fetch(`/api/events?${params}`);
      const data = await res.json();
      if (data.error) return;

      setEvents(data.events);
      setHasMore(data.hasMore);
      setPage(1);
      setNewEventsCount(0);
      lastRefreshRef.current = Date.now();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // Leave the existing list in place
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;

    setLoading(true);
    const nextPage = page + 1;

    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        location: filters.location,
        type: filters.type,
        search: filters.search,
      });

      const res = await fetch(`/api/events?${params}`);
      const data = await res.json();
      if (data.error) return;

      // Deduplicate: pages can overlap if data shifted between requests
      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newUnique = (data.events as FormattedEvent[]).filter((e) => !existingIds.has(e.id));
        return [...prev, ...newUnique];
      });
      setHasMore(data.hasMore);
      setPage(nextPage);
    } catch {
      // Keep what's already loaded
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, filters]);

  // Group incidents into local calendar days
  const dayGroups = useMemo(() => {
    const weekdays = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = startOfDay(new Date());

    // The key must be the *local* calendar day. Slicing the UTC ISO string
    // instead put 00:00–02:00 local events in the previous day's bucket while
    // the label still said today, splitting one day into two groups.
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const label = (d: Date) => {
      const diffDays = Math.round((today - startOfDay(d)) / 86400000);
      if (diffDays === 0) return 'Idag';
      if (diffDays === 1) return 'Igår';
      return `${weekdays[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    };

    const groups: { key: string; label: string; events: FormattedEvent[] }[] = [];
    let current: { key: string; label: string; events: FormattedEvent[] } | null = null;
    for (const ev of events) {
      const d = new Date(ev.date.iso || ev.datetime);
      const key = dayKey(d);
      if (!current || current.key !== key) {
        current = { key, label: label(d), events: [] };
        groups.push(current);
      }
      current.events.push(ev);
    }
    return groups;
  }, [events]);

  if (events.length === 0) {
    return (
      <section id="eventsGrid" className="empty">
        <span className="empty-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4.3-4.3" />
          </svg>
        </span>
        <p className="empty-title">Inga händelser</p>
        <p className="empty-text">Inga händelser matchar dina filter. Prova att ta bort något av dem.</p>
      </section>
    );
  }

  return (
    <>
      {newEventsCount > 0 && (
        <div className="new-events">
          <button type="button" onClick={refreshEvents} disabled={loading} className="new-events-btn">
            {loading ? (
              <>
                <span className="spinner-small" />
                Laddar…
              </>
            ) : (
              <>
                <span className="new-events-dot" />
                {newEventsCount} {newEventsCount === 1 ? 'ny händelse' : 'nya händelser'}
              </>
            )}
          </button>
        </div>
      )}

      <div className="feed-lede">
        <span>
          <strong>{events.length}</strong> {events.length === 1 ? 'händelse' : 'händelser'} visas
        </span>
        <span className="feed-live">
          <span className="feed-live-dot" aria-hidden="true" />
          Uppdateras automatiskt
        </span>
      </div>

      <section id="eventsGrid">
        {dayGroups.map((group, groupIndex) => (
          <div key={group.key}>
            <div className="day-heading">
              <span className="section-label">{group.label}</span>
              <span className="day-heading-count">{group.events.length}</span>
            </div>
            {/* Only the newest day's first row carries the accent rail. */}
            <div className={`event-list${groupIndex === 0 ? ' event-list--newest' : ''}`}>
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
        {hasMore && (
          <button className="btn-quiet" type="button" onClick={loadMore} disabled={loading}>
            {loading ? (
              <>
                <span className="spinner-small" />
                Laddar…
              </>
            ) : (
              'Ladda fler'
            )}
          </button>
        )}
        {!hasMore && (
          <p className="all-loaded-message" role="status">
            Alla händelser visas
          </p>
        )}
      </div>
    </>
  );
}
