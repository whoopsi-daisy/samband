/**
 * How this app backs off, stated once.
 *
 * There were two policies. The brottsplatskartan importer honoured
 * `Retry-After`, backed off exponentially and capped the wait. The polisen.se
 * fetcher slept a flat 200ms between attempts, with no jitter, and explicitly
 * classified 429 as retryable before retrying it a fifth of a second later,
 * which is the precise opposite of what a rate-limited server is asking for.
 * The good policy was on the path that runs a few times a year; the bad one ran
 * on every page render.
 *
 * Both use this now, so "how we treat someone else's server when it is
 * struggling" is one decision in one place rather than an accident of which
 * file a request happens to live in.
 */

export const RETRY_BASE_DELAY_MS = 1_000;
export const MAX_RETRY_DELAY_MS = 60_000;

/** A positive finite number out of a header, or null. */
export function parseRetryAfterSeconds(header: string | null | undefined): number | null {
  if (!header) return null;

  // The delta-seconds form, which is what these APIs send.
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  // RFC 9110 also allows an HTTP-date. Rare, but free to support.
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return Math.max(0, (at - Date.now()) / 1000);

  return null;
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /**
   * Spread retries so a burst of callers that failed together does not come
   * back in lockstep. Off for the importer, which is a single serial walker and
   * whose tests assert exact delays.
   */
  jitter?: boolean;
}

/**
 * How long to wait before the next attempt.
 *
 * `Retry-After` wins when the server sends one: it is the server saying how
 * long it needs, and guessing shorter is how a client turns someone else's bad
 * minute into a bad hour. Otherwise exponential from `baseMs`, capped.
 */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null | undefined,
  options: BackoffOptions = {}
): number {
  const base = options.baseMs ?? RETRY_BASE_DELAY_MS;
  const max = options.maxMs ?? MAX_RETRY_DELAY_MS;

  const asked = parseRetryAfterSeconds(retryAfter);
  if (asked !== null) return Math.min(asked * 1000, max);

  const backoff = Math.min(base * 2 ** attempt, max);
  if (!options.jitter) return backoff;

  // Full jitter: anywhere in [backoff/2, backoff]. Keeps the growth while
  // scattering the arrivals.
  return Math.round(backoff / 2 + Math.random() * (backoff / 2));
}

/**
 * Whether another attempt could plausibly succeed.
 *
 * 429 and 5xx are the server saying "not now"; every other 4xx is it saying
 * "not ever", and repeating the request only adds load to an answer that will
 * not change.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** A cancellable sleep. Rejects with AbortError if the signal fires first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}
