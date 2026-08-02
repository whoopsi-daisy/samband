import { render, screen, within } from '@testing-library/react';
import OperationalDashboard from '@/components/OperationalDashboard';
import type { DatabaseHealth, FetchLogEntry, OperationalStats, SystemSnapshot } from '@/types';

// ImportPanel opens an EventSource and polls; it has its own tests.
jest.mock('@/components/ImportPanel', () => ({
  __esModule: true,
  default: () => <section data-testid="import-panel" />,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const stats = (overrides: Partial<OperationalStats> = {}): OperationalStats => ({
  totalFetches: 1010,
  successfulFetches: 992,
  failedFetches: 18,
  fetches24h: 144,
  successfulFetches24h: 144,
  failedFetches24h: 0,
  fetches7d: 1008,
  successRate: 98.2,
  successRate24h: 100,
  avgFetchInterval: 10,
  lastSuccessfulFetch: '2026-08-02T10:00:00.000Z',
  lastFailedFetch: null,
  minutesSinceLastSuccess: 4,
  recentErrors: [],
  hourlyFetches: Array.from({ length: 24 }, () => ({ ok: 6, failed: 0 })),
  avgEventsPerFetch: 0.4,
  eventsAddedToday: 38,
  uptimeScore: 100,
  ...overrides,
});

const health = (overrides: Partial<DatabaseHealth> = {}): DatabaseHealth => ({
  totalEvents: 1280,
  totalFetchLogs: 1010,
  eventsWithGps: 1180,
  eventsWithGpsPercent: 92,
  uniqueLocations: 212,
  uniqueTypes: 41,
  oldestEvent: '2026-07-26T00:00:00.000Z',
  newestEvent: '2026-08-02T09:00:00.000Z',
  eventsByType: [],
  dataFreshnessMinutes: 64,
  updatedEvents: 35,
  updatedEventsPercent: 13,
  ...overrides,
});

const system = (overrides: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
  dataDir: '/app/data',
  databaseBytes: 367 * 1024 * 1024,
  walBytes: 0,
  timeZone: 'Europe/Stockholm',
  timeZoneCorrect: true,
  nodeVersion: 'v22.22.2',
  processUptimeSeconds: 7200,
  searchTokenizer: { configured: 'trigram', built: 'trigram', matches: true },
  archive: { events: 333012, cutoff: '2026-07-26T00:00:00.000Z' },
  ...overrides,
});

const logs = (rows: Partial<FetchLogEntry>[] = []): FetchLogEntry[] =>
  rows.map((row, index) => ({
    id: index + 1,
    fetchedAt: '2026-08-02T10:00:00.000Z',
    eventsFetched: 40,
    eventsNew: 0,
    success: true,
    errorType: null,
    errorMessage: null,
    ...row,
  }));

function paint(overrides: Partial<Parameters<typeof OperationalDashboard>[0]> = {}) {
  return render(
    <OperationalDashboard
      operationalStats={stats()}
      fetchLogs={logs([{}, {}])}
      databaseHealth={health()}
      system={system()}
      fetchBudget={{ used: 144, limit: 1440 }}
      generatedAt="2026-08-02T10:04:00.000Z"
      {...overrides}
    />
  );
}

describe('the page opens with a verdict', () => {
  it('says whether the thing is working, in words', () => {
    paint();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Allt fungerar');
  });

  it('leads with the problem when there is one', () => {
    paint({
      operationalStats: stats({
        minutesSinceLastSuccess: 240,
        successfulFetches24h: 0,
        failedFetches24h: 30,
        successRate24h: 0,
        uptimeScore: 0,
        recentErrors: [
          { fetchedAt: '2026-08-02T09:00:00Z', errorType: 'DNS-fel', message: 'ENOTFOUND polisen.se' },
        ],
      }),
    });

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Feeden står stilla');
    // The message an operator can act on, not just the bucket.
    expect(screen.getByText(/ENOTFOUND polisen\.se/)).toBeInTheDocument();
  });
});

describe('the tiles', () => {
  it('pairs every figure with what it is measured against', () => {
    paint();
    expect(screen.getByText('144 av 144 väntade')).toBeInTheDocument();
    expect(screen.getByText('144 av 144 försök')).toBeInTheDocument();
    expect(screen.getByText('144 / 1 440')).toBeInTheDocument();
  });

  it('shows the budget against the ceiling the limiter enforces', () => {
    paint({ fetchBudget: { used: 1400, limit: 1440 } });
    expect(screen.getByText('1 400 / 1 440')).toBeInTheDocument();
  });
});

describe('the fetch log', () => {
  it('shows what the upstream said, in the row that failed', () => {
    paint({
      fetchLogs: logs([
        { id: 1, success: false, errorType: 'Serverfel', errorMessage: 'HTTP 503 Service Unavailable' },
        { id: 2 },
      ]),
    });

    const table = screen.getByRole('table');
    expect(within(table).getByText('HTTP 503 Service Unavailable')).toBeInTheDocument();
    expect(within(table).getByText('Serverfel')).toBeInTheDocument();
  });

  it('says so rather than showing an empty frame', () => {
    paint({ fetchLogs: [] });
    expect(screen.getByText('Inga hämtningar loggade ännu.')).toBeInTheDocument();
  });
});

describe('the environment section', () => {
  // The single most expensive mistake to make in this deployment.
  it('flags a timezone that will shift every event', () => {
    paint({ system: system({ timeZone: 'UTC', timeZoneCorrect: false }) });
    expect(screen.getByText('UTC')).toBeInTheDocument();
    expect(screen.getByText(/förskjuter varje händelse/)).toBeInTheDocument();
  });

  it('stays quiet when the timezone is right', () => {
    paint();
    expect(screen.queryByText(/förskjuter varje händelse/)).not.toBeInTheDocument();
  });

  it('reports the size on disk, which used to need a shell on the host', () => {
    paint();
    expect(screen.getByText('367 MB')).toBeInTheDocument();
    expect(screen.getByText('/app/data')).toBeInTheDocument();
  });

  it('warns when the search index no longer matches the setting', () => {
    paint({
      system: system({
        searchTokenizer: { configured: 'unicode61', built: 'trigram', matches: false },
      }),
    });
    expect(screen.getByText(/byggs om till unicode61/)).toBeInTheDocument();
  });
});

describe('the page as a whole', () => {
  // It used to have no link off it at all: you arrived by typing the URL.
  it('offers a way back to the app', () => {
    paint();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/');
  });

  // Trends over the events themselves belong to the reader-facing view, and
  // keeping a second copy here meant two charts to keep right for no
  // operational gain.
  it('points at the statistics view instead of copying it', () => {
    paint();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/?vy=statistik');
    expect(screen.queryByText('Daglig trend (7d)')).not.toBeInTheDocument();
  });

  it('keeps the import panel', () => {
    paint();
    expect(screen.getByTestId('import-panel')).toBeInTheDocument();
  });
});
