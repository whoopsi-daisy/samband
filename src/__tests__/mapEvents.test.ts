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
    const types = db.getMapEvents().map((e) => e.type);

    expect(types).toEqual(expect.arrayContaining(['Trafikolycka', 'Misshandel']));
    expect(types.filter((t) => t.includes('Sammanfattning'))).toEqual([]);
  });

  it("still applies the reader's own filters", () => {
    expect(db.getMapEvents({ type: 'Misshandel' }).map((e) => e.id)).toEqual([4]);
  });

  // The feed is the record of what the police published, summary posts and all.
  it('leaves the list alone', () => {
    const types = db.getEventsFromDb().map((e) => e.type);

    expect(types.filter((t) => t.includes('Sammanfattning'))).toHaveLength(2);
  });
});
