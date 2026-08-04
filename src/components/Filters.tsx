'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QUERY, ViewId, toSwedishParams, viewSlug } from '@/lib/urlParams';

interface FiltersProps {
  /**
   * All twenty-one, from the constant rather than from the data. Unlike the
   * place list beside it, this is a fixed administrative taxonomy: there is
   * nothing to discover by asking the database.
   */
  counties: string[];
  locations: string[];
  types: string[];
  currentView: string;
  filters: {
    county: string;
    location: string;
    type: string;
    search: string;
  };
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

export default function Filters({ counties, locations, types, currentView, filters }: FiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(filters.search);
  const [county, setCounty] = useState(filters.county);
  const [location, setLocation] = useState(filters.location);
  const [type, setType] = useState(filters.type);
  const isInitialMount = useRef(true);

  const debouncedSearch = useDebounce(search, 300);

  // Narrowing what is on screen is not navigation. `push` gave every pause in
  // typing its own history entry, so Back replayed the search one fragment at
  // a time instead of leaving it.
  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = toSwedishParams(new URLSearchParams(searchParams.toString()));
      params.set(QUERY.view, viewSlug(currentView as ViewId));
      mutate(params);
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [currentView, router, searchParams]
  );

  /*
   * Follow the filters when something else changes them.
   *
   * These three start from props and were never told about it again, which is
   * fine while the selects are the only thing that sets them. They are not: the
   * statistics page links into a county or a place, and the component stays
   * mounted across that navigation, so the chip said "Län: Stockholms län"
   * while the select beside it still read "Alla län".
   *
   * Local state is kept rather than reading the props directly, so a change
   * shows in the control immediately instead of waiting for the server round
   * trip that `replace` starts.
   */
  useEffect(() => setCounty(filters.county), [filters.county]);
  useEffect(() => setLocation(filters.location), [filters.location]);
  useEffect(() => setType(filters.type), [filters.type]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (debouncedSearch !== filters.search) {
      replaceParams((p) =>
        debouncedSearch ? p.set(QUERY.search, debouncedSearch) : p.delete(QUERY.search)
      );
    }
  }, [debouncedSearch, filters.search, replaceParams]);

  // A ?plats= from a shared link can name a place the dropdown does not
  // list. Carry it as an option so the control shows what is actually applied
  // instead of sitting blank next to an active filter chip.
  const locationOptions =
    filters.location && !locations.includes(filters.location)
      ? [filters.location, ...locations]
      : locations;

  const hasActiveFilters = Boolean(
    filters.county || filters.location || filters.type || filters.search
  );

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setCounty('');
    setLocation('');
    setType('');
    replaceParams((p) => {
      p.delete(QUERY.county);
      p.delete(QUERY.location);
      p.delete(QUERY.type);
      p.delete(QUERY.search);
    });
  }, [replaceParams]);

  const handleCountyChange = (value: string) => {
    setCounty(value);
    // The place select lists municipalities from the whole country, so a place
    // left set from before can contradict the county now chosen and return
    // nothing. Choosing a county is the broader move and clears it.
    setLocation('');
    replaceParams((p) => {
      p.delete(QUERY.location);
      if (value) p.set(QUERY.county, value);
      else p.delete(QUERY.county);
    });
  };

  const handleLocationChange = (value: string) => {
    setLocation(value);
    replaceParams((p) => (value ? p.set(QUERY.location, value) : p.delete(QUERY.location)));
  };

  const handleTypeChange = (value: string) => {
    setType(value);
    replaceParams((p) => (value ? p.set(QUERY.type, value) : p.delete(QUERY.type)));
  };

  const removeFilter = (name: 'county' | 'location' | 'type' | 'search') => {
    if (name === 'search') setSearch('');
    if (name === 'type') setType('');
    if (name === 'location') setLocation('');
    if (name === 'county') setCounty('');
    replaceParams((p) => p.delete(QUERY[name]));
  };

  return (
    <section className="filters" role="search" aria-label="Sök och filtrera händelser">
      <form className="search-form" onSubmit={(e) => e.preventDefault()}>
        <span className="search-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4.3-4.3" />
          </svg>
        </span>
        <input
          className="search-input"
          type="search"
          name="search"
          placeholder="Sök på plats, brott eller ord i texten"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Sök händelser"
        />
        {search ? (
          <button
            type="button"
            className="search-clear"
            onClick={() => setSearch('')}
            aria-label="Rensa sökningen"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <span className="search-kbd" aria-hidden="true">
            /
          </span>
        )}
      </form>

      {/* Two selects and nothing else. There used to be an "Annan plats…"
          option that swapped this select for a second free-text box, sitting
          directly under a search field that already matches place names, two
          unlabelled text inputs for one job.
          They are direct children of .filters rather than sitting in a row of
          their own: the three controls share one grid, which puts them beside
          the search box on a wide screen instead of on a second line. */}
      {/* County first: it is the broadest of the three and the one the
          statistics page links into. */}
      <select
        className="field"
        name="county"
        value={county}
        onChange={(e) => handleCountyChange(e.target.value)}
        aria-label="Välj län"
      >
        <option value="">Alla län</option>
        {counties.map((name) => (
          <option key={name} value={name}>
            {name.replace(/ län$/, '')}
          </option>
        ))}
      </select>

      <select
        className="field"
        name="location"
        value={location}
        onChange={(e) => handleLocationChange(e.target.value)}
        aria-label="Välj plats"
      >
        <option value="">Alla platser</option>
        {locationOptions.map((loc) => (
          <option key={loc} value={loc}>
            {loc}
          </option>
        ))}
      </select>

      <select
        className="field"
        name="type"
        value={type}
        onChange={(e) => handleTypeChange(e.target.value)}
        aria-label="Välj händelsetyp"
      >
        {/* "Alla händelsetyper" did not fit the box beside the place select on a
            phone, and a select clips rather than ellipsising, so it read as
            "Alla händelsetype". The aria-label carries the full wording. */}
        <option value="">Alla typer</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {/* Not a live region either. Changing a filter used to announce three
          things at once: these chips, the match count above the feed, and the
          end-of-list line. The count is the one that answers what the reader
          just asked, so it keeps the announcement and the chips became what
          they look like, a visible record of what is applied. */}
      {hasActiveFilters && (
        <div className="active-filters">
          <span className="active-filters-label">Filtrerar på</span>
          {(
            [
              ['county', 'Län', filters.county],
              ['location', 'Plats', filters.location],
              ['type', 'Typ', filters.type],
              ['search', 'Sökord', filters.search],
            ] as const
          ).map(([name, key, label]) =>
            label ? (
              <span className="badge badge--accent filter-chip" key={name}>
                {/* Which control the chip came from: a bare "Borås" said
                    nothing about whether it was a place, a type or free text. */}
                <span className="filter-chip-key">{key}:</span>
                <span className="filter-chip-text">{label}</span>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => removeFilter(name)}
                  aria-label={`Ta bort filtret ${key}: ${label}`}
                >
                  ×
                </button>
              </span>
            ) : null
          )}
          <button type="button" className="clear-all" onClick={clearAllFilters}>
            Rensa alla
          </button>
        </div>
      )}
    </section>
  );
}
