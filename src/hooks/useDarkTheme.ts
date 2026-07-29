'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the dark theme is on, kept current as the reader toggles it.
 *
 * The theme lives as `data-theme` on <html>, written before first paint by the
 * inline bootstrap in the root layout and rewritten by the toggle in the
 * header. CSS picks that up on its own; anything drawn in JavaScript, like a
 * map basemap, has to watch the attribute instead.
 *
 * False on the server and on the first client render, so the markup matches;
 * the real value lands in the effect immediately afterwards.
 */
export function useDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setIsDark(root.getAttribute('data-theme') === 'dark');

    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
