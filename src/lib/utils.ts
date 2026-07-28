import { EventWithMetadata, FormattedEvent, getTypeStyle } from '@/types';

// Which Swedish calendar day an instant falls on, as "YYYY-MM-DD".
//
// Fixed to Europe/Stockholm rather than the runtime's own zone. These are
// Swedish police incidents, dated in Swedish local time everywhere else in the
// app — and the day grouping this feeds renders on the server as well as in
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
  return `${diffDays} ${diffDays === 1 ? 'dag' : 'dagar'} sedan`;
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

  return {
    id: event.id ?? null,
    datetime: eventTime,
    name: event.name || '',
    summary: event.summary || '',
    url: event.url || '',
    type,
    location: event.location?.name || '',
    gps: event.location?.gps || '',
    color: style.color,
    icon: style.icon,
    iconKey: style.iconKey,
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
