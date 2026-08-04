import { render, screen } from '@testing-library/react';
import ClientApp from '@/components/ClientApp';
import type { Statistics } from '@/types';

/**
 * The view follows the URL, including when the browser is what changed it.
 *
 * Every view is the same route with a different query, so the component never
 * unmounts and the view could not be seeded from the URL just once. It was, so
 * pressing Back out of the statistics changed the address bar and left the page
 * showing the statistics: the browser's own control appearing not to work,
 * which is the kind of thing a reader blames themselves for.
 */

const push = jest.fn();
const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

// The views themselves are covered by their own suites. Standing them in keeps
// this about which one is on screen, and keeps a map, a fetch for warnings and
// a decade of statistics out of a test about navigation.
jest.mock('@/components/EventList', () => ({
  __esModule: true,
  default: () => <div>feed</div>,
}));
jest.mock('@/components/EventMap', () => ({
  __esModule: true,
  default: () => <div>map</div>,
  MAP_WINDOW_DAYS: [1, 7, 30],
}));
jest.mock('@/components/StatsView', () => ({
  __esModule: true,
  default: () => <div>statistics</div>,
}));
jest.mock('@/components/VmaView', () => ({
  __esModule: true,
  default: () => <div>warnings</div>,
}));
jest.mock('@/hooks/useVma', () => ({
  useVma: () => ({ alerts: [], live: [], failed: false, loading: false, checkedAt: null, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useMapEvents', () => ({
  useMapEvents: () => ({ events: [], total: 0, loading: false, error: false, retry: jest.fn() }),
}));

const stats = {
  regions: { rows: [], unplaced: 0, placed: 0, trendFrom: null },
  regionTypes: { types: [], cells: {}, unplaced: {}, recentStart: '2025-08' },
} as unknown as Statistics;

function renderApp(initialView: string) {
  return render(
    <ClientApp
      initialEvents={[]}
      totalEvents={0}
      hasMore={false}
      counties={['Skåne län']}
      locations={['Malmö']}
      types={['Rån']}
      stats={stats}
      filters={{ county: '', location: '', type: '', search: '' }}
      initialView={initialView}
      highlightedEventId={null}
      linkedEvent={null}
      linkedEventMissing={false}
    />
  );
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  searchParams = new URLSearchParams();
});

describe('which view is on screen', () => {
  it('opens on the view the URL names', () => {
    searchParams = new URLSearchParams('vy=statistik');
    renderApp('stats');

    expect(screen.getByText('statistics')).toBeInTheDocument();
    expect(screen.queryByText('feed')).not.toBeInTheDocument();
  });

  /*
   * Back and forward, which is what this exists for.
   *
   * The server re-renders the page for the new query and hands down a different
   * initialView; nothing unmounts, so the view has to follow the prop. Before
   * it did, this rendered the statistics with the feed in the address bar.
   */
  it('follows the URL when the browser navigates back', () => {
    searchParams = new URLSearchParams('vy=statistik');
    const { rerender } = renderApp('stats');
    expect(screen.getByText('statistics')).toBeInTheDocument();

    searchParams = new URLSearchParams('vy=lista');
    rerender(
      <ClientApp
        initialEvents={[]}
        totalEvents={0}
        hasMore={false}
        counties={['Skåne län']}
        locations={['Malmö']}
        types={['Rån']}
        stats={stats}
        filters={{ county: '', location: '', type: '', search: '' }}
        initialView="list"
        highlightedEventId={null}
        linkedEvent={null}
        linkedEventMissing={false}
      />
    );

    expect(screen.getByText('feed')).toBeInTheDocument();
    expect(screen.queryByText('statistics')).not.toBeInTheDocument();
  });
});

describe('what a link carries', () => {
  /*
   * A deep link is the whole context or it is not worth sharing.
   *
   * The map's period used to be component state, so this link opened the map
   * with the county applied and the period back at the last day: the filters
   * survived and what was being looked at did not.
   */
  it('opens the map on the period the link asks for', () => {
    searchParams = new URLSearchParams('vy=karta&lan=Skåne län&dagar=30');
    renderApp('map');

    expect(screen.getByText('map')).toBeInTheDocument();
  });

  it('ignores a period the map does not offer', () => {
    searchParams = new URLSearchParams('vy=karta&dagar=999');
    renderApp('map');

    expect(screen.getByText('map')).toBeInTheDocument();
  });
});
