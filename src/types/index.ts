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
  icon: string;
  iconKey: string;
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
  icon: string;
  iconKey: string;
  color: string;
  class: string;
}

export const TYPE_STYLES: Record<string, TypeStyle> = {
  'Inbrott': { icon: '🔓', iconKey: 'door', color: '#f97316', class: 'event-type--inbrott' },
  'Brand': { icon: '🔥', iconKey: 'flame', color: '#ef4444', class: 'event-type--brand' },
  'Rån': { icon: '💰', iconKey: 'banknote', color: '#f59e0b', class: 'event-type--ran' },
  'Trafikolycka': { icon: '🚗', iconKey: 'car', color: '#3b82f6', class: 'event-type--trafikolycka' },
  'Misshandel': { icon: '👊', iconKey: 'shield', color: '#ef4444', class: 'event-type--misshandel' },
  'Skadegörelse': { icon: '🔨', iconKey: 'hammer', color: '#f59e0b', class: 'event-type--skadegorelse' },
  'Bedrägeri': { icon: '🕵️', iconKey: 'search', color: '#8b5cf6', class: 'event-type--bedrageri' },
  'Narkotikabrott': { icon: '💊', iconKey: 'pill', color: '#10b981', class: 'event-type--narkotikabrott' },
  'Ofredande': { icon: '🚨', iconKey: 'siren', color: '#f43f5e', class: 'event-type--ofredande' },
  'Sammanfattning': { icon: '📊', iconKey: 'chart', color: '#22c55e', class: 'event-type--sammanfattning' },
  'Stöld': { icon: '🔓', iconKey: 'bag', color: '#f97316', class: 'event-type--stold' },
  'Stöld/inbrott': { icon: '🔓', iconKey: 'door', color: '#f97316', class: 'event-type--stold' },
  'Mord/dråp': { icon: '⚠️', iconKey: 'octagon', color: '#dc2626', class: 'event-type--mord' },
  'Rattfylleri': { icon: '🚗', iconKey: 'car', color: '#ef4444', class: 'event-type--ratta' },
  'default': { icon: '📌', iconKey: 'pin', color: '#fcd34d', class: 'event-type--default' },
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

export function getTypeClass(type: string): string {
  return getTypeStyle(type).class;
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
