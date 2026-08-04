/**
 * Sorting counties into shades.
 *
 * Quantile bins, not equal-width ones. Notices follow population, so the
 * distribution is heavily skewed: Stockholm alone is around a fifth of the
 * country and most counties sit under three percent. Cut into four equal-width
 * bands, twenty of the twenty-one counties land in the palest one and the map
 * says nothing except "Stockholm is big", which the reader already knew.
 * Equal counts per bin spend the four shades on the differences that exist.
 */

/** How many shades the ramp has, and therefore how many bins. */
export const BIN_COUNT = 4;

/**
 * The upper bound of each bin except the last, from the values themselves.
 *
 * Ties are collapsed: several counties on the identical value cannot be split
 * across a boundary, and a repeated threshold would produce a legend with two
 * bands claiming the same range.
 */
export function quantileThresholds(values: number[], bins = BIN_COUNT): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const cuts: number[] = [];
  for (let i = 1; i < bins; i++) {
    let at = Math.floor((sorted.length * i) / bins);
    // A cut has to have something below it. Landing on a run of equal values —
    // or on the smallest value of all — produces a boundary that nothing falls
    // under, which is an empty palest bin and a legend band for no counties.
    // Walk forward to the next value that genuinely splits the data.
    const floor = cuts.length > 0 ? cuts[cuts.length - 1] : sorted[0];
    while (at < sorted.length && sorted[at] <= floor) at++;
    if (at >= sorted.length) break;
    cuts.push(sorted[at]);
  }
  return cuts;
}

/** Which bin a value falls in: 0 is the palest. */
export function binOf(value: number, thresholds: number[]): number {
  let bin = 0;
  while (bin < thresholds.length && value >= thresholds[bin]) bin++;
  return bin;
}

/**
 * The range each bin covers, for the legend.
 *
 * A legend that only labels its two ends leaves the reader to guess what the
 * middle shades mean, and with quantile bins the steps are not evenly spaced,
 * so guessing is wrong.
 */
export function binRanges(
  values: number[],
  thresholds: number[]
): Array<{ from: number; to: number }> {
  const sorted = [...values].sort((a, b) => a - b);
  const lowest = sorted[0] ?? 0;
  const highest = sorted[sorted.length - 1] ?? 0;

  const edges = [lowest, ...thresholds, highest];
  const ranges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < edges.length - 1; i++) {
    ranges.push({ from: edges[i], to: edges[i + 1] });
  }
  return ranges;
}
