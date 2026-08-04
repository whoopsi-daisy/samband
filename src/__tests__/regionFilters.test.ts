import { isCountyName, resolveRegionFilters } from '@/lib/regions';

/**
 * A county and a place are two filters, and the feed puts county names in both.
 *
 * Polisen labels a great many notices with the county alone, so "Blekinge län"
 * is a value in the location column as well as the name of a county. With both
 * controls able to hold it, the chips read "Län: Blekinge län" beside
 * "Plats: Blekinge län" and what came back was the intersection: only the
 * notices where an officer typed the county, with every notice in Blekinge that
 * named a town silently dropped.
 */
describe('isCountyName', () => {
  it('recognises the administrative names', () => {
    expect(isCountyName('Blekinge län')).toBe(true);
    expect(isCountyName('Västra Götalands län')).toBe(true);
    expect(isCountyName('  stockholms län ')).toBe(true);
  });

  /*
   * The distinction countyOf does not draw.
   *
   * countyOf('Malmö') is 'Skåne län', which is right for placing a pin and for
   * the regional breakdown, and would be catastrophic here: every municipality
   * in the place dropdown would be treated as a county and collapsed into one.
   */
  it('does not treat a place inside a county as one', () => {
    expect(isCountyName('Malmö')).toBe(false);
    expect(isCountyName('Ljungby')).toBe(false);
    expect(isCountyName('Göteborg')).toBe(false);
  });

  it('is not fooled by the suffix alone', () => {
    expect(isCountyName('Mordor län')).toBe(false);
    expect(isCountyName('län')).toBe(false);
    expect(isCountyName('')).toBe(false);
    expect(isCountyName(null)).toBe(false);
  });

  // "Nationellt" is what the feed files against the whole country, and it is
  // not a county however much it looks like a region.
  it('leaves the non-places alone', () => {
    expect(isCountyName('Nationellt')).toBe(false);
    expect(isCountyName('Hela landet')).toBe(false);
  });
});

describe('resolveRegionFilters', () => {
  it('leaves an ordinary place where it is', () => {
    expect(resolveRegionFilters('', 'Malmö')).toEqual({ county: '', location: 'Malmö' });
  });

  it('keeps a county and a place inside it as two filters', () => {
    expect(resolveRegionFilters('Skåne län', 'Malmö')).toEqual({
      county: 'Skåne län',
      location: 'Malmö',
    });
  });

  // The state in the screenshot: both controls set to the same area.
  it('collapses a place that is really a county into the county filter', () => {
    expect(resolveRegionFilters('', 'Blekinge län')).toEqual({
      county: 'Blekinge län',
      location: '',
    });
  });

  it('drops the redundant place when both name the same county', () => {
    expect(resolveRegionFilters('Blekinge län', 'Blekinge län')).toEqual({
      county: 'Blekinge län',
      location: '',
    });
  });

  /*
   * An explicit county wins.
   *
   * Reaching this means two counties were asked for at once, which no control
   * can produce and only a hand-edited URL can. The one in the county parameter
   * is the one that was meant; the place was standing in for a county at best.
   */
  it('prefers the county parameter when the two disagree', () => {
    expect(resolveRegionFilters('Skåne län', 'Blekinge län')).toEqual({
      county: 'Skåne län',
      location: '',
    });
  });

  // `?plats=Skåne län` was the only way to ask for a county before the county
  // filter existed, so those links are out there. They should keep working, and
  // return more than they used to rather than less.
  it('upgrades a link shared before the county filter existed', () => {
    expect(resolveRegionFilters(null, 'Kronobergs län')).toEqual({
      county: 'Kronobergs län',
      location: '',
    });
  });

  it('still sanitises the county through the canonical names', () => {
    expect(resolveRegionFilters('skåne', '')).toEqual({ county: 'Skåne län', location: '' });
    expect(resolveRegionFilters('Mordor', '')).toEqual({ county: '', location: '' });
  });

  it('passes an empty pair through', () => {
    expect(resolveRegionFilters(null, null)).toEqual({ county: '', location: '' });
  });
});
