/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempDir: string;
let db: typeof import('@/lib/db');

/** Write a fetch_log row at a chosen age, which logFetch cannot do. */
function logAt(daysAgo: number, success: boolean): void {
  const at = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
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
  it('reports a clean run as fully healthy', () => {
    for (let i = 0; i < 5; i++) logAt(0, true);

    expect(db.getOperationalStats().successRate).toBe(100);
  });

  it('reports 100% when there is nothing to divide', () => {
    expect(db.getOperationalStats().successRate).toBe(100);
  });

  /**
   * The success rate used to be computed over the whole fetch_log table, which
   * pruneFetchLog truncates at 30 days: a rolling 30-day figure wearing no
   * label. It is what colours the dashboard's health verdict, so a bad
   * afternoon three weeks ago went on tinting today long after the system had
   * recovered.
   */
  it('answers for its stated window, not for everything still on disk', () => {
    // A bad day, three weeks back: inside the retention window, outside the
    // window the number claims to describe.
    for (let i = 0; i < 50; i++) logAt(21, false);
    // A clean week since.
    for (let i = 0; i < 10; i++) logAt(1, true);

    expect(db.getOperationalStats().successRate).toBe(100);
  });

  it('still counts a failure inside the window', () => {
    for (let i = 0; i < 9; i++) logAt(1, true);
    logAt(1, false);

    expect(db.getOperationalStats().successRate).toBe(90);
  });

  // The all-time counters are a different question and keep answering it.
  it('leaves the lifetime totals alone', () => {
    for (let i = 0; i < 3; i++) logAt(21, false);
    for (let i = 0; i < 2; i++) logAt(1, true);

    const stats = db.getOperationalStats();

    expect(stats.totalFetches).toBe(5);
    expect(stats.failedFetches).toBe(3);
    expect(stats.successfulFetches).toBe(2);
    // ...while the rate speaks only for the last seven days.
    expect(stats.successRate).toBe(100);
  });
});
