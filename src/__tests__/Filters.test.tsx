import { render, screen, fireEvent, act } from '@testing-library/react';
import Filters from '@/components/Filters';

const replace = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));

function renderFilters(filters = { location: '', type: '', search: '' }) {
  return render(
    <Filters
      locations={['Stockholm', 'Borås']}
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
  // The search box and both selects share one grid, so they can sit on a
  // single row on a wide screen instead of costing two.
  it('puts all three controls in one group', () => {
    const { container } = renderFilters();

    const group = container.querySelector('.filters');
    expect(group?.querySelector(':scope > .search-form')).toBeInTheDocument();
    expect(group?.querySelectorAll(':scope > select.field')).toHaveLength(2);
  });

  it('applies a place without waiting for a debounce', () => {
    renderFilters();

    fireEvent.change(screen.getByLabelText('Välj plats'), { target: { value: 'Borås' } });

    expect(lastUrl().searchParams.get('location')).toBe('Borås');
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
    expect(lastUrl().searchParams.get('search')).toBe('Ljungby');
  });

  // A ?location= from a shared link can name a place the dropdown does not
  // list. Without this the control sits blank next to an active filter chip.
  it('carries a place from a shared link that the dropdown does not list', () => {
    renderFilters({ location: 'Kiruna', type: '', search: '' });

    const select = screen.getByLabelText('Välj plats') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain('Kiruna');
    expect(select.value).toBe('Kiruna');
  });

  // A bare "Borås" said nothing about whether it was a place, a type or free
  // text.
  it('says which control each active filter came from', () => {
    renderFilters({ location: 'Borås', type: 'Rån', search: 'fönster' });

    expect(screen.getByText('Plats:')).toBeInTheDocument();
    expect(screen.getByText('Typ:')).toBeInTheDocument();
    expect(screen.getByText('Sökord:')).toBeInTheDocument();
  });

  it('removes one filter without touching the others', () => {
    searchParams = new URLSearchParams({ location: 'Borås', type: 'Rån' });
    renderFilters({ location: 'Borås', type: 'Rån', search: '' });

    fireEvent.click(screen.getByRole('button', { name: /ta bort filtret plats/i }));

    const params = lastUrl().searchParams;
    expect(params.get('location')).toBeNull();
    expect(params.get('type')).toBe('Rån');
  });

  it('clears everything at once', () => {
    searchParams = new URLSearchParams({ location: 'Borås', type: 'Rån', search: 'fönster' });
    renderFilters({ location: 'Borås', type: 'Rån', search: 'fönster' });

    fireEvent.click(screen.getByRole('button', { name: /rensa alla/i }));

    const params = lastUrl().searchParams;
    expect(params.get('location')).toBeNull();
    expect(params.get('type')).toBeNull();
    expect(params.get('search')).toBeNull();
  });

  it('keeps the current view when a filter changes', () => {
    renderFilters();

    fireEvent.change(screen.getByLabelText('Välj händelsetyp'), { target: { value: 'Rån' } });

    expect(lastUrl().searchParams.get('view')).toBe('list');
  });
});
