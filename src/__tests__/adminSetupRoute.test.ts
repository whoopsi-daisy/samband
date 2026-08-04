/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

// POST /api/admin/setup is the one route under /api the proxy does not gate,
// because it is how the credentials the proxy checks come to exist. Everything
// here is about the guards it therefore has to carry itself.
let tempDir: string;
let auth: typeof import('@/lib/adminAuth');
let route: typeof import('@/app/api/admin/setup/route');

const PASSWORD = 'ett-riktigt-langt-losenord';

const post = (body: unknown, ip = '198.51.100.7'): NextRequest =>
  new NextRequest('https://samband.example/api/admin/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

async function load(): Promise<void> {
  jest.resetModules();
  auth = await import('@/lib/adminAuth');
  route = await import('@/app/api/admin/setup/route');
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-setup-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  delete process.env.STATS_USER;
  delete process.env.STATS_PASSWORD;
  delete process.env.ADMIN_SETUP_OPEN;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await load();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SAMBAND_DATA_DIR;
  delete process.env.STATS_USER;
  delete process.env.STATS_PASSWORD;
  delete process.env.ADMIN_SETUP_OPEN;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('creating the account', () => {
  it('accepts the right key and stores a login', async () => {
    const token = auth.getSetupToken();
    const response = await route.POST(post({ username: 'vakthavande', password: PASSWORD, token }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ username: 'vakthavande' });
    expect(auth.verifyCredentials('vakthavande', PASSWORD)).toBe(true);
  });

  it('reports why a bad password was refused, in the form field', async () => {
    const token = auth.getSetupToken();
    const response = await route.POST(post({ username: 'vakthavande', password: 'kort', token }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('12') });
    expect(auth.hasStoredAdmin()).toBe(false);
  });
});

describe('the guards', () => {
  // Without the key, whoever loads the page first owns the dashboard.
  it('refuses a wrong installation key', async () => {
    auth.getSetupToken();
    const response = await route.POST(
      post({ username: 'inkraktare', password: PASSWORD, token: 'gissning' })
    );

    expect(response.status).toBe(403);
    expect(auth.hasStoredAdmin()).toBe(false);
  });

  it('refuses a missing key', async () => {
    auth.getSetupToken();
    expect((await route.POST(post({ username: 'inkraktare', password: PASSWORD }))).status).toBe(
      403
    );
  });

  // The endpoint stays reachable for the life of the deployment, so it has to
  // keep saying no long after setup is over.
  it('refuses once an account exists', async () => {
    auth.createStoredAdmin('vakthavande', PASSWORD);
    const response = await route.POST(
      post({ username: 'inkraktare', password: PASSWORD, token: 'vad-som-helst' })
    );

    expect(response.status).toBe(409);
    expect(auth.getStoredAdmin()?.username).toBe('vakthavande');
  });

  it('refuses when the environment already supplies the login', async () => {
    process.env.STATS_USER = 'gammal';
    process.env.STATS_PASSWORD = 'gammalt-losenord';

    const response = await route.POST(
      post({ username: 'vakthavande', password: PASSWORD, token: 'vad-som-helst' })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('STATS_USER'),
    });
  });

  it('waives the key when ADMIN_SETUP_OPEN is set', async () => {
    process.env.ADMIN_SETUP_OPEN = 'true';
    const response = await route.POST(post({ username: 'vakthavande', password: PASSWORD }));
    expect(response.status).toBe(201);
  });

  it('rejects a body that is not JSON', async () => {
    const request = new NextRequest('https://samband.example/api/admin/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect((await route.POST(request)).status).toBe(400);
  });

  // 60 requests a minute per IP, shared with the rest of the API. The key is
  // unguessable in any case; this is what keeps a loop from spending the
  // server's CPU trying.
  it('rate limits repeated attempts from one address', async () => {
    auth.getSetupToken();
    const attempt = () =>
      route.POST(post({ username: 'inkraktare', password: PASSWORD, token: 'fel' }, '203.0.113.9'));

    let last = await attempt();
    for (let i = 0; i < 65 && last.status !== 429; i++) {
      last = await attempt();
    }
    expect(last.status).toBe(429);
  });
});

describe('the status it reports', () => {
  it('says setup is still open, and whether the key is needed', async () => {
    await expect((await route.GET()).json()).resolves.toEqual({
      configured: false,
      source: null,
      tokenRequired: true,
    });
  });

  it('names which source is in force once one is', async () => {
    auth.createStoredAdmin('vakthavande', PASSWORD);
    await expect((await route.GET()).json()).resolves.toMatchObject({
      configured: true,
      source: 'stored',
    });
  });

  // The key itself is never in a response: the page would then hand it to
  // exactly the visitor it exists to stop.
  it('does not leak the key', async () => {
    const token = auth.getSetupToken();
    expect(await (await route.GET()).text()).not.toContain(token);
  });
});
