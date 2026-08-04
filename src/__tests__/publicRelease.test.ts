/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

// The things a site has to get right before it is public, checked here because
// none of them shows up in normal use: a wrong canonical host is invisible
// until somebody posts a link, and a missing attribution is invisible until
// somebody who cares about licences looks.

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('the canonical address', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.SITE_URL;
  });

  it('uses what the deployment was told', async () => {
    process.env.SITE_URL = 'https://samband.example.se';
    const { siteUrl, isSiteUrlConfigured } = await import('@/lib/site');

    expect(siteUrl()).toBe('https://samband.example.se');
    expect(isSiteUrlConfigured()).toBe(true);
  });

  // Both are what somebody actually types into a compose file.
  it('tolerates a trailing slash and a missing scheme', async () => {
    process.env.SITE_URL = 'samband.example.se/';
    const { siteUrl } = await import('@/lib/site');
    expect(siteUrl()).toBe('https://samband.example.se');
  });

  it('still yields an absolute URL when nothing was set', async () => {
    const { siteUrl, isSiteUrlConfigured } = await import('@/lib/site');

    expect(isSiteUrlConfigured()).toBe(false);
    expect(() => new URL(siteUrl())).not.toThrow();
  });
});

describe('robots.txt', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.SITE_URL = 'https://samband.example.se';
  });

  // Not a security measure: the login is. A 401 in a search index is simply
  // worse than useless, and the JSON means nothing out of context.
  it('keeps the dashboard and the API out of search results', async () => {
    const robots = (await import('@/app/robots')).default();
    const [rule] = Array.isArray(robots.rules) ? robots.rules : [robots.rules];

    expect(rule.allow).toBe('/');
    expect(rule.disallow).toEqual(expect.arrayContaining(['/stats', '/api/']));
  });

  it('points at the sitemap on the configured host', async () => {
    const robots = (await import('@/app/robots')).default();
    expect(robots.sitemap).toBe('https://samband.example.se/sitemap.xml');
  });

  // The /om page was removed, and a sitemap that still advertises it hands
  // every crawler a 404 as if it were content.
  it('lists the pages that exist and nothing else', async () => {
    const sitemap = (await import('@/app/sitemap')).default();
    expect(sitemap.map((entry) => entry.url)).toEqual(['https://samband.example.se']);
  });

  it('does not point anywhere the app no longer serves', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/om'))).toBe(false);

    for (const file of ['src/components/Footer.tsx', 'src/components/Header.tsx']) {
      expect(read(file)).not.toMatch(/href=["']\/om["']/);
    }
  });
});

describe('what the site says about itself', () => {
  // Every source is credited where it is used rather than on one page about
  // the site: the police link sits on the notice it came from, Sveriges Radio
  // under the warnings it issued, and the map's tiles in the map's corner.
  it('names its sources at the point of use', () => {
    expect(read('src/components/EventMap.tsx').toLowerCase()).toContain('openstreetmap');
    expect(read('src/components/EventMap.tsx').toLowerCase()).toContain('carto');
    expect(read('src/components/VmaView.tsx').toLowerCase()).toContain('sveriges radio');
    expect(read('src/components/EventCard.tsx').toLowerCase()).toContain('polisen.se');
  });

  it('answers the tracking question, which the code can back up', () => {
    const sources = ['src/components', 'src/app', 'src/hooks', 'src/lib']
      .flatMap((dir) => fs.readdirSync(path.join(process.cwd(), dir), { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx)$/.test(file));
    expect(sources.length).toBeGreaterThan(20);

    const all = ['src/components', 'src/app', 'src/hooks', 'src/lib']
      .map((dir) => {
        const files = fs.readdirSync(path.join(process.cwd(), dir), { recursive: true }) as string[];
        return files
          .filter((file) => /\.(ts|tsx)$/.test(file))
          .map((file) => read(path.join(dir, file)))
          .join('\n');
      })
      .join('\n');

    for (const tracker of ['googletagmanager', 'gtag(', 'plausible', 'matomo', 'fathom', 'posthog']) {
      expect(all.toLowerCase()).not.toContain(tracker);
    }
  });
});

describe('map attribution', () => {
  const map = read('src/components/EventMap.tsx');

  // ODbL requires the credit to be shown, and CARTO's terms say the same about
  // the tiles. It has been wrong in both directions: first switched off, so the
  // string handed to the tile layer was set and never rendered, then a band of
  // body text under the canvas, which was the largest thing in the block that
  // explains the map. Leaflet's own corner control is the answer to both.
  it('is rendered, not just handed to Leaflet', () => {
    // Leaflet's own control is off; the credit is a collapsed control of our
    // own, which is what OpenStreetMap's attribution guidelines allow for a
    // constrained interactive map. What must never happen is the string being
    // set on a layer and rendered nowhere, which is where this started.
    expect(map).toContain('addCreditControl');
    expect(map).toContain('map-credit-panel');
    expect(map).toContain('openstreetmap.org/copyright');
    expect(map).toContain('carto.com/attributions');
  });

  it('is reachable rather than merely present', () => {
    // Behind a button, so it has to be operable and named. A div nobody can
    // open is not attribution.
    expect(map).toContain("aria-label', 'Om kartan och dess källor'");
    expect(map).toContain("aria-expanded");
  });

  // Both layers need it: the fallback swaps the whole tile source when CARTO
  // fails, and an OSM layer with no credit is the same licence breach.
  it('is set on the fallback tile layer too', () => {
    expect(map).toContain('attribution: CARTO_CREDIT');
    expect(map).toContain('attribution: OSM_CREDIT');
  });

  it('is not hidden by the stylesheet', () => {
    const css = read('src/app/globals.css');
    const block = css.slice(css.indexOf('.leaflet-control-attribution {'));
    expect(block.slice(0, block.indexOf('}'))).not.toMatch(/display:\s*none/);
  });
});

describe('the pages that catch a failure', () => {
  it('exist, so a public visitor never sees the framework default', () => {
    for (const file of ['src/app/not-found.tsx', 'src/app/error.tsx', 'src/app/global-error.tsx']) {
      expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
    }
  });

  // The stylesheet is imported by the layout that just failed, so a custom
  // property is not guaranteed to resolve.
  it('styles the global error inline, since the stylesheet may be gone', () => {
    const globalError = read('src/app/global-error.tsx');
    expect(globalError).toContain('<html');
    expect(globalError).not.toContain('className=');
    expect(globalError).not.toContain('var(--');
  });

  // The message comes off a stack the reader cannot act on, and is a way to
  // put internals into a screenshot.
  it('shows a reference rather than the exception text', () => {
    const error = read('src/app/error.tsx');
    expect(error).toContain('error.digest');
    expect(error).not.toContain('{error.message}');
  });
});

describe('the installable app', () => {
  const manifest = JSON.parse(read('public/manifest.json'));

  // Chrome shows the richer install prompt only when screenshots are present
  // with a form_factor. Without them, installing is a bare name and icon.
  it('carries screenshots for both form factors', () => {
    const factors = manifest.screenshots.map((s: { form_factor: string }) => s.form_factor);
    expect(factors).toContain('narrow');
    expect(factors).toContain('wide');

    for (const shot of manifest.screenshots) {
      const png = fs.readFileSync(path.join(process.cwd(), 'public', shot.src));
      const [w, h] = shot.sizes.split('x').map(Number);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([w, h]);
    }
  });

  it('has an icon Android can mask without clipping the mark', () => {
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
    expect(purposes).toContain('maskable');
  });

  // In standalone mode Android paints the title bar with theme_color, so a
  // different value here means installing the app changes its own chrome.
  it('paints its chrome the same colour the page does', () => {
    const css = read('src/app/globals.css');
    const bg = css.match(/--bg:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(bg).toBeTruthy();
    expect(manifest.theme_color.toLowerCase()).toBe(bg!.toLowerCase());
    expect(manifest.background_color.toLowerCase()).toBe(bg!.toLowerCase());
  });
});

describe('the share image', () => {
  it('is the shape link previews lay out for', () => {
    const file = path.join(process.cwd(), 'public/og.png');
    expect(fs.existsSync(file)).toBe(true);

    // PNG header: width and height are big-endian at bytes 16 and 20.
    const png = fs.readFileSync(file);
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it('is what the metadata points at', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain("'/og.png'");
    expect(layout).toContain('summary_large_image');
    expect(layout).toContain('canonical');
  });
});
