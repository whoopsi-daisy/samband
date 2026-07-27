// Node-only startup work. Loaded by instrumentation.ts behind a runtime check.
//
// This lives in its own module because Next.js compiles instrumentation.ts for
// the Edge runtime as well, and everything reachable from it gets traced into
// that bundle. Anything touching better-sqlite3, fs or process.cwd — which is
// all of the below — fails that build. Keeping it behind a single dynamic
// import means the Edge bundle never reaches it.

import { refreshEventsIfNeeded } from '@/lib/policeApi';
import { pruneFetchLog } from '@/lib/db';
import { getBpkImportState } from '@/lib/brottsplatskartanDb';
import { reconcileImportState, startImport } from '@/lib/brottsplatskartanRunner';

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 min — matches the API cache window
const FETCH_LOG_RETENTION_DAYS = 30;

export function start(): void {
  startRefreshScheduler();
  startBrottsplatskartanImport();
}

// The app refreshes police events lazily inside the request path, which means
// that with no traffic the data goes stale. Since this is deployed as a
// long-running container, refresh on a timer regardless of traffic.
function startRefreshScheduler(): void {
  const tick = async (): Promise<void> => {
    try {
      await refreshEventsIfNeeded();
      pruneFetchLog(FETCH_LOG_RETENTION_DAYS);
    } catch (error) {
      console.error('[scheduler] refresh tick failed:', error);
    }
  };

  void tick();
  const timer = setInterval(tick, REFRESH_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
}

// Opt-in brottsplatskartan.se import.
//
// BPK_IMPORT_ON_START=full        - import the whole archive (hours), then
//                                   keep it current on later boots
// BPK_IMPORT_ON_START=incremental - only pull what is new since last time
//
// Left unset, nothing here touches the network. A full import only starts if
// one has not already completed, so restarting the container does not kick off
// another; an interrupted run resumes from its recorded page instead.
function startBrottsplatskartanImport(): void {
  const setting = process.env.BPK_IMPORT_ON_START?.trim().toLowerCase();
  if (setting !== 'full' && setting !== 'incremental') return;

  // A previous process may have died mid-import, leaving status = 'running'.
  reconcileImportState();

  const state = getBpkImportState();
  const concurrency = parseInt(process.env.BPK_IMPORT_CONCURRENCY || '', 10) || undefined;

  if (setting === 'incremental') {
    startImport('incremental', concurrency);
    return;
  }

  if (state.status === 'complete' && state.storedEvents > 0) {
    console.log('[bpk] archive already imported; running an incremental sync');
    startImport('incremental', concurrency);
    return;
  }

  console.log(
    state.lastPageDone > 0
      ? `[bpk] resuming full import from page ${state.lastPageDone + 1}`
      : '[bpk] starting full import; this takes a few hours'
  );
  startImport('full', concurrency);
}
