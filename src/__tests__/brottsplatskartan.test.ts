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
