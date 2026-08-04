'use client';

/**
 * Send a render failure to the server log.
 *
 * The error boundary and the route error page both used to `console.error`,
 * which in a client component means the visitor's own devtools and nowhere
 * else. This is the one hop that puts the failure in front of the operator.
 *
 * Every failure mode here is swallowed on purpose: this runs while the page is
 * already broken, and an error reporter that throws is strictly worse than one
 * that gives up quietly.
 */
export function reportClientError(error: unknown, digest?: string): void {
  if (typeof window === 'undefined') return;

  const payload = JSON.stringify({
    message: error instanceof Error ? error.message : String(error ?? ''),
    digest: digest ?? '',
    // The path only. A query string on this site can carry a search term, and
    // what someone searched for is not ours to write into a log.
    path: window.location.pathname,
  });

  try {
    // sendBeacon survives the page going away, which a render failure often
    // precedes: the reader's next move is usually reload or back.
    if (typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon(
        '/api/client-error',
        new Blob([payload], { type: 'application/json' })
      );
      if (sent) return;
    }

    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // No network, a blocked beacon, a browser that dislikes Blob: none of it
    // is worth a second failure on top of the first.
  }
}
