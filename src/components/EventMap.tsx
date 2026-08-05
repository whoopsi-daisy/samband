'use client';

import { useEffect, useRef, useMemo, useState, memo } from 'react';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
// Type-only. @types/leaflet.markercluster augments the 'leaflet' module, and
// the augmentation is only visible in a file that imports that module by name;
// this one otherwise only reaches Leaflet through a dynamic import.
import type { MarkerClusterGroup } from 'leaflet';
import { MapEvent, TYPE_FAMILIES, TypeFamilyKey, getTypeStyle } from '@/types';
import { markerInk } from '@/lib/markerInk';
import {
  MarkerGroup,
  bubbleSize,
  hasPosition,
  familyOfGroup,
  groupByPosition,
  summariseCluster,
} from '@/lib/markerGroups';
import { formatRelativeTime } from '@/lib/utils';
import { useDarkTheme } from '@/hooks/useDarkTheme';

interface EventMapProps {
  events: MapEvent[];
  /**
   * Notices in the window, which is more than `events` when the query hit its
   * cap. The two being different is the only way the map can tell the reader
   * it is showing a slice.
   */
  total?: number;
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

/**
 * The periods that are allowed in the URL.
 *
 * Exported from here rather than restated where the parameter is read, so a
 * window added to the control above is accepted in a link without a second
 * edit, and one removed stops being accepted.
 */
export const MAP_WINDOW_DAYS: number[] = WINDOWS.map((window) => window.days);

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

/**
 * The tile credit, folded behind a single character.
 *
 * ODbL requires OpenStreetMap to be named wherever its data is shown and
 * CARTO's terms say the same about the rendered tiles, so this cannot simply
 * go. OpenStreetMap's own attribution guidelines allow it to sit behind an
 * "i" on a constrained interactive map, which is what Google and Mapbox do,
 * and it is the only version of "remove it" that does not put the deployment
 * in breach of the licence its basemap is under.
 *
 * Expands on click and on focus, so a keyboard reaches it as easily as a
 * pointer, and it is a real button rather than a hover trick.
 */
function addCreditControl(L: typeof import('leaflet'), map: L.Map): void {
  const Credit = L.Control.extend({
    options: { position: 'bottomright' as L.ControlPosition },
    onAdd(): HTMLElement {
      const wrap = L.DomUtil.create('div', 'leaflet-control map-credit');

      const panel = L.DomUtil.create('div', 'map-credit-panel', wrap);
      panel.innerHTML = CARTO_CREDIT;
      panel.hidden = true;

      const toggle = L.DomUtil.create('button', 'map-credit-toggle', wrap);
      toggle.type = 'button';
      toggle.textContent = 'i';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Om kartan och dess källor');
      toggle.title = 'Om kartan och dess källor';

      // Tracked here rather than read back off the element: `hidden` is typed
      // as boolean | "until-found" now, and negating that is not a toggle.
      let open = false;
      const setOpen = (next: boolean) => {
        open = next;
        panel.hidden = !next;
        toggle.setAttribute('aria-expanded', String(next));
      };

      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.on(toggle, 'click', () => setOpen(!open));
      // Focus opens it too, so tabbing to the button reveals what it is for.
      L.DomEvent.on(toggle, 'focus', () => setOpen(true));
      L.DomEvent.on(wrap, 'focusout', (event) => {
        const next = (event as FocusEvent).relatedTarget as Node | null;
        if (!next || !wrap.contains(next)) setOpen(false);
      });

      return wrap;
    },
  });

  new Credit().addTo(map);
}

/**
 * A fullscreen toggle, where fullscreen is a thing that exists.
 *
 * Leaflet has no such control and the plugins for it predate the Fullscreen
 * API being universal, so this is the API plus a button.
 *
 * Not offered on a touch device: iOS Safari does not implement fullscreen for
 * anything but a video, and on a phone the map already fills the screen, so
 * the control would be a button that either does nothing or does nothing
 * useful. Gated on a fine pointer rather than on width, because that is the
 * actual question being asked.
 */
function addFullscreenControl(L: typeof import('leaflet'), map: L.Map): void {
  if (typeof document === 'undefined' || !document.fullscreenEnabled) return;
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const target = map.getContainer();

  const Fullscreen = L.Control.extend({
    options: { position: 'topleft' as L.ControlPosition },
    onAdd(): HTMLElement {
      const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-fullscreen');
      const button = L.DomUtil.create('a', 'map-fullscreen-button', wrap);
      button.href = '#';
      button.setAttribute('role', 'button');

      const label = () => (document.fullscreenElement === target ? 'Avsluta helskärm' : 'Helskärm');
      const paint = () => {
        const on = document.fullscreenElement === target;
        wrap.classList.toggle('map-fullscreen--on', on);
        button.setAttribute('aria-label', label());
        button.title = label();
        // Leaflet caches the map size, and going fullscreen changes it without
        // firing a window resize the map listens to.
        map.invalidateSize();
      };

      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.on(button, 'click', (event) => {
        L.DomEvent.preventDefault(event);
        if (document.fullscreenElement === target) {
          void document.exitFullscreen();
        } else {
          // Rejected when the gesture is not trusted, which is not worth an
          // error to a reader who can simply click again.
          void target.requestFullscreen().catch(() => {});
        }
      });

      document.addEventListener('fullscreenchange', paint);
      paint();
      return wrap;
    },
  });

  new Fullscreen().addTo(map);
}

/** Incidents this fresh get a ring, whatever window is selected. */
const RECENT_MS = 60 * 60 * 1000;

/** Families listed in the key before the rest are folded into one row. */
const LEGEND_ROWS = 6;

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
function placeLabel(event: MapEvent): string {
  return event.place ? `${event.place}, ${event.location}` : event.location || 'Okänd plats';
}

function EventMapInner({
  events,
  total,
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
  const markersLayerRef = useRef<MarkerClusterGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const hasFittedBoundsRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const isDark = useDarkTheme();
  // The map is built once, in an effect that must not re-run when the theme
  // changes, so the initial style is read through a ref.
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const groups = useMemo(() => groupByPosition(events), [events]);
  const mappable = useMemo(() => events.filter(hasPosition).length, [events]);
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
  // Only when the server actually reported more than it sent.
  const truncated = typeof total === 'number' && total > events.length;
  const activeWindow = WINDOWS.find((w) => w.days === windowDays) ?? WINDOWS[0];

  // --- Build the map once, when the view is first opened ---
  useEffect(() => {
    if (!isActive || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      // Registers L.markerClusterGroup on the namespace above; it has no export
      // of its own and must land before the layer is created.
      await import('leaflet.markercluster');
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
        // Off: the credit is rendered by the collapsed control added below,
        // which keeps it reachable without a band of text across the map.
        attributionControl: false,
        // Leaflet's default is whole zoom steps, and fitBounds always rounds
        // down to fit. Sweden's markers need about z5.5 in this canvas, so
        // every fit landed on z5 and drew the country at two thirds of the
        // size it had room for, ringed by empty map. Quarter steps take that
        // back without letting tiles scale far enough to go soft.
        zoomSnap: 0.25,
      });

      addCreditControl(L, map);
      addFullscreenControl(L, map);

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
    else {
      /*
       * Markers that merely overlap on screen are merged into one, and split
       * again as the reader zooms in.
       *
       * Grouping by position (above) is about incidents genuinely filed at the
       * same coordinate. This is a different problem: once the feed stopped
       * collapsing to twenty-one county centres it started resolving to a
       * hundred and fifty-eight municipalities, and at country zoom the whole of
       * Götaland became a pile of discs covering each other, with the ones
       * underneath neither readable nor clickable.
       *
       * leaflet.markercluster rather than a hand-rolled pixel grid: it already
       * knows how to re-cluster on every zoom, spiderfy points that are exactly
       * coincident, and keep the layer in step with additions. Its default
       * green-yellow-red icons are replaced below, because on this map colour
       * already means the kind of incident and a second meaning for it would
       * make both unreadable.
       */
      markersLayerRef.current = L.markerClusterGroup({
        // The default 80px merges towns that are perfectly distinguishable.
        // A bubble is 28-50px across, so this merges about what actually
        // overlaps and no more.
        maxClusterRadius: 46,
        // The convex hull drawn over a cluster's members on hover is a lot of
        // ink to say something the reader is about to see by zooming.
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        zoomToBoundsOnClick: true,
        // Leaflet's own reduced-motion story is nothing, so this is it.
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        iconCreateFunction: (cluster) => {
          const children = cluster.getAllChildMarkers() as Array<
            L.Marker & { sambandGroup?: MarkerGroup }
          >;
          const contained = children
            .map((child) => child.sambandGroup)
            .filter((group): group is MarkerGroup => group !== undefined);

          const summary = summariseCluster(contained, Date.now(), RECENT_MS);
          const size = bubbleSize(summary.count);
          const { fill, ink } = markerInk(TYPE_FAMILIES[summary.family].color);
          const label = summary.count.toLocaleString('sv-SE');

          /*
           * The sr-only line is the cluster's accessible name.
           *
           * markercluster builds these markers itself, so there is no options
           * object to hand a `title` to the way the position markers get one.
           * Left alone, the focusable element's only text content is the bare
           * number, and a screen reader announces a cluster of two hundred
           * incidents as "24". The digits are hidden from the tree and the
           * sentence stands in for them.
           */
          return L.divIcon({
            className: 'map-pin-icon',
            html:
              `<span class="map-pin map-pin--many map-pin--cluster` +
              `${summary.recent ? ' map-pin--recent' : ''}" ` +
              `style="--pin-fill:${fill};--pin-ink:${ink};--pin-size:${size}px">` +
              `<span aria-hidden="true">${escapeHtml(label)}</span>` +
              `<span class="sr-only">${escapeHtml(label)} händelser på flera platser. ` +
              `Zooma in för att dela upp.</span>` +
              `</span>`,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
        },
      }).addTo(map);
    }

    const layer = markersLayerRef.current;
    const now = Date.now();
    const pins: L.Marker[] = [];

    for (const group of groups) {
      const family = familyOfGroup(group);
      const style = TYPE_FAMILIES[family];
      const isRecent = now - group.newest < RECENT_MS;
      const count = group.events.length;
      const size = bubbleSize(count);
      const { fill, ink } = markerInk(style.color);
      const label = count > 1 ? count.toLocaleString('sv-SE') : '';
      const name =
        count > 1
          ? `${count.toLocaleString('sv-SE')} händelser, ${placeLabel(group.events[0])}`
          : `${group.events[0].type}, ${placeLabel(group.events[0])}`;

      /*
       * Every position is a divIcon, single incidents included.
       *
       * Singles used to be SVG circles, which markercluster does not accept and
       * which never took keyboard focus: half the map's contents were
       * unreachable without a pointer. One kind of mark for both also means the
       * recent ring is a box-shadow rather than a second overlay layer, so
       * nothing has to be kept in step with anything.
       */
      const marker = L.marker([group.lat, group.lng], {
        icon: L.divIcon({
          className: 'map-pin-icon',
          html:
            `<span class="map-pin${count > 1 ? ' map-pin--many' : ''}` +
            `${isRecent ? ' map-pin--recent' : ''}" ` +
            `style="--pin-fill:${fill};--pin-ink:${ink};--pin-size:${size}px">` +
            `${escapeHtml(label)}</span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        title: name,
        alt: name,
        riseOnHover: true,
      });

      // What the cluster icon reads to work out its own colour and count.
      (marker as L.Marker & { sambandGroup?: MarkerGroup }).sambandGroup = group;

      marker.bindPopup(buildPopup(group, now), { maxWidth: 300 });
      pins.push(marker);
    }

    /*
     * Added in one call, not one at a time.
     *
     * markercluster rebuilds its whole cluster tree on every addLayer, so a
     * loop of them is that work repeated once per marker. At 500 positions
     * nobody noticed; the cap is 3,000 now, and addLayers takes the bulk path
     * that the plugin's own documentation says to use for exactly this.
     */
    layer.addLayers(pins);

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
      if (!hasPosition(e)) continue;
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
          {/* The count above is what is drawn. When the query hit its cap that
              is not the whole period, and saying "500 händelser den senaste
              månaden" about the newest 500 of 1,700 is a number that looks
              like a total and is not one. */}
          {truncated && (
            <span className="map-status-capped">
              Visar de senaste av {total.toLocaleString('sv-SE')} händelser{' '}
              {activeWindow.phrase}
            </span>
          )}
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
            {/* Each label is three or four words and the sample demonstrates
                it: the middle one really is a 7, so "7 på samma plats" is read
                rather than worked out. The previous wording explained the
                marks in sentences, which is a paragraph nobody finishes above
                a map they came to look at. */}
            <li className="map-key-mark">
              <span className="map-key-sample map-key-sample--single" aria-hidden="true" />
              <span>1 anmälan</span>
            </li>
            <li className="map-key-mark">
              <span className="map-key-sample map-key-sample--group" aria-hidden="true">
                7
              </span>
              <span>7 på samma plats</span>
            </li>
            <li className="map-key-mark">
              <span className="map-key-sample map-key-sample--cluster" aria-hidden="true">
                24
              </span>
              <span>Zooma in för att dela upp</span>
            </li>
            <li className="map-key-mark">
              <span className="map-key-sample map-key-sample--recent" aria-hidden="true" />
              <span>Senaste timmen</span>
            </li>
          </ul>

          {legend.rows.length > 0 && (
            <>
              <h3 className="map-key-subtitle">Typ av händelse</h3>
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

          {/* One line. This was two sentences explaining that the police file
              against a municipality rather than an address; the part a reader
              has to know is that the pin is not the address, and that fits in
              six words. */}
          <p className="map-key-note">Punkten visar kommunen, inte exakt adress.</p>
        </div>
      </div>
    </div>
  );
}

/** The popup for one position, listing what happened there. */
function buildPopup(group: MarkerGroup, now: number): string {
  const sorted = [...group.events].sort((a, b) => {
    const ta = new Date(a.iso).getTime();
    const tb = new Date(b.iso).getTime();
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
      const ts = new Date(e.iso).getTime();
      // The same words the feed uses for the same age. The map had its own
      // implementation that said "3 dygn sedan" where a card said "3 dagar
      // sedan", and stopped at days, so a marker near the end of the month-long
      // window read "29 dygn sedan" against the feed's "4 veckor sedan".
      const when = isNaN(ts) ? '' : formatRelativeTime(new Date(ts), new Date(now));
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
