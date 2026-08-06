import { render, screen, fireEvent } from '@testing-library/react';
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
  default: ({ onClearFilters }: { onClearFilters?: () => void }) => (
    <div>
      feed
      <button type="button" onClick={onClearFilters}>
        clear filters
      </button>
    </div>
  ),
}));
jest.mock('@/components/EventMap', () => ({
  __esModule: true,
  // The period control is stood in for, so a test can press it without a
  // Leaflet instance: it reports which period the map thinks it is showing and
  // offers one button per period.
  default: ({
    windowDays,
    onWindowChange,
  }: {
    windowDays: number;
    onWindowChange: (days: number) => void;
  }) => (
    <div>
      map
      <span data-testid="map-window">{windowDays}</span>
      {[1, 7, 30].map((days) => (
        <button key={days} type="button" onClick={() => onWindowChange(days)}>
          {`period ${days}`}
        </button>
      ))}
    </div>
  ),
}));
jest.mock('@/components/StatsView', () => ({
  __esModule: true,
  default: ({
    regionType,
    onRegionTypeChange,
  }: {
    regionType: string;
    onRegionTypeChange: (type: string) => void;
  }) => (
    <div>
      statistics
      <span data-testid="region-type">{regionType}</span>
      <button type="button" onClick={() => onRegionTypeChange('Stöld')}>
        narrow to Stöld
      </button>
    </div>
  ),
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
  total: 0,
  coverageDays: 0,
  regions: { rows: [], unplaced: 0, placed: 0, trendFrom: null },
  regionTypes: { types: ['Stöld'], cells: {}, unplaced: {}, recentStart: '2025-08' },
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
      filters={{ county: '', location: '', type: '', search: '', from: '', to: '' }}
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
  window.history.replaceState(null, '', '/');
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
        filters={{ county: '', location: '', type: '', search: '', from: '', to: '' }}
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

/**
 * Narrowing a view, as opposed to navigating.
 *
 * The map's period and the county map's type are in the URL so a link carries
 * them, and they used to get there through `router.replace`. Every view is the
 * same route, so that re-ran the whole page on the server: a refresh check, the
 * first page of the feed, a COUNT over a 338,000-row archive, both filter-option
 * lists and the entire statistics summary — for a parameter no server component
 * reads. Worse, the map's own fetch could not start until that landed, because
 * the period it asked for was derived from the address bar, so changing period
 * cost two round trips in series and one of them produced nothing.
 *
 * The native history call is the App Router's supported way to say the URL
 * changed and the server has nothing to add.
 */
describe('changing the map period', () => {
  it('shows the new period in the frame it was pressed', () => {
    searchParams = new URLSearchParams('vy=karta');
    renderApp('map');

    fireEvent.click(screen.getByText('period 30'));

    expect(screen.getByTestId('map-window')).toHaveTextContent('30');
  });

  it('writes it to the URL without asking the server for the page again', () => {
    searchParams = new URLSearchParams('vy=karta');
    renderApp('map');

    fireEvent.click(screen.getByText('period 7'));

    expect(new URLSearchParams(window.location.search).get('dagar')).toBe('7');
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps the rest of the query, and leaves the default out of it', () => {
    searchParams = new URLSearchParams('vy=karta&lan=Skåne län&sok=cykel');
    window.history.replaceState(null, '', '/?vy=karta&lan=Sk%C3%A5ne+l%C3%A4n&sok=cykel');
    renderApp('map');

    fireEvent.click(screen.getByText('period 30'));
    let written = new URLSearchParams(window.location.search);
    expect(written.get('lan')).toBe('Skåne län');
    expect(written.get('sok')).toBe('cykel');
    expect(written.get('vy')).toBe('karta');
    expect(written.get('dagar')).toBe('30');

    // Back to the default period, which is what no parameter means: a shared
    // link should not carry `dagar=1` to say "the usual".
    fireEvent.click(screen.getByText('period 1'));
    written = new URLSearchParams(window.location.search);
    expect(written.get('dagar')).toBeNull();
    expect(written.get('lan')).toBe('Skåne län');
  });

  it('does not put an entry between the reader and where they came from', () => {
    const before = window.history.length;
    searchParams = new URLSearchParams('vy=karta');
    renderApp('map');

    fireEvent.click(screen.getByText('period 7'));
    fireEvent.click(screen.getByText('period 30'));

    expect(window.history.length).toBe(before);
  });
});

describe('narrowing the county map to one type', () => {
  it('applies at once and lands in the URL, with no page request', () => {
    searchParams = new URLSearchParams('vy=statistik');
    renderApp('stats');

    fireEvent.click(screen.getByText('narrow to Stöld'));

    expect(screen.getByTestId('region-type')).toHaveTextContent('Stöld');
    expect(new URLSearchParams(window.location.search).get('lantyp')).toBe('Stöld');
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('clearing the filters', () => {
  /*
   * "Rensa alla" sits under an empty feed and offers to widen the search. It
   * built a fresh query from nothing, so it also threw away the map's period
   * and the county map's type: it cleared the filters and silently reset what
   * the reader was looking at as well. The same control inside Filters already
   * deleted only the four filter parameters.
   */
  it('clears the filters and keeps the rest of the context', () => {
    searchParams = new URLSearchParams(
      'vy=lista&lan=Skåne län&plats=Malmö&typ=Rån&sok=cykel&dagar=30&lantyp=Stöld'
    );
    renderApp('list');

    fireEvent.click(screen.getByText('clear filters'));

    const url = new URL(push.mock.calls.at(-1)![0], 'http://localhost');
    expect(url.searchParams.get('lan')).toBeNull();
    expect(url.searchParams.get('plats')).toBeNull();
    expect(url.searchParams.get('typ')).toBeNull();
    expect(url.searchParams.get('sok')).toBeNull();

    expect(url.searchParams.get('dagar')).toBe('30');
    expect(url.searchParams.get('lantyp')).toBe('Stöld');
    expect(url.searchParams.get('vy')).toBe('lista');
  });
});
