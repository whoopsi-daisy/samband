import { EventWithMetadata, FormattedEvent, MapEvent, getTypeStyle } from '@/types';
import { MUNICIPALITY_CENTROIDS } from './municipalityCentroids';

// Which Swedish calendar day an instant falls on, as "YYYY-MM-DD".
//
// Fixed to Europe/Stockholm rather than the runtime's own zone. These are
// Swedish police incidents, dated in Swedish local time everywhere else in the
// app, and the day grouping this feeds renders on the server as well as in
// the browser, so leaving it to the runtime would give a reader outside Sweden
// different day headings than the server produced. React reports that as a
// hydration mismatch and throws the server-rendered feed away. Any feed that
// spans midnight hits it, which an imported archive always does.
//
// sv-SE already formats dates in exactly this shape.
const swedishDayFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function swedishDayKey(date: Date): string {
  return swedishDayFormat.format(date);
}

/**
 * The same age, short enough to share a line.
 *
 * A feed row on a phone carries the type, the place and the time, and at 390px
 * "3 timmar sedan" takes enough of that line that a long type and its place
 * both end up as ellipses. Only rows filed today show a relative time at all,
 * so this never has to render anything coarser than hours; anything older falls
 * through to the full wording, which is what the pinned linked event uses.
 *
 * The long form stays on the element as its accessible name, so "3 tim" is what
 * you read and "3 timmar sedan" is what a screen reader announces.
 */
export function formatShortRelativeTime(date: Date, now: Date): string {
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSeconds < 60) return 'Just nu';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} tim`;

  return formatRelativeTime(date, now);
}

export function formatRelativeTime(date: Date, now: Date): string {
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSeconds < 60) {
    return 'Just nu';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} min sedan`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'timme' : 'timmar'} sedan`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 14) {
    return `${diffDays} ${diffDays === 1 ? 'dag' : 'dagar'} sedan`;
  }

  // Days all the way up was fine for a feed covering a week. The archive
  // reaches back to 2016, where it produced "3 214 dagar sedan", a number
  // nobody can turn into a date in their head.
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffDays < 60) {
    return `${diffWeeks} ${diffWeeks === 1 ? 'vecka' : 'veckor'} sedan`;
  }

  const diffMonths = Math.floor(diffDays / 30.44);
  if (diffMonths < 18) {
    return `${diffMonths} ${diffMonths === 1 ? 'månad' : 'månader'} sedan`;
  }

  const diffYears = Math.floor(diffDays / 365.25);
  return `${diffYears} ${diffYears === 1 ? 'år' : 'år'} sedan`;
}

// polisen.se titles a notice "16 juli 08:53, Trafikolycka, Ljungby": time, then
// type, then place. For a good part of the feed the `location` field carries
// only the county, so the municipality appears nowhere on the row and a reader
// scanning it cannot tell whether something happened in their town or 200km
// away without opening the notice.
const NOTICE_TITLE = /^\d{1,2}\s+\p{L}+\s+\d{1,2}[:.]\d{2},\s*(.+)$/u;

/** "Kronobergs län" and the like: an area, not a place. */
function isCounty(value: string): boolean {
  return /\slän$/i.test(value.trim());
}

/**
 * The municipality named in the notice's own title, when it says more than the
 * location field does. Empty otherwise: showing a county twice, or promoting a
 * county over the municipality beside it, would make the row less precise
 * rather than more, and where an incident happened is not a detail to guess at.
 */
export function placeFromTitle(title: string, location: string): string {
  const match = NOTICE_TITLE.exec(title.trim());
  if (!match) return '';

  const parts = match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  // Type, then place. One segment is the type alone, with no place to take.
  if (parts.length < 2) return '';

  const place = parts[parts.length - 1];
  if (!place) return '';
  if (place.toLowerCase() === location.trim().toLowerCase()) return '';
  // The title is the broader of the two, so it adds nothing.
  if (isCounty(place) && !isCounty(location)) return '';

  return place;
}

/**
 * Where to draw a notice, which is not always where polisen.se said.
 *
 * The feed sets `location.name` to a county and `location.gps` to that county's
 * centre for a large share of its notices. Twenty-one counties means twenty-one
 * coordinates: a month of national notices drew 380 incidents as 21 dots, each
 * sitting in the middle of a county, most of them nowhere near anything that
 * happened. A map that cannot say which town is not a map.
 *
 * The notice's own title is finer, and the app already recovers the
 * municipality from it for the feed rows. Where it has one, and where the
 * location field is only a county, the municipality's centre is used instead:
 * twenty times tighter, and the same thing Brottsplatskartan did to produce the
 * archive's coordinates, so the two sources finally agree.
 *
 * Deliberately conservative. It only ever replaces a county centre, never a
 * position the feed gave at municipal level or finer, and only with a
 * municipality this app can name. Anything it cannot improve it leaves alone.
 *
 * The honest limit: the centre used is the municipality's polygon centroid, not
 * the town of the same name. For a compact southern kommun those are within a
 * few kilometres; for a large northern one they are not. It remains an order of
 * magnitude better than a county centre, and the map already says the point is
 * where the report was written rather than where something happened.
 */
export function positionFor(location: string, place: string, gps: string): string {
  if (!place || !isCounty(location)) return gps;

  const centroid = MUNICIPALITY_CENTROIDS.get(place.toLowerCase().replace(/\s+/g, ' ').trim());
  if (!centroid) return gps;

  return `${centroid[0]},${centroid[1]}`;
}

/**
 * The same notice, cut down to what the map draws with.
 *
 * Shares positionFor with the feed, so a pin and its row never disagree about
 * where a notice happened.
 */
export function formatEventForMap(event: EventWithMetadata): MapEvent {
  const name = event.name || '';
  const location = event.location?.name || '';
  const place = placeFromTitle(name, location);
  const when = event.event_time || event.datetime || '';
  const parsed = new Date(when);

  return {
    gps: positionFor(location, place, event.location?.gps || ''),
    type: event.type || 'Okänd',
    place,
    location,
    url: event.url || '',
    iso: isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(),
  };
}

export function formatEventForUi(event: EventWithMetadata): FormattedEvent {
  const now = new Date();
  const eventTime = event.event_time || event.datetime || now.toISOString();

  let date = new Date(eventTime);
  if (isNaN(date.getTime())) {
    date = now;
  }

  const type = event.type || 'Okänd';
  const style = getTypeStyle(type);

  const updated = event.last_updated || event.publish_time || null;
  const updatedDate = updated ? new Date(updated) : null;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

  const name = event.name || '';
  const location = event.location?.name || '';
  const place = placeFromTitle(name, location);

  return {
    id: event.id ?? null,
    datetime: eventTime,
    name,
    summary: event.summary || '',
    url: event.url || '',
    type,
    location,
    place,
    gps: positionFor(location, place, event.location?.gps || ''),
    color: style.color,
    emoji: style.emoji,
    date: {
      day: String(date.getDate()).padStart(2, '0'),
      month: months[date.getMonth()],
      time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
      relative: formatRelativeTime(date, now),
      iso: date.toISOString(),
    },
    wasUpdated: !!event.was_updated,
    updated: updatedDate
      ? `${updatedDate.getFullYear()}-${String(updatedDate.getMonth() + 1).padStart(2, '0')}-${String(updatedDate.getDate()).padStart(2, '0')} ${String(updatedDate.getHours()).padStart(2, '0')}:${String(updatedDate.getMinutes()).padStart(2, '0')}`
      : '',
  };
}

export function sanitizeInput(input: string, maxLength = 255): string {
  // Remove null bytes and control characters
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');
  // Trim and limit length
  return sanitized.trim().substring(0, maxLength);
}

export function sanitizeLocation(location: string): string {
  const sanitized = sanitizeInput(location, 100);
  // Only allow alphanumeric, spaces, Swedish chars, and common punctuation
  return sanitized.replace(/[^a-zA-ZåäöÅÄÖ0-9\s\-,\.]/g, '');
}

export function sanitizeType(type: string): string {
  const sanitized = sanitizeInput(type, 100);
  // Only allow alphanumeric, spaces, Swedish chars, and slashes
  return sanitized.replace(/[^a-zA-ZåäöÅÄÖ0-9\s\/\-,]/g, '');
}

export function sanitizeSearch(search: string): string {
  return sanitizeInput(search, 200);
}

// Escape SQL LIKE wildcards to prevent wildcard injection
export function escapeLikeWildcards(value: string): string {
  // Escape %, _, and \ characters for use in SQLite LIKE queries
  return value
    .replace(/\\/g, '\\\\')  // Escape backslash first
    .replace(/%/g, '\\%')    // Escape percent
    .replace(/_/g, '\\_');   // Escape underscore
}
