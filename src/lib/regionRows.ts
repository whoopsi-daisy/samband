import { RegionBreakdown, RegionStat, RegionTypeCube } from '@/types';

/**
 * The county rows, their shares and their trend, from three tallies.
 *
 * Pulled out of db.ts because there are two callers now with the same maths
 * behind them: the whole record, and the record narrowed to one type of
 * notice. Sharing the function is what keeps a filtered table from quietly
 * computing its shares or its trend cutoff differently from the unfiltered one.
 */

/**
 * A county whose earlier window is thinner than this gets no trend.
 *
 * A county with a handful of notices last year swings by hundreds of percent on
 * a difference of three, which reads as a finding and is not. The threshold
 * matters more under a type filter than it ever did over the whole record:
 * narrowing to one type divides every county's base by twenty or more, so most
 * of the table falls below it and correctly shows nothing.
 */
export const TREND_MIN_BASE = 100;

export function buildRegionBreakdown(
  allTime: Map<string, number>,
  recent: Map<string, number>,
  previous: Map<string, number>,
  coverage: { placed: number; unplaced: number },
  recentStart: string
): RegionBreakdown {
  const previousTotal = [...previous.values()].reduce((sum, n) => sum + n, 0);
  const { placed, unplaced } = coverage;

  const rows: RegionStat[] = [...allTime.entries()]
    .map(([county, total]) => {
      const before = previous.get(county) ?? 0;
      const after = recent.get(county) ?? 0;
      const change = previousTotal > 0 && before >= TREND_MIN_BASE ? (after - before) / before : null;
      return {
        county,
        total,
        share: placed > 0 ? total / placed : 0,
        recent: after,
        previous: before,
        change,
      };
    })
    .sort((a, b) => b.total - a.total || a.county.localeCompare(b.county, 'sv'));

  return {
    rows,
    unplaced,
    placed,
    // Only claim a comparison window when there is something in it to compare.
    trendFrom: previousTotal > 0 ? recentStart : null,
  };
}

/**
 * The county breakdown narrowed to one type of notice.
 *
 * Runs on the client off the cube the page already carries, so changing the
 * selection is a re-render and not a request. `placed` is recomputed from the
 * type's own rows rather than reused from the unfiltered breakdown: shares have
 * to be shares of the notices actually on the map, or a filtered table shows
 * twenty-one counties summing to four per cent.
 *
 * A county with none of the selected type is left out entirely, which is what
 * lets the map grey it rather than shade it the lightest step. "No burglaries
 * on record here" and "fewest burglaries in the country" are different claims
 * and the map has to be able to tell them apart.
 */
export function regionsForType(cube: RegionTypeCube, type: string): RegionBreakdown {
  const allTime = new Map<string, number>();
  const recent = new Map<string, number>();
  const previous = new Map<string, number>();
  let placed = 0;

  for (const [county, byType] of Object.entries(cube.cells)) {
    const cell = byType[type];
    if (!cell || cell[0] === 0) continue;
    allTime.set(county, cell[0]);
    recent.set(county, cell[1]);
    previous.set(county, cell[2]);
    placed += cell[0];
  }

  return buildRegionBreakdown(
    allTime,
    recent,
    previous,
    { placed, unplaced: cube.unplaced[type] ?? 0 },
    cube.recentStart
  );
}
