// Next.js instrumentation hook. Runs once when the server process starts.
//
// The app refreshes police events lazily inside the request path, which means
// that with no traffic the data goes stale. Since this app is deployed as a
// long-running container (`next start`), we start an in-process scheduler here
// so events keep refreshing regardless of whether anyone is visiting.

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 min — matches the API cache window
const FETCH_LOG_RETENTION_DAYS = 30;

export async function register(): Promise<void> {
  // Only run in the Node.js server runtime (not Edge, not the browser). The DB
  // layer uses better-sqlite3, which is Node-only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Guard against double-registration (e.g. hot reload in development).
  const globalState = globalThis as typeof globalThis & { __sambandSchedulerStarted?: boolean };
  if (globalState.__sambandSchedulerStarted) return;
  globalState.__sambandSchedulerStarted = true;

  const { refreshEventsIfNeeded } = await import('@/lib/policeApi');
  const { pruneFetchLog } = await import('@/lib/db');

  const tick = async (): Promise<void> => {
    try {
      await refreshEventsIfNeeded();
      pruneFetchLog(FETCH_LOG_RETENTION_DAYS);
    } catch (error) {
      console.error('[scheduler] refresh tick failed:', error);
    }
  };

  // Kick once on startup, then on a fixed interval.
  void tick();
  const timer = setInterval(tick, REFRESH_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
}
