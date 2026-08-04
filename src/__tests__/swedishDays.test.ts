/**
 * @jest-environment node
 */
import {
  isSwedishDayKey,
  swedishDayStart,
  swedishDayEnd,
  swedishDayKey,
} from '@/lib/utils';

/**
 * Date filtering has to land on Swedish calendar days, not UTC ones.
 *
 * Every timestamp column is compared as text in UTC, so "2019-04-01" has to
 * become the instant Swedish midnight fell on that date: 23:00Z the evening
 * before in winter, 22:00Z in summer. Treating the date as UTC midnight would
 * shift every boundary by an hour or two, in an app whose entire job is
 * rendering Swedish local time correctly.
 */
describe('isSwedishDayKey', () => {
  it('accepts a real day', () => {
    expect(isSwedishDayKey('2026-07-27')).toBe(true);
    expect(isSwedishDayKey('2016-01-01')).toBe(true);
  });

  it('rejects anything that is not the shape', () => {
    for (const bad of ['', '2026-7-27', '27/07/2026', '2026-07-27T10:00', 'igår', '20260727']) {
      expect(isSwedishDayKey(bad)).toBe(false);
    }
  });

  // 2026-02-30 would otherwise be silently read as 2026-03-02.
  it('rejects a day that does not exist', () => {
    expect(isSwedishDayKey('2026-02-30')).toBe(false);
    expect(isSwedishDayKey('2026-13-01')).toBe(false);
    expect(isSwedishDayKey('2025-02-29')).toBe(false);
  });

  it('accepts a leap day in a leap year', () => {
    expect(isSwedishDayKey('2024-02-29')).toBe(true);
  });
});

describe('swedishDayStart', () => {
  it('is 23:00Z the evening before, in winter', () => {
    expect(swedishDayStart('2026-01-15')).toBe('2026-01-14T23:00:00.000Z');
  });

  it('is 22:00Z the evening before, in summer', () => {
    expect(swedishDayStart('2026-07-15')).toBe('2026-07-14T22:00:00.000Z');
  });

  it('returns null for a day that is not one', () => {
    expect(swedishDayStart('2026-02-30')).toBeNull();
    expect(swedishDayStart('nonsense')).toBeNull();
  });

  // The two days a year when an hour does not exist, or exists twice.
  it('lands correctly on the spring-forward day', () => {
    // Sweden springs forward on the last Sunday in March: 2026-03-29.
    expect(swedishDayStart('2026-03-29')).toBe('2026-03-28T23:00:00.000Z');
    // The day after is already on summer time.
    expect(swedishDayStart('2026-03-30')).toBe('2026-03-29T22:00:00.000Z');
  });

  it('lands correctly on the autumn fall-back day', () => {
    // Last Sunday in October: 2026-10-25.
    expect(swedishDayStart('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
    expect(swedishDayStart('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
  });

  // The property that actually matters: whatever instant comes back, the app's
  // own day-grouping must agree it falls on the day that was asked for.
  it('round-trips through swedishDayKey', () => {
    const days = [
      '2016-01-01', '2019-04-01', '2026-03-29', '2026-03-30',
      '2026-10-25', '2026-10-26', '2026-07-15', '2024-02-29',
    ];
    for (const day of days) {
      expect(swedishDayKey(new Date(swedishDayStart(day)!))).toBe(day);
    }
  });
});

describe('swedishDayEnd', () => {
  it('is the last millisecond of the day, not the start of it', () => {
    expect(swedishDayEnd('2026-07-15')).toBe('2026-07-15T21:59:59.999Z');
    expect(swedishDayEnd('2026-01-15')).toBe('2026-01-15T22:59:59.999Z');
  });

  it('ends the same day it starts', () => {
    const days = ['2016-01-01', '2026-03-29', '2026-10-25', '2026-07-15'];
    for (const day of days) {
      expect(swedishDayKey(new Date(swedishDayEnd(day)!))).toBe(day);
    }
  });

  it('is inclusive: an event at 23:59 local is inside the day', () => {
    const end = swedishDayEnd('2026-07-15')!;
    const lateEvent = new Date('2026-07-15T23:59:00+02:00').toISOString();
    expect(lateEvent <= end).toBe(true);
  });

  it('excludes the first moment of the next day', () => {
    const end = swedishDayEnd('2026-07-15')!;
    const nextDay = swedishDayStart('2026-07-16')!;
    expect(end < nextDay).toBe(true);
  });

  // A DST day is 23 or 25 hours long, so this cannot just add 24 hours.
  it('handles the short day and the long day', () => {
    const shortDay = Date.parse(swedishDayEnd('2026-03-29')!) - Date.parse(swedishDayStart('2026-03-29')!);
    const longDay = Date.parse(swedishDayEnd('2026-10-25')!) - Date.parse(swedishDayStart('2026-10-25')!);

    expect(Math.round(shortDay / 3_600_000)).toBe(23);
    expect(Math.round(longDay / 3_600_000)).toBe(25);
  });

  it('returns null for a day that is not one', () => {
    expect(swedishDayEnd('2026-02-30')).toBeNull();
  });

  it('crosses a month and a year boundary', () => {
    expect(swedishDayKey(new Date(swedishDayEnd('2026-01-31')!))).toBe('2026-01-31');
    expect(swedishDayKey(new Date(swedishDayEnd('2026-12-31')!))).toBe('2026-12-31');
  });
});
