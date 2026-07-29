'use client';

import { useEffect, useRef, useCallback, useMemo, useState, memo } from 'react';
import 'leaflet/dist/leaflet.css';
import { FormattedEvent, TYPE_FAMILIES, TypeFamilyKey, getTypeStyle } from '@/types';
import { useDarkTheme } from '@/hooks/useDarkTheme';

interface EventMapProps {
  events: FormattedEvent[];
  isActive: boolean;
  /** Events are being fetched from /api/map. */
  loading?: boolean;
  /** That fetch failed. */
  error?: boolean;
  /** Retry the fetch. */
  onRetry?: () => void;
}

type TimeRange = '24h' | '48h' | '72h' | 'all';

/**
 * The windows the map can show.
 *
 * "Hela urvalet" is not a nicety. The map is fed the newest 500 rows matching
 * the reader's filters, and the archive reaches back to 2016, so filtering to a
 * place whose incidents are all archived produced five hundred rows and a
 * window that reached none of them: a blank map, with the count in 12px below
 * the fold as the only clue. Every fixed window has that failure mode, so one
 * of them has to have no bound at all.
 */
const TIME_RANGES: { key: TimeRange; label: string; ms: number }[] = [
  { key: '24h', label: 'Senaste 24 tim', ms: 24 * 60 * 60 * 1000 },
  { key: '48h', label: 'Senaste 48 tim', ms: 48 * 60 * 60 * 1000 },
  { key: '72h', label: 'Senaste 72 tim', ms: 72 * 60 * 60 * 1000 },
  { key: 'all', label: 'Hela urvalet', ms: Number.POSITIVE_INFINITY },
];

// CartoDB ships the same basemap in two styles. Picking the one that matches
// the theme is what the stylesheet's invert(1) filter was standing in for, and
// it gets the water and the labels right, which inverting never could.
const basemapUrl = (dark: boolean) =>
  `https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`;

const REPLAY_STEP_MS = 5 * 60 * 1000;
const REPLAY_INTERVAL_MS = 80;

// Only group events at effectively the same spot (within ~2 km).
const PROXIMITY_THRESHOLD = 0.02;

// Tiny nudge between co-located markers (~1-2 px at zoom 5).
// At city zoom they separate clearly; at country zoom they pile up,
// which is the expected behaviour for a dense metro area.
const MIN_GAP_DEG = 0.035;

// Hard cap, never displace more than ~8 km from the real position.
const MAX_FAN_RADIUS = 0.07;

/**
 * Pre-compute display positions so co-located markers (same city block)
 * get fanned out slightly.  Markers at distinct locations keep their
 * real GPS coordinates-overlaps at the country-wide zoom are acceptable.
 */
function computeMarkerPositions(events: FormattedEvent[]): Map<number, [number, number]> {
  const positions = new Map<number, [number, number]>();

  // Parse coordinates once
  const parsed: { id: number; lat: number; lng: number }[] = [];
  for (const e of events) {
    if (!e.gps || e.id === null) continue;
    const [lat, lng] = e.gps.split(',').map(Number);
    if (!isNaN(lat) && !isNaN(lng)) parsed.push({ id: e.id, lat, lng });
  }

  if (parsed.length === 0) return positions;

  // --- Step 1: cluster only near-identical locations ---
  const used = new Set<number>();
  const clusters: { indices: number[]; cLat: number; cLng: number }[] = [];

  for (let i = 0; i < parsed.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const members = [i];
    let cLat = parsed[i].lat;
    let cLng = parsed[i].lng;

    for (let j = i + 1; j < parsed.length; j++) {
      if (used.has(j)) continue;
      const dLat = parsed[j].lat - cLat;
      const dLng = parsed[j].lng - cLng;
      if (dLat * dLat + dLng * dLng < PROXIMITY_THRESHOLD * PROXIMITY_THRESHOLD) {
        members.push(j);
        used.add(j);
        // Update running centroid
        cLat = 0; cLng = 0;
        for (const idx of members) { cLat += parsed[idx].lat; cLng += parsed[idx].lng; }
        cLat /= members.length; cLng /= members.length;
      }
    }

    clusters.push({ indices: members, cLat, cLng });
  }

  // --- Step 2: place markers ---
  for (const { indices, cLat, cLng } of clusters) {
    if (indices.length === 1) {
      const p = parsed[indices[0]];
      positions.set(p.id, [p.lat, p.lng]);
    } else {
      // Fan out in a small circle, capped so dots stay near the real spot
      const idealRadius = (indices.length * MIN_GAP_DEG) / (2 * Math.PI);
      const fanRadius = Math.min(Math.max(MIN_GAP_DEG, idealRadius), MAX_FAN_RADIUS);

      for (let i = 0; i < indices.length; i++) {
        const angle = (2 * Math.PI * i) / indices.length - Math.PI / 2;
        positions.set(parsed[indices[i]].id, [
          cLat + fanRadius * Math.cos(angle),
          cLng + fanRadius * Math.sin(angle),
        ]);
      }
    }
  }

  return positions;
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

function EventMapInner({ events, isActive, loading = false, error = false, onRetry }: EventMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersLayerRef = useRef<L.FeatureGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const eventsRef = useRef<FormattedEvent[]>(events);
  const replayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasFittedBoundsRef = useRef(false);
  // Track which event IDs have been added during current replay run
  const addedMarkerIdsRef = useRef<Set<number>>(new Set());
  // Counter for replay runs to invalidate stale intervals
  const replayRunRef = useRef(0);

  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [isPlaying, setIsPlaying] = useState(false);
  const [replayPosition, setReplayPosition] = useState(1);
  const [replayTimestamp, setReplayTimestamp] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);

  const isDark = useDarkTheme();
  // The map is built once, in an effect that must not re-run when the theme
  // changes, so the initial style is read through a ref.
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  eventsRef.current = events;

  /**
   * How long the selected window is, in milliseconds.
   *
   * "Hela urvalet" has no length, and marker size, marker fade and the replay
   * step are all fractions of one. Resolved against the span of the rows on
   * hand instead: the oldest of them becomes the far end of the scale, so a
   * decade of archive fades over a decade rather than every dot rendering
   * identically fresh.
   */
  const getRangeMs = useCallback(
    (range?: TimeRange) => {
      const declared = TIME_RANGES.find(r => r.key === (range ?? timeRange))?.ms ?? 24 * 60 * 60 * 1000;
      if (Number.isFinite(declared)) return declared;

      let oldest = Infinity;
      for (const e of eventsRef.current) {
        const ts = new Date(e.date?.iso || e.datetime).getTime();
        if (!isNaN(ts) && ts < oldest) oldest = ts;
      }
      // One hour, so nothing downstream divides by zero on an empty selection.
      return Number.isFinite(oldest) ? Math.max(Date.now() - oldest, 60 * 60 * 1000) : 24 * 60 * 60 * 1000;
    },
    [timeRange]
  );

  // --- Clear all markers from the map ---
  const clearMarkers = useCallback(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (markersLayerRef.current) {
      markersLayerRef.current.clearLayers();
    } else {
      markersLayerRef.current = L.featureGroup().addTo(map);
    }

  }, []);

  // --- Add a single marker to the map ---
  const addMarker = useCallback((e: FormattedEvent, now: number, rangeMs: number, posOverride?: [number, number]) => {
    const L = leafletRef.current;
    if (!L || !markersLayerRef.current) return;
    if (!e.gps) return;

    const [rawLat, rawLng] = e.gps.split(',').map(Number);
    if (isNaN(rawLat) || isNaN(rawLng)) return;

    const lat = posOverride ? posOverride[0] : rawLat;
    const lng = posOverride ? posOverride[1] : rawLng;

    const eventTs = new Date(e.date?.iso || e.datetime).getTime();
    const age = now - eventTs;
    const ageFrac = Math.min(1, age / rangeMs);

    const opacity = 0.95 - ageFrac * 0.6;
    const radius = 10 - ageFrac * 4;
    const isRecent = age < 30 * 60 * 1000;

    const mins = Math.floor(age / 60000);
    const hours = Math.floor(age / 3600000);
    const relTime = mins <= 1 ? 'Just nu' : mins < 60 ? `${mins} min sedan` : `${hours} tim sedan`;

    // Pulse ring for recent events
    if (isRecent) {
      markersLayerRef.current.addLayer(
        L.circleMarker([lat, lng], {
          radius: radius + 6,
          fillColor: e.color,
          color: e.color,
          weight: 1,
          opacity: 0.3,
          fillOpacity: 0.08,
          className: 'pulse-marker',
        })
      );
    }

    const marker = L.circleMarker([lat, lng], {
      radius,
      fillColor: e.color,
      color: '#fff',
      weight: isRecent ? 2.5 : 1.5,
      opacity: 1 - ageFrac * 0.5,
      fillOpacity: opacity,
    });

    const safeName = escapeHtml(e.name || '');
    const safeType = escapeHtml(e.type || '');
    const safeSummary = escapeHtml(
      (e.summary || '').length > 120 ? e.summary!.substring(0, 120) + '...' : e.summary || ''
    );
    // Same rule as the feed row: the municipality first when the source only
    // filed the notice under a county.
    const safeLocation = escapeHtml(e.place ? `${e.place}, ${e.location}` : e.location || '');
    const safeColor = escapeHtml(e.color || '');
    const safeEmoji = escapeHtml(e.emoji || '');
    const safeUrl = e.url ? escapeHtml(e.url) : '';
    const gMaps = `https://www.google.com/maps/search/?api=1&query=${rawLat},${rawLng}`;

    marker.bindPopup(`
      <div class="map-popup">
        <div class="popup-head">
          <span class="badge badge--type" style="background:${safeColor}1f;color:${safeColor};border-color:${safeColor}3d"><span class="badge-emoji">${safeEmoji}</span>${safeType}</span>
          <span class="popup-time">${isRecent ? '<span class="popup-live"></span>' : ''}${relTime}</span>
        </div>
        <h3>${safeName}</h3>
        <p>${safeSummary}</p>
        <p class="popup-place">${safeLocation}</p>
        <div class="popup-links">
          <a href="${gMaps}" target="_blank" rel="noopener noreferrer">Google Maps</a>
          ${safeUrl ? `<a href="https://polisen.se${safeUrl}" target="_blank" rel="noopener noreferrer nofollow">polisen.se</a>` : ''}
        </div>
      </div>
    `);

    markersLayerRef.current.addLayer(marker);
  }, []);

  // --- Full render of all markers (for non-playing states) ---
  const renderMarkers = useCallback((cutoffTs?: number | null, rangeOverride?: TimeRange) => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    clearMarkers();
    if (!markersLayerRef.current) {
      markersLayerRef.current = L.featureGroup().addTo(map);
    }

    const now = cutoffTs ?? Date.now();
    const rangeMs = getRangeMs(rangeOverride);
    const windowStart = now - rangeMs;

    const visible = eventsRef.current.filter(e => {
      const ts = new Date(e.date?.iso || e.datetime).getTime();
      return !isNaN(ts) && ts >= windowStart && ts <= now;
    });

    const positions = computeMarkerPositions(visible);

    for (const e of visible) {
      const pos = e.id !== null ? positions.get(e.id) : undefined;
      addMarker(e, now, rangeMs, pos);
    }

    const count = markersLayerRef.current.getLayers().length;
    setVisibleCount(visible.length);

    // Fit bounds once on first meaningful render
    if (!hasFittedBoundsRef.current && !cutoffTs && count > 0) {
      map.fitBounds(markersLayerRef.current.getBounds(), { padding: [40, 40] });
      hasFittedBoundsRef.current = true;
    }
  }, [getRangeMs, clearMarkers, addMarker]);

  // --- Initialize map once ---
  useEffect(() => {
    if (!isActive || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      if (cancelled) return;
      leafletRef.current = L;

      // Wait one frame for the container to have layout
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      if (cancelled || !mapContainerRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [62.5, 17.5],
        zoom: 5,
        zoomControl: true,
        attributionControl: false,
      });

      const tileLayer = L.tileLayer(basemapUrl(isDarkRef.current), {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(map);
      baseLayerRef.current = tileLayer;

      // Fallback: if primary tiles fail, switch to OSM
      let hasFallback = false;
      tileLayer.on('tileerror', () => {
        if (hasFallback) return;
        hasFallback = true;
        map.removeLayer(tileLayer);
        // OSM has one style only, so from here the theme swap has nothing to
        // swap and the layer stays as it is.
        baseLayerRef.current = null;
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
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
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersLayerRef.current = null;
      leafletRef.current = null;
      hasFittedBoundsRef.current = false;
      setMapReady(false);
    };
  }, [isActive]); // Only depends on isActive: stable

  // Swap the basemap when the theme changes.
  //
  // The map used to load CartoDB's dark basemap whatever the theme was, and the
  // stylesheet then ran invert(1) over the tile pane in dark mode. A dark map
  // inverted is a bright one, so turning the lights off turned the map on.
  // Picking the matching style is also better than inverting ever was: an
  // inverted basemap has the water and the labels in the wrong colours.
  useEffect(() => {
    const layer = baseLayerRef.current;
    if (!layer) return;
    layer.setUrl(basemapUrl(isDark));
  }, [isDark]);

  // --- Render markers when data/range changes (non-playing) ---
  useEffect(() => {
    if (mapReady && !isPlaying) {
      renderMarkers(replayTimestamp);
    }
  }, [mapReady, events, timeRange, renderMarkers, isPlaying, replayTimestamp]);

  // --- Fix tile sizing on tab switch and orientation changes ---
  useEffect(() => {
    if (isActive && mapRef.current) {
      requestAnimationFrame(() => mapRef.current?.invalidateSize());
      // Delayed nudge for slower mobile layout reflows
      const t = setTimeout(() => mapRef.current?.invalidateSize(), 300);
      return () => clearTimeout(t);
    }
  }, [isActive]);

  // Re-layout on window resize / orientation change (mobile)
  useEffect(() => {
    if (!mapReady) return;
    const onResize = () => {
      requestAnimationFrame(() => mapRef.current?.invalidateSize());
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [mapReady]);

  // --- Replay engine: animated dot-by-dot playback ---
  useEffect(() => {
    if (!isPlaying || !mapReady) {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
      }
      return;
    }

    // New run: bump counter, reset tracking
    const runId = ++replayRunRef.current;
    addedMarkerIdsRef.current = new Set();

    // Immediately clear all existing markers for a clean slate
    clearMarkers();
    if (!markersLayerRef.current) {
      const L = leafletRef.current;
      if (L && mapRef.current) {
        markersLayerRef.current = L.featureGroup().addTo(mapRef.current);
      }
    }
    setVisibleCount(0);

    const rangeMs = getRangeMs();
    const now = Date.now();
    const start = now - rangeMs;
    let pos = 0;

    // Pre-sort events by timestamp for efficient replay
    const sortedEvents = eventsRef.current
      .filter(e => {
        const ts = new Date(e.date?.iso || e.datetime).getTime();
        return !isNaN(ts) && ts >= start && ts <= now && e.gps;
      })
      .sort((a, b) => {
        const ta = new Date(a.date?.iso || a.datetime).getTime();
        const tb = new Date(b.date?.iso || b.datetime).getTime();
        return ta - tb;
      });

    // Pre-compute offset positions so co-located markers fan out
    const positions = computeMarkerPositions(sortedEvents);

    replayIntervalRef.current = setInterval(() => {
      // Stale run check
      if (replayRunRef.current !== runId) return;

      pos += REPLAY_STEP_MS / rangeMs;
      if (pos >= 1) {
        pos = 1;
        setIsPlaying(false);
        setReplayPosition(1);
        setReplayTimestamp(null);
        // Re-render all markers in final state
        renderMarkers(null);
        return;
      }

      setReplayPosition(pos);
      const ts = start + pos * rangeMs;
      setReplayTimestamp(ts);

      // Add only NEW markers that haven't been added yet
      for (const e of sortedEvents) {
        const eventTs = new Date(e.date?.iso || e.datetime).getTime();
        if (eventTs > ts) break; // sorted, so no more to add
        if (e.id !== null && addedMarkerIdsRef.current.has(e.id)) continue;
        const posOverride = e.id !== null ? positions.get(e.id) : undefined;
        addMarker(e, ts, rangeMs, posOverride);
        if (e.id !== null) addedMarkerIdsRef.current.add(e.id);
      }

      const totalAdded = addedMarkerIdsRef.current.size;
      setVisibleCount(totalAdded);
    }, REPLAY_INTERVAL_MS);

    return () => {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
      }
    };
  }, [isPlaying, mapReady, getRangeMs, renderMarkers, clearMarkers, addMarker]);

  // --- Handlers ---
  const handleSlider = useCallback((val: number) => {
    setIsPlaying(false);
    setReplayPosition(val);
    if (val >= 0.99) {
      setReplayTimestamp(null);
      renderMarkers(null);
    } else {
      const rangeMs = getRangeMs();
      const ts = Date.now() - rangeMs + val * rangeMs;
      setReplayTimestamp(ts);
      renderMarkers(ts);
    }
  }, [getRangeMs, renderMarkers]);

  /** The narrowest window that actually contains something. */
  const firstRangeWithEvents = useCallback((): TimeRange | null => {
    const now = Date.now();
    for (const range of TIME_RANGES) {
      const start = Number.isFinite(range.ms) ? now - range.ms : -Infinity;
      const hit = eventsRef.current.some((e) => {
        const ts = new Date(e.date?.iso || e.datetime).getTime();
        return !isNaN(ts) && ts >= start && ts <= now && e.gps;
      });
      if (hit) return range.key;
    }
    return null;
  }, []);

  // Open on a window that has something in it.
  //
  // The default is the last 24 hours, which is right for the live feed and
  // wrong for everything else: filter to a place whose incidents are all in the
  // archive and the reader gets an empty map while the list shows hundreds of
  // rows for the same filter. Widening on their behalf is only done on arrival
  // and after a filter change, never over a window they picked themselves.
  const autoWidenedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isActive || loading || events.length === 0) return;
    // Keyed on the selection, so a new filter gets one adjustment and no more.
    const key = events.map((e) => e.id).join(',');
    if (autoWidenedForRef.current === key) return;
    autoWidenedForRef.current = key;

    const widest = firstRangeWithEvents();
    if (widest && widest !== timeRange) {
      setTimeRange(widest);
      hasFittedBoundsRef.current = false;
    }
    // `timeRange` is deliberately not a dependency: this must not re-run when
    // the reader changes the window themselves. The guard above makes that
    // safe, since the effect acts once per selection either way.
  }, [isActive, loading, events, firstRangeWithEvents, timeRange]);

  const handleRangeChange = useCallback((r: TimeRange) => {
    setTimeRange(r);
    setIsPlaying(false);
    setReplayPosition(1);
    setReplayTimestamp(null);
    hasFittedBoundsRef.current = false; // re-fit bounds on range change
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => {
      if (!prev) setReplayPosition(0);
      return !prev;
    });
  }, []);

  const rangeLabel = TIME_RANGES.find((r) => r.key === timeRange)?.label ?? 'Senaste 24 tim';

  // Rows that could be drawn at all, ignoring the window. Separates "your
  // window is empty" from "this filter has nothing with a position on it",
  // which are different problems with different ways out.
  const mappableCount = useMemo(() => events.filter((e) => e.gps).length, [events]);
  const sliderLabel = replayTimestamp
    ? new Date(replayTimestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    : 'Live';

  // Key for the marker colours.
  //
  // Keyed on the family, because the family is what the colour encodes. It
  // used to list the eight commonest types, which with sixty-odd types meant
  // most markers on screen had no entry at all, and two entries could carry the
  // same dot. There are eighteen families and a legend can name all of them, so
  // every colour on the map is now in the key and every key entry is a
  // different colour. Which type a particular marker is, is what the popup is
  // for.
  const legend = useMemo(() => {
    const seen = new Map<TypeFamilyKey, number>();
    const rangeMs = getRangeMs();
    const until = replayTimestamp ?? Date.now();
    const cutoff = Number.isFinite(rangeMs) ? until - rangeMs : -Infinity;
    for (const e of events) {
      const ts = new Date(e.date?.iso || e.datetime).getTime();
      if (isNaN(ts) || ts < cutoff || ts > until || !e.gps) continue;
      const family = getTypeStyle(e.type).family;
      seen.set(family, (seen.get(family) ?? 0) + 1);
    }
    return [...seen.entries()]
      .map(([key, count]) => ({ key, count, ...TYPE_FAMILIES[key] }))
      .sort((a, b) => b.count - a.count);
  }, [events, replayTimestamp, getRangeMs]);

  return (
    <div className={`map-view${isActive ? ' active' : ''}`} aria-hidden={!isActive}>
      <div className="panel">
        <div className="map-canvas-wrap">
          {/* Map container first for immediate visibility */}
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
              blank and left the reader to work out from a 12px line below the
              fold that the window was empty rather than the filter. The two
              cases are different and say so, and the recoverable one offers the
              way out instead of describing it. */}
          {!loading && !error && visibleCount === 0 && (
            <div className="map-overlay" role="status">
              {mappableCount > 0 ? (
                <>
                  <span>
                    Inget inträffade {rangeLabel.toLowerCase()}, men {mappableCount.toLocaleString('sv-SE')}{' '}
                    {mappableCount === 1 ? 'händelse' : 'händelser'} finns längre bak.
                  </span>
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => handleRangeChange('all')}
                  >
                    Visa hela urvalet
                  </button>
                </>
              ) : (
                <span>
                  {events.length > 0
                    ? 'Ingen av händelserna i urvalet har en position att sätta ut.'
                    : 'Ingen händelse matchar det du filtrerat på.'}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Replay controls, as a bar under the map rather than floating on it */}
        <div className="map-timeline">
          {/* Labelled, not a bare glyph: nothing else on the page said what
              playing a map would do. */}
          <button type="button" className="btn-ghost timeline-play" onClick={togglePlay}>
            {isPlaying ? (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                Pausa
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,3 20,12 6,21"/></svg>
                Spela upp
              </>
            )}
          </button>

          <input
            type="range"
            className="timeline-slider"
            min="0"
            max="1"
            step="0.005"
            value={replayPosition}
            onChange={(e) => handleSlider(parseFloat(e.target.value))}
            aria-label="Tidslinje"
          />

        </div>

        <div className="timeline-ranges" role="group" aria-label="Visa händelser från de senaste">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`timeline-range${timeRange === r.key ? ' active' : ''}`}
              onClick={() => handleRangeChange(r.key)}
              aria-pressed={timeRange === r.key}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Spelled out rather than left as a bare number beside the scrubber. */}
        <p className="map-status" role="status">
          {/* The spaces are explicit. JSX drops whitespace that contains a
              newline between elements, which rendered this as "0händelser". */}
          <strong>{visibleCount.toLocaleString('sv-SE')}</strong>{' '}
          <span>
            {visibleCount === 1 ? 'händelse' : 'händelser'}, {rangeLabel.toLowerCase()}
          </span>{' '}
          <span aria-hidden="true">·</span>{' '}
          {replayTimestamp ? (
            <span>visar läget kl {sliderLabel}</span>
          ) : (
            <span className="map-status-live">
              <span className="dot dot--sm dot--ok" aria-hidden="true" /> nuläget
            </span>
          )}
        </p>

        {legend.length > 0 && (
          <div className="map-legend" aria-label="Färgförklaring">
            {legend.map((item) => (
              <span className="map-legend-item" key={item.key}>
                <span
                  className="map-legend-dot"
                  style={{ background: item.color }}
                  aria-hidden="true"
                />
                {item.label} <span className="map-legend-count">({item.count})</span>
              </span>
            ))}
          </div>
        )}

        <p className="map-hint">
          Färgen visar vilken sorts händelse det är, storleken hur färsk notisen är. Dra i
          reglaget för att spola tillbaka i tiden.
        </p>
      </div>
    </div>
  );
}

export default memo(EventMapInner);
