import {
  formatAgo,
  formatBytes,
  formatDay,
  formatMinutes,
  formatNumber,
  formatPercent,
  formatUptime,
} from '@/lib/opsFormat';

describe('numbers on the dashboard', () => {
  // The page mixed "1,009" and "1 009" in adjacent tiles, because
  // toLocaleString() without a locale takes the runtime's default: en-US on
  // the server, whatever the reader has in the browser.
  it('groups thousands the Swedish way, whatever the runtime prefers', () => {
    // sv-SE groups with U+00A0, so the digits of one figure cannot be split
    // across two lines in a narrow tile. Spelled out rather than pasted, so
    // the character is visible in the test.
    const nbsp = ' ';
    expect(formatNumber(1009)).toBe(`1${nbsp}009`);
    expect(formatNumber(333012)).toBe(`333${nbsp}012`);
    expect(formatNumber(1009)).not.toContain(',');
  });

  // 99,95 % rounds to 100 % and reads as "nothing is wrong".
  it('keeps a decimal on a rate that is not quite whole', () => {
    expect(formatPercent(100)).toBe('100 %');
    expect(formatPercent(99.34)).toBe('99,3 %');
  });

  it('sizes a file the way an operator would say it', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(940)).toBe('940 B');
    expect(formatBytes(312 * 1024)).toBe('312 kB');
    expect(formatBytes(367 * 1024 * 1024)).toBe('367 MB');
    // A full archive with a trigram index lands here, and the decimal is the
    // difference between watching a volume fill and not.
    expect(formatBytes(1.42 * 1024 ** 3)).toBe('1,4 GB');
  });
});

describe('spans of time', () => {
  // The page said "1 dagar sedan".
  it('gets the singular right', () => {
    expect(formatMinutes(60 * 24)).toBe('1 dygn');
    expect(formatMinutes(60 * 48)).toBe('2 dygn');
  });

  it('reads at the resolution the number deserves', () => {
    expect(formatMinutes(0)).toBe('nyss');
    expect(formatMinutes(7)).toBe('7 min');
    expect(formatMinutes(60)).toBe('1 tim');
    expect(formatMinutes(95)).toBe('1 tim 35 min');
    expect(formatMinutes(60 * 26)).toBe('1 dygn 2 tim');
  });

  it('says aldrig rather than a number when there is nothing to date from', () => {
    expect(formatMinutes(null)).toBe('aldrig');
    expect(formatAgo(null)).toBe('aldrig');
  });

  it('counts back from a given moment, so it can be tested at all', () => {
    const now = Date.parse('2026-08-02T12:00:00Z');
    expect(formatAgo('2026-08-02T11:57:00Z', now)).toBe('för 3 min sedan');
    expect(formatAgo('2026-08-02T11:59:50Z', now)).toBe('just nu');
  });

  it('reports process uptime in seconds only while that is all there is', () => {
    expect(formatUptime(12)).toBe('12 s');
    expect(formatUptime(3600)).toBe('1 tim');
  });

  it('leaves a missing date as a dash rather than Invalid Date', () => {
    expect(formatDay(null)).toBe('–');
    expect(formatDay('not a date')).toBe('–');
  });
});
