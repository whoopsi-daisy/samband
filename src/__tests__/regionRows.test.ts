import { regionsForType, TREND_MIN_BASE } from '@/lib/regionRows';
import { RegionTypeCube } from '@/types';

/**
 * The county breakdown narrowed to one type of notice.
 *
 * The unfiltered map is close to a population map, which is true and is not a
 * finding: Stockholm is darkest because Stockholm is where the people are. The
 * filter is what makes the block worth having, because a type whose map does
 * *not* follow the population is the pattern a reader came for.
 */
function cube(overrides: Partial<RegionTypeCube> = {}): RegionTypeCube {
  return {
    types: ['Trafikolycka', 'Narkotikabrott'],
    cells: {
      'Stockholms län': { Trafikolycka: [800, 400, 300], Narkotikabrott: [200, 100, 120] },
      'Kronobergs län': { Trafikolycka: [130, 60, 50], Narkotikabrott: [720, 350, 400] },
      // Carries one type and not the other, which is the case the map has to
      // draw as "none on record" rather than as the lightest shade.
      'Gotlands län': { Trafikolycka: [70, 30, 40] },
    },
    unplaced: { Trafikolycka: 40, Narkotikabrott: 90 },
    recentStart: '2025-08',
    ...overrides,
  };
}

describe('regionsForType', () => {
  it('counts only the selected type', () => {
    const rows = regionsForType(cube(), 'Narkotikabrott').rows;

    expect(rows.map((row) => [row.county, row.total])).toEqual([
      ['Kronobergs län', 720],
      ['Stockholms län', 200],
    ]);
  });

  /*
   * The whole point of the control.
   *
   * Over everything, Stockholm leads. Narrowed to one type it does not, and a
   * table that kept the unfiltered order would hide exactly the thing the
   * reader selected the type to find.
   */
  it('reorders the counties around the type rather than the total', () => {
    const all = regionsForType(cube(), 'Trafikolycka').rows;
    const drugs = regionsForType(cube(), 'Narkotikabrott').rows;

    expect(all[0].county).toBe('Stockholms län');
    expect(drugs[0].county).toBe('Kronobergs län');
  });

  /*
   * Shares have to be shares of what is on the map.
   *
   * Reusing the unfiltered `placed` would leave a filtered table of twenty-one
   * counties summing to a few per cent, with every shade at the bottom of the
   * scale and the map reading as "nothing much happens anywhere".
   */
  it('takes the shares against the notices of that type, not the whole record', () => {
    const breakdown = regionsForType(cube(), 'Narkotikabrott');

    expect(breakdown.placed).toBe(920);
    expect(breakdown.rows[0].share).toBeCloseTo(720 / 920);
    const sum = breakdown.rows.reduce((total, row) => total + row.share, 0);
    expect(sum).toBeCloseTo(1);
  });

  it('carries the unplaceable notices of that type, not those of the whole record', () => {
    expect(regionsForType(cube(), 'Narkotikabrott').unplaced).toBe(90);
    expect(regionsForType(cube(), 'Trafikolycka').unplaced).toBe(40);
  });

  // "No burglaries on record here" and "fewest burglaries in the country" are
  // different claims, and the map can only tell them apart if the row is absent
  // rather than zero: CountyMap greys a county it has no row for.
  it('leaves out a county with none of that type', () => {
    const counties = regionsForType(cube(), 'Narkotikabrott').rows.map((row) => row.county);

    expect(counties).not.toContain('Gotlands län');
    expect(regionsForType(cube(), 'Trafikolycka').rows.map((r) => r.county)).toContain(
      'Gotlands län'
    );
  });

  it('keeps the trend, computed within the type', () => {
    const stockholm = regionsForType(cube(), 'Trafikolycka').rows.find(
      (row) => row.county === 'Stockholms län'
    );

    // 400 against 300 the year before.
    expect(stockholm?.change).toBeCloseTo(1 / 3);
    expect(regionsForType(cube(), 'Trafikolycka').trendFrom).toBe('2025-08');
  });

  /*
   * The threshold matters far more under a filter than it ever did over the
   * whole record: narrowing to one type divides every county's base by twenty
   * or more, so counties that carried a trend unfiltered correctly stop
   * carrying one, instead of swinging by hundreds of per cent on a handful.
   */
  it('drops a county whose earlier window is too thin to divide by', () => {
    const thin = regionsForType(
      cube({
        cells: {
          'Stockholms län': { Rån: [400, 200, 180] },
          'Gotlands län': { Rån: [12, 9, TREND_MIN_BASE - 1] },
        },
      }),
      'Rån'
    );

    expect(thin.rows.find((row) => row.county === 'Stockholms län')?.change).not.toBeNull();
    expect(thin.rows.find((row) => row.county === 'Gotlands län')?.change).toBeNull();
  });

  it('returns nothing at all for a type the cube does not carry', () => {
    const breakdown = regionsForType(cube(), 'Mordbrand');

    expect(breakdown.rows).toEqual([]);
    expect(breakdown.placed).toBe(0);
  });

  // Shares divide by `placed`, and an empty selection would divide by zero.
  it('does not produce NaN shares on an empty selection', () => {
    for (const row of regionsForType(cube(), 'Mordbrand').rows) {
      expect(Number.isFinite(row.share)).toBe(true);
    }
  });
});
