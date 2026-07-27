// Tiny in-process TTL cache for expensive read-only aggregates.
//
// The statistics summary alone runs ~15 COUNT/GROUP BY passes over the events
// table, and it was recomputed on every home-page request even for visitors who
// never open the statistics view. Events only change when a fetch lands (every
// 10 minutes), so a short TTL costs nothing in freshness.
//
// State is per-process, which suits the single-container deployment; see the
// note in rateLimit.ts about scaling out.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export function memoizeWithTtl<A extends unknown[], R>(
  fn: (...args: A) => R,
  ttlMs: number,
  keyOf: (...args: A) => string = (...args) => JSON.stringify(args)
): ((...args: A) => R) & { invalidate: () => void } {
  const entries = new Map<string, Entry<R>>();

  const memoized = (...args: A): R => {
    const key = keyOf(...args);
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const value = fn(...args);
    entries.set(key, { value, expiresAt: now + ttlMs });
    return value;
  };

  memoized.invalidate = () => entries.clear();
  return memoized;
}
