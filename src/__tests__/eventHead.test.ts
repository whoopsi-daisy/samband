/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * The header row of a notice: tag, then anything qualifying it, then the time.
 *
 * `justify-content: space-between` does not mean "push the ends apart" once
 * there is a third child: it means equal gaps between all of them. The
 * "uppdaterad" pill was therefore parked in the dead centre of the row,
 * floating between the tag it qualifies and a timestamp it has nothing to do
 * with, so it read as a third unrelated column rather than as a note on the
 * type.
 *
 * Asserted against the stylesheet because that is where the bug was — the
 * markup already had the three in the right order, and jsdom does not apply
 * this file, so a render test cannot see the difference.
 */
const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The declarations of the first block with exactly this selector. */
function block(selector: string): string {
  const match = css.match(new RegExp(`\\n\\${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no block for ${selector}`);
  // Comments carry prose about the very properties being asserted on.
  return match[1].replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('the head of a notice', () => {
  it('does not spread its children evenly across the row', () => {
    expect(block('.event-head')).not.toMatch(/justify-content:\s*space-between/);
  });

  // The pill belongs against the tag, one small gap away, because what it says
  // is about the notice's text and not about the hour it happened.
  it('starts its children together at the leading edge', () => {
    expect(block('.event-head')).toMatch(/justify-content:\s*flex-start/);
  });

  /*
   * What holds the right edge instead.
   *
   * An auto margin rather than space-between, so the time sits hard right
   * whether or not a pill was rendered beside the tag. With space-between, a
   * row without a pill put the time in a different place from a row with one,
   * and the column of times down the list stopped being a column.
   */
  it('pushes the time to the far edge on its own', () => {
    expect(block('.event-time')).toMatch(/margin-left:\s*auto/);
  });

  it('keeps the gap between tag and pill tight', () => {
    const gap = block('.event-head').match(/gap:\s*var\(--space-(\d)\)/);
    expect(gap).not.toBeNull();
    expect(Number(gap![1])).toBeLessThanOrEqual(2);
  });
});
