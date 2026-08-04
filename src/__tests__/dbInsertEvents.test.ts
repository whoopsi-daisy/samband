/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

// db.ts resolves its path and caches its connection at module load, so the temp
// directory has to be set before the module is pulled in dynamically.
let tempDir: string;
let db: typeof import('@/lib/db');

const makeEvent = (id: number, overrides: Partial<RawEvent> = {}): RawEvent => ({
  id,
  name: `27 juli 08:53, Trafikolycka, Ljungby`,
  summary: 'Sammandrag.',
  url: `/e/${id}/`,
  type: 'Trafikolycka',
  datetime: '2026-07-27T08:53:00+02:00',
  location: { name: 'Kronobergs län', gps: '56.83,13.94' },
  ...overrides,
});

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-insert-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('insertEvents', () => {
  it('writes a whole page and counts what it did', () => {
    const counts = db.insertEvents([makeEvent(1), makeEvent(2), makeEvent(3)]);

    expect(counts).toEqual({ new: 3, updated: 0, unchanged: 0 });
    expect(db.countEventsInDb()).toBe(3);
  });

  it('classifies a re-served page as unchanged rather than rewriting it', () => {
    db.insertEvents([makeEvent(1), makeEvent(2)]);

    expect(db.insertEvents([makeEvent(1), makeEvent(2)])).toEqual({
      new: 0,
      updated: 0,
      unchanged: 2,
    });
  });

  it('notices a corrected notice', () => {
    db.insertEvents([makeEvent(1)]);

    const counts = db.insertEvents([makeEvent(1, { summary: 'Rättad text.' })]);

    expect(counts).toEqual({ new: 0, updated: 1, unchanged: 0 });
  });

  it('is a no-op on an empty page', () => {
    expect(db.insertEvents([])).toEqual({ new: 0, updated: 0, unchanged: 0 });
  });

  /**
   * All-or-nothing.
   *
   * The refresh used to insert row by row with no transaction, so a page that
   * failed partway through left half of itself committed with nothing recording
   * which half. One transaction means the database is either as it was or as the
   * page said, never somewhere in between.
   */
  it('rolls the whole page back when one event is malformed', () => {
    const malformed = { ...makeEvent(2), location: undefined } as unknown as RawEvent;

    expect(() => db.insertEvents([makeEvent(1), malformed, makeEvent(3)])).toThrow();
    expect(db.countEventsInDb()).toBe(0);
  });

  it('leaves an earlier committed page intact when a later one fails', () => {
    db.insertEvents([makeEvent(1)]);
    const malformed = { ...makeEvent(2), location: undefined } as unknown as RawEvent;

    expect(() => db.insertEvents([malformed])).toThrow();
    expect(db.countEventsInDb()).toBe(1);
  });

  it('agrees with insertEvent on the status it reports', () => {
    expect(db.insertEvent(makeEvent(1))).toBe('new');
    expect(db.insertEvents([makeEvent(1)])).toEqual({ new: 0, updated: 0, unchanged: 1 });
    expect(db.insertEvents([makeEvent(1, { summary: 'Ny text.' })])).toEqual({
      new: 0,
      updated: 1,
      unchanged: 0,
    });
  });
});

describe('getDatabase', () => {
  /**
   * A failed migration used to poison the singleton.
   *
   * `db` was assigned as soon as the file opened, with the pragmas and
   * migrations running afterwards. Anything that threw in there left the module
   * holding a half-migrated handle that the `if (!db)` guard then returned
   * forever, with no retry and nothing logged after the first failure.
   */
  it('does not hold on to a handle whose initialisation failed', async () => {
    jest.resetModules();
    const failing = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-fail-'));
    process.env.SAMBAND_DATA_DIR = failing;

    const Database = (await import('better-sqlite3')).default;
    const close = jest.fn();
    const opens: string[] = [];

    jest.doMock('better-sqlite3', () =>
      jest.fn((file: string, options?: object) => {
        opens.push(file);
        if (opens.length === 1) {
          // A handle that opens and then fails during migration.
          return {
            pragma: jest.fn(),
            exec: jest.fn(() => {
              throw new Error('disk I/O error');
            }),
            prepare: jest.fn(() => ({ run: jest.fn(), get: jest.fn(), all: jest.fn(() => []) })),
            close,
          };
        }
        return new Database(file, options as never);
      })
    );

    jest.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = await import('@/lib/db');

    expect(() => fresh.getDatabase()).toThrow('disk I/O error');
    // The handle it threw away was closed, not left holding the file open.
    expect(close).toHaveBeenCalled();

    // The assertion that actually catches the bug. `db` used to be assigned as
    // soon as the file opened, so the `if (db)` guard was satisfied by the
    // half-migrated handle and the module never opened the database a second
    // time: it just kept returning the broken one. A second open is the proof
    // that the failure was not retained.
    fresh.getDatabase();
    expect(opens).toHaveLength(2);

    // And the handle it hands back now is a real, migrated database rather than
    // the mock that threw.
    expect(fresh.countEventsInDb()).toBe(0);

    jest.dontMock('better-sqlite3');
    delete process.env.SAMBAND_DATA_DIR;
    fs.rmSync(failing, { recursive: true, force: true });
  });
});
