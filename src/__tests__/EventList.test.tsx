import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import EventList from '@/components/EventList';
import { FormattedEvent } from '@/types';

// jsdom has no IntersectionObserver, and the feed's scroll loading is built on
// one. This stands in for it and hands the test a way to say "the end of the
// list is now in view" without simulating a scroll jsdom cannot lay out.
const observers = new Set<{ trigger: () => void }>();

class FakeIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe() {
    observers.add({ trigger: () => this.callback([{ isIntersecting: true }] as never, this as never) });
  }
  disconnect() {
    observers.clear();
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
}

/** Scroll the end of the list into view, once. */
async function reachTheEnd() {
  await act(async () => {
    for (const observer of [...observers]) observer.trigger();
  });
}

function createEvent(id: number): FormattedEvent {
  const at = new Date(Date.UTC(2026, 6, 16, 8, 53) - id * 60_000);
  return {
    id,
    datetime: at.toISOString(),
    name: `16 juli 08:53, Trafikolycka, Ljungby`,
    summary: 'En personbil har kört av vägen.',
    url: `/aktuellt/handelser/2026/juli/16/${id}/`,
    type: 'Trafikolycka',
    location: 'Kronobergs län',
    place: 'Ljungby',
    gps: '56.83,13.94',
    color: '#3b82f6',
    emoji: '🚗',
    date: { day: '16', month: 'Jul', time: '08:53', relative: '2 timmar sedan', iso: at.toISOString() },
    wasUpdated: false,
    updated: '',
  };
}

const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => createEvent(from + i));

function renderList(props: Partial<React.ComponentProps<typeof EventList>> = {}) {
  return render(
    <EventList
      initialEvents={page(1, 40)}
      initialTotal={1000}
      initialHasMore
      filters={{ location: '', type: '', search: '' }}
      currentView="list"
      highlightedEventId={null}
      linkedEvent={null}
      linkedEventMissing={false}
      {...props}
    />
  );
}

/** Answers /api/events with a fresh page every time. */
function mockPages() {
  let served = 40;
  global.fetch = jest.fn().mockImplementation(async () => {
    const events = page(served + 1, 40);
    served += 40;
    return { ok: true, json: async () => ({ events, hasMore: true, total: 1000 }) };
  }) as unknown as typeof fetch;
}

const rowCount = () => document.querySelectorAll('.event-row:not(.skeleton-row)').length;

beforeEach(() => {
  jest.restoreAllMocks();
  observers.clear();
  global.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  mockPages();
});

describe('EventList', () => {
  it('labels the day heading count instead of floating a bare number', () => {
    renderList();

    const heading = document.querySelector('.day-heading');
    expect(heading?.tagName).toBe('H2');
    expect(heading).toHaveTextContent(/\d+ händelser/);
  });

  // Reaching the end of the list used to do nothing until the reader found a
  // button below the fold and pressed it.
  it('loads the next page when the end of the list comes into view', async () => {
    renderList();
    expect(rowCount()).toBe(40);

    await reachTheEnd();

    await waitFor(() => expect(rowCount()).toBe(80));
  });

  // Scrolling added pages in silence: the only sign was a spinner in a button
  // that had usually finished before it came into view.
  it('shows placeholder rows while a page is on its way', async () => {
    let release: (value: unknown) => void = () => {};
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => ({ events: page(41, 40), hasMore: true, total: 1000 }) });
        })
    ) as unknown as typeof fetch;

    renderList();
    await reachTheEnd();

    await waitFor(() => expect(document.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0));
    expect(screen.getByText('Hämtar fler händelser')).toBeInTheDocument();

    await act(async () => release(null));
    await waitFor(() => expect(document.querySelectorAll('.skeleton-row')).toHaveLength(0));
  });

  // Unbounded, the feed never has a bottom and the footer is unreachable.
  it('stops loading on scroll once the budget is spent, and offers the button', async () => {
    renderList();

    for (let i = 0; i < 6; i++) {
      await reachTheEnd();
      await waitFor(() => expect(document.querySelectorAll('.skeleton-row')).toHaveLength(0));
    }

    expect(rowCount()).toBe(120);
    expect(screen.getByRole('button', { name: /visa fler/i })).toBeInTheDocument();
  });

  it('starts a fresh budget when the reader asks for more outright', async () => {
    renderList();
    for (let i = 0; i < 6; i++) {
      await reachTheEnd();
      await waitFor(() => expect(document.querySelectorAll('.skeleton-row')).toHaveLength(0));
    }

    fireEvent.click(screen.getByRole('button', { name: /visa fler/i }));
    await waitFor(() => expect(rowCount()).toBe(160));

    await reachTheEnd();
    await waitFor(() => expect(rowCount()).toBe(200));
  });

  // Every one of these paths used to return silently, so reaching the end with
  // no connection did nothing at all.
  it('says why a page did not arrive, and stops loading on scroll until asked', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    renderList();

    await reachTheEnd();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /försök igen/i })).toBeInTheDocument();
  });

  it('offers a way out of an empty result rather than only describing it', () => {
    const onClearFilters = jest.fn();
    renderList({
      initialEvents: [],
      initialTotal: 0,
      initialHasMore: false,
      filters: { location: 'Borås', type: '', search: '' },
      onClearFilters,
    });

    fireEvent.click(screen.getByRole('button', { name: /rensa alla filter/i }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  // The unfiltered feed scroll-loads, so "Visar 40 av 1 000" was already stale
  // as it was read, and it cost a row of chrome above the first card on a phone
  // to say what the end of the feed says again where it can be acted on.
  it('does not count the feed at the reader until they filter it', () => {
    renderList();

    expect(document.querySelector('.feed-lede')).toBeNull();
    expect(screen.queryByText(/^Live$/)).not.toBeInTheDocument();
  });

  // Filtered, the number is the one thing worth saying: it answers whether the
  // filter found anything before you scroll looking.
  it('counts the matches once a filter is applied', () => {
    renderList({
      filters: { location: 'Borås', type: '', search: '' },
      initialEvents: page(1, 12),
      initialTotal: 12,
      initialHasMore: false,
    });

    const lede = document.querySelector('.feed-lede');
    expect(lede).toHaveTextContent('12');
    expect(lede).toHaveTextContent(/händelser matchar/i);
  });

  it('offers a way back out from the match count', () => {
    const onClearFilters = jest.fn();
    renderList({ filters: { location: '', type: '', search: 'brand' }, onClearFilters });

    fireEvent.click(screen.getByRole('button', { name: /^rensa$/i }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('pins a linked incident that is older than the first page', async () => {
    // The pinned card opens expanded, which fetches its text on mount.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, details: { content: 'Hela texten.' } }),
    }) as unknown as typeof fetch;

    renderList({ linkedEvent: createEvent(9999), highlightedEventId: 9999 });

    expect(screen.getByLabelText('Delad händelse')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /visa hela flödet/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Hela texten.')).toBeInTheDocument());
  });
});
