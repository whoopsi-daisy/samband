import fs from 'fs';
import path from 'path';
import { COUNTIES, MUNICIPALITIES, countyOf, isCountyName, resolveRegionFilters } from '@/lib/regions';

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

/**
 * The table against an independent source.
 *
 * MUNICIPALITIES was written out by hand, and the failure mode of a hand-written
 * lookup table is not a crash: it is one municipality filed under the
 * neighbouring county, which produces a chart that is entirely plausible and
 * quietly false. Nothing in the app can notice that, and neither can a reader.
 *
 * The fixture is the administrative facts only — official municipality code,
 * name, and the county code that is the first two digits of it — extracted from
 * okfse/sweden-geojson's municipality file, which derives from Valmyndigheten's
 * data by way of opendatasoft. The geometry is stripped: borders are not what
 * this checks, and the file's polygons are simplified to 2% anyway.
 *
 * Kept as a fixture rather than made the source of truth. The table in
 * regions.ts stays readable, grouped by county and commented, and this is what
 * proves it right.
 */
describe('the municipality table against Valmyndigheten', () => {
  /** Sweden's official county codes. The first two digits of every kommunkod. */
  const COUNTY_BY_CODE: Record<string, string> = {
    '01': 'Stockholms län',
    '03': 'Uppsala län',
    '04': 'Södermanlands län',
    '05': 'Östergötlands län',
    '06': 'Jönköpings län',
    '07': 'Kronobergs län',
    '08': 'Kalmar län',
    '09': 'Gotlands län',
    '10': 'Blekinge län',
    '12': 'Skåne län',
    '13': 'Hallands län',
    '14': 'Västra Götalands län',
    '17': 'Värmlands län',
    '18': 'Örebro län',
    '19': 'Västmanlands län',
    '20': 'Dalarnas län',
    '21': 'Gävleborgs län',
    '22': 'Västernorrlands län',
    '23': 'Jämtlands län',
    '24': 'Västerbottens län',
    '25': 'Norrbottens län',
  };

  const reference: Array<{ kommunkod: string; namn: string; lanskod: string }> = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'src/__tests__/fixtures/swedish-municipalities.json'),
      'utf8'
    )
  );

  it('reads a reference of all 290, keyed on the official codes', () => {
    expect(reference).toHaveLength(290);
    // The county code is the first two digits of the municipality code, so a
    // fixture whose two columns disagree is a fixture that was tampered with.
    for (const row of reference) {
      expect(row.kommunkod.slice(0, 2)).toBe(row.lanskod);
      expect(COUNTY_BY_CODE[row.lanskod]).toBeDefined();
    }
  });

  it('places every municipality in the county the codes say it is in', () => {
    const wrong = reference
      .map((row) => ({ ...row, expected: COUNTY_BY_CODE[row.lanskod], got: countyOf(row.namn) }))
      .filter((row) => row.got !== row.expected);

    // Named, not counted: a bare "expected 3 to be 0" would say a table of 290
    // entries is wrong somewhere and leave the finding of it to whoever is next.
    expect(wrong.map((row) => `${row.namn}: ${row.got} should be ${row.expected}`)).toEqual([]);
  });

  it('lists nothing the reference does not', () => {
    const known = new Set(reference.map((row) => row.namn));
    const invented = COUNTIES.flatMap((county) => MUNICIPALITIES[county]).filter(
      (name) => !known.has(name)
    );

    expect(invented).toEqual([]);
  });
});

/*
 * The county name without its genitive s.
 *
 * Sweden's counties are named possessively — "Västernorrlands län", the län of
 * Västernorrland — and brottsplatskartan drops the s on a subset of them.
 * "Västernorrland län" is 1.2% of the imported record and resolved to nothing,
 * so those notices carried no county at all: absent from the regional
 * breakdown, counted as unplaceable in its own caption, and unreachable
 * through the county filter. Two of these spellings were already handled as
 * one-off aliases, added as they turned up; the set is derived now so the
 * remaining thirteen cannot each become their own later bug.
 */
describe('counties written without the genitive s', () => {
  const bare = (county: string) => `${county.replace(/ län$/, '').replace(/s$/, '')} län`;

  it('resolves every one of the twenty-one', () => {
    for (const county of COUNTIES) {
      expect(countyOf(bare(county))).toBe(county);
    }
  });

  // The form actually seen in the data, named so the test says what it is for.
  it('resolves the one the archive actually writes', () => {
    expect(countyOf('Västernorrland län')).toBe('Västernorrlands län');
    expect(countyOf('Västerbotten län')).toBe('Västerbottens län');
    expect(countyOf('Västra Götaland län')).toBe('Västra Götalands län');
  });

  // These keys go into the same map the municipalities live in, so the one
  // thing that could go wrong is a county shadowing a place inside it.
  it('shadows none of the two hundred and ninety municipalities', () => {
    for (const county of COUNTIES) {
      for (const municipality of MUNICIPALITIES[county]) {
        expect(countyOf(municipality)).toBe(county);
      }
    }
  });

  // Otherwise it stays in the place dropdown as a place, which is the thing
  // county names were taken out of that list to prevent.
  it('lets the filter treat it as a county', () => {
    expect(isCountyName('Västernorrland län')).toBe(true);
    expect(resolveRegionFilters('', 'Västernorrland län')).toEqual({
      county: 'Västernorrlands län',
      location: '',
    });
  });
});
