/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

// db.ts resolves its path and caches its connection at module load, and a
// static `import` is hoisted above any assignment in the file. So the temp
// directory has to be set before the module is pulled in dynamically, or the
// suite writes into the project's real database.
let tempDir: string;
let db: typeof import('@/lib/db');

/** The map always asks for a window; a day back covers the fixtures. */
const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

const makeEvent = (id: number, type: string): RawEvent => ({
  id,
  name: `x, ${type}, Ljungby`,
  summary: 'Sammandrag.',
  url: `/e/${id}/`,
  type,
  datetime: new Date(Date.now() - id * 60_000).toISOString(),
  location: { name: 'Kronobergs län', gps: '56.83,13.94' },
});

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-map-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');

  db.insertEvent(makeEvent(1, 'Trafikolycka'));
  db.insertEvent(makeEvent(2, 'Sammanfattning natt'));
  db.insertEvent(makeEvent(3, 'Sammanfattning kväll och natt'));
  db.insertEvent(makeEvent(4, 'Misshandel'));
  db.invalidateAggregateCaches();
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('getMapEvents', () => {
  // The shift handover the police publish on a schedule is not an incident,
  // and its marker lands on a county centroid where nothing happened.
  it('leaves the scheduled summary posts off the map', () => {
    const types = db.getMapEvents({}, dayAgo()).map((e) => e.type);

    expect(types).toEqual(expect.arrayContaining(['Trafikolycka', 'Misshandel']));
    expect(types.filter((t) => t.includes('Sammanfattning'))).toEqual([]);
  });

  it("still applies the reader's own filters", () => {
    expect(db.getMapEvents({ type: 'Misshandel' }, dayAgo()).map((e) => e.id)).toEqual([4]);
  });

  // The feed is the record of what the police published, summary posts and all.
  it('leaves the list alone', () => {
    const types = db.getEventsFromDb().map((e) => e.type);

    expect(types.filter((t) => t.includes('Sammanfattning'))).toHaveLength(2);
  });

  // The map used to ask for the newest 500 rows whatever the period and drop
  // the ones outside its window on the client, so a filter whose incidents were
  // all older fetched five hundred rows and drew none of them.
  it('asks the database for the window rather than filtering after the fact', () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    // Fixtures are minutes old, so an hour reaches them and a year ago does not
    // reach anything newer than itself.
    expect(db.getMapEvents({}, anHourAgo).length).toBeGreaterThan(0);
    expect(db.getMapEvents({}, new Date(Date.now() + 60 * 60 * 1000))).toEqual([]);
  });
});

/**
 * The cache in front of the map query.
 *
 * The route builds `since` as `Date.now() - days * 86400000`, which carries
 * milliseconds, so every request produced a different cache key. The cache
 * therefore never once answered from itself, and because expired entries were
 * never swept, each request left a permanent entry behind holding up to 500
 * event objects.
 */
describe('the map cache', () => {
  it('treats two requests a few milliseconds apart as the same window', () => {
    const base = Date.now() - 24 * 60 * 60 * 1000;

    db.getMapEvents({}, new Date(base));
    db.getMapEvents({}, new Date(base + 1));
    db.getMapEvents({}, new Date(base + 37));

    expect(db.getMapCacheSize()).toBe(1);
  });

  it('still separates genuinely different windows', () => {
    db.getMapEvents({}, new Date(Date.now() - 24 * 60 * 60 * 1000));
    db.getMapEvents({}, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

    expect(db.getMapCacheSize()).toBe(2);
  });

  it('still separates different filters', () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    db.getMapEvents({}, since);
    db.getMapEvents({ type: 'Misshandel' }, since);

    expect(db.getMapCacheSize()).toBe(2);
  });

  // A search term is free text off a query string, so the key space is as wide
  // as a visitor cares to make it and each entry is 500 events.
  it('does not grow without bound on unique search terms', () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (let i = 0; i < 200; i++) {
      db.getMapEvents({ search: `term-${i}` }, since);
    }

    expect(db.getMapCacheSize()).toBeLessThanOrEqual(32);
  });
});
