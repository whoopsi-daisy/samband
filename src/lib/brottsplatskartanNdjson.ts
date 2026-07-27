import fs from 'fs';
import readline from 'readline';
import { Readable } from 'stream';
import { mapApiEvent } from './brottsplatskartan';
import { insertBpkEvents, countBpkEvents, updateBpkImportState, type BpkEventInput } from './brottsplatskartanDb';

// Import a newline-delimited JSON dump of brottsplatskartan events.
//
// One event per line, exactly as the API's `data[]` entries are shaped. This is
// the fastest and kindest way to load the archive: a dump someone has already
// taken costs the site nothing, and reading a local file beats ~670 paginated
// requests. Rows go through the same mapper as the live import, so both paths
// store identical data.
//
// Streamed line by line — the full archive is a few hundred MB and must never
// be held in memory at once.

const BATCH_SIZE = 1000;

export interface NdjsonImportOptions {
  /** File path, or an http(s) URL to stream from. */
  source: string;
  signal?: AbortSignal;
  onProgress?: (progress: NdjsonProgress) => void;
}

export interface NdjsonProgress {
  linesRead: number;
  imported: number;
  duplicates: number;
  malformed: number;
}

export interface NdjsonImportResult extends NdjsonProgress {
  /** Lines that parsed as JSON but had no usable id or date. */
  unusable: number;
  storedTotal: number;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

async function openSource(source: string, signal?: AbortSignal): Promise<NodeJS.ReadableStream> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source}`);
    }
    if (!response.body) {
      throw new Error(`No response body from ${source}`);
    }
    // Web ReadableStream -> Node stream, so readline can consume it.
    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  }

  if (!fs.existsSync(source)) {
    throw new Error(`No such file: ${source}`);
  }
  return fs.createReadStream(source, { encoding: 'utf8' });
}

export async function importNdjson(options: NdjsonImportOptions): Promise<NdjsonImportResult> {
  const { source, signal } = options;

  let linesRead = 0;
  let imported = 0;
  let duplicates = 0;
  let malformed = 0;
  let unusable = 0;
  let batch: BpkEventInput[] = [];

  const flush = (): void => {
    if (batch.length === 0) return;
    const result = insertBpkEvents(batch);
    imported += result.inserted;
    duplicates += result.duplicates;
    batch = [];
  };

  updateBpkImportState({
    status: 'running',
    mode: 'full',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
  });

  // Opened inside the try so a missing file or a failed fetch is recorded as a
  // failed run rather than leaving the state stuck at 'running'.
  let stream: NodeJS.ReadableStream | undefined;
  let lines: readline.Interface | undefined;

  try {
    stream = await openSource(source, signal);
    lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

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
        options.onProgress?.({ linesRead, imported, duplicates, malformed });
      }
    }

    flush();

    const storedTotal = countBpkEvents();
    updateBpkImportState({
      status: 'complete',
      finishedAt: new Date().toISOString(),
      // A dump has no page cursor; a later API run should start from the top.
      lastPageDone: 0,
      totalEvents: storedTotal,
    });

    return { linesRead, imported, duplicates, malformed, unusable, storedTotal };
  } catch (error) {
    flush();
    updateBpkImportState({
      status: isAbortError(error) ? 'cancelled' : 'failed',
      finishedAt: new Date().toISOString(),
      lastError: isAbortError(error) ? null : (error as Error).message?.slice(0, 500),
    });
    throw error;
  } finally {
    lines?.close();
    // Release the socket or file handle even on an early exit.
    if (stream && 'destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
  }
}
