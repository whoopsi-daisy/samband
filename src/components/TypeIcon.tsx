import React from 'react';

/**
 * Vector icon set for incident types. Replaces emoji glyphs, which render
 * inconsistently across platforms and don't scale cleanly inside the timeline
 * nodes. Each icon is a 24x24 stroke glyph that inherits its colour from
 * `currentColor`, so it can be tinted per incident type.
 *
 * The raw inner-SVG markup is kept as strings so the same source can drive both
 * the React component (feed/list) and a serialised string for Leaflet map
 * markers. The markup is a trusted internal constant — never user input — so
 * `dangerouslySetInnerHTML` here is safe.
 */
export const ICON_PATHS: Record<string, string> = {
  car: '<path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11"/><path d="M3 11h18v4.5a1 1 0 0 1-1 1h-1"/><path d="M5 16.5H4a1 1 0 0 1-1-1V11"/><circle cx="7.5" cy="16.6" r="1.6"/><circle cx="16.5" cy="16.6" r="1.6"/>',
  flame: '<path d="M12 3c.8 2.9 4 4.2 4 8a4 4 0 0 1-8 0c0-1.5.5-2.6 1.3-3.5C10 8.6 11.2 6 12 3z"/>',
  door: '<path d="M5 20.5h14"/><path d="M7 20.5V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5v15"/><circle cx="14" cy="12" r="1" fill="currentColor" stroke="none"/>',
  banknote: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 9.6v4.8M18 9.6v4.8"/>',
  shield: '<path d="M12 3l7 3v5c0 4.2-3 7.3-7 8.5-4-1.2-7-4.3-7-8.5V6z"/><path d="M12 8.5v4"/><circle cx="12" cy="15.4" r="0.7" fill="currentColor" stroke="none"/>',
  octagon: '<path d="M8.2 3h7.6l5.2 5.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="M12 8v4.5"/><circle cx="12" cy="16" r="0.7" fill="currentColor" stroke="none"/>',
  hammer: '<path d="M13.3 4.2l6.5 6.5-2.3 2.3-6.5-6.5z"/><path d="M11 6.5L4.6 12.9a1.8 1.8 0 0 0 0 2.6 1.8 1.8 0 0 0 2.6 0l6.4-6.4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>',
  pill: '<path d="M6.6 17.4a4 4 0 0 1 0-5.7l5.1-5.1a4 4 0 0 1 5.7 5.7l-5.1 5.1a4 4 0 0 1-5.7 0z"/><path d="M9.4 9.4l5.2 5.2"/>',
  siren: '<path d="M6 18v-4.5a6 6 0 0 1 12 0V18"/><path d="M4.5 21h15a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-15a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1z"/><path d="M12 4.5V2.5M19.6 6.9l1.3-1.3M4.4 6.9L3.1 5.6"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-5.5M12 20V8M17 20v-8.5"/>',
  bag: '<path d="M5.5 8h13l-1 11.4a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9z"/><path d="M9 8V6.4a3 3 0 0 1 6 0V8"/>',
  pin: '<path d="M12 21s6.5-5.8 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.2 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.4"/>',
};

export function TypeIcon({
  name,
  size = 20,
  color,
  className,
}: {
  name: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const inner = ICON_PATHS[name] ?? ICON_PATHS.pin;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={color ? { color } : undefined}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

/** Serialised SVG string for non-React contexts (e.g. Leaflet div markers). */
export function typeIconSvg(name: string, color: string, size = 18): string {
  const inner = ICON_PATHS[name] ?? ICON_PATHS.pin;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" color="${color}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
