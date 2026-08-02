/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

// The gate in front of /stats and the import API. These exercise the proxy
// itself rather than the module behind it, because the interesting part is what
// a browser and a fetch() each get back in every state.
let tempDir: string;
let auth: typeof import('@/lib/adminAuth');
let proxy: typeof import('@/proxy');

const PASSWORD = 'ett-riktigt-langt-losenord';

const basic = (username: string, password: string): string =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

const get = (pathname: string, authorization?: string): NextRequest =>
  new NextRequest(new URL(pathname, 'https://samband.example'), {
    headers: authorization ? { authorization } : undefined,
  });

async function load(): Promise<void> {
  jest.resetModules();
  auth = await import('@/lib/adminAuth');
  proxy = await import('@/proxy');
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-proxy-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  delete process.env.STATS_USER;
  delete process.env.STATS_PASSWORD;
  delete process.env.STATS_PUBLIC;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await load();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SAMBAND_DATA_DIR;
  delete process.env.STATS_USER;
  delete process.env.STATS_PASSWORD;
  delete process.env.STATS_PUBLIC;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** A response the proxy let through, as opposed to one it produced itself. */
const passedThrough = (response: Response): boolean =>
  response.headers.get('x-middleware-next') === '1';

describe('a fresh installation', () => {
  it('sends a browser to the setup page instead of a locked door', () => {
    const response = proxy.proxy(get('/stats'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') as string).pathname).toBe('/stats/setup');
  });

  // A redirect to an HTML form is not a useful answer to a fetch(), so the API
  // gets a sentence it can print.
  it('answers the import API in words', async () => {
    const response = proxy.proxy(get('/api/import/brottsplatskartan'));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('/stats/setup');
  });

  it('lets the setup page itself through', () => {
    expect(passedThrough(proxy.proxy(get('/stats/setup')))).toBe(true);
  });

  it('never caches its refusals', () => {
    expect(proxy.proxy(get('/api/import/brottsplatskartan')).headers.get('Cache-Control')).toBe(
      'no-store'
    );
  });
});

describe('once an account exists', () => {
  beforeEach(() => {
    auth.createStoredAdmin('vakthavande', PASSWORD);
  });

  it('asks for a login', () => {
    const response = proxy.proxy(get('/stats'));
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('accepts the right credentials', () => {
    expect(passedThrough(proxy.proxy(get('/stats', basic('vakthavande', PASSWORD))))).toBe(true);
  });

  it('rejects the wrong ones', () => {
    expect(proxy.proxy(get('/stats', basic('vakthavande', 'fel-losenord-helt'))).status).toBe(401);
    expect(proxy.proxy(get('/stats', basic('nagon-annan', PASSWORD))).status).toBe(401);
  });

  // The setup page is not merely useless now, it is misleading: it offers to
  // create an account that cannot be created.
  it('takes the setup page away', () => {
    const response = proxy.proxy(get('/stats/setup'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') as string).pathname).toBe('/stats');
  });

  it('guards the import API with the same account', () => {
    expect(proxy.proxy(get('/api/import/brottsplatskartan')).status).toBe(401);
    expect(
      passedThrough(proxy.proxy(get('/api/import/brottsplatskartan', basic('vakthavande', PASSWORD))))
    ).toBe(true);
  });
});

describe('credentials from the environment', () => {
  beforeEach(() => {
    process.env.STATS_USER = 'gammal';
    process.env.STATS_PASSWORD = 'gammalt-losenord';
  });

  it('still works exactly as it did before setup existed', () => {
    expect(proxy.proxy(get('/stats')).status).toBe(401);
    expect(passedThrough(proxy.proxy(get('/stats', basic('gammal', 'gammalt-losenord'))))).toBe(
      true
    );
  });

  it('does not offer a setup page there is no use for', () => {
    expect(proxy.proxy(get('/stats/setup')).status).toBe(307);
  });

  // Passwords may contain colons; usernames may not, which is why the account
  // form rejects them.
  it('splits the header at the first colon only', () => {
    process.env.STATS_PASSWORD = 'a:b:c';
    expect(passedThrough(proxy.proxy(get('/stats', basic('gammal', 'a:b:c'))))).toBe(true);
  });
});

describe('malformed authorization headers', () => {
  beforeEach(() => {
    process.env.STATS_USER = 'gammal';
    process.env.STATS_PASSWORD = 'gammalt-losenord';
  });

  it.each([
    ['no scheme', 'gammal:gammalt-losenord'],
    ['the wrong scheme', 'Bearer abc'],
    ['base64 that is not', 'Basic !!!!'],
    ['no colon at all', `Basic ${Buffer.from('gammal').toString('base64')}`],
    ['nothing', ''],
  ])('answers 401 for %s', (_label, header) => {
    expect(proxy.proxy(get('/stats', header || undefined)).status).toBe(401);
  });
});

describe('STATS_PUBLIC', () => {
  it('opens the dashboard when nothing else is configured', () => {
    process.env.STATS_PUBLIC = 'true';
    expect(passedThrough(proxy.proxy(get('/stats')))).toBe(true);
  });

  it('does not undo an account somebody created on purpose', () => {
    auth.createStoredAdmin('vakthavande', PASSWORD);
    process.env.STATS_PUBLIC = 'true';
    expect(proxy.proxy(get('/stats')).status).toBe(401);
  });
});

describe('when the database cannot be read', () => {
  // "Cannot tell whether an account exists" has to close the route. Falling
  // through to open would publish the dashboard on exactly the broken
  // deployment least likely to be watched.
  it('fails closed rather than open', async () => {
    jest.resetModules();
    jest.doMock('@/lib/db', () => ({
      getDatabase: () => {
        throw new Error('SQLITE_CANTOPEN');
      },
      getDataDir: () => tempDir,
    }));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const brokenProxy = await import('@/proxy');
    const response = brokenProxy.proxy(get('/stats'));

    expect(response.status).toBe(503);
    expect(passedThrough(response)).toBe(false);
    jest.dontMock('@/lib/db');
  });
});

describe('the matcher', () => {
  it('covers the dashboard and the import API', () => {
    expect(proxy.config.matcher).toEqual(['/stats/:path*', '/api/import/:path*']);
  });

  // Deliberately absent: it is how the credentials come to exist, and it
  // enforces its own preconditions.
  it('leaves the setup endpoint out', () => {
    expect(proxy.config.matcher.some((pattern) => pattern.startsWith('/api/admin'))).toBe(false);
  });
});
