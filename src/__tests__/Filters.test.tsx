import { render, screen, fireEvent, act } from '@testing-library/react';
import Filters from '@/components/Filters';
import { QUERY } from '@/lib/urlParams';

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

function renderFilters(
  filters = { county: '', location: '', type: '', search: '' },
  // Counties among them on purpose: this is what getFilterOptions returns,
  // because the feed labels a great many notices with the county alone.
  locations = ['Stockholm', 'Borås', 'Blekinge län', 'Skåne län']
) {
  return render(
    <Filters
      counties={['Skåne län', 'Stockholms län']}
      locations={locations}
      types={['Trafikolycka', 'Rån']}
      currentView="list"
      filters={filters}
    />
  );
}

/** The last URL the component asked the router for. */
const lastUrl = () => new URL(replace.mock.calls.at(-1)![0], 'http://localhost');

beforeEach(() => {
  replace.mockClear();
  searchParams = new URLSearchParams();
  jest.useRealTimers();
});

describe('Filters', () => {
  /*
   * A county is one filter, not two.
   *
   * The place list comes from the location strings on the notices, and polisen
   * labels a great many of them with the county alone, so "Blekinge län" was an
   * option in the place select as well as in the county select beside it.
   * Choosing it set a second filter that looked like the first: the chips read
   * "Län: Blekinge län" next to "Plats: Blekinge län", and what came back was
   * the intersection, which is only the notices where an officer typed the
   * county and none of the ones that named a town in it.
   */
  it('keeps counties out of the place dropdown', () => {
    renderFilters();

    const places = screen.getByLabelText('Välj plats');
    const options = [...places.querySelectorAll('option')].map((o) => o.value);

    expect(options).toEqual(['', 'Stockholm', 'Borås']);
    expect(options).not.toContain('Blekinge län');
  });

  // Nothing becomes unreachable by being removed above: the county select
  // offers all twenty-one, and what it returns is a superset of what the place
  // filter did, because it resolves the notices that named a town as well.
  it('still offers every county in the county dropdown', () => {
    renderFilters();

    const counties = [...screen.getByLabelText('Välj län').querySelectorAll('option')];
    expect(counties.map((o) => o.value)).toContain('Skåne län');
  });

  // A ?plats= from a link shared before any of this can still name something
  // the list does not carry, and the control has to show what is applied
  // rather than sit blank beside an active chip.
  it('carries an applied place the list does not have', () => {
    renderFilters({ county: '', location: 'Ljungby', type: '', search: '' });

    const options = [...screen.getByLabelText('Välj plats').querySelectorAll('option')];
    expect(options.map((o) => o.value)).toContain('Ljungby');
  });

  // The search box and both selects share one grid, so they can sit on a
  // single row on a wide screen instead of costing two.
  it('puts every control in one group', () => {
    const { container } = renderFilters();

    const group = container.querySelector('.filters');
    expect(group?.querySelector(':scope > .search-form')).toBeInTheDocument();
    expect(group?.querySelector(':scope > select[name="county"]')).toBeInTheDocument();
    expect(group?.querySelectorAll(':scope > select.field')).toHaveLength(3);
  });

  it('applies a place without waiting for a debounce', () => {
    renderFilters();

    fireEvent.change(screen.getByLabelText('Välj plats'), { target: { value: 'Borås' } });

    expect(lastUrl().searchParams.get(QUERY.location)).toBe('Borås');
  });

  // Narrowing what is on screen is not navigation. `push` gave every pause in
  // typing its own history entry, so Back replayed the search one fragment at
  // a time instead of leaving it.
  it('replaces the URL rather than pushing a history entry per keystroke', () => {
    jest.useFakeTimers();
    renderFilters();

    fireEvent.change(screen.getByLabelText('Sök händelser'), { target: { value: 'Ljungby' } });
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][1]).toEqual({ scroll: false });
    expect(lastUrl().searchParams.get(QUERY.search)).toBe('Ljungby');
  });

  // A ?location= from a shared link can name a place the dropdown does not
  // list. Without this the control sits blank next to an active filter chip.
  it('carries a place from a shared link that the dropdown does not list', () => {
    renderFilters({ county: '', location: 'Kiruna',  type: '', search: '' });

    const select = screen.getByLabelText('Välj plats') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain('Kiruna');
    expect(select.value).toBe('Kiruna');
  });

  // A bare "Borås" said nothing about whether it was a place, a type or free
  // text.
  it('says which control each active filter came from', () => {
    renderFilters({ county: '', location: 'Borås',  type: 'Rån', search: 'fönster' });

    expect(screen.getByText('Plats:')).toBeInTheDocument();
    expect(screen.getByText('Typ:')).toBeInTheDocument();
    expect(screen.getByText('Sökord:')).toBeInTheDocument();
  });

  it('removes one filter without touching the others', () => {
    searchParams = new URLSearchParams({ [QUERY.location]: 'Borås', [QUERY.type]: 'Rån' });
    renderFilters({ county: '', location: 'Borås',  type: 'Rån', search: '' });

    fireEvent.click(screen.getByRole('button', { name: /ta bort filtret plats/i }));

    const params = lastUrl().searchParams;
    expect(params.get(QUERY.location)).toBeNull();
    expect(params.get(QUERY.type)).toBe('Rån');
  });

  it('clears everything at once', () => {
    searchParams = new URLSearchParams({
      [QUERY.location]: 'Borås',
      [QUERY.type]: 'Rån',
      [QUERY.search]: 'fönster',
    });
    renderFilters({ county: '', location: 'Borås',  type: 'Rån', search: 'fönster' });

    fireEvent.click(screen.getByRole('button', { name: /rensa alla/i }));

    const params = lastUrl().searchParams;
    expect(params.get(QUERY.location)).toBeNull();
    expect(params.get(QUERY.type)).toBeNull();
    expect(params.get(QUERY.search)).toBeNull();
  });

  // A link shared before the query string was translated has to keep working,
  // and should not leave the app writing a URL in two languages.
  it('rewrites an old English query when anything changes', () => {
    searchParams = new URLSearchParams({ view: 'map', location: 'Borås' });
    renderFilters({ county: '', location: 'Borås',  type: '', search: '' });

    fireEvent.change(screen.getByLabelText('Välj händelsetyp'), { target: { value: 'Rån' } });

    const url = lastUrl().searchParams;
    expect(url.get('location')).toBeNull();
    expect(url.get('view')).toBeNull();
    expect(url.get(QUERY.location)).toBe('Borås');
    expect(url.get(QUERY.type)).toBe('Rån');
  });

  it('keeps the current view when a filter changes', () => {
    renderFilters();

    fireEvent.change(screen.getByLabelText('Välj händelsetyp'), { target: { value: 'Rån' } });

    expect(lastUrl().searchParams.get(QUERY.view)).toBe('lista');
  });
});

/**
 * The controls have to follow the filters, not only set them.
 *
 * They started from props and were never told again, which is fine while the
 * selects are the only thing that changes them. They are not: the statistics
 * page links into a county or a place and this component stays mounted across
 * that navigation, so the chip read "Län: Stockholms län" while the select
 * beside it still said "Alla län".
 */
describe('when something else sets a filter', () => {
  it('shows the county the page was navigated to', () => {
    const { rerender } = renderFilters();
    expect(screen.getByLabelText('Välj län')).toHaveValue('');

    rerender(
      <Filters
        counties={['Skåne län', 'Stockholms län']}
        locations={['Stockholm', 'Borås']}
        types={['Trafikolycka', 'Rån']}
        currentView="list"
        filters={{ county: 'Stockholms län', location: '', type: '', search: '' }}
      />
    );

    expect(screen.getByLabelText('Välj län')).toHaveValue('Stockholms län');
  });

  it('does the same for a place, which had the same bug', () => {
    const { rerender } = renderFilters();

    rerender(
      <Filters
        counties={['Skåne län', 'Stockholms län']}
        locations={['Stockholm', 'Borås']}
        types={['Trafikolycka', 'Rån']}
        currentView="list"
        filters={{ county: '', location: 'Borås', type: '', search: '' }}
      />
    );

    expect(screen.getByLabelText('Välj plats')).toHaveValue('Borås');
  });
});
