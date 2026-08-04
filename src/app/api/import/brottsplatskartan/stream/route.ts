import { NextRequest } from 'next/server';
import { getImportSnapshot, subscribe } from '@/lib/brottsplatskartanRunner';

// Server-sent events carrying import progress as it happens.
//
//   curl -N -u user:pass http://localhost:3000/api/import/brottsplatskartan/stream
//
// Every message is a complete snapshot: the same JSON the GET endpoint
// returns, so a watcher that connects mid-import, or reconnects after a drop,
// is immediately up to date without replaying anything.
export const dynamic = 'force-dynamic';

// Also acts as the keep-alive: proxies drop an idle event stream, and an idle
// stream is exactly what a finished import looks like. Building a snapshot
// counts rows, so a dashboard left open on an idle system ticks slowly.
const TICK_RUNNING_MS = 2000;
const TICK_IDLE_MS = 10_000;

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = (): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Declared before `send` so the failure path below can reach it. A write
      // that throws means the client is gone, which is the same thing an abort
      // means, so it has to run the same teardown: setting `closed` alone left
      // this subscriber in the runner's module-level listener set for the life
      // of the process, and every progress tick went on walking it.
      const close = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      const send = (data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client went away between the check and the write.
          close();
        }
      };

      const tick = (): void => {
        if (closed) return;
        const snapshot = getImportSnapshot();
        send(snapshot);
        timer = setTimeout(tick, snapshot.running ? TICK_RUNNING_MS : TICK_IDLE_MS);
      };

      unsubscribe = subscribe(send);
      tick();

      request.signal.addEventListener('abort', close);
      if (request.signal.aborted) close();
    },
    // The client hung up. Drop the subscription and the timer, or an
    // abandoned tab would keep this process ticking forever.
    cancel() {
      closed = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // nginx buffers proxied responses by default, which would hold every
      // event back until the import finished.
      'X-Accel-Buffering': 'no',
    },
  });
}
