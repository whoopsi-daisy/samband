import { render, screen, act } from '@testing-library/react';
import ImportPanel from '@/components/ImportPanel';

// The panel opens an EventSource and falls back to polling. Neither exists in
// jsdom, so both are stubbed and the component is driven through fetch.
class StubEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn();
}

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  state: {
    status: 'idle',
    mode: null,
    lastPageDone: 0,
    totalPages: null,
    totalEvents: null,
    perPage: null,
    imported: 0,
    duplicates: 0,
    storedEvents: 1234,
    newestPubdateUnix: null,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    lastError: null,
  },
  running: false,
  runningMode: null,
  progress: null,
  log: [],
  percentComplete: null,
  coveragePercent: null,
  dumps: [],
  ...overrides,
});

async function renderPanel(body: Record<string, unknown>) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch;

  const result = render(<ImportPanel />);
  // Let the initial GET settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  (global as unknown as { EventSource: unknown }).EventSource = StubEventSource;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ImportPanel progress', () => {
  /**
   * The label used to be a child of .ops-progress, which is a 6px track with
   * overflow:hidden, so it was clipped to nothing. An operator watching a
   * multi-hour import saw a bar and no number anywhere on the page.
   */
  it('says so when nothing is running', async () => {
    await renderPanel(snapshot());

    expect(screen.getByText('Ingen körning pågår')).toBeVisible();
  });

  /**
   * The structural half of the fix, which is the half that regresses.
   *
   * jsdom does not load globals.css, so no assertion here can see the clipping
   * itself: .ops-progress is `height: 6px; overflow: hidden`, and the label was
   * a child of it. What *can* be pinned down is the arrangement that caused it,
   * so putting the label back inside the track fails here rather than silently
   * in a browser.
   */
  it('keeps the label outside the clipped track', async () => {
    await renderPanel(snapshot());

    const track = screen.getByRole('progressbar');
    const label = screen.getByText('Ingen körning pågår');

    expect(track).not.toContainElement(label);
  });

  it('shows the percentage of a running import', async () => {
    await renderPanel(
      snapshot({
        running: true,
        runningMode: 'ndjson',
        progress: {
          mode: 'ndjson',
          source: 'dump.ndjson',
          startedAt: new Date().toISOString(),
          elapsedMs: 5000,
          imported: 100,
          duplicates: 0,
          skipped: 0,
          linesRead: 100,
          bytesRead: 50,
          bytesTotal: 100,
          pagesDone: null,
          totalPages: null,
          percent: 42.5,
          perSecond: 20,
          etaSeconds: 10,
          message: 'dump dump.ndjson: 100 lines',
        },
      })
    );

    expect(screen.getByText('42.5%')).toBeVisible();
  });

  it('says a run is under way even before it can measure it', async () => {
    await renderPanel(
      snapshot({
        running: true,
        progress: {
          mode: 'full',
          source: null,
          startedAt: new Date().toISOString(),
          elapsedMs: 100,
          imported: 0,
          duplicates: 0,
          skipped: 0,
          linesRead: null,
          bytesRead: null,
          bytesTotal: null,
          pagesDone: 0,
          totalPages: null,
          percent: null,
          perSecond: null,
          etaSeconds: null,
          message: 'full import: 0 pages',
        },
      })
    );

    expect(screen.getByText('Pågår…')).toBeVisible();
  });

  // A bar with no accessible value is a decorative rectangle to a screen reader.
  it('exposes the progress to assistive technology', async () => {
    await renderPanel(
      snapshot({
        running: true,
        progress: {
          mode: 'ndjson',
          source: 'dump.ndjson',
          startedAt: new Date().toISOString(),
          elapsedMs: 5000,
          imported: 100,
          duplicates: 0,
          skipped: 0,
          linesRead: 100,
          bytesRead: 50,
          bytesTotal: 100,
          pagesDone: null,
          totalPages: null,
          percent: 42.5,
          perSecond: 20,
          etaSeconds: 10,
          message: 'dump dump.ndjson: 100 lines',
        },
      })
    );

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42.5');
    expect(bar).toHaveAttribute('aria-valuetext', '42.5%');
  });
});
