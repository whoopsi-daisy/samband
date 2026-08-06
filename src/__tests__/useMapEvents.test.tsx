import { act, render, waitFor } from '@testing-library/react';
import { clearMapEventCache, useMapEvents } from '@/hooks/useMapEvents';
import { MAP_WINDOW_DAYS } from '@/lib/mapWindows';
import type { MapEvent } from '@/types';

/**
 * What it costs to change the period the map is showing.
 *
 * Every switch used to be a fresh request, including a switch *back* to a
 * period whose rows were still in the tab, and nothing was fetched until the
 * reader asked for it. Between them that was most of the two to three seconds
 * between pressing "Senaste månaden" and the map moving.
 */

const filters = { county: '', location: '', type: '', search: '' };

function event(id: number): MapEvent {
  return {
    gps: '56.75,14.50',
    type: 'Stöld',
    place: 'Ljungby',
    location: 'Kronobergs län',
    url: `/e/${id}/`,
    iso: new Date().toISOString(),
  };
}

/** Where /api/map was asked for, in order, and what it answered. */
let calls: string[] = [];

function respond(perWindow: Record<string, MapEvent[]>) {
  global.fetch = jest.fn((url: string) => {
    calls.push(url);
    const days = new URL(url, 'http://localhost').searchParams.get('dagar') ?? '';
    const events = perWindow[days] ?? [];
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ events, total: events.length }),
    });
  }) as unknown as typeof fetch;
}

/** Which windows were requested, deduplicated, in the order they first appeared. */
function requestedWindows(): string[] {
  const seen: string[] = [];
  for (const url of calls) {
    const days = new URL(url, 'http://localhost').searchParams.get('dagar') ?? '';
    if (!seen.includes(days)) seen.push(days);
  }
  return seen;
}

interface HarnessProps {
  windowDays: number;
  isActive?: boolean;
}

let latest: ReturnType<typeof useMapEvents>;

function Harness({ windowDays, isActive = true }: HarnessProps) {
  latest = useMapEvents(filters, isActive, windowDays);
  return <div data-testid="count">{latest.events.length}</div>;
}

beforeEach(() => {
  calls = [];
  clearMapEventCache();
  // requestIdleCallback is what the prefetch schedules on, and jsdom has no
  // such thing; run the job on a macrotask so the tests can await it.
  (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback = (
    job: IdleRequestCallback
  ) => window.setTimeout(() => job({ didTimeout: false, timeRemaining: () => 5 }), 0);
  (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback = (
    handle: number
  ) => window.clearTimeout(handle);
  respond({ '1': [event(1)], '7': [event(1), event(2)], '30': [event(1), event(2), event(3)] });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback;
});

describe('loading the map', () => {
  it('does not fetch anything until the map is opened', async () => {
    render(<Harness windowDays={1} isActive={false} />);
    await act(async () => {});
    expect(calls).toHaveLength(0);
  });

  it('fetches the period that is on screen', async () => {
    render(<Harness windowDays={1} />);
    await waitFor(() => expect(latest.events).toHaveLength(1));
    expect(latest.loading).toBe(false);
    expect(requestedWindows()).toContain('1');
  });
});

describe('the periods the reader has not asked for', () => {
  /*
   * The first switch is the one that used to be slowest, because it is the one
   * with nothing behind it. Fetching the other two once the open one has settled
   * means the reader is almost never the one waiting on the network.
   */
  it('are fetched once the open one has arrived', async () => {
    render(<Harness windowDays={1} />);
    await waitFor(() => expect(latest.events).toHaveLength(1));

    await waitFor(() =>
      expect(requestedWindows().sort()).toEqual(MAP_WINDOW_DAYS.map(String).sort())
    );
  });

  it('are not fetched before it has', () => {
    // No await: the first response has not landed, so nothing should be queued
    // behind it competing for the connection.
    render(<Harness windowDays={1} />);
    expect(requestedWindows()).toEqual(['1']);
  });
});

describe('switching period', () => {
  it('answers from what is already held, with no request and no loading state', async () => {
    const view = render(<Harness windowDays={1} />);
    await waitFor(() => expect(latest.events).toHaveLength(1));
    // Let the prefetch of 7 and 30 land.
    await waitFor(() => expect(requestedWindows()).toHaveLength(MAP_WINDOW_DAYS.length));

    const before = calls.length;
    view.rerender(<Harness windowDays={30} />);

    // Synchronously, in the same commit as the switch: the rows were in hand,
    // so there is no frame where the map is blank or overlaid.
    expect(latest.events).toHaveLength(3);
    expect(latest.loading).toBe(false);
    expect(calls).toHaveLength(before);
  });

  it('reuses a period the reader has already been shown', async () => {
    const view = render(<Harness windowDays={1} />);
    await waitFor(() => expect(latest.events).toHaveLength(1));
    await waitFor(() => expect(requestedWindows()).toHaveLength(MAP_WINDOW_DAYS.length));

    const before = calls.length;
    view.rerender(<Harness windowDays={7} />);
    await act(async () => {});
    view.rerender(<Harness windowDays={1} />);
    await act(async () => {});
    view.rerender(<Harness windowDays={7} />);
    await act(async () => {});

    expect(latest.events).toHaveLength(2);
    expect(calls).toHaveLength(before);
  });

  it('shares one request between the prefetch and the reader who beats it there', async () => {
    // Deliberately never resolved, so both askers are in flight at once.
    let resolve: ((value: unknown) => void) | null = null;
    global.fetch = jest.fn((url: string) => {
      calls.push(url);
      return new Promise((r) => {
        resolve = r;
      });
    }) as unknown as typeof fetch;

    const view = render(<Harness windowDays={1} />);
    view.rerender(<Harness windowDays={1} />);
    await act(async () => {});

    expect(calls.filter((url) => url.includes('dagar=1'))).toHaveLength(1);

    await act(async () => {
      resolve?.({ ok: true, json: () => Promise.resolve({ events: [event(1)], total: 1 }) });
    });
  });
});

describe('when the fetch fails', () => {
  it('reports it, and retrying asks again rather than serving the failure', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    ) as unknown as typeof fetch;

    render(<Harness windowDays={1} />);
    await waitFor(() => expect(latest.error).toBe(true));

    respond({ '1': [event(1)] });
    await act(async () => latest.retry());
    await waitFor(() => expect(latest.events).toHaveLength(1));
    expect(latest.error).toBe(false);
    errors.mockRestore();
  });

  /*
   * A cached answer must not outlive the reader's instruction to refetch it. The
   * retry path clears the key it is retrying, or "Försök igen" would hand back
   * the very rows the reader is asking to replace.
   */
  it('drops the cached answer for the period being retried', async () => {
    render(<Harness windowDays={1} />);
    await waitFor(() => expect(latest.events).toHaveLength(1));

    respond({ '1': [event(1), event(2)] });
    await act(async () => latest.retry());
    await waitFor(() => expect(latest.events).toHaveLength(2));
  });
});
