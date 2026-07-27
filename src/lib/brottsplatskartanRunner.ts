import { importBrottsplatskartan, type ImportResult } from './brottsplatskartan';
import { getBpkImportState, updateBpkImportState } from './brottsplatskartanDb';
import type { BpkImportMode } from '@/types';

// Owns the single in-flight import for this process.
//
// A full import takes hours, so it cannot run inside a request. It is started
// in the background and progress is polled from the database — which also means
// progress survives a restart even though this controller does not.

interface RunHandle {
  mode: BpkImportMode;
  controller: AbortController;
  startedAt: number;
  promise: Promise<ImportResult>;
}

let current: RunHandle | null = null;

export function isImportRunning(): boolean {
  return current !== null;
}

export function getRunningMode(): BpkImportMode | null {
  return current?.mode ?? null;
}

export interface StartOutcome {
  started: boolean;
  reason?: string;
}

export function startImport(mode: BpkImportMode, concurrency?: number): StartOutcome {
  if (current) {
    return { started: false, reason: `An ${current.mode} import is already running` };
  }

  const controller = new AbortController();
  const handle: RunHandle = {
    mode,
    controller,
    startedAt: Date.now(),
    promise: importBrottsplatskartan({ mode, concurrency, signal: controller.signal }),
  };
  current = handle;

  handle.promise
    .then((result) => {
      console.log(
        `[bpk] ${mode} import finished: ${result.imported} new, ${result.duplicates} already known, ` +
          `${result.pagesFetched} pages at ${result.perPage}/page`
      );
    })
    .catch((error: unknown) => {
      // DOMException is not an instance of Error; read the name directly.
      const name = (error as { name?: string })?.name;
      if (name === 'AbortError') {
        console.log(`[bpk] ${mode} import cancelled; progress kept for resume`);
      } else {
        console.error(`[bpk] ${mode} import failed:`, (error as { message?: string })?.message ?? error);
      }
    })
    .finally(() => {
      if (current === handle) current = null;
    });

  return { started: true };
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
    console.log('[bpk] cleared stale running state from a previous process');
  }
}
