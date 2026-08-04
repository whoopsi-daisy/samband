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

const PRESS_DESK =
  'Efter klockan 22:00 finns ingen presstalesperson i tjänst. Frågor från media besvaras av vakthavande befäl i mån av tid.';

const makeEvent = (id: number, type: string, summary: string, county: string): RawEvent => ({
  id,
  name: `1 augusti 21:5${id}, ${type}, ${county}`,
  summary,
  url: `/e/${id}/`,
  type,
  datetime: new Date(Date.now() - id * 60_000).toISOString(),
  location: { name: county, gps: '56.83,13.94' },
});

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-press-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');

  // The real shape of an evening: one copy of the boilerplate per region,
  // filed within a minute of each other, among the actual incidents.
  db.insertEvent(makeEvent(1, 'Övrigt', PRESS_DESK, 'Hallands län'));
  db.insertEvent(makeEvent(2, 'Övrigt', PRESS_DESK, 'Västra Götalands län'));
  db.insertEvent(makeEvent(3, 'Övrigt', PRESS_DESK, 'Skåne län'));
  db.insertEvent(makeEvent(4, 'Trafikolycka', 'Mc i singelolycka.', 'Götene'));
  db.insertEvent(makeEvent(5, 'Misshandel', 'Larm om skadad man.', 'Göteborg'));
  // "Övrigt" carries real notices too, and dropping the type would take them.
  db.insertEvent(makeEvent(6, 'Övrigt', 'Polisen spärrar av efter fynd.', 'Borås'));
  db.invalidateAggregateCaches();
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the press desk boilerplate', () => {
  // Word for word the same text, once per region, every night. It reports no
  // incident and is addressed to journalists, and seven copies arriving
  // together push the day's actual events down the page.
  it('stays out of the feed', () => {
    const summaries = db.getEventsFromDb({}, 100, 0).map((e) => e.summary);

    expect(summaries.some((s) => s?.includes('presstalesperson'))).toBe(false);
    expect(summaries).toEqual(
      expect.arrayContaining(['Mc i singelolycka.', 'Larm om skadad man.'])
    );
  });

  it('does not take the rest of "Övrigt" with it', () => {
    const summaries = db.getEventsFromDb({}, 100, 0).map((e) => e.summary);
    expect(summaries).toContain('Polisen spärrar av efter fynd.');
  });

  // The count pages the feed. If the two disagreed, the last page would promise
  // rows that never arrive.
  it('is counted out as well as filtered out', () => {
    expect(db.countEventsInDb({})).toBe(db.getEventsFromDb({}, 100, 0).length);
    expect(db.countEventsInDb({})).toBe(3);
  });

  it('stays off the map, where it would land on a county centroid', () => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summaries = db.getMapEvents({}, dayAgo).rows.map((e) => e.summary);
    expect(summaries.some((s) => s?.includes('presstalesperson'))).toBe(false);
  });

  // Filtered from the views, not removed from the database.
  it('is still in the table', () => {
    const stats = db.getStatsSummary();
    expect(stats.total).toBe(6);
  });
});
