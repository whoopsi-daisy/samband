'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import EventCard from './EventCard';
import { FormattedEvent } from '@/types';
import type { Density } from './ClientApp';

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
  onEventCountChange?: (count: number) => void;
  onLastCheckedChange?: (date: Date) => void;
  expandSummaries?: boolean;
  density?: Density;
}

export default function EventList({
  initialEvents,
  initialHasMore,
  filters,
  currentView,
  onShowMap,
  highlightedEventId,
  onEventCountChange,
  onLastCheckedChange,
  expandSummaries,
  density,
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

  // Notify parent of displayed event count changes
  useEffect(() => {
    onEventCountChange?.(events.length);
  }, [events.length, onEventCountChange]);

  // Notify parent of lastChecked changes
  useEffect(() => {
    onLastCheckedChange?.(lastChecked);
  }, [lastChecked, onLastCheckedChange]);

  // Create a stable filter key to detect when filters change
  const filterKey = useMemo(
    () => `${filters.location}|${filters.type}|${filters.search}`,
    [filters.location, filters.type, filters.search]
  );

  // Reset state when filters change (new initial events from server)
  useEffect(() => {
    setEvents(initialEvents);
    setHasMore(initialHasMore);
    setPage(1);
    setNewEventsCount(0);
    lastRefreshRef.current = Date.now();
  }, [filterKey, initialEvents, initialHasMore]);

  // Auto-refresh to check for new events every 10 minutes
  useEffect(() => {
    const checkForNewEvents = async () => {
      // Only auto-refresh if user is on the list view and document is visible
      if (currentView !== 'list' || document.hidden) {
        return;
      }

      try {
        const params = new URLSearchParams({
          page: '1',
          location: filters.location,
          type: filters.type,
          search: filters.search,
        });

        const res = await fetch(`/api/events?${params}`);
        const data = await res.json();

        if (data.error || !data.events) {
          return;
        }

        // Check if there are new events by comparing first event IDs
        const currentFirstId = eventsRef.current[0]?.id;
        const newFirstId = data.events[0]?.id;

        setLastChecked(new Date());
        lastRefreshRef.current = Date.now();

        if (currentFirstId !== newFirstId && data.events.length > 0) {
          // Count how many new events there are
          const currentIds = new Set(eventsRef.current.map((e) => e.id));
          const newEvents = data.events.filter((e: FormattedEvent) => !currentIds.has(e.id));

          if (newEvents.length > 0) {
            setNewEventsCount(newEvents.length);
          }
        }
      } catch {
        // Silently fail - don't interrupt user experience
      }
    };

    const intervalId = setInterval(checkForNewEvents, AUTO_REFRESH_INTERVAL);

    // Also check when document becomes visible after being hidden
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

  // Scroll to highlighted event on mount
  useEffect(() => {
    if (highlightedEventId !== null) {
      // Small delay to ensure DOM is ready
      const timeoutId = setTimeout(() => {
        const eventCard = document.querySelector(`[data-event-id="${highlightedEventId}"]`);
        if (eventCard) {
          eventCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [highlightedEventId]);

  // Refresh events and merge new ones
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

      if (data.error) {
        console.error(data.error);
        return;
      }

      setEvents(data.events);
      setHasMore(data.hasMore);
      setPage(1);
      setNewEventsCount(0);
      lastRefreshRef.current = Date.now();
    } catch (err) {
      console.error(err);
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

      if (data.error) {
        console.error(data.error);
        return;
      }

      // Deduplicate: new events may overlap with existing ones if data shifted between pages
      setEvents(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const newUnique = (data.events as FormattedEvent[]).filter(e => !existingIds.has(e.id));
        return [...prev, ...newUnique];
      });
      setHasMore(data.hasMore);
      setPage(nextPage);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, filters]);

  // Group events into day buckets for the timeline feed
  const dayGroups = useMemo(() => {
    const weekdays = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = startOfDay(new Date());

    // The key must be the *local* calendar day. Slicing the UTC ISO string
    // instead put events in the 00:00-02:00 local window into the previous
    // day's bucket while the label still said today, splitting one day into
    // two groups with the same heading.
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

  // Quick-glance tally for the most recent day, broken down by the top types.
  const feedSummary = useMemo(() => {
    const group = dayGroups[0];
    if (!group || group.events.length === 0) return null;
    const counts = new Map<string, { type: string; count: number; color: string }>();
    for (const ev of group.events) {
      const key = ev.type || 'Övrigt';
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { type: key, count: 1, color: ev.color });
    }
    const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 4);
    return { label: group.label, total: group.events.length, top };
  }, [dayGroups]);

  if (events.length === 0) {
    return (
      <section id="eventsGrid" className="events-grid">
        <div className="press-empty">
          <div className="press-empty-icon">📭</div>
          <h3>Inga händelser</h3>
          <p>Inga händelser hittades för dina filter.</p>
        </div>
      </section>
    );
  }

  return (
    <>
      {newEventsCount > 0 && (
        <div className="new-events-banner">
          <button
            type="button"
            onClick={refreshEvents}
            disabled={loading}
            className="new-events-btn"
          >
            {loading ? (
              <>
                <span className="spinner-small" />
                Laddar...
              </>
            ) : (
              <>
                <span className="new-events-pulse" />
                {newEventsCount} nya händelser - Klicka för att uppdatera
              </>
            )}
          </button>
        </div>
      )}

      {feedSummary && (
        <div className="feed-summary" aria-label="Sammanfattning">
          <div className="feed-summary__lead">
            <span className="feed-summary__num">{feedSummary.total}</span>
            <span className="feed-summary__lead-text">
              händelser
              <span className="feed-summary__day">{feedSummary.label}</span>
            </span>
          </div>
          <div className="feed-summary__list">
            {feedSummary.top.map((t) => (
              <span className="feed-summary__item" key={t.type}>
                <span className="feed-summary__dot" style={{ background: t.color }} />
                <span className="feed-summary__count">{t.count}</span>
                <span className="feed-summary__type">{t.type}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <section id="eventsGrid" className="events-grid feed">
        {dayGroups.map((group) => (
          <div className="feed-group" key={group.key}>
            <div className="feed-group__header">
              <span className="feed-group__label">{group.label}</span>
              <span className="feed-group__count">{group.events.length}</span>
            </div>
            <div className="feed-group__items">
              {group.events.map((event, index) => (
                <EventCard
                  key={event.id ?? `${group.key}-${index}`}
                  event={event}
                  currentView={currentView}
                  onShowMap={onShowMap}
                  isHighlighted={event.id === highlightedEventId}
                  autoExpand={expandSummaries}
                  density={density}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="load-more-container">
        <button
          id="loadMoreBtn"
          className={`load-more-btn${loading ? ' loading' : ''}${!hasMore ? ' hidden' : ''}`}
          type="button"
          onClick={loadMore}
          disabled={loading || !hasMore}
        >
          {loading ? (
            <>
              <span className="spinner-small" />
              Laddar...
            </>
          ) : (
            'Ladda fler'
          )}
        </button>
        {!hasMore && events.length > 0 && (
          <p className="all-loaded-message" role="status">
            Alla händelser visas
          </p>
        )}
      </div>
    </>
  );
}
