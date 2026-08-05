/**
 * @jest-environment node
 */
import {
  bubbleSize,
  familyOfGroup,
  groupByPosition,
  hasPosition,
  isPlottable,
  summariseCluster,
  type MarkerGroup,
} from '@/lib/markerGroups';
import type { MapEvent } from '@/types';

const RECENT_MS = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-03T12:00:00.000Z');

const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function event(type: string, gps: string, minutesAgo = 120): MapEvent {
  return {
    gps,
    type,
    place: 'Ljungby',
    location: 'Kronobergs län',
    url: '',
    iso: at(minutesAgo),
  };
}

describe('grouping incidents by position', () => {
  it('merges float noise at the same spot', () => {
    const groups = groupByPosition([
      event('Stöld', '56.83291,13.94104'),
      event('Brand', '56.83294,13.94101'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].events).toHaveLength(2);
  });

  it('keeps genuinely different positions apart', () => {
    const groups = groupByPosition([event('Stöld', '56.8329,13.9410'), event('Brand', '55.6050,13.0038')]);
    expect(groups).toHaveLength(2);
  });

  it('drops anything with no usable coordinate', () => {
    expect(groupByPosition([event('Stöld', ''), event('Brand', 'not,coords')])).toEqual([]);
  });

  // Freshest last, so Leaflet paints it over the older ones rather than under.
  it('orders oldest first so the newest is drawn on top', () => {
    const groups = groupByPosition([
      event('Stöld', '59.3293,18.0686', 10),
      event('Brand', '55.6050,13.0038', 600),
    ]);

    expect(groups[0].newest).toBeLessThan(groups[1].newest);
  });
});

describe('what colour a position wears', () => {
  // One position is one place. On a map of what is happening now, the most
  // recent thing there is the one worth showing.
  it('takes the newest incident at the spot', () => {
    const [group] = groupByPosition([
      event('Stöld', '56.8329,13.9410', 600),
      event('Trafikolycka', '56.8329,13.9410', 5),
      event('Stöld', '56.8329,13.9410', 400),
    ]);

    expect(familyOfGroup(group)).toBe('traffic');
  });
});

describe('what colour a cluster wears', () => {
  const group = (types: string[], minutesAgo = 120): MarkerGroup => {
    const events = types.map((t) => event(t, '56.8329,13.9410', minutesAgo));
    return { lat: 56.8329, lng: 13.941, events, newest: NOW - minutesAgo * 60_000 };
  };

  /*
   * The most common family, deliberately not the newest.
   *
   * A cluster can span half of Götaland and two hundred incidents. Which of
   * them happens to be the most recent says nothing about the pile; what it is
   * mostly made of does. A position group is the opposite case and uses the
   * opposite rule, which is the whole reason the two are separate functions.
   */
  it('takes the family it mostly holds, not the newest one', () => {
    const summary = summariseCluster(
      [group(['Stöld', 'Stöld', 'Stöld']), group(['Trafikolycka'], 1)],
      NOW,
      RECENT_MS
    );

    expect(summary.family).toBe('theft');
  });

  it('breaks a tie towards the more recent family', () => {
    const summary = summariseCluster([group(['Stöld'], 600), group(['Trafikolycka'], 5)], NOW, RECENT_MS);
    expect(summary.family).toBe('traffic');
  });

  // A cluster of five markers can hold sixty notices, and the number on it has
  // to be the notices. Counting markers would quietly under-report the country.
  it('counts incidents, not markers', () => {
    const summary = summariseCluster(
      [group(['Stöld', 'Brand']), group(['Rån', 'Rån', 'Rån'])],
      NOW,
      RECENT_MS
    );

    expect(summary.count).toBe(5);
  });

  it('is marked recent when anything inside it is', () => {
    expect(summariseCluster([group(['Stöld'], 600), group(['Brand'], 5)], NOW, RECENT_MS).recent).toBe(
      true
    );
    expect(summariseCluster([group(['Stöld'], 600)], NOW, RECENT_MS).recent).toBe(false);
  });

  it('survives a cluster it was handed nothing for', () => {
    const summary = summariseCluster([], NOW, RECENT_MS);
    expect(summary.count).toBe(0);
    expect(summary.family).toBe('unknown');
  });
});

describe('how big a bubble gets', () => {
  // Never below 28: 24 is exactly the WCAG 2.5.8 minimum, and two markers that
  // overlap by a pixel would put a 24px target under it.
  it('always leaves headroom over the target-size minimum', () => {
    for (const count of [1, 2, 9, 10, 99, 100, 999, 1000, 50_000]) {
      expect(bubbleSize(count)).toBeGreaterThanOrEqual(28);
    }
  });

  it('grows with the digits it has to hold, and stops', () => {
    expect(bubbleSize(9)).toBeLessThan(bubbleSize(10));
    expect(bubbleSize(99)).toBeLessThan(bubbleSize(100));
    expect(bubbleSize(1000)).toBe(bubbleSize(50_000));
  });
});

/*
 * Coordinates that are not positions.
 *
 * `isNaN` was the whole guard, and 0/0 is not a NaN. Brottsplatskartan writes
 * zeroes for a notice it could not geocode rather than leaving the columns
 * empty, and that is 10.7% of the imported record — around 29,000 notices. The
 * archive is reachable from the map whenever the window reaches back past the
 * live feed, which a month-long view does, so those drew as a cluster in the
 * Gulf of Guinea. Because the map fits its bounds to the markers it is handed,
 * one of them was enough to stretch the viewport from Sweden to the equator.
 */
describe('coordinates that cannot be plotted', () => {
  const at = (gps: string): MapEvent => ({
    gps,
    type: 'Stöld',
    place: '',
    location: 'Skåne län',
    url: '/e/1/',
    iso: new Date().toISOString(),
  });

  it('refuses the ungeocoded zero pair', () => {
    expect(isPlottable(0, 0)).toBe(false);
    expect(hasPosition(at('0.0,0.0'))).toBe(false);
    expect(hasPosition(at('0,0'))).toBe(false);
  });

  it('still accepts a real position', () => {
    expect(isPlottable(55.5110494, 13.2397277)).toBe(true);
    expect(hasPosition(at('55.5110494,13.2397277'))).toBe(true);
  });

  // A zero on one axis only is somewhere off the coast of Africa too, but it is
  // a real point on the globe, so only the pair is rejected.
  it('keeps a genuine zero on one axis', () => {
    expect(isPlottable(0, 13.2)).toBe(true);
  });

  it('refuses what is not a number or not on the globe', () => {
    expect(hasPosition(at('inte,ett,tal'))).toBe(false);
    expect(hasPosition(at(''))).toBe(false);
    expect(isPlottable(91, 10)).toBe(false);
    expect(isPlottable(60, 181)).toBe(false);
  });

  // The consequence that mattered: one bad row must not reach the grouping,
  // because everything downstream of it sets the viewport.
  it('keeps them out of the marker groups entirely', () => {
    const groups = groupByPosition([at('0.0,0.0'), at('55.6,13.0'), at('0.0,0.0')]);

    expect(groups).toHaveLength(1);
    expect(groups[0].lat).toBeCloseTo(55.6);
  });

  // Not a Sweden bounding box: a notice genuinely filed just over a border
  // should still draw, and silently dropping it would be its own bug.
  it('does not fence the map to Sweden', () => {
    expect(isPlottable(59.91, 10.75)).toBe(true); // Oslo
    expect(isPlottable(55.68, 12.57)).toBe(true); // Copenhagen
  });
});
