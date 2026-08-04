/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempDir: string;
let db: typeof import('@/lib/db');

/** Write a fetch_log row at a chosen age, which logFetch cannot do. */
function logAt(hoursAgo: number, success: boolean): void {
  const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  db.getDatabase()
    .prepare(
      'INSERT INTO fetch_log (fetched_at, events_fetched, events_new, success, error_message) VALUES (?, ?, ?, ?, ?)'
    )
    .run(at, 10, 1, success ? 1 : 0, success ? null : 'HTTP error 500');
}

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-ops-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('getOperationalStats', () => {
  it('reports a clean run as fully healthy on both rates', () => {
    for (let i = 0; i < 5; i++) logAt(1, true);

    const stats = db.getOperationalStats();
    expect(stats.successRate).toBe(100);
    expect(stats.successRate24h).toBe(100);
  });

  it('reports 100% when there is nothing to divide', () => {
    const stats = db.getOperationalStats();
    expect(stats.successRate).toBe(100);
    expect(stats.successRate24h).toBe(100);
  });

  /**
   * The two rates answer different questions, and the 24h one is the reason the
   * pair exists: a lifetime rate cannot move during an outage, because one bad
   * morning is nothing against a denominator built up over months. An operator
   * opening the dashboard mid-outage needs a number that has already fallen.
   */
  it('drops the 24h rate during an outage while the lifetime rate holds up', () => {
    // A long, healthy history.
    for (let i = 0; i < 500; i++) logAt(48 + i, true);
    // This morning, nothing works.
    for (let i = 0; i < 10; i++) logAt(1, false);

    const stats = db.getOperationalStats();

    expect(stats.successRate24h).toBe(0);
    // Barely moved: 500 of 510.
    expect(stats.successRate).toBeGreaterThan(97);
  });

  it('counts a partial failure inside the 24h window', () => {
    for (let i = 0; i < 9; i++) logAt(1, true);
    logAt(2, false);

    expect(db.getOperationalStats().successRate24h).toBe(90);
  });

  // Yesterday's outage must not go on colouring today.
  it('lets the 24h rate recover once the failures age out', () => {
    for (let i = 0; i < 50; i++) logAt(30, false);
    for (let i = 0; i < 10; i++) logAt(1, true);

    expect(db.getOperationalStats().successRate24h).toBe(100);
  });

  it('keeps the lifetime counters answering for all of time', () => {
    for (let i = 0; i < 3; i++) logAt(30, false);
    for (let i = 0; i < 2; i++) logAt(1, true);

    const stats = db.getOperationalStats();

    expect(stats.totalFetches).toBe(5);
    expect(stats.failedFetches).toBe(3);
    expect(stats.successfulFetches).toBe(2);
    expect(stats.successRate).toBe(40);
  });
});

/**
 * A silently empty upstream.
 *
 * polisen.se answering `[]` is a successful fetch: the request worked, the
 * parse worked, zero rows were written. Nothing distinguished that from a quiet
 * period, so a feed that had stopped carrying events reported a green
 * healthcheck, a 100% success rate and a freshness of zero minutes.
 */
describe('countTrailingEmptyFetches', () => {
  const logEvents = (hoursAgo: number, fetched: number): void => {
    const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
    db.getDatabase()
      .prepare(
        'INSERT INTO fetch_log (fetched_at, events_fetched, events_new, success, error_message) VALUES (?, ?, ?, 1, NULL)'
      )
      .run(at, fetched, 0);
  };

  it('counts nothing on a fresh database', () => {
    expect(db.countTrailingEmptyFetches()).toBe(0);
  });

  it('counts nothing while events are arriving', () => {
    logEvents(3, 40);
    logEvents(2, 38);
    logEvents(1, 41);

    expect(db.countTrailingEmptyFetches()).toBe(0);
  });

  it('counts the run of empty fetches at the end', () => {
    logEvents(5, 40);
    logEvents(4, 0);
    logEvents(3, 0);
    logEvents(2, 0);

    expect(db.countTrailingEmptyFetches()).toBe(3);
  });

  // The run is what matters: a single quiet fetch says nothing, and one that
  // brought events back means the feed is alive whatever came before it.
  it('resets as soon as one fetch brings something back', () => {
    logEvents(5, 0);
    logEvents(4, 0);
    logEvents(3, 12);

    expect(db.countTrailingEmptyFetches()).toBe(0);
  });

  it('ignores failed fetches, which are a different problem', () => {
    logEvents(3, 40);
    // A failure is already visible in the success rate; it is not silence.
    logAt(2, false);

    expect(db.countTrailingEmptyFetches()).toBe(0);
  });
});
