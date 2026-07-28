/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';

// Built from a real captured API page so the lines under test have the exact
// shape a genuine dump has.
const realPage = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/bpk-events-page1.json'), 'utf8')
) as { data: Array<Record<string, unknown>> };

let tempDir: string;
let ndjson: typeof import('@/lib/brottsplatskartanNdjson');
let bpk: typeof import('@/lib/brottsplatskartan');
let bpkDb: typeof import('@/lib/brottsplatskartanDb');
let db: typeof import('@/lib/db');

function writeDump(lines: string[]): string {
  const file = path.join(tempDir, 'dump.ndjson');
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

// `count` events derived from the real page, newest first, ids descending
// from `startId` so they mirror how the archive is actually numbered.
function realEventLines(count: number, startId = 500_000): string[] {
  return Array.from({ length: count }, (_, i) => {
    const template = realPage.data[i % realPage.data.length];
    const unix = 1_785_171_476 - i * 60;
    return JSON.stringify({
      ...template,
      id: startId - i,
      pubdate_unix: String(unix),
      pubdate_iso8601: new Date(unix * 1000).toISOString(),
    });
  });
}

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-ndj-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  db = await import('@/lib/db');
  bpk = await import('@/lib/brottsplatskartan');
  bpkDb = await import('@/lib/brottsplatskartanDb');
  ndjson = await import('@/lib/brottsplatskartanNdjson');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('importNdjson', () => {
  it('imports a dump of real-shaped events', async () => {
    const file = writeDump(realEventLines(250));
    const result = await ndjson.importNdjson({ source: file });

    expect(result.imported).toBe(250);
    expect(result.storedTotal).toBe(250);
    expect(bpkDb.countBpkEvents()).toBe(250);
  });

  it('stores the same fields the live import would', async () => {
    const file = writeDump([JSON.stringify(realPage.data[0])]);
    await ndjson.importNdjson({ source: file });

    const row = db
      .getDatabase()
      .prepare('SELECT id, pubdate, title_type, county, lat, lng, permalink FROM bpk_events')
      .get() as Record<string, unknown>;

    expect(row).toMatchObject({
      id: 506859,
      // Same UTC normalisation as every other timestamp in the database.
      pubdate: '2026-07-27T16:57:56.000Z',
      title_type: 'Trafikbrott',
      county: 'Stockholms län',
    });
    expect(row.lat).toBeCloseTo(59.2443327, 5);
  });

  it('survives corrupt lines instead of aborting a 333k-line file', async () => {
    const file = writeDump([
      ...realEventLines(10),
      '{"id": 42, "pubdate_unix": "17851"', // truncated JSON
      '',
      'not json at all',
      ...realEventLines(10, 400_000),
    ]);

    const result = await ndjson.importNdjson({ source: file });

    expect(result.malformed).toBe(2);
    // Everything either side of the corruption still landed.
    expect(result.imported).toBe(20);
    expect(bpkDb.countBpkEvents()).toBe(20);
  });

  it('skips records with no usable id or date rather than storing partials', async () => {
    const file = writeDump([
      ...realEventLines(5),
      JSON.stringify({ id: 999_999, headline: 'no date' }),
      JSON.stringify({ pubdate_unix: '1785171476', headline: 'no id' }),
    ]);

    const result = await ndjson.importNdjson({ source: file });

    expect(result.unusable).toBe(2);
    expect(result.imported).toBe(5);
  });

  it('imports a real dump line, keeping the applicable fields and dropping the rest', async () => {
    // The exact bytes of a four-line export from the operator's mirror script.
    const dump = path.join(tempDir, 'bpk-dump-sample.ndjson');
    fs.copyFileSync(path.join(__dirname, 'fixtures/bpk-dump-sample.ndjson'), dump);

    const result = await ndjson.importNdjson({ source: dump });
    expect(result.imported).toBe(4);

    const row = db
      .getDatabase()
      .prepare('SELECT * FROM bpk_events WHERE id = 506862')
      .get() as Record<string, unknown>;

    expect(row).toMatchObject({
      id: 506862,
      pubdate: '2026-07-27T19:57:53.000Z',
      pubdate_unix: 1785182273,
      title_type: 'Misshandel,  grov',
      title_location: 'Hörby',
      headline: 'Flicka i 15-årsåldern grips misstänkt för grov misshandel.',
      location_string: 'Hörby, Skåne län',
      county: 'Skåne län',
      permalink: 'https://brottsplatskartan.se/skane-lan/misshandel-grov-horby-506862',
      external_source_link:
        'https://polisen.se/aktuellt/handelser/2026/juli/27/27-juli-20.22-misshandel-grov-horby/',
    });
    expect(row.lat).toBeCloseTo(55.8508109, 5);
    expect(row.lng).toBeCloseTo(13.6599486, 5);

    // Swedish characters survive the byte-counting stream in one piece.
    expect(row.content).toContain('centrala delen av Hörby');

    // The dump carries teasers, viewport corners, map images and a relative
    // "4 timmar sedan"; none of that belongs in the database.
    expect(Object.keys(row).sort()).toEqual([
      'content',
      'county',
      'description',
      'external_source_link',
      'headline',
      'id',
      'imported_at',
      'lat',
      'lng',
      'location_string',
      'permalink',
      'pubdate',
      'pubdate_unix',
      'title_location',
      'title_type',
    ]);
  });

  it('reports progress against the size of the dump', async () => {
    const file = writeDump(realEventLines(3000));
    const size = fs.statSync(file).size;
    const updates: Array<{ bytesRead: number; bytesTotal: number | null; imported: number }> = [];

    const result = await ndjson.importNdjson({
      source: file,
      onProgress: (p) => updates.push({ bytesRead: p.bytesRead, bytesTotal: p.bytesTotal, imported: p.imported }),
    });

    expect(updates.length).toBeGreaterThan(1);
    expect(updates.every((u) => u.bytesTotal === size)).toBe(true);
    // Monotonic, and it ends on the whole file having been read.
    for (let i = 1; i < updates.length; i++) {
      expect(updates[i].bytesRead).toBeGreaterThanOrEqual(updates[i - 1].bytesRead);
    }
    expect(result.bytesRead).toBe(size);
    expect(result.imported).toBe(3000);
  });

  it('writes counters to the database while it runs, not only at the end', async () => {
    const file = writeDump(realEventLines(4000));
    let seenRunning: { status: string; imported: number } | null = null;

    await ndjson.importNdjson({
      source: file,
      onProgress: () => {
        if (seenRunning) return;
        const state = bpkDb.getBpkImportState();
        // Grab the first sighting where the run has recorded rows mid-flight.
        if (state.status === 'running' && state.imported > 0) {
          seenRunning = { status: state.status, imported: state.imported };
        }
      },
    });

    expect(seenRunning).not.toBeNull();
    expect(bpkDb.getBpkImportState()).toMatchObject({ status: 'complete', imported: 4000, mode: 'ndjson' });
  });

  it('resolves a bare name against the data directory', async () => {
    fs.writeFileSync(path.join(tempDir, 'archive.ndjson'), realEventLines(5).join('\n') + '\n', 'utf8');

    const result = await ndjson.importNdjson({ source: 'archive.ndjson' });

    expect(result.imported).toBe(5);
    expect(result.source).toBe('archive.ndjson');
  });

  it('is idempotent — re-importing the same dump stores nothing new', async () => {
    const file = writeDump(realEventLines(100));

    await ndjson.importNdjson({ source: file });
    const second = await ndjson.importNdjson({ source: file });

    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(100);
    expect(bpkDb.countBpkEvents()).toBe(100);
  });

  it('streams from an http URL', async () => {
    const body = realEventLines(120).join('\n') + '\n';
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const result = await ndjson.importNdjson({ source: `http://127.0.0.1:${port}/dump.ndjson` });
      expect(result.imported).toBe(120);
      expect(bpkDb.countBpkEvents()).toBe(120);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reports a failed fetch rather than silently importing nothing', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end('nope');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      await expect(ndjson.importNdjson({ source: `http://127.0.0.1:${port}/missing` })).rejects.toThrow(/404/);
      expect(bpkDb.getBpkImportState().status).toBe('failed');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reports a missing file clearly', async () => {
    await expect(ndjson.importNdjson({ source: '/no/such/dump.ndjson' })).rejects.toThrow(/No such file/);
  });

  it('leaves the polisen.se events table untouched', async () => {
    db.insertEvent({
      id: 5,
      name: 'Polisen 5',
      summary: 'Live',
      url: '',
      type: 'Brand',
      datetime: '2026-07-27T09:00:00.000Z',
      location: { name: 'Lund', gps: '' },
    } as Parameters<typeof db.insertEvent>[0]);
    const before = db.getEventsFromDb({}, 10, 0);

    await ndjson.importNdjson({ source: writeDump(realEventLines(50)) });

    expect(db.getEventsFromDb({}, 10, 0)).toEqual(before);
    expect(db.countEventsInDb()).toBe(1);
  });
});

describe('dump followed by an incremental API sync', () => {
  // The intended workflow: seed the archive from a dump, then keep it current
  // from the API without re-walking 333k events.
  it('pulls only what was published after the dump', async () => {
    // Dump holds ids 500000 down to 499901 (100 events).
    await ndjson.importNdjson({ source: writeDump(realEventLines(100)) });
    expect(bpkDb.countBpkEvents()).toBe(100);

    const newestInDump = bpkDb.getNewestStoredPubdateUnix()!;

    // The API now has 5 newer events on top of those 100.
    const total = 105;
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      const page = Number(url.searchParams.get('page') ?? '1');
      const limit = Number(url.searchParams.get('limit') ?? '10');
      const start = (page - 1) * limit;
      const count = Math.max(0, Math.min(limit, total - start));
      const data = Array.from({ length: count }, (_, i) => {
        const offset = start + i;
        // offset 0..4 are the new ones, then the dump's events.
        const unix = newestInDump + (5 - offset) * 60;
        return { id: 500_005 - offset, pubdate_unix: String(unix) };
      });
      return new Response(
        JSON.stringify({
          links: { current_page: page, last_page: Math.ceil(total / limit), per_page: limit, total },
          data,
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const result = await bpk.importBrottsplatskartan({ mode: 'incremental', concurrency: 1 });

    expect(result.imported).toBe(5);
    expect(bpkDb.countBpkEvents()).toBe(105);
  });
});
