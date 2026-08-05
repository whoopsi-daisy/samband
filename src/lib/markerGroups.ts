import { MapEvent, TypeFamilyKey, getTypeStyle } from '@/types';

/**
 * Two different kinds of grouping, and they are not the same thing.
 *
 * A **position group** is incidents filed at one coordinate. The police file a
 * great many notices against a municipal centre, so this is real: those really
 * are all at that point, as far as the data knows. It exists at every zoom.
 *
 * A **cluster** is markers that merely happen to overlap on screen at the
 * current zoom. Two municipalities forty kilometres apart do not share a
 * position, but at country zoom their markers cover each other and the one
 * underneath cannot be read or clicked. A cluster is a rendering artefact and
 * splits as the reader zooms in; a position group never does.
 *
 * Keeping them apart matters because they are coloured by different rules, for
 * a reason given at each.
 */

/** Incidents sharing one position, as one marker. */
export interface MarkerGroup {
  lat: number;
  lng: number;
  events: MapEvent[];
  /** Most recent incident here, as epoch ms. */
  newest: number;
}

export function timeOf(event: MapEvent): number {
  const ts = new Date(event.iso).getTime();
  return isNaN(ts) ? 0 : ts;
}

/**
 * Whether a pair of numbers is somewhere a notice could have happened.
 *
 * `isNaN` was the whole test, and 0/0 is not a NaN. Brottsplatskartan writes
 * zeroes for a notice it could not geocode rather than leaving the columns
 * empty, and that is 10.7% of the imported record, so a month-long map view
 * reaching back past the live feed drew a cluster of them in the Gulf of
 * Guinea. The map fits its bounds to the markers it is given, so a single one
 * of those stretched the viewport from Sweden to the equator and left the
 * country a smudge in the corner.
 *
 * The source of those rows is fixed where they are read out of the database.
 * This stays as well, because it is the last point before a coordinate becomes
 * a viewport: anything that reaches here wrong should cost a missing pin, never
 * the whole map.
 *
 * Deliberately not a Sweden bounding box. The one thing being excluded is data
 * that cannot be a position at all; a notice genuinely filed just over a border
 * should still draw.
 */
export function isPlottable(lat: number, lng: number): boolean {
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Whether a notice can be drawn at all.
 *
 * The counts beside the map — how many notices it is showing, and the tallies
 * in the key — have to agree with the pins, so they ask the same question the
 * grouping does rather than testing the string for emptiness.
 */
export function hasPosition(event: MapEvent): boolean {
  if (!event.gps) return false;
  const [lat, lng] = event.gps.split(',').map(Number);
  return isPlottable(lat, lng);
}

export function groupByPosition(events: MapEvent[]): MarkerGroup[] {
  const groups = new Map<string, MarkerGroup>();

  for (const e of events) {
    if (!e.gps) continue;
    const [lat, lng] = e.gps.split(',').map(Number);
    if (!isPlottable(lat, lng)) continue;

    // Rounded to about ten metres, so two notices filed at the same spot with
    // different float noise still count as the same spot.
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const ts = timeOf(e);
    const group = groups.get(key);
    if (group) {
      group.events.push(e);
      if (ts > group.newest) group.newest = ts;
    } else {
      groups.set(key, { lat, lng, events: [e], newest: ts });
    }
  }

  // Newest last, so the freshest markers are drawn on top of older ones.
  return [...groups.values()].sort((a, b) => a.newest - b.newest);
}

/**
 * The family a position group wears.
 *
 * The newest incident at the spot. One position is one place, and on a map of
 * what is happening the most recent thing there is the one worth showing.
 */
export function familyOfGroup(group: MarkerGroup): TypeFamilyKey {
  let best = group.events[0];
  for (const event of group.events) {
    if (timeOf(event) >= timeOf(best)) best = event;
  }
  return getTypeStyle(best.type).family;
}

/**
 * The family a cluster wears, and how much it holds.
 *
 * The most common family, not the newest one. A cluster can span half of
 * Götaland and two hundred incidents; which of them happens to be the most
 * recent says nothing about the pile, whereas what it is mostly made of does.
 * Ties go to the newer, so the colour is at least stable rather than dependent
 * on map iteration order.
 */
export interface ClusterSummary {
  /** Incidents, not markers: a cluster of 5 markers can hold 60 notices. */
  count: number;
  family: TypeFamilyKey;
  /** Something in here arrived within the last hour. */
  recent: boolean;
}

export function summariseCluster(groups: MarkerGroup[], now: number, recentMs: number): ClusterSummary {
  const counts = new Map<TypeFamilyKey, { total: number; newest: number }>();
  let count = 0;
  let newest = 0;

  for (const group of groups) {
    count += group.events.length;
    if (group.newest > newest) newest = group.newest;

    for (const event of group.events) {
      const family = getTypeStyle(event.type).family;
      const seen = counts.get(family) ?? { total: 0, newest: 0 };
      seen.total += 1;
      seen.newest = Math.max(seen.newest, timeOf(event));
      counts.set(family, seen);
    }
  }

  let family: TypeFamilyKey = 'unknown';
  let best = { total: -1, newest: -1 };
  for (const [key, seen] of counts) {
    if (seen.total > best.total || (seen.total === best.total && seen.newest > best.newest)) {
      best = seen;
      family = key;
    }
  }

  return { count, family, recent: now - newest < recentMs };
}

/**
 * How wide a bubble is for a given number of incidents.
 *
 * Wide enough for the number it has to hold, and no wider. 28 rather than 24 at
 * the bottom because 24 is exactly the WCAG 2.5.8 minimum, which leaves no
 * headroom when two markers overlap by a pixel.
 */
export function bubbleSize(count: number): number {
  if (count < 10) return 28;
  if (count < 100) return 34;
  if (count < 1000) return 42;
  return 50;
}
