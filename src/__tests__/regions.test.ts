import { COUNTIES, MUNICIPALITIES, countyOf } from '@/lib/regions';

/**
 * The county table is the only thing standing between "three hundred labels of
 * four different kinds" and a picture of Sweden, and a wrong entry in it does
 * not look wrong: a municipality filed under the neighbouring county produces a
 * perfectly plausible chart that is quietly false.
 */
describe('placing a name in a county', () => {
  it('covers all twenty-one counties', () => {
    expect(COUNTIES).toHaveLength(21);
    expect(new Set(COUNTIES).size).toBe(21);
  });

  it('places a municipality in the county it belongs to', () => {
    expect(countyOf('Ljungby')).toBe('Kronobergs län');
    expect(countyOf('Göteborg')).toBe('Västra Götalands län');
    expect(countyOf('Malmö')).toBe('Skåne län');
    expect(countyOf('Kiruna')).toBe('Norrbottens län');
    expect(countyOf('Gotland')).toBe('Gotlands län');
  });

  // Half the feed names a county rather than a municipality, so the two have to
  // land in the same bucket or every county is counted twice under two spellings.
  it('takes a county name as itself', () => {
    expect(countyOf('Kronobergs län')).toBe('Kronobergs län');
    expect(countyOf('Västra Götalands län')).toBe('Västra Götalands län');
  });

  it('ignores case and stray whitespace, which the feed has both of', () => {
    expect(countyOf('  ljungby ')).toBe('Kronobergs län');
    expect(countyOf('STOCKHOLM')).toBe('Stockholms län');
    expect(countyOf('Upplands  Väsby')).toBe('Stockholms län');
  });

  it('accepts the short forms the feed also uses', () => {
    expect(countyOf('Skåne')).toBe('Skåne län');
    expect(countyOf('Dalarna')).toBe('Dalarnas län');
    expect(countyOf('Göteborgs stad')).toBe('Västra Götalands län');
  });

  // Null is an answer, not a failure: a notice filed nationally did not happen
  // in any county, and pretending otherwise puts it in one.
  it('refuses a name that is not a place in Sweden', () => {
    expect(countyOf('Nationellt')).toBeNull();
    expect(countyOf('Hela landet')).toBeNull();
    expect(countyOf('')).toBeNull();
    expect(countyOf(null)).toBeNull();
    expect(countyOf(undefined)).toBeNull();
  });

  // Sweden has exactly 290 municipalities. A table short of that has a hole in
  // it, and every notice from the missing place is counted as unplaceable.
  it('holds all 290 municipalities', () => {
    const all = COUNTIES.flatMap((county) => MUNICIPALITIES[county]);
    expect(all).toHaveLength(290);
  });

  // Municipality names are unique across Sweden, and the table is only correct
  // while it stays that way: a name listed under two counties silently resolves
  // to whichever was declared last, which is a chart nobody can tell is wrong.
  it('never lists the same municipality under two counties', () => {
    const all = COUNTIES.flatMap((county) => MUNICIPALITIES[county]);
    const duplicates = all.filter((name, i) => all.indexOf(name) !== i);
    expect(duplicates).toEqual([]);
  });

  it('resolves every municipality in the table', () => {
    for (const county of COUNTIES) {
      for (const municipality of MUNICIPALITIES[county]) {
        expect(countyOf(municipality)).toBe(county);
      }
    }
  });
});
