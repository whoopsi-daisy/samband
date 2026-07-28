'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { FormattedEvent } from '@/types';
import { formatRelativeTime } from '@/lib/utils';
import { useNow } from '@/hooks/useNow';

interface EventCardProps {
  event: FormattedEvent;
  onShowMap?: (lat: number, lng: number, location: string) => void;
  isHighlighted?: boolean;
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

export default function EventCard({ event, onShowMap, isHighlighted }: EventCardProps) {
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

  // A deep link (?event=123) opens the incident already expanded.
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

  const handleShare = useCallback(async () => {
    if (event.id === null) return;
    const url = `${window.location.origin}/?event=${event.id}`;

    // On a phone this is what "dela" means to the reader — the OS share sheet,
    // with the messaging apps they actually use in it. Copying a URL to the
    // clipboard is the desktop fallback, not the primary behaviour.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${event.type} — ${event.location}`, url });
        return;
      } catch {
        // Dismissed, or unavailable in this context — fall through to copying.
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
  }, [event.id, event.type, event.location]);

  // Keep the relative time fresh without breaking hydration: until the shared
  // clock reports in, reuse the string the server already computed, so the
  // first client render matches the server markup exactly.
  const now = useNow();
  const relativeTime = useMemo(() => {
    if (now === null) return event.date.relative;
    return formatRelativeTime(new Date(event.date.iso || event.datetime), new Date(now));
  }, [now, event.date.iso, event.date.relative, event.datetime]);

  // "28 jul, 14:32" — the clock time behind "2 timmar sedan". Shown outright
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
  // above it — the same sentence twice, a few pixels apart. Imported events do
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

    // What is left may still open with the teaser and carry on past it — the
    // longer text stands on its own, so the teaser goes instead.
    const supersedesSummary =
      summary !== '' && paragraphs.length > 0 && normaliseText(paragraphs[0]).startsWith(summary);

    return { paragraphs, supersedesSummary };
  }, [details, event.summary]);

  const showSummary = !(expanded && detail.supersedesSummary);

  const rowClasses = [
    'event-row',
    expanded ? 'event-row--expanded' : '',
    isHighlighted ? 'event-row--highlighted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={rowClasses} data-event-id={event.id ?? undefined}>
      <button type="button" className="event-summary-btn" onClick={toggle} aria-expanded={expanded}>
        {/* Where, then what, then the summary — each on its own line, so the
            same information sits in the same place in every row. */}
        <span className="event-main">
          {/* What happened leads the row. The county is where it happened —
              useful, but not what anyone scans a feed for, and it was set in
              the largest, heaviest type on the card while the kind of incident
              sat in an 11px badge underneath. */}
          <span className="event-head">
            <span className="event-type">
              {/* Decoration beside the word it decorates — a screen reader
                  reads the type, not "speaking head". */}
              <span className="event-type-emoji" aria-hidden="true">
                {event.emoji}
              </span>
              {event.type}
            </span>
            <span className="event-time" title={absoluteTime}>
              {relativeTime}
            </span>
          </span>
          <span className="event-meta">
            <span className="event-location">{event.location}</span>
            {event.wasUpdated && event.updated && (
              <span className="badge badge--neutral" title={`Uppdaterad ${event.updated}`}>
                uppdaterad
              </span>
            )}
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
        <div className="event-detail">
          <p className="event-detail-time">
            Inträffade {absoluteTime}
            {event.wasUpdated && updatedTime ? ` · uppdaterad ${updatedTime}` : ''}
          </p>

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
              Hela texten kunde inte hämtas just nu — läs den på polisen.se nedan.
            </span>
          )}
          {/* Paragraphs separated by blank lines — from the scraped page or,
              for imported events, from their stored body. Rendered as one <p>,
              those breaks would collapse. */}
          {detail.paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}

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
