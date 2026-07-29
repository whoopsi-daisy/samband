import fs from 'fs';
import readline from 'readline';
import { Readable, Transform } from 'stream';
import { mapApiEvent } from './brottsplatskartan';
import {
  insertBpkEvents,
  countBpkEvents,
  updateBpkImportState,
  getNewestStoredPubdateUnix,
  type BpkEventInput,
} from './brottsplatskartanDb';
import { resolveImportSource, type ResolvedImportSource } from './importSource';

// Import a newline-delimited JSON dump of brottsplatskartan events.
//
// One event per line, exactly as the API's `data[]` entries are shaped. Lines
// carry far more fields than this app stores (teasers, viewport corners, map
// images); they are dropped and the applicable ones are written, because rows
// go through the same mapper as the live import: both paths store identical
// data.
//
// This is the fastest and kindest way to load the archive: a dump someone has
// already taken costs the site nothing, and reading a local file beats ~670
// paginated requests.
//
// Streamed line by line: the full archive is a few hundred MB and must never
// be held in memory at once.

const BATCH_SIZE = 1000;
// How often progress is reported to the caller and written to the database.
// Every batch would be ~330 updates for the full archive with nothing to show
// between them; a wall-clock interval keeps the dashboard moving smoothly.
const PROGRESS_INTERVAL_MS = 400;
const STATE_WRITE_INTERVAL_MS = 2000;

export interface NdjsonImportOptions {
  /** File path (absolute, or relative to the data directory) or an http(s) URL. */
  source: string;
  signal?: AbortSignal;
  onProgress?: (progress: NdjsonProgress) => void;
  /** False for sources arriving over HTTP; see importSource.ts. */
  allowAnyPath?: boolean;
}

export interface NdjsonProgress {
  linesRead: number;
  imported: number;
  duplicates: number;
  malformed: number;
  /** Lines that parsed as JSON but had no usable id or date. */
  unusable: number;
  bytesRead: number;
  /** File size, or Content-Length. Null when the server does not say. */
  bytesTotal: number | null;
}

export interface NdjsonImportResult extends NdjsonProgress {
  storedTotal: number;
  source: string;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

interface OpenedSource {
  stream: NodeJS.ReadableStream;
  bytesTotal: number | null;
}

async function openSource(source: ResolvedImportSource, signal?: AbortSignal): Promise<OpenedSource> {
  if (source.kind === 'url') {
    const response = await fetch(source.value, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source.value}`);
    }
    if (!response.body) {
      throw new Error(`No response body from ${source.value}`);
    }
    const declared = Number(response.headers.get('content-length'));
    return {
      // Web ReadableStream -> Node stream, so readline can consume it.
      stream: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      // Absent for chunked or compressed responses; progress then reports
      // lines and rows instead of a percentage.
      bytesTotal: Number.isFinite(declared) && declared > 0 ? declared : null,
    };
  }

  return {
    // Read as bytes, not text: the counter below measures bytes, and decoding
    // is left to the counter's readable side so multi-byte characters are
    // never split across chunk boundaries (Swedish text is full of them).
    stream: fs.createReadStream(source.value),
    bytesTotal: fs.statSync(source.value).size,
  };
}

export async function importNdjson(options: NdjsonImportOptions): Promise<NdjsonImportResult> {
  const { signal } = options;

  let linesRead = 0;
  let imported = 0;
  let duplicates = 0;
  let malformed = 0;
  let unusable = 0;
  let bytesRead = 0;
  let bytesTotal: number | null = null;
  let batch: BpkEventInput[] = [];

  const flush = (): void => {
    if (batch.length === 0) return;
    const result = insertBpkEvents(batch);
    imported += result.inserted;
    duplicates += result.duplicates;
    batch = [];
  };

  const snapshot = (): NdjsonProgress => ({
    linesRead,
    imported,
    duplicates,
    malformed,
    unusable,
    bytesRead,
    bytesTotal,
  });

  let lastProgressAt = 0;
  let lastStateWriteAt = 0;

  // Progress is reported on every batch: a fast dump would otherwise finish
  // between two ticks of the interval and never report at all, and on the
  // interval in between, so a slow source still looks alive.
  const report = (persist = false): void => {
    const now = Date.now();
    if (!persist && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
    lastProgressAt = now;

    // Persisted as well as reported, so a dashboard that reloads mid-import
    // (or a second process reading the same database) sees it advancing.
    if (persist || now - lastStateWriteAt >= STATE_WRITE_INTERVAL_MS) {
      lastStateWriteAt = now;
      updateBpkImportState({ imported, duplicates });
    }

    options.onProgress?.(snapshot());
  };

  updateBpkImportState({
    status: 'running',
    mode: 'ndjson',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
    imported: 0,
    duplicates: 0,
  });

  // Opened inside the try so a missing file or a failed fetch is recorded as a
  // failed run rather than leaving the state stuck at 'running'.
  let opened: OpenedSource | undefined;
  let counter: Transform | undefined;
  let lines: readline.Interface | undefined;
  let resolvedLabel = options.source;

  try {
    const resolved = resolveImportSource(options.source, { allowAnyPath: options.allowAnyPath !== false });
    resolvedLabel = resolved.label;
    opened = await openSource(resolved, signal);
    bytesTotal = opened.bytesTotal;

    counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesRead += chunk.length;
        callback(null, chunk);
      },
    });
    // Decode on the readable side so readline receives whole characters.
    counter.setEncoding('utf8');
    opened.stream.on('error', (error) => counter?.destroy(error));
    opened.stream.pipe(counter);

    lines = readline.createInterface({ input: counter, crlfDelay: Infinity });
    report(true);

    for await (const line of lines) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      linesRead++;
      const trimmed = line.trim();
      if (trimmed === '') continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // A truncated or corrupt line should not abort a 333k-line import.
        malformed++;
        continue;
      }

      const mapped = mapApiEvent(parsed as Parameters<typeof mapApiEvent>[0]);
      if (!mapped) {
        unusable++;
        continue;
      }

      batch.push(mapped);
      if (batch.length >= BATCH_SIZE) {
        flush();
        report(true);
      } else {
        report();
      }
    }

    flush();

    const storedTotal = countBpkEvents();
    updateBpkImportState({
      status: 'complete',
      finishedAt: new Date().toISOString(),
      imported,
      duplicates,
      // A dump has no page cursor; a later API run should start from the top.
      lastPageDone: 0,
      // Watermark for the incremental sync that follows a dump.
      newestPubdateUnix: getNewestStoredPubdateUnix(),
      // total_events deliberately untouched: it means "what the API says
      // exists", and a dump cannot answer that. Writing the row count here
      // would report 100% coverage for a dump of unknown completeness.
    });
    report(true);

    return { ...snapshot(), storedTotal, source: resolvedLabel };
  } catch (error) {
    flush();
    updateBpkImportState({
      status: isAbortError(error) ? 'cancelled' : 'failed',
      finishedAt: new Date().toISOString(),
      imported,
      duplicates,
      lastError: isAbortError(error) ? null : (error as Error).message?.slice(0, 500),
    });
    report(true);
    throw error;
  } finally {
    lines?.close();
    // Release the socket or file handle even on an early exit.
    counter?.destroy();
    const stream = opened?.stream;
    if (stream && 'destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
  }
}
