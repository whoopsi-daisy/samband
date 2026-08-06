/**
 * The periods the map offers.
 *
 * A month is the far end, deliberately. The database holds a decade, but a map
 * of a decade is a map of Sweden with a dot on every town: it answers nothing,
 * and every marker on it is a report filed years ago at a position that was
 * approximate when it was new. The long view belongs to the statistics page,
 * which is built for it. The map answers "what is going on around here", and
 * that question has a short horizon.
 *
 * These lived in EventMap.tsx, which meant three other places restated pieces
 * of them: the API route had its own MAX_WINDOW_DAYS = 30 with its own copy of
 * the reasoning, and anything that wanted the list had to import a component
 * that pulls in Leaflet and two stylesheets. A window added here is now offered
 * by the control, accepted in a URL, prefetched, and allowed by the endpoint,
 * with no second edit.
 */
export interface MapWindow {
  days: number;
  label: string;
  /**
   * The period as it reads inside a Swedish sentence, article included, so it
   * can be dropped into one rather than being a button label wedged into it.
   */
  phrase: string;
}

export const MAP_WINDOWS: readonly MapWindow[] = [
  { days: 1, label: 'Senaste dygnet', phrase: 'det senaste dygnet' },
  { days: 7, label: 'Senaste veckan', phrase: 'den senaste veckan' },
  { days: 30, label: 'Senaste månaden', phrase: 'den senaste månaden' },
];

/** The periods that are allowed in the URL, and the only ones prefetched. */
export const MAP_WINDOW_DAYS: number[] = MAP_WINDOWS.map((window) => window.days);

/** The default, and what an unparseable `?dagar=` falls back to. */
export const DEFAULT_MAP_WINDOW_DAYS = MAP_WINDOW_DAYS[0];

/**
 * The furthest back the endpoint will look, whatever a query string asks for.
 *
 * Derived rather than declared, so it cannot drift from the control above.
 */
export const MAX_MAP_WINDOW_DAYS = Math.max(...MAP_WINDOW_DAYS);

/** The window a number of days names, or the default if it names none. */
export function mapWindowFor(days: number): MapWindow {
  return MAP_WINDOWS.find((window) => window.days === days) ?? MAP_WINDOWS[0];
}
