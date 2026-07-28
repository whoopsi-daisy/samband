'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { FormattedEvent } from '@/types';
import { TypeIcon } from './TypeIcon';
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
export default function EventCard({ event, onShowMap, isHighlighted }: EventCardProps) {
  const [expanded, setExpanded] = useState(isHighlighted || false);
  const [details, setDetails] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDetails = useCallback(async () => {
    if (!event.url) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/details?url=${encodeURIComponent(event.url)}`);
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
  }, [event.url]);

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
    if (event.url && !details && !loading) {
      fetchDetails();
    }
  }, [expanded, event.url, details, loading, fetchDetails]);

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
  }, [event.id]);

  // Keep the relative time fresh without breaking hydration: until the shared
  // clock reports in, reuse the string the server already computed, so the
  // first client render matches the server markup exactly.
  const now = useNow();
  const relativeTime = useMemo(() => {
    if (now === null) return event.date.relative;
    return formatRelativeTime(new Date(event.date.iso || event.datetime), new Date(now));
  }, [now, event.date.iso, event.date.relative, event.datetime]);

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
        <span className="event-icon">
          <TypeIcon name={event.iconKey} size={20} />
        </span>

        <span className="event-main">
          <span className="event-head">
            <span className="event-type">{event.type}</span>
            <span className="event-location">{event.location}</span>
            {event.wasUpdated && event.updated && (
              <span className="event-updated" title={`Uppdaterad ${event.updated}`}>
                uppdaterad
              </span>
            )}
            <span className="event-time" title={`${event.date.day} ${event.date.month} ${event.date.time}`}>
              {relativeTime}
            </span>
          </span>
          <span className="event-text">{event.summary}</span>
        </span>

        <span className="event-chevron" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="event-detail">
          {loading && <span className="event-detail-status">Laddar detaljer…</span>}
          {error && (
            <span className="event-detail-status event-detail-status--error">
              Kunde inte hämta detaljer. Öppna polisen.se för att läsa mer.
            </span>
          )}
          {details && <p>{details}</p>}

          <div className="event-actions">
            {event.url && (
              <a
                className="event-action"
                href={`https://polisen.se${event.url}`}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                polisen.se
              </a>
            )}
            {gpsCoords && (
              <button
                type="button"
                className="event-action"
                onClick={handleShowMap}
                title="Platsen visar var anmälan upprättades"
              >
                Visa på karta
              </button>
            )}
            {event.id !== null && (
              <button
                type="button"
                className={`event-action${copied ? ' event-action--done' : ''}`}
                onClick={handleShare}
                title="Kopiera länk till händelse"
              >
                {copied ? 'Kopierad!' : 'Dela'}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
