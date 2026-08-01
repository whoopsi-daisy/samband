import { formatRelativeTime, formatShortRelativeTime, sanitizeInput, sanitizeLocation, sanitizeType, sanitizeSearch, swedishDayKey } from '@/lib/utils';

describe('formatRelativeTime', () => {
  const baseDate = new Date('2024-01-15T12:00:00Z');

  it('returns "Just nu" for less than 60 seconds', () => {
    const date = new Date(baseDate.getTime() - 30 * 1000);
    expect(formatRelativeTime(date, baseDate)).toBe('Just nu');
  });

  it('returns minutes for less than 60 minutes', () => {
    const date = new Date(baseDate.getTime() - 5 * 60 * 1000);
    expect(formatRelativeTime(date, baseDate)).toBe('5 min sedan');
  });

  it('returns hours for less than 24 hours', () => {
    const date = new Date(baseDate.getTime() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseDate)).toBe('3 timmar sedan');
  });

  it('returns days for more than 24 hours', () => {
    const date = new Date(baseDate.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, baseDate)).toBe('2 dagar sedan');
  });

  // The archive reaches back to 2016. Counted in days that reads "3 214 dagar
  // sedan", which nobody can turn into a date in their head.
  it('changes unit as the distance grows', () => {
    const ago = (days: number) =>
      formatRelativeTime(new Date(baseDate.getTime() - days * 24 * 60 * 60 * 1000), baseDate);

    expect(ago(13)).toBe('13 dagar sedan');
    expect(ago(21)).toBe('3 veckor sedan');
    expect(ago(90)).toBe('2 månader sedan');
    expect(ago(400)).toBe('13 månader sedan');
    expect(ago(365 * 3)).toBe('2 år sedan');
    expect(ago(3214)).toBe('8 år sedan');
  });

  it('keeps the singular for one of each unit', () => {
    const ago = (days: number) =>
      formatRelativeTime(new Date(baseDate.getTime() - days * 24 * 60 * 60 * 1000), baseDate);

    expect(ago(1)).toBe('1 dag sedan');
    expect(ago(14)).toBe('2 veckor sedan');
    expect(ago(61)).toBe('2 månader sedan');
  });
});

// The feed row carries the type, the place and the time on one line. At 390px
// "3 timmar sedan" takes enough of it that a long type and its place both come
// out as ellipses.
describe('formatShortRelativeTime', () => {
  const baseDate = new Date('2024-01-15T12:00:00Z');
  const ago = (ms: number) => formatShortRelativeTime(new Date(baseDate.getTime() - ms), baseDate);

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;

  it('drops "sedan" from the units a feed row can actually show', () => {
    expect(ago(30 * 1000)).toBe('Just nu');
    expect(ago(5 * MIN)).toBe('5 min');
    expect(ago(3 * HOUR)).toBe('3 tim');
    expect(ago(23 * HOUR)).toBe('23 tim');
  });

  // Only rows filed today show a relative time, so hours is as coarse as this
  // has to get. Anything older belongs to the pinned linked event, which has a
  // line to itself and should read as a sentence.
  it('hands anything past a day back to the full wording', () => {
    expect(ago(25 * HOUR)).toBe('1 dag sedan');
    expect(ago(21 * 24 * HOUR)).toBe('3 veckor sedan');
  });
});

describe('sanitizeInput', () => {
  it('removes null bytes and control characters', () => {
    const input = 'hello\x00world\x1F';
    expect(sanitizeInput(input)).toBe('helloworld');
  });

  it('normalizes whitespace', () => {
    const input = 'hello   world\t\ntest';
    expect(sanitizeInput(input)).toBe('hello world test');
  });

  it('trims and limits length', () => {
    const input = '  hello world  ';
    expect(sanitizeInput(input, 5)).toBe('hello');
  });
});

describe('sanitizeLocation', () => {
  it('allows Swedish characters', () => {
    const input = 'Jönköping';
    expect(sanitizeLocation(input)).toBe('Jönköping');
  });

  it('allows common punctuation', () => {
    const input = 'Stockholm, Södermalm';
    expect(sanitizeLocation(input)).toBe('Stockholm, Södermalm');
  });

  it('removes invalid characters', () => {
    const input = 'Göteborg <script>';
    expect(sanitizeLocation(input)).toBe('Göteborg script');
  });
});

describe('sanitizeType', () => {
  it('allows Swedish characters and slashes', () => {
    const input = 'Stöld/inbrott';
    expect(sanitizeType(input)).toBe('Stöld/inbrott');
  });

  it('removes invalid characters', () => {
    const input = 'Trafikolycka <dangerous>';
    expect(sanitizeType(input)).toBe('Trafikolycka dangerous');
  });
});

describe('sanitizeSearch', () => {
  it('sanitizes search input', () => {
    const input = 'sökning\x00test';
    expect(sanitizeSearch(input)).toBe('sökningtest');
  });

  it('limits to 200 characters', () => {
    const input = 'a'.repeat(300);
    expect(sanitizeSearch(input)).toHaveLength(200);
  });
});

describe('swedishDayKey', () => {
  // The feed groups incidents by day on the server and again in the browser.
  // If those two disagree, React discards the server-rendered feed, so this
  // has to answer for Stockholm regardless of the runtime's own timezone.
  it('returns the Swedish calendar day', () => {
    expect(swedishDayKey(new Date('2026-07-28T10:00:00.000Z'))).toBe('2026-07-28');
  });

  it('puts a Swedish late evening on the Swedish day, not the UTC one', () => {
    // 23:30 in Stockholm during CEST is 21:30 UTC: same day either way.
    expect(swedishDayKey(new Date('2026-07-28T21:30:00.000Z'))).toBe('2026-07-28');
    // 00:30 Stockholm is 22:30 UTC the day before. UTC would say the 28th.
    expect(swedishDayKey(new Date('2026-07-28T22:30:00.000Z'))).toBe('2026-07-29');
  });

  it('follows the offset across DST, not a fixed one', () => {
    // CET (+01:00) in winter: 00:30 local is 23:30 UTC the previous day.
    expect(swedishDayKey(new Date('2026-01-14T23:30:00.000Z'))).toBe('2026-01-15');
    // CEST (+02:00) in summer: the same UTC wall time is 01:30 local.
    expect(swedishDayKey(new Date('2026-07-14T23:30:00.000Z'))).toBe('2026-07-15');
  });

  it('is independent of the process timezone', () => {
    const original = process.env.TZ;
    try {
      // A reader in Los Angeles must still see Swedish days.
      process.env.TZ = 'America/Los_Angeles';
      expect(swedishDayKey(new Date('2026-07-28T22:30:00.000Z'))).toBe('2026-07-29');
      process.env.TZ = 'Pacific/Kiritimati';
      expect(swedishDayKey(new Date('2026-07-28T22:30:00.000Z'))).toBe('2026-07-29');
    } finally {
      process.env.TZ = original;
    }
  });
});
