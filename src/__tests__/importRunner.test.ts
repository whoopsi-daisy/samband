/**
 * @jest-environment node
 */
import type { ImportSnapshot } from '@/lib/brottsplatskartanRunner';

// The runner owns the single in-flight import and pushes snapshots to whatever
// is watching (the SSE endpoint behind the dashboard). Everything it actually
// imports is mocked out here: what is under test is the lifecycle it publishes,
// not the import itself.

jest.mock('better-sqlite3', () => jest.fn(() => ({
  pragma: jest.fn(),
  exec: jest.fn(),
  close: jest.fn(),
  prepare: jest.fn(() => ({ run: jest.fn(), get: jest.fn(), all: jest.fn(() => []) })),
})));

jest.mock('@/lib/db', () => ({
  invalidateAggregateCaches: jest.fn(),
  warmAggregateCaches: jest.fn(),
  getDataDir: jest.fn(() => '/tmp'),
}));

jest.mock('@/lib/brottsplatskartanDb', () => ({
  getBpkImportState: jest.fn(() => ({
    status: 'idle',
    mode: null,
    lastPageDone: 0,
    totalPages: null,
    totalEvents: null,
    perPage: null,
    imported: 0,
    duplicates: 0,
    storedEvents: 0,
    newestPubdateUnix: null,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    lastError: null,
  })),
  updateBpkImportState: jest.fn(),
}));

jest.mock('@/lib/importSource', () => ({
  resolveImportSource: jest.fn((source: string) => ({
    kind: 'file',
    value: `/tmp/${source}`,
    label: source,
  })),
  ImportSourceError: class ImportSourceError extends Error {},
}));

const importNdjson = jest.fn();
jest.mock('@/lib/brottsplatskartanNdjson', () => ({
  importNdjson: (...args: unknown[]) => importNdjson(...args),
}));

jest.mock('@/lib/brottsplatskartan', () => ({
  importBrottsplatskartan: jest.fn(),
}));

let runner: typeof import('@/lib/brottsplatskartanRunner');

/** Settle every pending microtask, plus the .finally chain in begin(). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  runner = await import('@/lib/brottsplatskartanRunner');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the import lifecycle a watcher sees', () => {
  /**
   * The bug: `.finally()` published *unforced*, immediately after the
   * finish line recorded just above it had published *with* force. The 500ms
   * throttle therefore swallowed it every time, so the last snapshot a watcher
   * ever received said `running: true` and the dashboard sat on "Pågår" with a
   * progress bar that never resolved.
   */
  it('tells watchers the run is over', async () => {
    importNdjson.mockResolvedValue({
      linesRead: 10,
      imported: 10,
      duplicates: 0,
      malformed: 0,
      unusable: 0,
      bytesRead: 100,
      bytesTotal: 100,
      storedTotal: 10,
      source: 'dump.ndjson',
    });

    const seen: ImportSnapshot[] = [];
    runner.subscribe((snapshot) => seen.push(snapshot));

    expect(runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' }).started).toBe(true);
    await flush();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].running).toBe(false);
    expect(runner.isImportRunning()).toBe(false);
  });

  it('tells watchers the run is over even when it failed', async () => {
    importNdjson.mockRejectedValue(new Error('dump is not readable'));

    const seen: ImportSnapshot[] = [];
    runner.subscribe((snapshot) => seen.push(snapshot));

    runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' });
    await flush();

    expect(seen[seen.length - 1].running).toBe(false);
    expect(runner.getImportLog().some((entry) => entry.text.includes('failed'))).toBe(true);
  });

  it('tells watchers the run is over after a cancellation', async () => {
    const aborted = new Error('Aborted');
    aborted.name = 'AbortError';
    importNdjson.mockRejectedValue(aborted);

    const seen: ImportSnapshot[] = [];
    runner.subscribe((snapshot) => seen.push(snapshot));

    runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' });
    await flush();

    expect(seen[seen.length - 1].running).toBe(false);
    expect(runner.getImportLog().some((entry) => entry.text.includes('cancelled'))).toBe(true);
  });

  it('refuses a second import while one is running', async () => {
    importNdjson.mockReturnValue(new Promise(() => {}));

    expect(runner.startImport({ mode: 'ndjson', source: 'a.ndjson' }).started).toBe(true);

    const second = runner.startImport({ mode: 'ndjson', source: 'b.ndjson' });
    expect(second.started).toBe(false);
    expect(second.reason).toMatch(/already running/);
  });

  it('lets a new import start once the previous one has finished', async () => {
    importNdjson.mockResolvedValue({
      linesRead: 1,
      imported: 1,
      duplicates: 0,
      malformed: 0,
      unusable: 0,
      bytesRead: 10,
      bytesTotal: 10,
      storedTotal: 1,
      source: 'a.ndjson',
    });

    runner.startImport({ mode: 'ndjson', source: 'a.ndjson' });
    await flush();

    expect(runner.startImport({ mode: 'ndjson', source: 'b.ndjson' }).started).toBe(true);
  });

  it('rebuilds the cached aggregates whichever way the run ended', async () => {
    const db = await import('@/lib/db');
    importNdjson.mockRejectedValue(new Error('half way through'));

    runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' });
    await flush();

    // A cancelled or failed run still stored everything it got through.
    expect(db.invalidateAggregateCaches).toHaveBeenCalled();
    expect(db.warmAggregateCaches).toHaveBeenCalled();
  });

  it('stops pushing to a watcher that has unsubscribed', async () => {
    importNdjson.mockResolvedValue({
      linesRead: 1,
      imported: 1,
      duplicates: 0,
      malformed: 0,
      unusable: 0,
      bytesRead: 10,
      bytesTotal: 10,
      storedTotal: 1,
      source: 'a.ndjson',
    });

    const seen: ImportSnapshot[] = [];
    const unsubscribe = runner.subscribe((snapshot) => seen.push(snapshot));
    unsubscribe();

    runner.startImport({ mode: 'ndjson', source: 'a.ndjson' });
    await flush();

    expect(seen).toHaveLength(0);
  });
});
