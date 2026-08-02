/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

// The long view: everything the page says about a decade rather than a week.
// db.ts resolves its path at module load, so the temp directory has to be set
// before the module is pulled in.
let tempDir: string;
let db: typeof import('@/lib/db');

const now = new Date();
const thisYear = now.getFullYear();

/** One event on a given UTC day. */
function event(id: number, day: string, type: string, place = 'Ljungby'): RawEvent {
  return {
    id,
    name: `${day}, ${type}, ${place}`,
    summary: `Notis om ${type}.`,
    url: `/e/${id}/`,
    type,
    datetime: `${day}T12:00:00.000Z`,
    location: { name: place, gps: '56.83,13.94' },
  };
}

/** n events on a day, cycling through the given types. */
function fill(startId: number, day: string, count: number, types: string[]): number {
  let id = startId;
  for (let i = 0; i < count; i++) {
    db.insertEvent(event(id, day, types[i % types.length]));
    id++;
  }
  return id;
}

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-long-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the year-by-month grid', () => {
  it('gives every year twelve cells, oldest first', () => {
    let id = 1;
    id = fill(id, `${thisYear - 2}-01-10`, 5, ['Stöld']);
    id = fill(id, `${thisYear - 1}-07-10`, 8, ['Stöld']);
    fill(id, `${thisYear}-01-10`, 3, ['Stöld']);
    db.invalidateAggregateCaches();

    const grid = db.getStatsSummary().monthGrid;
    expect(grid.map((row) => row.year)).toEqual([thisYear - 2, thisYear - 1, thisYear]);
    expect(grid[1].months).toHaveLength(12);
    expect(grid[1].months[6]).toBe(8); // July
    expect(grid[1].total).toBe(8);
  });

  // An archive that opens in March puts a row at the top of the grid that is
  // short for a reason that has nothing to do with how much happened, and it
  // is the row the eye lands on first.
  it('drops a first year the record does not cover from January', () => {
    let id = 1;
    id = fill(id, `${thisYear - 2}-08-10`, 5, ['Stöld']);
    id = fill(id, `${thisYear - 1}-07-10`, 8, ['Stöld']);
    fill(id, `${thisYear}-01-10`, 3, ['Stöld']);
    db.invalidateAggregateCaches();

    const grid = db.getStatsSummary().monthGrid;
    expect(grid.map((row) => row.year)).toEqual([thisYear - 1, thisYear]);
  });

  // The year in progress has the same shape at the other end, and stays: it is
  // the current one, and it is marked rather than hidden.
  it('keeps the running year even though it is short', () => {
    const id = fill(1, `${thisYear - 1}-01-10`, 4, ['Stöld']);
    fill(id, `${thisYear}-01-10`, 3, ['Stöld']);
    db.invalidateAggregateCaches();

    const grid = db.getStatsSummary().monthGrid;
    expect(grid[grid.length - 1].year).toBe(thisYear);
    expect(grid[grid.length - 1].running).toBe(true);
  });

  // Below twenty pixels a cell stops being readable, and a decade is already
  // more history than any question on this page reaches for.
  it('shows at most ten years', () => {
    let id = 1;
    for (let back = 14; back >= 0; back--) {
      id = fill(id, `${thisYear - back}-01-10`, 2, ['Stöld']);
    }
    db.invalidateAggregateCaches();

    const grid = db.getStatsSummary().monthGrid;
    expect(grid).toHaveLength(10);
    expect(grid[grid.length - 1].year).toBe(thisYear);
    expect(grid[0].year).toBe(thisYear - 9);
  });

  // An archive that starts in March has no January, and a zero there would
  // say the opposite: that the month was recorded and nothing happened.
  it('leaves months outside the record null rather than zero', () => {
    let id = 1;
    id = fill(id, `${thisYear - 1}-03-10`, 4, ['Stöld']);
    fill(id, `${thisYear - 1}-09-10`, 4, ['Stöld']);
    db.invalidateAggregateCaches();

    const [row] = db.getStatsSummary().monthGrid;
    expect(row.months[0]).toBeNull(); // January, before the first event
    expect(row.months[1]).toBeNull(); // February
    expect(row.months[2]).toBe(4); // March
    expect(row.months[3]).toBe(0); // April: recorded, and empty
    expect(row.months[11]).toBeNull(); // December, after the last
  });

  it('marks the year in progress', () => {
    fill(1, `${thisYear}-01-10`, 2, ['Stöld']);
    db.invalidateAggregateCaches();

    const grid = db.getStatsSummary().monthGrid;
    expect(grid[grid.length - 1].running).toBe(true);
  });

  it('is empty rather than undefined on a database with nothing in it', () => {
    expect(db.getStatsSummary().monthGrid).toEqual([]);
  });
});

describe('the season profile', () => {
  // Including the running year would pull every month after today toward zero
  // and invent a collapse in the autumn.
  it('averages only over years that finished', () => {
    let id = 1;
    for (const year of [thisYear - 2, thisYear - 1]) {
      id = fill(id, `${year}-01-10`, 2, ['Stöld']);
      id = fill(id, `${year}-07-10`, 10, ['Stöld']);
      id = fill(id, `${year}-12-10`, 2, ['Stöld']);
    }
    // A running year with a huge January, which must not move the average.
    fill(id, `${thisYear}-01-10`, 500, ['Stöld']);
    db.invalidateAggregateCaches();

    const { season } = db.getStatsSummary();
    expect(season.years).toBe(2);
    expect(season.average[0]).toBe(2); // January, not 168
    expect(season.average[6]).toBe(10); // July
    expect(season.busiestMonth).toBe(6);
  });

  // One year is a year, not a season.
  it('reports no season when only one year is complete', () => {
    const id = fill(1, `${thisYear - 1}-01-10`, 2, ['Stöld']);
    fill(id, `${thisYear}-01-10`, 2, ['Stöld']);
    db.invalidateAggregateCaches();

    const { season } = db.getStatsSummary();
    // The single complete year is still averaged, but the view only draws the
    // row from two years up.
    expect(season.years).toBeLessThanOrEqual(1);
  });
});

describe('this year against last', () => {
  // A running year is always short beside finished ones, which is exactly why
  // the year chart cannot answer "is it worse this year".
  it('cuts both years at the same day', () => {
    const monthDay = now.toISOString().slice(5, 10);
    let id = 1;
    id = fill(id, `${thisYear - 1}-01-02`, 10, ['Stöld']);
    // Last year, well after today's date: must not count.
    id = fill(id, `${thisYear - 1}-12-30`, 100, ['Stöld']);
    fill(id, `${thisYear}-01-02`, 15, ['Stöld']);
    db.invalidateAggregateCaches();

    const ytd = db.getStatsSummary().yearToDate;
    expect(ytd).not.toBeNull();
    expect(ytd!.count).toBe(15);
    expect(ytd!.previousCount).toBe(10);
    expect(ytd!.throughDay).toBe(monthDay);
  });

  // "+100 % mot i fjol" against a year with no data is noise dressed as a
  // finding.
  it('says nothing when there is no previous year to compare with', () => {
    fill(1, `${thisYear}-01-02`, 5, ['Stöld']);
    db.invalidateAggregateCaches();

    expect(db.getStatsSummary().yearToDate).toBeNull();
  });
});

describe('the type mix per year', () => {
  it('groups sixty type names into the families the app colours by', () => {
    let id = 1;
    id = fill(id, `${thisYear - 1}-05-10`, 6, ['Trafikolycka', 'Rattfylleri', 'Stöld']);
    fill(id, `${thisYear}-05-10`, 6, ['Stöld', 'Inbrott', 'Trafikolycka']);
    db.invalidateAggregateCaches();

    const mix = db.getStatsSummary().familyByYear;
    expect(mix.map((year) => year.year)).toEqual([String(thisYear - 1), String(thisYear)]);

    const families = mix[0].shares.map((share) => share.family);
    expect(families).toContain('traffic');
    expect(new Set(families).size).toBe(families.length);
    expect(mix[0].shares.reduce((sum, share) => sum + share.share, 0)).toBeCloseTo(1, 5);
  });

  // Ranked per year, the segments would swap places underneath the reader and
  // the drift the chart exists to show would be unreadable.
  it('keeps the families in the same order in every year', () => {
    let id = 1;
    // Traffic dominates the first year, theft the second.
    id = fill(id, `${thisYear - 1}-05-10`, 10, ['Trafikolycka']);
    id = fill(id, `${thisYear - 1}-05-11`, 2, ['Stöld']);
    id = fill(id, `${thisYear}-05-10`, 2, ['Trafikolycka']);
    fill(id, `${thisYear}-05-11`, 10, ['Stöld']);
    db.invalidateAggregateCaches();

    const mix = db.getStatsSummary().familyByYear;
    const first = mix[0].shares.map((s) => s.family);
    const second = mix[1].shares.map((s) => s.family);
    expect(second).toEqual(first);
  });

  it('says nothing with under two years to compare', () => {
    fill(1, `${thisYear}-05-10`, 4, ['Stöld']);
    db.invalidateAggregateCaches();

    expect(db.getStatsSummary().familyByYear).toEqual([]);
  });
});
