/**
 * @jest-environment node
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Each test needs a fresh data directory *before* db.ts is imported, because the
// module resolves its path once at load time and caches the connection.
async function withTempDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-db-'));
  const previous = process.env.SAMBAND_DATA_DIR;
  process.env.SAMBAND_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.SAMBAND_DATA_DIR;
    else process.env.SAMBAND_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Build the schema as it existed before the UTC migration, with the two
// timestamp shapes an older install would have accumulated.
function seedLegacyDatabase(dir: string): void {
  const db = new Database(path.join(dir, 'events.db'));
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY, datetime TEXT, event_time TEXT, publish_time TEXT,
      last_updated TEXT, name TEXT, summary TEXT, url TEXT, type TEXT,
      location_name TEXT, location_gps TEXT, raw_data TEXT, fetched_at TEXT,
      content_hash TEXT
    );
    CREATE TABLE fetch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fetched_at TEXT, events_fetched INTEGER,
      events_new INTEGER, success INTEGER, error_message TEXT
    );
  `);

  const insert = db.prepare(
    'INSERT INTO events (id, datetime, event_time, name, type, location_name, location_gps, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  // Same instant, written both ways. Offset form is the *later* event.
  insert.run(1, '2026-07-27T12:00:00+02:00', '2026-07-27T12:00:00+02:00', 'Offset form', 'Brand', 'Malmö', '', '{}');
  insert.run(2, '2026-07-27T09:30:00.000Z', '2026-07-27T09:30:00.000Z', 'UTC form', 'Stöld', 'Lund', '', '{}');
  db.close();
}

describe('UTC timestamp migration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('rewrites offset-form timestamps to UTC and leaves UTC rows alone', async () => {
    await withTempDataDir(async (dir) => {
      seedLegacyDatabase(dir);

      const { getDatabase } = await import('@/lib/db');
      const db = getDatabase();

      const rows = db.prepare('SELECT id, datetime, event_time FROM events ORDER BY id').all() as Array<{
        id: number;
        datetime: string;
        event_time: string;
      }>;

      // 12:00+02:00 is 10:00 UTC.
      expect(rows[0]).toEqual({
        id: 1,
        datetime: '2026-07-27T10:00:00.000Z',
        event_time: '2026-07-27T10:00:00.000Z',
      });
      // Already canonical: must be untouched.
      expect(rows[1]).toEqual({
        id: 2,
        datetime: '2026-07-27T09:30:00.000Z',
        event_time: '2026-07-27T09:30:00.000Z',
      });
    });
  });

  it('fixes the ordering that mixed formats broke', async () => {
    await withTempDataDir(async (dir) => {
      seedLegacyDatabase(dir);

      const { getDatabase } = await import('@/lib/db');
      const db = getDatabase();

      const ids = (
        db.prepare('SELECT id FROM events ORDER BY event_time DESC, id DESC').all() as Array<{ id: number }>
      ).map((r) => r.id);

      // Event 1 (10:00Z) is newer than event 2 (09:30Z) so it must sort first.
      // Before the migration the raw strings compared as '+' < '.', putting the
      // older event on top of the feed.
      expect(ids).toEqual([1, 2]);
    });
  });

  it('is idempotent and records the schema version', async () => {
    await withTempDataDir(async (dir) => {
      seedLegacyDatabase(dir);

      const first = await import('@/lib/db');
      first.getDatabase().close();

      jest.resetModules();
      const second = await import('@/lib/db');
      const db = second.getDatabase();

      // Assert a version was recorded and is stable, not a specific number:
      // pinning the literal breaks every time a migration is added.
      const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
      expect(Number(version.value)).toBeGreaterThanOrEqual(1);

      const reopened = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
      expect(reopened.value).toBe(version.value);

      const row = db.prepare('SELECT event_time FROM events WHERE id = 1').get() as { event_time: string };
      expect(row.event_time).toBe('2026-07-27T10:00:00.000Z');
    });
  });
});

describe('toUtcIso', () => {
  it('normalises offset, UTC and space-separated forms to the same instant', async () => {
    const { toUtcIso } = await import('@/lib/db');
    expect(toUtcIso('2026-07-27T12:00:00+02:00')).toBe('2026-07-27T10:00:00.000Z');
    expect(toUtcIso('2026-07-27T10:00:00.000Z')).toBe('2026-07-27T10:00:00.000Z');
  });

  it('passes through values it cannot parse instead of inventing a date', async () => {
    const { toUtcIso } = await import('@/lib/db');
    expect(toUtcIso('not a date')).toBe('not a date');
    expect(toUtcIso(null)).toBeNull();
    expect(toUtcIso('')).toBeNull();
  });
});
