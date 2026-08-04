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

/**
 * How many distinct keys a memo may hold before the oldest is dropped.
 *
 * The expiry sweep below is enough for a key space that is small and fixed
 * ('stats', a column name). It is not enough for one a visitor can widen:
 * getMapEvents is keyed partly on the free-text search box, so a crawler
 * walking `?search=<random>` mints a new key per request, and each of those
 * entries holds up to 500 event objects. Expiry alone bounds that only by how
 * many requests arrive within one TTL, which is not a bound at all.
 */
const DEFAULT_MAX_ENTRIES = 64;

export interface MemoOptions {
  /** Override the key-space cap. */
  maxEntries?: number;
}

export function memoizeWithTtl<A extends unknown[], R>(
  fn: (...args: A) => R,
  ttlMs: number,
  keyOf: (...args: A) => string = (...args) => JSON.stringify(args),
  options: MemoOptions = {}
): ((...args: A) => R) & { invalidate: () => void; size: () => number } {
  const entries = new Map<string, Entry<R>>();
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);

  // Expired entries used to sit here for the lifetime of the process: the TTL
  // was only ever consulted on the way *in*, so nothing removed a key that was
  // never asked for again. Sweeping on a miss keeps that from accumulating
  // without walking the map on the hot path.
  const evictExpired = (now: number): void => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  };

  const memoized = (...args: A): R => {
    const key = keyOf(...args);
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

    const value = fn(...args);

    evictExpired(now);
    // Still over the cap once the dead entries are gone: drop the oldest live
    // one. Map iterates in insertion order, so that is the first key.
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }

    entries.set(key, { value, expiresAt: now + ttlMs });
    return value;
  };

  memoized.invalidate = () => entries.clear();
  /** Live entry count, for tests and for reporting cache health. */
  memoized.size = () => entries.size;
  return memoized;
}
