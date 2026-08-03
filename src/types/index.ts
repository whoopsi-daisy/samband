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
  /** What the source files the notice under. Filters and grouping use this. */
  location: string;
  /**
   * The municipality, when the source filed the notice under a county and named
   * the municipality only in the headline. Empty when `location` is already the
   * most specific thing known, so a row never claims precision it does not have.
   */
  place: string;
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
  /** ISO timestamp. Only events at or after it, for the map's window. */
  since?: string;
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

/** One bar of the full-history chart. Years with no data are present at zero. */
export interface YearlyStats {
  year: string;
  count: number;
}

/**
 * One year of the record as twelve cells.
 *
 * A decade of history drawn as a single row of 120 bars is a hairline per
 * month, and it can only be read for trend. Laid out as a grid, one row per
 * year, the same numbers also read down the columns, which is where the
 * seasons are.
 */
export interface MonthGridRow {
  year: number;
  /** Twelve counts, January first. Null outside the record. */
  months: (number | null)[];
  total: number;
  /** True for the year in progress: its later months are not missing, just unlived. */
  running: boolean;
}

/** The shape of a year, averaged over the years that finished. */
export interface SeasonProfile {
  /** Mean count per calendar month, January first. Empty when nothing is complete. */
  average: number[];
  /** How many whole years the mean is over. Below two it is not a season. */
  years: number;
  busiestMonth: number | null;
  quietestMonth: number | null;
}

/**
 * This year against the same stretch of last year.
 *
 * A running year always looks small beside finished ones, which is why the
 * year chart cannot answer "is it worse this year". Cutting both at the same
 * day of the year can.
 */
export interface YearToDate {
  year: number;
  count: number;
  previousYear: number;
  previousCount: number;
  /** The day both are counted through, as MM-DD. */
  throughDay: string;
}

/** How one year's incidents split across the type families. */
export interface FamilyYear {
  year: string;
  total: number;
  shares: Array<{ family: string; label: string; count: number; share: number }>;
}

/** The single busiest calendar day in the record. */
export interface DailyPeak {
  date: string;
  count: number;
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
  /** Every year the dataset covers, oldest first. */
  yearly: YearlyStats[];
  /** The whole record as a year-by-month grid, oldest year first. */
  monthGrid: MonthGridRow[];
  /** The average shape of a year, over the years that finished. */
  season: SeasonProfile;
  /** This year against the same stretch of last year. Null with under two years. */
  yearToDate: YearToDate | null;
  /** Type-family mix per year, oldest first. Empty with under two years. */
  familyByYear: FamilyYear[];
  /** The busiest single day on record, across both sources. */
  busiestDay: DailyPeak | null;
  /** Days between the oldest event and now, for "one every N minutes". */
  coverageDays: number;
  gpsPercent: number;
  updatedPercent: number;
  uniqueLocations: number;
  uniqueTypes: number;
  /** Oldest event in the dataset, live feed and archive together. */
  oldestEvent: string | null;
  /** Imported events the app counts: those older than the live feed reaches. */
  archiveEvents: number;
  /** Where the archive hands over to the live feed. Null when nothing is imported. */
  archiveCutoff: string | null;
}

/**
 * The kind of thing an incident is, one level up from its type.
 *
 * Colour used to be assigned per type, which produced two dozen shades for
 * sixty-odd types: several of them a few percent apart and none of them
 * separable on a map at country zoom. It is assigned per family now. That is
 * also what makes the map legend truthful, since a legend keyed on colour can
 * only name what colour actually distinguishes.
 */
export interface TypeFamily {
  /** What the legend calls it. */
  label: string;
  /** Marker colour on the map, and the legend's key. */
  color: string;
}

export const TYPE_FAMILIES = {
  death: { label: 'Dödsfall och grovt våld', color: '#991b1b' },
  sexual: { label: 'Sexualbrott och frihetsbrott', color: '#9f1239' },
  weapons: { label: 'Vapen och sprängning', color: '#b91c1c' },
  violence: { label: 'Våld och hot', color: '#f43f5e' },
  harassment: { label: 'Ofredande och intrång', color: '#ec4899' },
  fire: { label: 'Brand', color: '#ef4444' },
  robbery: { label: 'Rån', color: '#f59e0b' },
  theft: { label: 'Stöld och inbrott', color: '#c2410c' },
  damage: { label: 'Skadegörelse', color: '#a16207' },
  traffic: { label: 'Trafik', color: '#3b82f6' },
  intoxication: { label: 'Rattfylleri och fylleri', color: '#0891b2' },
  drugs: { label: 'Narkotika', color: '#10b981' },
  fraud: { label: 'Bedrägeri och ekobrott', color: '#8b5cf6' },
  environment: { label: 'Miljö och djur', color: '#65a30d' },
  rescue: { label: 'Räddning och hälsa', color: '#14b8a6' },
  police: { label: 'Polisinsats', color: '#6366f1' },
  other: { label: 'Övrigt och sammanfattningar', color: '#64748b' },
  unknown: { label: 'Okänd typ', color: '#94a3b8' },
} as const satisfies Record<string, TypeFamily>;

export type TypeFamilyKey = keyof typeof TYPE_FAMILIES;

// Type style mapping
export interface TypeStyle {
  /**
   * Shown immediately before the type's name, never on its own. A line-art
   * glyph sat here before, in a column of its own with the name elsewhere:
   * which asked the reader to decode a small abstract drawing. An emoji beside
   * its own word asks nothing.
   */
  emoji: string;
  /** Which family it belongs to, and so which colour it takes. */
  family: TypeFamilyKey;
  /** The family's colour. Derived, never written by hand. */
  color: string;
}

// The emoji is the fastest thing on a row: a reader scans the column of glyphs
// long before they read a word. So the table below covers polisen.se's
// published vocabulary outright rather than a dozen headline categories. It
// used to hold fourteen entries against a feed that emits something over sixty
// type strings, which meant most rows fell through to the 📍 pin and the column
// carried no information at all.
//
// Two rules on the glyphs themselves:
//
// Legible at 13px, and distinct within a colour family.
//
// No cartoon faces on crimes against people. A bandaged smiley standing in for
// an assault reads as a joke at the expense of whoever it happened to, so the
// person-crimes use the act or the object instead: a fist for assault, a
// prohibition sign for sexual offences, a candle for a death. Role pictograms
// (an officer, an older person) stay, because they name who the notice is
// about rather than mugging about what happened to them.
//
// Colour groups by family rather than by individual type: reds for violence and
// weapons, oranges and yellows for theft, blues for traffic, teal for rescue and
// health, and a neutral grey for the summary posts, which are not incidents at
// all. Sixty visually separable hues do not exist, and the map legend prints the
// emoji and the type's name beside every dot, so the hue answers "what kind of
// thing is this" and the pair beside it answers "which one".
const TYPE_FAMILY_BY_NAME: Record<string, { emoji: string; family: TypeFamilyKey }> = {
  // ── Death and grave violence ──────────────────────────────
  'Mord/dråp': { emoji: '⚰️', family: 'death' },
  'Mord/dråp, försök': { emoji: '⚰️', family: 'death' },
  'Anträffad död': { emoji: '🕯️', family: 'death' },
  'Våldtäkt': { emoji: '🚷', family: 'sexual' },
  'Våldtäkt, försök': { emoji: '🚷', family: 'sexual' },
  'Sedlighetsbrott': { emoji: '🚷', family: 'sexual' },
  'Olaga frihetsberövande': { emoji: '⛓️', family: 'sexual' },
  'Människorov': { emoji: '⛓️', family: 'sexual' },
  'Människohandel': { emoji: '⛓️', family: 'sexual' },
  'Misshandel, grov': { emoji: '👊', family: 'violence' },
  'Misshandel': { emoji: '👊', family: 'violence' },
  'Bråk': { emoji: '🗣️', family: 'violence' },

  // ── Weapons, explosives, alarms ───────────────────────────
  'Skottlossning': { emoji: '🔫', family: 'weapons' },
  'Skottlossning, misstänkt': { emoji: '🔫', family: 'weapons' },
  'Vapenlagen': { emoji: '🗡️', family: 'weapons' },
  'Knivlagen': { emoji: '🔪', family: 'weapons' },
  'Bombhot': { emoji: '💣', family: 'weapons' },
  'Detonation': { emoji: '💥', family: 'weapons' },
  'Explosion': { emoji: '💥', family: 'weapons' },
  'Farligt föremål, misstänkt': { emoji: '🧨', family: 'weapons' },
  'Larm Överfall': { emoji: '🆘', family: 'violence' },
  'Larm Inbrott': { emoji: '🔔', family: 'theft' },

  // ── Threats and harassment ────────────────────────────────
  // Solid, and pictorial rather than punctuation. ❗ is a bare exclamation mark
  // that named no more than "something"; 🗯️ reads as a threat but draws as a
  // white outline that all but disappears beside the saturated glyphs above and
  // below it in the icon column. 💢 carries weight at 14px.
  'Olaga hot': { emoji: '💢', family: 'violence' },
  'Våld/hot mot tjänsteman': { emoji: '👮', family: 'violence' },
  'Ofredande/förargelse': { emoji: '💬', family: 'harassment' },
  'Ofredande': { emoji: '💬', family: 'harassment' },
  'Ofog barn/ungdom': { emoji: '🎒', family: 'harassment' },
  'Olaga intrång/hemfridsbrott': { emoji: '🏠', family: 'harassment' },
  'Olaga diskriminering': { emoji: '⛔', family: 'harassment' },
  'Åldringsbrott': { emoji: '🧓', family: 'harassment' },

  // ── Fire ──────────────────────────────────────────────────
  // Arson is not a fire, it is a violent crime, and it takes the weapons red
  // rather than sitting next to a chimney fire in the same orange.
  'Mordbrand': { emoji: '🔥', family: 'weapons' },
  'Brand': { emoji: '🔥', family: 'fire' },
  'Brand automatlarm': { emoji: '🚨', family: 'fire' },

  // ── Theft, robbery, damage ────────────────────────────────
  'Rån': { emoji: '💰', family: 'robbery' },
  'Rån väpnat': { emoji: '💰', family: 'robbery' },
  'Rån, försök': { emoji: '💰', family: 'robbery' },
  'Rån övrigt': { emoji: '💰', family: 'robbery' },
  'Inbrott': { emoji: '🪟', family: 'theft' },
  'Inbrott, försök': { emoji: '🪟', family: 'theft' },
  'Stöld/inbrott': { emoji: '🚪', family: 'theft' },
  'Stöld': { emoji: '👜', family: 'theft' },
  'Stöld, försök': { emoji: '👜', family: 'theft' },
  'Stöld, ringa': { emoji: '🏷️', family: 'theft' },
  'Snatteri': { emoji: '🏷️', family: 'theft' },
  'Motorfordon, stöld': { emoji: '🔑', family: 'theft' },
  'Motorfordon, anträffat stulet': { emoji: '🔑', family: 'theft' },
  'Häleri': { emoji: '📦', family: 'theft' },
  'Anträffat gods': { emoji: '📦', family: 'theft' },
  'Skadegörelse': { emoji: '🔨', family: 'damage' },

  // ── Traffic ───────────────────────────────────────────────
  'Trafikolycka': { emoji: '🚗', family: 'traffic' },
  'Trafikolycka, personskada': { emoji: '🚗', family: 'traffic' },
  'Trafikolycka, singel': { emoji: '🚗', family: 'traffic' },
  'Trafikolycka, smitning från': { emoji: '🚗', family: 'traffic' },
  'Trafikolycka, vilt': { emoji: '🦌', family: 'traffic' },
  'Trafikbrott': { emoji: '🚦', family: 'traffic' },
  'Olovlig körning': { emoji: '🚫', family: 'traffic' },
  'Trafikhinder': { emoji: '🚧', family: 'traffic' },
  'Varningslarm/haveri': { emoji: '⚠️', family: 'traffic' },
  'Trafikkontroll': { emoji: '🛑', family: 'traffic' },
  'Kontroll person/fordon': { emoji: '🔍', family: 'traffic' },
  'Gränskontroll': { emoji: '🛂', family: 'traffic' },

  // ── Intoxication and drugs ────────────────────────────────
  'Rattfylleri': { emoji: '🍺', family: 'intoxication' },
  'Fylleri/LOB': { emoji: '🍺', family: 'intoxication' },
  'Alkohollagen': { emoji: '🍷', family: 'intoxication' },
  'Narkotikabrott': { emoji: '💊', family: 'drugs' },

  // ── Money, documents, environment ─────────────────────────
  'Bedrägeri': { emoji: '💳', family: 'fraud' },
  'Ekobrott': { emoji: '📊', family: 'fraud' },
  'Förfalskningsbrott': { emoji: '📝', family: 'fraud' },
  'Missbruk av urkund': { emoji: '📝', family: 'fraud' },
  'Penningtvätt': { emoji: '🏦', family: 'fraud' },
  'Bidragsbrott': { emoji: '🏦', family: 'fraud' },
  'Miljöbrott': { emoji: '🌿', family: 'environment' },
  'Djur': { emoji: '🐾', family: 'environment' },
  'Djur skadat/omhändertaget': { emoji: '🐾', family: 'environment' },

  // ── Rescue, health, missing people ────────────────────────
  'Sjukdom/olycksfall': { emoji: '🚑', family: 'rescue' },
  'Arbetsplatsolycka': { emoji: '🦺', family: 'rescue' },
  'Räddningsinsats': { emoji: '🚒', family: 'rescue' },
  'Fjällräddning': { emoji: '🏔️', family: 'rescue' },
  'Sjölagen': { emoji: '⚓️', family: 'rescue' },
  'Naturkatastrof': { emoji: '🌪️', family: 'rescue' },
  'Försvunnen person': { emoji: '🔦', family: 'rescue' },

  // ── Police operations and housekeeping ────────────────────
  'Polisinsats/kommendering': { emoji: '🚓', family: 'police' },
  'Ordningslagen': { emoji: '📢', family: 'police' },
  'Sammanfattning': { emoji: '📋', family: 'other' },
  'Uppdatering': { emoji: '🔄', family: 'other' },
  'Övrigt': { emoji: '📄', family: 'other' },

  'default': { emoji: '📍', family: 'unknown' },
};

/**
 * The table above with each family's colour filled in, which is the shape the
 * feed, the map and the statistics all read.
 */
export const TYPE_STYLES: Record<string, TypeStyle> = Object.fromEntries(
  Object.entries(TYPE_FAMILY_BY_NAME).map(([name, { emoji, family }]) => [
    name,
    { emoji, family, color: TYPE_FAMILIES[family].color },
  ])
);

/** Lowercased, single-spaced: the shape both lookups below compare on. */
function normaliseTypeName(type: string): string {
  return type.toLowerCase().replace(/\s+/g, ' ').trim();
}

const STYLES_BY_NAME = new Map<string, TypeStyle>(
  Object.entries(TYPE_STYLES).map(([name, style]) => [normaliseTypeName(name), style])
);

// Last resort before the pin: the words a type is built from.
//
// Two things make this less obvious than it looks. Swedish glues compounds into
// a single word, so "mordbrand" and "villainbrott" have no word boundary to
// anchor on and every \b-based pattern missed them; and the compound is
// head-final, so the LAST element is what the thing actually is. A mordbrand is
// a brand, not a mord. So an unknown word is matched on its ending, longest
// stem first, and the words of a phrase are read right to left.
//
// A stem is only reached when the table above has no entry for the type, so
// "Mordbrand" still gets its own colour rather than the plain fire orange.
const STEM_STYLES: Array<[string, TypeStyle]> = [
  ['sammanfattning', TYPE_STYLES['Sammanfattning']],
  ['uppdatering', TYPE_STYLES['Uppdatering']],
  ['mordbrand', TYPE_STYLES['Mordbrand']],
  ['mord', TYPE_STYLES['Mord/dråp']],
  ['dråp', TYPE_STYLES['Mord/dråp']],
  ['våldtäkt', TYPE_STYLES['Våldtäkt']],
  ['sexualbrott', TYPE_STYLES['Våldtäkt']],
  ['sedlighetsbrott', TYPE_STYLES['Sedlighetsbrott']],
  ['skottlossning', TYPE_STYLES['Skottlossning']],
  ['explosion', TYPE_STYLES['Explosion']],
  ['detonation', TYPE_STYLES['Detonation']],
  ['sprängning', TYPE_STYLES['Detonation']],
  ['bombhot', TYPE_STYLES['Bombhot']],
  ['vapenlagen', TYPE_STYLES['Vapenlagen']],
  ['knivlagen', TYPE_STYLES['Knivlagen']],
  ['misshandel', TYPE_STYLES['Misshandel']],
  ['hot', TYPE_STYLES['Olaga hot']],
  ['ofredande', TYPE_STYLES['Ofredande/förargelse']],
  ['förargelse', TYPE_STYLES['Ofredande/förargelse']],
  ['hemfridsbrott', TYPE_STYLES['Olaga intrång/hemfridsbrott']],
  ['åldringsbrott', TYPE_STYLES['Åldringsbrott']],
  ['bråk', TYPE_STYLES['Bråk']],
  ['brand', TYPE_STYLES['Brand']],
  ['rån', TYPE_STYLES['Rån']],
  ['inbrott', TYPE_STYLES['Inbrott']],
  ['stöld', TYPE_STYLES['Stöld']],
  ['stulet', TYPE_STYLES['Stöld']],
  ['stulen', TYPE_STYLES['Stöld']],
  ['snatteri', TYPE_STYLES['Snatteri']],
  ['häleri', TYPE_STYLES['Häleri']],
  ['skadegörelse', TYPE_STYLES['Skadegörelse']],
  ['klotter', TYPE_STYLES['Skadegörelse']],
  ['trafikolycka', TYPE_STYLES['Trafikolycka']],
  ['trafikkontroll', TYPE_STYLES['Trafikkontroll']],
  ['trafikhinder', TYPE_STYLES['Trafikhinder']],
  ['trafikbrott', TYPE_STYLES['Trafikbrott']],
  ['rattfylleri', TYPE_STYLES['Rattfylleri']],
  ['fylleri', TYPE_STYLES['Fylleri/LOB']],
  ['alkohollagen', TYPE_STYLES['Alkohollagen']],
  ['narkotikabrott', TYPE_STYLES['Narkotikabrott']],
  ['bedrägeri', TYPE_STYLES['Bedrägeri']],
  ['ekobrott', TYPE_STYLES['Ekobrott']],
  ['miljöbrott', TYPE_STYLES['Miljöbrott']],
  ['räddning', TYPE_STYLES['Räddningsinsats']],
  ['olycksfall', TYPE_STYLES['Sjukdom/olycksfall']],
  ['olycka', TYPE_STYLES['Sjukdom/olycksfall']],
  ['försvunnen', TYPE_STYLES['Försvunnen person']],
  ['gränskontroll', TYPE_STYLES['Gränskontroll']],
  ['kontroll', TYPE_STYLES['Kontroll person/fordon']],
  ['polisinsats', TYPE_STYLES['Polisinsats/kommendering']],
  ['kommendering', TYPE_STYLES['Polisinsats/kommendering']],
  ['ordningslagen', TYPE_STYLES['Ordningslagen']],
  ['sjölagen', TYPE_STYLES['Sjölagen']],
  ['överfall', TYPE_STYLES['Larm Överfall']],
  ['larm', TYPE_STYLES['Larm Inbrott']],
  ['djur', TYPE_STYLES['Djur']],
  ['övrigt', TYPE_STYLES['Övrigt']],
];

const STEMS_BY_NAME = new Map(STEM_STYLES);

/** Longest first, so "trafikolycka" is tried before "olycka". */
const STEMS_BY_LENGTH = [...STEM_STYLES].sort((a, b) => b[0].length - a[0].length);

/** The words of a type, ignoring the punctuation between them. */
function typeWords(name: string): string[] {
  return name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

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
  // whichever key happened to be declared first, with "Brand automatlarm"
  // present, every plain "Brand" resolved to the automatic-alarm style.
  const cuts: number[] = [];
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ',' || name[i] === '/') cuts.push(i);
  }
  for (let i = cuts.length - 1; i >= 0; i--) {
    const stem = STYLES_BY_NAME.get(name.slice(0, cuts[i]).trim());
    if (stem) return stem;
  }

  // Right to left, because the head of a Swedish phrase or compound sits at
  // the end: "grov misshandel" is a misshandel, "villainbrott" an inbrott.
  const words = typeWords(name);
  for (let i = words.length - 1; i >= 0; i--) {
    const whole = STEMS_BY_NAME.get(words[i]);
    if (whole) return whole;
  }
  for (let i = words.length - 1; i >= 0; i--) {
    for (const [stem, style] of STEMS_BY_LENGTH) {
      if (words[i].length > stem.length && words[i].endsWith(stem)) return style;
    }
  }

  return TYPE_STYLES['default'];
}

/**
 * A VMA: viktigt meddelande till allmänheten, from Sveriges Radio's API.
 *
 * Field names follow CAP, the Common Alerting Protocol the API speaks, so they
 * can be checked against the specification rather than against our guesses.
 */
export type VmaSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface VmaAlert {
  /** The CAP identifier of this message (SRCAP-...). Unique per message. */
  id: string;
  /**
   * The announcement identifiers this message belongs to (SRVMA-...). Every
   * message about one announcement shares these, which is how an Alert is tied
   * to the Cancel that ends it.
   */
  incidents: string[];
  /** When the message was issued. */
  sent: string;
  /** 'Actual' for a real one. SR sends 'Test' and 'Exercise' over the same feed. */
  status: string;
  /** 'Alert', 'Update' or 'Cancel'. Every announcement gets at least the two. */
  msgType: string;
  /** 'Public', 'Restricted' or 'Private'. Only Public is shown. */
  scope: string;
  /** The kind of emergency, in a word or two. */
  event: string;
  headline: string;
  description: string;
  /** What the public is being told to do. Often the most important field. */
  instruction: string;
  severity: VmaSeverity;
  urgency: string;
  certainty: string;
  senderName: string;
  /** The places it covers, as the sender described them. */
  areas: string[];
  web: string;
  expires: string | null;
}

// Operational monitoring types

/** One hour of the last 24, split by outcome so a failure is visible. */
export interface HourlyFetches {
  ok: number;
  failed: number;
}

export interface FetchError {
  fetchedAt: string;
  /** Coarse bucket, for scanning a column of them. */
  errorType: string;
  /** What the upstream actually said. The page is behind a login. */
  message: string | null;
}

export interface OperationalStats {
  totalFetches: number;
  successfulFetches: number;
  failedFetches: number;
  fetches24h: number;
  successfulFetches24h: number;
  failedFetches24h: number;
  fetches7d: number;
  /** Over the whole log. Barely moves once a container has been up a while. */
  successRate: number;
  /** Over 24 hours, which is the one that reacts to an outage in progress. */
  successRate24h: number;
  avgFetchInterval: number;
  lastSuccessfulFetch: string | null;
  lastFailedFetch: string | null;
  /** Minutes since the last fetch that worked. Null if none ever has. */
  minutesSinceLastSuccess: number | null;
  recentErrors: FetchError[];
  hourlyFetches: HourlyFetches[];
  avgEventsPerFetch: number;
  eventsAddedToday: number;
  /** Successful fetches in 24h against the 144 a 10-minute schedule expects. */
  uptimeScore: number;
}

export interface FetchLogEntry {
  id: number;
  fetchedAt: string;
  eventsFetched: number;
  eventsNew: number;
  success: boolean;
  errorType: string | null;
  errorMessage: string | null;
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
  /** Age of the newest stored event. A quiet night raises it legitimately. */
  dataFreshnessMinutes: number;
  updatedEvents: number;
  updatedEventsPercent: number;
}

/**
 * What the container is, as opposed to what it has fetched.
 *
 * Every field here answers a question that used to need a shell on the host:
 * where the database actually is, how big it has grown, whether TZ survived
 * the deploy, and whether the search index matches the setting it was built
 * from.
 */
export interface SystemSnapshot {
  dataDir: string;
  databaseBytes: number;
  /** The -wal sidecar. A large one means a checkpoint is overdue. */
  walBytes: number;
  timeZone: string;
  /** The app parses Swedish wall-clock times; anything else shifts them. */
  timeZoneCorrect: boolean;
  nodeVersion: string;
  processUptimeSeconds: number;
  searchTokenizer: {
    configured: string;
    built: string | null;
    /** False while a rebuild is still pending after the setting changed. */
    matches: boolean;
  };
  archive: {
    /** Rows the app actually serves: those below the cutoff. */
    events: number;
    /** Rows in the table. Far above `events` means most of the import is hidden. */
    stored: number;
    cutoff: string | null;
    /** The archive's own span, which is not the same as what is shown. */
    oldest: string | null;
    newest: string | null;
    /**
     * Oldest live event. The cutoff is this, so a single stale row here drags
     * the boundary back years and hides everything above it.
     */
    liveOldest: string | null;
  };
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
