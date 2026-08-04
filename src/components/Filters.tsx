'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QUERY, ViewId, toSwedishParams, viewSlug } from '@/lib/urlParams';
import { isCountyName } from '@/lib/regions';
import type { FeedFilters } from '@/types';
import { swedishDayKey } from '@/lib/utils';
import { useMounted } from '@/hooks/useMounted';

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
  filters: FeedFilters;
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
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const isInitialMount = useRef(true);

  const debouncedSearch = useDebounce(search, 300);

  /*
   * The latest date worth offering, as a Swedish calendar day.
   *
   * Only after mount. swedishDayKey is timezone-independent, so the server and
   * the browser agree on which day it is — but not on which *instant*, and a
   * render that straddles midnight would hand the two of them different
   * strings for the same attribute. Undefined until mounted leaves the control
   * unbounded for one frame, which costs nothing, rather than risking React
   * discarding the server's markup once a day.
   */
  const mounted = useMounted();
  const today = mounted ? swedishDayKey(new Date()) : undefined;

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
  // The server may have swapped a range typed backwards, or dropped a date it
  // could not read, so these follow what was actually applied rather than what
  // was typed.
  useEffect(() => setFrom(filters.from), [filters.from]);
  useEffect(() => setTo(filters.to), [filters.to]);

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

  /*
   * Places, with the counties taken out.
   *
   * The list is built from the location strings the notices carry, and the feed
   * labels a great many of them with the county alone, so "Blekinge län" was an
   * option here as well as in the county select beside it. Picking it set a
   * second filter that looked like the first, read as a contradiction in the
   * chips, and returned less than either: a place filter matches the string an
   * officer typed, so it dropped every notice in Blekinge that named a town.
   * Counties belong to the control next door, which resolves them properly.
   *
   * Nothing becomes unreachable. A county removed from here is selectable in
   * the county select, and what that returns is a superset of what this offered.
   */
  const places = useMemo(() => locations.filter((name) => !isCountyName(name)), [locations]);

  // A ?plats= from a shared link can still name a place the dropdown does not
  // list. Carry it as an option so the control shows what is actually applied
  // instead of sitting blank next to an active filter chip.
  const locationOptions =
    filters.location && !places.includes(filters.location)
      ? [filters.location, ...places]
      : places;

  const hasActiveFilters = Boolean(
    filters.county || filters.location || filters.type || filters.search || filters.from || filters.to
  );

  const clearAllFilters = useCallback(() => {
    setSearch('');
    setCounty('');
    setLocation('');
    setType('');
    setFrom('');
    setTo('');
    replaceParams((p) => {
      p.delete(QUERY.county);
      p.delete(QUERY.location);
      p.delete(QUERY.type);
      p.delete(QUERY.search);
      p.delete(QUERY.from);
      p.delete(QUERY.to);
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

  // The two ends move together in the URL but are set independently, so each
  // writes only its own parameter.
  const handleFromChange = (value: string) => {
    setFrom(value);
    replaceParams((p) => (value ? p.set(QUERY.from, value) : p.delete(QUERY.from)));
  };

  const handleToChange = (value: string) => {
    setTo(value);
    replaceParams((p) => (value ? p.set(QUERY.to, value) : p.delete(QUERY.to)));
  };

  const removeFilter = (name: 'county' | 'location' | 'type' | 'search' | 'from' | 'to') => {
    if (name === 'search') setSearch('');
    if (name === 'type') setType('');
    if (name === 'location') setLocation('');
    if (name === 'county') setCounty('');
    if (name === 'from') setFrom('');
    if (name === 'to') setTo('');
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

      {/*
        The period, behind a disclosure.
        The archive reaches back to 2016 and the feed pages newest-first, so
        until this existed the only way to reach a particular week was to guess
        a word that appears in it — while the list itself told readers to
        "filtrera för att nå längre bak i arkivet" and pointed at nothing.

        Folded away because most readers want the last few days, which is what
        the feed already opens on: two more permanently visible boxes would
        cost every visit a row of chrome to serve the rarer question. It opens
        by itself when a range is set, so a shared link arrives with its own
        controls visible.
      */}
      <details className="filter-period" open={Boolean(filters.from || filters.to)}>
        <summary>Avgränsa i tiden</summary>
        <div className="filter-period-row">
          <label className="filter-period-field">
            <span>Från</span>
            <input
              className="field"
              type="date"
              name="from"
              value={from}
              max={to || today}
              onChange={(e) => handleFromChange(e.target.value)}
            />
          </label>
          <label className="filter-period-field">
            <span>Till</span>
            <input
              className="field"
              type="date"
              name="to"
              value={to}
              min={from || undefined}
              max={today}
              onChange={(e) => handleToChange(e.target.value)}
            />
          </label>
        </div>
        <p className="filter-period-hint">
          Datum räknas som svenska kalenderdygn, och båda ändarna räknas med.
          Lämna ett fält tomt för att bara sätta den andra gränsen.
        </p>
      </details>

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
              ['from', 'Från', filters.from],
              ['to', 'Till', filters.to],
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
