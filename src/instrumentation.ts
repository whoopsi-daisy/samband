// Next.js instrumentation hook. Runs once when the server process starts.
//
// Next compiles this file for the Edge runtime as well as Node, and everything
// reachable from it is traced into that Edge bundle — including through dynamic
// imports. The startup work needs better-sqlite3, fs and process.cwd, none of
// which exist there, so it all lives in instrumentation.node.ts behind the
// single guarded import below.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Guard against double-registration (e.g. hot reload in development).
  const globalState = globalThis as typeof globalThis & { __sambandSchedulerStarted?: boolean };
  if (globalState.__sambandSchedulerStarted) return;
  globalState.__sambandSchedulerStarted = true;

  const { start } = await import('./instrumentation.node');
  start();
}
