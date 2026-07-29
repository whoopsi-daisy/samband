/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Search over the imported archive runs on an FTS5 index rather than a LIKE
// scan of every row. These cover what that changes: the body is searchable,
// Swedish compounds still match on a fragment, the index stays in step with
// what the importer writes, and a search box is not an expression language.

let tempDir: string;
let db: typeof import('@/lib/db');
let bpkDb: typeof import('@/lib/brottsplatskartanDb');

function archiveEvent(overrides: Partial<Parameters<typeof bpkDb.insertBpkEvents>[0][number]> & { id: number }) {
  return {
    pubdate: '2020-01-01T12:00:00.000Z',
    pubdateUnix: 1577880000,
    titleType: 'Bråk',
    titleLocation: 'Surahammar',
    headline: 'Samtal om bråk på bibliotek.',
    description: 'Samtal om bråk på bibliotek.',
    content: '<p>Personal på ett bibliotek kontaktar polisen med anledning av ett bråk.</p>',
    locationString: 'Surahammar, Västmanlands län',
    county: 'Västmanlands län',
    lat: 59.7,
    lng: 16.2,
    externalSourceLink: 'https://polisen.se/aktuellt/handelser/2020/januari/1/x/',
    permalink: 'https://brottsplatskartan.se/x',
    ...overrides,
  };
}

const search = (term: string) => db.getEventsFromDb({ search: term }, 20, 0);

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-fts-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
  bpkDb = await import('@/lib/brottsplatskartanDb');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  delete process.env.BPK_SEARCH_TOKENIZER;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('searching the archive', () => {
  it('finds an event by a word that only appears in its body', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({
        id: 1,
        headline: 'Trafikolycka i Ystad.',
        description: 'Trafikolycka i Ystad.',
        content: '<p>En personbil kolliderade med en älg på Djursdalavägen.</p>',
      }),
      archiveEvent({ id: 2 }),
    ]);

    // The old LIKE search only looked at headline, summary and location.
    const hits = search('Djursdalavägen');

    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(-1);
  });

  it('matches inside a Swedish compound, the way the old scan did', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 1, headline: 'Rån mot guldsmedsaffär i Ystad.' }),
      archiveEvent({ id: 2 }),
    ]);

    // A word-based index would return nothing here, which is the whole reason
    // this one is built on trigrams.
    expect(search('guldsmed').map((e) => e.id)).toEqual([-1]);
    expect(search('smedsaffär').map((e) => e.id)).toEqual([-1]);
    expect(search('guldsmedsaffär').map((e) => e.id)).toEqual([-1]);
  });

  it('searches headline, description and location too', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 1, headline: 'Inbrott i villa.', description: 'Ett inbrott i en villa.', titleLocation: 'Kiruna' }),
    ]);

    expect(search('villa')).toHaveLength(1);
    expect(search('Kiruna')).toHaveLength(1);
  });

  it('indexes what an import adds, without a rebuild', () => {
    bpkDb.insertBpkEvents([archiveEvent({ id: 1 })]);
    expect(search('cykelstöld')).toHaveLength(0);

    // A later import: the incremental sync that follows a dump, say.
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 2, headline: 'Cykelstöld i Lund.', content: '<p>En cykel har stulits.</p>' }),
    ]);

    expect(search('cykelstöld').map((e) => e.id)).toEqual([-2]);
  });

  it('does not index an event twice when an import re-serves it', () => {
    const event = archiveEvent({ id: 1, headline: 'Rån mot guldsmedsaffär i Ystad.' });

    bpkDb.insertBpkEvents([event]);
    // Page-based pagination over a live feed re-serves events it already gave.
    const second = bpkDb.insertBpkEvents([event]);

    expect(second.inserted).toBe(0);
    expect(search('guldsmedsaffär')).toHaveLength(1);
    expect(db.countEventsInDb({ search: 'guldsmedsaffär' })).toBe(1);
  });

  it('treats the search box as text, not as query syntax', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 1, headline: 'Bråk på "Stora torget" i Lund.' }),
      archiveEvent({ id: 2, headline: 'Polisen larmas OR något.' }),
    ]);

    // Each of these is an FTS5 syntax error as a bare query.
    expect(() => search('OR')).not.toThrow();
    expect(() => search('larmas OR')).not.toThrow();
    expect(() => search('12:30')).not.toThrow();
    expect(() => search('brå*')).not.toThrow();
    expect(() => search('"Stora torget"')).not.toThrow();

    // And they are matched literally.
    expect(search('"Stora torget"').map((e) => e.id)).toEqual([-1]);
    expect(search('larmas OR').map((e) => e.id)).toEqual([-2]);
  });

  it('still answers a one- or two-character search', () => {
    bpkDb.insertBpkEvents([archiveEvent({ id: 1, headline: 'Bråk på ön.' }), archiveEvent({ id: 2, headline: 'Brand i hus.' })]);

    // Too short for the trigram index; falls back to a scan rather than
    // returning nothing.
    expect(search('ön').map((e) => e.id)).toEqual([-1]);
  });

  it('counts the same events the feed returns', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 1, headline: 'Rån mot guldsmedsaffär i Ystad.' }),
      archiveEvent({ id: 2, headline: 'Rån mot kiosk i Ystad.' }),
      archiveEvent({ id: 3, headline: 'Brand i Lund.' }),
    ]);

    expect(db.countEventsInDb({ search: 'Ystad' })).toBe(2);
    expect(search('Ystad')).toHaveLength(2);
  });

  it('honours a filter alongside the search', () => {
    bpkDb.insertBpkEvents([
      archiveEvent({ id: 1, headline: 'Brand i Lund.', titleType: 'Brand', titleLocation: 'Lund' }),
      archiveEvent({ id: 2, headline: 'Brand i Kiruna.', titleType: 'Brand', titleLocation: 'Kiruna' }),
    ]);

    expect(db.getEventsFromDb({ search: 'Brand', location: 'Kiruna' }, 20, 0).map((e) => e.id)).toEqual([-2]);
  });
});

describe('the tokenizer setting', () => {
  it('rebuilds the index when it changes', async () => {
    bpkDb.insertBpkEvents([archiveEvent({ id: 1, headline: 'Rån mot guldsmedsaffär i Ystad.' })]);
    expect(search('guldsmed')).toHaveLength(1);

    // A word-based index is smaller, and cannot match inside a compound.
    process.env.BPK_SEARCH_TOKENIZER = 'unicode61';
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    db = await import('@/lib/db');

    expect(db.getEventsFromDb({ search: 'guldsmedsaffär' }, 20, 0)).toHaveLength(1);
    expect(db.getEventsFromDb({ search: 'guldsmed' }, 20, 0)).toHaveLength(0);
  });
});
