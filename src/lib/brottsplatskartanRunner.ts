import { importBrottsplatskartan, type ImportResult } from './brottsplatskartan';
import { importNdjson, type NdjsonImportResult } from './brottsplatskartanNdjson';
import { getBpkImportState, updateBpkImportState } from './brottsplatskartanDb';
import { invalidateAggregateCaches, warmAggregateCaches } from './db';
import { resolveImportSource } from './importSource';
import type { BpkImportMode, BpkImportState } from '@/types';
import { logger } from './log';

const trace = logger('bpk');

// Owns the single in-flight import for this process, and everything needed to
// watch it happen: a live progress snapshot, a rolling log, and a subscriber
// list the SSE endpoint pushes from.
//
// A full import takes hours, so it cannot run inside a request. It is started
// in the background; coarse progress is also written to the database, so it
// survives a restart even though this controller does not.

export type ImportRequest =
  | { mode: 'full' | 'incremental'; concurrency?: number }
  | { mode: 'ndjson'; source: string; allowAnyPath?: boolean };

export interface LiveImportProgress {
  mode: BpkImportMode;
  /** Dump name or URL for an NDJSON import, otherwise null. */
  source: string | null;
  startedAt: string;
  elapsedMs: number;
  imported: number;
  duplicates: number;
  /** Lines that were unparseable or had no usable id/date. */
  skipped: number;
  linesRead: number | null;
  bytesRead: number | null;
  bytesTotal: number | null;
  pagesDone: number | null;
  totalPages: number | null;
  /** 0-100 when the size of the job is known, otherwise null. */
  percent: number | null;
  /** Events per second for a dump, pages per second for an API walk. */
  perSecond: number | null;
  etaSeconds: number | null;
  /** One-line human summary, the same text that goes to the log. */
  message: string;
}

export interface ImportLogEntry {
  at: string;
  text: string;
}

export interface ImportSnapshot {
  state: BpkImportState;
  running: boolean;
  runningMode: BpkImportMode | null;
  progress: LiveImportProgress | null;
  log: ImportLogEntry[];
  /** Percent of the archive walked, for a resumable full API import. */
  percentComplete: number | null;
  /** Stored rows against what the API says exists. */
  coveragePercent: number | null;
}

interface RunHandle {
  mode: BpkImportMode;
  source: string | null;
  controller: AbortController;
  startedAt: number;
  promise: Promise<ImportResult | NdjsonImportResult>;
}

const LOG_LIMIT = 100;
// The console is the other place an operator watches an import from
// (`docker compose logs -f`), but it must not be flooded by a run that emits
// progress several times a second.
const CONSOLE_INTERVAL_MS = 15_000;

let current: RunHandle | null = null;
let progress: LiveImportProgress | null = null;
let log: ImportLogEntry[] = [];
let lastConsoleAt = 0;

type Listener = (snapshot: ImportSnapshot) => void;
const listeners = new Set<Listener>();

export function isImportRunning(): boolean {
  return current !== null;
}

export function getRunningMode(): BpkImportMode | null {
  return current?.mode ?? null;
}

export function getLiveProgress(): LiveImportProgress | null {
  return progress;
}

export function getImportLog(): ImportLogEntry[] {
  return log;
}

/** Push updates to a watcher (the SSE endpoint). Returns the unsubscribe. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getImportSnapshot(): ImportSnapshot {
  const state = getBpkImportState();

  const percentComplete =
    state.totalPages && state.totalPages > 0
      ? Math.min(100, Math.round((state.lastPageDone / state.totalPages) * 1000) / 10)
      : null;

  // Coverage against what the API last reported, which is the figure to check
  // when the question is "did everything get imported".
  const coveragePercent =
    state.totalEvents && state.totalEvents > 0
      ? Math.round((state.storedEvents / state.totalEvents) * 10000) / 100
      : null;

  return {
    state,
    running: current !== null,
    runningMode: current?.mode ?? null,
    progress,
    log,
    percentComplete,
    coveragePercent,
  };
}

function record(text: string, options: { console?: boolean } = {}): void {
  const entry: ImportLogEntry = { at: new Date().toISOString(), text };
  log = [...log, entry].slice(-LOG_LIMIT);
  if (options.console !== false) trace.info(text);
  publish(true);
}

// Building a snapshot counts the rows in bpk_events, so a dump running at ten
// batches a second must not push one per batch. Half a second is well below
// what an eye notices and an order of magnitude less work.
const PUBLISH_INTERVAL_MS = 500;
let lastPublishAt = 0;
// Whether this run has pushed a progress snapshot yet. The first one always
// goes out, without it, a run that finishes inside one interval: a small
// dump, or any run whose start line used up the interval: would be seen
// starting and finishing with nothing in between.
let publishedProgress = false;

function publish(force = false): void {
  if (listeners.size === 0) return;
  const now = Date.now();
  if (!force && now - lastPublishAt < PUBLISH_INTERVAL_MS) return;
  lastPublishAt = now;

  const snapshot = getImportSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // A broken watcher must never take down the import.
    }
  }
}

function formatCount(n: number): string {
  return n.toLocaleString('sv-SE');
}

function updateProgress(next: LiveImportProgress): void {
  progress = next;

  // Keep the log readable, one line every CONSOLE_INTERVAL_MS, plus whatever
  // start/finish lines the run records itself.
  const now = Date.now();
  if (now - lastConsoleAt >= CONSOLE_INTERVAL_MS) {
    lastConsoleAt = now;
    log = [...log, { at: new Date().toISOString(), text: next.message }].slice(-LOG_LIMIT);
    trace.info(next.message);
  }

  publish(!publishedProgress);
  publishedProgress = true;
}

function rate(count: number, elapsedMs: number): number | null {
  if (elapsedMs < 1000 || count <= 0) return null;
  return Math.round((count / (elapsedMs / 1000)) * 10) / 10;
}

export interface StartOutcome {
  started: boolean;
  reason?: string;
  mode?: BpkImportMode;
  source?: string | null;
}

export function startImport(request: ImportRequest): StartOutcome {
  if (current) {
    return { started: false, reason: `An ${current.mode} import is already running` };
  }

  return request.mode === 'ndjson' ? startNdjson(request) : startApiWalk(request);
}

function startApiWalk(request: { mode: 'full' | 'incremental'; concurrency?: number }): StartOutcome {
  const { mode, concurrency } = request;
  const controller = new AbortController();
  const startedAt = Date.now();

  const promise = importBrottsplatskartan({
    mode,
    concurrency,
    signal: controller.signal,
    onProgress: (p) => {
      const elapsedMs = Date.now() - startedAt;
      const percent = p.totalPages ? Math.min(100, (p.pagesDone / p.totalPages) * 100) : null;
      const pagesPerSecond = rate(p.pagesDone, elapsedMs);
      const pagesLeft = p.totalPages !== null ? Math.max(0, p.totalPages - p.pagesDone) : null;

      updateProgress({
        mode,
        source: null,
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs,
        imported: p.imported,
        duplicates: p.duplicates,
        skipped: 0,
        linesRead: null,
        bytesRead: null,
        bytesTotal: null,
        pagesDone: p.pagesDone,
        totalPages: p.totalPages,
        percent: percent === null ? null : Math.round(percent * 10) / 10,
        perSecond: pagesPerSecond,
        etaSeconds: pagesLeft !== null && pagesPerSecond ? Math.round(pagesLeft / pagesPerSecond) : null,
        message:
          `${mode} import: ${formatCount(p.pagesDone)}` +
          `${p.totalPages ? '/' + formatCount(p.totalPages) : ''} pages, ` +
          `${formatCount(p.imported)} new, ${formatCount(p.duplicates)} already known`,
      });
    },
  });

  begin({ mode, source: null, controller, startedAt, promise });

  record(
    mode === 'full'
      ? 'full import started: walking the archive from the oldest page'
      : 'incremental import started: pulling everything newer than the archive'
  );

  return { started: true, mode, source: null };
}

function startNdjson(request: { mode: 'ndjson'; source: string; allowAnyPath?: boolean }): StartOutcome {
  // Resolve before starting so a bad path is a synchronous 400 rather than a
  // background failure the caller has to go looking for.
  const resolved = resolveImportSource(request.source, { allowAnyPath: request.allowAnyPath === true });

  const controller = new AbortController();
  const startedAt = Date.now();

  const promise = importNdjson({
    source: resolved.value,
    signal: controller.signal,
    allowAnyPath: true,
    onProgress: (p) => {
      const elapsedMs = Date.now() - startedAt;
      const percent = p.bytesTotal ? Math.min(100, (p.bytesRead / p.bytesTotal) * 100) : null;
      const linesPerSecond = rate(p.linesRead, elapsedMs);
      const bytesLeft = p.bytesTotal !== null ? Math.max(0, p.bytesTotal - p.bytesRead) : null;
      const bytesPerSecond = rate(p.bytesRead, elapsedMs);

      updateProgress({
        mode: 'ndjson',
        source: resolved.label,
        startedAt: new Date(startedAt).toISOString(),
        elapsedMs,
        imported: p.imported,
        duplicates: p.duplicates,
        skipped: p.malformed + p.unusable,
        linesRead: p.linesRead,
        bytesRead: p.bytesRead,
        bytesTotal: p.bytesTotal,
        pagesDone: null,
        totalPages: null,
        percent: percent === null ? null : Math.round(percent * 10) / 10,
        perSecond: linesPerSecond,
        etaSeconds: bytesLeft !== null && bytesPerSecond ? Math.round(bytesLeft / bytesPerSecond) : null,
        message:
          `dump ${resolved.label}: ${formatCount(p.linesRead)} lines` +
          `${percent !== null ? ` (${percent.toFixed(1)}%)` : ''}, ` +
          `${formatCount(p.imported)} new, ${formatCount(p.duplicates)} already known` +
          `${p.malformed + p.unusable > 0 ? `, ${formatCount(p.malformed + p.unusable)} skipped` : ''}`,
      });
    },
  });

  begin({ mode: 'ndjson', source: resolved.label, controller, startedAt, promise });
  record(`dump import started from ${resolved.label}`);

  return { started: true, mode: 'ndjson', source: resolved.label };
}

function begin(handle: RunHandle): void {
  current = handle;
  progress = null;
  lastConsoleAt = 0;
  lastPublishAt = 0;
  publishedProgress = false;

  handle.promise
    .then((result) => {
      const seconds = Math.round((Date.now() - handle.startedAt) / 1000);
      if ('linesRead' in result) {
        record(
          `dump import finished in ${seconds}s: ${formatCount(result.imported)} new, ` +
            `${formatCount(result.duplicates)} already known, ${formatCount(result.malformed + result.unusable)} skipped, ` +
            `${formatCount(result.storedTotal)} stored in total`
        );
      } else {
        record(
          `${handle.mode} import finished in ${seconds}s: ${formatCount(result.imported)} new, ` +
            `${formatCount(result.duplicates)} already known, ${formatCount(result.pagesFetched)} pages ` +
            `at ${result.perPage}/page`
        );
      }
    })
    .catch((error: unknown) => {
      // DOMException is not an instance of Error; read the name directly.
      const name = (error as { name?: string })?.name;
      if (name === 'AbortError') {
        record(`${handle.mode} import cancelled; progress kept for resume`);
      } else {
        const message = (error as { message?: string })?.message ?? String(error);
        record(`${handle.mode} import failed: ${message}`, { console: false });
        trace.error('import failed', message, { mode: handle.mode });
      }
    })
    .finally(() => {
      // The feed, the filters and the statistics read the imported events, and
      // all three are served from cached aggregates. Drop those now so the app
      // reflects the import immediately rather than up to a minute later:
      // including a run that was cancelled or failed partway, which still
      // stored everything it got through. Rebuilding them here means the first
      // page view after an import is not the one that pays for it.
      invalidateAggregateCaches();
      warmAggregateCaches();

      if (current === handle) {
        current = null;
        progress = null;
        // Forced. This is the snapshot that says the run is over, and it is
        // always emitted within PUBLISH_INTERVAL_MS of the finish/failure line
        // recorded just above, which publishes with force and so resets the
        // throttle. Unforced, it was therefore dropped every time: the last
        // thing a watcher ever received said `running: true`, and the dashboard
        // sat on "Pågår" with a progress bar that never resolved until the
        // stream's own idle tick happened to correct it.
        publish(true);
      }
    });
}

export function cancelImport(): boolean {
  if (!current) return false;
  current.controller.abort();
  return true;
}

// Clear a 'running' status left behind by a process that died mid-import.
// Without this the next start would be refused by the status check even though
// nothing is actually running.
export function reconcileImportState(): void {
  const state = getBpkImportState();
  if (state.status === 'running' && !current) {
    updateBpkImportState({
      status: 'idle',
      lastError: 'Interrupted by a restart; resume to continue',
    });
    trace.info('cleared stale running state from a previous process');
  }
}
