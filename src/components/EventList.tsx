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

// How many rows scrolling will add before the reader has to ask again.
//
// Counted in rows rather than pages, because rows are what a reader
// experiences. This was five pages, two hundred incidents, which is long
// enough that the feed stops feeling like it has a bottom: you scroll, more
// appears, and there is never a point where the page is a fixed thing you have
// read to the end of.
//
// Pages arrive forty at a time, so sixty added rows means two more pages and a
// feed that settles at about a hundred and twenty before the button returns.
const AUTO_LOAD_ADDED_ROWS = 60;

// Start fetching this far before the end of the list. Close enough that the
// loading rows below are on screen when they appear, so the feed is visibly
// fetching rather than silently growing under the scrollbar.
const AUTO_LOAD_MARGIN = '300px';

// Placeholder rows shown while a page is on its way. Matches the page size the
// server will actually send, so the list does not jump when they are replaced.
const SKELETON_ROWS = 4;

/**
 * Why a request the reader asked for did not happen. Every one of these paths
 * used to `return` silently, so tapping "visa fler" with no connection did
 * nothing at all: no message, no change, no way to tell it had failed.
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
    county: string;
    location: string;
    type: string;
    search: string;
  };
  currentView: string;
  onShowMap?: (lat: number, lng: number, location: string) => void;
  highlightedEventId: number | null;
  /** A ?handelse= link whose event is not in the first page: pinned above the feed. */
  linkedEvent: FormattedEvent | null;
  /** A ?handelse= link whose event no longer exists. */
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
  /** Row count the current scroll budget started from. */
  const [autoLoadFrom, setAutoLoadFrom] = useState(initialEvents.length);
  /** Whether the page now on its way was asked for by scrolling. */
  const [scrolledFor, setScrolledFor] = useState(false);
  const lastRefreshRef = useRef<number>(Date.now());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const eventsRef = useRef<FormattedEvent[]>(events);
  eventsRef.current = events;

  useEffect(() => {
    onLastCheckedChange?.(lastChecked);
  }, [lastChecked, onLastCheckedChange]);

  // Stable key so a filter change resets the list
  const filterKey = useMemo(
    () => `${filters.county}|${filters.location}|${filters.type}|${filters.search}`,
    [filters.county, filters.location, filters.type, filters.search]
  );

  useEffect(() => {
    setEvents(initialEvents);
    setTotal(initialTotal);
    setHasMore(initialHasMore);
    setPage(1);
    setNewEventsCount(0);
    setAutoLoadFrom(initialEvents.length);
    lastRefreshRef.current = Date.now();
  }, [filterKey, initialEvents, initialTotal, initialHasMore]);

  // Poll for new incidents every 10 minutes while the list is open and visible
  useEffect(() => {
    const checkForNewEvents = async () => {
      if (currentView !== 'list' || document.hidden) return;

      try {
        const params = new URLSearchParams({
          page: '1',
          county: filters.county,
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
        // Silently fail: don't interrupt the user
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
        county: filters.county,
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
      setAutoLoadFrom(data.events.length);
      lastRefreshRef.current = Date.now();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      // The list already on screen stays; the banner says why it did not move.
      setFailure((err as { failure?: FetchFailure }).failure ?? 'failed');
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(
    async (viaScroll = false) => {
      if (loading || !hasMore) return;

      setLoading(true);
      setFailure(null);
      setScrolledFor(viaScroll);
      // Asking for more explicitly restarts the budget from here, so a reader
      // who wants to keep going is not made to click for every page after it.
      if (!viaScroll) setAutoLoadFrom(events.length);
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
        setScrolledFor(viaScroll);
      } catch (err) {
        setFailure((err as { failure?: FetchFailure }).failure ?? 'failed');
      } finally {
        setLoading(false);
      }
    },
    [loading, hasMore, page, fetchPage, events.length]
  );

  const autoLoadExhausted = events.length - autoLoadFrom >= AUTO_LOAD_ADDED_ROWS;
  // Assumed present, which is what the server renders against, so the button
  // does not appear for a frame and vanish. A browser without the observer
  // corrects this on mount and keeps the button for good.
  const [autoLoadSupported, setAutoLoadSupported] = useState(true);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') setAutoLoadSupported(false);
  }, []);

  const scrollLoads = autoLoadSupported && !autoLoadExhausted && !failure;

  // Load the next page as the end of the list comes into view. The button below
  // stays: it is the keyboard and screen-reader path to the same thing, it is
  // the way back after a failed request, and it is what appears again once the
  // scroll budget above is spent.
  //
  // A failure switches scrolling off until the reader retries, so a dead
  // network cannot turn into a request every time the sentinel drifts back into
  // view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || !scrollLoads) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore(true);
      },
      { rootMargin: AUTO_LOAD_MARGIN }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, scrollLoads, loadMore]);

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

    // Grouped on the Swedish calendar day, not the reader's: see
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

    type Group = { key: string; label: string; isToday: boolean; events: FormattedEvent[] };
    const groups: Group[] = [];
    let current: Group | null = null;
    for (const ev of events) {
      const key = dayKey(new Date(ev.date.iso || ev.datetime));
      if (!current || current.key !== key) {
        current = { key, label: label(key), isToday: key === today, events: [] };
        groups.push(current);
      }
      current.events.push(ev);
    }
    return groups;
  }, [events]);

  // A link to an event that is not in the first page: the usual case for a
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

  const isFiltered = Boolean(filters.location || filters.type || filters.search);

  if (events.length === 0) {
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
            {isFiltered
              ? 'Ingen händelse matchar det du sökt eller filtrerat på. Prova ett bredare sökord, eller ta bort ett filter.'
              : 'Det finns inga händelser att visa just nu. Listan fylls på när polisen publicerar nästa notis.'}
          </p>
          {/* An empty result used to describe the way out without offering it. */}
          {isFiltered && onClearFilters && (
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

      {/* A count only when the reader asked a question it answers.
          On the unfiltered feed "Visar 40 av 300 händelser" is a fact nobody
          came for: the list scroll-loads, so the first number is already stale
          by the time it is read, and the second is just how much archive
          exists. Filtered, it is the one thing worth saying, because it tells
          you whether the filter found anything before you scroll. The "Live"
          pill went with it; the footer already carries "Uppdaterad HH:MM". */}
      {isFiltered && (
        <div className="feed-lede" role="status">
          <span>
            <strong>{Math.max(total, events.length).toLocaleString('sv-SE')}</strong>{' '}
            {total === 1 ? 'händelse matchar' : 'händelser matchar'}
          </span>
          {onClearFilters && (
            <button type="button" className="clear-all" onClick={onClearFilters}>
              Rensa
            </button>
          )}
        </div>
      )}

      <section>
        {dayGroups.map((group) => (
          <div className="day-group" key={group.key}>
            {/* The count used to sit alone at the right edge of this line: a
                bare "2" floating above the cards with nothing saying what it
                counted. It reads as part of the heading instead. */}
            {/* Named explicitly, because the computed name was "IDAG ·3HÄNDELSER":
                the two spans sit on separate lines in the source so JSX drops the
                whitespace between them, and the separator is a CSS ::before that
                counts toward the name but brings no space of its own. */}
            <h2
              className="day-heading"
              aria-label={`${group.label}, ${group.events.length} ${
                group.events.length === 1 ? 'händelse' : 'händelser'
              }`}
            >
              <span className="section-label">{group.label}</span>
              <span className="day-heading-count">
                {group.events.length} {group.events.length === 1 ? 'händelse' : 'händelser'}
              </span>
            </h2>
            <div className="panel event-list">
              {group.events.map((event, index) => (
                <EventCard
                  key={event.id ?? `${group.key}-${index}`}
                  event={event}
                  onShowMap={onShowMap}
                  isToday={group.isToday}
                  // Guard the null case: an event with no id must never match a
                  // null highlight, or every row deep-links to itself at once.
                  isHighlighted={event.id !== null && event.id === highlightedEventId}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Rows on their way, drawn where they will land. Scrolling used to add
          pages in silence: the only sign was a spinner in a button below the
          fold that had usually finished before it came into view, so the feed
          just grew under the scrollbar with no cause a reader could see. */}
      {loading && scrolledFor && (
        <div className="panel event-list event-list--loading" aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div className="event-row skeleton-row" key={i}>
              <span className="skeleton skeleton--title" />
              <span className="skeleton skeleton--meta" />
              <span className="skeleton skeleton--text" />
            </div>
          ))}
        </div>
      )}

      {/* Said once, for a screen reader: the skeletons above are decoration and
          the row count in the lede changes too quietly to notice. */}
      <p className="sr-only" role="status">
        {loading && scrolledFor ? 'Hämtar fler händelser' : ''}
      </p>

      {/* Where scrolling picks up the next page. Sits above the controls so the
          fetch starts while the reader is still on the rows above it. */}
      {hasMore && <div ref={sentinelRef} aria-hidden="true" />}

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
            {/* Hidden while scrolling is still doing the work, with pages
                arriving on their own, a button reading "visa fler" beneath them
                is a control for something that already happened. It comes back
                once the scroll budget is spent, when a request fails, and in a
                browser with no IntersectionObserver, which are the three cases
                where it has a job to do. */}
            {(!scrollLoads || (loading && !scrolledFor)) && (
              <button
                className="btn-quiet"
                type="button"
                onClick={() => loadMore()}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner-sm" />
                    Laddar…
                  </>
                ) : failure ? (
                  'Försök igen'
                ) : (
                  'Visa fler händelser'
                )}
              </button>
            )}
            {/* Just the way out. This used to open with the number of matching
                events, which on an unfiltered feed is the size of the whole
                archive: a six-figure count nobody asked for, sitting where the
                reader is looking for what to do next. */}
            {total > events.length + PAGE_SIZE && (
              <p className="load-more-hint">
                {/* "längre bak i arkivet" named the operator's storage. What
                    the reader is actually reaching for is an older date. */}
                Sök eller filtrera för att nå längre tillbaka i tiden.
              </p>
            )}
          </>
        )}
        {/* Not a live region. It is the last thing on the page, reachable by
            reading on, and announcing it interrupted whatever the reader was in
            the middle of every time a page settled. */}
        {!hasMore && (
          <p className="all-loaded-message">
            Slut på listan. Alla {events.length.toLocaleString('sv-SE')} händelser visas.
          </p>
        )}
      </div>
    </>
  );
}
