/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// db.ts resolves its path at module load, so the temp directory has to be set
// before either module is pulled in. Same reason the imports below are dynamic.
let tempDir: string;
let auth: typeof import('@/lib/adminAuth');

const GOOD_PASSWORD = 'ett-riktigt-langt-losenord';

async function load(): Promise<void> {
  jest.resetModules();
  auth = await import('@/lib/adminAuth');
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'samband-auth-'));
  process.env.SAMBAND_DATA_DIR = tempDir;
  delete process.env.STATS_USER;
  delete process.env.STATS_PASSWORD;
  delete process.env.STATS_PUBLIC;
  delete process.env.ADMIN_SETUP_OPEN;
  await load();
});

afterEach(() => {
  delete process.env.SAMBAND_DATA_DIR;
  delete process.env.STATS_USER;
  delete process.env.STATS_PASSWORD;
  delete process.env.STATS_PUBLIC;
  delete process.env.ADMIN_SETUP_OPEN;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('which credentials are in force', () => {
  it('sends a fresh installation to setup', () => {
    expect(auth.resolveAuthMode()).toEqual({ mode: 'setup' });
  });

  // An existing deployment upgrading into this feature must keep logging in
  // with the password it already has, so the environment pair wins outright.
  it('prefers the environment pair over a stored account', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    process.env.STATS_USER = 'gammal';
    process.env.STATS_PASSWORD = 'gammalt-losenord';

    expect(auth.resolveAuthMode()).toEqual({ mode: 'env' });
    expect(auth.verifyCredentials('gammal', 'gammalt-losenord')).toBe(true);
    expect(auth.verifyCredentials('vakthavande', GOOD_PASSWORD)).toBe(false);
  });

  it('ignores half a pair', () => {
    process.env.STATS_USER = 'vakthavande';
    expect(auth.resolveAuthMode()).toEqual({ mode: 'setup' });
  });

  it('uses the stored account once one exists', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    expect(auth.resolveAuthMode()).toEqual({ mode: 'stored' });
  });

  // STATS_PUBLIC was the escape hatch for "I know what I am doing". It should
  // not quietly undo an account somebody deliberately created.
  it('does not let STATS_PUBLIC reopen a configured dashboard', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    process.env.STATS_PUBLIC = 'true';
    expect(auth.resolveAuthMode()).toEqual({ mode: 'stored' });
  });

  it('still honours STATS_PUBLIC when nothing is configured', () => {
    process.env.STATS_PUBLIC = 'true';
    expect(auth.resolveAuthMode()).toEqual({ mode: 'public' });
  });
});

describe('the stored account', () => {
  it('accepts the password it was created with', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    expect(auth.verifyCredentials('vakthavande', GOOD_PASSWORD)).toBe(true);
  });

  it('rejects a wrong password, a wrong user, and a swap of the two', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    expect(auth.verifyCredentials('vakthavande', 'fel-losenord-helt')).toBe(false);
    expect(auth.verifyCredentials('nagon-annan', GOOD_PASSWORD)).toBe(false);
    expect(auth.verifyCredentials(GOOD_PASSWORD, 'vakthavande')).toBe(false);
  });

  it('never stores the password itself', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    const dump = fs.readFileSync(path.join(tempDir, 'events.db'));
    expect(dump.includes(Buffer.from(GOOD_PASSWORD))).toBe(false);
  });

  it('salts, so two installations with the same password differ', () => {
    const a = auth.hashPassword(GOOD_PASSWORD);
    const b = auth.hashPassword(GOOD_PASSWORD);
    expect(a).not.toEqual(b);
    expect(auth.verifyPassword(GOOD_PASSWORD, a)).toBe(true);
    expect(auth.verifyPassword(GOOD_PASSWORD, b)).toBe(true);
  });

  it('records the parameters it used, so they can be raised later', () => {
    const [scheme, N, r, p] = auth.hashPassword(GOOD_PASSWORD).split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(N)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it('refuses a malformed hash instead of throwing', () => {
    expect(auth.verifyPassword(GOOD_PASSWORD, '')).toBe(false);
    expect(auth.verifyPassword(GOOD_PASSWORD, 'notascheme$1$2$3$4$5')).toBe(false);
    expect(auth.verifyPassword(GOOD_PASSWORD, 'scrypt$0$0$0$$')).toBe(false);
  });

  // This is the first-run path, reachable without a login. It must not double
  // as a password reset for whoever finds it later.
  it('cannot be created twice', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    expect(() => auth.createStoredAdmin('inkraktare', 'ett-annat-langt-ord')).toThrow(
      auth.AdminSetupError
    );
    expect(auth.getStoredAdmin()?.username).toBe('vakthavande');
  });

  it('can be cleared from the host, which is the only way back in', () => {
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    auth.clearStoredAdmin();
    expect(auth.resolveAuthMode()).toEqual({ mode: 'setup' });
  });
});

describe('what a username and password are allowed to be', () => {
  // Basic auth sends "user:password" and the proxy splits at the first colon,
  // so a colon in the username would make the account impossible to log in to.
  it('rejects a colon in the username', () => {
    expect(() => auth.createStoredAdmin('vakt:havande', GOOD_PASSWORD)).toThrow(/kolon/);
  });

  it('rejects a username that is too short or too long', () => {
    expect(() => auth.createStoredAdmin('ab', GOOD_PASSWORD)).toThrow(auth.AdminSetupError);
    expect(() => auth.createStoredAdmin('x'.repeat(65), GOOD_PASSWORD)).toThrow(
      auth.AdminSetupError
    );
  });

  it('rejects control characters, which would break the header', () => {
    expect(() => auth.createStoredAdmin('vakt\nhavande', GOOD_PASSWORD)).toThrow(
      auth.AdminSetupError
    );
  });

  it('trims the username so a stray space cannot lock the account', () => {
    auth.createStoredAdmin('  vakthavande  ', GOOD_PASSWORD);
    expect(auth.verifyCredentials('vakthavande', GOOD_PASSWORD)).toBe(true);
  });

  it('rejects a short password', () => {
    expect(() => auth.createStoredAdmin('vakthavande', 'kort')).toThrow(/12 tecken/);
  });

  // scrypt runs over whatever it is handed, so the length cap is what stops a
  // request body from deciding how long the server spends hashing.
  it('rejects a password long enough to be a denial of service', () => {
    expect(() => auth.createStoredAdmin('vakthavande', 'x'.repeat(513))).toThrow(
      auth.AdminSetupError
    );
  });

  it('rejects a password equal to the username', () => {
    expect(() => auth.createStoredAdmin('vakthavandebefal', 'vakthavandebefal')).toThrow(
      auth.AdminSetupError
    );
  });

  // The password is not trimmed: leading and trailing spaces are part of it.
  it('keeps whitespace inside the password', () => {
    auth.createStoredAdmin('vakthavande', ' mellanslag i kanten ');
    expect(auth.verifyCredentials('vakthavande', ' mellanslag i kanten ')).toBe(true);
    expect(auth.verifyCredentials('vakthavande', 'mellanslag i kanten')).toBe(false);
  });
});

describe('the installation key', () => {
  it('is written next to the database and is not guessable', () => {
    const token = auth.getSetupToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(fs.readFileSync(path.join(tempDir, 'admin-setup-token.txt'), 'utf8').trim()).toBe(token);
  });

  it('is only readable by the user running the app', () => {
    auth.getSetupToken();
    const mode = fs.statSync(path.join(tempDir, 'admin-setup-token.txt')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('survives a restart, so it can be read from an older log line', async () => {
    const token = auth.getSetupToken();
    await load();
    expect(auth.getSetupToken()).toBe(token);
  });

  it('accepts itself and refuses anything else', () => {
    const token = auth.getSetupToken();
    expect(auth.verifySetupToken(token)).toBe(true);
    expect(auth.verifySetupToken(`${token}x`)).toBe(false);
    expect(auth.verifySetupToken('')).toBe(false);
  });

  it('tolerates the whitespace that comes with a copy-paste', () => {
    const token = auth.getSetupToken();
    expect(auth.verifySetupToken(`  ${token}\n`)).toBe(true);
  });

  // Once it has been used there is nothing left for it to open, and a key that
  // lingers in a log and a file is a key that can leak.
  it('is destroyed when the account is created', () => {
    auth.getSetupToken();
    auth.createStoredAdmin('vakthavande', GOOD_PASSWORD);
    expect(fs.existsSync(path.join(tempDir, 'admin-setup-token.txt'))).toBe(false);
  });

  it('is waived by ADMIN_SETUP_OPEN, for a deployment nobody else can reach', () => {
    process.env.ADMIN_SETUP_OPEN = 'true';
    expect(auth.isSetupOpen()).toBe(true);
    expect(auth.verifySetupToken('')).toBe(true);
  });
});
