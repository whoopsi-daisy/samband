'use client';

import { useEffect, useState } from 'react';

/** One county, already projected: an SVG path and the code that identifies it. */
export interface CountyPath {
  lanskod: string;
  name: string;
  d: string;
}

export interface CountyShapes {
  width: number;
  height: number;
  counties: CountyPath[];
}

/**
 * The county outlines, fetched once and shared.
 *
 * Already projected. Sweden's borders do not move, so `npm run build:geo`
 * turns the GeoJSON into SVG paths at build time (see
 * scripts/build-county-paths.ts) and no projection code, and no coordinate
 * arithmetic, reaches a browser. 47 kB of GeoJSON becomes 13.5 kB of paths,
 * about 5 kB on the wire.
 *
 * Fetched rather than imported, so the bytes stay out of the JavaScript bundle
 * that every visitor downloads and are only asked for by a reader who opens the
 * statistics view.
 *
 * The promise is module-level, so two components mounting at once share one
 * request and a return visit re-renders from memory.
 */
let pending: Promise<CountyShapes> | null = null;

function load(): Promise<CountyShapes> {
  if (!pending) {
    // The async wrapper is load-bearing: `fetch` itself can throw synchronously
    // where it does not exist at all, and a synchronous throw inside an effect
    // is not a rejected promise — it escapes the .catch below and takes the
    // whole view down. Here the map is a decoration over a table that carries
    // every number, so its absence must cost the reader the picture and
    // nothing else.
    pending = (async (): Promise<CountyShapes> => {
      const response = await fetch('/geo/swedish-counties.json');
      if (!response.ok) throw new Error(`geometry: HTTP ${response.status}`);
      return (await response.json()) as CountyShapes;
    })().catch((error) => {
      // Cleared, so a reader who comes back after a dropped connection gets
      // another attempt rather than the cached failure for ever.
      pending = null;
      throw error;
    });
  }
  return pending;
}

export interface CountyGeometry {
  shapes: CountyShapes | null;
  failed: boolean;
}

export function useCountyGeometry(active: boolean): CountyGeometry {
  const [shapes, setShapes] = useState<CountyShapes | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    load().then(
      (data) => {
        if (!cancelled) setShapes(data);
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [active]);

  return { shapes, failed };
}
