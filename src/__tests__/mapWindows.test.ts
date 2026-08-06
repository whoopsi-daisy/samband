/**
 * @jest-environment node
 */
import {
  DEFAULT_MAP_WINDOW_DAYS,
  MAP_WINDOWS,
  MAP_WINDOW_DAYS,
  MAX_MAP_WINDOW_DAYS,
  mapWindowFor,
} from '@/lib/mapWindows';

/**
 * The periods the map offers were declared in EventMap.tsx and then restated in
 * pieces elsewhere: the API route carried its own MAX_WINDOW_DAYS = 30 with its
 * own copy of the reasoning for it. A period added to the control has to be
 * offered, linkable, prefetched and allowed by the endpoint without a second
 * edit, and these hold the derived values to that.
 */
describe('the map windows', () => {
  it('offers the days its list names, in order', () => {
    expect(MAP_WINDOW_DAYS).toEqual(MAP_WINDOWS.map((w) => w.days));
    expect([...MAP_WINDOW_DAYS].sort((a, b) => a - b)).toEqual(MAP_WINDOW_DAYS);
  });

  it('bounds the endpoint by the longest period on offer', () => {
    expect(MAX_MAP_WINDOW_DAYS).toBe(Math.max(...MAP_WINDOW_DAYS));
    // The far end is a month; see the note on MAP_WINDOWS for why the decade in
    // the database belongs to the statistics page and not to a map.
    expect(MAX_MAP_WINDOW_DAYS).toBe(30);
  });

  it('defaults to the shortest period', () => {
    expect(DEFAULT_MAP_WINDOW_DAYS).toBe(MAP_WINDOW_DAYS[0]);
  });

  it('names every period in Swedish, article included', () => {
    for (const window of MAP_WINDOWS) {
      expect(window.label).not.toBe('');
      // The phrase is dropped into a sentence ("Inga händelser ... det senaste
      // dygnet"), so it has to carry its own article.
      expect(window.phrase).toMatch(/^(det|den) /);
    }
  });

  it('falls back to the default rather than to undefined', () => {
    expect(mapWindowFor(7).days).toBe(7);
    expect(mapWindowFor(999)).toBe(MAP_WINDOWS[0]);
    expect(mapWindowFor(NaN)).toBe(MAP_WINDOWS[0]);
  });
});
