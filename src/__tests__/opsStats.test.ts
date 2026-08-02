/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts resolves its path at module load, so the temp directory has to be set
// before the module is pulled in. Hence the dynamic import.
let tempDir: string;
let db: typeof import('@/lib/db');

/** Write a fetch_log row directly: logFetch() always stamps it "now". */
function log(minutesAgo: number, success: boolean, message: string | null = null): void {
  db.getDatabase()
    .prepare(
      'INSERT INTO fetch_log (fetched_at, events_fetched, events_new, success, error_message) VALUES (?,?,?,?,?)'
    )
    .run(
      new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      success ? 40 : 0,
      success ? 0 : 0,
      success ? 1 : 0,
      message
    );
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

describe('uptime', () => {
  // The old score counted every attempt, so a container whose every fetch
  // failed for a day still reported 100% uptime: it kept trying on schedule,
  // and trying was all the number measured. It is the headline tile.
  it('counts the fetches that worked, not the ones that were attempted', () => {
    for (let i = 0; i < 144; i++) log(i * 10, false, 'HTTP 503');

    const stats = db.getOperationalStats();
    expect(stats.fetches24h).toBe(144);
    expect(stats.uptimeScore).toBe(0);
  });

  it('is full when the schedule was kept', () => {
    for (let i = 0; i < 144; i++) log(i * 10, true);
    expect(db.getOperationalStats().uptimeScore).toBe(100);
  });

  it('is proportional when passes were missed entirely', () => {
    for (let i = 0; i < 72; i++) log(i * 10, true);
    expect(db.getOperationalStats().uptimeScore).toBe(50);
  });
});

describe('success rate', () => {
  // A lifetime rate cannot move during an outage: one bad day against a year
  // of history stays at 99.9% while the feed is dead.
  it('is reported over 24 hours as well as over the whole log', () => {
    for (let i = 0; i < 500; i++) log(2000 + i * 10, true); // older than a day
    for (let i = 0; i < 10; i++) log(i * 10, false, 'HTTP 503');

    const stats = db.getOperationalStats();
    expect(stats.successRate24h).toBe(0);
    expect(stats.successRate).toBeGreaterThan(97);
  });

  it('calls an empty log a success rather than a division by zero', () => {
    const stats = db.getOperationalStats();
    expect(stats.successRate24h).toBe(100);
    expect(stats.uptimeScore).toBe(0);
    expect(stats.minutesSinceLastSuccess).toBeNull();
  });
});

describe('what the errors say', () => {
  // The message used to be dropped and only a bucket kept, which turned every
  // upstream problem into the same unactionable screen.
  it('keeps the upstream message, not just a category', () => {
    log(5, false, 'HTTPError: 503 Service Unavailable');

    const [error] = db.getOperationalStats().recentErrors;
    expect(error.message).toBe('HTTPError: 503 Service Unavailable');
    // 503 used to fall through to "Other Error" because the rule tested for
    // the literal string 500.
    expect(error.errorType).toBe('Serverfel');
  });

  it('classifies in Swedish, on a Swedish page', () => {
    log(5, false, 'TimeoutError: upstream did not respond');
    log(6, false, 'getaddrinfo ENOTFOUND polisen.se');

    const types = db.getOperationalStats().recentErrors.map((e) => e.errorType);
    expect(types).toEqual(['Tidsgräns', 'DNS-fel']);
  });

  it('carries the message into the log table too', () => {
    log(5, false, 'HTTPError: 429 Too Many Requests');
    const [row] = db.getRecentFetchLogs(5);
    expect(row.errorMessage).toBe('HTTPError: 429 Too Many Requests');
    expect(row.errorType).toBe('Nedstrypt');
  });
});

describe('the hourly timeline', () => {
  it('splits each hour by outcome, so an outage is visible', () => {
    const nowHour = new Date().getHours();
    log(1, true);
    log(2, false, 'HTTP 503');

    const hours = db.getOperationalStats().hourlyFetches;
    expect(hours).toHaveLength(24);
    const total = hours.reduce((sum, h) => sum + h.ok + h.failed, 0);
    expect(total).toBe(2);
    // Both rows are minutes old, so they land in this hour or the one before.
    const failed = hours.reduce((sum, h) => sum + h.failed, 0);
    expect(failed).toBe(1);
    expect(hours[nowHour].ok + hours[(nowHour + 23) % 24].ok).toBe(1);
  });
});

describe('new events per fetch', () => {
  // This excluded fetches that brought nothing, making it "the average among
  // the fetches that had any": always well above 1, whatever the feed did.
  it('counts the fetches that returned nothing new', () => {
    const insert = db.getDatabase().prepare(
      'INSERT INTO fetch_log (fetched_at, events_fetched, events_new, success, error_message) VALUES (?,?,?,1,NULL)'
    );
    const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    insert.run(at(10), 40, 4);
    insert.run(at(20), 40, 0);
    insert.run(at(30), 40, 0);
    insert.run(at(40), 40, 0);

    expect(db.getOperationalStats().avgEventsPerFetch).toBe(1);
  });
});

describe('the system snapshot', () => {
  it('reports where the database is and how big it has grown', () => {
    const snapshot = db.getSystemSnapshot();
    expect(snapshot.dataDir).toBe(fs.realpathSync(tempDir));
    expect(snapshot.databaseBytes).toBeGreaterThan(0);
    expect(snapshot.nodeVersion).toBe(process.version);
    expect(snapshot.processUptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  // Every stored timestamp is parsed out of Swedish wall-clock text, so this
  // is the difference between correct data and every event off by an hour.
  it('says whether the timezone is the one the app requires', () => {
    const snapshot = db.getSystemSnapshot();
    expect(snapshot.timeZoneCorrect).toBe(snapshot.timeZone === 'Europe/Stockholm');
  });

  it('reports the search tokenizer, and whether the index still matches it', () => {
    const snapshot = db.getSystemSnapshot();
    expect(snapshot.searchTokenizer.configured).toBe('trigram');
    // Nothing imported, so no index has been built and there is nothing to
    // disagree with the setting yet.
    expect(snapshot.searchTokenizer.matches).toBe(true);
  });

  it('notices when the index was built with a different tokenizer', () => {
    // Initialisation already records the tokenizer it built with, so this is
    // the shape of an operator changing BPK_SEARCH_TOKENIZER and not yet
    // having restarted into the rebuild.
    db.getDatabase()
      .prepare("UPDATE meta SET value = 'unicode61' WHERE key = 'bpk_search_tokenizer'")
      .run();

    const snapshot = db.getSystemSnapshot();
    expect(snapshot.searchTokenizer.built).toBe('unicode61');
    expect(snapshot.searchTokenizer.matches).toBe(false);
  });

  it('reports an empty archive as empty rather than as a missing cutoff', () => {
    const snapshot = db.getSystemSnapshot();
    expect(snapshot.archive).toEqual({ events: 0, cutoff: null });
  });
});

describe('the fetch budget', () => {
  // The gauge has to read the same count the limiter checks, or it can say
  // there is room while the limiter is refusing.
  it('is the same count the rate limit itself uses', () => {
    for (let i = 0; i < 30; i++) log(i * 10, true);
    for (let i = 0; i < 5; i++) log(2000 + i, true); // outside the window

    expect(db.getOperationalStats().fetches24h).toBe(db.getDailyFetchCount());
  });
});

describe('freshness', () => {
  it('dates from the last successful fetch, not the last attempt', () => {
    log(90, true);
    log(5, false, 'HTTP 503');

    const stats = db.getOperationalStats();
    expect(stats.minutesSinceLastSuccess).toBeGreaterThanOrEqual(89);
    expect(stats.minutesSinceLastSuccess).toBeLessThanOrEqual(91);
  });

  // A quiet night legitimately brings no new events, so the age of the newest
  // stored event is a fact about the feed, not a fault in the container. It
  // used to drive an amber health tile.
  it('keeps the age of the newest event as a separate, uncoloured fact', () => {
    const health = db.getDatabaseHealth();
    expect(health).toHaveProperty('dataFreshnessMinutes');
    expect(db.getOperationalStats()).not.toHaveProperty('dataFreshnessMinutes');
  });
});

// Kept so the aggregate keeps agreeing with itself.
describe('totals', () => {
  it('splits 24h fetches into successes and failures that add up', () => {
    for (let i = 0; i < 20; i++) log(i * 10, i % 4 !== 0, i % 4 === 0 ? 'HTTP 503' : null);

    const stats = db.getOperationalStats();
    expect(stats.successfulFetches24h + stats.failedFetches24h).toBe(stats.fetches24h);
    expect(stats.failedFetches24h).toBe(5);
  });

  it('counts a week separately from a day', () => {
    for (let i = 0; i < 10; i++) log(i * 10, true);
    for (let i = 0; i < 10; i++) log(3 * 24 * 60 + i * 10, true);

    const stats = db.getOperationalStats();
    expect(stats.fetches24h).toBe(10);
    expect(stats.fetches7d).toBe(20);
  });
});
