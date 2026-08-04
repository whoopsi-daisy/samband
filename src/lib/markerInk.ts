/**
 * Readable numbers inside a coloured map marker.
 *
 * A marker holding several incidents prints the count inside the bubble, and a
 * printed count is text: it has to clear AA against whatever it sits on. The
 * eighteen family colours span a very wide luminance range, from #991b1b to
 * #94a3b8, so no single ink works for all of them — white on the amber used for
 * robbery is 2.15:1, and near-black on the deep red used for a death is 2.25:1.
 *
 * So the ink is chosen per colour, and in the two mid-luminance cases where
 * neither ink reaches 4.5:1 on its own (fraud's violet and the indigo used for
 * police operations, both landing just short at about 4.4) the bubble itself is
 * deepened a few percent until white does. Five percent is enough for both and
 * is not a colour change anyone can see beside the legend swatch; the alternative
 * was retuning two colours that are load-bearing everywhere else in the app.
 */

/** Anything below this is failing AA for normal-size text. */
const AA = 4.5;

/** The dark ink. Not pure black: it matches the app's darkest text token. */
const DARK = '#0b1220';
const LIGHT = '#ffffff';

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function toHex(rgb: number[]): string {
  return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(rgb: number[]): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface MarkerInk {
  /** The bubble's fill: the family colour, deepened only if it had to be. */
  fill: string;
  /** The colour the count is printed in. */
  ink: string;
}

/**
 * The fill and ink for a marker in the given family colour.
 *
 * Falls back to the colour unchanged with white ink if it is not a six-digit
 * hex, so a malformed palette entry cannot throw inside a render loop.
 */
export function markerInk(color: string): MarkerInk {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return { fill: color, ink: LIGHT };

  const rgb = channels(color);
  const onLight = contrast(rgb, channels(LIGHT));
  const onDark = contrast(rgb, channels(DARK));

  if (Math.max(onLight, onDark) >= AA) {
    return { fill: color, ink: onLight >= onDark ? LIGHT : DARK };
  }

  // Mid-luminance: deepen the fill in small steps until white is readable on
  // it. Bounded, so an unexpected colour cannot spin here.
  for (let step = 1; step <= 8; step++) {
    const deeper = rgb.map((c) => c * (1 - step * 0.05));
    if (contrast(deeper, channels(LIGHT)) >= AA) {
      return { fill: toHex(deeper), ink: LIGHT };
    }
  }

  return { fill: toHex(rgb.map((c) => c * 0.6)), ink: LIGHT };
}
