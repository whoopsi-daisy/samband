/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

// The dark palette is written twice: once behind the attribute the inline
// bootstrap sets, and once behind prefers-color-scheme for every case where
// that script never ran. Two copies of fifty values is a thing that drifts, so
// this holds them together.
const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The declarations inside the first block matching a selector. */
function tokensIn(pattern: RegExp): Map<string, string> {
  const match = css.match(pattern);
  if (!match) throw new Error(`no block matched ${pattern}`);

  const tokens = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    const declaration = line.split('/*')[0].trim();
    const colon = declaration.indexOf(':');
    if (!declaration.startsWith('--') || colon === -1) continue;
    tokens.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).replace(/;$/, '').trim());
  }
  return tokens;
}

const attributeTokens = tokensIn(/\[data-theme="dark"\] \{\n([\s\S]*?)\n\}/);
const mediaTokens = tokensIn(
  /@media \(prefers-color-scheme: dark\) \{\n\s*:root:not\(\[data-theme\]\) \{\n([\s\S]*?)\n\s*\}/
);

describe('the dark palette', () => {
  it('is not empty, so a passing test means something', () => {
    expect(attributeTokens.size).toBeGreaterThan(20);
  });

  // A reader who asked their system for dark and got a page of white is the
  // failure this exists to stop. It happened on the statically prerendered
  // 404, where React reconciles <html> during hydration and drops the
  // attribute a frame after the bootstrap set it.
  it('applies without the attribute the bootstrap script sets', () => {
    expect(mediaTokens.size).toBe(attributeTokens.size);
  });

  it('declares the same value for every token in both places', () => {
    const drifted = [...attributeTokens].filter(([name, value]) => mediaTokens.get(name) !== value);
    expect(drifted).toEqual([]);
  });

  // Both directions: someone who picked light on a dark system has to keep it,
  // and someone who picked dark on a light system has to keep that too.
  it('lets an explicit choice win over the system preference', () => {
    expect(css).toContain(':root:not([data-theme])');
    expect(css).toMatch(/\[data-theme="dark"\] \{/);
  });
});
