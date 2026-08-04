import { RawEvent } from '@/types';
import { insertEvents, logFetch, getLastFetchTime, countEventsInDb, getDailyFetchCount, invalidateAggregateCaches } from './db';
import { isRetryableStatus, retryDelayMs, sleep } from './retry';
import { logger } from './log';

const log = logger('police');

const POLICE_API_URL = 'https://polisen.se/api/events';
const POLICE_API_TIMEOUT = 30000;
const USER_AGENT = 'Tiny Tiny RSS/25.05-6abd7fdc (https://tt-rss.org/)';
const CACHE_TIME = 600; // 10 minutes in seconds (minimum interval between fetches)
// Ceiling on upstream calls per rolling 24 hours, so a revalidation loop can
// never turn into a scrape. Exported because /stats shows how much of it a
// normal day actually uses: on the 10-minute schedule, 144 of 1440.
export const MAX_DAILY_FETCHES = 1440;
const MAX_FETCH_RETRIES = 3;
const BACKFILL_THRESHOLD = 200; // If DB has fewer events than this, do initial backfill
const BACKFILL_TARGET = 500; // Target number of events for backfill
const BACKFILL_DAYS = 7; // How many days back to fetch during backfill
const BACKFILL_DELAY_MS = 300; // Delay between API calls during backfill to respect rate limits

// Enforce HTTPS: upgrade any http:// URL to https://
function enforceHttps(url: string): string {
  if (url.startsWith('http://')) {
    return url.replace('http://', 'https://');
  }
  return url;
}

async function fetchWithRetry(url: string, retries = MAX_FETCH_RETRIES): Promise<RawEvent[]> {
  const secureUrl = enforceHttps(url);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POLICE_API_TIMEOUT);
    // How long to wait before trying again, decided while the response (and its
    // Retry-After header) is still in hand.
    let delayMs: number | null = null;

    try {
      const response = await fetch(secureUrl, {
        headers: {
          'User-Agent': USER_AGENT,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = new Error(`HTTP error ${response.status}`);
        if (isRetryableStatus(response.status)) {
          // The server said "not now". It gets to say how long: this used to
          // retry a 429 after a flat 200ms, which is the opposite of what a
          // rate-limited server is asking for.
          delayMs = retryDelayMs(attempt, response.headers.get('retry-after'), { jitter: true });
        } else {
          // Every other 4xx will answer the same way next time.
          (err as Error & { retryable?: boolean }).retryable = false;
        }
        throw err;
      }

      // Inside the try, so the abort above is still armed while the body is
      // read. clearTimeout used to run the moment the headers arrived, which
      // left this parse with no timeout at all: a server that sent headers and
      // then stalled the stream hung here until the socket died.
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('Invalid JSON response');
      }

      return data as RawEvent[];
    } catch (error) {
      lastError = error as Error;
      if ((error as Error & { retryable?: boolean }).retryable === false) {
        break;
      }
      if (attempt < retries - 1) {
        // A transport failure carries no Retry-After, so it backs off on the
        // exponential schedule.
        await sleep(delayMs ?? retryDelayMs(attempt, null, { jitter: true }));
      }
    } finally {
      // Always, including on the paths that used to skip it and leave a live
      // 30-second timer pointed at a controller nobody was listening to.
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('Failed to fetch after retries');
}

export interface RefreshResult {
  fetched: number;
  new: number;
  updated: number;
  success: boolean;
  error: string | null;
}

// Fetch events for multiple days to backfill the database on initial load.
// The polisen.se API contains ~500 events, but the default endpoint may only
// return currently active ones. DateTime filtering can access the full dataset.
async function fetchEventsWithBackfill(): Promise<RawEvent[]> {
  const allEvents = new Map<number, RawEvent>();

  // First fetch without params (returns all currently active events)
  try {
    const currentEvents = await fetchWithRetry(POLICE_API_URL);
    for (const event of currentEvents) {
      allEvents.set(event.id, event);
    }
  } catch {
    // Continue with date-based fetching
  }

  // If we have fewer than target, fetch by date for the past N days
  if (allEvents.size < BACKFILL_TARGET) {
    const today = new Date();

    for (let i = 0; i < BACKFILL_DAYS && allEvents.size < BACKFILL_TARGET; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

      try {
        await new Promise(resolve => setTimeout(resolve, BACKFILL_DELAY_MS));
        const dayEvents = await fetchWithRetry(`${POLICE_API_URL}?DateTime=${dateStr}`);
        for (const event of dayEvents) {
          allEvents.set(event.id, event);
        }
      } catch {
        // Continue with next date
      }
    }
  }

  return Array.from(allEvents.values());
}

const SKIPPED: RefreshResult = { fetched: 0, new: 0, updated: 0, success: true, error: null };

/**
 * The refresh currently in flight, shared by every caller that asks for one.
 *
 * refreshEventsIfNeeded is awaited at the top of every home-page render and
 * every /api/events request, as well as on a ten-minute timer. Its only guard
 * was `getLastFetchTime()`, read from the database, and the row that moves that
 * timestamp is written *after* the fetch completes. So for the whole duration of
 * a fetch, every concurrent caller read the same stale timestamp, decided a
 * refresh was due, and started its own.
 *
 * On a warm database that meant up to 90 seconds (a 30s timeout, three
 * attempts) during which every arriving request duplicated the work. On a cold
 * one it was far worse: below BACKFILL_THRESHOLD events, each of those callers
 * ran fetchEventsWithBackfill, which is eight sequential requests with sleeps
 * between them. A single container could put a thundering herd on polisen.se
 * purely by being popular at the wrong moment, and each duplicate also wrote its
 * own fetch_log row, which is what the dashboard computes the fetch interval
 * and the daily count from.
 *
 * One promise, awaited by everyone. Callers block for exactly as long as they
 * did before; they just no longer each pay for it.
 */
let inFlight: Promise<RefreshResult> | null = null;

export function refreshEventsIfNeeded(): Promise<RefreshResult> {
  // Someone is already doing this. Their answer is the answer.
  if (inFlight) return inFlight;

  const lastFetch = getLastFetchTime();
  const shouldFetch = !lastFetch || (Date.now() - lastFetch.getTime()) > CACHE_TIME * 1000;

  if (!shouldFetch) {
    return Promise.resolve(SKIPPED);
  }

  // Check daily fetch limit (max 1440 calls per 24h)
  const dailyFetchCount = getDailyFetchCount();
  if (dailyFetchCount >= MAX_DAILY_FETCHES) {
    log.warn('daily fetch limit reached, skipping', {
      used: dailyFetchCount,
      limit: MAX_DAILY_FETCHES,
    });
    return Promise.resolve(SKIPPED);
  }

  const run = performRefresh().finally(() => {
    // Cleared before the promise this returns settles, so the next caller
    // after a completed refresh starts a fresh one rather than joining a dead
    // handle.
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
  return run;
}

async function performRefresh(): Promise<RefreshResult> {
  // Check if we need initial backfill (database has few events)
  const dbEventCount = countEventsInDb();
  const needsBackfill = dbEventCount < BACKFILL_THRESHOLD;

  let eventsFetched = 0;

  try {
    const events = needsBackfill
      ? await fetchEventsWithBackfill()
      : await fetchWithRetry(POLICE_API_URL);

    eventsFetched = events.length;

    // One transaction for the whole page of events, against statements compiled
    // once. This was a bare loop calling insertEvent per event, which compiled
    // two statements and committed a transaction for every one of them.
    const counts = insertEvents(events);

    logFetch(eventsFetched, counts.new, true);
    // Stats and filter options are cached; drop them so the data that just
    // landed shows up on the next request instead of after the TTL.
    if (counts.new > 0 || counts.updated > 0) {
      invalidateAggregateCaches();
    }
    return { fetched: eventsFetched, new: counts.new, updated: counts.updated, success: true, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // Nothing was written: insertEvents is all-or-nothing, and a throw before it
    // never reached the database. Reporting a partial count here would put
    // numbers in the fetch log for rows that do not exist.
    logFetch(eventsFetched, 0, false, errorMessage);
    return { fetched: eventsFetched, new: 0, updated: 0, success: false, error: errorMessage };
  }
}

// Map of HTML named entities to their character equivalents
// Includes Swedish characters and common entities
const HTML_ENTITIES: Record<string, string> = {
  // Swedish characters
  'aring': 'å', 'Aring': 'Å',
  'auml': 'ä', 'Auml': 'Ä',
  'ouml': 'ö', 'Ouml': 'Ö',
  // Common entities
  'nbsp': ' ', 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', 'apos': "'",
  'copy': '©', 'reg': '®', 'trade': '™', 'euro': '€', 'pound': '£', 'yen': '¥',
  'cent': '¢', 'deg': '°', 'plusmn': '±', 'times': '×', 'divide': '÷',
  'frac12': '½', 'frac14': '¼', 'frac34': '¾',
  // Decoding, not authoring: whatever polisen.se wrote is what the notice
  // said, so &mdash; stays an em dash here.
  'hellip': '…', 'mdash': '—', 'ndash': '–', 'lsquo': "'", 'rsquo': "'",
  'ldquo': '"', 'rdquo': '"', 'bull': '•', 'middot': '·',
  // Other Nordic/European characters
  'eacute': 'é', 'Eacute': 'É', 'egrave': 'è', 'Egrave': 'È',
  'aacute': 'á', 'Aacute': 'Á', 'agrave': 'à', 'Agrave': 'À',
  'oacute': 'ó', 'Oacute': 'Ó', 'ograve': 'ò', 'Ograve': 'Ò',
  'uacute': 'ú', 'Uacute': 'Ú', 'ugrave': 'ù', 'Ugrave': 'Ù',
  'iacute': 'í', 'Iacute': 'Í', 'igrave': 'ì', 'Igrave': 'Ì',
  'ntilde': 'ñ', 'Ntilde': 'Ñ', 'ccedil': 'ç', 'Ccedil': 'Ç',
  'uuml': 'ü', 'Uuml': 'Ü', 'oslash': 'ø', 'Oslash': 'Ø',
  'aelig': 'æ', 'AElig': 'Æ', 'szlig': 'ß',
};

// Decode all HTML entities (named and numeric)
export function decodeHtmlEntities(text: string): string {
  // First decode named entities
  let decoded = text.replace(/&([a-zA-Z]+);/g, (match, entity) => {
    return HTML_ENTITIES[entity] || match;
  });

  // Decode numeric entities (&#xNN; hex and &#NNN; decimal).
  // Use fromCodePoint (not fromCharCode) so characters above U+FFFF: e.g.
  // emoji: decode correctly instead of being truncated to 16 bits.
  const fromCode = (match: string, code: number): string =>
    code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (m, hex) => fromCode(m, parseInt(hex, 16)));
  decoded = decoded.replace(/&#(\d+);/g, (m, dec) => fromCode(m, parseInt(dec, 10)));

  return decoded;
}

// Fetch event details from polisen.se
// Readable text out of a fragment of HTML: the paragraphs, tags stripped and
// entities decoded. Returns null when the fragment has no paragraph markup:
// on a scraped page that means the layout was not what we expected, and a
// caller with plain text of its own can fall back to it.
//
// Shared by the polisen.se scrape below and by imported brottsplatskartan
// events, which store their body as the same `<p>` markup.
const MAX_DETAIL_PARAGRAPHS = 60;

export function paragraphsToText(html: string): string | null {
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;

  while ((match = pRegex.exec(html)) !== null) {
    const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '')).trim();
    if (text) paragraphs.push(text);
  }

  // Null, not an empty string: callers treat that as "nothing to show".
  if (paragraphs.length === 0) return null;

  // The whole notice, not the opening of it. This was capped at four
  // paragraphs, which quietly cut every longer notice off mid-account with no
  // sign anything was missing. The summary posts, which are the longest
  // things in the archive, lost most of their body that way.
  //
  // The remaining cap only exists so a page whose layout we misread cannot
  // hand back a document's worth of text; no real notice comes close to it.
  return paragraphs.slice(0, MAX_DETAIL_PARAGRAPHS).join('\n\n');
}

export async function fetchDetailsText(url: string): Promise<string | null> {
  // Validate and construct URL safely using URL constructor
  let absoluteUrl: string;
  try {
    // If url is relative, resolve against polisen.se base
    const baseUrl = 'https://polisen.se';
    const parsedUrl = new URL(url, baseUrl);

    // Security: Only allow https protocol and polisen.se hostname
    if (parsedUrl.protocol !== 'https:') {
      log.warn('refused a detail URL with a non-https scheme', { protocol: parsedUrl.protocol });
      return null;
    }
    if (parsedUrl.hostname !== 'polisen.se' && !parsedUrl.hostname.endsWith('.polisen.se')) {
      log.warn('refused a detail URL off polisen.se', { host: parsedUrl.hostname });
      return null;
    }

    absoluteUrl = parsedUrl.href;
  } catch {
    log.warn('refused an unparseable detail URL', { url });
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POLICE_API_TIMEOUT);

  try {
    const response = await fetch(enforceHttps(absoluteUrl), {
      headers: {
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    // Read inside the try, with the abort still armed. clearTimeout used to run
    // as soon as the headers arrived, so this read had no timeout: a page that
    // sent headers and then stalled held the request open until the socket
    // died, and this is called once per card a reader expands.
    const html = await response.text();

    // Simple HTML parsing to extract article content
    // Look for content within <article> or <main> tags and extract paragraphs
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

    const content = articleMatch?.[1] || mainMatch?.[1] || '';

    return paragraphsToText(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
