import fs from 'fs';
import path from 'path';

/**
 * The category tags are the one place in the app where a colour is computed
 * against another colour that lives somewhere else in the same file. Each
 * --tag-ink was walked along its family's hue until it cleared AA on that
 * family's wash, over the surfaces a row can present. Change --surface, or the
 * tint percentage, or a family colour, and every one of those eighteen
 * calculations is silently invalidated: the page still renders, the text is
 * still there, and it is quietly under contrast.
 *
 * That has already happened twice. Once when the palette gained a tint and the
 * surfaces moved under the inks, and once when the inks were tuned against the
 * resting surface only and every family fell under AA the moment a card was
 * hovered or opened.
 */

const CSS = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]: number[]): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: number[], b: number[]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The wash: the family colour at `alpha`, composited on an opaque surface. */
const composite = (fg: number[], alpha: number, bg: number[]): number[] =>
  fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]);

/** A custom property's value, read out of the given block of the stylesheet. */
function token(name: string, from: string): string {
  const block = CSS.slice(CSS.indexOf(from));
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block);
  if (!match) throw new Error(`token --${name} not found after "${from}"`);
  return match[1];
}

function families(): { name: string; tag: string; light: string; dark: string }[] {
  const out: { name: string; tag: string; light: string; dark: string }[] = [];
  const lightRe = /\.event-type\[data-family="(\w+)"\]\s*\{\s*--tag:\s*(#[0-9a-f]{6});\s*--tag-ink:\s*(#[0-9a-f]{6})/gi;
  for (const m of CSS.matchAll(lightRe)) {
    const darkRe = new RegExp(
      `\\[data-theme="dark"\\] \\.event-type\\[data-family="${m[1]}"\\]\\s*\\{\\s*--tag-ink:\\s*(#[0-9a-f]{6})`,
      'i'
    );
    const dark = darkRe.exec(CSS);
    if (!dark) throw new Error(`family "${m[1]}" has no dark ink`);
    out.push({ name: m[1], tag: m[2], light: m[3], dark: dark[1] });
  }
  return out;
}

// Read straight from the stylesheet, so moving a surface moves the test with it.
const LIGHT_SURFACES = ['bg', 'surface', 'surface-hover', 'surface-raised'].map((n) =>
  token(n, '/* ── Colour ──')
);
const DARK_SURFACES = ['bg', 'surface', 'surface-hover', 'surface-raised'].map((n) =>
  token(n, '[data-theme="dark"]')
);

const LIGHT_TINT = 0.1;
const DARK_TINT = 0.2;
const AA = 4.5;

describe('category tag contrast', () => {
  const all = families();

  it('covers every family in the type registry', async () => {
    const { TYPE_FAMILIES } = await import('@/types');
    expect(all.map((f) => f.name).sort()).toEqual(Object.keys(TYPE_FAMILIES).sort());
  });

  // The wash is the family's own colour, so a family colour that changes in the
  // registry without changing here would tint the tag one hue and ink it
  // another.
  it('washes each tag in the same colour the map uses for that family', async () => {
    const { TYPE_FAMILIES } = await import('@/types');
    for (const f of all) {
      const registry = (TYPE_FAMILIES as Record<string, { color: string }>)[f.name].color;
      expect(`${f.name}:${f.tag}`).toBe(`${f.name}:${registry}`);
    }
  });

  it.each([
    ['light', LIGHT_SURFACES, LIGHT_TINT, (f: { light: string }) => f.light],
    ['dark', DARK_SURFACES, DARK_TINT, (f: { dark: string }) => f.dark],
  ])('reads on every surface a row can present, in %s', (_theme, surfaces, tint, pick) => {
    for (const family of all) {
      for (const surface of surfaces as string[]) {
        const wash = composite(hex(family.tag), tint as number, hex(surface));
        const ratio = contrast(hex((pick as (f: typeof family) => string)(family)), wash);
        // Compared as a string so a failure names the family and the surface it
        // failed on, rather than just reporting two numbers.
        const got = `${family.name} on ${surface}: ${ratio.toFixed(2)}:1`;
        expect(ratio >= AA ? got : `${got} — under ${AA}:1`).toBe(got);
      }
    }
  });
});
