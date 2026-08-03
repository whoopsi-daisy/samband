import { markerInk } from '@/lib/markerInk';
import { TYPE_FAMILIES } from '@/types';

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const luminance = (rgb: number[]): number =>
  0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * A marker that holds several incidents prints the count inside it, and that
 * count is text at 11px: AA, no exemption. The palette this draws from is
 * eighteen colours chosen for a tag background, not for carrying type, and it
 * runs from #991b1b to #94a3b8. Two of them (the violet and the indigo) land
 * just short of 4.5 against either ink, which is exactly the kind of thing that
 * goes unnoticed because the number is still perfectly visible.
 */
describe('the ink inside a grouped marker', () => {
  it.each(Object.entries(TYPE_FAMILIES))('clears AA for %s', (_key, family) => {
    const { fill, ink } = markerInk(family.color);
    expect(contrast(fill, ink)).toBeGreaterThanOrEqual(4.5);
  });

  // Deepening the fill is the fallback, not the rule: it must not fire on a
  // colour that was already readable, or the legend swatch and the marker stop
  // being the same colour.
  it('leaves a colour alone when an ink already works on it', () => {
    expect(markerInk('#991b1b')).toEqual({ fill: '#991b1b', ink: '#ffffff' });
    expect(markerInk('#f59e0b')).toEqual({ fill: '#f59e0b', ink: '#0b1220' });
  });

  it('deepens only the mid-luminance colours, and only slightly', () => {
    const { fill, ink } = markerInk('#8b5cf6');

    expect(fill).not.toBe('#8b5cf6');
    expect(ink).toBe('#ffffff');
    // Still recognisably the same violet beside its legend swatch.
    expect(contrast(fill, '#8b5cf6')).toBeLessThan(1.3);
  });

  // This runs inside a render loop over every marker on the map, so a palette
  // entry that is not a hex must not throw.
  it('does not throw on a colour it cannot parse', () => {
    expect(markerInk('rebeccapurple')).toEqual({ fill: 'rebeccapurple', ink: '#ffffff' });
  });
});
