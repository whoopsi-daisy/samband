/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// These fixtures are real captured responses from brottsplatskartan.se, not
// hand-written approximations. The synthetic fake in brottsplatskartan.test.ts
// checks the import *logic*; this file checks that the mapper actually agrees
// with the shape the live API returns.
const page1 = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/bpk-events-page1.json'), 'utf8')
) as { links: Record<string, unknown>; data: Array<Record<string, unknown>> };

const legacySingle = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/bpk-single-event-legacy.json'), 'utf8')
) as { data: Record<string, unknown> };

let tempDir: string;
let bpk: typeof import('@/lib/brottsplatskartan');
let bpkDb: typeof import('@/lib/brottsplatskartanDb');

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-fx-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  bpk = await import('@/lib/brottsplatskartan');
  bpkDb = await import('@/lib/brottsplatskartanDb');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('real API response', () => {
  it('maps every event on a captured page without dropping any', () => {
    const mapped = page1.data.map((e) => bpk.mapApiEvent(e));
    expect(mapped).toHaveLength(10);
    expect(mapped.every((m) => m !== null)).toBe(true);
  });

  it('extracts the fields the schema stores', () => {
    const mapped = bpk.mapApiEvent(page1.data[0])!;

    expect(mapped).toMatchObject({
      id: 506859,
      titleType: 'Trafikbrott',
      titleLocation: 'Huddinge',
      locationString: 'Fullersta, Huddinge, Stockholms län',
      county: 'Stockholms län',
    });
    expect(mapped.lat).toBeCloseTo(59.2443327, 5);
    expect(mapped.lng).toBeCloseTo(17.9684741, 5);
    expect(mapped.permalink).toContain('brottsplatskartan.se');
    expect(mapped.externalSourceLink).toContain('polisen.se');
  });

  it('converts the local-offset pubdate to UTC', () => {
    // The API sends 2026-07-27T18:57:56+02:00.
    const mapped = bpk.mapApiEvent(page1.data[0])!;
    expect(mapped.pubdate).toBe('2026-07-27T16:57:56.000Z');
    expect(mapped.pubdateUnix).toBe(1785171476);
  });

  it('round-trips a real page through the database', () => {
    const mapped = page1.data
      .map((e) => bpk.mapApiEvent(e))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const result = bpkDb.insertBpkEvents(mapped);
    expect(result.inserted).toBe(10);
    expect(bpkDb.countBpkEvents()).toBe(10);

    const stored = bpkDb.getRecentBpkEvents(10);
    // Newest first, matching how the API serves them.
    expect(stored[0].id).toBe(506859);
    expect(stored[0].county).toBe('Stockholms län');
    expect(stored).toHaveLength(10);
  });

  it('is idempotent against the same real page', () => {
    const mapped = page1.data
      .map((e) => bpk.mapApiEvent(e))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    bpkDb.insertBpkEvents(mapped);
    const second = bpkDb.insertBpkEvents(mapped);

    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(10);
    expect(bpkDb.countBpkEvents()).toBe(10);
  });

  it('handles the legacy single-event shape, which has no pubdate_iso8601', () => {
    // /api/event/{id} serialises older records with parsed_date instead. The
    // importer does not use that endpoint, but the fallback means such a record
    // is stored rather than silently dropped if it ever appears in a listing.
    const raw = legacySingle.data;
    expect(raw.pubdate_iso8601).toBeUndefined();
    expect(raw.parsed_date).toBe('2016-10-14 21:27:00');

    const mapped = bpk.mapApiEvent(raw);
    expect(mapped).not.toBeNull();
    expect(mapped!.id).toBe(1);
    expect(mapped!.pubdate.startsWith('2016-10-14')).toBe(true);
  });
});

describe('captured pagination metadata', () => {
  it('matches what the importer reads to plan a run', () => {
    // Confirms the field names probeApi() depends on still exist.
    expect(page1.links).toMatchObject({
      current_page: 1,
      per_page: 10,
    });
    expect(typeof page1.links.total).toBe('number');
    expect(typeof page1.links.last_page).toBe('number');
  });

  it("uses 'limit' as the page-size parameter, per the API's own URLs", () => {
    // The response advertises per_page but the URLs it builds use limit:
    // sending per_page is ignored and silently yields 10 events per request.
    const firstPageUrl = String(page1.links.first_page_url);
    expect(firstPageUrl).toContain('limit=');
    expect(firstPageUrl).not.toContain('per_page=');
  });
});
