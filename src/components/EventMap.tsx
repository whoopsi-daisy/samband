'use client';

import { useEffect, useRef, useMemo, useState, memo } from 'react';
import 'leaflet/dist/leaflet.css';
import { FormattedEvent, TYPE_FAMILIES, TypeFamilyKey, getTypeStyle } from '@/types';
import { markerInk } from '@/lib/markerInk';
import { useDarkTheme } from '@/hooks/useDarkTheme';

interface EventMapProps {
  events: FormattedEvent[];
  isActive: boolean;
  /** How far back the map is currently looking. */
  windowDays: number;
  onWindowChange: (days: number) => void;
  /** Events are being fetched from /api/map. */
  loading?: boolean;
  /** That fetch failed. */
  error?: boolean;
  /** Retry the fetch. */
  onRetry?: () => void;
  /** Take the reader to the feed, keeping their filters. */
  onShowList?: () => void;
  /** Whether a place, type or search is set, so the empty state can say why. */
  isFiltered?: boolean;
}

/**
 * The periods the map offers.
 *
 * A month is the far end, deliberately. The database holds a decade, but a map
 * of a decade is a map of Sweden with a dot on every town: it answers nothing,
 * and every marker on it is a report filed years ago at a position that was
 * approximate when it was new. The long view belongs to the statistics page,
 * which is built for it. This view answers "what is going on around here", and
 * that question has a short horizon.
 */
const WINDOWS: { days: number; label: string; phrase: string }[] = [
  // `phrase` carries the article, so it reads as Swedish inside a sentence
  // rather than as a button label dropped into one.
  { days: 1, label: 'Senaste dygnet', phrase: 'det senaste dygnet' },
  { days: 7, label: 'Senaste veckan', phrase: 'den senaste veckan' },
  { days: 30, label: 'Senaste månaden', phrase: 'den senaste månaden' },
];

// CartoDB ships the same basemap in two styles. Picking the one that matches
// the theme is what the stylesheet's invert(1) filter was standing in for, and
// it gets the water and the labels right, which inverting never could.
const basemapUrl = (dark: boolean) =>
  `https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`;

/**
 * The credit shown in the map's own corner.
 *
 * ODbL requires OpenStreetMap to be named wherever its data is shown, and
 * CARTO's terms say the same about the rendered tiles. Kept short, because a
 * corner control is read at a glance and the licence links carry the detail.
 */
const OSM_CREDIT =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap</a>';
const CARTO_CREDIT =
  `${OSM_CREDIT} &middot; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>`;

/** Incidents this fresh get a ring, whatever window is selected. */
const RECENT_MS = 60 * 60 * 1000;

/** Families listed in the key before the rest are folded into one row. */
const LEGEND_ROWS = 6;

/**
 * How wide the bubble is for a given pile of incidents.
 *
 * Wide enough for the number it has to hold, and no wider: sizing continuously
 * by count made the difference between two incidents and three a couple of
 * pixels nobody could read, while a busy city centre grew a disc that covered
 * the towns around it.
 */
function clusterSize(count: number): number {
  // 28 rather than 24 at the bottom. Twenty-four is exactly the WCAG 2.5.8
  // minimum, which leaves no headroom at all: two positions a few kilometres
  // apart overlap slightly at country zoom, and a bubble clipped by one pixel
  // is under the minimum. Four pixels of margin costs nothing and takes the
  // common case out of the failure.
  if (count < 10) return 28;
  if (count < 100) return 34;
  return 42;
}

/**
 * Incidents sharing one position, as one marker.
 *
 * This used to fan co-located markers out around a circle so they could all be
 * seen, displacing them by up to eight kilometres. On a map of where crimes
 * happened that is not a rendering detail, it is a false statement: the police
 * file a great many notices against a municipal or county centroid, so the pile
 * being spread out was a pile of incidents that never happened at any of the
 * places they were then drawn.
 *
 * One marker per position, carrying however many incidents are actually there,
 * says the true thing and is quieter besides.
 */
interface MarkerGroup {
  lat: number;
  lng: number;
  events: FormattedEvent[];
  newest: number;
}

function groupByPosition(events: FormattedEvent[]): MarkerGroup[] {
  const groups = new Map<string, MarkerGroup>();

  for (const e of events) {
    if (!e.gps) continue;
    const [lat, lng] = e.gps.split(',').map(Number);
    if (isNaN(lat) || isNaN(lng)) continue;

    // Rounded to about ten metres, so two notices filed at the same spot with
    // different float noise still count as the same spot.
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const ts = new Date(e.date?.iso || e.datetime).getTime();
    const group = groups.get(key);
    if (group) {
      group.events.push(e);
      if (ts > group.newest) group.newest = ts;
    } else {
      groups.set(key, { lat, lng, events: [e], newest: isNaN(ts) ? 0 : ts });
    }
  }

  // Newest last, so the freshest markers are drawn on top of older ones.
  return [...groups.values()].sort((a, b) => a.newest - b.newest);
}

// Escape HTML to prevent XSS in Leaflet popups
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** How a position is named, taken from one of the incidents filed at it. */
function placeLabel(event: FormattedEvent): string {
  return event.place ? `${event.place}, ${event.location}` : event.location || 'Okänd plats';
}

function relativeTime(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 2) return 'Just nu';
  if (minutes < 60) return `${minutes} min sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} tim sedan`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'dygn' : 'dygn'} sedan`;
}

function EventMapInner({
  events,
  isActive,
  windowDays,
  onWindowChange,
  loading = false,
  error = false,
  onRetry,
  onShowList,
  isFiltered = false,
}: EventMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersLayerRef = useRef<L.FeatureGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const hasFittedBoundsRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const isDark = useDarkTheme();
  // The map is built once, in an effect that must not re-run when the theme
  // changes, so the initial style is read through a ref.
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const groups = useMemo(() => groupByPosition(events), [events]);
  const mappable = useMemo(() => events.filter((e) => e.gps).length, [events]);
  /*
   * Notices in this period that carry no position at all.
   *
   * The map has large empty stretches, and until now nothing on the page said
   * why: a reader in one of them reasonably reads blank as "nothing happened
   * here". Some of it is real (most of Sweden has very few people in it), but
   * part of it is that a share of the feed arrives with no coordinates and
   * simply cannot be drawn. That share is a fact the map can state.
   */
  const missing = events.length - mappable;
  const activeWindow = WINDOWS.find((w) => w.days === windowDays) ?? WINDOWS[0];

  // --- Build the map once, when the view is first opened ---
  useEffect(() => {
    if (!isActive || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      leafletRef.current = L;

      // Wait one frame for the container to have layout
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (cancelled || !mapContainerRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [62.5, 17.5],
        zoom: 5,
        zoomControl: true,
        // Leaflet's own control, in the map's corner, is where the credit
        // belongs: it is a fact about the tiles rather than about the page, and
        // as a band of body text under the canvas it was the largest thing in
        // the block that explains the map. Switched off, the string handed to
        // the tile layer was never rendered at all, which ODbL and CARTO's
        // terms both require it to be.
        attributionControl: true,
        // Leaflet's default is whole zoom steps, and fitBounds always rounds
        // down to fit. Sweden's markers need about z5.5 in this canvas, so
        // every fit landed on z5 and drew the country at two thirds of the
        // size it had room for, ringed by empty map. Quarter steps take that
        // back without letting tiles scale far enough to go soft.
        zoomSnap: 0.25,
      });

      // No "Leaflet" prefix: the library is not a data source, and the strip is
      // narrow enough on a phone without it.
      map.attributionControl.setPrefix(false);

      const tileLayer = L.tileLayer(basemapUrl(isDarkRef.current), {
        attribution: CARTO_CREDIT,
        maxZoom: 18,
      }).addTo(map);
      baseLayerRef.current = tileLayer;

      let hasFallback = false;
      tileLayer.on('tileerror', () => {
        if (hasFallback) return;
        hasFallback = true;
        map.removeLayer(tileLayer);
        // OSM has one style only, so from here the theme swap has nothing to
        // swap and the layer stays as it is.
        baseLayerRef.current = null;
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: OSM_CREDIT,
          maxZoom: 19,
        }).addTo(map);
      });

      mapRef.current = map;
      setMapReady(true);

      // Make sure tiles render properly: double-nudge for mobile browsers
      setTimeout(() => map.invalidateSize(), 200);
      setTimeout(() => map.invalidateSize(), 600);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersLayerRef.current = null;
      leafletRef.current = null;
      baseLayerRef.current = null;
      hasFittedBoundsRef.current = false;
      setMapReady(false);
    };
  }, [isActive]);

  // Swap the basemap when the theme changes.
  //
  // The map used to load CartoDB's dark basemap whatever the theme was, and the
  // stylesheet then ran invert(1) over the tile pane in dark mode. A dark map
  // inverted is a bright one, so turning the lights off turned the map on.
  useEffect(() => {
    baseLayerRef.current?.setUrl(basemapUrl(isDark));
  }, [isDark]);

  // --- Draw the markers ---
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    if (markersLayerRef.current) markersLayerRef.current.clearLayers();
    else markersLayerRef.current = L.featureGroup().addTo(map);

    const layer = markersLayerRef.current;
    const now = Date.now();

    for (const group of groups) {
      const newest = group.events.reduce((best, e) => {
        const ts = new Date(e.date?.iso || e.datetime).getTime();
        return isNaN(ts) || ts < best.ts ? best : { event: e, ts };
      }, { event: group.events[0], ts: -Infinity });

      const style = getTypeStyle(newest.event.type);
      const isRecent = now - group.newest < RECENT_MS;
      const count = group.events.length;

      /*
       * A pile of incidents is drawn as its own count.
       *
       * It used to be a slightly larger dot, which is a difference of two or
       * three pixels: nothing on the map said whether a point was one notice or
       * ninety, and the police file a great many of them against the same
       * municipal position, so most of what looked like single incidents were
       * not. Printing the number is what makes the map answer "how much is
       * happening here" instead of "is anything at all".
       */
      if (count > 1) {
        const size = clusterSize(count);
        const { fill, ink } = markerInk(style.color);
        const label = count.toLocaleString('sv-SE');
        const marker = L.marker([group.lat, group.lng], {
          icon: L.divIcon({
            className: 'map-cluster-icon',
            html:
              `<span class="map-cluster${isRecent ? ' map-cluster--recent' : ''}" ` +
              `style="--cluster-fill:${fill};--cluster-ink:${ink};--cluster-size:${size}px">` +
              `${escapeHtml(label)}</span>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          }),
          // Markers built from a divIcon take keyboard focus, which the SVG
          // circles never did: the map's contents were unreachable without a
          // pointer. The title is what a screen reader announces on arrival.
          title: `${label} händelser, ${placeLabel(newest.event)}`,
          alt: `${label} händelser, ${placeLabel(newest.event)}`,
          riseOnHover: true,
        });

        marker.bindPopup(buildPopup(group, now), { maxWidth: 300 });
        layer.addLayer(marker);
        continue;
      }

      // A single incident stays an SVG dot. Cheap, and there are thousands of
      // them over a month-long window.
      const radius = 7;

      if (isRecent) {
        layer.addLayer(
          L.circleMarker([group.lat, group.lng], {
            radius: radius + 6,
            fillColor: style.color,
            color: style.color,
            weight: 1,
            opacity: 0.3,
            fillOpacity: 0.08,
            className: 'pulse-marker',
          })
        );
      }

      const marker = L.circleMarker([group.lat, group.lng], {
        radius,
        fillColor: style.color,
        color: '#fff',
        weight: isRecent ? 2.5 : 1.5,
        opacity: 1,
        fillOpacity: 0.9,
      });

      marker.bindPopup(buildPopup(group, now), { maxWidth: 300 });
      layer.addLayer(marker);
    }

    // Frame the markers once per selection, then leave the reader's own
    // panning and zooming alone.
    if (!hasFittedBoundsRef.current && groups.length > 0) {
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        // Measure the container first. Leaflet caches the map size, and the
        // invalidateSize calls that correct it run on timers after init, so a
        // fit that happened before them framed the markers against whatever
        // size Leaflet had recorded at startup. The looser the fit, the more
        // empty canvas around a country that is mostly empty canvas already.
        map.invalidateSize({ animate: false });
        /*
         * Sweden is roughly 1,570 km tall and 500 km wide and this canvas is
         * wider than it is tall, so a country-wide fit is always decided by the
         * height and the spare width fills with sea. That is not something
         * padding can fix, and it is the same on any map of Sweden in a
         * landscape frame; the deployed map only looked so empty because there
         * were twenty-one dots in it.
         *
         * What padding can do is stop giving away vertical room, which is the
         * axis that sets the zoom. The horizontal figure is nearly free.
         */
        map.fitBounds(bounds, {
          paddingTopLeft: [8, 32],
          paddingBottomRight: [8, 32],
          maxZoom: 11,
        });
        hasFittedBoundsRef.current = true;
      }
    }
  }, [groups, mapReady]);

  // A new selection gets framed again.
  useEffect(() => {
    hasFittedBoundsRef.current = false;
  }, [events, windowDays]);

  // --- Fix tile sizing on tab switch and orientation changes ---
  useEffect(() => {
    if (isActive && mapRef.current) {
      requestAnimationFrame(() => mapRef.current?.invalidateSize());
    }
  }, [isActive]);

  useEffect(() => {
    const onResize = () => mapRef.current?.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** The key to the marker colours, which are families rather than types. */
  const legend = useMemo(() => {
    const counts = new Map<TypeFamilyKey, number>();
    for (const e of events) {
      if (!e.gps) continue;
      const family = getTypeStyle(e.type).family;
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([key, count]) => ({ key, count, ...TYPE_FAMILIES[key] }))
      .sort((a, b) => b.count - a.count);

    // Eighteen families is a wall of chips under a map. The tail is one row.
    if (rows.length <= LEGEND_ROWS + 1) return { rows, rest: 0 };
    const rest = rows.slice(LEGEND_ROWS).reduce((sum, row) => sum + row.count, 0);
    return { rows: rows.slice(0, LEGEND_ROWS), rest };
  }, [events]);

  return (
    <div className={`map-view${isActive ? ' active' : ''}`} aria-hidden={!isActive}>
      {/* The window sits above the map, not below it: it decides what the map
          is showing, and a control that decides has to be read before it. */}
      <div className="map-windows" role="group" aria-label="Visa händelser från">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            className={`map-window${w.days === windowDays ? ' active' : ''}`}
            onClick={() => onWindowChange(w.days)}
            aria-pressed={w.days === windowDays}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="map-canvas-wrap">
          <div className="map-canvas" ref={mapContainerRef} />

          {loading && (
            <div className="map-overlay" role="status" aria-live="polite">
              <span className="spinner" />
              <span>Laddar karta…</span>
            </div>
          )}

          {error && !loading && (
            <div className="map-overlay" role="alert">
              <span>Kunde inte hämta händelserna till kartan.</span>
              {/* Refetch, rather than reloading the whole page and losing the
                  reader's filters, scroll position and open rows. */}
              <button type="button" className="btn-quiet" onClick={onRetry}>
                Försök igen
              </button>
            </div>
          )}

          {/* Nothing to draw. There was no state for this at all: the map went
              blank and left the reader to work out from a line below the fold
              whether it was the period or the filter. */}
          {!loading && !error && groups.length === 0 && (
            <div className="map-overlay" role="status">
              {/* "i det du filtrerat på" was unconditional, so an unfiltered
                  map with a quiet night told the reader to check a filter they
                  had never set. */}
              <span className="map-overlay-text">
                {isFiltered
                  ? `Inget ${activeWindow.phrase} matchar det du filtrerat på.`
                  : `Inga händelser med koordinater ${activeWindow.phrase}.`}{' '}
                {windowDays < 30
                  ? 'Prova en längre period, eller sök i listan.'
                  : 'Äldre händelser finns i listan.'}
              </span>
              {onShowList && (
                <button type="button" className="btn-quiet" onClick={onShowList}>
                  Öppna listan
                </button>
              )}
            </div>
          )}
        </div>

        <p className="map-status" role="status">
          <strong>{mappable.toLocaleString('sv-SE')}</strong>{' '}
          <span>
            {mappable === 1 ? 'händelse' : 'händelser'} {activeWindow.phrase}
            {groups.length > 0 && groups.length < mappable
              ? `, på ${groups.length.toLocaleString('sv-SE')} platser`
              : ''}
          </span>
          {/* Why parts of the country are blank. Only when there is something
              to account for: on a quiet day the whole window is drawable and
              the line would be noise. */}
          {missing > 0 && (
            <span className="map-status-missing">
              {missing.toLocaleString('sv-SE')} till saknar plats och kan inte ritas ut
            </span>
          )}
        </p>

        {/* One key rather than three strips. The colours had a row of their own
            with nothing above it saying what a colour was, and nothing anywhere
            explaining the numbers, the ring or where a point actually sits. */}
        <div className="map-key">
          <h2 className="map-key-title">Så läser du kartan</h2>

          <ul className="map-key-marks">
            {/* Short enough that the three sit on one row rather than two and a
                half. A key is glanced at beside its sample, not read. */}
            <li className="map-key-mark">
              <span className="map-key-sample map-key-sample--single" aria-hidden="true" />
              <span>En anmälan</span>
            </li>
            <li className="map-key-mark">
              <span className="map-key-sample map-key-sample--group" aria-hidden="true">
                7
              </span>
              <span>Antal på samma plats</span>
            </li>
            <li className="map-key-mark">
              <span className="map-key-sample map-key-sample--recent" aria-hidden="true" />
              <span>Inom senaste timmen</span>
            </li>
          </ul>

          {legend.rows.length > 0 && (
            <>
              <h3 className="map-key-subtitle">Färgen visar typ av händelse</h3>
              <ul className="map-key-colors">
                {legend.rows.map((item) => (
                  <li className="map-key-color" key={item.key}>
                    <span
                      className="map-key-dot"
                      style={{ background: item.color }}
                      aria-hidden="true"
                    />
                    <span className="map-key-name">{item.label}</span>
                    <span className="map-key-count">{item.count.toLocaleString('sv-SE')}</span>
                  </li>
                ))}
                {legend.rest > 0 && (
                  <li className="map-key-color map-key-color--rest">
                    <span className="map-key-dot map-key-dot--rest" aria-hidden="true" />
                    <span className="map-key-name">Övriga typer</span>
                    <span className="map-key-count">{legend.rest.toLocaleString('sv-SE')}</span>
                  </li>
                )}
              </ul>
            </>
          )}

          <p className="map-key-note">
            Punkten sitter där anmälan skrevs, inte nödvändigtvis där något hände. Polisen anger
            ofta en kommun eller en ort snarare än en adress, så anmälningar samlas i tätorterna.
          </p>
        </div>
      </div>
    </div>
  );
}

/** The popup for one position, listing what happened there. */
function buildPopup(group: MarkerGroup, now: number): string {
  const sorted = [...group.events].sort((a, b) => {
    const ta = new Date(a.date?.iso || a.datetime).getTime();
    const tb = new Date(b.date?.iso || b.datetime).getTime();
    return tb - ta;
  });

  const place = placeLabel(sorted[0]);

  // Long piles get their first few and a count, rather than a popup that needs
  // scrolling of its own.
  const shown = sorted.slice(0, 5);
  const hidden = sorted.length - shown.length;

  const rows = shown
    .map((e) => {
      const style = getTypeStyle(e.type);
      const ts = new Date(e.date?.iso || e.datetime).getTime();
      const when = isNaN(ts) ? '' : relativeTime(now - ts);
      const link = e.url
        ? `<a href="https://polisen.se${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(e.type)}</a>`
        : escapeHtml(e.type);
      return `
        <li class="popup-row">
          <span class="badge-emoji" aria-hidden="true">${escapeHtml(style.emoji)}</span>
          <span class="popup-row-main">${link}</span>
          <span class="popup-row-time">${escapeHtml(when)}</span>
        </li>`;
    })
    .join('');

  const gMaps = `https://www.google.com/maps/search/?api=1&query=${group.lat},${group.lng}`;

  return `
    <div class="map-popup">
      <p class="popup-place">${escapeHtml(place)}</p>
      <ul class="popup-list">${rows}</ul>
      ${hidden > 0 ? `<p class="popup-more">och ${hidden} till på samma plats</p>` : ''}
      <div class="popup-links">
        <a href="${gMaps}" target="_blank" rel="noopener noreferrer">Öppna i Google Maps</a>
      </div>
    </div>
  `;
}

// Only re-render when the events, the window or the view state actually change.
const EventMap = memo(EventMapInner);
export default EventMap;
