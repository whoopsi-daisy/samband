import {
  countBpkEvents,
  insertBpkEvents,
  updateBpkImportState,
  getBpkImportState,
  getNewestStoredPubdateUnix,
  type BpkEventInput,
} from './brottsplatskartanDb';

// Importer for the public brottsplatskartan.se events API.
//
// Two modes:
//   full        - walk every page from the beginning (resumable)
//   incremental - walk from page 1 until we reach events already stored
//
// A note on completeness. The API paginates a live, newest-first feed, and new
// events are inserted at the head while a multi-hour import is running. Because
// this walks pages in ASCENDING order, that insertion pushes existing events
// toward LATER pages — away from the cursor — so an event can never slip behind
// it. Head growth therefore re-serves events (absorbed by INSERT OR IGNORE)
// rather than skipping them.
//
// What head growth does change is `last_page`: the oldest events get pushed
// onto page numbers past whatever the last page was when the run began. Fixing
// the bound at the start would silently drop them, and an incremental sync
// could never recover them — it stops at its watermark, and these are the
// oldest events in the archive. So the bound is re-read from every response
// and extended as the archive grows.

// Overridable so the importer can be pointed at a mock or a caching proxy.
// Defaults to the public API. Any trailing slash is stripped: the form that is
// known to work is `/api/events?...` with no slash before the query string.
const BASE_URL = (process.env.BPK_API_BASE_URL?.trim() || 'https://brottsplatskartan.se/api/events').replace(
  /\/+$/,
  ''
);
const APP_PARAM = 'samband';
const USER_AGENT = 'samband/1.0 (+https://github.com/whoopsi-daisy/samband) self-hosted event archive';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;

// Deliberately modest. This is a free API run by a small site; the prior
// investigation suggested 25 parallel workers, which is more load than a
// hobby archive has any business generating. Four in flight with a small
// pause between batches finishes a full import in a few hours rather than
// twelve, without hammering anyone.
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DELAY_BETWEEN_BATCHES_MS = 250;

// The default page size is 10, which would mean ~33k requests for a full
// import of the ~333k events. `limit=500` is confirmed working against the
// live API, bringing that down to ~670. Still probed rather than assumed —
// the code believes whatever the server actually returns.
const PREFERRED_PER_PAGE = 500;

export interface ImportOptions {
  mode?: 'full' | 'incremental';
  concurrency?: number;
  /** Stop after this many pages. Used by the probe and by tests. */
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  pagesDone: number;
  totalPages: number | null;
  imported: number;
  duplicates: number;
}

export interface ImportResult {
  mode: 'full' | 'incremental';
  pagesFetched: number;
  imported: number;
  duplicates: number;
  stoppedEarly: boolean;
  perPage: number;
  /** Events the API said exist, as of the last page fetched. */
  reportedTotal: number | null;
  /** Rows in bpk_events once the run finished. */
  storedTotal: number;
}

interface ApiLinks {
  current_page?: number;
  last_page?: number;
  per_page?: number;
  total?: number;
  next_page_url?: string | null;
}

interface ApiEvent {
  id?: number | string;
  pubdate_iso8601?: string;
  pubdate_unix?: number | string;
  /** Older records serialise their date here instead. */
  parsed_date?: string;
  administrative_area_level_1?: string | null;
  title_type?: string;
  title_location?: string;
  headline?: string;
  description?: string;
  content?: string;
  location_string?: string;
  lat?: number | string;
  lng?: number | string;
  external_source_link?: string;
  permalink?: string;
}

interface ApiPage {
  links?: ApiLinks;
  data?: ApiEvent[];
}

export class BrottsplatskartanError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'BrottsplatskartanError';
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });

// AbortError arrives as a DOMException, which is NOT an instance of Error in
// Node or the browser — an `instanceof Error` guard silently misses every
// cancellation and reports it as a failure instead.
function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// The app groups and filters by event type across both sources, and
// brottsplatskartan serves some of them with a doubled space
// ("Misshandel,  grov"). Left alone, that becomes a second type sitting next to
// polisen.se's "Misshandel, grov" in every breakdown and filter dropdown.
function toTypeText(value: unknown): string | null {
  const text = toText(value);
  return text === null ? null : text.replace(/\s+/g, ' ');
}

// Map an API event onto the row shape. Returns null for anything without a
// usable id or date rather than storing a half-record.
export function mapApiEvent(raw: ApiEvent): BpkEventInput | null {
  const id = toNumber(raw.id);
  if (id === null || !Number.isInteger(id) || id <= 0) return null;

  const pubdateUnix = toNumber(raw.pubdate_unix);
  const isoCandidate = toText(raw.pubdate_iso8601);

  // Normalise to UTC ISO, matching how every other timestamp in this database
  // is stored, so the columns sort chronologically as text.
  let pubdate: string | null = null;
  if (isoCandidate) {
    const parsed = new Date(isoCandidate);
    if (!isNaN(parsed.getTime())) pubdate = parsed.toISOString();
  }
  if (!pubdate && pubdateUnix !== null) {
    const parsed = new Date(pubdateUnix * 1000);
    if (!isNaN(parsed.getTime())) pubdate = parsed.toISOString();
  }
  if (!pubdate) {
    // Older events are serialised with `parsed_date` ("2016-10-14 21:27:00",
    // Swedish local time) rather than pubdate_iso8601. Treat the space as the
    // ISO separator so it parses, rather than dropping the record.
    const legacy = toText(raw.parsed_date);
    if (legacy) {
      const parsed = new Date(legacy.replace(' ', 'T'));
      if (!isNaN(parsed.getTime())) pubdate = parsed.toISOString();
    }
  }
  if (!pubdate) return null;

  return {
    id,
    pubdate,
    pubdateUnix: pubdateUnix ?? Math.floor(new Date(pubdate).getTime() / 1000),
    titleType: toTypeText(raw.title_type),
    // The app groups and filters by this, so it falls back to the fuller
    // location string rather than being left empty (see migration 3).
    titleLocation: toTypeText(raw.title_location) ?? toTypeText(raw.location_string),
    headline: toText(raw.headline),
    description: toText(raw.description),
    content: toText(raw.content),
    locationString: toText(raw.location_string),
    county: toText(raw.administrative_area_level_1),
    lat: toNumber(raw.lat),
    lng: toNumber(raw.lng),
    externalSourceLink: toText(raw.external_source_link),
    permalink: toText(raw.permalink),
  };
}

async function fetchPage(page: number, perPage: number, signal?: AbortSignal): Promise<ApiPage> {
  const url = new URL(BASE_URL);
  url.searchParams.set('app', APP_PARAM);
  url.searchParams.set('page', String(page));
  // The page-size parameter is `limit`. The response echoes it back as
  // `links.per_page`, which is what made `per_page` look like the request
  // parameter — sending that name is silently ignored and always yields 10.
  if (perPage > 0) url.searchParams.set('limit', String(perPage));

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        // Respect Retry-After when the server sends it, otherwise back off
        // exponentially. This is the branch that keeps us a good citizen.
        const retryAfter = toNumber(response.headers.get('retry-after'));
        const delay = retryAfter
          ? Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS)
          : Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
        lastError = new BrottsplatskartanError(`HTTP ${response.status} on page ${page}`, response.status);
        if (attempt < MAX_RETRIES - 1) {
          await sleep(delay, signal);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        // 4xx other than 429 will not succeed on retry.
        throw new BrottsplatskartanError(`HTTP ${response.status} on page ${page}`, response.status);
      }

      const payload = (await response.json()) as unknown;
      if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as ApiPage).data)) {
        throw new BrottsplatskartanError(`Unexpected response shape on page ${page}`);
      }
      return payload as ApiPage;
    } catch (error) {
      if (isAbortError(error) && signal?.aborted) throw error;
      lastError = error as Error;
      if (error instanceof BrottsplatskartanError && error.status && error.status < 500 && error.status !== 429) {
        throw error;
      }
      if (attempt < MAX_RETRIES - 1) {
        await sleep(Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS), signal);
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError ?? new BrottsplatskartanError(`Failed to fetch page ${page}`);
}

export interface ApiMetadata {
  totalEvents: number | null;
  totalPages: number | null;
  perPage: number;
}

// Ask for a large page and see what we actually get back. If the API caps the
// page size we simply learn the real number and plan around it.
export async function probeApi(signal?: AbortSignal): Promise<ApiMetadata> {
  const page = await fetchPage(1, PREFERRED_PER_PAGE, signal);
  const links = page.links ?? {};

  const reportedPerPage = toNumber(links.per_page);
  const actualPerPage = page.data?.length ?? 0;

  // Trust what arrived over what was advertised — they disagree if per_page
  // is silently clamped.
  const perPage = actualPerPage > 0 ? actualPerPage : reportedPerPage && reportedPerPage > 0 ? reportedPerPage : 10;

  const totalEvents = toNumber(links.total);
  const reportedPages = toNumber(links.last_page);
  const totalPages =
    totalEvents !== null ? Math.ceil(totalEvents / perPage) : reportedPages !== null ? reportedPages : null;

  return { totalEvents, totalPages, perPage };
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Import events from brottsplatskartan.se.
 *
 * Resumes from the recorded page for a full import, so an interrupted run
 * continues rather than restarting. Incremental runs walk from page 1 and stop
 * once a whole page contains nothing new.
 */
export async function importBrottsplatskartan(options: ImportOptions = {}): Promise<ImportResult> {
  const mode = options.mode ?? 'full';
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY));
  const { signal } = options;

  const metadata = await probeApi(signal);
  const watermark = mode === 'incremental' ? getNewestStoredPubdateUnix() : null;

  const existing = getBpkImportState();
  // Only a full import resumes; incremental always starts from the newest page.
  const resumeFrom = mode === 'full' && existing.status !== 'complete' ? existing.lastPageDone : 0;

  updateBpkImportState({
    status: 'running',
    mode,
    totalPages: metadata.totalPages,
    totalEvents: metadata.totalEvents,
    perPage: metadata.perPage,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
    ...(mode === 'full' ? {} : { lastPageDone: 0 }),
  });

  let imported = 0;
  let duplicates = 0;
  let pagesFetched = 0;
  let stoppedEarly = false;
  let highestPageDone = resumeFrom;

  // Re-read from every response so the run follows the archive as it grows.
  let lastPage = metadata.totalPages ?? 1;
  let reportedTotal = metadata.totalEvents;
  const hardLimit = options.maxPages ?? Number.POSITIVE_INFINITY;

  // Following a growing bound terminates only while the archive grows slower
  // than we consume it — true by a wide margin in practice (a few hundred new
  // events a day against thousands of pages an hour). This caps the chase
  // anyway, so a pathological feed ends the run instead of looping forever.
  // Hitting it marks the run incomplete, so re-running resumes.
  const pageCeiling = (metadata.totalPages ?? 1) * 2 + 1000;

  try {
    // Work in batches so progress is written regularly and an incremental run
    // can stop as soon as it catches up. A full import favours throughput; an
    // incremental one favours stopping early, since the whole batch is fetched
    // before we can tell it found nothing new.
    const batchSize = mode === 'incremental' ? concurrency : concurrency * 4;

    // `lastPage` is a moving target while the archive is live. Walking to it
    // once can finish a growth-step short of the true tail, so after the walk
    // the bound is re-checked and the walk continues if it moved. In practice
    // that costs one extra probe; the sweeps are bounded by pageCeiling.
    let start = resumeFrom + 1;

    while (start <= lastPage) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (pagesFetched >= hardLimit) {
        stoppedEarly = true;
        break;
      }

      const end = Math.min(start + batchSize - 1, lastPage, start + (hardLimit - pagesFetched) - 1);
      const pages: number[] = [];
      for (let p = start; p <= end; p++) pages.push(p);
      if (pages.length === 0) break;

      let batchNewEvents = 0;

      await runPool(
        pages,
        concurrency,
        async (page) => {
          const payload = await fetchPage(page, metadata.perPage, signal);

          // Extend the target if the archive grew since the run started.
          const seenLastPage = toNumber(payload.links?.last_page);
          if (seenLastPage !== null && seenLastPage > lastPage) {
            lastPage = Math.min(seenLastPage, pageCeiling);
          }
          const seenTotal = toNumber(payload.links?.total);
          if (seenTotal !== null) reportedTotal = seenTotal;

          const mapped = (payload.data ?? [])
            .map(mapApiEvent)
            .filter((e): e is BpkEventInput => e !== null);

          // Incremental: ignore anything at or below the watermark.
          const candidates =
            watermark !== null
              ? mapped.filter((e) => e.pubdateUnix !== null && e.pubdateUnix > watermark)
              : mapped;

          const result = insertBpkEvents(candidates);
          imported += result.inserted;
          duplicates += result.duplicates + (mapped.length - candidates.length);
          batchNewEvents += result.inserted;
          pagesFetched++;
          if (page > highestPageDone) highestPageDone = page;
        },
        signal
      );

      updateBpkImportState({
        lastPageDone: highestPageDone,
        imported: existing.imported + imported,
        duplicates: existing.duplicates + duplicates,
      });

      options.onProgress?.({
        pagesDone: pagesFetched,
        totalPages: metadata.totalPages,
        imported,
        duplicates,
      });

      // An incremental run has caught up once a whole batch yields nothing new.
      if (mode === 'incremental' && batchNewEvents === 0) {
        stoppedEarly = true;
        break;
      }

      await sleep(DELAY_BETWEEN_BATCHES_MS, signal);
      // Advance past what was actually fetched, not by a whole batch: `end` is
      // clamped by the current lastPage and by maxPages, so a fixed stride
      // would step over pages that were never requested.
      start = end + 1;

      // Exhausted the known range — ask the API whether more has appeared
      // behind us before declaring the archive fully walked.
      if (start > lastPage && mode === 'full' && !stoppedEarly && lastPage < pageCeiling) {
        const recheck = await probeApi(signal);
        if (recheck.totalPages !== null && recheck.totalPages > lastPage) {
          lastPage = Math.min(recheck.totalPages, pageCeiling);
        }
        if (recheck.totalEvents !== null) reportedTotal = recheck.totalEvents;
      }
    }

    const hitCeiling = lastPage >= pageCeiling;
    if (hitCeiling) {
      console.warn(
        `[bpk] stopped at the page ceiling (${pageCeiling}); the archive is growing faster than it can be read. Re-run to continue.`
      );
    }
    const completed = !stoppedEarly && !hitCeiling && highestPageDone >= lastPage;
    updateBpkImportState({
      status: mode === 'incremental' || completed ? 'complete' : 'idle',
      finishedAt: new Date().toISOString(),
      newestPubdateUnix: getNewestStoredPubdateUnix(),
      lastPageDone: mode === 'incremental' ? 0 : highestPageDone,
    });

    return {
      mode,
      pagesFetched,
      imported,
      duplicates,
      stoppedEarly: stoppedEarly || hitCeiling,
      perPage: metadata.perPage,
      reportedTotal,
      storedTotal: countBpkEvents(),
    };
  } catch (error) {
    const aborted = isAbortError(error);
    updateBpkImportState({
      // Progress is preserved either way, so a cancelled or failed run resumes.
      status: aborted ? 'cancelled' : 'failed',
      lastPageDone: highestPageDone,
      imported: existing.imported + imported,
      duplicates: existing.duplicates + duplicates,
      finishedAt: new Date().toISOString(),
      lastError: aborted ? null : (error as Error).message.slice(0, 500),
    });
    throw error;
  }
}
