/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

// db.ts resolves its path and caches its connection at module load, so each
// suite gets a fresh temp directory and a fresh module registry.
let tempDir: string;
let db: typeof import('@/lib/db');

function makeEvent(overrides: Partial<RawEvent> & { id: number }): RawEvent {
  return {
    name: `Event ${overrides.id}`,
    summary: '',
    url: '',
    type: 'Brand',
    datetime: '2026-07-27T12:00:00.000Z',
    location: { name: 'Malmö', gps: '55.6,13.0' },
    ...overrides,
  } as RawEvent;
}

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-q-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('getEventsFromDb', () => {
  it('orders newest first and paginates without gaps or repeats', () => {
    // Insert deliberately out of order.
    for (const hour of [3, 1, 5, 2, 4]) {
      db.insertEvent(
        makeEvent({
          id: hour,
          name: `Event ${hour}`,
          datetime: `2026-07-27T0${hour}:00:00.000Z`,
        })
      );
    }

    const all = db.getEventsFromDb({}, 10, 0).map((e) => e.id);
    expect(all).toEqual([5, 4, 3, 2, 1]);

    const firstPage = db.getEventsFromDb({}, 2, 0).map((e) => e.id);
    const secondPage = db.getEventsFromDb({}, 2, 2).map((e) => e.id);
    const thirdPage = db.getEventsFromDb({}, 2, 4).map((e) => e.id);

    expect(firstPage).toEqual([5, 4]);
    expect(secondPage).toEqual([3, 2]);
    expect(thirdPage).toEqual([1]);
    expect([...firstPage, ...secondPage, ...thirdPage]).toEqual(all);
  });

  it('filters by location and type exactly, not by prefix', () => {
    db.insertEvent(makeEvent({ id: 1, type: 'Brand', location: { name: 'Malmö', gps: '' } }));
    db.insertEvent(makeEvent({ id: 2, type: 'Stöld', location: { name: 'Malmö', gps: '' } }));
    db.insertEvent(makeEvent({ id: 3, type: 'Brand', location: { name: 'Malmberget', gps: '' } }));

    expect(db.getEventsFromDb({ location: 'Malmö' }, 10, 0).map((e) => e.id).sort()).toEqual([1, 2]);
    expect(db.getEventsFromDb({ type: 'Brand' }, 10, 0).map((e) => e.id).sort()).toEqual([1, 3]);
    expect(db.getEventsFromDb({ location: 'Malmö', type: 'Brand' }, 10, 0).map((e) => e.id)).toEqual([1]);

    // "Malm" must not match "Malmö" — this is an equality filter.
    expect(db.getEventsFromDb({ location: 'Malm' }, 10, 0)).toHaveLength(0);
  });

  it('searches across name, summary and location', () => {
    db.insertEvent(makeEvent({ id: 1, name: 'Brand i lägenhet', summary: 'Rök syns' }));
    db.insertEvent(makeEvent({ id: 2, name: 'Trafikolycka', summary: 'Brandkåren på plats' }));
    db.insertEvent(makeEvent({ id: 3, name: 'Stöld', summary: 'Inget', location: { name: 'Brandbergen', gps: '' } }));
    db.insertEvent(makeEvent({ id: 4, name: 'Rattfylleri', summary: 'Inget särskilt' }));

    const hits = db.getEventsFromDb({ search: 'brand' }, 10, 0).map((e) => e.id).sort();
    expect(hits).toEqual([1, 2, 3]);
  });

  it('treats LIKE wildcards in the search term as literal characters', () => {
    db.insertEvent(makeEvent({ id: 1, name: 'Rapport 100% klar' }));
    db.insertEvent(makeEvent({ id: 2, name: 'Ingenting alls' }));

    // An unescaped '%' would match every row.
    expect(db.getEventsFromDb({ search: '100%' }, 10, 0).map((e) => e.id)).toEqual([1]);
    // '_' is a single-character wildcard in LIKE; escaped it matches nothing here.
    expect(db.getEventsFromDb({ search: 'Rapp_rt' }, 10, 0)).toHaveLength(0);
  });

  it('reports was_updated only when an event actually changed', () => {
    db.insertEvent(makeEvent({ id: 1, name: 'Original', summary: 'First' }));
    expect(db.getEventsFromDb({}, 10, 0)[0].was_updated).toBe(false);

    // Backdate publish_time first. was_updated compares last_updated against
    // publish_time, and an insert followed immediately by an update can land in
    // the same millisecond, making the two timestamps compare equal.
    db.getDatabase().prepare("UPDATE events SET publish_time = '2020-01-01T00:00:00.000Z' WHERE id = 1").run();

    const status = db.insertEvent(makeEvent({ id: 1, name: 'Original', summary: 'Rewritten' }));
    expect(status).toBe('updated');
    expect(db.getEventsFromDb({}, 10, 0)[0].was_updated).toBe(true);
  });
});

describe('insertEvent', () => {
  it('distinguishes new, unchanged and updated events', () => {
    expect(db.insertEvent(makeEvent({ id: 1 }))).toBe('new');
    expect(db.insertEvent(makeEvent({ id: 1 }))).toBe('unchanged');
    expect(db.insertEvent(makeEvent({ id: 1, summary: 'Now with detail' }))).toBe('updated');
  });

  it('stores every timestamp in canonical UTC', () => {
    db.insertEvent(makeEvent({ id: 1, datetime: '2026-07-27 14:30:00 +02:00' }));

    const raw = db
      .getDatabase()
      .prepare('SELECT datetime, event_time FROM events WHERE id = 1')
      .get() as { datetime: string; event_time: string };

    expect(raw.datetime).toBe('2026-07-27T12:30:00.000Z');
    expect(raw.event_time.endsWith('Z')).toBe(true);
  });
});

describe('countEventsInDb', () => {
  it('counts the same rows the paginated query would return', () => {
    for (let id = 1; id <= 7; id++) {
      db.insertEvent(makeEvent({ id, type: id % 2 === 0 ? 'Brand' : 'Stöld' }));
    }

    expect(db.countEventsInDb()).toBe(7);
    expect(db.countEventsInDb({ type: 'Brand' })).toBe(3);
    expect(db.countEventsInDb({ type: 'Brand' })).toBe(
      db.getEventsFromDb({ type: 'Brand' }, 100, 0).length
    );
    expect(db.countEventsInDb({ type: 'Finns inte' })).toBe(0);
  });
});

describe('getFilterOptions', () => {
  it('returns distinct sorted values and excludes blanks', () => {
    db.insertEvent(makeEvent({ id: 1, type: 'Brand', location: { name: 'Malmö', gps: '' } }));
    db.insertEvent(makeEvent({ id: 2, type: 'Brand', location: { name: 'Lund', gps: '' } }));
    db.insertEvent(makeEvent({ id: 3, type: 'Stöld', location: { name: '', gps: '' } }));

    expect(db.getFilterOptions('type')).toEqual(['Brand', 'Stöld']);
    expect(db.getFilterOptions('location_name')).toEqual(['Lund', 'Malmö']);
  });

  it('rejects a column outside the allowlist', () => {
    // The type signature already constrains callers; this guards the runtime
    // path because the value is interpolated into the SQL string.
    expect(() =>
      (db.getFilterOptions as unknown as (c: string) => string[])('id; DROP TABLE events')
    ).toThrow();
  });
});

describe('getStatsSummary', () => {
  it('excludes summary events from the counts but not from the total', () => {
    const now = Date.now();
    const recent = new Date(now - 60 * 60 * 1000).toISOString();

    db.insertEvent(makeEvent({ id: 1, type: 'Brand', datetime: recent }));
    db.insertEvent(makeEvent({ id: 2, type: 'Stöld', datetime: recent }));
    db.insertEvent(makeEvent({ id: 3, type: 'Sammanfattning natt', datetime: recent }));

    const stats = db.getStatsSummary();

    // totalStored counts everything in the table...
    expect(stats.totalStored).toBe(3);
    // ...but the windowed counts skip the "Sammanfattning" roll-ups.
    expect(stats.last24h).toBe(2);
    expect(stats.topTypes.map((t) => t.label)).not.toContain('Sammanfattning natt');
  });

  it('always returns 24 hourly and 7 weekday buckets', () => {
    db.insertEvent(makeEvent({ id: 1, datetime: new Date().toISOString() }));
    const stats = db.getStatsSummary();

    expect(stats.hourly).toHaveLength(24);
    expect(stats.weekdays).toHaveLength(7);
    expect(stats.daily).toHaveLength(7);
    // Buckets are counts, never undefined holes.
    expect(stats.hourly.every((n) => typeof n === 'number')).toBe(true);
  });
});

describe('pruneFetchLog', () => {
  it('deletes only entries older than the retention window', () => {
    const pdo = db.getDatabase();
    const insert = pdo.prepare(
      'INSERT INTO fetch_log (fetched_at, events_fetched, events_new, success) VALUES (?, 0, 0, 1)'
    );
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

    insert.run(daysAgo(45));
    insert.run(daysAgo(31));
    insert.run(daysAgo(10));
    insert.run(daysAgo(0));

    expect(db.pruneFetchLog(30)).toBe(2);
    expect((pdo.prepare('SELECT COUNT(*) c FROM fetch_log').get() as { c: number }).c).toBe(2);
  });
});
