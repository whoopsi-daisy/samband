/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// The real API is a third party we cannot reach from tests, so every request
// is served by this fake. It models the documented response shape, including
// the `per_page` clamp behaviour the importer probes for.
interface FakeApiOptions {
  totalEvents: number;
  /** Largest page size the API will actually honour. */
  maxPerPage: number;
  /** Status codes to return before succeeding, per page number. */
  failuresBeforeSuccess?: Map<number, number[]>;
}

let fakeRequests: Array<{ page: number; perPage: number }> = [];
let lastRequestedUrl = '';

function installFakeApi(options: FakeApiOptions): void {
  const { totalEvents, maxPerPage } = options;
  const remainingFailures = new Map(options.failuresBeforeSuccess ?? []);

  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const page = Number(url.searchParams.get('page') ?? '1');
    // The real API takes the page size as `limit` and echoes it back as
    // `links.per_page`. Modelling that exactly is the point of this fake.
    const requestedPerPage = Number(url.searchParams.get('limit') ?? '10');
    const perPage = Math.min(requestedPerPage, maxPerPage);

    fakeRequests.push({ page, perPage });
    lastRequestedUrl = url.toString();

    const queued = remainingFailures.get(page);
    if (queued && queued.length > 0) {
      const status = queued.shift()!;
      return new Response('nope', { status, headers: { 'retry-after': '0' } });
    }

    const lastPage = Math.ceil(totalEvents / perPage);
    const start = (page - 1) * perPage;
    const count = Math.max(0, Math.min(perPage, totalEvents - start));

    // Newest first, so id 1 is the newest event and pubdate descends with id.
    const data = Array.from({ length: count }, (_, i) => {
      const index = start + i;
      const id = totalEvents - index;
      const unix = 1_700_000_000 + id * 60;
      return {
        id: String(id),
        pubdate_iso8601: new Date(unix * 1000).toISOString(),
        pubdate_unix: String(unix),
        title_type: id % 2 === 0 ? 'Trafikolycka' : 'Brand',
        title_location: 'Malmö',
        headline: `Händelse ${id}`,
        description: `Beskrivning ${id}`,
        content: `Innehåll ${id}`,
        location_string: 'Malmö, Skåne län',
        lat: '55.605',
        lng: '13.0038',
        external_source_link: 'https://polisen.se/x',
        permalink: `https://brottsplatskartan.se/handelse/${id}`,
      };
    });

    return new Response(
      JSON.stringify({
        links: { current_page: page, last_page: lastPage, per_page: perPage, total: totalEvents },
        data,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof fetch;
}

let tempDir: string;
let bpk: typeof import('@/lib/brottsplatskartan');
let bpkDb: typeof import('@/lib/brottsplatskartanDb');
let db: typeof import('@/lib/db');

beforeEach(async () => {
  jest.resetModules();
  fakeRequests = [];
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-bpk-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
  bpk = await import('@/lib/brottsplatskartan');
  bpkDb = await import('@/lib/brottsplatskartanDb');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('schema', () => {
  it('creates the import tables without touching the polisen events table', async () => {
    installFakeApi({ totalEvents: 10, maxPerPage: 10 });
    const handle = db.getDatabase();

    const tables = (
      handle.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name);

    expect(tables).toEqual(expect.arrayContaining(['events', 'fetch_log', 'bpk_events', 'bpk_import_state']));
  });

  it('keeps colliding ids in the two sources apart', async () => {
    installFakeApi({ totalEvents: 5, maxPerPage: 10 });

    // A polisen event with id 3...
    db.insertEvent({
      id: 3,
      name: 'Polisen event 3',
      summary: 'From polisen.se',
      url: '',
      type: 'Brand',
      datetime: '2026-07-27T10:00:00.000Z',
      location: { name: 'Lund', gps: '' },
    } as Parameters<typeof db.insertEvent>[0]);

    // ...and a brottsplatskartan import that also contains id 3.
    await bpk.importBrottsplatskartan({ mode: 'full' });

    const polisen = db.getEventsFromDb({}, 10, 0);
    expect(polisen).toHaveLength(1);
    expect(polisen[0].name).toBe('Polisen event 3');

    expect(bpkDb.countBpkEvents()).toBe(5);
  });
});

describe('mapApiEvent', () => {
  it('normalises the API payload, coercing string numbers', () => {
    const mapped = bpk.mapApiEvent({
      id: '42',
      pubdate_iso8601: '2026-07-27T12:00:00+02:00',
      pubdate_unix: '1785499200',
      title_type: ' Brand ',
      lat: '55.605',
      lng: '13.0038',
      headline: 'Rubrik',
    });

    expect(mapped).toMatchObject({
      id: 42,
      // Stored as UTC, like every other timestamp in this database.
      pubdate: '2026-07-27T10:00:00.000Z',
      titleType: 'Brand',
      lat: 55.605,
      lng: 13.0038,
    });
  });

  it('falls back to pubdate_unix when the ISO date is missing', () => {
    const mapped = bpk.mapApiEvent({ id: 7, pubdate_unix: 1_700_000_000 });
    expect(mapped?.pubdate).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('rejects records with no usable id or date instead of storing partials', () => {
    expect(bpk.mapApiEvent({ pubdate_unix: 1_700_000_000 })).toBeNull();
    expect(bpk.mapApiEvent({ id: 0, pubdate_unix: 1_700_000_000 })).toBeNull();
    expect(bpk.mapApiEvent({ id: 5 })).toBeNull();
    expect(bpk.mapApiEvent({ id: 5, pubdate_iso8601: 'not a date' })).toBeNull();
  });

  it('turns blank strings into null rather than storing empty text', () => {
    const mapped = bpk.mapApiEvent({ id: 1, pubdate_unix: 1_700_000_000, headline: '   ', lat: '' });
    expect(mapped?.headline).toBeNull();
    expect(mapped?.lat).toBeNull();
  });
});

describe('probeApi', () => {
  it('discovers a larger page size when the API honours one', async () => {
    installFakeApi({ totalEvents: 1000, maxPerPage: 100 });
    const meta = await bpk.probeApi();

    expect(meta.perPage).toBe(100);
    expect(meta.totalEvents).toBe(1000);
    expect(meta.totalPages).toBe(10);
  });

  it('believes the response over the advertised page size when clamped', async () => {
    // Asks for 100, server only ever gives 10.
    installFakeApi({ totalEvents: 1000, maxPerPage: 10 });
    const meta = await bpk.probeApi();

    expect(meta.perPage).toBe(10);
    // Page count is recomputed from the real page size, not taken on trust.
    expect(meta.totalPages).toBe(100);
  });
});

describe('importBrottsplatskartan', () => {
  it('imports every event exactly once', async () => {
    installFakeApi({ totalEvents: 250, maxPerPage: 100 });

    const result = await bpk.importBrottsplatskartan({ mode: 'full', concurrency: 2 });

    expect(result.imported).toBe(250);
    expect(bpkDb.countBpkEvents()).toBe(250);

    const ids = (db.getDatabase().prepare('SELECT id FROM bpk_events ORDER BY id').all() as Array<{ id: number }>).map(
      (r) => r.id
    );
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(250);
    expect(new Set(ids).size).toBe(250);
  });

  it('is idempotent — a second full import stores nothing new', async () => {
    installFakeApi({ totalEvents: 120, maxPerPage: 50 });

    await bpk.importBrottsplatskartan({ mode: 'full' });
    const second = await bpk.importBrottsplatskartan({ mode: 'full' });

    expect(second.imported).toBe(0);
    expect(second.duplicates).toBeGreaterThan(0);
    expect(bpkDb.countBpkEvents()).toBe(120);
  });

  it('records progress so an interrupted run resumes instead of restarting', async () => {
    installFakeApi({ totalEvents: 500, maxPerPage: 50 });

    // Stop after 4 pages.
    const partial = await bpk.importBrottsplatskartan({ mode: 'full', concurrency: 2, maxPages: 4 });
    expect(partial.stoppedEarly).toBe(true);
    expect(partial.imported).toBe(200);

    const midway = bpkDb.getBpkImportState();
    expect(midway.lastPageDone).toBe(4);
    expect(midway.status).toBe('idle');

    fakeRequests = [];

    // Resuming must not re-request the pages already done.
    const rest = await bpk.importBrottsplatskartan({ mode: 'full', concurrency: 2 });
    const pagesRequested = fakeRequests.map((r) => r.page).filter((p, i, a) => a.indexOf(p) === i);

    expect(Math.min(...pagesRequested.filter((p) => p !== 1))).toBe(5);
    expect(rest.imported).toBe(300);
    expect(bpkDb.countBpkEvents()).toBe(500);
    expect(bpkDb.getBpkImportState().status).toBe('complete');
  });

  it('retries a rate-limited page and still imports it', async () => {
    installFakeApi({
      totalEvents: 100,
      maxPerPage: 50,
      // Page 2 is throttled twice before succeeding.
      failuresBeforeSuccess: new Map([[2, [429, 503]]]),
    });

    const result = await bpk.importBrottsplatskartan({ mode: 'full', concurrency: 1 });

    expect(result.imported).toBe(100);
    expect(bpkDb.countBpkEvents()).toBe(100);
    expect(fakeRequests.filter((r) => r.page === 2).length).toBe(3);
  });

  it('gives up on a 404 rather than retrying forever', async () => {
    installFakeApi({
      totalEvents: 100,
      maxPerPage: 50,
      failuresBeforeSuccess: new Map([[2, [404, 404, 404, 404, 404]]]),
    });

    await expect(bpk.importBrottsplatskartan({ mode: 'full', concurrency: 1 })).rejects.toThrow(/404/);

    expect(bpkDb.getBpkImportState().status).toBe('failed');
    // One attempt, not four.
    expect(fakeRequests.filter((r) => r.page === 2).length).toBe(1);
  });

  it('stops an incremental sync once it reaches events it already has', async () => {
    installFakeApi({ totalEvents: 300, maxPerPage: 50 });
    await bpk.importBrottsplatskartan({ mode: 'full' });

    // Three new events appear at the top of the feed.
    installFakeApi({ totalEvents: 303, maxPerPage: 50 });
    fakeRequests = [];

    const result = await bpk.importBrottsplatskartan({ mode: 'incremental', concurrency: 2 });

    expect(result.imported).toBe(3);
    expect(bpkDb.countBpkEvents()).toBe(303);
    // Must not walk all 7 pages to find 3 new events.
    expect(fakeRequests.length).toBeLessThan(10);
  });

  it('can be cancelled, keeping what it already stored', async () => {
    installFakeApi({ totalEvents: 1000, maxPerPage: 10 });

    const controller = new AbortController();
    const promise = bpk.importBrottsplatskartan({ mode: 'full', concurrency: 2, signal: controller.signal });

    // Abort once some pages have landed.
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();

    await expect(promise).rejects.toThrow();

    const state = bpkDb.getBpkImportState();
    expect(state.status).toBe('cancelled');
    // Whatever arrived before the abort is kept and counted.
    expect(state.lastPageDone).toBeGreaterThanOrEqual(0);
    expect(bpkDb.countBpkEvents()).toBe(state.storedEvents);
  });

  it('reports progress as it goes', async () => {
    installFakeApi({ totalEvents: 400, maxPerPage: 50 });

    const seen: number[] = [];
    await bpk.importBrottsplatskartan({
      mode: 'full',
      concurrency: 2,
      onProgress: (p) => seen.push(p.pagesDone),
    });

    expect(seen.length).toBeGreaterThan(0);
    // Monotonically increasing.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen[seen.length - 1]).toBe(8);
  });
});

describe('completeness while the archive is live', () => {
  // The scenario that matters for "import everything": events keep being
  // published during a multi-hour run.
  function installGrowingApi(startTotal: number, perPage: number, addPerRequest: number) {
    let total = startTotal;
    // Ids are assigned newest-first: the newest event always has the highest id.
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const page = Number(url.searchParams.get('page') ?? '1');
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '10'), perPage);

      const lastPage = Math.ceil(total / limit);
      const start = (page - 1) * limit;
      const count = Math.max(0, Math.min(limit, total - start));
      const data = Array.from({ length: count }, (_, i) => {
        const id = total - (start + i);
        return { id, pubdate_unix: 1_700_000_000 + id * 60 };
      });

      const body = JSON.stringify({
        links: { current_page: page, last_page: lastPage, per_page: limit, total },
        data,
      });

      // New events appear at the head after each request is served.
      total += addPerRequest;

      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    return { finalTotal: () => total };
  }

  it('loses nothing when events are published mid-run', async () => {
    const api = installGrowingApi(1000, 100, 7);

    const result = await bpk.importBrottsplatskartan({ mode: 'full', concurrency: 2 });

    const stored = db
      .getDatabase()
      .prepare('SELECT id FROM bpk_events ORDER BY id')
      .all() as Array<{ id: number }>;
    const ids = new Set(stored.map((r) => r.id));

    // Every event that existed when the run began must be present. Those are
    // ids 1..1000 — ids above that were published during the run.
    const missing: number[] = [];
    for (let id = 1; id <= 1000; id++) if (!ids.has(id)) missing.push(id);

    expect(missing).toEqual([]);
    // The archive really did grow underneath the importer.
    expect(api.finalTotal()).toBeGreaterThan(1000);
    expect(result.reportedTotal).toBeGreaterThan(1000);
  });

  it('follows last_page as the archive grows instead of stopping at the initial bound', async () => {
    // 500 events at 100/page is 5 pages at the start. Adding 40 per request
    // pushes last_page past that while still converging, since each request
    // consumes 100.
    installGrowingApi(500, 100, 40);

    const result = await bpk.importBrottsplatskartan({ mode: 'full', concurrency: 1 });

    // A fixed bound would have stopped at 5 pages.
    expect(result.pagesFetched).toBeGreaterThan(5);

    const ids = new Set(
      (db.getDatabase().prepare('SELECT id FROM bpk_events').all() as Array<{ id: number }>).map((r) => r.id)
    );
    const missing: number[] = [];
    for (let id = 1; id <= 500; id++) if (!ids.has(id)) missing.push(id);
    expect(missing).toEqual([]);
  });

  it('reports stored versus expected totals so coverage can be checked', async () => {
    installFakeApi({ totalEvents: 300, maxPerPage: 100 });

    const result = await bpk.importBrottsplatskartan({ mode: 'full' });

    expect(result.reportedTotal).toBe(300);
    expect(result.storedTotal).toBe(300);
  });

  it('stops at a ceiling rather than chasing a feed that outgrows it', async () => {
    // Pathological: every 10-event request adds 200 more, so last_page runs
    // away. The run must end and report itself incomplete, not hang.
    installGrowingApi(50, 10, 200);

    const result = await bpk.importBrottsplatskartan({ mode: 'full', concurrency: 1, maxPages: 400 });

    expect(result.stoppedEarly).toBe(true);
    // Progress is kept so a re-run continues.
    expect(bpkDb.getBpkImportState().lastPageDone).toBeGreaterThan(0);
  }, 60_000);
});

describe('coexistence with the live polisen.se feed', () => {
  // The archive import is a multi-hour job sharing one SQLite connection with
  // the app's own 10-minute refresh. Neither may block or corrupt the other.
  it('keeps accepting polisen writes and reads while an import runs', async () => {
    installFakeApi({ totalEvents: 2000, maxPerPage: 10 });

    const importPromise = bpk.importBrottsplatskartan({ mode: 'full', concurrency: 2 });

    // Simulate the refresh scheduler landing new polisen events mid-import,
    // and the feed being read at the same time.
    let polisenWrites = 0;
    let feedReads = 0;
    for (let i = 1; i <= 40; i++) {
      db.insertEvent({
        id: i,
        name: `Polisen ${i}`,
        summary: 'Live event',
        url: '',
        type: 'Trafikolycka',
        datetime: new Date(1_700_000_000_000 + i * 60_000).toISOString(),
        location: { name: 'Uppsala', gps: '59.85,17.63' },
      } as Parameters<typeof db.insertEvent>[0]);
      polisenWrites++;

      if (db.getEventsFromDb({}, 5, 0).length > 0) feedReads++;
      await new Promise((r) => setTimeout(r, 1));
    }

    const result = await importPromise;

    // Both datasets are intact and independent.
    expect(polisenWrites).toBe(40);
    expect(feedReads).toBe(40);
    expect(db.countEventsInDb()).toBe(40);
    expect(result.imported).toBe(2000);
    expect(bpkDb.countBpkEvents()).toBe(2000);

    // The polisen feed still reads correctly, newest first.
    const feed = db.getEventsFromDb({}, 3, 0);
    expect(feed[0].name).toBe('Polisen 40');
  }, 30_000);

  it('leaves the polisen table untouched by a completed import', async () => {
    db.insertEvent({
      id: 7,
      name: 'Polisen 7',
      summary: 'Before the import',
      url: '',
      type: 'Brand',
      datetime: '2026-07-27T09:00:00.000Z',
      location: { name: 'Lund', gps: '' },
    } as Parameters<typeof db.insertEvent>[0]);

    const before = db.getEventsFromDb({}, 10, 0);

    installFakeApi({ totalEvents: 500, maxPerPage: 100 });
    await bpk.importBrottsplatskartan({ mode: 'full' });

    const after = db.getEventsFromDb({}, 10, 0);
    expect(after).toEqual(before);
    expect(db.countEventsInDb()).toBe(1);
  });
});

describe('request shape', () => {
  it('requests the path without a trailing slash and sizes pages with `limit`', async () => {
    installFakeApi({ totalEvents: 10, maxPerPage: 100 });
    await bpk.probeApi();

    const url = new URL(lastRequestedUrl);
    // The form confirmed working against the live API is /api/events?... —
    // appending a slash before the query string is an unnecessary gamble.
    expect(url.pathname.endsWith('/')).toBe(false);
    // Not pinned to a literal — the point is that a page size larger than the
    // API's default of 10 is requested, whatever that size currently is.
    expect(Number(url.searchParams.get('limit'))).toBeGreaterThan(10);
    expect(url.searchParams.get('per_page')).toBeNull();
    expect(url.searchParams.get('page')).toBe('1');
  });
});
