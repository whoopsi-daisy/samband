/**
 * The query string, in Swedish.
 *
 * The URL is part of the interface. People read it in the address bar, and
 * every shared link carries it into a chat or an email, so `?view=map&type=Rån`
 * had half the app speaking English to a Swedish audience. It reads
 * `?vy=karta&typ=Rån` now.
 *
 * Links shared before the rename still work: reads accept the old names, and
 * anything the app writes is rewritten into the new ones, so an old link
 * upgrades itself the first time the reader touches a filter.
 */
export const QUERY = {
  view: 'vy',
  county: 'lan',
  location: 'plats',
  type: 'typ',
  search: 'sok',
  event: 'handelse',
  /**
   * The two ends of a date range on the feed, as Swedish calendar days
   * ("2019-04-01").
   *
   * The archive reaches back to 2016 and the feed pages newest-first, so until
   * these existed the only way to reach a particular week was to guess a word
   * that appears in it — while the list itself told readers to "filtrera för
   * att nå längre bak i arkivet", pointing at a control that was not there.
   */
  from: 'fran',
  to: 'till',
  /**
   * How far back the map is looking, in days.
   *
   * This was deliberately kept out of the URL, on the reasoning that it is a
   * way of looking at the filters rather than part of what is being looked at.
   * That distinction is not one a reader makes: it survives neither a refresh
   * nor a shared link, so a map of the last month reverted to the last day
   * under someone who had just set it, and a link to what they were looking at
   * did not show what they were looking at.
   */
  mapDays: 'dagar',
  /** Which type of notice the county map on the statistics page is showing. */
  regionType: 'lantyp',
} as const;

export type QueryKey = keyof typeof QUERY;

/** What each parameter used to be called. */
const LEGACY_QUERY: Record<QueryKey, string> = {
  view: 'view',
  // New in the same release as the parameter itself, so there is no older
  // spelling to accept. Kept in the map so the shape stays exhaustive.
  county: 'lan',
  location: 'location',
  type: 'type',
  search: 'search',
  event: 'event',
  // New in the same release as the parameters themselves, so there is no older
  // spelling to accept. Kept in the map so the shape stays exhaustive.
  from: 'fran',
  to: 'till',
  // Both new in the same release as the parameters themselves, so there is no
  // older spelling to accept. Kept in the map so the shape stays exhaustive.
  mapDays: 'dagar',
  regionType: 'lantyp',
};

export type ViewId = 'list' | 'map' | 'vma' | 'stats';

const VIEW_SLUG: Record<ViewId, string> = {
  list: 'lista',
  map: 'karta',
  // Already an initialism in Swedish; there is nothing to translate.
  vma: 'vma',
  stats: 'statistik',
};

const VIEW_BY_SLUG: Record<string, ViewId> = {
  lista: 'list',
  karta: 'map',
  vma: 'vma',
  statistik: 'stats',
  // The English slugs stay readable, for links shared before the rename.
  list: 'list',
  map: 'map',
  stats: 'stats',
};

/** The slug a view is addressed by. */
export function viewSlug(view: ViewId): string {
  return VIEW_SLUG[view] ?? VIEW_SLUG.list;
}

/** A slug back to a view, falling back to the feed for anything unrecognised. */
export function parseView(value: string | null | undefined): ViewId {
  if (!value) return 'list';
  return VIEW_BY_SLUG[value.toLowerCase()] ?? 'list';
}

type Getter = (name: string) => string | null | undefined;

/** One parameter, preferring the Swedish name and accepting the old one. */
export function readParam(get: Getter, key: QueryKey): string {
  return get(QUERY[key]) || get(LEGACY_QUERY[key]) || '';
}

/**
 * The same query string with every old parameter name replaced by its Swedish
 * one, so the app never writes a URL that mixes the two.
 *
 * Mutates and returns the params it is given, which is how the callers use it.
 */
export function toSwedishParams(params: URLSearchParams): URLSearchParams {
  for (const key of Object.keys(QUERY) as QueryKey[]) {
    const legacy = LEGACY_QUERY[key];
    const value = params.get(legacy);
    if (value === null) continue;
    params.delete(legacy);
    // An explicit Swedish value wins; the old one was only a fallback.
    if (!params.get(QUERY[key])) {
      params.set(QUERY[key], key === 'view' ? viewSlug(parseView(value)) : value);
    }
  }
  return params;
}
