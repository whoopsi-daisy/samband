/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

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
  // All twenty-one would be simpler and would offer dead ends: a select whose
  // options return nothing is a select that lies about what is there.
  it('lists only counties that have notices', () => {
    notice('Skåne län', 'Malmö');
    notice('Nationellt', 'Ljungby');

    expect(db.getCountiesWithEvents()).toEqual(['Kronobergs län', 'Skåne län']);
  });

  it('sorts them the way a Swedish reader expects', () => {
    notice('Örebro län', 'Örebro');
    notice('Skåne län', 'Malmö');
    notice('Ångermanland' /* not a county */, 'Sundsvall');

    // Ö sorts last in Swedish, not with O.
    expect(db.getCountiesWithEvents()).toEqual([
      'Skåne län',
      'Västernorrlands län',
      'Örebro län',
    ]);
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
