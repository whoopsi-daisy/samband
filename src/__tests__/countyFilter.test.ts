/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';
import { COUNTIES } from '@/lib/regions';

let tempDir: string;
let db: typeof import('@/lib/db');

/**
 * The county as a column.
 *
 * It was derived in JavaScript from whatever the location field happened to
 * say, which made the regional breakdown possible and a county filter
 * impossible: the feed matches the place string an officer typed, and no notice
 * is labelled "Skåne län" unless somebody wrote exactly that. Clicking a county
 * would have returned a fraction of what the same page had just counted.
 */
const MONTHS = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];

let nextId = 1;

/** A notice whose location field is a county and whose title names a town. */
function notice(county: string, town: string, type = 'Stöld'): void {
  const at = new Date(Date.now() - nextId * 60_000);
  const stamp =
    `${at.getDate()} ${MONTHS[at.getMonth()]} ` +
    `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  db.insertEvent({
    id: nextId++,
    name: `${stamp}, ${type}, ${town}`,
    summary: `Notis ${nextId}.`,
    url: `/e/${nextId}/`,
    type,
    datetime: at.toISOString(),
    location: { name: county, gps: '59.33,18.06' },
  } as RawEvent);
  db.invalidateAggregateCaches();
}

beforeEach(async () => {
  jest.resetModules();
  nextId = 1;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-county-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('resolving a county at write time', () => {
  it('takes it from the location field when that is a county', () => {
    notice('Skåne län', 'Malmö');

    const [row] = db.getDatabase().prepare('SELECT county FROM events').all() as Array<{ county: string }>;
    expect(row.county).toBe('Skåne län');
  });

  // The whole reason the map moved off county centroids: the location field is
  // a county and the municipality is only in the title.
  it('falls back to the municipality in the title', () => {
    // "Nationellt" resolves to nothing, so the title has to carry it.
    notice('Nationellt', 'Ljungby');

    const [row] = db.getDatabase().prepare('SELECT county FROM events').all() as Array<{ county: string }>;
    expect(row.county).toBe('Kronobergs län');
  });

  it('leaves it null rather than guessing', () => {
    notice('Nationellt', 'Hela landet');

    const [row] = db.getDatabase().prepare('SELECT county FROM events').all() as Array<{ county: string | null }>;
    expect(row.county).toBeNull();
  });
});

describe('filtering by county', () => {
  const seedCountry = () => {
    notice('Skåne län', 'Malmö');
    notice('Skåne län', 'Lund');
    notice('Stockholms län', 'Stockholm');
    notice('Nationellt', 'Ljungby'); // Kronoberg, via the title
    notice('Nationellt', 'Hela landet'); // no county at all
  };

  it('returns exactly the notices in that county', () => {
    seedCountry();

    expect(db.countEventsInDb({ county: 'Skåne län' })).toBe(2);
    expect(db.countEventsInDb({ county: 'Kronobergs län' })).toBe(1);
    expect(db.countEventsInDb({})).toBe(5);
  });

  // The point of the whole change: what the statistics counted for a county is
  // what the feed returns when you click it.
  it('agrees with what the regional breakdown counted', () => {
    seedCountry();

    const skane = db.getStatsSummary().regions.rows.find((row) => row.county === 'Skåne län');
    expect(skane?.total).toBe(db.countEventsInDb({ county: 'Skåne län' }));
  });

  it('combines with the other filters rather than replacing them', () => {
    notice('Skåne län', 'Malmö', 'Stöld');
    notice('Skåne län', 'Malmö', 'Brand');
    notice('Stockholms län', 'Stockholm', 'Stöld');

    expect(db.countEventsInDb({ county: 'Skåne län', type: 'Stöld' })).toBe(1);
  });

  it('narrows the map as well as the feed', () => {
    seedCountry();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    expect(db.getMapEvents({ county: 'Skåne län' }, since).rows).toHaveLength(2);
    expect(db.getMapEvents({}, since).rows).toHaveLength(5);
  });
});

describe('what the filter offers', () => {
  /*
   * All twenty-one, from the constant, not from the data.
   *
   * The place dropdown beside it is derived from the database because there is
   * no canonical list of place names — the feed invents them. Counties are a
   * fixed administrative taxonomy, so asking the database which ones exist
   * costs a scan to return, every time, the list we already had.
   */
  it('is the full set of counties, in Swedish order', () => {
    expect(COUNTIES).toHaveLength(21);
    expect(COUNTIES[0]).toBe('Blekinge län');
    // Ö sorts after Z in Swedish, so Östergötland is last and not near O.
    expect(COUNTIES[COUNTIES.length - 1]).toBe('Östergötlands län');
    expect([...COUNTIES]).toEqual([...COUNTIES].sort((a, b) => a.localeCompare(b, 'sv')));
  });

  // Picking one with nothing in it is a dead end the empty state already
  // handles, and a far smaller surprise than a list that changes size as the
  // feed fills up.
  it('leaves a county with no notices selectable, and answering honestly', () => {
    notice('Skåne län', 'Malmö');

    expect(COUNTIES).toContain('Jämtlands län');
    expect(db.countEventsInDb({ county: 'Jämtlands län' })).toBe(0);
  });
});

/*
 * The county breakdown, per type.
 *
 * Counted off the county column in SQL rather than folded out of the place
 * names in JavaScript, so what the filtered map shows for a county is what
 * clicking that county returns from the feed.
 */
describe('the per-type county cube', () => {
  const seed = (county: string, town: string, type: string, times: number) => {
    for (let i = 0; i < times; i++) notice(county, town, type);
  };

  // Enough of a type to clear TYPE_MAP_MIN_TOTAL, split across two counties so
  // the breakdown has something to break down.
  const seedMappableType = (type: string, skane: number, stockholm: number) => {
    seed('Skåne län', 'Malmö', type, skane);
    seed('Stockholms län', 'Stockholm', type, stockholm);
  };

  it('splits each county by type', () => {
    seedMappableType('Stöld', 120, 90);
    seedMappableType('Brand', 60, 150);

    const { cells } = db.getStatsSummary().regionTypes;
    expect(cells['Skåne län']['Stöld'][0]).toBe(120);
    expect(cells['Skåne län']['Brand'][0]).toBe(60);
    expect(cells['Stockholms län']['Stöld'][0]).toBe(90);
    expect(cells['Stockholms län']['Brand'][0]).toBe(150);
  });

  // The one invariant that ties the block together: the filtered map and the
  // unfiltered one must be counting the same rows.
  it('sums back to what the unfiltered breakdown counted', () => {
    seedMappableType('Stöld', 120, 90);
    seedMappableType('Brand', 60, 150);

    const stats = db.getStatsSummary();
    expect(stats.regions.rows.length).toBeGreaterThan(1);
    for (const row of stats.regions.rows) {
      const byType = stats.regionTypes.cells[row.county] ?? {};
      const summed = Object.values(byType).reduce((total, cell) => total + cell[0], 0);
      expect(summed).toBe(row.total);
    }
  });

  it('keeps notices with no county out of the cells and in unplaced', () => {
    seedMappableType('Stöld', 120, 90);
    seed('Nationellt', 'Hela landet', 'Stöld', 30);

    const { cells, unplaced } = db.getStatsSummary().regionTypes;
    expect(cells['Skåne län']['Stöld'][0]).toBe(120);
    expect(cells['Stockholms län']['Stöld'][0]).toBe(90);
    expect(unplaced['Stöld']).toBe(30);
  });

  it('leaves a county with none of a type out of that type entirely', () => {
    seedMappableType('Stöld', 120, 90);
    seed('Skåne län', 'Lund', 'Brand', 210);

    const { cells } = db.getStatsSummary().regionTypes;
    expect(cells['Skåne län']['Brand'][0]).toBe(210);
    expect(cells['Stockholms län']['Brand']).toBeUndefined();
  });

  /*
   * Spread over twenty-one counties, a type with a handful of notices is single
   * digits per county, and a choropleth of single digits is four shades of
   * noise with Stockholm on top because Stockholm is where the people are.
   * Offering it in the filter is offering a finding that is not there.
   */
  it('offers no type too thin to shade a map with', () => {
    seedMappableType('Stöld', 120, 90);
    seed('Skåne län', 'Lund', 'Brand', db.TYPE_MAP_MIN_TOTAL - 1);

    const { types } = db.getStatsSummary().regionTypes;
    expect(types).toContain('Stöld');
    expect(types).not.toContain('Brand');
  });
});

describe('how much of the record could be placed', () => {
  // Previously derivable only by folding the whole location breakdown in
  // JavaScript, which is why the number lived in a caption and nowhere an
  // operator could read it.
  it('counts placed against unplaced', () => {
    notice('Skåne län', 'Malmö');
    notice('Stockholms län', 'Stockholm');
    notice('Nationellt', 'Hela landet');

    expect(db.getCountyCoverage()).toEqual({ placed: 2, unplaced: 1 });
  });
});
