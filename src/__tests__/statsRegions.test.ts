/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

// db.ts resolves its path at module load, so the temp directory has to be set
// before the module is pulled in.
let tempDir: string;
let db: typeof import('@/lib/db');

const now = new Date();

/** The first of a month, n months back from the one we are standing in. */
function monthsAgo(n: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 15));
}

let nextId = 1;

function add(place: string, when: Date, type = 'Stöld'): void {
  const day = when.toISOString().slice(0, 10);
  const raw: RawEvent = {
    id: nextId++,
    name: `${day}, ${type}, ${place}`,
    summary: `Notis om ${type}.`,
    url: `/e/${nextId}/`,
    type,
    datetime: `${day}T12:00:00.000Z`,
    location: { name: place, gps: '56.83,13.94' },
  };
  db.insertEvent(raw);
}

/** n notices from one place, all in the same month. */
function fill(place: string, month: number, count: number): void {
  for (let i = 0; i < count; i++) add(place, monthsAgo(month));
}

beforeEach(async () => {
  jest.resetModules();
  nextId = 1;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-regions-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the country by county', () => {
  // The feed names places at four different levels, so counted as they arrive
  // the record is a list of municipalities, counties and districts that shares
  // no denominator and describes nowhere.
  it('folds municipalities and counties into the same twenty-one buckets', () => {
    fill('Ljungby', 3, 5);
    fill('Växjö', 3, 3);
    fill('Kronobergs län', 3, 2);
    fill('Malmö', 3, 4);
    db.invalidateAggregateCaches();

    const { rows } = db.getStatsSummary().regions;
    const byCounty = new Map(rows.map((row) => [row.county, row.total]));

    expect(byCounty.get('Kronobergs län')).toBe(10);
    expect(byCounty.get('Skåne län')).toBe(4);
  });

  it('ranks the counties by size', () => {
    fill('Ljungby', 3, 2);
    fill('Malmö', 3, 9);
    fill('Umeå', 3, 5);
    db.invalidateAggregateCaches();

    expect(db.getStatsSummary().regions.rows.map((row) => row.county)).toEqual([
      'Skåne län',
      'Västerbottens län',
      'Kronobergs län',
    ]);
  });

  // A notice filed nationally happened in no county. Dropping it silently would
  // inflate every share on the page, so it is counted and reported.
  it('counts what it could not place rather than hiding it', () => {
    fill('Ljungby', 3, 6);
    fill('Nationellt', 3, 4);
    db.invalidateAggregateCaches();

    const regions = db.getStatsSummary().regions;
    expect(regions.placed).toBe(6);
    expect(regions.unplaced).toBe(4);
    expect(regions.rows[0].share).toBeCloseTo(1);
  });

  it('shares add up over the counties it could place', () => {
    fill('Ljungby', 3, 6);
    fill('Malmö', 3, 2);
    fill('Nationellt', 3, 92);
    db.invalidateAggregateCaches();

    const { rows } = db.getStatsSummary().regions;
    const sum = rows.reduce((total, row) => total + row.share, 0);
    expect(sum).toBeCloseTo(1);
  });
});

describe('which way a county is going', () => {
  // Two windows of twelve whole months. The month we are standing in belongs to
  // neither: it is however many days in we happen to be, and counting it makes
  // every county look like it is falling.
  it('compares the last twelve complete months with the twelve before', () => {
    for (let m = 1; m <= 12; m++) fill('Ljungby', m, 20); // recent: 240
    for (let m = 13; m <= 24; m++) fill('Ljungby', m, 10); // previous: 120
    fill('Ljungby', 0, 500); // the running month, which counts in neither
    db.invalidateAggregateCaches();

    const [row] = db.getStatsSummary().regions.rows;
    expect(row.recent).toBe(240);
    expect(row.previous).toBe(120);
    expect(row.change).toBeCloseTo(1);
  });

  // A county with nine notices last year swings by hundreds of percent on a
  // difference of three, which reads as a finding and is noise.
  it('withholds a percentage the earlier window is too thin to support', () => {
    for (let m = 13; m <= 24; m++) fill('Ljungby', m, 20); // 240, over the floor
    for (let m = 1; m <= 12; m++) fill('Ljungby', m, 5);
    for (let m = 13; m <= 24; m++) fill('Malmö', m, 1); // 12, under it
    for (let m = 1; m <= 12; m++) fill('Malmö', m, 10);
    db.invalidateAggregateCaches();

    const byCounty = new Map(
      db.getStatsSummary().regions.rows.map((row) => [row.county, row.change])
    );
    expect(byCounty.get('Kronobergs län')).toBeCloseTo(-0.75);
    expect(byCounty.get('Skåne län')).toBeNull();
  });

  // A database a few weeks old has no earlier window at all, and a page that
  // claimed one would be comparing this year against nothing.
  it('claims no comparison window when there is nothing to compare', () => {
    fill('Ljungby', 1, 40);
    db.invalidateAggregateCaches();

    const regions = db.getStatsSummary().regions;
    expect(regions.trendFrom).toBeNull();
    expect(regions.rows.every((row) => row.change === null)).toBe(true);
  });
});
