/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawEvent } from '@/types';

let tempDir: string;
let db: typeof import('@/lib/db');

/**
 * The map used to ask for the newest 500 notices in the window and then say
 * "500 händelser den senaste månaden" about them. The feed runs near 45 a day,
 * so a month is roughly 1,300-1,700: the label was exactly the cap, looked
 * like a total, and hid the older two thirds of the period with nothing on the
 * page saying so.
 */
const MONTHS = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];

/**
 * n notices spread evenly back over the given number of days.
 *
 * The title has to carry the real date and time: insertEvent parses event_time
 * out of it rather than from `datetime`, and the window filter reads
 * event_time. A fixed title puts every row on one day, and the identical text
 * then collapses them all to a handful through the content-hash dedup — which
 * is exactly what a first attempt at this test did.
 */
function seed(count: number, spreadDays: number): void {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.now() - ((i + 0.5) / count) * spreadDays * 24 * 60 * 60 * 1000);
    const stamp =
      `${at.getDate()} ${MONTHS[at.getMonth()]} ` +
      `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    db.insertEvent({
      id: i + 1,
      name: `${stamp}, Stöld, Ljungby`,
      summary: `Notis nummer ${i + 1}.`,
      url: `/e/${i + 1}/`,
      type: 'Stöld',
      datetime: at.toISOString(),
      location: { name: 'Kronobergs län', gps: '56.75,14.50' },
    } as RawEvent);
  }
  db.invalidateAggregateCaches();
}

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-mapwin-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const monthAgo = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('what the map is given for a window', () => {
  it('returns every notice in the window when they fit', () => {
    seed(400, 30);

    const { rows, total } = db.getMapEvents({}, monthAgo());
    expect(rows).toHaveLength(400);
    expect(total).toBe(400);
  });

  // A month at the feed's real rate has to arrive whole. This is the number
  // the old cap of 500 was cutting into a third.
  it('carries a full month at the rate the feed actually runs', () => {
    seed(1700, 30);

    const { rows, total } = db.getMapEvents({}, monthAgo());
    expect(rows).toHaveLength(1700);
    expect(total).toBe(1700);
  });

  it('still refuses to answer without a bound', () => {
    seed(3200, 30);

    const { rows, total } = db.getMapEvents({}, monthAgo());
    // Capped, because this endpoint is public and unauthenticated and an
    // unbounded query is how the feed's paging became a denial of service.
    expect(rows.length).toBe(3000);
    // But the true size of the window comes back with it, which is what lets
    // the map say it is showing a slice instead of implying a total.
    expect(total).toBe(3200);
    expect(total).toBeGreaterThan(rows.length);
  });

  it('keeps the window, so a day is a day and not the newest of everything', () => {
    seed(1200, 30);

    const day = db.getMapEvents({}, new Date(Date.now() - 24 * 60 * 60 * 1000));
    const month = db.getMapEvents({}, monthAgo());

    expect(day.rows.length).toBeGreaterThan(0);
    expect(day.rows.length).toBeLessThan(month.rows.length);
    expect(day.total).toBe(day.rows.length);
  });
});
