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

  const [showCustomLocation, setShowCustomLocation] = useState(false);
  const [customLocation, setCustomLocation] = useState('');
  const [search, setSearch] = useState(filters.search);
  const [location, setLocation] = useState(filters.location);
  const [type, setType] = useState(filters.type);
  const isInitialMount = useRef(true);
  const isCustomLocationInitMount = useRef(true);

  const debouncedSearch = useDebounce(search, 300);
  // Slightly longer for typing place names
  const debouncedCustomLocation = useDebounce(customLocation, 400);

  const pushParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', currentView);
      mutate(params);
      router.push(`/?${params.toString()}`);
    },
    [currentView, router, searchParams]
  );

  // A location already filtered but absent from the dropdown came from free text
  useEffect(() => {
    if (filters.location && !locations.includes(filters.location)) {
      setShowCustomLocation(true);
      setCustomLocation(filters.location);
    }
  }, [filters.location, locations]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (debouncedSearch !== filters.search) {
      pushParams((p) => (debouncedSearch ? p.set('search', debouncedSearch) : p.delete('search')));
    }
  }, [debouncedSearch, filters.search, pushParams]);

  useEffect(() => {
    if (isCustomLocationInitMount.current) {
      isCustomLocationInitMount.current = false;
      return;
    }
    if (!showCustomLocation) return;
    if (debouncedCustomLocation !== filters.location) {
      pushParams((p) =>
        debouncedCustomLocation ? p.set('location', debouncedCustomLocation) : p.delete('location')
      );
    }
  }, [debouncedCustomLocation, showCustomLocation, filters.location, pushParams]);

  const hasActiveFilters = Boolean(filters.location || filters.type || filters.search);

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setLocation('');
    setType('');
    setShowCustomLocation(false);
    setCustomLocation('');
    pushParams((p) => {
      p.delete('location');
      p.delete('type');
      p.delete('search');
    });
  }, [pushParams]);

  const handleLocationChange = (value: string) => {
    if (value === '__custom__') {
      setShowCustomLocation(true);
      setCustomLocation('');
      setLocation('');
      return;
    }
    setShowCustomLocation(false);
    setLocation(value);
    pushParams((p) => (value ? p.set('location', value) : p.delete('location')));
  };

  const handleTypeChange = (value: string) => {
    setType(value);
    pushParams((p) => (value ? p.set('type', value) : p.delete('type')));
  };

  const removeFilter = (name: 'location' | 'type' | 'search') => {
    if (name === 'search') setSearch('');
    if (name === 'type') setType('');
    if (name === 'location') {
      setLocation('');
      setShowCustomLocation(false);
      setCustomLocation('');
    }
    pushParams((p) => p.delete(name));
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

      <div className="filter-row">
        {!showCustomLocation ? (
          <select
            className="field"
            name="location"
            value={location}
            onChange={(e) => handleLocationChange(e.target.value)}
            aria-label="Välj plats"
          >
            <option value="">Alla platser</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
            <option value="__custom__">Annan plats…</option>
          </select>
        ) : (
          <div className="custom-location">
            <input
              className="field"
              type="text"
              name="location"
              placeholder="Skriv plats"
              value={customLocation}
              onChange={(e) => setCustomLocation(e.target.value)}
              autoFocus
              aria-label="Ange egen plats"
            />
            <button
              type="button"
              className="custom-location-cancel"
              onClick={() => {
                setShowCustomLocation(false);
                setCustomLocation('');
                setLocation('');
              }}
              aria-label="Avbryt anpassad plats"
            >
              ×
            </button>
          </div>
        )}

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
      </div>

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
