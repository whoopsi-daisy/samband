/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * How the feed scrolls.
 *
 * Two things made it feel wrong, and both are one declaration each, which is why
 * they are pinned here rather than left to be reintroduced by the next person who
 * reaches for a nice-sounding property.
 */
const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The declarations inside the block for a selector, comments stripped. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{\\n([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`no block matched ${selector}`);
  return match[1].replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the document', () => {
  /*
   * `scroll-behavior: smooth` on the root is a far wider instruction than it
   * looks. It does not only apply to the app's own scrollTo calls: it takes over
   * every scroll the browser performs that is not a direct gesture — Page Down,
   * the space bar, Home and End, arrow keys, find-in-page and the scroll position
   * restored on back — and animates each of them on a curve slower than the input
   * that asked for it. That is the "choppy, not quite standard" feel, and it is
   * not dropped frames.
   */
  it('does not animate scrolls the reader did not ask to be animated', () => {
    expect(block('html')).not.toMatch(/scroll-behavior/);
    // Nor anywhere else on the root, under any selector for it.
    expect(css).not.toMatch(/(^|\n)(html|:root)[^{]*\{[^}]*scroll-behavior:\s*smooth/);
  });

  // Every glide the app actually wants is asked for at the call site, so none of
  // them depend on the rule above.
  it('leaves the deliberate ones alone', () => {
    const components = ['ClientApp', 'EventList', 'ScrollToTop'].map((name) =>
      fs.readFileSync(path.join(process.cwd(), `src/components/${name}.tsx`), 'utf8')
    );
    expect(components.some((source) => source.includes("behavior: 'smooth'"))).toBe(true);
  });

  /*
   * The header is 52px of sticky opaque background and nothing accounted for it:
   * following the skip link put the top of the feed behind it.
   */
  it('keeps whatever is scrolled to clear of the sticky header', () => {
    expect(block('html')).toMatch(/scroll-padding-top:.*var\(--header-h\)/);
  });
});

describe('a long feed', () => {
  /*
   * The feed scroll-loads well past a hundred rows, and every one of them used to
   * be laid out and painted on each frame that invalidated them — a row opening,
   * the minute ticking over in every relative timestamp, the theme changing — so
   * the further you scrolled the more each frame cost.
   */
  it('does not lay out or paint the rows that are off screen', () => {
    expect(block('.event-row')).toMatch(/content-visibility:\s*auto/);
  });

  /*
   * `auto` in the intrinsic size is what makes it safe: the browser remembers
   * each row's real height once rendered, so the scrollbar and the scroll
   * position stay put instead of jittering as rows are skipped and un-skipped.
   * A fixed size alone is how content-visibility earns its reputation.
   */
  it('remembers how tall a row turned out to be', () => {
    expect(block('.event-row')).toMatch(/contain-intrinsic-size:\s*auto\s/);
  });

  /*
   * An expanded row's height changes under it while the detail text arrives from
   * a fetch, and containing a subtree that is being measured is how you get a row
   * that clips its last paragraph. They are on screen by definition.
   */
  it('exempts the row that is open and the one that was linked to', () => {
    const opened = block('.event-row--expanded,\n.event-row--highlighted');
    expect(opened).toMatch(/content-visibility:\s*visible/);
  });
});

describe('the rows that are on their way', () => {
  /*
   * The skeleton sweep animated `background-position` on the element itself,
   * which the compositor cannot do: every frame was a repaint, on twelve
   * elements, running for exactly as long as a page was in flight — which is
   * while the reader is scrolling toward it.
   */
  it('sweeps by moving a layer rather than repainting a gradient', () => {
    expect(css).toMatch(/@keyframes skeleton-sweep \{[^}]*transform: translateX/);
    expect(css).not.toMatch(/@keyframes skeleton-sweep \{[^}]*background-position/);
  });

  it('still marks the space when motion is turned off', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n\s*\.skeleton \{/);
  });
});
