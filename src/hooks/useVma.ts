'use client';

import { useCallback, useEffect, useState } from 'react';
import { VmaAlert } from '@/types';

interface VmaState {
  alerts: VmaAlert[];
  live: VmaAlert[];
  /** The API answered, but SR could not be reached. */
  failed: boolean;
  loading: boolean;
  checkedAt: string | null;
  refresh: () => void;
}

/**
 * How often the browser asks again.
 *
 * A VMA is issued when there is an immediate danger, so a reader who leaves the
 * tab open should not be looking at a five-minute-old all-clear. The server
 * caches SR's answer for a minute, so this polling costs one upstream request
 * per minute however many people are reading.
 */
const POLL_MS = 60_000;

export function useVma(initial?: { alerts: VmaAlert[]; live: VmaAlert[]; failed: boolean }): VmaState {
  const [state, setState] = useState<Omit<VmaState, 'refresh'>>({
    alerts: initial?.alerts ?? [],
    live: initial?.live ?? [],
    failed: initial?.failed ?? false,
    loading: !initial,
    checkedAt: null,
  });
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch('/api/vma', { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        setState({
          alerts: Array.isArray(data.alerts) ? data.alerts : [],
          live: Array.isArray(data.live) ? data.live : [],
          failed: Boolean(data.failed),
          loading: false,
          checkedAt: typeof data.checkedAt === 'string' ? data.checkedAt : null,
        });
      } catch (error) {
        if (cancelled || (error as Error).name === 'AbortError') return;
        // Keep whatever is on screen. An alert that is showing must not vanish
        // because one poll failed.
        setState((prev) => ({ ...prev, failed: true, loading: false }));
      }
    };

    load();
    const timer = setInterval(() => {
      // No point polling a tab nobody is looking at; the visibility handler
      // below catches up the moment it comes back.
      if (!document.hidden) load();
    }, POLL_MS);

    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [attempt]);

  return { ...state, refresh };
}
