'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface FiltersProps {
  locations: string[];
  types: string[];
  currentView: string;
  filters: {
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

export default function Filters({ locations, types, currentView, filters }: FiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(filters.search);
  const [location, setLocation] = useState(filters.location);
  const [type, setType] = useState(filters.type);
  const isInitialMount = useRef(true);

  const debouncedSearch = useDebounce(search, 300);

  // Narrowing what is on screen is not navigation. `push` gave every pause in
  // typing its own history entry, so Back replayed the search one fragment at
  // a time instead of leaving it.
  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', currentView);
      mutate(params);
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [currentView, router, searchParams]
  );

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (debouncedSearch !== filters.search) {
      replaceParams((p) => (debouncedSearch ? p.set('search', debouncedSearch) : p.delete('search')));
    }
  }, [debouncedSearch, filters.search, replaceParams]);

  // A ?location= from a shared link can name a place the dropdown does not
  // list. Carry it as an option so the control shows what is actually applied
  // instead of sitting blank next to an active filter chip.
  const locationOptions =
    filters.location && !locations.includes(filters.location)
      ? [filters.location, ...locations]
      : locations;

  const hasActiveFilters = Boolean(filters.location || filters.type || filters.search);

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setLocation('');
    setType('');
    replaceParams((p) => {
      p.delete('location');
      p.delete('type');
      p.delete('search');
    });
  }, [replaceParams]);

  const handleLocationChange = (value: string) => {
    setLocation(value);
    replaceParams((p) => (value ? p.set('location', value) : p.delete('location')));
  };

  const handleTypeChange = (value: string) => {
    setType(value);
    replaceParams((p) => (value ? p.set('type', value) : p.delete('type')));
  };

  const removeFilter = (name: 'location' | 'type' | 'search') => {
    if (name === 'search') setSearch('');
    if (name === 'type') setType('');
    if (name === 'location') setLocation('');
    replaceParams((p) => p.delete(name));
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
          directly under a search field that already matches place names — two
          unlabelled text inputs for one job.
          They are direct children of .filters rather than sitting in a row of
          their own: the three controls share one grid, which puts them beside
          the search box on a wide screen instead of on a second line. */}
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
        <option value="">Alla händelsetyper</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {hasActiveFilters && (
        <div className="active-filters" role="status" aria-live="polite">
          <span className="active-filters-label">Filtrerar på</span>
          {(
            [
              ['location', 'Plats', filters.location],
              ['type', 'Typ', filters.type],
              ['search', 'Sökord', filters.search],
            ] as const
          ).map(([name, key, label]) =>
            label ? (
              <span className="badge badge--accent filter-chip" key={name}>
                {/* Which control the chip came from — a bare "Borås" said
                    nothing about whether it was a place, a type or free text. */}
                <span className="filter-chip-key">{key}:</span>
                <span className="filter-chip-text">{label}</span>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => removeFilter(name)}
                  aria-label={`Ta bort filter — ${key}: ${label}`}
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
