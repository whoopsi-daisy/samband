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

// The emoji is the fastest thing on a row — a reader scans the column of glyphs
// long before they read a single word — so the table below covers polisen.se's
// published vocabulary outright rather than a dozen headline categories. It
// used to hold fourteen entries against a feed that emits something over sixty
// type strings, which meant most rows fell through to the 📍 pin and the column
// carried no information at all.
//
// Emoji are picked to be legible at 13px and distinct within a colour family,
// and kept plain rather than lurid — these are real incidents, and the glyph is
// there to speed up recognition, not to editorialise.
//
// Colour groups by family rather than by individual type: reds for violence and
// weapons, oranges and yellows for theft, blues for traffic, teal for rescue and
// health, and a neutral grey for the summary posts, which are not incidents at
// all. Sixty visually separable hues do not exist, and the map legend prints the
// emoji and the type's name beside every dot, so the hue answers "what kind of
// thing is this" and the pair beside it answers "which one".
export const TYPE_STYLES: Record<string, TypeStyle> = {
  // ── Death and grave violence ──────────────────────────────
  'Mord/dråp': { emoji: '⚰️', color: '#991b1b' },
  'Mord/dråp, försök': { emoji: '⚰️', color: '#991b1b' },
  'Anträffad död': { emoji: '🕯️', color: '#991b1b' },
  'Våldtäkt': { emoji: '🚷', color: '#9f1239' },
  'Våldtäkt, försök': { emoji: '🚷', color: '#9f1239' },
  'Sedlighetsbrott': { emoji: '🚷', color: '#9f1239' },
  'Olaga frihetsberövande': { emoji: '⛓️', color: '#9f1239' },
  'Människorov': { emoji: '⛓️', color: '#9f1239' },
  'Misshandel, grov': { emoji: '🤕', color: '#be123c' },
  'Misshandel': { emoji: '🤕', color: '#f43f5e' },
  'Bråk': { emoji: '👊', color: '#f43f5e' },

  // ── Weapons, explosives, alarms ───────────────────────────
  'Skottlossning': { emoji: '🔫', color: '#b91c1c' },
  'Skottlossning, misstänkt': { emoji: '🔫', color: '#b91c1c' },
  'Vapenlagen': { emoji: '🗡️', color: '#b91c1c' },
  'Knivlagen': { emoji: '🔪', color: '#b91c1c' },
  'Bombhot': { emoji: '💣', color: '#b91c1c' },
  'Detonation': { emoji: '💥', color: '#b91c1c' },
  'Explosion': { emoji: '💥', color: '#b91c1c' },
  'Farligt föremål, misstänkt': { emoji: '🧨', color: '#b91c1c' },
  'Larm Överfall': { emoji: '🆘', color: '#e11d48' },
  'Larm Inbrott': { emoji: '🔔', color: '#f97316' },

  // ── Threats and harassment ────────────────────────────────
  'Olaga hot': { emoji: '❗', color: '#e11d48' },
  'Våld/hot mot tjänsteman': { emoji: '👮', color: '#e11d48' },
  'Ofredande/förargelse': { emoji: '😠', color: '#ec4899' },
  'Ofredande': { emoji: '😠', color: '#ec4899' },
  'Ofog barn/ungdom': { emoji: '🧒', color: '#ec4899' },
  'Olaga intrång/hemfridsbrott': { emoji: '🏠', color: '#db2777' },
  'Åldringsbrott': { emoji: '👵', color: '#db2777' },

  // ── Fire ──────────────────────────────────────────────────
  'Brand': { emoji: '🔥', color: '#ef4444' },
  'Brand automatlarm': { emoji: '🚨', color: '#ef4444' },

  // ── Theft, robbery, damage ────────────────────────────────
  'Rån': { emoji: '💰', color: '#f59e0b' },
  'Rån väpnat': { emoji: '💰', color: '#f59e0b' },
  'Rån, försök': { emoji: '💰', color: '#f59e0b' },
  'Rån övrigt': { emoji: '💰', color: '#f59e0b' },
  'Inbrott': { emoji: '🪟', color: '#f97316' },
  'Inbrott, försök': { emoji: '🪟', color: '#f97316' },
  'Stöld/inbrott': { emoji: '🚪', color: '#c2410c' },
  'Stöld': { emoji: '👜', color: '#fbbf24' },
  'Stöld, försök': { emoji: '👜', color: '#fbbf24' },
  'Stöld, ringa': { emoji: '🏷️', color: '#fcd34d' },
  'Snatteri': { emoji: '🏷️', color: '#fcd34d' },
  'Motorfordon, stöld': { emoji: '🔑', color: '#d97706' },
  'Motorfordon, anträffat stulet': { emoji: '🔑', color: '#d97706' },
  'Häleri': { emoji: '📦', color: '#92400e' },
  'Anträffat gods': { emoji: '📦', color: '#92400e' },
  'Skadegörelse': { emoji: '🔨', color: '#a16207' },

  // ── Traffic ───────────────────────────────────────────────
  'Trafikolycka': { emoji: '🚗', color: '#3b82f6' },
  'Trafikolycka, personskada': { emoji: '🚗', color: '#3b82f6' },
  'Trafikolycka, singel': { emoji: '🚗', color: '#3b82f6' },
  'Trafikolycka, smitning från': { emoji: '🚗', color: '#3b82f6' },
  'Trafikolycka, vilt': { emoji: '🦌', color: '#3b82f6' },
  'Trafikbrott': { emoji: '🚦', color: '#2563eb' },
  'Olovlig körning': { emoji: '🚫', color: '#2563eb' },
  'Trafikhinder': { emoji: '🚧', color: '#1d4ed8' },
  'Varningslarm/haveri': { emoji: '⚠️', color: '#1d4ed8' },
  'Trafikkontroll': { emoji: '🛑', color: '#60a5fa' },
  'Kontroll person/fordon': { emoji: '🔍', color: '#60a5fa' },
  'Gränskontroll': { emoji: '🛂', color: '#60a5fa' },

  // ── Intoxication and drugs ────────────────────────────────
  'Rattfylleri': { emoji: '🍺', color: '#0891b2' },
  'Fylleri/LOB': { emoji: '🍺', color: '#0891b2' },
  'Alkohollagen': { emoji: '🍷', color: '#0891b2' },
  'Narkotikabrott': { emoji: '💊', color: '#10b981' },

  // ── Money, documents, environment ─────────────────────────
  'Bedrägeri': { emoji: '💳', color: '#8b5cf6' },
  'Ekobrott': { emoji: '📊', color: '#7c3aed' },
  'Förfalskningsbrott': { emoji: '📝', color: '#7c3aed' },
  'Missbruk av urkund': { emoji: '📝', color: '#7c3aed' },
  'Penningtvätt': { emoji: '🏦', color: '#7c3aed' },
  'Miljöbrott': { emoji: '🌿', color: '#65a30d' },
  'Djur': { emoji: '🐾', color: '#65a30d' },

  // ── Rescue, health, missing people ────────────────────────
  'Sjukdom/olycksfall': { emoji: '🚑', color: '#14b8a6' },
  'Arbetsplatsolycka': { emoji: '🦺', color: '#14b8a6' },
  'Räddningsinsats': { emoji: '🚒', color: '#14b8a6' },
  'Fjällräddning': { emoji: '🏔️', color: '#14b8a6' },
  'Sjölagen': { emoji: '⚓️', color: '#14b8a6' },
  'Naturkatastrof': { emoji: '🌪️', color: '#14b8a6' },
  'Försvunnen person': { emoji: '🔦', color: '#14b8a6' },

  // ── Police operations and housekeeping ────────────────────
  'Polisinsats/kommendering': { emoji: '🚓', color: '#6366f1' },
  'Ordningslagen': { emoji: '📢', color: '#6366f1' },
  'Sammanfattning': { emoji: '📋', color: '#64748b' },
  'Uppdatering': { emoji: '🔄', color: '#64748b' },
  'Övrigt': { emoji: '📄', color: '#64748b' },

  'default': { emoji: '📍', color: '#94a3b8' },
};

/** Lowercased, single-spaced — the shape both lookups below compare on. */
function normaliseTypeName(type: string): string {
  return type.toLowerCase().replace(/\s+/g, ' ').trim();
}

const STYLES_BY_NAME = new Map<string, TypeStyle>(
  Object.entries(TYPE_STYLES).map(([name, style]) => [normaliseTypeName(name), style])
);

// Last resort before the pin: a word the type contains, for strings the table
// above does not name outright. Ordered, first match wins, so the specific
// patterns have to precede the general ones — "trafikolycka" before "olycka",
// "rattfylleri" before "fylleri". Anchored on word boundaries, since a bare
// `includes` matched "rån" inside "hjulrån" and "brand" inside "varumärkes-".
const KEYWORD_STYLES: Array<[RegExp, TypeStyle]> = [
  [/\bsammanfattning\b/, TYPE_STYLES['Sammanfattning']],
  [/\buppdatering\b/, TYPE_STYLES['Uppdatering']],
  [/\bmord\b|\bdråp\b/, TYPE_STYLES['Mord/dråp']],
  [/\bvåldtäkt\b|\bsexualbrott\b/, TYPE_STYLES['Våldtäkt']],
  [/\bskottloss/, TYPE_STYLES['Skottlossning']],
  [/\bexplosion\b|\bdetonation\b|\bsprängn/, TYPE_STYLES['Detonation']],
  [/\bvapen/, TYPE_STYLES['Vapenlagen']],
  [/\bmisshandel\b/, TYPE_STYLES['Misshandel']],
  [/\bhot\b/, TYPE_STYLES['Olaga hot']],
  [/\bofredande\b|\bförargelse\b/, TYPE_STYLES['Ofredande/förargelse']],
  [/\bbrand\b|\bbrinner\b/, TYPE_STYLES['Brand']],
  [/\brån\b/, TYPE_STYLES['Rån']],
  [/\binbrott\b/, TYPE_STYLES['Inbrott']],
  [/\bstöld\b|\bstulet\b|\bstulen\b/, TYPE_STYLES['Stöld']],
  [/\bskadegörelse\b/, TYPE_STYLES['Skadegörelse']],
  [/\btrafikolycka\b/, TYPE_STYLES['Trafikolycka']],
  [/\btrafik/, TYPE_STYLES['Trafikbrott']],
  [/\brattfylleri\b/, TYPE_STYLES['Rattfylleri']],
  [/\bfylleri\b|\balkohol/, TYPE_STYLES['Fylleri/LOB']],
  [/\bnarkotika/, TYPE_STYLES['Narkotikabrott']],
  [/\bbedrägeri\b/, TYPE_STYLES['Bedrägeri']],
  [/\bräddning/, TYPE_STYLES['Räddningsinsats']],
  [/\bolycka\b|\bolycksfall\b/, TYPE_STYLES['Sjukdom/olycksfall']],
  [/\bförsvunnen\b|\bsavnad\b/, TYPE_STYLES['Försvunnen person']],
  [/\bkontroll\b/, TYPE_STYLES['Kontroll person/fordon']],
  [/\bpolisinsats\b|\bkommendering\b/, TYPE_STYLES['Polisinsats/kommendering']],
  [/\blarm\b/, TYPE_STYLES['Larm Inbrott']],
  [/\bövrigt\b/, TYPE_STYLES['Övrigt']],
];

export function getTypeStyle(type: string): TypeStyle {
  const name = normaliseTypeName(type);
  if (!name) return TYPE_STYLES['default'];

  const exact = STYLES_BY_NAME.get(name);
  if (exact) return exact;

  // polisen.se qualifies a base type with a trailing clause: "Trafikolycka,
  // smitning från", "Stöld, ringa". Drop the qualifiers from the right until
  // the stem is one the table names. Longest stem wins, so "stöld/inbrott"
  // never resolves as plain "stöld".
  //
  // This replaced a bidirectional `includes` over the table, which matched on
  // whichever key happened to be declared first: with "Brand automatlarm"
  // present, every plain "Brand" resolved to the automatic-alarm style.
  const cuts: number[] = [];
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ',' || name[i] === '/') cuts.push(i);
  }
  for (let i = cuts.length - 1; i >= 0; i--) {
    const stem = STYLES_BY_NAME.get(name.slice(0, cuts[i]).trim());
    if (stem) return stem;
  }

  for (const [pattern, style] of KEYWORD_STYLES) {
    if (pattern.test(name)) return style;
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
