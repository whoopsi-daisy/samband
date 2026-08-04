/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';
import { resolveDateRange, swedishDayStart, swedishDayEnd } from '@/lib/utils';

let tempDir: string;
let db: typeof import('@/lib/db');

/** A notice at noon Swedish time on a given day, which no boundary can clip. */
const onDay = (id: number, day: string): RawEvent => ({
  id,
  name: `x, Trafikolycka, Ljungby`,
  summary: 'Sammandrag.',
  url: `/e/${id}/`,
  type: 'Trafikolycka',
  datetime: `${day}T12:00:00+02:00`,
  location: { name: 'Kronobergs län', gps: '56.83,13.94' },
});

const idsIn = (filters: Parameters<typeof db.getEventsFromDb>[0]) =>
  db.getEventsFromDb(filters, 500, 0).map((e) => e.id).sort((a, b) => a - b);

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-dates-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');

  db.insertEvents([
    onDay(1, '2019-04-01'),
    onDay(2, '2019-04-15'),
    onDay(3, '2019-04-30'),
    onDay(4, '2019-05-01'),
    onDay(5, '2026-07-15'),
  ]);
  db.invalidateAggregateCaches();
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * The archive reaches back to 2016 and the feed pages newest-first, so until
 * this existed the only way to reach a particular week was to guess a word that
 * appears in it — while the list itself told readers to filter to reach it and
 * pointed at a control that was not there.
 */
describe('filtering the feed by date', () => {
  it('returns everything when neither end is set', () => {
    expect(idsIn({})).toEqual([1, 2, 3, 4, 5]);
  });

  it('takes a lower bound', () => {
    const range = resolveDateRange('2019-05-01', '');
    expect(idsIn({ since: range.since })).toEqual([4, 5]);
  });

  it('takes an upper bound', () => {
    const range = resolveDateRange('', '2019-04-15');
    expect(idsIn({ until: range.until })).toEqual([1, 2]);
  });

  it('takes both, and includes the days at each end', () => {
    const range = resolveDateRange('2019-04-01', '2019-04-30');
    expect(idsIn({ since: range.since, until: range.until })).toEqual([1, 2, 3]);
  });

  it('narrows to a single day', () => {
    const range = resolveDateRange('2019-04-15', '2019-04-15');
    expect(idsIn({ since: range.since, until: range.until })).toEqual([2]);
  });

  it('returns nothing for a range with nothing in it', () => {
    const range = resolveDateRange('2020-01-01', '2020-12-31');
    expect(idsIn({ since: range.since, until: range.until })).toEqual([]);
  });

  it('counts the same rows it returns', () => {
    const range = resolveDateRange('2019-04-01', '2019-04-30');
    const filters = { since: range.since, until: range.until };

    // The feed is paged off one query and sized off another; if they disagreed
    // the last page would promise rows that never arrive.
    expect(db.countEventsInDb(filters)).toBe(idsIn(filters).length);
  });

  it('combines with the other filters rather than replacing them', () => {
    const range = resolveDateRange('2019-04-01', '2019-04-30');

    expect(idsIn({ since: range.since, until: range.until, type: 'Trafikolycka' })).toEqual([1, 2, 3]);
    expect(idsIn({ since: range.since, until: range.until, type: 'Rån' })).toEqual([]);
  });
});

describe('resolveDateRange', () => {
  it('drops a date it cannot read rather than guessing', () => {
    expect(resolveDateRange('igår', '')).toEqual({ from: '', to: '', since: undefined, until: undefined });
    expect(resolveDateRange('2019-02-30', '').from).toBe('');
    expect(resolveDateRange('01/04/2019', '').from).toBe('');
  });

  // Someone who typed them this way meant the span between them either way,
  // and an empty feed would be a worse answer than the obvious one.
  it('swaps a range typed backwards', () => {
    const range = resolveDateRange('2019-04-30', '2019-04-01');

    expect(range.from).toBe('2019-04-01');
    expect(range.to).toBe('2019-04-30');
    expect(range.since).toBe(swedishDayStart('2019-04-01'));
    expect(range.until).toBe(swedishDayEnd('2019-04-30'));
  });

  it('leaves a single-day range alone', () => {
    const range = resolveDateRange('2019-04-15', '2019-04-15');
    expect([range.from, range.to]).toEqual(['2019-04-15', '2019-04-15']);
  });

  it('gives back the days as typed, for the controls to show', () => {
    const range = resolveDateRange('2019-04-01', '2019-04-30');
    expect([range.from, range.to]).toEqual(['2019-04-01', '2019-04-30']);
  });

  it('keeps one end when the other is unusable', () => {
    const range = resolveDateRange('2019-04-01', 'nonsense');

    expect(range.from).toBe('2019-04-01');
    expect(range.to).toBe('');
    expect(range.since).toBeDefined();
    expect(range.until).toBeUndefined();
  });
});
