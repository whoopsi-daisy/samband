import { FormattedEvent, TypeFamilyKey, getTypeStyle } from '@/types';

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
  events: FormattedEvent[];
  /** Most recent incident here, as epoch ms. */
  newest: number;
}

export function timeOf(event: FormattedEvent): number {
  const ts = new Date(event.date?.iso || event.datetime).getTime();
  return isNaN(ts) ? 0 : ts;
}

export function groupByPosition(events: FormattedEvent[]): MarkerGroup[] {
  const groups = new Map<string, MarkerGroup>();

  for (const e of events) {
    if (!e.gps) continue;
    const [lat, lng] = e.gps.split(',').map(Number);
    if (isNaN(lat) || isNaN(lng)) continue;

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
