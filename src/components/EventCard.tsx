'use client';

import { useState, useCallback, useEffect, useMemo, useId } from 'react';
import { FormattedEvent } from '@/types';
import { formatRelativeTime } from '@/lib/utils';
import { QUERY } from '@/lib/urlParams';
import { useNow } from '@/hooks/useNow';

interface EventCardProps {
  event: FormattedEvent;
  onShowMap?: (lat: number, lng: number, location: string) => void;
  isHighlighted?: boolean;
  /**
   * Whether this row sits under today's heading.
   *
   * Decides which clock the row shows. Under "Igår" or "Tisdag 28 jul" every
   * row would otherwise read "1 dag sedan": a restatement of the heading it
   * already sits beneath, in place of the one thing the heading cannot say,
   * which is what time of day it happened.
   */
  isToday?: boolean;
}

/**
 * One incident, as a row in the day's list. Collapsed it shows type, place,
 * time and a two-line summary; expanding fetches the full text from polisen.se
 * and reveals the actions.
 */
/** For comparing two renderings of the same sentence, not for display. */
function normaliseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export default function EventCard({ event, onShowMap, isHighlighted, isToday = true }: EventCardProps) {
  const [expanded, setExpanded] = useState(isHighlighted || false);
  const [details, setDetails] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  // Imported archive events are served from our own database rather than
  // scraped from polisen.se, so they have detail text even when they have no
  // usable link. See /api/details.
  const isArchived = (event.id ?? 0) < 0;
  const hasDetails = isArchived || Boolean(event.url);

  const fetchDetails = useCallback(async () => {
    if (!hasDetails) return;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (isArchived) params.set('id', String(event.id));
      if (event.url) params.set('url', event.url);
      const res = await fetch(`/api/details?${params}`);
      const data = await res.json();
      if (data.success && data.details?.content) {
        setDetails(data.details.content);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [event.url, event.id, isArchived, hasDetails]);

  // A deep link (?handelse=123) opens the incident already expanded.
  useEffect(() => {
    if (isHighlighted && !details) {
      fetchDetails();
    }
    // Runs for the deep-linked row only; `details` and `fetchDetails` are
    // stable enough that re-running on them would just re-fetch what we have.
  }, [isHighlighted, details, fetchDetails]);

  const toggle = useCallback(() => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (hasDetails && !details && !loading) {
      fetchDetails();
    }
  }, [expanded, hasDetails, details, loading, fetchDetails]);

  const gpsCoords = useMemo(() => {
    if (!event.gps || !event.gps.includes(',')) return null;
    const [lat, lng] = event.gps.split(',').map((s) => parseFloat(s.trim()));
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng };
  }, [event.gps]);

  const handleShowMap = useCallback(() => {
    if (gpsCoords && onShowMap) {
      onShowMap(gpsCoords.lat, gpsCoords.lng, event.location);
    }
  }, [gpsCoords, event.location, onShowMap]);

  // The row shows the municipality when the source only filed a county, and a
  // shared link should say the same thing the row said.
  const place = event.place ? `${event.place}, ${event.location}` : event.location;

  const handleShare = useCallback(async () => {
    if (event.id === null) return;
    const url = `${window.location.origin}/?${QUERY.event}=${event.id}`;

    // On a phone this is what "dela" means to the reader: the OS share sheet,
    // with the messaging apps they actually use in it. Copying a URL to the
    // clipboard is the desktop fallback, not the primary behaviour.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${event.type}, ${place}`, url });
        return;
      } catch {
        // Dismissed, or unavailable in this context: fall through to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers, or a page without clipboard permission
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [event.id, event.type, place]);

  // Keep the relative time fresh without breaking hydration, until the shared
  // clock reports in, reuse the string the server already computed, so the
  // first client render matches the server markup exactly.
  const now = useNow();
  const relativeTime = useMemo(() => {
    if (now === null) return event.date.relative;
    return formatRelativeTime(new Date(event.date.iso || event.datetime), new Date(now));
  }, [now, event.date.iso, event.date.relative, event.datetime]);

  // Today's rows count up from now, which is what recency means on the day it
  // happens. Older rows show the clock, because the heading has already said
  // which day it was and "1 dag sedan" on all of them says nothing else.
  const headTime = isToday ? relativeTime : event.date.time;

  // "28 jul, 14:32": the clock time behind "2 timmar sedan". Shown outright
  // once the row is open; a title attribute alone is unreachable on a phone.
  const absoluteTime = `${event.date.day} ${event.date.month.toLowerCase()}, ${event.date.time}`;

  // `event.updated` arrives as "2026-07-28 18:06". Rendered raw it put a
  // machine timestamp next to the human one on the same line.
  const updatedTime = useMemo(() => {
    if (!event.updated) return '';
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(event.updated);
    if (!match) return event.updated;
    const [, , month, day, time] = match;
    const months = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${day} ${months[parseInt(month, 10) - 1]}, ${time}`;
  }, [event.updated]);

  // polisen.se's summary is the opening of the notice itself, so the text
  // fetched when a row is expanded almost always restates the teaser directly
  // above it: the same sentence twice, a few pixels apart. Imported events do
  // the same, since their description is the first line of their body.
  //
  // Compared with whitespace and case normalised: the two copies travel
  // different routes (one through the API, one scraped out of HTML or stored
  // markup) and differ in spacing often enough to defeat plain equality.
  const detail = useMemo(() => {
    if (!details) return { paragraphs: [] as string[], supersedesSummary: false };

    const summary = normaliseText(event.summary);
    const paragraphs = details
      .split('\n\n')
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph !== '' && normaliseText(paragraph) !== summary);

    // What is left may still open with the teaser and carry on past it: the
    // longer text stands on its own, so the teaser goes instead.
    const supersedesSummary =
      summary !== '' && paragraphs.length > 0 && normaliseText(paragraphs[0]).startsWith(summary);

    return { paragraphs, supersedesSummary };
  }, [details, event.summary]);

  const showSummary = !(expanded && detail.supersedesSummary);

  // Stable across renders and unique per row, which is what aria-controls needs
  // to point at anything. useId rather than the event id: a row can be rendered
  // twice on one page, pinned above the feed and again in its day.
  const detailId = `event-detail-${useId()}`;

  const rowClasses = [
    'event-row',
    expanded ? 'event-row--expanded' : '',
    isHighlighted ? 'event-row--highlighted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={rowClasses} data-event-id={event.id ?? undefined}>
      <button
        type="button"
        className="event-summary-btn"
        onClick={toggle}
        aria-expanded={expanded}
        // Names the region the button opens. Without it a screen reader
        // announces "expanded" and leaves the reader to hunt for what appeared.
        // Only while it exists: the detail is unmounted when collapsed, and an
        // aria-controls pointing at nothing is an invalid reference.
        aria-controls={expanded ? detailId : undefined}
      >
        {/* Two lines, not three. What and where are the pair a reader scans
            together, and giving the place a line of its own cost every row in
            the feed a line to say one word. */}
        <span className="event-main">
          <span className="event-head">
            {/* What happened leads the row. The county is where it happened:
                useful, but not what anyone scans a feed for, and it was set in
                the largest, heaviest type on the card while the kind of incident
                sat in an 11px badge underneath. */}
            <span className="event-type">
              {/* Decoration beside the word it decorates: a screen reader
                  reads the type, not "speaking head". */}
              <span className="event-type-emoji" aria-hidden="true">
                {event.emoji}
              </span>
              {event.type}
            </span>
            {/* The most specific place we have, which is the half that answers
                "is this near me". The county rides along in the tooltip rather
                than taking room on the row: when the source files a notice under
                a county but names the municipality in its title, the
                municipality is the useful word. */}
            <span className="event-place" title={place}>
              {event.place || event.location}
            </span>
            {event.wasUpdated && event.updated && (
              <span className="badge badge--neutral" title={`Uppdaterad ${event.updated}`}>
                uppdaterad
              </span>
            )}
            {/* The title carries whichever of the two the row is not showing. */}
            <span className="event-time" title={isToday ? absoluteTime : relativeTime}>
              {headTime}
            </span>
          </span>
          {showSummary && <span className="event-text">{event.summary}</span>}
        </span>

        <span className="event-chevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="event-detail" id={detailId}>
          {loading && (
            <span className="event-detail-status">
              <span className="spinner-sm" />
              Hämtar hela texten…
            </span>
          )}
          {/* The summary above is already the substance of the notice, so a
              failed detail fetch is a footnote rather than an error banner. */}
          {error && (
            <span className="event-detail-status">
              Hela texten kunde inte hämtas. Läs den på polisen.se nedan.
            </span>
          )}
          {/* Paragraphs separated by blank lines: from the scraped page or,
              for imported events, from their stored body. Rendered as one <p>,
              those breaks would collapse. */}
          {detail.paragraphs.map((paragraph, i) => (
            <p className="event-detail-text" key={i}>
              {paragraph}
            </p>
          ))}

          {/* After the text, not before it. Sitting above the body this line
              landed between the teaser and the paragraph that continues it, so
              the notice read as one sentence, a timestamp, then the rest. The
              exact time is a footnote to the story, and the row's own head
              already says how long ago it was. */}
          <p className="event-detail-time">
            Inträffade {absoluteTime}
            {event.wasUpdated && updatedTime ? ` · uppdaterad ${updatedTime}` : ''}
          </p>

          <div className="event-actions">
            {event.url && (
              <a
                className="btn-ghost"
                href={`https://polisen.se${event.url}`}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                Läs hos polisen
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                </svg>
                <span className="sr-only">(öppnas i ny flik)</span>
              </a>
            )}
            {gpsCoords && (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleShowMap}
                title="Kartan visar var anmälan upprättades, inte alltid exakt brottsplats"
              >
                Visa på karta
              </button>
            )}
            {event.id !== null && (
              <button
                type="button"
                className={`btn-ghost${copied ? ' btn-ghost--done' : ''}`}
                onClick={handleShare}
                title="Dela en länk till den här händelsen"
              >
                {copied ? 'Länk kopierad' : 'Dela'}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
