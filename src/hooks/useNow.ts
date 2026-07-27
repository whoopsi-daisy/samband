'use client';

import { useEffect, useState } from 'react';

// One shared clock for every component that renders a relative time.
//
// The feed can hold hundreds of cards after "Ladda fler", so each one owning a
// setInterval would mean hundreds of timers waking the tab every minute. A
// single module-level ticker fans out to all subscribers instead, and stops
// entirely once the last one unmounts.
const TICK_MS = 60_000;

const subscribers = new Set<(now: number) => void>();
let timerId: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: (now: number) => void): () => void {
  subscribers.add(fn);
  if (timerId === null) {
    timerId = setInterval(() => {
      const now = Date.now();
      for (const subscriber of subscribers) subscriber(now);
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };
}

// Returns null until mounted, then the current epoch time, refreshed every
// minute. The null first value keeps server and client markup identical, so
// callers should fall back to a server-computed string while it is null.
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    return subscribe(setNow);
  }, []);

  return now;
}
