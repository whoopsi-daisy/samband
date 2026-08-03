/**
 * Project the county outlines once, here, instead of in every browser.
 *
 *   npm run build:geo
 *
 * Sweden's borders do not move, so projecting them is a build step and not
 * runtime work. This reads the source GeoJSON and writes a small file of SVG
 * path strings that the statistics view can draw directly: no projection code
 * ships to the client, no coordinates are transformed on a phone, and the
 * output is smaller than the input it came from.
 *
 * d3-geo does the projection, and is a devDependency for exactly that reason —
 * it runs here and is never bundled. The first version of this was a hand
 * written Mercator, which is about forty lines and looked right; it paired a
 * longitude in degrees with a latitude already converted to radians, so it drew
 * a Sweden squashed to a fifty-seventh of its height. That is the argument for
 * the library in one sentence: the failure mode of projection maths is a map
 * that still looks like a map.
 *
 * Source: okfse/sweden-geojson (swedish_regions.geojson), simplified with
 * mapshaper from Lantmäteriet/SCB open data. Confirmed free to reuse without
 * attribution.
 */
import fs from 'fs';
import path from 'path';
import { geoArea, geoMercator, geoPath } from 'd3-geo';
import rewindModule from '@mapbox/geojson-rewind';
import type { FeatureCollection, Geometry } from 'geojson';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rewind = ((rewindModule as any).default ?? rewindModule) as (
  geo: unknown,
  clockwise: boolean
) => FeatureCollection<Geometry, SourceProperties>;

/**
 * Sweden's real area, in steradians on a sphere of radius 6371 km.
 *
 * The assertion below is not decoration. d3-geo is spherical: it decides which
 * side of a ring is inside from the ring's winding order, and it wants exterior
 * rings CLOCKWISE — the opposite of what RFC 7946 specifies, which is what most
 * files in the wild carry. Wound the wrong way, every county is read as the
 * whole globe with a county-shaped hole in it. Nothing throws. `fitWidth` then
 * fits the globe, and the output is a perfectly square Sweden.
 *
 * So the geometry is measured against the real country before it is drawn. A
 * hemisphere and a county are not close in any unit.
 */
const SWEDEN_STERADIANS = 450_295 / 6371 ** 2;

/** The width the paths are drawn against. The SVG scales from here. */
const WIDTH = 320;
/** Kept clear of the edge so a stroke on the outermost county is not clipped. */
const PAD = 4;
/** A tenth of a unit is well under a pixel at the size this renders. */
const PRECISION = 1;

interface SourceProperties {
  name: string;
  l_id: number;
}

const SOURCE = path.join(process.cwd(), 'scripts/geo/swedish-counties.source.geojson');
const OUTPUT = path.join(process.cwd(), 'public/geo/swedish-counties.json');

function round(d: string): string {
  return d.replace(/-?\d+\.\d+/g, (n) => String(Number(Number(n).toFixed(PRECISION))));
}

function main(): void {
  const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const geo = rewind(source, true);

  const area = geoArea(geo);
  const ratio = area / SWEDEN_STERADIANS;
  if (ratio < 0.8 || ratio > 1.2) {
    throw new Error(
      `the geometry covers ${area.toFixed(4)} sr, ${ratio.toFixed(1)}x Sweden's ${SWEDEN_STERADIANS.toFixed(4)} sr. ` +
        'Almost certainly the ring winding: d3-geo reads a counter-clockwise exterior as the whole globe.'
    );
  }

  // fitWidth sets the scale; the translate that comes back is centred on the
  // full width, so the bounds are measured and the origin moved to the padding.
  const projection = geoMercator().fitWidth(WIDTH - PAD * 2, geo);
  const draw = geoPath(projection);

  const [[x0, y0], [x1, y1]] = draw.bounds(geo);
  const [tx, ty] = projection.translate();
  projection.translate([tx - x0 + PAD, ty - y0 + PAD]);

  const height = Math.round((y1 - y0 + PAD * 2) * 10) / 10;

  const counties = geo.features
    .map((feature) => ({
      // Zero-padded, because that is how a county code is written and how the
      // app's own COUNTY_BY_CODE is keyed.
      lanskod: String(feature.properties.l_id).padStart(2, '0'),
      name: feature.properties.name,
      d: round(draw(feature) ?? ''),
    }))
    .sort((a, b) => a.lanskod.localeCompare(b.lanskod));

  const empty = counties.filter((county) => county.d === '');
  if (empty.length > 0) {
    throw new Error(`no path drawn for: ${empty.map((c) => c.name).join(', ')}`);
  }
  if (counties.length !== 21) {
    throw new Error(`expected 21 counties, got ${counties.length}`);
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify({ width: WIDTH, height, counties }));

  const before = fs.statSync(SOURCE).size;
  const after = fs.statSync(OUTPUT).size;
  console.log(
    `${counties.length} counties, viewBox 0 0 ${WIDTH} ${height}\n` +
      `area check: ${area.toFixed(4)} sr, ${(ratio * 100).toFixed(0)}% of Sweden\n` +
      `${(before / 1024).toFixed(1)} kB of GeoJSON -> ${(after / 1024).toFixed(1)} kB of paths`
  );
}

main();
