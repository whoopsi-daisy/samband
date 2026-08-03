'use client';

import { useMemo, useState } from 'react';
import { RegionBreakdown } from '@/types';
import { COUNTY_BY_CODE } from '@/lib/regions';
import { BIN_COUNT, binOf, binRanges, quantileThresholds } from '@/lib/choropleth';
import { useCountyGeometry } from '@/hooks/useCountyGeometry';

/**
 * Sweden by county, shaded by each county's share of the notices.
 *
 * Drawn as plain SVG rather than with the map library the incident view uses.
 * There is no basemap under this and there should not be: tiles would put roads
 * and town names behind a chart about counties, cost a network round trip per
 * tile, and drag in an attribution requirement for imagery nothing here shows.
 * Twenty-one paths do the whole job.
 *
 * The paths arrive already projected — see scripts/build-county-paths.ts, which
 * runs d3-geo at build time — so this component does no geometry at all. It
 * picks a shade per county and draws.
 *
 * The map is an overview, not the data. Every number it encodes is in the table
 * underneath it, which is what a reader on a screen reader, a printout or a
 * monochrome display gets, and which is why the shading is allowed to be a
 * four-step approximation rather than a continuous scale nobody can read off.
 */
function CountyMap({ regions }: { regions: RegionBreakdown }) {
  const { shapes, failed } = useCountyGeometry(true);

  const byCounty = useMemo(
    () => new Map(regions.rows.map((row) => [row.county, row])),
    [regions.rows]
  );

  const shares = useMemo(() => regions.rows.map((row) => row.share), [regions.rows]);
  const thresholds = useMemo(() => quantileThresholds(shares), [shares]);
  const ranges = useMemo(() => binRanges(shares, thresholds), [shares, thresholds]);

  const paths = useMemo(() => {
    if (!shapes) return null;
    return shapes.counties.map((shape) => {
      const county = COUNTY_BY_CODE[shape.lanskod];
      const row = county ? byCounty.get(county) : undefined;
      return {
        code: shape.lanskod,
        county: county ?? shape.name,
        d: shape.d,
        row,
        bin: row ? binOf(row.share, thresholds) : null,
      };
    });
  }, [shapes, byCounty, thresholds]);

  const [hovered, setHovered] = useState<string | null>(null);

  // Nothing to shade, or the geometry never arrived. Both are silent: the table
  // below carries every number, so a missing map costs the reader an overview
  // and not the data. An error box for a decorative failure is worse than the
  // failure.
  if (failed || regions.rows.length === 0) return null;

  const percent = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')} %`;
  const active = paths?.find((shape) => shape.code === hovered);

  return (
    <figure className="county-map">
      <div className="county-map-figure">
        {shapes && paths ? (
          <svg
            viewBox={`0 0 ${shapes.width} ${shapes.height}`}
            className="county-map-svg"
            role="img"
            aria-label={`Karta över Sverige där varje län är skuggat efter sin andel av notiserna. Störst är ${regions.rows[0].county} med ${percent(regions.rows[0].share)}.`}
          >
            {paths.map((shape) => (
              <path
                key={shape.code}
                d={shape.d}
                className={`county-shape${shape.bin === null ? ' county-shape--none' : ''}${
                  hovered === shape.code ? ' county-shape--hover' : ''
                }`}
                style={shape.bin === null ? undefined : { fill: `var(--choro-${shape.bin})` }}
                onMouseEnter={() => setHovered(shape.code)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* The browser's own tooltip, so the map still answers a hover
                    with no JavaScript involved. */}
                <title>
                  {shape.county}
                  {shape.row ? `: ${percent(shape.row.share)}` : ''}
                </title>
              </path>
            ))}
          </svg>
        ) : (
          // Reserved at the shape the map will take, so the table below does not
          // jump down the page when the geometry lands.
          <div className="county-map-placeholder" aria-hidden="true" />
        )}

      <figcaption className="county-map-aside">
        {/* Not aria-live: the same fact is in the <title> the pointer already
            surfaced, and announcing on every hover would be a stream of noise. */}
        <div className="county-map-readout">
          {active?.row ? (
            <>
              <span className="county-map-readout-name">{active.county.replace(/ län$/, '')}</span>
              <span className="county-map-readout-value">
                {percent(active.row.share)} · {active.row.total.toLocaleString('sv-SE')} notiser
              </span>
            </>
          ) : (
            <span className="county-map-readout-hint">Peka på ett län för att se dess siffror</span>
          )}
        </div>

        <span className="county-map-legend-label">Andel av notiserna</span>
        <ul className="county-map-scale">
          {Array.from({ length: BIN_COUNT }, (_, bin) => {
            const range = ranges[bin];
            return (
              <li key={bin} className="county-map-step">
                <span
                  className="county-map-swatch"
                  style={{ background: `var(--choro-${bin})` }}
                  aria-hidden="true"
                />
                <span className="county-map-step-range">
                  {range ? `${percent(range.from)}–${percent(range.to)}` : '–'}
                </span>
              </li>
            );
          })}
        </ul>
        {/* Said once, plainly. A choropleth of counts is a population map with
            extra steps, and a reader who does not know that will read Stockholm
            being darkest as a finding. */}
        <p className="county-map-note">
          Lika många län i varje skugga. Fler människor betyder fler notiser, så kartan följer i
          hög grad var i landet folk bor.
        </p>
      </figcaption>
      </div>
    </figure>
  );
}

export default CountyMap;
