/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

// The imported archive is part of the dataset the app queries: the feed, the
// search, the filter dropdowns and the statistics all read it alongside the
// live polisen.se feed. These cover that seam — including the rule that keeps
// the two sources from counting the same period twice.

let tempDir: string;
let db: typeof import('@/lib/db');
let bpkDb: typeof import('@/lib/brottsplatskartanDb');

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

function archiveEvent(overrides: Partial<Parameters<typeof bpkDb.insertBpkEvents>[0][number]> & { id: number }) {
  return {
    pubdate: '2020-01-01T12:00:00.000Z',
    pubdateUnix: Math.floor(new Date('2020-01-01T12:00:00.000Z').getTime() / 1000),
    titleType: 'Trafikolycka',
    titleLocation: 'Hörby',
    headline: `Arkiverad händelse ${overrides.id}`,
    description: 'Beskrivning från arkivet',
    content: '<p>Innehåll</p>',
    locationString: 'Hörby, Skåne län',
    county: 'Skåne län',
    lat: 55.85,
    lng: 13.66,
    externalSourceLink: 'https://polisen.se/aktuellt/handelser/2020/januari/1/gammal-handelse/',
    permalink: 'https://brottsplatskartan.se/skane-lan/x',
    ...overrides,
  };
}

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-arch-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
  bpkDb = await import('@/lib/brottsplatskartanDb');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('the feed with an imported archive', () => {
  it('serves live and archived events as one timeline, newest first', () => {
    db.insertEvent(makeEvent({ id: 1, datetime: '2026-07-27T12:00:00.000Z' }));
    db.insertEvent(makeEvent({ id: 2, datetime: '2026-07-26T12:00:00.000Z' }));
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, pubdate: '2019-05-05T08:00:00.000Z' }),
      archiveEvent({ id: 11, pubdate: '2021-05-05T08:00:00.000Z' }),
    ]);

    const feed = db.getEventsFromDb({}, 10, 0);

    expect(feed.map((e) => e.event_time)).toEqual([
      '2026-07-27T12:00:00.000Z',
      '2026-07-26T12:00:00.000Z',
      '2021-05-05T08:00:00.000Z',
      '2019-05-05T08:00:00.000Z',
    ]);
    expect(db.countEventsInDb()).toBe(4);
  });

  it('paginates across the two sources without gaps or repeats', () => {
    db.insertEvent(makeEvent({ id: 1, datetime: '2026-07-27T12:00:00.000Z' }));
    bpkDb.insertBpkEvents(
      [1, 2, 3, 4].map((n) => archiveEvent({ id: n, pubdate: `2021-05-0${n}T08:00:00.000Z` }))
    );

    const pages = [0, 2, 4].map((offset) => db.getEventsFromDb({}, 2, offset).map((e) => e.event_time));

    expect(pages[0]).toEqual(['2026-07-27T12:00:00.000Z', '2021-05-04T08:00:00.000Z']);
    expect(pages[1]).toEqual(['2021-05-03T08:00:00.000Z', '2021-05-02T08:00:00.000Z']);
    expect(pages[2]).toEqual(['2021-05-01T08:00:00.000Z']);
    expect(new Set(pages.flat()).size).toBe(5);
  });

  it('projects archived rows into the shape the UI renders', () => {
    bpkDb.insertBpkEvents([archiveEvent({ id: 7 })]);

    const [event] = db.getEventsFromDb({}, 10, 0);

    expect(event).toMatchObject({
      // Negative, because both sources number their events from 1.
      id: -7,
      name: 'Arkiverad händelse 7',
      summary: 'Beskrivning från arkivet',
      type: 'Trafikolycka',
      // The path under polisen.se, which is what the detail fetch and the
      // "read more" link expect.
      url: '/aktuellt/handelser/2020/januari/1/gammal-handelse/',
      location: { name: 'Hörby', gps: '55.85,13.66' },
      was_updated: false,
    });
  });

  it('leaves an archive-free database on the single-table path', () => {
    db.insertEvent(makeEvent({ id: 1 }));

    expect(db.hasArchiveEvents()).toBe(false);
    expect(db.getEventsFromDb({}, 10, 0)).toHaveLength(1);
    expect(db.getArchiveCoverage()).toEqual({ events: 0, cutoff: null });
  });
});

describe('the overlap between the sources', () => {
  // Brottsplatskartan republishes polisen.se, so any period the live feed
  // covers exists in both tables. The live feed wins from its oldest event
  // forward; the archive supplies everything before it.
  it('counts a period the live feed covers only once', () => {
    db.insertEvent(makeEvent({ id: 1, datetime: '2026-07-20T12:00:00.000Z' }));
    db.insertEvent(makeEvent({ id: 2, datetime: '2026-07-27T12:00:00.000Z' }));

    bpkDb.insertBpkEvents([
      // Inside the live window — the live feed already has this period.
      archiveEvent({ id: 10, pubdate: '2026-07-25T12:00:00.000Z' }),
      // Before it — nothing else has this.
      archiveEvent({ id: 11, pubdate: '2026-07-19T12:00:00.000Z' }),
    ]);

    const feed = db.getEventsFromDb({}, 10, 0);
    expect(feed.map((e) => e.id)).toEqual([2, 1, -11]);
    expect(db.countEventsInDb()).toBe(3);

    const coverage = db.getArchiveCoverage();
    expect(coverage).toEqual({ events: 1, cutoff: '2026-07-20T12:00:00.000Z' });
  });

  it('uses the whole archive when the live feed is empty', () => {
    bpkDb.insertBpkEvents([archiveEvent({ id: 1 }), archiveEvent({ id: 2, pubdate: '2024-02-02T09:00:00.000Z' })]);

    expect(db.getEventsFromDb({}, 10, 0)).toHaveLength(2);
    expect(db.getArchiveCoverage()).toEqual({ events: 2, cutoff: null });
  });
});

describe('historical search', () => {
  it('finds an archived incident by headline, long after it was published', () => {
    db.insertEvent(makeEvent({ id: 1, name: 'Färsk händelse', datetime: '2026-07-27T12:00:00.000Z' }));
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, pubdate: '2018-03-04T22:10:00.000Z', headline: 'Rån mot guldsmed i Ystad' }),
      archiveEvent({ id: 11, pubdate: '2018-03-05T22:10:00.000Z', headline: 'Trafikolycka på E22' }),
    ]);

    const hits = db.getEventsFromDb({ search: 'guldsmed' }, 10, 0);

    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Rån mot guldsmed i Ystad');
    expect(db.countEventsInDb({ search: 'guldsmed' })).toBe(1);
  });

  it('searches the archive summary and location as well', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, description: 'Inbrott i villa', titleLocation: 'Lund' }),
      archiveEvent({ id: 11, description: 'Något annat', titleLocation: 'Kiruna' }),
    ]);

    expect(db.getEventsFromDb({ search: 'villa' }, 10, 0)).toHaveLength(1);
    expect(db.getEventsFromDb({ search: 'Kiruna' }, 10, 0)).toHaveLength(1);
  });

  it('filters archived events by type and location', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, titleType: 'Brand', titleLocation: 'Lund' }),
      archiveEvent({ id: 11, titleType: 'Trafikolycka', titleLocation: 'Lund' }),
      archiveEvent({ id: 12, titleType: 'Brand', titleLocation: 'Kiruna' }),
    ]);

    expect(db.getEventsFromDb({ type: 'Brand' }, 10, 0)).toHaveLength(2);
    expect(db.getEventsFromDb({ location: 'Lund' }, 10, 0)).toHaveLength(2);
    expect(db.countEventsInDb({ type: 'Brand', location: 'Kiruna' })).toBe(1);
  });

  it('offers archived types and locations in the filter dropdowns', () => {
    db.insertEvent(makeEvent({ id: 1, type: 'Brand', location: { name: 'Malmö', gps: '' } }));
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, titleType: 'Rattfylleri', titleLocation: 'Kiruna' }),
      // Also in the live feed — must not appear twice.
      archiveEvent({ id: 11, titleType: 'Brand', titleLocation: 'Malmö' }),
    ]);

    expect(db.getFilterOptions('type')).toEqual(['Brand', 'Rattfylleri']);
    expect(db.getFilterOptions('location_name')).toEqual(['Kiruna', 'Malmö']);
  });
});

describe('statistics over the whole dataset', () => {
  it('counts both sources and reports what the archive contributes', () => {
    db.insertEvent(makeEvent({ id: 1, type: 'Brand', datetime: '2026-07-27T12:00:00.000Z' }));
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, titleType: 'Brand', pubdate: '2019-01-01T10:00:00.000Z' }),
      archiveEvent({ id: 11, titleType: 'Rattfylleri', pubdate: '2019-01-02T10:00:00.000Z' }),
      archiveEvent({ id: 12, titleType: 'Rattfylleri', pubdate: '2019-01-03T10:00:00.000Z' }),
    ]);

    const stats = db.getStatsSummary();

    expect(stats.total).toBe(4);
    expect(stats.totalStored).toBe(4);
    expect(stats.archiveEvents).toBe(3);
    expect(stats.archiveCutoff).toBe('2026-07-27T12:00:00.000Z');
    expect(stats.oldestEvent).toBe('2019-01-01T10:00:00.000Z');

    // Types are merged across the sources, not listed twice. Equal counts fall
    // back to alphabetical order so the list is stable between requests.
    expect(stats.topTypes).toEqual([
      { label: 'Brand', total: 2 },
      { label: 'Rattfylleri', total: 2 },
    ]);
    expect(stats.uniqueTypes).toBe(2);
    // Malmö from the live feed, Hörby from the archive.
    expect(stats.uniqueLocations).toBe(2);
  });

  it('counts archived events from the weeks just before the cutoff', () => {
    // Everything here sits between "30 days ago" and the live feed's oldest
    // event — the range where a mis-bound window silently drops archive rows
    // from the totals while older years still look right.
    const now = Date.now();
    const daysAgo = (days: number): string => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

    // Six days, not seven: the seven-day window is measured from now, a few
    // milliseconds after this timestamp is taken.
    db.insertEvent(makeEvent({ id: 1, datetime: daysAgo(6) }));
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, pubdate: daysAgo(10) }),
      archiveEvent({ id: 11, pubdate: daysAgo(20) }),
      archiveEvent({ id: 12, pubdate: daysAgo(200) }),
    ]);

    const stats = db.getStatsSummary();

    expect(stats.total).toBe(4);
    expect(stats.archiveEvents).toBe(3);
    // The 10- and 20-day-old archive rows land inside the 30-day window.
    expect(stats.last30d).toBe(3);
    expect(stats.last7d).toBe(1);
    expect(db.getEventsFromDb({}, 10, 0)).toHaveLength(4);
  });

  it('keeps recent windows on the live feed, since the archive stops at the cutoff', () => {
    const now = Date.now();
    db.insertEvent(makeEvent({ id: 1, datetime: new Date(now - 60 * 60 * 1000).toISOString() }));
    bpkDb.insertBpkEvents([archiveEvent({ id: 10, pubdate: '2019-01-01T10:00:00.000Z' })]);

    const stats = db.getStatsSummary();

    expect(stats.last24h).toBe(1);
    expect(stats.total).toBe(2);
  });

  it('reflects an archive that arrives after the first statistics call', () => {
    db.insertEvent(makeEvent({ id: 1, datetime: '2026-07-27T12:00:00.000Z' }));
    expect(db.getStatsSummary().total).toBe(1);

    bpkDb.insertBpkEvents([archiveEvent({ id: 10, pubdate: '2019-01-01T10:00:00.000Z' })]);
    // Aggregates are cached; an import drops them (see the runner) — without
    // that, the app would show yesterday's picture for up to a minute.
    db.invalidateAggregateCaches();

    expect(db.getStatsSummary().total).toBe(2);
    expect(db.getStatsSummary().archiveEvents).toBe(1);
  });

  it('excludes summary posts from both sources, as it always has for the live feed', () => {
    db.insertEvent(makeEvent({ id: 1, type: 'Sammanfattning natt', datetime: '2026-07-27T12:00:00.000Z' }));
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 10, titleType: 'Sammanfattning kväll', pubdate: '2019-01-01T10:00:00.000Z' }),
      archiveEvent({ id: 11, titleType: 'Brand', pubdate: '2019-01-02T10:00:00.000Z' }),
    ]);

    const stats = db.getStatsSummary();

    // Still stored and still in the feed — only the breakdowns skip them.
    expect(stats.totalStored).toBe(3);
    expect(stats.topTypes).toEqual([{ label: 'Brand', total: 1 }]);
  });
});
