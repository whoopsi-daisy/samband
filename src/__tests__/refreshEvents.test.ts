/**
 * @jest-environment node
 */
import type { RawEvent } from '@/types';

// better-sqlite3 is a native module and nothing here needs a real database:
// the point of this suite is what the refresh does to the *network* and how
// many times it writes, both of which are observable through the mock.
jest.mock('better-sqlite3', () => jest.fn(() => ({
  pragma: jest.fn(),
  exec: jest.fn(),
  close: jest.fn(),
  transaction: jest.fn((fn: unknown) => fn),
  prepare: jest.fn(() => ({ run: jest.fn(), get: jest.fn(), all: jest.fn(() => []) })),
})));

jest.mock('@/lib/db', () => ({
  insertEvents: jest.fn(() => ({ new: 1, updated: 0, unchanged: 0 })),
  logFetch: jest.fn(),
  getLastFetchTime: jest.fn(() => null),
  // Comfortably above BACKFILL_THRESHOLD, so the plain single-request path runs.
  countEventsInDb: jest.fn(() => 1000),
  getDailyFetchCount: jest.fn(() => 0),
  invalidateAggregateCaches: jest.fn(),
}));

interface MockedDb {
  insertEvents: jest.Mock;
  logFetch: jest.Mock;
  getLastFetchTime: jest.Mock;
  countEventsInDb: jest.Mock;
  getDailyFetchCount: jest.Mock;
  invalidateAggregateCaches: jest.Mock;
}

let policeApi: typeof import('@/lib/policeApi');
let db: MockedDb;

const makeEvent = (id: number): RawEvent => ({
  id,
  name: `27 juli 08:53, Trafikolycka, Ljungby`,
  summary: 'Sammandrag.',
  url: `/e/${id}/`,
  type: 'Trafikolycka',
  datetime: '2026-07-27T08:53:00+02:00',
  location: { name: 'Kronobergs län', gps: '56.83,13.94' },
});

const okResponse = (events: RawEvent[]) =>
  ({ ok: true, status: 200, json: async () => events }) as unknown as Response;

beforeEach(async () => {
  // refreshEventsIfNeeded holds the in-flight promise in module state, so each
  // test needs a module registry of its own.
  jest.resetModules();
  db = (await import('@/lib/db')) as unknown as MockedDb;
  policeApi = await import('@/lib/policeApi');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('refreshEventsIfNeeded', () => {
  /**
   * The thundering herd.
   *
   * The guard was `getLastFetchTime()`, read from the database, and the row
   * that moves it is written only once the fetch completes. So every caller
   * arriving during a fetch read the same stale timestamp and started another
   * one: N requests to polisen.se, N sets of writes, and N rows in fetch_log
   * for a single refresh cycle.
   */
  it('runs one fetch however many callers ask at once', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fetchMock = jest.fn(async () => {
      await gate;
      return okResponse([makeEvent(1)]);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = Array.from({ length: 5 }, () => policeApi.refreshEventsIfNeeded());
    release?.();
    const results = await Promise.all(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.logFetch).toHaveBeenCalledTimes(1);
    expect(db.insertEvents).toHaveBeenCalledTimes(1);
    // Everyone got the same answer, not five separately-computed ones.
    expect(new Set(results).size).toBe(1);
  });

  it('starts a fresh refresh once the previous one has settled', async () => {
    const fetchMock = jest.fn(async () => okResponse([makeEvent(1)]));
    global.fetch = fetchMock as unknown as typeof fetch;

    await policeApi.refreshEventsIfNeeded();
    // getLastFetchTime is still mocked to null, so a refresh is due again.
    await policeApi.refreshEventsIfNeeded();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not wedge after a failed refresh', async () => {
    const failing = jest.fn(async () => ({ ok: false, status: 404 }) as unknown as Response);
    global.fetch = failing as unknown as typeof fetch;

    const first = await policeApi.refreshEventsIfNeeded();
    expect(first.success).toBe(false);

    const succeeding = jest.fn(async () => okResponse([makeEvent(1)]));
    global.fetch = succeeding as unknown as typeof fetch;

    const second = await policeApi.refreshEventsIfNeeded();
    expect(second.success).toBe(true);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  // Was a bare loop calling insertEvent per event, each compiling its own
  // statements and committing its own transaction.
  it('hands the whole page to one batched write', async () => {
    const events = [makeEvent(1), makeEvent(2), makeEvent(3)];
    global.fetch = jest.fn(async () => okResponse(events)) as unknown as typeof fetch;

    await policeApi.refreshEventsIfNeeded();

    expect(db.insertEvents).toHaveBeenCalledTimes(1);
    expect(db.insertEvents.mock.calls[0][0]).toHaveLength(3);
  });

  // insertEvents is all-or-nothing, so a failure means no rows landed. Logging
  // a partial count would put numbers in the fetch log for rows that do not
  // exist, and the dashboard reads that log as the record of what happened.
  it('reports nothing written when the fetch fails', async () => {
    global.fetch = jest.fn(
      async () => ({ ok: false, status: 404 }) as unknown as Response
    ) as unknown as typeof fetch;

    const result = await policeApi.refreshEventsIfNeeded();

    expect(result.success).toBe(false);
    expect(result.new).toBe(0);
    expect(result.updated).toBe(0);
    expect(db.insertEvents).not.toHaveBeenCalled();
    expect(db.logFetch).toHaveBeenCalledWith(0, 0, false, expect.any(String));
  });

  it('skips entirely when the last fetch is recent', async () => {
    db.getLastFetchTime.mockReturnValue(new Date());
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await policeApi.refreshEventsIfNeeded();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ fetched: 0, new: 0, updated: 0, success: true, error: null });
  });

  it('refuses to fetch past the daily cap', async () => {
    db.getDailyFetchCount.mockReturnValue(10_000);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await policeApi.refreshEventsIfNeeded();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('drops the cached aggregates only when something actually changed', async () => {
    global.fetch = jest.fn(async () => okResponse([makeEvent(1)])) as unknown as typeof fetch;
    db.insertEvents.mockReturnValue({ new: 0, updated: 0, unchanged: 1 });

    await policeApi.refreshEventsIfNeeded();

    expect(db.invalidateAggregateCaches).not.toHaveBeenCalled();
  });
});
