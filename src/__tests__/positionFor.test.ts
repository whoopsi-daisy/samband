/**
 * @jest-environment node
 */
import { formatEventForUi, positionFor } from '@/lib/utils';
import { MUNICIPALITY_CENTROIDS } from '@/lib/municipalityCentroids';
import { COUNTIES, MUNICIPALITIES } from '@/lib/regions';
import type { EventWithMetadata } from '@/types';

/**
 * polisen.se files a notice with `location.name` set to a county and
 * `location.gps` set to that county's centre. Twenty-one counties is
 * twenty-one coordinates, and the deployed map said so out loud: "380
 * händelser den senaste månaden, på 21 platser". A month of national incidents
 * drawn as twenty-one dots, each in the middle of a county.
 */

/** Kronoberg's centre, roughly, which is what the feed sends for the county. */
const KRONOBERG_GPS = '56.7500,14.5000';

describe('choosing where to draw a notice', () => {
  /** Great-circle distance in km, for judging how much a pin actually moved. */
  const km = (a: string, b: string): number => {
    const [lat1, lng1] = a.split(',').map(Number);
    const [lat2, lng2] = b.split(',').map(Number);
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };

  // Ljungby town is at 56.833, 13.941. What this returns is the centre of
  // Ljungby *municipality*, which is a few kilometres west of the town — the
  // source is a polygon centroid, not a gazetteer. That is the honest limit of
  // the improvement, and it is still an order of magnitude better than a county
  // centre that can be a hundred kilometres out.
  it('uses the municipality from the title when the feed only gave a county', () => {
    const at = positionFor('Kronobergs län', 'Ljungby', KRONOBERG_GPS);
    expect(at).not.toBe(KRONOBERG_GPS);

    expect(km(at, '56.8329,13.9410')).toBeLessThan(15);
    expect(km(KRONOBERG_GPS, '56.8329,13.9410')).toBeGreaterThan(30);
  });

  // Only ever an improvement. A feed position given at municipal level or finer
  // is better than any centroid this app can compute, and must survive.
  it('never overwrites a position the feed gave below county level', () => {
    expect(positionFor('Ljungby', 'Torpa', '56.8329,13.9410')).toBe('56.8329,13.9410');
    expect(positionFor('Stockholm', '', '59.3293,18.0686')).toBe('59.3293,18.0686');
  });

  it('leaves a county alone when the title names no municipality', () => {
    expect(positionFor('Kronobergs län', '', KRONOBERG_GPS)).toBe(KRONOBERG_GPS);
  });

  // The title often names a district, a road or a village rather than a
  // municipality. Guessing at those is how a notice ends up in the wrong place.
  it('leaves a county alone when the title names something it cannot place', () => {
    expect(positionFor('Stockholms län', 'Kista', KRONOBERG_GPS)).toBe(KRONOBERG_GPS);
    expect(positionFor('Skåne län', 'E6', KRONOBERG_GPS)).toBe(KRONOBERG_GPS);
  });

  it('ignores case and stray whitespace, which the feed has both of', () => {
    expect(positionFor('Kronobergs län', '  ljungby ', KRONOBERG_GPS)).not.toBe(KRONOBERG_GPS);
    expect(positionFor('Stockholms län', 'Upplands  Väsby', KRONOBERG_GPS)).not.toBe(KRONOBERG_GPS);
  });

  it('has a centre for every municipality the app knows by name', () => {
    const missing = COUNTIES.flatMap((county) => MUNICIPALITIES[county]).filter(
      (name) => !MUNICIPALITY_CENTROIDS.has(name.toLowerCase())
    );

    expect(missing).toEqual([]);
  });

  // A latitude/longitude swap is the classic failure and would put every
  // Swedish municipality somewhere off the Horn of Africa.
  it('has every centre inside Sweden', () => {
    for (const [name, [lat, lng]] of MUNICIPALITY_CENTROIDS) {
      expect(lat).toBeGreaterThan(55);
      expect(lat).toBeLessThan(69.5);
      expect(lng).toBeGreaterThan(10.5);
      expect(lng).toBeLessThan(24.5);
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe('what it does to a day of the feed', () => {
  const notice = (type: string, county: string, town: string, gps: string): EventWithMetadata =>
    ({
      id: Math.random(),
      name: `3 augusti 09:00, ${type}, ${town}`,
      summary: '',
      url: '/e/1/',
      type,
      datetime: '2026-08-03T09:00:00.000Z',
      event_time: '2026-08-03T09:00:00.000Z',
      location: { name: county, gps },
    }) as unknown as EventWithMetadata;

  // The whole point, measured the way the map's own status line measures it.
  it('turns one dot per county into one per town', () => {
    const feed = [
      notice('Trafikolycka', 'Kronobergs län', 'Ljungby', KRONOBERG_GPS),
      notice('Stöld', 'Kronobergs län', 'Växjö', KRONOBERG_GPS),
      notice('Brand', 'Kronobergs län', 'Älmhult', KRONOBERG_GPS),
      notice('Rån', 'Skåne län', 'Malmö', '55.9000,13.5000'),
      notice('Misshandel', 'Skåne län', 'Helsingborg', '55.9000,13.5000'),
    ];

    const before = new Set(feed.map((e) => e.location?.gps));
    const after = new Set(feed.map((e) => formatEventForUi(e).gps));

    expect(before.size).toBe(2);
    expect(after.size).toBe(5);
  });

  it('keeps the notice text untouched while it moves the pin', () => {
    const [event] = [notice('Trafikolycka', 'Kronobergs län', 'Ljungby', KRONOBERG_GPS)].map(
      formatEventForUi
    );

    expect(event.location).toBe('Kronobergs län');
    expect(event.place).toBe('Ljungby');
    expect(event.name).toContain('Ljungby');
  });
});
