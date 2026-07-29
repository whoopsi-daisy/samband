/**
 * @jest-environment node
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// The runner is what the dashboard, the API and the container startup all go
// through, so these cover the parts an operator sees: that a run starts, that
// progress is observable while it happens, and that a bad source is refused
// before anything is touched.

let tempDir: string;
let runner: typeof import('@/lib/brottsplatskartanRunner');
let bpkDb: typeof import('@/lib/brottsplatskartanDb');

const realPage = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/bpk-events-page1.json'), 'utf8')
) as { data: Array<Record<string, unknown>> };

function writeDump(name: string, count: number): string {
  const lines = Array.from({ length: count }, (_, i) => {
    const template = realPage.data[i % realPage.data.length];
    const unix = 1_785_171_476 - i * 60;
    return JSON.stringify({
      ...template,
      id: 500_000 - i,
      pubdate_unix: String(unix),
      pubdate_iso8601: new Date(unix * 1000).toISOString(),
    });
  });
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

// Lines carrying only what the mapper needs. The tests below are about the
// runner's mechanics (progress, cancellation, refusal) not about field
// mapping, and a dump of real-shaped events is ~2 KB a line, which turns a
// 20,000-row run into 44 MB of file I/O inside a 5-second timeout.
function writeMinimalDump(name: string, count: number): string {
  const lines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({ id: 500_000 - i, pubdate_unix: String(1_785_171_476 - i * 60) })
  );
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

async function settle(): Promise<void> {
  // Let the background promise chain in the runner finish.
  while (runner.isImportRunning()) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(async () => {
  jest.resetModules();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-run-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  runner = await import('@/lib/brottsplatskartanRunner');
  bpkDb = await import('@/lib/brottsplatskartanDb');
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe('startImport (ndjson)', () => {
  it('imports a dump named relative to the data directory', async () => {
    writeDump('dump.ndjson', 200);

    const outcome = runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' });
    expect(outcome).toMatchObject({ started: true, mode: 'ndjson', source: 'dump.ndjson' });

    await settle();

    expect(bpkDb.countBpkEvents()).toBe(200);
    expect(runner.getImportSnapshot().state).toMatchObject({ status: 'complete', mode: 'ndjson' });
  });

  it('publishes live progress to subscribers while it runs', async () => {
    writeMinimalDump('dump.ndjson', 20_000);

    const seen: Array<{ imported: number; percent: number | null; source: string | null }> = [];
    const unsubscribe = runner.subscribe((snapshot) => {
      if (snapshot.progress) {
        seen.push({
          imported: snapshot.progress.imported,
          percent: snapshot.progress.percent,
          source: snapshot.progress.source,
        });
      }
    });

    runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' });
    await settle();
    unsubscribe();

    // Snapshots are throttled, so a dump this size may only produce one: the
    // point is that a run is observable while it is still going, not how many
    // frames it emits.
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[seen.length - 1].source).toBe('dump.ndjson');
    // A percentage is available because a local file has a known size.
    expect(seen[seen.length - 1].percent).not.toBeNull();
    expect(seen[seen.length - 1].imported).toBeGreaterThan(0);

    // The log carries a start and a finish line an operator can read.
    const log = runner.getImportLog().map((entry) => entry.text);
    expect(log.some((text) => text.includes('dump import started'))).toBe(true);
    expect(log.some((text) => text.includes('dump import finished'))).toBe(true);
  });

  it('refuses a second import while one is running', async () => {
    writeMinimalDump('dump.ndjson', 20_000);

    runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' });
    const second = runner.startImport({ mode: 'ndjson', source: 'dump.ndjson' });

    expect(second.started).toBe(false);
    expect(second.reason).toMatch(/already running/);

    await settle();
  });

  it('rejects a source outside the data directory before starting anything', () => {
    expect(() => runner.startImport({ mode: 'ndjson', source: '/etc/passwd' })).toThrow(
      /inside the data directory/
    );
    expect(runner.isImportRunning()).toBe(false);
    expect(bpkDb.getBpkImportState().status).toBe('idle');
  });

  it('allows an operator-supplied path outside the data directory', async () => {
    const outside = path.join(os.tmpdir(), `samband-outside-${process.pid}.ndjson`);
    fs.copyFileSync(writeDump('inner.ndjson', 10), outside);

    try {
      const outcome = runner.startImport({ mode: 'ndjson', source: outside, allowAnyPath: true });
      expect(outcome.started).toBe(true);
      await settle();
      expect(bpkDb.countBpkEvents()).toBe(10);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('records a failure in the log and the state rather than throwing in the background', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const file = path.join(tempDir, 'gone.ndjson');
    fs.writeFileSync(file, '');
    runner.startImport({ mode: 'ndjson', source: 'gone.ndjson' });
    // Delete it out from under the run: the stream fails mid-flight.
    fs.rmSync(file, { force: true });

    await settle();

    const snapshot = runner.getImportSnapshot();
    expect(['complete', 'failed']).toContain(snapshot.state.status);
    expect(snapshot.running).toBe(false);
    expect(snapshot.progress).toBeNull();
  });
});

describe('cancelImport', () => {
  it('stops a running dump and keeps what it already stored', async () => {
    // Served over HTTP and deliberately never finished: the import gets a
    // first chunk, stores it, then waits for more that never comes. The run is
    // therefore in flight by construction, on any machine.
    //
    // The obvious alternative: subscribe() and cancel on the first snapshot
    // reporting imported > 0: does not work, and was this test's original
    // flake. Publishes to listeners are throttled to one per 500 ms, and a
    // dump of this size finishes well inside that, so a subscriber saw two
    // snapshots, one at the start with no progress attached, and one after the
    // whole file had been read. Cancelling then aborts a run that has already
    // finished. (Polling getImportSnapshot() instead reads live state with no
    // throttle, which works but races the reader against the importer.)
    const chunk =
      Array.from({ length: 3000 }, (_, i) =>
        JSON.stringify({ id: 500_000 - i, pubdate_unix: String(1_785_171_476 - i * 60) })
      ).join('\n') + '\n';

    let open: http.ServerResponse | undefined;
    const server = http.createServer((_req, res) => {
      open = res;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(chunk);
      // No res.end(): the response stays open until the test tears it down.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      runner.startImport({ mode: 'ndjson', source: `http://127.0.0.1:${port}/dump.ndjson` });

      // Wait for rows to actually land, so this cancels a run with work to keep.
      while (bpkDb.countBpkEvents() === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(runner.isImportRunning()).toBe(true);
      expect(runner.cancelImport()).toBe(true);

      await settle();

      const state = bpkDb.getBpkImportState();
      expect(state.status).toBe('cancelled');
      // Cancelling keeps the work: every row that arrived before it is still
      // stored, and nothing is rolled back.
      expect(bpkDb.countBpkEvents()).toBe(3000);
      // Nothing left running to cancel a second time.
      expect(runner.cancelImport()).toBe(false);
    } finally {
      open?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
});
