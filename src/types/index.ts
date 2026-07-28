// Event types from Police API
export interface RawEvent {
  id: number;
  datetime: string;
  name: string;
  summary: string;
  url: string;
  type: string;
  location: {
    name: string;
    gps: string;
  };
}

export interface EventWithMetadata extends RawEvent {
  event_time: string;
  publish_time: string;
  last_updated: string;
  was_updated: boolean;
}

export interface FormattedEvent {
  id: number | null;
  datetime: string;
  name: string;
  summary: string;
  url: string;
  type: string;
  location: string;
  gps: string;
  color: string;
  emoji: string;
  date: {
    day: string;
    month: string;
    time: string;
    relative: string;
    iso: string;
  };
  wasUpdated: boolean;
  updated: string;
}

export interface EventFilters {
  location?: string;
  type?: string;
  search?: string;
}

// Statistics types
export interface DailyStats {
  date: string;
  day: string;
  count: number;
}

export interface TopItem {
  label: string;
  total: number;
}

export interface Statistics {
  total: number;
  totalStored: number;
  last24h: number;
  last7d: number;
  last30d: number;
  avgPerDay: number;
  topTypes: TopItem[];
  topLocations: TopItem[];
  hourly: number[];
  weekdays: number[];
  daily: DailyStats[];
  gpsPercent: number;
  updatedPercent: number;
  uniqueLocations: number;
  uniqueTypes: number;
  /** Oldest event in the dataset, live feed and archive together. */
  oldestEvent: string | null;
  /** Imported events the app counts — those older than the live feed reaches. */
  archiveEvents: number;
  /** Where the archive hands over to the live feed. Null when nothing is imported. */
  archiveCutoff: string | null;
}

// Type style mapping
export interface TypeStyle {
  /**
   * Shown immediately before the type's name, never on its own. A line-art
   * glyph sat here before, in a column of its own with the name elsewhere —
   * which asked the reader to decode a small abstract drawing. An emoji beside
   * its own word asks nothing.
   */
  emoji: string;
  /** Marker colour on the map, and the map legend's key. */
  color: string;
}

// One colour per type, all distinguishable side by side. Five types used to
// share #ef4444 and three more shared #f97316, which was invisible while the
// colours only tinted markers — and a plain contradiction once the map grew a
// legend saying the colour tells you the type.
//
// Loosely grouped by hue so related types still read as related: reds for
// violence, oranges/yellows for theft, blues for traffic, and a neutral grey
// for the summary posts, which are not incidents at all.
// Emoji are picked to be legible at 13px and distinct from one another, and
// kept plain rather than lurid — these are real incidents, and the glyph is
// there to speed up recognition, not to editorialise. Loudness roughly tracks
// severity, so the most serious types read as the most serious at a glance.
export const TYPE_STYLES: Record<string, TypeStyle> = {
  'Mord/dråp': { emoji: '🚨', color: '#991b1b' },
  'Brand': { emoji: '🔥', color: '#ef4444' },
  'Misshandel': { emoji: '🤕', color: '#f43f5e' },
  'Ofredande': { emoji: '😠', color: '#ec4899' },
  'Rån': { emoji: '💰', color: '#f59e0b' },
  'Inbrott': { emoji: '🪟', color: '#f97316' },
  'Stöld/inbrott': { emoji: '🚪', color: '#c2410c' },
  'Stöld': { emoji: '👜', color: '#fbbf24' },
  'Skadegörelse': { emoji: '🔨', color: '#a16207' },
  'Trafikolycka': { emoji: '🚗', color: '#3b82f6' },
  'Rattfylleri': { emoji: '🍺', color: '#0891b2' },
  'Narkotikabrott': { emoji: '💊', color: '#10b981' },
  'Bedrägeri': { emoji: '💳', color: '#8b5cf6' },
  'Sammanfattning': { emoji: '📋', color: '#64748b' },
  'default': { emoji: '📍', color: '#94a3b8' },
};

export function getTypeStyle(type: string): TypeStyle {
  if (TYPE_STYLES[type]) {
    return TYPE_STYLES[type];
  }
  // Try partial match
  for (const [key, style] of Object.entries(TYPE_STYLES)) {
    if (type.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(type.toLowerCase())) {
      return style;
    }
  }
  return TYPE_STYLES['default'];
}

// Operational monitoring types
export interface OperationalStats {
  totalFetches: number;
  successfulFetches: number;
  failedFetches: number;
  fetches24h: number;
  fetches7d: number;
  successRate: number;
  avgFetchInterval: number;
  lastSuccessfulFetch: string | null;
  lastFailedFetch: string | null;
  recentErrors: Array<{ fetched_at: string; error_type: string }>;
  hourlyFetches: number[];
  avgEventsPerFetch: number;
  eventsAddedToday: number;
  uptimeScore: number;
}

export interface FetchLogEntry {
  id: number;
  fetchedAt: string;
  eventsFetched: number;
  eventsNew: number;
  success: boolean;
  errorType: string | null;
}

export interface DatabaseHealth {
  totalEvents: number;
  totalFetchLogs: number;
  eventsWithGps: number;
  eventsWithGpsPercent: number;
  uniqueLocations: number;
  uniqueTypes: number;
  oldestEvent: string | null;
  newestEvent: string | null;
  eventsByType: Array<{ type: string; count: number }>;
  dataFreshnessMinutes: number;
  updatedEvents: number;
  updatedEventsPercent: number;
}

// Brottsplatskartan import types
//
// Stored separately from polisen.se events: the two sources have independent
// id spaces, so they cannot share the `events` table without collisions.
export interface BpkEvent {
  id: number;
  pubdate: string;
  titleType: string | null;
  titleLocation: string | null;
  headline: string | null;
  description: string | null;
  locationString: string | null;
  county: string | null;
  lat: number | null;
  lng: number | null;
  permalink: string | null;
}

export type BpkImportStatus = 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
// 'ndjson' loads a local dump (or a URL) instead of walking the API.
export type BpkImportMode = 'full' | 'incremental' | 'ndjson';

export interface BpkImportState {
  status: BpkImportStatus;
  mode: BpkImportMode | null;
  lastPageDone: number;
  totalPages: number | null;
  totalEvents: number | null;
  perPage: number | null;
  imported: number;
  duplicates: number;
  newestPubdateUnix: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  /** Rows actually in bpk_events, independent of the counters above. */
  storedEvents: number;
}
